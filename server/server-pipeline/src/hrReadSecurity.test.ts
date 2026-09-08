//
// Copyright © 2026 YoungGlobes
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

// Unit tests for HrReadSecurityMiddleware (the transactor HR read guard).
//
// The middleware is driven through a mock `next` that serves its internal reads (the HrData space for
// membership, the reader's own Person by personUuid) and the query under test, plus a mock hierarchy whose
// isDerived encodes the Person/Employee/mixin/child-class relationships. Everything else is real (the auth
// rule via hasAccountRole, toFindResult, the strip/clone logic).

import core, {
  AccountRole,
  generateId,
  MeasureMetricsContext,
  systemAccountUuid,
  toFindResult,
  type Account,
  type AccountUuid,
  type Class,
  type Doc,
  type DocumentQuery,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx
} from '@hcengineering/core'
import contact from '@hcengineering/contact'
import ygHr from '@hcengineering/yg-hr'
import ygTimesheet from '@hcengineering/yg-timesheet'
import { HrReadSecurityMiddleware } from './hrReadSecurity'

const PERSON = contact.class.Person as unknown as Ref<Class<Doc>>
const EMP = contact.mixin.Employee as unknown as Ref<Class<Doc>>
const PERSONAL = ygHr.mixin.EmployeePersonal as unknown as string
const CONTACT_MX = ygHr.mixin.EmployeeContact as unknown as string
const JOB = ygHr.mixin.EmployeeJob as unknown as string
const WORKEXP = ygHr.class.WorkExperience as unknown as Ref<Class<Doc>>
const EDU = ygHr.class.Education as unknown as Ref<Class<Doc>>
const EC = ygHr.class.EmergencyContact as unknown as Ref<Class<Doc>>
const HRDATA = ygTimesheet.space.HrData
const CONTACTS_SPACE = 'contact:space:Contacts' as Ref<Space>

// isDerived relationships used by the middleware.
const CHAIN: Record<string, Set<string>> = {
  [EMP]: new Set([EMP, PERSON]),
  [PERSON]: new Set([PERSON]),
  [PERSONAL]: new Set([PERSONAL, EMP, PERSON]),
  [CONTACT_MX]: new Set([CONTACT_MX, EMP, PERSON]),
  [JOB]: new Set([JOB, EMP, PERSON]),
  [WORKEXP]: new Set([WORKEXP]),
  [EDU]: new Set([EDU]),
  [EC]: new Set([EC])
}
function isDerived (a: string, b: string): boolean {
  return CHAIN[a]?.has(b) ?? a === b
}

function acct (role: AccountRole, uuid?: string): Account {
  return {
    uuid: (uuid ?? generateId()) as unknown as AccountUuid,
    role,
    primarySocialId: 'test' as PersonId,
    socialIds: ['test' as PersonId],
    fullSocialIds: []
  }
}

function ctxFor (account: Account | undefined): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = (account === undefined ? undefined : { account }) as any
  return ctx
}

// A Person/Employee doc, optionally carrying the three HR mixins (nested under their id keys).
function emp (personUuid: string, opts: { id?: string, withMixins?: boolean, personalNull?: boolean } = {}): any {
  const d: any = {
    _id: opts.id ?? (generateId() as string),
    _class: EMP,
    space: CONTACTS_SPACE,
    name: 'Doe,John',
    active: true,
    personUuid
  }
  if (opts.personalNull === true) {
    d[PERSONAL] = null
  } else if (opts.withMixins !== false) {
    d[PERSONAL] = { gender: 'male', dateOfBirth: 1 }
    d[CONTACT_MX] = { mobile: '999' }
    d[JOB] = { designation: 'x' }
  }
  return d
}

function child (cls: Ref<Class<Doc>>, attachedTo: string): any {
  return {
    _id: generateId() as string,
    _class: cls,
    space: CONTACTS_SPACE,
    attachedTo,
    attachedToClass: EMP,
    collection: 'workExperience',
    employer: 'Acme'
  }
}

interface Env {
  dataset: Record<string, any[]>
  members: { list: string[] }
  ownByUuid: Record<string, string[]>
  spaceReads: number
}

function makeMiddleware (env: Env): any {
  const context: any = {
    hierarchy: { isDerived },
    workspace: { uuid: 'ws' as any, url: 'yg', dataId: 'ws' as any },
    modelDb: {},
    branding: null
  }
  const next: any = {
    findAll: async (_ctx: MeasureContext, _class: Ref<Class<Doc>>, query: DocumentQuery<Doc>, _options?: any) => {
      if ((_class as unknown as string) === (core.class.Space as unknown as string)) {
        env.spaceReads++
        return toFindResult([{ _id: HRDATA, members: env.members.list } as any])
      }
      if ((_class as unknown as string) === (PERSON as unknown as string) && (query as any)?.personUuid !== undefined) {
        const ids = env.ownByUuid[(query as any).personUuid] ?? []
        return toFindResult(ids.map((id) => ({ _id: id, _class: PERSON, personUuid: (query as any).personUuid }) as any))
      }
      return toFindResult((env.dataset[_class as unknown as string] ?? []) as any)
    },
    tx: async () => ({})
  }
  return new (HrReadSecurityMiddleware as any)(context, next)
}

describe('HrReadSecurityMiddleware', () => {
  const OTHER_UUID = 'other-uuid-1'

  function baseEnv (userUuid: string, ownPersonId: string): Env {
    return {
      dataset: {},
      members: { list: [] },
      ownByUuid: { [userUuid]: [ownPersonId] },
      spaceReads: 0
    }
  }

  // ── Fast-exit / authorized passthrough ────────────────────────────────────
  it('system account: passes through untouched', async () => {
    const env = baseEnv('u', 'p')
    env.dataset[EMP] = [emp(OTHER_UUID)]
    const mw = makeMiddleware(env)
    const res = await mw.findAll(ctxFor(acct(AccountRole.Owner, systemAccountUuid)), EMP, {})
    expect(res[0][PERSONAL]).toBeDefined()
    expect(res[0][JOB]).toBeDefined()
  })

  it('undefined contextData (space-security init path): passes through untouched, no crash', async () => {
    const env = baseEnv('u', 'p')
    env.dataset[EMP] = [emp(OTHER_UUID)]
    const mw = makeMiddleware(env)
    const res = await mw.findAll(ctxFor(undefined), EMP, {})
    expect(res[0][PERSONAL]).toBeDefined()
  })

  it('admin (Maintainer+): passes through untouched, without reading HrData', async () => {
    const env = baseEnv('u', 'p')
    env.dataset[EMP] = [emp(OTHER_UUID)]
    const mw = makeMiddleware(env)
    const res = await mw.findAll(ctxFor(acct(AccountRole.Maintainer, 'admin')), EMP, {})
    expect(res[0][PERSONAL]).toBeDefined()
    expect(res[0][CONTACT_MX]).toBeDefined()
    expect(env.spaceReads).toBe(0) // short-circuited before membership check
  })

  it('HR-team member: passes through untouched', async () => {
    const env = baseEnv('hr', 'p')
    env.members.list = ['hr']
    env.dataset[EMP] = [emp(OTHER_UUID)]
    const mw = makeMiddleware(env)
    const res = await mw.findAll(ctxFor(acct(AccountRole.User, 'hr')), EMP, {})
    expect(res[0][PERSONAL]).toBeDefined()
    expect(res[0][JOB]).toBeDefined()
  })

  // ── Non-HR reader: general Employee query ─────────────────────────────────
  it('non-HR user: strips other employees mixins, keeps own, never strips Employee identity', async () => {
    const U = 'user-1'
    const pOwn = 'person-own'
    const env = baseEnv(U, pOwn)
    const other = emp(OTHER_UUID)
    env.dataset[EMP] = [emp(U, { id: pOwn }), other]
    const mw = makeMiddleware(env)
    const res = await mw.findAll(ctxFor(acct(AccountRole.User, U)), EMP, {})

    expect(res.length).toBe(2)
    const own = res.find((d: any) => d.personUuid === U)
    const oth = res.find((d: any) => d.personUuid === OTHER_UUID)
    // own record intact
    expect(own[PERSONAL]).toBeDefined()
    expect(own[JOB]).toBeDefined()
    // other record: all three HR mixins gone
    expect(oth[PERSONAL]).toBeUndefined()
    expect(oth[CONTACT_MX]).toBeUndefined()
    expect(oth[JOB]).toBeUndefined()
    // ...but world-readable identity (name/active/_class) preserved
    expect(oth.name).toBe('Doe,John')
    expect(oth.active).toBe(true)
    expect(oth._class).toBe(EMP)
  })

  it('non-HR user: does not mutate the shared source doc (clone-on-write)', async () => {
    const U = 'user-2'
    const env = baseEnv(U, 'p2')
    const other = emp(OTHER_UUID)
    env.dataset[EMP] = [other]
    const mw = makeMiddleware(env)
    await mw.findAll(ctxFor(acct(AccountRole.User, U)), EMP, {})
    // the original object handed back by `next` must still carry its mixin
    expect(other[PERSONAL]).toBeDefined()
    expect(other[JOB]).toBeDefined()
  })

  it('non-HR user: strips a mixin key present with a null value', async () => {
    const U = 'user-null'
    const env = baseEnv(U, 'pn')
    env.dataset[EMP] = [emp(OTHER_UUID, { withMixins: false, personalNull: true })]
    const mw = makeMiddleware(env)
    const res = await mw.findAll(ctxFor(acct(AccountRole.User, U)), EMP, {})
    expect(PERSONAL in res[0]).toBe(false)
  })

  it('DocGuest is filtered (not exempt): other employees mixins stripped', async () => {
    const G = 'guest-1'
    const env = baseEnv(G, 'pg') // guest has no matching own person in practice
    env.ownByUuid = {}
    env.dataset[EMP] = [emp(OTHER_UUID)]
    const mw = makeMiddleware(env)
    const res = await mw.findAll(ctxFor(acct(AccountRole.DocGuest, G)), EMP, {})
    expect(res[0][PERSONAL]).toBeUndefined()
    expect(res[0][JOB]).toBeUndefined()
  })

  // ── Direct mixin-class / child-class queries ──────────────────────────────
  it('non-HR user: direct mixin-class query returns only own record', async () => {
    const U = 'user-3'
    const pOwn = 'person-own-3'
    const env = baseEnv(U, pOwn)
    env.dataset[PERSONAL] = [emp(U, { id: pOwn }), emp(OTHER_UUID)]
    const mw = makeMiddleware(env)
    const res = await mw.findAll(ctxFor(acct(AccountRole.User, U)), PERSONAL, {})
    expect(res.length).toBe(1)
    expect(res[0].personUuid).toBe(U)
  })

  it('non-HR user: direct child-class query returns only own persons rows', async () => {
    const U = 'user-4'
    const pOwn = 'person-own-4'
    const env = baseEnv(U, pOwn)
    env.dataset[WORKEXP] = [child(WORKEXP, pOwn), child(WORKEXP, 'person-other')]
    const mw = makeMiddleware(env)
    const res = await mw.findAll(ctxFor(acct(AccountRole.User, U)), WORKEXP, {})
    expect(res.length).toBe(1)
    expect(res[0].attachedTo).toBe(pOwn)
  })

  // ── $lookup coverage (the reverse-lookup leak the review caught) ───────────
  it('non-HR user: reverse-lookup child arrays drop non-own, keep own; looked-up Person mixins stripped', async () => {
    const U = 'user-5'
    const pOwn = 'person-own-5'
    const env = baseEnv(U, pOwn)

    const ownRow = emp(U, { id: pOwn })
    ownRow.$lookup = {
      workExperience: [child(WORKEXP, pOwn)],
      manager: emp(OTHER_UUID) // a looked-up Person carrying mixins
    }
    const otherRow = emp(OTHER_UUID)
    otherRow.$lookup = { workExperience: [child(WORKEXP, 'person-other')] }

    env.dataset[EMP] = [ownRow, otherRow]
    const mw = makeMiddleware(env)
    const res = await mw.findAll(ctxFor(acct(AccountRole.User, U)), EMP, { lookup: { _id: { workExperience: WORKEXP } } })

    const own = res.find((d: any) => d.personUuid === U)
    const oth = res.find((d: any) => d.personUuid === OTHER_UUID)
    // own person's own child docs survive in the lookup
    expect(own.$lookup.workExperience.length).toBe(1)
    // a non-own looked-up Person gets its mixins stripped
    expect(own.$lookup.manager[PERSONAL]).toBeUndefined()
    expect(own.$lookup.manager.name).toBe('Doe,John')
    // another employee's child docs are dropped entirely from the reverse-lookup array
    expect(oth.$lookup.workExperience.length).toBe(0)
  })

  // ── Membership cache invalidation (no stale over-grant) ────────────────────
  it('invalidates the HrData membership cache on a tx to that space (removed HR member loses access)', async () => {
    const M = 'member-x'
    const env = baseEnv(M, 'pm')
    env.members.list = [M]
    env.dataset[EMP] = [emp(OTHER_UUID)]
    const mw = makeMiddleware(env)

    // 1) while a member: authorized -> other mixins preserved
    let res = await mw.findAll(ctxFor(acct(AccountRole.User, M)), EMP, {})
    expect(res[0][PERSONAL]).toBeDefined()

    // 2) membership revoked + a tx touching the HrData space arrives
    env.members.list = []
    const tx: any = { _id: generateId(), _class: core.class.TxUpdateDoc, objectId: HRDATA, objectSpace: core.space.Space }
    await mw.tx(ctxFor(acct(AccountRole.User, M)), [tx as Tx])
    expect((mw as any).hrMembers).toBeUndefined()

    // 3) now unauthorized -> other mixins stripped (no stale over-grant)
    res = await mw.findAll(ctxFor(acct(AccountRole.User, M)), EMP, {})
    expect(res[0][PERSONAL]).toBeUndefined()
  })
})
