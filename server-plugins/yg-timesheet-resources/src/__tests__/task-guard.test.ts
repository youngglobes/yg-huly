import { authorAuthorizer, isGuardedStatusWrite, isRecall, previousTaskState, restoreOps, type AuthorDeps, type TrustedUpdate, type UpdateLike } from '../task-guard'

const create = { attributes: { status: 'Submitted' } }
const u = (id: string, t: number, operations: Record<string, any>): { _id: string, modifiedOn: number, operations: Record<string, any> } => ({ _id: id, modifiedOn: t, operations })

describe('previousTaskState', () => {
  it('replays updates before the current tx only', () => {
    const ups = [
      u('a', 1, { status: 'Approved', approvedHours: 2, approvedBy: 'pm1', approvedOn: 1 }),
      u('cur', 5, { status: 'Submitted', $unset: { approvedHours: '', approvedBy: '', approvedOn: '' } }),
      u('late', 9, { status: 'Rejected' })
    ]
    expect(previousTaskState(create, ups, 'cur')).toEqual({ status: 'Approved', approvedHours: 2, approvedBy: 'pm1', approvedOn: 1 })
  })
  it('keeps the latest of two approvals', () => {
    const ups = [
      u('a', 1, { status: 'Approved', approvedHours: 2, approvedBy: 'pm1', approvedOn: 1 }),
      u('b', 3, { approvedHours: 1.5, approvedBy: 'pm2', approvedOn: 3 }),
      u('cur', 5, { status: 'Submitted' })
    ]
    expect(previousTaskState(create, ups, 'cur')).toMatchObject({ status: 'Approved', approvedHours: 1.5, approvedBy: 'pm2' })
  })
  it('treats null and $unset as removed and is order-safe', () => {
    const ups = [
      u('b', 3, { status: 'Rejected', rejectReason: 'fix', approvedHours: null, $unset: { approvedBy: '' } }),
      u('a', 1, { status: 'Approved', approvedHours: 2, approvedBy: 'pm1' }),
      u('cur', 5, { status: 'Submitted' })
    ]
    expect(previousTaskState(create, ups, 'cur')).toEqual({ status: 'Rejected', rejectReason: 'fix' })
  })
  it('replays a System restore that is the last write before the current tx', () => {
    // client Rejected (stored), then the guard's stored System restore back to Submitted
    const ups = [
      u('a', 1, { status: 'Rejected', rejectReason: 'forged' }),
      u('sys', 2, { status: 'Submitted', $unset: { approvedHours: '', approvedBy: '', approvedOn: '', rejectReason: '' } }),
      u('cur', 5, { status: 'Approved' })
    ]
    expect(previousTaskState(create, ups, 'cur')).toEqual({ status: 'Submitted' })
  })
  it('replays a System drift reopen (null approval fields) that is the last write', () => {
    const ups = [
      u('a', 1, { status: 'Approved', approvedHours: 2, approvedBy: 'pm1', approvedOn: 1 }),
      u('reopen', 3, { status: 'Submitted', submittedHours: 3, approvedHours: null, approvedBy: null, approvedOn: null, rejectReason: null }),
      u('cur', 5, { status: 'Approved', approvedHours: 3 })
    ]
    expect(previousTaskState(create, ups, 'cur')).toEqual({ status: 'Submitted' })
  })
  it('starts from the create attributes', () => {
    expect(previousTaskState(create, [u('cur', 1, { status: 'Approved' })], 'cur')).toEqual({ status: 'Submitted' })
  })
})

describe('isRecall', () => {
  it('is a recall when going back to Submitted from Approved or Rejected', () => {
    expect(isRecall('Submitted', { status: 'Approved' })).toBe(true)
    expect(isRecall('Submitted', { status: 'Rejected' })).toBe(true)
    expect(isRecall('Submitted', { status: 'Submitted' })).toBe(false)
    expect(isRecall('Approved', { status: 'Approved' })).toBe(false)
    expect(isRecall('Rejected', { status: 'Approved' })).toBe(false)
    expect(isRecall('Approved', { status: 'Rejected' })).toBe(false)
  })
  it('treats Draft over an Approved or Rejected task as a recall', () => {
    expect(isRecall('Draft', { status: 'Approved' })).toBe(true)
    expect(isRecall('Draft', { status: 'Rejected' })).toBe(true)
  })
  it('leaves the employee flows unguarded', () => {
    expect(isRecall('Draft', { status: 'Submitted' })).toBe(false)
    expect(isRecall('Submitted', { status: 'Draft' })).toBe(false)
    expect(isRecall(undefined, { status: 'Approved' })).toBe(false)
  })
})

describe('restoreOps', () => {
  it('sets present fields and unsets absent approval fields', () => {
    expect(restoreOps({ status: 'Approved', approvedHours: 2, approvedBy: 'pm', approvedOn: 1 }))
      .toEqual([{ status: 'Approved', approvedHours: 2, approvedBy: 'pm', approvedOn: 1 }, { $unset: { rejectReason: '' } }])
    expect(restoreOps({ status: 'Submitted' }))
      .toEqual([{ status: 'Submitted' }, { $unset: { approvedHours: '', approvedBy: '', approvedOn: '', rejectReason: '' } }])
  })
  it('emits no $unset update when every approval field is present', () => {
    expect(restoreOps({ status: 'Rejected', approvedHours: 1, approvedBy: 'pm', approvedOn: 1, rejectReason: 'r' }))
      .toEqual([{ status: 'Rejected', approvedHours: 1, approvedBy: 'pm', approvedOn: 1, rejectReason: 'r' }])
  })
  it('never mixes plain fields and operators in one update (the adapter drops a mixed $unset)', () => {
    for (const prev of [{}, { status: 'Approved', approvedHours: 2 }, { status: 'Rejected', rejectReason: 'x' }]) {
      for (const ops of restoreOps(prev)) {
        const keys = Object.keys(ops)
        expect(keys.every((k) => k.startsWith('$')) || keys.every((k) => !k.startsWith('$'))).toBe(true)
      }
    }
  })
  it('a reverted forged Reject over an Approved task removes rejectReason', () => {
    const prev = previousTaskState(create, [
      u('a', 1, { status: 'Approved', approvedHours: 2, approvedBy: 'pm1', approvedOn: 1 }),
      u('cur', 5, { status: 'Rejected', rejectReason: 'forged' })
    ], 'cur')
    expect(restoreOps(prev)[1]).toEqual({ $unset: { rejectReason: '' } })
  })
  it('replay of a split restore yields the restored state', () => {
    const [set, unset] = restoreOps({ status: 'Submitted' })
    const s = previousTaskState(create, [
      u('a', 1, { status: 'Approved', approvedHours: 2, approvedBy: 'pm1', approvedOn: 1 }),
      u('r1', 2, set),
      u('r2', 3, unset),
      u('cur', 9, { status: 'Approved' })
    ], 'cur')
    expect(s).toEqual({ status: 'Submitted' })
  })
  it('falls back to Submitted when no status is known', () => {
    expect(restoreOps({})[0].status).toBe('Submitted')
  })
})

// C1 (final review): two forged writes sent back to back are both stored before the async guard's
// first revert lands. The guard replays with a `trusted` predicate that drops earlier guarded status
// writes whose author fails the authorization check, mirroring index.ts.
describe('previousTaskState with a trusted predicate (C1)', () => {
  const SYSTEM = 'core:account:System'
  const authorized = new Set(['pm1'])
  const trusted: TrustedUpdate = (x, before) => {
    if (x.modifiedBy === SYSTEM) return true
    if (!isGuardedStatusWrite(x.operations?.status, before)) return true
    return authorized.has(x.modifiedBy ?? '')
  }
  const by = (id: string, t: number, who: string, operations: Record<string, any>): { _id: string, modifiedOn: number, modifiedBy: string, operations: Record<string, any> } =>
    ({ _id: id, modifiedOn: t, modifiedBy: who, operations })
  const forgedApprove = { status: 'Approved', approvedHours: 8, approvedBy: 'pmX', approvedOn: 10 }

  it('two forged approves in a row: the second revert restores the pre-forgery state', () => {
    const ups = [by('A', 1, 'owner', forgedApprove), by('B', 2, 'owner', forgedApprove)]
    // Without the predicate the second guard would restore the forged Approved 8h.
    expect(previousTaskState(create, ups, 'B')).toMatchObject({ status: 'Approved', approvedHours: 8 })
    const prevB = previousTaskState(create, ups, 'B', trusted)
    expect(prevB).toEqual({ status: 'Submitted' })
    expect(restoreOps(prevB)[0]).toEqual({ status: 'Submitted' })
    expect(previousTaskState(create, ups, 'A', trusted)).toEqual({ status: 'Submitted' })
  })

  it('forged Rejected then forged Submitted over Approved: ends Approved with the original hours and approver', () => {
    const ups = [
      by('real', 1, 'pm1', { status: 'Approved', approvedHours: 6, approvedBy: 'pm1', approvedOn: 1 }),
      by('A', 2, 'mallory', { status: 'Rejected', rejectReason: 'forged', $unset: { approvedHours: '', approvedBy: '', approvedOn: '' } }),
      by('B', 3, 'mallory', { status: 'Submitted', $unset: { approvedHours: '', approvedBy: '', approvedOn: '', rejectReason: '' } })
    ]
    const expected = { status: 'Approved', approvedHours: 6, approvedBy: 'pm1', approvedOn: 1 }
    expect(previousTaskState(create, ups, 'A', trusted)).toEqual(expected)
    expect(previousTaskState(create, ups, 'B', trusted)).toEqual(expected)
    expect(restoreOps(previousTaskState(create, ups, 'B', trusted))[0]).toEqual(expected)
  })

  it('a real approval followed by two forged recalls stays Approved', () => {
    const recallOps = { status: 'Submitted', $unset: { approvedHours: '', approvedBy: '', approvedOn: '', rejectReason: '' } }
    const ups = [
      by('real', 1, 'pm1', { status: 'Approved', approvedHours: 7, approvedBy: 'pm1', approvedOn: 1 }),
      by('A', 2, 'mallory', recallOps),
      by('B', 3, 'mallory', recallOps)
    ]
    const expected = { status: 'Approved', approvedHours: 7, approvedBy: 'pm1', approvedOn: 1 }
    expect(previousTaskState(create, ups, 'A', trusted)).toEqual(expected)
    expect(previousTaskState(create, ups, 'B', trusted)).toEqual(expected)
  })

  it('keeps System writes, non-status writes and the employee submit flow', () => {
    const ups = [
      by('draft', 1, 'owner', { status: 'Draft' }),
      by('submit', 2, 'owner', { status: 'Submitted', submittedHours: 3 }),
      by('forged', 3, 'owner', forgedApprove),
      by('sys', 4, SYSTEM, { status: 'Submitted' }),
      by('note', 5, 'owner', { approvedHours: 2 }),
      by('cur', 6, 'owner', forgedApprove)
    ]
    expect(previousTaskState(create, ups, 'cur', trusted)).toEqual({ status: 'Submitted', approvedHours: 2 })
  })

  it('judges a recall against the trusted state, not the forged one', () => {
    // A forged Approved is skipped, so the owner's later Submitted is not a recall and stays trusted.
    const ups = [
      by('forged', 1, 'owner', forgedApprove),
      by('back', 2, 'owner', { status: 'Draft' }),
      by('cur', 3, 'owner', forgedApprove)
    ]
    expect(previousTaskState(create, ups, 'cur', trusted)).toEqual({ status: 'Draft' })
  })
})

describe('isGuardedStatusWrite', () => {
  it('guards approve, reject and recalls only', () => {
    expect(isGuardedStatusWrite('Approved', { status: 'Submitted' })).toBe(true)
    expect(isGuardedStatusWrite('Rejected', { status: 'Submitted' })).toBe(true)
    expect(isGuardedStatusWrite('Submitted', { status: 'Approved' })).toBe(true)
    expect(isGuardedStatusWrite('Draft', { status: 'Rejected' })).toBe(true)
    expect(isGuardedStatusWrite('Submitted', { status: 'Draft' })).toBe(false)
    expect(isGuardedStatusWrite('Draft', { status: 'Submitted' })).toBe(false)
    expect(isGuardedStatusWrite(undefined, { status: 'Approved' })).toBe(false)
  })
})

// N1/N2 (re-review): a past author's admin role comes from a live session or the account service,
// never from the Approvals space `owners` list (empty by default, and client-poisonable).
describe('authorAuthorizer (N1/N2)', () => {
  const SYSTEM = 'core:account:System'
  // social id -> employee/account; 'adm' is a Maintainer who is neither PM nor HR and is offline;
  // 'col' is a plain User who sits in the Approvals `owners` list (irrelevant now).
  const people: Record<string, { employee: string, account: string }> = {
    'sid-adm': { employee: 'emp-adm', account: 'acc-adm' },
    'sid-col': { employee: 'emp-col', account: 'acc-col' },
    'sid-owner': { employee: 'emp-owner', account: 'acc-owner' },
    'sid-cur': { employee: 'emp-cur', account: 'acc-cur' }
  }
  const roles: Record<string, string> = { 'acc-adm': 'MAINTAINER', 'acc-col': 'USER', 'acc-cur': 'USER' }
  const order: Record<string, number> = { USER: 30, MAINTAINER: 40, OWNER: 50 }
  const deps = (over: Partial<AuthorDeps> = {}): AuthorDeps & { roleCalls: number, warnings: string[] } => {
    const d: any = {
      roleCalls: 0,
      warnings: [] as string[],
      resolve: async (m: string) => people[m] ?? {},
      isCurrent: (m: string) => m === 'sid-cur',
      currentIsAdmin: false,
      liveRole: () => undefined,
      isAdminRole: (r: string) => (order[r] ?? 0) >= order.MAINTAINER,
      isHr: async () => false,
      canAct: (actor: string | undefined, isAdmin: boolean, isHr: boolean) =>
        actor !== undefined && actor !== 'emp-owner' && (isAdmin || isHr || actor === 'emp-pm'),
      ...over
    }
    d.workspaceRole = over.workspaceRole ?? (async (a: string) => { d.roleCalls++; return roles[a] })
    d.warn = (m: string) => { d.warnings.push(m) }
    return d
  }
  const by = (id: string, t: number, who: string, operations: Record<string, any>): UpdateLike => ({ _id: id, modifiedOn: t, modifiedBy: who, operations })
  const replayTrust = async (ups: UpdateLike[], cur: string, ok: (m: string) => Promise<boolean>): Promise<TrustedUpdate> => {
    const verdict = new Map<string, boolean>()
    for (const x of ups) {
      if (x._id === cur || x.modifiedBy === SYSTEM || typeof x.operations?.status !== 'string') continue
      if (!verdict.has(x.modifiedBy ?? '')) verdict.set(x.modifiedBy ?? '', await ok(x.modifiedBy ?? ''))
    }
    return (x, before) => x.modifiedBy === SYSTEM || !isGuardedStatusWrite(x.operations?.status, before) || verdict.get(x.modifiedBy ?? '') === true
  }
  const recallOps = { status: 'Submitted', $unset: { approvedHours: '', approvedBy: '', approvedOn: '', rejectReason: '' } }

  it("an offline admin's approval survives a forged recall (restores Approved with the admin's hours)", async () => {
    const d = deps()
    const ups = [
      by('adm', 1, 'sid-adm', { status: 'Approved', approvedHours: 5.5, approvedBy: 'emp-adm', approvedOn: 1 }),
      by('cur', 2, 'sid-cur', recallOps)
    ]
    const prev = previousTaskState(create, ups, 'cur', await replayTrust(ups, 'cur', authorAuthorizer(d)))
    expect(prev).toEqual({ status: 'Approved', approvedHours: 5.5, approvedBy: 'emp-adm', approvedOn: 1 })
    expect(d.roleCalls).toBe(1)
  })

  it("an owners-listed non-admin's forged approval is not trusted", async () => {
    const d = deps()
    const ups = [
      by('col', 1, 'sid-col', { status: 'Approved', approvedHours: 9, approvedBy: 'emp-pm', approvedOn: 1 }),
      by('cur', 2, 'sid-cur', { status: 'Approved', approvedHours: 9, approvedBy: 'emp-pm', approvedOn: 2 })
    ]
    const prev = previousTaskState(create, ups, 'cur', await replayTrust(ups, 'cur', authorAuthorizer(d)))
    expect(prev).toEqual({ status: 'Submitted' })
  })

  it('a failed role lookup fails closed and warns', async () => {
    const d = deps({ workspaceRole: async () => { throw new Error('account service down') } })
    expect(await authorAuthorizer(d)('sid-adm')).toBe(false)
    expect(d.warnings).toHaveLength(1)
  })

  it('prefers a live session role and skips the lookup when approver/HR already decide', async () => {
    const live = deps({ liveRole: (m) => (m === 'sid-col' ? 'MAINTAINER' : undefined) })
    expect(await authorAuthorizer(live)('sid-col')).toBe(true)
    expect(live.roleCalls).toBe(0)
    const hr = deps({ isHr: async (a) => a === 'acc-col' })
    expect(await authorAuthorizer(hr)('sid-col')).toBe(true)
    expect(hr.roleCalls).toBe(0)
    // The owner never passes, admin or not, and no lookup is spent on them.
    const own = deps()
    expect(await authorAuthorizer(own)('sid-owner')).toBe(false)
    expect(own.roleCalls).toBe(0)
  })

  it('caches verdicts per author', async () => {
    const d = deps()
    const ok = authorAuthorizer(d)
    await ok('sid-adm')
    await ok('sid-adm')
    expect(d.roleCalls).toBe(1)
  })
})
