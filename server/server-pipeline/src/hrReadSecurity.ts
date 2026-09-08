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

// HR profile read guard (Part 2 of the HR access-control work; Part 1 is the UI route 403).
//
// The HR profile data lives as three mixins on the PUBLIC contact.class.Person / contact.mixin.Employee
// doc (ygHr.mixin.EmployeePersonal / EmployeeContact / EmployeeJob) plus six child AttachedDoc collections,
// all in the world-readable contact.space.Contacts space. Space security is space-granular only and cannot
// express "readable by HR OR the employee themselves", and the sensitive data deliberately shares a doc with
// world-readable directory fields, so it cannot be relocated to a private space. This transactor middleware
// closes the API read path: it strips those mixins (and filters those child docs) out of findAll results for
// any reader who is not authorized, WITHOUT touching the reader's own record.
//
// Authorized = Owner/Maintainer/Admin (hasAccountRole Maintainer) OR a member of ygTimesheet.space.HrData
// (the Roster-managed HR team, the same source the write-guard's isHrAuthorized uses). Self = the doc's own
// person (personUuid === the reader's account uuid), or, for a child doc, its attachedTo is the reader's own
// Person. system runs triggers/migrations and is exempt (fast-exit). No fulltext index touches these fields,
// so searchFulltext is not a leak path and needs no override.
//
// Placement: registered in pipeline.ts immediately AFTER SpaceSecurityMiddleware (so it post-processes
// already space-secured results) and BEFORE LiveQueryMiddleware (so its stripped output feeds live queries
// and broadcasts).

import contact, { type Person } from '@hcengineering/contact'
import core, {
  AccountRole,
  type Account,
  type AccountUuid,
  type AttachedDoc,
  type Class,
  type Doc,
  type DocumentQuery,
  type FindResult,
  type MeasureContext,
  type Mixin,
  type Ref,
  type SessionData,
  type Tx,
  type TxCUD,
  hasAccountRole,
  systemAccountUuid,
  toFindResult
} from '@hcengineering/core'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type ServerFindOptions,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import ygHr from '@hcengineering/yg-hr'
import ygTimesheet from '@hcengineering/yg-timesheet'

/**
 * @public
 */
export class HrReadSecurityMiddleware extends BaseMiddleware implements Middleware {
  // The three sensitive mixins to strip from Person/Employee results. NEVER contact.mixin.Employee itself
  // (name/avatar/active must stay world-readable).
  private readonly mixinKeys: Array<Ref<Mixin<Doc>>> = [
    ygHr.mixin.EmployeePersonal as Ref<Mixin<Doc>>,
    ygHr.mixin.EmployeeContact as Ref<Mixin<Doc>>,
    ygHr.mixin.EmployeeJob as Ref<Mixin<Doc>>
  ]

  // The six per-employee child collections (attached to a Person). Filtered to the reader's own person.
  private readonly childClasses: Array<Ref<Class<Doc>>> = [
    ygHr.class.EmergencyContact,
    ygHr.class.WorkExperience,
    ygHr.class.Education,
    ygHr.class.EmployeeSkill,
    ygHr.class.EmployeeLanguage,
    ygHr.class.EmployeeLicense
  ]

  // HrData.members, cached per-pipeline (shared across sessions), invalidated on a tx touching the HrData
  // space. undefined = not yet loaded; the promise de-dupes concurrent initialisers.
  private hrMembers: Set<AccountUuid> | undefined
  private hrMembersInit: Promise<Set<AccountUuid>> | undefined

  // account uuid -> the reader's own Person ids. personUuid rarely changes; an empty result is NOT cached so
  // a just-provisioned account is not pinned to "no own records".
  private readonly ownPersonCache = new Map<AccountUuid, Set<Ref<Person>>>()

  private constructor (context: PipelineContext, next?: Middleware) {
    super(context, next)
  }

  static async create (
    _ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<HrReadSecurityMiddleware> {
    return new HrReadSecurityMiddleware(context, next)
  }

  private async getHrMembers (ctx: MeasureContext): Promise<Set<AccountUuid>> {
    if (this.hrMembers !== undefined) return this.hrMembers
    if (this.hrMembersInit === undefined) {
      this.hrMembersInit = (async () => {
        const spaces = await this.provideFindAll(ctx, core.class.Space, { _id: ygTimesheet.space.HrData }, { limit: 1 })
        const members = new Set<AccountUuid>((spaces[0]?.members ?? []) as AccountUuid[])
        this.hrMembers = members
        return members
      })()
    }
    try {
      return await this.hrMembersInit
    } finally {
      this.hrMembersInit = undefined
    }
  }

  private async getOwnPersonIds (ctx: MeasureContext, account: Account): Promise<Set<Ref<Person>>> {
    const cached = this.ownPersonCache.get(account.uuid)
    if (cached !== undefined) return cached
    const persons = await this.provideFindAll(ctx, contact.class.Person, { personUuid: account.uuid } as any)
    const set = new Set<Ref<Person>>(persons.map((p) => p._id))
    // Cache even an empty set: personUuid is assigned at person/account provisioning and never changes,
    // so an account's own-person set is stable for the pipeline's lifetime, and this read is on the hot
    // path (every unauthorized findAll). No non-HR UI reads another's child docs, so a rare stale-empty
    // (a person not yet linked) has no user-visible effect and self reads go through isOwn(personUuid).
    this.ownPersonCache.set(account.uuid, set)
    return set
  }

  private isPerson (d: Doc): boolean {
    return this.context.hierarchy.isDerived(d._class, contact.class.Person)
  }

  private isChildDoc (d: Doc): boolean {
    return this.childClasses.some((c) => this.context.hierarchy.isDerived(d._class, c))
  }

  // Present = has data to protect. `!== undefined` (not `typeof === 'object'`) so a key present with a
  // null value is still stripped - matching the platform's hasMixin (typeof null === 'object') and closing
  // the case where any future code nulls a mixin instead of deleting it.
  private hasHrMixin (d: Doc): boolean {
    for (const k of this.mixinKeys) {
      if ((d as any)[k] !== undefined) return true
    }
    return false
  }

  private isOwn (d: Doc, account: Account): boolean {
    const personUuid = (d as any).personUuid
    return personUuid != null && String(personUuid) === String(account.uuid)
  }

  // Shallow-clone the doc and drop the three yg-hr mixin keys. Only top-level keys are removed, so a shallow
  // copy is enough and the shared model/DB object is never mutated.
  private stripMixinKeys<T extends Doc>(d: T): T {
    const c: any = { ...d }
    for (const k of this.mixinKeys) {
      if (c[k] !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete c[k]
      }
    }
    return c
  }

  // Sanitise $lookup sub-docs for a non-authorized reader:
  //  - a looked-up Person that is not the reader's own gets its mixin keys stripped (closes the
  //    assignee/lookup leak in Tracker, chat, etc.);
  //  - a looked-up HR child doc (reverse-lookup arrays: WorkExperience, Education, ...) that is not the
  //    reader's own person's is DROPPED entirely (its every field is sensitive).
  // Returns the same object reference when nothing changed.
  private sanitizeLookup (
    lookup: Record<string, any>,
    account: Account,
    own: Set<Ref<Person>>
  ): Record<string, any> {
    let changed = false
    const out: Record<string, any> = {}
    for (const key of Object.keys(lookup)) {
      const val = lookup[key]
      if (Array.isArray(val)) {
        let arrChanged = false
        const arr: any[] = []
        for (const v of val) {
          if (v != null && this.isPerson(v)) {
            if (!this.isOwn(v, account) && this.hasHrMixin(v)) {
              arr.push(this.stripMixinKeys(v))
              arrChanged = true
            } else {
              arr.push(v)
            }
          } else if (v != null && this.isChildDoc(v)) {
            if (own.has((v as AttachedDoc).attachedTo as Ref<Person>)) {
              arr.push(v)
            } else {
              arrChanged = true // drop non-own HR child doc
            }
          } else {
            arr.push(v)
          }
        }
        if (arrChanged) {
          changed = true
          out[key] = arr
        } else {
          out[key] = val
        }
      } else if (val != null && this.isPerson(val) && !this.isOwn(val, account) && this.hasHrMixin(val)) {
        changed = true
        out[key] = this.stripMixinKeys(val)
      } else if (
        val != null &&
        this.isChildDoc(val) &&
        !own.has((val as AttachedDoc).attachedTo as Ref<Person>)
      ) {
        changed = true
        out[key] = undefined // drop non-own HR child doc
      } else {
        out[key] = val
      }
    }
    return changed ? out : lookup
  }

  // Strip a single result doc: top-level mixin strip for non-own Persons, plus $lookup sanitisation.
  // Returns the same object reference when nothing changed (so callers can detect "untouched").
  private sanitize<T extends Doc>(doc: T, account: Account, own: Set<Ref<Person>>): T {
    let result: any = doc
    let cloned = false
    if (this.isPerson(doc) && !this.isOwn(doc, account) && this.hasHrMixin(doc)) {
      result = this.stripMixinKeys(doc)
      cloned = true
    }
    const lookup = (doc as any).$lookup
    if (lookup != null) {
      const sanitized = this.sanitizeLookup(lookup, account, own)
      if (sanitized !== lookup) {
        if (!cloned) {
          result = { ...(doc as any) }
          cloned = true
        }
        result.$lookup = sanitized
      }
    }
    return result
  }

  override async findAll<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    // Space security nulls contextData before its "read all Spaces" init call (which reaches this
    // middleware as `next`), so contextData can genuinely be undefined here despite its type.
    const account = (ctx.contextData as SessionData | undefined)?.account
    // Init path and system are exempt.
    if (account === undefined || account.uuid === systemAccountUuid) {
      return await this.provideFindAll(ctx, _class, query, options)
    }
    const authorized =
      hasAccountRole(account, AccountRole.Maintainer) || (await this.getHrMembers(ctx)).has(account.uuid)
    if (authorized) {
      return await this.provideFindAll(ctx, _class, query, options)
    }

    const res = await this.provideFindAll(ctx, _class, query, options)
    if (res.length === 0) return res

    const h = this.context.hierarchy
    const isChild = this.childClasses.some((c) => h.isDerived(_class, c))
    const isMixin = this.mixinKeys.some((m) => h.isDerived(_class, m as Ref<Class<Doc>>))
    // Needed for own-scoping child docs (direct queries and reverse-lookup arrays). Cached per account.
    const own = await this.getOwnPersonIds(ctx, account)

    let arr: T[] = res as unknown as T[]
    let filtered = false
    if (isChild) {
      // A direct query on a child collection: keep only the reader's own person's rows.
      arr = (res as unknown as AttachedDoc[]).filter((d) => own.has(d.attachedTo as Ref<Person>)) as unknown as T[]
      filtered = true
    } else if (isMixin) {
      // A direct query on one of the sensitive mixin classes: keep only the reader's own record.
      arr = (res as unknown as Doc[]).filter((d) => this.isOwn(d, account)) as unknown as T[]
      filtered = true
    }

    // Strip mixins from any non-own Person docs (general branch), and from $lookup sub-docs (all branches):
    // non-own Person lookups get their mixins stripped, non-own HR child-doc lookups get dropped. For the
    // filtered branches the top-level survivors are the reader's own, so only their lookups get touched.
    let anySanitized = false
    const out = arr.map((d) => {
      const s = this.sanitize(d, account, own)
      if (s !== d) anySanitized = true
      return s
    })

    if (!filtered && !anySanitized) return res
    return toFindResult(out, filtered ? out.length : res.total, res.lookupMap)
  }

  override async tx (ctx: MeasureContext<SessionData>, tx: Tx[]): Promise<TxMiddlewareResult> {
    for (const t of tx) {
      const cud = t as TxCUD<Doc>
      if (cud.objectId === ygTimesheet.space.HrData || cud.objectSpace === ygTimesheet.space.HrData) {
        // HrData membership changed: drop the cache so the next read re-reads members.
        this.hrMembers = undefined
        this.hrMembersInit = undefined
        break
      }
    }
    return await this.provideTx(ctx, tx)
  }
}
