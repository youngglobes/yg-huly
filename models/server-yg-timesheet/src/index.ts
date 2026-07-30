//
// YoungGlobes: model-server-yg-timesheet — trigger registration (Phase 1b).
//
import { type Builder } from '@hcengineering/model'
import core from '@hcengineering/core'
import contact from '@hcengineering/contact'
import serverCore from '@hcengineering/server-core'
import tracker from '@hcengineering/tracker'
import ygTimesheet from '@hcengineering/yg-timesheet'
import serverYgTimesheet from '@hcengineering/server-yg-timesheet'

export { serverYgTimesheetId } from '@hcengineering/server-yg-timesheet'

export function createModel (builder: Builder): void {
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnTimesheetDayUpdate,
    isAsync: true, // sync + findAll deadlocks the tx; async runs after the response (control.apply)
    txMatch: { _class: core.class.TxUpdateDoc, objectClass: ygTimesheet.class.TimesheetDay }
  })

  // Submit notification (2026-07-25): fires on the day-level submit update (submittedOn set) and
  // pushes one inbox notification to each approver in day.approvers. Separate from the auth trigger
  // above — submit is not an authorization event. Async: it does findAll + control.apply like the
  // rest of this file.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnTimesheetDaySubmitNotify,
    isAsync: true,
    txMatch: { _class: core.class.TxUpdateDoc, objectClass: ygTimesheet.class.TimesheetDay }
  })

  // Per-task approval authorization (REVISION 2, task-3, 2026-07-2x): reverts an approve/reject
  // by anyone whose role is not PM/TeamLead on some project (or admin), or who is the timesheet's
  // own owner (self-approval, forbidden for everyone). Role is derived server-side from the
  // ProjectApprovers mixin — never from the task's own (client-writable) `approvers` field.
  // approvedBy/approvedOn/approvedHours live on the private TimesheetApproval doc, not
  // TimesheetTask (task-2, 2026-07-23) — this trigger does not touch them at all.
  //
  // txMatch stays objectClass-only (no `_class` filter) for consistency with the rest of this
  // file's idiom, but the trigger itself (server-plugins/yg-timesheet-resources/src/index.ts)
  // now only acts on TxUpdateDoc — a status write is the only thing it authorizes.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnTimesheetTaskUpdate,
    isAsync: true,
    txMatch: { objectClass: ygTimesheet.class.TimesheetTask }
  })

  // Keeps the private Approvals space's membership in sync with every project's PM/TeamLead
  // assignment, so a newly assigned lead can immediately read (and be attributed on) approvals.
  // Matches any tx touching a Project (create/update/remove/mixin) — see OnProjectApproversChange
  // for why this can never re-enter itself.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnProjectApproversChange,
    isAsync: true,
    txMatch: { objectClass: tracker.class.Project }
  })

  // CRITICAL A: ygTimesheet.space.Approvals is a plain core.class.Space, so (same as HrData below)
  // the security pipeline does not permission-check membership writes to it. This async guard
  // reverts/reconciles any untrusted membership change (see OnApprovalsMembershipGuard). Narrow
  // txMatch on the single Approvals object, matching the HrData guard's precedent.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnApprovalsMembershipGuard,
    isAsync: true,
    txMatch: { _class: core.class.TxUpdateDoc, objectId: ygTimesheet.space.Approvals }
  })

  // CRITICAL B: writing ygTimesheet.mixin.ProjectApprovers (pm/teamLead) on ANY project grants
  // workspace-wide approval power (approverRoleSet is global, not per-project) — a member who sets
  // `pm: <self>` on one project escalates to approver-of-everyone. Reverts any such write by a
  // non-admin (see OnProjectApproversMixinGuard). Narrow txMatch on this single mixin.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnProjectApproversMixinGuard,
    isAsync: true,
    txMatch: { _class: core.class.TxMixin, mixin: ygTimesheet.mixin.ProjectApprovers }
  })

  // TimeSpendReport CUD arrives as a flat tx (not wrapped in TxCollectionCUD — that class does not
  // exist in this schema version). Matched the same way models/server-tracker registers OnIssueUpdate
  // for TimeSpendReport: flat `objectClass` match, no `_class` restriction (covers create/update/remove).
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnTimeSpendReportChange,
    isAsync: true,
    txMatch: { objectClass: tracker.class.TimeSpendReport }
  })

  // Privacy write-guard: HrData is a plain core.class.Space (not a TypedSpace), so the security
  // pipeline does not permission-check membership writes to it. This async guard reverts any
  // HrData membership addition made by a non-Owner (see OnHrDataMembershipGuard). Matched narrowly
  // on the single HrData object so it never fires for other spaces.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnHrDataMembershipGuard,
    isAsync: true,
    txMatch: { _class: core.class.TxUpdateDoc, objectId: ygTimesheet.space.HrData }
  })

  // COSMETIC: hide the HR app icon from non-members of HrData by maintaining a per-user
  // workbench.class.HiddenApplication (scoped by createdBy — see OnHrMembershipChange). Same narrow
  // txMatch as the guard above (single HrData object). Best-effort; never blocks membership edits.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnHrMembershipChange,
    isAsync: true,
    txMatch: { _class: core.class.TxUpdateDoc, objectId: ygTimesheet.space.HrData }
  })

  // COSMETIC (coverage fix, 2026-07-22): OnHrMembershipChange alone only reconciles at
  // membership-change time, so an account created afterwards kept a visible HR icon. Reconcile
  // again whenever a Person becomes an active Employee. Same txMatch shape models/server-contact
  // uses for its own OnEmployeeCreate.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnHrEmployeeCreate,
    isAsync: true,
    txMatch: {
      objectClass: contact.class.Person,
      _class: core.class.TxMixin,
      mixin: contact.mixin.Employee,
      'attributes.active': true
    }
  })
}
