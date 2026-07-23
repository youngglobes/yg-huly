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

  // Per-task approval authorization: reverts an approve/reject by anyone who is not an approver
  // of that specific task, and stamps approvedBy/approvedOn authoritatively.
  //
  // Task-5 round 2 (Critical B): txMatch is objectClass-only, WITHOUT a `_class` filter, so
  // TxCreateDoc (a wholly forged, already-approved task created in one tx) and TxRemoveDoc
  // (deleting somebody else's approved task) reach the trigger too, not just TxUpdateDoc — same
  // idiom OnTimeSpendReportChange's registration below already uses. The trigger itself
  // (server-plugins/yg-timesheet-resources/src/index.ts) dispatches on tx._class explicitly.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnTimesheetTaskUpdate,
    isAsync: true,
    txMatch: { objectClass: ygTimesheet.class.TimesheetTask }
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
