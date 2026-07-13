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
  type Ref,
  type Tx,
  type TxUpdateDoc
} from '@hcengineering/core'
import { type Employee } from '@hcengineering/contact'
import { type TriggerControl } from '@hcengineering/server-core'
import { getEmployee } from '@hcengineering/server-contact'
import ygTimesheet, { type DayStatus, type TimesheetDay } from '@hcengineering/yg-timesheet'

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
      await control.findAll(control.ctx, ygTimesheet.class.Timesheet, { _id: day.attachedTo }, { limit: 1 })
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

export default async () => ({ trigger: { OnTimesheetDayUpdate } })
