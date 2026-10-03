//
// YoungGlobes: pure helpers for OnTimesheetTaskUpdate. The trigger runs after the task is already
// updated, so the PREVIOUS state comes from the tx log (create + earlier updates), the same idiom
// as attendance-guard.ts. No platform deps: unit-testable.
//
export interface TaskState {
  status?: string
  approvedHours?: number
  approvedBy?: string
  approvedOn?: number
  rejectReason?: string
}

const FIELDS = ['status', 'approvedHours', 'approvedBy', 'approvedOn', 'rejectReason'] as const
type Field = (typeof FIELDS)[number]

export interface UpdateLike {
  _id: string
  modifiedOn: number
  modifiedBy?: string
  operations?: Record<string, any>
}

/**
 * Decides whether an earlier update may count in the replay. `stateBefore` is the state replayed so
 * far (untrusted updates already skipped), so a caller can tell whether the update was a recall.
 */
export type TrustedUpdate = (update: UpdateLike, stateBefore: TaskState) => boolean

const before = (a: UpdateLike, b: UpdateLike): boolean =>
  a.modifiedOn < b.modifiedOn || (a.modifiedOn === b.modifiedOn && a._id < b._id)

const snapshot = (s: Record<string, any>): TaskState => {
  const out: Record<string, any> = {}
  for (const f of FIELDS) if (s[f] !== undefined) out[f] = s[f]
  return out as TaskState
}

/**
 * The task's status and approval fields just before tx `currentTxId`.
 *
 * `trusted` (optional) filters the replay: an update it rejects is skipped entirely, as if it was
 * never written. The guard uses it on the denied path so an earlier forged status write that the
 * (async) guard has not reverted yet cannot become the "previous state" a later revert restores.
 */
export function previousTaskState (
  create: { attributes?: Record<string, any> } | undefined,
  updates: UpdateLike[],
  currentTxId: string,
  trusted?: TrustedUpdate
): TaskState {
  const s: Record<string, any> = {}
  for (const f of FIELDS) {
    const v = create?.attributes?.[f]
    if (v !== undefined && v !== null) s[f] = v
  }
  const current = updates.find((x) => x._id === currentTxId)
  const ordered = updates
    .filter((x) => x._id !== currentTxId && (current === undefined || before(x, current)))
    .sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0))
  for (const x of ordered) {
    if (trusted !== undefined && !trusted(x, snapshot(s))) continue
    const ops = x.operations ?? {}
    for (const f of FIELDS) {
      if (Object.prototype.hasOwnProperty.call(ops, f)) {
        const v = ops[f]
        s[f] = v === null ? undefined : v
      }
      if (ops.$unset !== undefined && Object.prototype.hasOwnProperty.call(ops.$unset, f)) s[f] = undefined
    }
  }
  // Removed fields are dropped, not kept as `undefined` keys.
  return snapshot(s)
}

/**
 * A recall: any status other than Approved/Rejected written over a task that WAS Approved or
 * Rejected (back to Submitted, or straight to Draft). Approved <-> Rejected and re-approval are
 * approve/reject writes, guarded as such. Submitted -> Draft and Draft -> Submitted are not recalls.
 */
export function isRecall (statusOp: unknown, prev: TaskState): boolean {
  if (typeof statusOp !== 'string' || statusOp === 'Approved' || statusOp === 'Rejected') return false
  return prev.status === 'Approved' || prev.status === 'Rejected'
}

/**
 * A write the guard checks: a status of Approved or Rejected, or a recall (see isRecall) against
 * `prev`. Everything else (submit, Submitted -> Draft, non-status writes) is the employee's own flow.
 */
export function isGuardedStatusWrite (statusOp: unknown, prev: TaskState): boolean {
  if (typeof statusOp !== 'string') return false
  return statusOp === 'Approved' || statusOp === 'Rejected' || isRecall(statusOp, prev)
}

/**
 * Update ops that put the task back to `prev`: present fields set, absent approval fields unset.
 * Returned as SEPARATE updates (plain set first, then a `$unset`-only one), never one mixed object:
 * the postgres adapter applies `$unset` only when every key of the update is an operator
 * (isOperator), so a mixed `{ status, $unset }` changed status and silently kept the stale
 * approvedHours/approvedBy/rejectReason in the row. Apply each as its own tx, in order.
 */
export function restoreOps (prev: TaskState): Array<Record<string, any>> {
  const set: Record<string, any> = { status: prev.status ?? 'Submitted' }
  const unset: Record<string, string> = {}
  for (const f of FIELDS) {
    if (f === 'status') continue
    const v = prev[f as Field]
    if (v !== undefined) set[f] = v
    else unset[f] = ''
  }
  return Object.keys(unset).length > 0 ? [set, { $unset: unset }] : [set]
}

/**
 * Everything authorAuthorizer needs from the platform, injected so this file stays platform-free.
 * Roles are opaque strings here (AccountRole values); `isAdminRole` decides Maintainer+.
 */
export interface AuthorDeps {
  /** The author's employee ref and account uuid (either may be unresolved). */
  resolve: (modifiedBy: string) => Promise<{ employee?: string, account?: string }>
  /** Is `modifiedBy` a social id of the account whose write is being judged now? */
  isCurrent: (modifiedBy: string) => boolean
  /** That current account's role decision (from its own session). */
  currentIsAdmin: boolean
  /** Role of a live session for this social id, if one is connected. */
  liveRole: (modifiedBy: string) => string | undefined
  /** Workspace role of an account from the account service. May throw; undefined = not a member. */
  workspaceRole: (account: string) => Promise<string | undefined>
  isAdminRole: (role: string) => boolean
  isHr: (account: string | undefined) => Promise<boolean>
  /** canActOnTimesheetTask for this task (owner and project approvers bound by the caller). */
  canAct: (actor: string | undefined, isAdmin: boolean, isHr: boolean) => boolean
  warn: (message: string, data: Record<string, any>) => void
}

/**
 * Would the author of an EARLIER task update pass the guard today (CURRENT roles)? Approver and HR
 * are checked first, so the admin role is only looked up when it can change the answer. Admin:
 * the current session's role for the current account, else a live session's role, else the
 * account service. A failed lookup fails closed (not admin) with a warning. Verdicts are cached per
 * author for the life of the returned function.
 */
export function authorAuthorizer (deps: AuthorDeps): (modifiedBy: string) => Promise<boolean> {
  const cache = new Map<string, boolean>()
  return async (modifiedBy) => {
    const hit = cache.get(modifiedBy)
    if (hit !== undefined) return hit
    const { employee, account } = await deps.resolve(modifiedBy)
    const hr = await deps.isHr(account)
    let ok: boolean
    if (deps.canAct(employee, false, hr)) ok = true
    else if (!deps.canAct(employee, true, hr)) ok = false // owner or unresolved: admin cannot help
    else {
      let isAdmin = false
      if (deps.isCurrent(modifiedBy)) isAdmin = deps.currentIsAdmin
      else {
        const live = deps.liveRole(modifiedBy)
        if (live !== undefined) isAdmin = deps.isAdminRole(live)
        else if (account === undefined) {
          deps.warn('yg-timesheet: past author has no account; treated as not admin', { modifiedBy })
        } else {
          try {
            const role = await deps.workspaceRole(account)
            isAdmin = role !== undefined && deps.isAdminRole(role)
          } catch (err: any) {
            deps.warn('yg-timesheet: workspace role lookup failed; past author treated as not admin', {
              modifiedBy, account, err: String(err?.message ?? err)
            })
          }
        }
      }
      ok = deps.canAct(employee, isAdmin, hr)
    }
    cache.set(modifiedBy, ok)
    return ok
  }
}
