//
// YoungGlobes: server-yg-timesheet-resources — real workflow enforcement trigger (Phase 1b Task 4).
//
// OnTimesheetDayUpdate enforces authorization on the TimesheetDay state machine.
//
// Proven constraints (Task 1 spike):
//  - The trigger MUST be async (a sync trigger doing control.findAll deadlocks the tx).
//  - Triggers see POST-APPLY state: control.findAll returns the doc already carrying the
//    update's new values — you cannot read the "from" state. So we enforce on the new
//    state + who acted (getEmployee(control, tx.modifiedBy)).
//  - Compensating reverts / authoritative stamps are emitted via control.apply (not by
//    returning them); the trigger returns [].
//
// Division of labour: the client computes and SENDS approvers (on submit) and
// snapshot + totalHours (on approve). This server trigger does NOT recompute them — it
// only (a) validates authorization and reverts violations and (b) stamps approvedBy /
// approvedOn authoritatively on approve and clears them on reopen. The checks are inline
// ref comparisons (the resources package's pure functions are NOT imported server-side).
//
// Loop-safety: control.apply'd txes re-enter this async trigger. Every compensating write
// is attributed to the System account (createTxUpdateDoc's modifiedBy override), and the
// top-of-loop guard skips System-authored txes — so the trigger's own writes never
// re-enter and re-revert, regardless of the revert target.
//
import core, {
  AccountRole,
  hasAccountRole,
  type AccountUuid,
  type Data,
  type Doc,
  type PersonId,
  type Ref,
  type Space,
  type Tx,
  type TxCreateDoc,
  type TxCUD,
  type TxMixin,
  type TxUpdateDoc,
  TxProcessor
} from '@hcengineering/core'
import contact, { type Employee, formatName } from '@hcengineering/contact'
import { type TriggerControl } from '@hcengineering/server-core'
import { getEmployee, getSocialIdsByAccounts } from '@hcengineering/server-contact'
import notification, { type CommonInboxNotification } from '@hcengineering/notification'
import { type SenderInfo } from '@hcengineering/server-notification'
import {
  getCommonNotificationTxes,
  getReceiversInfo,
  getSenderInfo,
  type NotifyResult
} from '@hcengineering/server-notification-resources'
import { jsonToMarkup, nodeDoc, nodeParagraph, nodeText } from '@hcengineering/text-core'
import ygTimesheet, {
  type DayStatus,
  type HrTimeEntry,
  type LatePermission,
  type ProjectApprovers,
  type Timesheet,
  type TimesheetDay,
  type TimesheetTask
} from '@hcengineering/yg-timesheet'
import tracker, { type Issue, type Project, type TimeSpendReport } from '@hcengineering/tracker'
import task from '@hcengineering/task'
import workbench, { type Application, type HiddenApplication } from '@hcengineering/workbench'
import { estimateRequiredToActivate } from './estimate-gate'
import { inDayWindow, roundedHoursDiffer, sumHoursInDayWindow } from './approval-drift'

// ---------------------------------------------------------------------------
// Inbox notifications (2026-07-25). The approval workflow now pushes Huly inbox
// notifications: the PM/TL approvers on submit, and the employee on approve/reject.
// These are operational, must-deliver notifications, so we DELIBERATELY bypass the
// per-user NotificationType/provider settings (no NotificationType is declared in the
// model): we hand-build a NotifyResult naming only the Inbox provider, so delivery is
// deterministic and cannot be silently muted. Rendering uses the proven
// CommonInboxNotification header + messageHtml path (identical to server-time-resources'
// OnToDoCreate). Every notification is attached to a real Issue so the Inbox row renders
// and its header chip clicks through.
// ---------------------------------------------------------------------------

/** Resolve an Employee ref to a display name for notification copy (best-effort). */
async function displayName (control: TriggerControl, emp: Ref<Employee> | undefined): Promise<string> {
  if (emp == null) return 'Someone'
  const person = (
    await control.findAll(control.ctx, contact.class.Person, { _id: emp }, { limit: 1 })
  )[0]
  return person !== undefined ? formatName(person.name) : 'Someone'
}

/**
 * Push one CommonInboxNotification (a "Timesheet approval" header + a one-line body) to each
 * target employee, attached to `issueRef` (used for the Inbox DocNotifyContext + the clickable
 * header chip). Targets that are not active employees (no PersonSpace / social id) are silently
 * dropped by getReceiversInfo. The notification is created with a hand-built NotifyResult (Inbox
 * provider only) so it always delivers, regardless of the recipient's notification settings.
 *
 * We do NOT notify the tx author: submit excludes the employee from `approvers` (buildTaskUnits),
 * and approve/reject already forbid self-approval, so `targets` never contains the actor.
 */
async function notifyInbox (
  control: TriggerControl,
  tx: Tx,
  targets: Ref<Employee>[],
  obj: Doc,
  message: string
): Promise<void> {
  const uniqueTargets = [...new Set(targets)].filter((t) => t != null)
  if (uniqueTargets.length === 0) return

  const employees = await control.findAll(
    control.ctx, contact.mixin.Employee, { _id: { $in: uniqueTargets } }
  )
  const accounts = employees.map((e) => e.personUuid).filter((a): a is AccountUuid => a != null)
  if (accounts.length === 0) return

  const receivers = await getReceiversInfo(control.ctx, accounts, control)
  if (receivers.length === 0) return

  // `obj` is the DocNotifyContext object the notification attaches to — a TimesheetDay (submit) or
  // TimesheetTask (approve/reject). Its class drives the Inbox click-through: NotificationRedirect
  // is registered as the ObjectPanel for both, sending a submit notification to Approvals and an
  // approve/reject notification to My Timesheet (see models/yg-timesheet + NotificationRedirect.svelte).
  const sender: SenderInfo = await getSenderInfo(control.ctx, tx.modifiedBy, control)
  const notifyResult: NotifyResult = new Map([[notification.providers.InboxNotificationProvider, []]])
  const messageHtml = jsonToMarkup(nodeDoc(nodeParagraph(nodeText(message))))

  const allTxes: Tx[] = []
  const broadcastTo: AccountUuid[] = []
  for (const receiver of receivers) {
    const data: Partial<Data<CommonInboxNotification>> = {
      header: ygTimesheet.string.ApprovalNotification,
      messageHtml
    }
    const txes = await getCommonNotificationTxes(
      control.ctx,
      control,
      obj,
      data,
      receiver,
      sender,
      obj._id,
      obj._class,
      obj.space,
      tx.modifiedOn,
      notifyResult,
      notification.class.CommonInboxNotification,
      tx as TxCUD<Doc>
    )
    if (txes.length > 0) {
      allTxes.push(...txes)
      broadcastTo.push(receiver.account)
    }
  }

  if (allTxes.length === 0) return
  await control.apply(control.ctx, allTxes)

  // Live-update each receiver's Inbox (same idiom as server-time-resources' OnToDoCreate).
  const ids = new Set(allTxes.map((it) => it._id))
  control.ctx.contextData.broadcast.targets.notifications = async (it) =>
    ids.has(it._id) ? { target: broadcastTo } : undefined
}

//
// Submit -> notify approvers. Fires on the day-level update that submitDay writes AFTER creating
// the TimesheetTask rows (approvers/submittedOn/totalHours). A submit sets `submittedOn` to a
// positive timestamp; a recall $unsets it (absent from operations); approve/reject act on
// TimesheetTask, never the day — so a set `submittedOn` here uniquely identifies a fresh submit.
// One notification per approver per submit (user decision 2026-07-25), attached to the day's
// lowest-identifier issue for a stable, navigable header chip.
//
// This is intentionally SEPARATE from OnTimesheetDayUpdate (the authorization trigger): submit is
// not an authorization event, so notification never touches the security-critical logic.
//
export async function OnTimesheetDaySubmitNotify (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx.modifiedBy === core.account.System) continue
    if (tx._class !== core.class.TxUpdateDoc) continue
    const utx = tx as TxUpdateDoc<TimesheetDay>
    if (utx.objectClass !== ygTimesheet.class.TimesheetDay) continue

    const ops = utx.operations as Partial<TimesheetDay>
    if (ops.submittedOn == null) continue

    const day = (
      await control.findAll(control.ctx, ygTimesheet.class.TimesheetDay, { _id: utx.objectId }, { limit: 1 })
    )[0]
    if (day === undefined) continue

    const approvers = day.approvers ?? []
    if (approvers.length === 0) continue

    const tasks = await control.findAll(
      control.ctx, ygTimesheet.class.TimesheetTask, { attachedTo: day._id, status: 'Submitted' }
    )
    if (tasks.length === 0) continue

    const sheet = (
      await control.findAll(control.ctx, ygTimesheet.class.Timesheet, { _id: day.attachedTo as Ref<Timesheet> }, { limit: 1 })
    )[0]
    const who = await displayName(control, sheet?.employee)
    const issueWord = tasks.length === 1 ? 'issue' : 'issues'
    const message = `${who} submitted a timesheet for approval (${day.totalHours}h, ${tasks.length} ${issueWord})`

    // Attach to the TimesheetDay so the Inbox click lands on Approvals (via NotificationRedirect).
    await notifyInbox(control, tx, approvers, day, message)
  }
  return []
}

export async function OnTimesheetDayUpdate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    // Idempotence guard: our own compensating reverts / authoritative stamps are written
    // as the System account. Skip them so they never re-enter and re-revert.
    if (tx.modifiedBy === core.account.System) continue

    const utx = tx as TxUpdateDoc<TimesheetDay>
    if (utx.objectClass !== ygTimesheet.class.TimesheetDay) continue

    const day = (
      await control.findAll(control.ctx, ygTimesheet.class.TimesheetDay, { _id: utx.objectId }, { limit: 1 })
    )[0]
    if (day === undefined) continue

    // Parent Timesheet.employee is the day's owner (the person the timesheet belongs to).
    const parent = (
      await control.findAll(control.ctx, ygTimesheet.class.Timesheet, { _id: day.attachedTo as Ref<Timesheet> }, { limit: 1 })
    )[0]
    const owner: Ref<Employee> | undefined = parent?.employee

    // Map the acting social-id -> Ref<Employee> (undefined for the System account / unknown actor).
    const actor: Employee | undefined = await getEmployee(control, utx.modifiedBy)
    const actorRef: Ref<Employee> | undefined = actor?._id

    // Admin break-glass: workspace Owner/Maintainer. contextData.account is the acting
    // session's account in the async trigger context (see contact-resources for the idiom).
    const isAdmin = hasAccountRole(control.ctx.contextData.account, AccountRole.Maintainer)

    const next = (utx.operations as Partial<TimesheetDay>).status as DayStatus | undefined

    // Compensating write — attributed to System (7th arg modifiedBy) so it doesn't re-trigger.
    const apply = async (ops: Partial<TimesheetDay>): Promise<void> => {
      const t = control.txFactory.createTxUpdateDoc(
        utx.objectClass,
        utx.objectSpace,
        utx.objectId,
        ops as any,
        undefined,
        undefined,
        core.account.System
      )
      await control.apply(control.ctx, [t])
    }

    // Rule A: approve / reject authorization + no-self-approve.
    if (next === 'Approved' || next === 'Rejected') {
      if (actorRef !== undefined && owner !== undefined && actorRef === owner) {
        // Self-approve/-reject — forbidden even for admin. Revert to Submitted, clear stamps.
        await apply({ status: 'Submitted', approvedBy: null, approvedOn: null, rejectReason: null } as any)
        continue
      }
      const isApprover = actorRef !== undefined && (day.approvers ?? []).includes(actorRef)
      if (!isAdmin && !isApprover) {
        // Actor is not an approver of this day. Revert to Submitted, clear stamps.
        await apply({ status: 'Submitted', approvedBy: null, approvedOn: null, rejectReason: null } as any)
        continue
      }
      // Authorized. On approve, stamp approvedBy/approvedOn authoritatively. Reject needs no
      // stamp (the client set rejectReason).
      if (next === 'Approved') {
        await apply({ approvedBy: actorRef ?? null, approvedOn: Date.now() } as any)
      }
      continue
    }

    // Rule B: reopen / recall authorization.
    if (next === 'Draft') {
      if (day.approvedBy != null) {
        // Day had been approved -> this is a REOPEN. Allow only the original approver or admin.
        const allowed = isAdmin || (actorRef !== undefined && actorRef === day.approvedBy)
        if (!allowed) {
          await apply({ status: 'Approved' } as any)
          continue
        }
        // Allowed reopen: clear approval stamps.
        await apply({ approvedBy: null, approvedOn: null } as any)
      } else {
        // Day was Submitted (not yet approved) -> this is a RECALL by the employee.
        const allowed = isAdmin || (actorRef !== undefined && owner !== undefined && actorRef === owner)
        if (!allowed) {
          await apply({ status: 'Submitted' } as any)
        }
      }
      continue
    }

    // Rule C: protect an approved day from other (non-status) edits. Defense-in-depth only.
    if (next === undefined && day.status === 'Approved') {
      if (!isAdmin && (actorRef === undefined || actorRef !== day.approvedBy)) {
        // We see post-apply state and cannot restore arbitrary prior field values, so we log
        // rather than revert unknown fields. Our UI gates edits to an approved day, so this
        // path is not expected in normal operation. (Rules A and B are the load-bearing ones.)
        control.ctx.warn('yg-timesheet: unauthorized non-status edit of approved TimesheetDay', {
          day: day._id,
          actor: actorRef,
          approvedBy: day.approvedBy
        })
      }
      continue
    }
  }
  return []
}

//
// Per-task approval authorization — REVISION 2 (Task 3 of the revised plan, 2026-07-2x).
//
// History (why this trigger looks nothing like its predecessor): an earlier version tried to
// authorize using data the client could write — the task's own `approvers` array — and tried to
// guard the payroll fields (approvedHours/approvedBy/approvedOn) by enumerating every dangerous
// field/operator. THREE rounds of adversarial security review each found a new bypass ($inc
// slipping past a naked-equality check, a status-downgrade slipping past the "only guard on
// status change" scope...). That whole approach is abandoned here — this rewrite removes the
// bypass CLASS instead of chasing individual bypasses:
//
//  - Authorization is a ROLE check, derived server-side from the ProjectApprovers mixin on every
//    project (pm + teamLead) — see `approverRoleSet` below. There is nothing left on the task
//    document that can poison this decision; `task.approvers` is NEVER read for authorization —
//    it is client-writable NOTIFICATION ROUTING only (who gets pinged), not a permission list.
//  - The payroll fields no longer live on TimesheetTask at all (Task 2, 2026-07-23): they moved to
//    `TimesheetApproval` docs in the PRIVATE space `ygTimesheet.space.Approvals`. A non-member's
//    read or write to that space is refused STRUCTURALLY by the server (space membership), not by
//    this trigger — so there is no longer a dangerous-field list to enumerate here at all.
//  - Business rule: ANY employee assigned as PM or Team Lead on ANY project may approve/reject ANY
//    task (a lead covering for an absent one is the motivating case) — what matters is ATTRIBUTION
//    (who acted), not prevention. Self-approval is forbidden for EVERYONE, including admins — and
//    if the timesheet owner can't be resolved, we fail closed (deny), never allow.
//
// Loop-safety: the only compensating write this trigger issues is a status-revert, attributed to
// core.account.System (txFactory's 7th-arg modifiedBy override). The top-of-loop guard skips
// System-authored txes, so that revert can never re-enter and re-revert itself.
//
async function approverRoleSet (control: TriggerControl): Promise<Set<Ref<Employee>>> {
  const projects = await control.findAll(control.ctx, tracker.class.Project, {})
  const set = new Set<Ref<Employee>>()
  for (const p of projects) {
    const pa = control.hierarchy.as(p, ygTimesheet.mixin.ProjectApprovers)
    if (pa.pm != null) set.add(pa.pm)
    if (pa.teamLead != null) set.add(pa.teamLead)
  }
  return set
}

// MINOR F: approverRoleSet scans every project. Callers that need it inside a per-tx (or
// per-task) loop should compute it at most once per trigger invocation via a small lazy cache
// like this, rather than re-scanning on every iteration.
function lazyApproverRoleSet (control: TriggerControl): () => Promise<Set<Ref<Employee>>> {
  let cached: Set<Ref<Employee>> | undefined
  return async () => {
    if (cached === undefined) cached = await approverRoleSet(control)
    return cached
  }
}

// IMPORTANT E: the Approvals space's server-derived membership = every PM/TeamLead (given as
// `roles`, already resolved by the caller — see lazyApproverRoleSet) UNIONED WITH `ownersAllowlist`
// (the space's own `owners` field). `owners` is the admin/break-glass signal: an Owner self-adds to
// BOTH `members` and `owners` (the same idiom as ensureHrMembership for HrData — see
// plugins/yg-timesheet-resources/src/utils/hrMembership.ts). There is no generic "every account's
// workspace role" query on TriggerControl, so `owners` is the only queryable admin signal available
// here — which is exactly why OnApprovalsMembershipGuard (Critical A) protects `owners` from
// untrusted writes before any caller trusts it in this union.
async function deriveApprovalsMembers (
  control: TriggerControl,
  roles: Set<Ref<Employee>>,
  ownersAllowlist: readonly AccountUuid[]
): Promise<Set<AccountUuid>> {
  const wanted = new Set<AccountUuid>(ownersAllowlist)
  for (const ref of roles) {
    const emp = (await control.findAll(control.ctx, contact.mixin.Employee, { _id: ref }, { limit: 1 }))[0]
    if (emp?.personUuid != null) wanted.add(emp.personUuid)
  }
  return wanted
}

//
// ############################################################################################
// ⚠️  KNOWN SECURITY GAP — OPEN, ACCEPTED FOR BETA ONLY (user decision 2026-07-23)
//     DO NOT USE THIS FEATURE WITH REAL PAYROLL DATA UNTIL FIXED.
//
//     Any workspace member can FORGE an approval with arbitrary hours, without a PM/TL role and
//     without joining the private space:
//         createDoc(TimesheetApproval, space.Approvals, { task, approvedHours: 999, approvedBy: X })
//
//     Why this trigger does not stop it: the design assumed a PRIVATE space refuses non-member
//     writes. It does not. foundations/server/packages/middleware/src/spaceSecurity.ts has ZERO
//     `throw` statements — it maintains read filters and indexes only, and never rejects a tx.
//     PRIVATE = READ-BLOCKED, NOT WRITE-BLOCKED. (Read-privacy does NOT robustly hold either —
//     CORRECTED 2026-07-24 after the final whole-branch review; the earlier "forgery not exposure"
//     note was WRONG. A member can self-promote into the Approvals space MEMBERSHIP — via
//     updateDoc carrying the ProjectApprovers mixin attrs, or a TxMixin whose guard-revert is a
//     System tx that OnProjectApproversChange skips so membership never re-syncs down — and
//     membership grants READ of everyone's approvedHours. So the gap is forgery AND read-exposure.)
//
//     AGREED FIX (not implemented): clients must NEVER write TimesheetApproval. The approver's
//     hours ride on the role-guarded task tx; the SERVER alone materialises/updates/deletes the
//     approval row; any client-authored tx on that class is reverted unconditionally
//     (deny-by-default — no field/operator enumeration to keep current).
//
//     Full analysis + 5-round review history:
//       docs/superpowers/specs/2026-07-22-per-task-timesheet-approval-design.md (final section)
// ############################################################################################
//
export async function OnTimesheetTaskUpdate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const getApproverSet = lazyApproverRoleSet(control)

  for (const tx of txes) {
    // Loop-safety: our own compensating writes below (task status revert, TimesheetApproval row
    // removal on revert, TimesheetApproval attribution stamp on authorized approve) are ALL
    // System-attributed — skip System-authored txes so none of them can re-enter and re-fire.
    if (tx.modifiedBy === core.account.System) continue
    if (tx._class !== core.class.TxUpdateDoc) continue

    const utx = tx as TxUpdateDoc<TimesheetTask>
    if (utx.objectClass !== ygTimesheet.class.TimesheetTask) continue

    const statusOp = (utx.operations as Partial<TimesheetTask>).status
    if (statusOp !== 'Approved' && statusOp !== 'Rejected') continue

    const task = (
      await control.findAll(control.ctx, ygTimesheet.class.TimesheetTask, { _id: utx.objectId }, { limit: 1 })
    )[0]
    if (task === undefined) continue

    // Timesheet owner = the employee this task's day belongs to (task -> day -> timesheet). This
    // is the "self" in the self-approval bar — never the task's own (client-writable) approvers.
    const day = (
      await control.findAll(control.ctx, ygTimesheet.class.TimesheetDay, { _id: task.attachedTo as Ref<TimesheetDay> }, { limit: 1 })
    )[0]
    const sheet = day === undefined
      ? undefined
      : (await control.findAll(control.ctx, ygTimesheet.class.Timesheet, { _id: day.attachedTo as Ref<Timesheet> }, { limit: 1 }))[0]
    const owner: Ref<Employee> | undefined = sheet?.employee

    const actor = await getEmployee(control, utx.modifiedBy)
    const actorId: Ref<Employee> | undefined = actor?._id

    // Admin break-glass: workspace Owner/Maintainer. Still subject to the self-approval bar below.
    const isAdmin = hasAccountRole(control.ctx.contextData.account, AccountRole.Maintainer)

    // Fail closed: if the owner can't be resolved we cannot rule out self-approval, so deny —
    // unconditionally, admin included (mirrors OnTimesheetDayUpdate's Rule A precedent).
    //
    // IMPORTANT C: `actorId !== undefined` is now REQUIRED unconditionally, not just compared
    // against `owner`. Previously an unresolvable actor left `actorId === undefined`, and
    // `undefined !== owner` trivially passed whenever `owner` was resolved — so an admin acting
    // through an unlinked social id could self-approve unattributably (isAdmin alone authorized
    // it). Attribution is the whole point of this feature (SPEC FAILURE 1), so an actor that can't
    // be resolved to an Employee can never be authorized, admin included.
    const authorized =
      owner !== undefined &&
      actorId !== undefined &&
      actorId !== owner &&
      (isAdmin || (await getApproverSet()).has(actorId))

    if (authorized) {
      // SPEC FAILURE 1: attribution is the whole feature — stamp the private TimesheetApproval row
      // authoritatively now that we know WHO (actorId, resolved above and required to be defined)
      // approved and WHEN. The client (utils/day.ts approveTask) only ever writes `task` +
      // `approvedHours`; this is the only place approvedBy/approvedOn are ever written.
      if (statusOp === 'Approved') {
        const approval = (
          await control.findAll(
            control.ctx, ygTimesheet.class.TimesheetApproval, { task: task._id }, { limit: 1 }
          )
        )[0]
        if (approval === undefined) {
          // Client-ordering issue (approveTask should always create/update the row alongside this
          // status write) — not a security problem, so warn rather than crash or revert a status
          // change that was itself properly authorized.
          control.ctx.warn(
            'yg-timesheet: TimesheetTask approved but no TimesheetApproval row found to stamp (client-ordering?)',
            { task: task._id, actor: actorId }
          )
        } else {
          const stamp = control.txFactory.createTxUpdateDoc(
            ygTimesheet.class.TimesheetApproval,
            approval.space,
            approval._id,
            { approvedBy: actorId, approvedOn: Date.now() } as any,
            false,
            Date.now(),
            core.account.System
          )
          await control.apply(control.ctx, [stamp])
        }
      }

      // Notify the employee (owner) that their task was approved/rejected. This is inside the
      // `authorized` branch ON PURPOSE — a forged/unauthorized approval that the trigger reverts
      // (below) never reaches here, so no false "approved" ping is ever sent. task.rejectReason is
      // read post-apply (the client's reject sets status + rejectReason in one tx). We do NOT
      // include approved HOURS in the employee's copy (they may be reduced from submitted, and
      // per-employee visibility of approved hours is deferred to the server-materialization fix).
      if (owner !== undefined) {
        const who = await displayName(control, actorId)
        const message = statusOp === 'Approved'
          ? `${who} approved your timesheet for ${task.identifier}`
          : `${who} rejected your timesheet for ${task.identifier}${
              task.rejectReason != null && task.rejectReason !== '' ? `: ${task.rejectReason}` : ''
            }`
        // Attach to the TimesheetTask so the Inbox click lands on My Timesheet (via NotificationRedirect).
        await notifyInbox(control, tx, [owner], task, message)
      }
      continue
    }

    control.ctx.warn('yg-timesheet: unauthorized TimesheetTask approval reverted', {
      task: task._id,
      project: task.project,
      actor: actorId,
      modifiedBy: utx.modifiedBy,
      attemptedStatus: statusOp,
      ownerResolved: owner !== undefined,
      isAdmin
    })

    // Compensating writes — attributed to System (7th arg) so they can never re-enter this trigger.
    const revertTxes: Tx[] = [
      control.txFactory.createTxUpdateDoc(
        task._class,
        task.space,
        task._id,
        { status: 'Submitted', $unset: { rejectReason: '' } } as any,
        false,
        Date.now(),
        core.account.System
      )
    ]

    // IMPORTANT D: an unauthorized approval must not leave its payroll row behind. Whatever put a
    // TimesheetApproval row on this task (a legitimate prior approval now being illegitimately
    // touched, or an attacker-planted row — e.g. via the Critical-A self-join hole this same
    // change closes), a task that is being forced back to Submitted must not keep one: Submitted
    // means "not approved", and the row may carry an attacker-chosen approvedHours.
    const approvalRow = (
      await control.findAll(control.ctx, ygTimesheet.class.TimesheetApproval, { task: task._id }, { limit: 1 })
    )[0]
    if (approvalRow !== undefined) {
      revertTxes.push(
        control.txFactory.createTxRemoveDoc(
          approvalRow._class, approvalRow.space, approvalRow._id, Date.now(), core.account.System
        )
      )
    }

    await control.apply(control.ctx, revertTxes)
  }
  return []
}

// Late-permission integrity: only an HR admin (Maintainer), and never the employee themselves, may
// move a LatePermission to Approved/Rejected. An unauthorized status write is reverted to Pending
// with stamps cleared. System-authored writes (this revert) are skipped so it cannot loop.
export async function OnLatePermissionUpdate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx.modifiedBy === core.account.System) continue
    if (tx._class !== core.class.TxUpdateDoc) continue
    const utx = tx as TxUpdateDoc<LatePermission>
    if (utx.objectClass !== ygTimesheet.class.LatePermission) continue
    const next = utx.operations.status
    if (next !== 'Approved' && next !== 'Rejected') continue

    const perm = (
      await control.findAll(control.ctx, ygTimesheet.class.LatePermission, { _id: utx.objectId }, { limit: 1 })
    )[0]
    if (perm === undefined) continue

    const isAdmin = hasAccountRole(control.ctx.contextData.account, AccountRole.Maintainer)
    const actor = await getEmployee(control, utx.modifiedBy)
    // Fail closed: an unresolved actor can't be ruled out as self, so it is never authorized,
    // admin included (mirrors OnTimesheetTaskUpdate's actorId !== undefined requirement).
    const authorized = isAdmin && actor !== undefined && actor._id !== perm.employee
    if (authorized) continue

    control.ctx.warn('yg-timesheet: unauthorized LatePermission status write reverted', {
      perm: perm._id, actor: utx.modifiedBy, isAdmin
    })

    const revert = control.txFactory.createTxUpdateDoc(
      perm._class, perm.space, perm._id,
      { status: 'Pending', $unset: { approvedBy: '', approvedOn: '', rejectReason: '' } } as any,
      false, Date.now(), core.account.System
    )
    await control.apply(control.ctx, [revert])
  }
  return []
}

//
// Membership of the private Approvals space = every currently-assigned PM/TL, kept in sync with
// the ProjectApprovers mixin so a newly assigned lead can immediately read (and be attributed on)
// approvals, and a removed lead loses access immediately. Reconciles GLOBALLY (across every
// project) on any change touching ANY project — cheap, idempotent, and correctness doesn't depend
// on diffing which project changed or which field on it.
//
// Loop-safety: registered with txMatch objectClass: tracker.class.Project (see
// models/server-yg-timesheet/src/index.ts). This trigger's only write is a TxUpdateDoc on
// ygTimesheet.space.Approvals — objectClass core.class.Space, never tracker.class.Project — so
// that write structurally cannot match this trigger's own txMatch and can never re-enter it. The
// top-of-loop System guard is kept anyway, matching the established idiom in this file.
//
// IMPORTANT E: `wanted` is no longer PM/TL-only — it is unioned with the space's own `owners` via
// deriveApprovalsMembers, so this reconcile never evicts admins/break-glass access. See
// deriveApprovalsMembers for why `owners` (not a generic role query) is the admin signal, and
// OnApprovalsMembershipGuard (Critical A) for why that field can be trusted here.
//
export async function OnProjectApproversChange (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const getApproverSet = lazyApproverRoleSet(control) // MINOR F: one project scan per invocation
  for (const tx of txes) {
    if (tx.modifiedBy === core.account.System) continue
    const space = (
      await control.findAll(control.ctx, core.class.Space, { _id: ygTimesheet.space.Approvals }, { limit: 1 })
    )[0]
    if (space === undefined) continue
    const roles = await getApproverSet()
    const wanted = await deriveApprovalsMembers(control, roles, space.owners ?? [])
    const current = new Set(space.members)
    if (wanted.size === current.size && [...wanted].every((m) => current.has(m))) continue
    const t = control.txFactory.createTxUpdateDoc(
      space._class, space.space, space._id, { members: [...wanted] } as any,
      false, Date.now(), core.account.System
    )
    await control.apply(control.ctx, [t])
  }
  return []
}

//
// CRITICAL A: ygTimesheet.space.Approvals is a plain core.class.Space (not a TypedSpace), so — same
// as ygTimesheet.space.HrData (see OnHrDataMembershipGuard below) — the security pipeline does NOT
// permission-check membership writes to it. Without this guard ANY workspace member could
// `updateDoc(core.class.Space, ..., ygTimesheet.space.Approvals, { $push: { members: <self> } })`
// and thereby freely create/inflate/delete TimesheetApproval rows (payroll data), including other
// people's approved hours.
//
// Modelled EXACTLY on OnHrDataMembershipGuard's shape (same async/POST-APPLY/System-attributed/
// top-of-loop-guard idioms; same $push-collect + unconditional actor backstop for protecting
// `owners`), with ONE deliberate difference: `members` is not precisely $pull-reverted — it is
// reconciled WHOLESALE to the server-derived set (deriveApprovalsMembers: PM/TL of every project,
// unioned with the now-trustworthy `owners`). A precise revert-what-was-added-by-this-tx approach
// would still trust whatever was already in `members` from BEFORE this guard existed (or from an
// earlier bypass) — only a full reconcile actually closes the hole.
//
// Loop-safety: registered with a narrow txMatch on this single objectId (see
// models/server-yg-timesheet/src/index.ts), matching the HrData guard's precedent. Its only writes
// are System-attributed TxUpdateDoc on this same Approvals space object; the top-of-loop System
// guard skips them, so they can never re-enter and re-fire.
//
export async function OnApprovalsMembershipGuard (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const getApproverSet = lazyApproverRoleSet(control) // MINOR F

  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    // Idempotence guard: our own compensating write is written as System. Skip it so it never
    // re-enters and re-reverts.
    if (tx.modifiedBy === core.account.System) continue

    const utx = tx as TxUpdateDoc<Space>
    if (utx.objectClass !== core.class.Space) continue
    if (utx.objectId !== ygTimesheet.space.Approvals) continue

    // Owner is authorized to curate this space — the only role allowed to (mirrors
    // OnHrDataMembershipGuard). Anything else (undefined account included) is untrusted.
    const account = control.ctx.contextData.account
    if (account !== undefined && hasAccountRole(account, AccountRole.Owner)) continue

    const space = (
      await control.findAll(control.ctx, core.class.Space, { _id: ygTimesheet.space.Approvals }, { limit: 1 })
    )[0]
    if (space === undefined) continue

    const ops = utx.operations as Record<string, any>

    // Precisely collect what THIS tx added to `owners` via $push (both forms), so `owners` — our
    // admin allowlist (see deriveApprovalsMembers) — can never be poisoned by an untrusted write.
    // Same idiom as OnHrDataMembershipGuard's collectPush.
    const pullOwners = new Set<AccountUuid>()
    const v = ops.$push?.owners
    if (v !== undefined && v !== null) {
      if (typeof v === 'object' && Array.isArray(v.$each)) {
        for (const x of v.$each as AccountUuid[]) pullOwners.add(x)
      } else {
        pullOwners.add(v as AccountUuid)
      }
    }
    // Backstop (mirrors OnHrDataMembershipGuard): a raw `{ owners: [...] }` overwrite cannot be
    // precisely diffed from post-apply state, so always also pull the acting non-Owner's own uuid.
    const actorUuid = account?.uuid
    if (actorUuid !== undefined) pullOwners.add(actorUuid)

    const trustedOwners = (space.owners ?? []).filter((o) => !pullOwners.has(o))

    // Do NOT trust anything this write did to `members` — reconcile it wholesale to the
    // server-derived set (Critical A), using only the now-trustworthy owners.
    const roles = await getApproverSet()
    const wantedMembers = await deriveApprovalsMembers(control, roles, trustedOwners)
    const currentMembers = new Set(space.members)
    const membersOk =
      wantedMembers.size === currentMembers.size && [...wantedMembers].every((m) => currentMembers.has(m))

    if (membersOk && pullOwners.size === 0) continue

    const fix: Record<string, any> = { members: [...wantedMembers] }
    if (pullOwners.size > 0) fix.$pull = { owners: { $in: [...pullOwners] } }

    // Compensating write — attributed to System (7th arg) so it doesn't re-trigger the guard.
    const t = control.txFactory.createTxUpdateDoc(
      utx.objectClass,
      utx.objectSpace,
      utx.objectId,
      fix as any,
      undefined,
      undefined,
      core.account.System
    )
    await control.apply(control.ctx, [t])
  }
  return []
}

//
// CRITICAL B: any employee assigned PM or Team Lead on ANY project is a workspace-wide approver
// (see approverRoleSet), so writing `ygTimesheet.mixin.ProjectApprovers.pm`/`teamLead` on a SINGLE
// project is a privilege escalation — a member who sets `pm: <self>` gains approval power over
// EVERYONE, and is auto-enrolled into the Approvals space by OnProjectApproversChange. Nothing
// previously restricted writing this mixin server-side (a UI-level restriction is not a security
// boundary).
//
// Reverts any TxMixin writing ygTimesheet.mixin.ProjectApprovers when the acting account is not an
// admin (AccountRole.Maintainer+). Restores the PRE-tx pm/teamLead when determinable by replaying
// the project's tx log excluding this tx (TxProcessor.buildDoc2Doc — the same technique
// server-plugins/tracker-resources uses to recover a TimeSpendReport's prior value for its own
// compensating $inc); otherwise clears both fields and logs a warn either way.
//
// Loop-safety: registered with a narrow txMatch (`_class: TxMixin, mixin: ProjectApprovers` — see
// models/server-yg-timesheet/src/index.ts). Our only write is itself a System-attributed TxMixin on
// this same mixin, so the top-of-loop System guard skips it on re-entry — it can never re-revert
// itself. (It DOES re-enter OnProjectApproversChange, which matches any tx touching a Project —
// that is intended: the Approvals space must re-sync to the restored pm/teamLead. That trigger's
// own write is on Space, not Project, so the chain terminates after that one extra hop.)
//
export async function OnProjectApproversMixinGuard (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx.modifiedBy === core.account.System) continue
    if (tx._class !== core.class.TxMixin) continue

    const mtx = tx as TxMixin<Project, ProjectApprovers>
    if (mtx.mixin !== ygTimesheet.mixin.ProjectApprovers) continue

    const isAdmin = hasAccountRole(control.ctx.contextData.account, AccountRole.Maintainer)
    if (isAdmin) continue

    // Replay this project's tx log EXCLUDING this tx to recover the pre-tx mixin state (triggers
    // otherwise only see post-apply state — see this file's top-of-file note).
    const logTxes = Array.from(
      await control.findAll(control.ctx, core.class.TxCUD, { objectId: mtx.objectId })
    ).filter((it) => it._id !== mtx._id)
    const prevDoc = TxProcessor.buildDoc2Doc<Project>(logTxes)
    const prevMixin =
      prevDoc !== undefined && prevDoc !== null
        ? control.hierarchy.as(prevDoc, ygTimesheet.mixin.ProjectApprovers)
        : undefined

    const revertAttrs: Record<string, any> =
      prevMixin !== undefined
        ? { pm: prevMixin.pm ?? null, teamLead: prevMixin.teamLead ?? null }
        : { pm: null, teamLead: null }

    control.ctx.warn('yg-timesheet: unauthorized ProjectApprovers mixin write reverted', {
      project: mtx.objectId,
      actor: mtx.modifiedBy,
      restoredPrevious: prevMixin !== undefined
    })

    const t = control.txFactory.createTxMixin(
      mtx.objectId,
      mtx.objectClass,
      mtx.objectSpace,
      ygTimesheet.mixin.ProjectApprovers,
      revertAttrs as any,
      Date.now(),
      core.account.System
    )
    await control.apply(control.ctx, [t])
  }
  return []
}

//
// Mirror every TimeSpendReport into a denormalized HrTimeEntry in the private HR space, so HR
// can read all employees' time without project membership. System-attributed; HrTimeEntry lives
// in a different class/space so these writes never re-enter this trigger.
//
// Verify note (resolved against this codebase, not assumed): TimeSpendReport is an AttachedDoc on
// Issue, but its CUD does NOT arrive wrapped in a TxCollectionCUD — that wrapper class was removed
// from this schema version (see models/core/src/migration.ts, state "remove-collection-txes", and
// core.class.TxCollectionCUD is not even registered — foundations/core/packages/core/src/component.ts).
// TxCreateDoc/TxUpdateDoc/TxRemoveDoc for an AttachedDoc are flat CUD txes carrying attachedTo /
// attachedToClass directly. This mirrors the real handling in
// server-plugins/tracker-resources/src/index.ts (OnIssueUpdate / doTimeReportUpdate), which reads
// `cud.attachedTo` straight off the CUD tx with no unwrapping step. There is also no
// `TxProcessor.extractTx` in this version of @hcengineering/core — only `TxProcessor.createDoc2Doc`
// (and updateDoc2Doc/buildDoc2Doc), used below to materialize the created report.
//
// Approved-hours drift (payroll integrity, 2026-08-07): after a task is Approved, an employee could
// add/edit a TimeSpendReport on that (employee, issue, day) and the extra time was silently included
// with no re-approval - a known cheat. On every create/update of a report we now also check whether
// it belongs to an Approved task whose live logged total no longer matches what was approved, and if
// so auto-revert that task to Submitted (reopenDriftedApprovedTask, below) so it re-enters the
// approver's queue. Remove is NOT handled in this v1 (we would need the pre-remove report's
// employee/issue/date, which the trigger cannot see post-apply) - removing time is not the cheat
// vector this closes (adding/editing is), so this is a documented limitation, not an oversight.
//
export async function OnTimeSpendReportChange (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (
      tx._class !== core.class.TxCreateDoc &&
      tx._class !== core.class.TxUpdateDoc &&
      tx._class !== core.class.TxRemoveDoc
    ) {
      continue
    }
    const cud = tx as TxCUD<TimeSpendReport>
    if (cud.objectClass !== tracker.class.TimeSpendReport) continue

    if (cud._class === core.class.TxCreateDoc) {
      const report = TxProcessor.createDoc2Doc(cud as TxCreateDoc<TimeSpendReport>)
      await upsertMirror(control, report)
      await reopenDriftedApprovedTask(control, report)
    } else if (cud._class === core.class.TxUpdateDoc) {
      const report = (
        await control.findAll(control.ctx, tracker.class.TimeSpendReport, { _id: cud.objectId }, { limit: 1 })
      )[0]
      if (report !== undefined) {
        await upsertMirror(control, report)
        await reopenDriftedApprovedTask(control, report)
      }
    } else if (cud._class === core.class.TxRemoveDoc) {
      await deleteMirror(control, cud.objectId)
    }
  }
  return []
}

/**
 * Given a TimeSpendReport that was just created/edited, find the Approved TimesheetTask for its
 * (employee, issue, day) - if any - and reopen it for re-approval when the live logged total no
 * longer matches what was approved (or submitted, if never approved-then-re-approved). This is the
 * server-side half of closing the approved-hours-drift cheat described at the top of this trigger.
 *
 * System-attributed (loop-safety): the compensating write is a TxUpdateDoc on a TimesheetTask, a
 * different class from TimeSpendReport, so it structurally cannot re-enter THIS trigger - but it is
 * still authored as core.account.System (matching the reopen-write idiom at lines ~257-263) so
 * OnTimesheetTaskUpdate's own top-of-loop System guard skips it too, rather than mistaking it for an
 * unauthorized status write to revert.
 */
async function reopenDriftedApprovedTask (control: TriggerControl, report: TimeSpendReport): Promise<void> {
  const employee = report.employee
  if (employee == null) return
  if (report.date == null) return

  const issue = report.attachedTo as Ref<Issue>

  // Candidates: every Approved task on this issue, across ALL employees - narrowed to this report's
  // employee AND day inside the loop. We deliberately do NOT filter by `date` in the query: task.date
  // is stored as LOCAL (IST) midnight, but this trigger runs on the server in UTC, so a server-computed
  // midnight would never equal the stored value (the previous bug: zero candidates, never reopened).
  // Instead we match the task whose absolute 24h day-window contains the report instant (inDayWindow),
  // which is timezone-independent.
  const candidates = await control.findAll(
    control.ctx, ygTimesheet.class.TimesheetTask, { issue, status: 'Approved' }
  )
  if (candidates.length === 0) return

  for (const candidate of candidates) {
    const taskDay = (
      await control.findAll(
        control.ctx, ygTimesheet.class.TimesheetDay, { _id: candidate.attachedTo as Ref<TimesheetDay> }, { limit: 1 }
      )
    )[0]
    const sheet = taskDay === undefined
      ? undefined
      : (
          await control.findAll(
            control.ctx, ygTimesheet.class.Timesheet, { _id: taskDay.attachedTo as Ref<Timesheet> }, { limit: 1 }
          )
        )[0]
    if (sheet?.employee !== employee) continue // a different employee's task on the same issue/day
    if (!inDayWindow(candidate.date, report.date)) continue // an Approved task on a DIFFERENT day of this issue

    // Live total: every TimeSpendReport this employee logged on this issue, cut to this task's day
    // window (absolute [task.date, task.date + 24h), timezone-independent - see inDayWindow above).
    const reports = await control.findAll(
      control.ctx, tracker.class.TimeSpendReport, { attachedTo: issue, employee }
    )
    // sumHoursInDayWindow already rounds its total to 2dp.
    const liveHours = sumHoursInDayWindow(reports.map((r) => ({ date: r.date, value: r.value })), candidate.date)

    // Drift baseline is submittedHours (the spent total the approver reviewed), NOT approvedHours.
    // The approver may deliberately approve LESS than submitted (e.g. submit 1h, approve 0.5h) - that is
    // correct and must not reopen. We only reopen when the employee changes the SPENT time after
    // submission, i.e. live spent no longer equals what was submitted/reviewed.
    const submittedBaseline = candidate.submittedHours
    if (!roundedHoursDiffer(submittedBaseline, liveHours)) continue // spent unchanged since submit - do nothing

    control.ctx.warn('yg-timesheet: approved task auto-reopened for re-approval (logged hours drift)', {
      task: candidate._id, issue, employee, submittedBaseline, liveHours
    })

    const revert = control.txFactory.createTxUpdateDoc(
      candidate._class,
      candidate.space,
      candidate._id,
      {
        status: 'Submitted',
        submittedHours: liveHours,
        approvedHours: null,
        approvedBy: null,
        approvedOn: null,
        rejectReason: null
      } as any,
      false,
      Date.now(),
      core.account.System
    )
    await control.apply(control.ctx, [revert])
  }
}

// Remove any HrTimeEntry mirror(s) for a given TimeSpendReport (System-attributed). There should be
// at most one, but findAll without a limit is defensive against a stray duplicate.
async function deleteMirror (control: TriggerControl, source: Ref<TimeSpendReport>): Promise<void> {
  const mirrors = await control.findAll(control.ctx, ygTimesheet.class.HrTimeEntry, { source })
  const del = mirrors.map((m) =>
    control.txFactory.createTxRemoveDoc(m._class, m.space, m._id, undefined, core.account.System)
  )
  if (del.length > 0) await control.apply(control.ctx, del)
}

async function upsertMirror (control: TriggerControl, report: TimeSpendReport): Promise<void> {
  // No employee to attribute the hours to (shouldn't normally happen). If the report previously had
  // an employee and was cleared on update, a stale mirror would otherwise linger — so delete any
  // existing mirror to preserve the "one current mirror per report, or none" invariant, then bail.
  const employee = report.employee
  if (employee === null || employee === undefined) {
    await deleteMirror(control, report._id)
    return
  }

  const issue = (
    await control.findAll(control.ctx, tracker.class.Issue, { _id: report.attachedTo as Ref<Issue> }, { limit: 1 })
  )[0]
  const project = issue !== undefined
    ? (await control.findAll(control.ctx, tracker.class.Project, { _id: issue.space }, { limit: 1 }))[0]
    : undefined

  const data: Data<HrTimeEntry> = {
    source: report._id,
    employee,
    date: report.date ?? 0,
    hours: report.value,
    project: (issue?.space ?? '') as Ref<Project>,
    projectName: project?.name ?? '',
    issue: (issue?._id ?? report.attachedTo) as Ref<Issue>,
    identifier: issue?.identifier ?? '—',
    title: issue?.title ?? '(unknown issue)',
    note: report.description ?? ''
  }

  const existing = (
    await control.findAll(control.ctx, ygTimesheet.class.HrTimeEntry, { source: report._id }, { limit: 1 })
  )[0]

  if (existing === undefined) {
    const t = control.txFactory.createTxCreateDoc(
      ygTimesheet.class.HrTimeEntry,
      ygTimesheet.space.HrData,
      data,
      undefined,
      undefined,
      core.account.System
    )
    await control.apply(control.ctx, [t])
  } else {
    const t = control.txFactory.createTxUpdateDoc(
      ygTimesheet.class.HrTimeEntry,
      existing.space,
      existing._id,
      data,
      undefined,
      undefined,
      core.account.System
    )
    await control.apply(control.ctx, [t])
  }
}

//
// Privacy write-guard: only the workspace Owner may curate the HR roster (ygTimesheet.space.HrData
// membership). HrData is a plain core.class.Space, NOT a TypedSpace, so Huly's security pipeline does
// not permission-check writes to it — any workspace User could `$push` their own AccountUuid into
// HrData.members via a direct API call and thereby read every employee's HrTimeEntry. This trigger
// reverts any membership addition made by a non-Owner, server-side.
//
// Same idioms as OnTimesheetDayUpdate: async, POST-APPLY state, System-attributed compensating writes
// applied via control.apply (not returned), and the top-of-loop System loop-guard so our own $pull
// never re-enters and re-reverts.
//
// The revert is precise for `$push` (both the single-value `{ $push: { members: X } }` and the
// `{ $push: { members: { $each: [...] } } }` forms — we pull exactly what was added, so legitimate
// pre-existing members are untouched). A raw `{ members: [...] }` set by a non-Owner cannot be
// precisely reverted from post-apply state without destroying legitimate members, so for it the
// load-bearing guarantee is the BACKSTOP: we always also $pull the acting account's own uuid from
// members/owners — so no non-Owner code path can leave the actor (a non-Owner) inside HrData, which
// is the property that actually protects read-privacy.
//
export async function OnHrDataMembershipGuard (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    // Idempotence guard: our own compensating $pull is written as System. Skip it so it never
    // re-enters and re-reverts.
    if (tx.modifiedBy === core.account.System) continue

    const utx = tx as TxUpdateDoc<Space>
    if (utx.objectClass !== core.class.Space) continue
    if (utx.objectId !== ygTimesheet.space.HrData) continue

    // Owner is authorized to curate the roster — the only role allowed to. Anything else (undefined
    // account included) is treated as unauthorized and reverted (privacy-safe default).
    const account = control.ctx.contextData.account
    if (account !== undefined && hasAccountRole(account, AccountRole.Owner)) continue

    const ops = utx.operations as Record<string, any>

    // Collect exactly the AccountUuids the tx ADDED to each field via $push (both forms), so we can
    // pull precisely those back out without touching legitimate pre-existing members.
    const pullMembers = new Set<AccountUuid>()
    const pullOwners = new Set<AccountUuid>()

    const collectPush = (field: 'members' | 'owners', sink: Set<AccountUuid>): void => {
      const v = ops.$push?.[field]
      if (v === undefined || v === null) return
      if (typeof v === 'object' && Array.isArray(v.$each)) {
        for (const x of v.$each as AccountUuid[]) sink.add(x)
      } else {
        sink.add(v as AccountUuid)
      }
    }
    collectPush('members', pullMembers)
    collectPush('owners', pullOwners)

    // Backstop: always pull the acting (non-Owner) account's own uuid too — covers a raw
    // `{ members: [...] }` / `{ owners: [...] }` set, which we cannot precisely revert from
    // post-apply state, and guarantees the actor is never left inside the private HR space.
    const actorUuid = account?.uuid
    if (actorUuid !== undefined) {
      pullMembers.add(actorUuid)
      pullOwners.add(actorUuid)
    }

    if (pullMembers.size === 0 && pullOwners.size === 0) continue

    const pull: Record<string, any> = {}
    if (pullMembers.size > 0) pull.members = { $in: [...pullMembers] }
    if (pullOwners.size > 0) pull.owners = { $in: [...pullOwners] }

    // Compensating write — attributed to System (7th arg) so it doesn't re-trigger the guard.
    const t = control.txFactory.createTxUpdateDoc(
      utx.objectClass,
      utx.objectSpace,
      utx.objectId,
      { $pull: pull } as any,
      undefined,
      undefined,
      core.account.System
    )
    await control.apply(control.ctx, [t])
  }
  return []
}

//
// COSMETIC layer (best-effort): hide the "Human Resource" app icon from the left rail for every
// account that is NOT a member of the private HR space (ygTimesheet.space.HrData). The HrTimeEntry
// data is already server-private (PrivateMiddleware + OnHrDataMembershipGuard); this only removes the
// icon so non-HR users don't even see the app. If any part of this fails it must NOT block anything —
// worst case a non-member sees an icon that opens an empty/permission-denied view.
//
// MECHANISM (proven by the Task-7 spike, verified against this codebase — not assumed):
//  - The left rail (plugins/workbench-resources/src/components/Applications.svelte) hides any app whose
//    _id appears as a `workbench.class.HiddenApplication` the CURRENT user can see. HiddenApplication is
//    a `Preference` living in the SHARED `core.space.Workspace` — there is NO per-user space. Per-user
//    scoping is done by `createdBy`: the server's PrivateMiddleware (foundations/server/packages/
//    middleware/src/private.ts) rewrites every preference-domain read from a non-System account to
//    `createdBy: { $in: <that account's socialIds> }`. So a HiddenApplication only affects the user whose
//    social id is its `createdBy`.
//  - To hide the HR app for user X we therefore create a HiddenApplication whose `createdBy` is one of
//    X's social ids. `TxFactory.createTxCreateDoc` sets the tx's `createdBy = modifiedBy` (its 6th arg),
//    and `TxProcessor.createDoc2Doc` sets `doc.createdBy = tx.createdBy` — so passing X's social id as
//    the `modifiedBy` arg lands `doc.createdBy = X's social id`. No middleware overrides it.
//  - PrivateMiddleware's WRITE guard permits this: writing another user's preference is allowed when the
//    acting account is System OR an Owner. HrData membership can only be curated by an Owner (enforced by
//    OnHrDataMembershipGuard), so on the membership-edit path the acting account is always an Owner; the
//    backfill runs as System. Reads by System bypass the createdBy filter, so System can enumerate and
//    remove any user's HiddenApplication when they join HR.
//
// LOOP-SAFETY: this trigger matches TxUpdateDoc on objectId === HrData only. Its own writes are
// HiddenApplication creates/removes (different class + objectId), so they never re-enter this trigger.
// We deliberately do NOT skip System-authored HrData updates: when OnHrDataMembershipGuard $pulls a
// sneak-in non-Owner back out (a System write to HrData), we want to re-run and restore that user's hide.
// reconcile is idempotent and converges in one extra pass, then stops (no HrData tx is emitted).
//
const HR_APP = ygTimesheet.app.HumanResource as unknown as Ref<Application>

// Every human account in the workspace (canonical membership set = the Employee mixin's personUuid).
async function allWorkspaceAccounts (control: TriggerControl): Promise<AccountUuid[]> {
  const employees = await control.findAll(control.ctx, contact.mixin.Employee, {})
  const set = new Set<AccountUuid>()
  for (const e of employees) {
    if (e.personUuid != null) set.add(e.personUuid)
  }
  return [...set]
}

// Core reconcile: given the current HR members, ensure a HiddenApplication(HR) exists (createdBy = one
// of their social ids) for every NON-member, and none exists for any member. Idempotent. All writes go
// through control.apply. Shared by the trigger and the backfill. Never throws out — it best-effort logs.
async function reconcileHrHidden (control: TriggerControl, members: AccountUuid[]): Promise<void> {
  try {
    const memberSet = new Set(members)
    const nonMembers = (await allWorkspaceAccounts(control)).filter((a) => !memberSet.has(a))

    const nonMemberSocial = await getSocialIdsByAccounts(control, nonMembers)
    const memberSocial = members.length > 0 ? await getSocialIdsByAccounts(control, members) : {}

    // System read → PrivateMiddleware does not apply the createdBy filter, so we see EVERY user's hide.
    const existing = await control.findAll(control.ctx, workbench.class.HiddenApplication, {
      attachedTo: HR_APP,
      space: core.space.Workspace
    })
    const existingByCreator = new Map<PersonId, HiddenApplication>()
    for (const h of existing) {
      if (h.createdBy != null) existingByCreator.set(h.createdBy, h)
    }

    const txes: Tx[] = []

    // Seed a hide for each non-member that doesn't already have one under any of their social ids.
    for (const acc of nonMembers) {
      const socials = nonMemberSocial[acc] ?? []
      if (socials.length === 0) continue // no social id to scope a pref to — cannot hide, skip (harmless)
      if (socials.some((s) => existingByCreator.has(s))) continue // already hidden for this account
      txes.push(
        control.txFactory.createTxCreateDoc(
          workbench.class.HiddenApplication,
          core.space.Workspace,
          { attachedTo: HR_APP } as Data<HiddenApplication>,
          undefined,
          undefined,
          // 6th arg = modifiedBy → sets tx.createdBy → doc.createdBy = this account's social id.
          socials[0]
        )
      )
    }

    // Remove any hide belonging to a (now-)member so the app reappears for them. System-attributed remove.
    for (const acc of members) {
      for (const s of memberSocial[acc] ?? []) {
        const h = existingByCreator.get(s)
        if (h !== undefined) {
          txes.push(control.txFactory.createTxRemoveDoc(h._class, h.space, h._id, undefined, core.account.System))
        }
      }
    }

    if (txes.length > 0) await control.apply(control.ctx, txes)
  } catch (err: any) {
    // Best-effort cosmetic layer: never propagate. The data-privacy guarantee does not depend on this.
    control.ctx.warn('yg-timesheet: reconcileHrHidden failed (cosmetic, ignored)', { error: err?.message ?? String(err) })
  }
}

export async function OnHrMembershipChange (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    const utx = tx as TxUpdateDoc<Space>
    if (utx.objectClass !== core.class.Space) continue
    if (utx.objectId !== ygTimesheet.space.HrData) continue

    // Only react when membership actually changed (ignore unrelated HrData field edits).
    const ops = utx.operations as Record<string, any>
    const touchesMembers =
      ops.members !== undefined || ops.$push?.members !== undefined || ops.$pull?.members !== undefined
    if (!touchesMembers) continue

    // Read post-apply members off the space and reconcile every account's hide against it.
    const hr = (await control.findAll(control.ctx, core.class.Space, { _id: ygTimesheet.space.HrData }, { limit: 1 }))[0]
    if (hr === undefined) continue
    await reconcileHrHidden(control, hr.members ?? [])
  }
  return []
}

// One-shot seeding for existing installs. Hides the HR app for all current non-members.
// Idempotent — safe to run repeatedly.
//
// NOTE (2026-07-22): this is NOT wired to a migration. Migrations run with a TxOperations client,
// not a TriggerControl, so they cannot call it. On an existing workspace, seed the hides for
// current accounts by making any one HrData membership edit (add a member and remove them again)
// — OnHrMembershipChange then reconciles EVERY account in one pass.
export async function backfillHrHidden (control: TriggerControl): Promise<void> {
  const hr = (await control.findAll(control.ctx, core.class.Space, { _id: ygTimesheet.space.HrData }, { limit: 1 }))[0]
  await reconcileHrHidden(control, hr?.members ?? [])
}

//
// Coverage fix (root cause of the "icon not hidden" bug, diagnosed 2026-07-22):
// OnHrMembershipChange only fires on an HrData membership tx, so hides were only ever computed at
// membership-change time. Any account that joined the workspace AFTERWARDS was never reconciled and
// kept a visible HR icon. Proven on the local stack: of two non-members, the one present at the last
// membership change had a correctly-scoped hide; the one created later had none.
//
// So: reconcile again whenever a Person becomes an active Employee (i.e. someone joins the
// workspace). reconcileHrHidden is idempotent and covers every account in one pass, so it both
// seeds the newcomer and repairs anyone previously missed.
//
// LOOP-SAFETY: this trigger's only writes are HiddenApplication creates/removes (preference class),
// never Person/Employee mixins — so it cannot re-enter itself.
//
export async function OnHrEmployeeCreate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  // The txMatch already narrows to "Person gained an active Employee mixin"; one reconcile pass
  // covers every account, so collapse a batch of them into a single run.
  if (txes.length === 0) return []
  const hr = (await control.findAll(control.ctx, core.class.Space, { _id: ygTimesheet.space.HrData }, { limit: 1 }))[0]
  if (hr === undefined) return []
  await reconcileHrHidden(control, hr.members ?? [])
  return []
}

//
// Estimate gate (backlog #1): an issue may not enter a started (Active-category) status - In
// Progress / In Testing / In Review - unless it has a positive estimate. This is the HARD
// enforcement point: it covers every path that can change a status (the StatusEditor dropdown,
// kanban drag, bulk edit, and the raw API), complementing the StatusEditor client pre-check
// (which only fast-fails the common dropdown path). The submit-time check in Timesheet.svelte
// stays as the final backstop.
//
// LOOP-SAFETY: the only write is a System-attributed status revert (createTxUpdateDoc's 7th arg),
// which the top-of-loop `modifiedBy === System` guard skips - so it never re-enters and re-reverts.
//
// SCOPE: this gate covers TRANSITIONS only (a TxUpdateDoc that changes an issue's status). Creating
// an issue DIRECTLY into an Active status (a TxCreateDoc<Issue>) is INTENTIONALLY NOT gated here
// (product-owner decision): the timesheet submit-time estimation check in Timesheet.svelte is the
// backstop for that path. Do not "fix" this by adding TxCreateDoc handling - it is deliberate.
//
export async function OnIssueEstimateGate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx.modifiedBy === core.account.System) continue
    if (tx._class !== core.class.TxUpdateDoc) continue
    const utx = tx as TxUpdateDoc<Issue>
    if (utx.objectClass !== tracker.class.Issue) continue

    const nextStatus = (utx.operations as Partial<Issue>).status
    if (nextStatus == null) continue

    // Resolve the target status's category; only Active (started) statuses are gated.
    const status = (
      await control.findAll(control.ctx, tracker.class.IssueStatus, { _id: nextStatus }, { limit: 1 })
    )[0]
    if (status === undefined) continue

    const issue = (
      await control.findAll(control.ctx, tracker.class.Issue, { _id: utx.objectId }, { limit: 1 })
    )[0]
    if (issue === undefined) continue

    if (!estimateRequiredToActivate(status.category, task.statusCategory.Active, issue.estimation)) continue

    // Revert to a not-started status THAT BELONGS TO THIS ISSUE'S OWN TASK TYPE. Do NOT scope by
    // `ofAttribute`: every IssueStatus in the workspace shares one global ofAttribute
    // (tracker.attribute.IssueStatus), so that query returns statuses across ALL projects/task types
    // and could land the issue in a foreign status that has no column on its own board. A TaskType
    // instead owns an ordered `statuses: Ref<Status>[]` array that defines exactly which statuses -
    // and in what order - belong to it (this is what the client's getTaskTypeStates reads). The
    // issue's task type is `issue.kind`. Prefer the first ToDo (nearest not-started), else the first
    // UnStarted (Backlog), in the task type's own ordering. If the task type or a not-started status
    // can't be resolved we cannot safely revert - log and bail (the client pre-check covers the
    // common path).
    const taskType = (
      await control.findAll(control.ctx, task.class.TaskType, { _id: issue.kind }, { limit: 1 })
    )[0]
    if (taskType === undefined) {
      control.ctx.warn('yg-timesheet: estimate gate could not resolve the issue task type', {
        issue: issue._id, project: issue.space, kind: issue.kind, attempted: nextStatus
      })
      continue
    }

    // Resolve the task type's statuses, preserving its own ordering (findAll does not guarantee it).
    const statusDocs = await control.findAll(
      control.ctx, tracker.class.IssueStatus, { _id: { $in: taskType.statuses } }
    )
    const byId = new Map(statusDocs.map((s) => [s._id, s]))
    const orderedStatuses = taskType.statuses
      .map((id) => byId.get(id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined)

    const revertTo =
      orderedStatuses.find((s) => s.category === task.statusCategory.ToDo)?._id ??
      orderedStatuses.find((s) => s.category === task.statusCategory.UnStarted)?._id
    if (revertTo == null || revertTo === nextStatus) {
      control.ctx.warn('yg-timesheet: estimate gate could not resolve a not-started status', {
        issue: issue._id, project: issue.space, attempted: nextStatus
      })
      continue
    }

    control.ctx.warn('yg-timesheet: estimate gate reverted un-estimated issue activation', {
      issue: issue._id, identifier: issue.identifier, actor: utx.modifiedBy, attempted: nextStatus
    })

    const revert = control.txFactory.createTxUpdateDoc(
      utx.objectClass,
      utx.objectSpace,
      utx.objectId,
      { status: revertTo } as any,
      false,
      Date.now(),
      core.account.System
    )
    await control.apply(control.ctx, [revert])

    // Notify the actor why it snapped back (best-effort; the visible revert is the primary signal).
    const actor = await getEmployee(control, utx.modifiedBy)
    if (actor !== undefined) {
      await notifyInbox(
        control,
        tx,
        [actor._id],
        issue,
        `Set an estimate on ${issue.identifier} before moving it to "${status.name}".`
      )
    }
  }
  return []
}

export default async () => ({
  trigger: {
    OnTimesheetDayUpdate,
    OnTimesheetDaySubmitNotify,
    OnTimesheetTaskUpdate,
    OnLatePermissionUpdate,
    OnProjectApproversChange,
    OnApprovalsMembershipGuard,
    OnProjectApproversMixinGuard,
    OnTimeSpendReportChange,
    OnHrDataMembershipGuard,
    OnHrMembershipChange,
    OnHrEmployeeCreate,
    OnIssueEstimateGate
  }
})
