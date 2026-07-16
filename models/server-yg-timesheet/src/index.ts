//
// YoungGlobes: model-server-yg-timesheet — trigger registration (Phase 1b).
//
import { type Builder } from '@hcengineering/model'
import core from '@hcengineering/core'
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
}
