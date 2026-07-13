//
// YoungGlobes: model-server-yg-timesheet — trigger registration (Phase 1b spike).
//
import { type Builder } from '@hcengineering/model'
import core from '@hcengineering/core'
import serverCore from '@hcengineering/server-core'
import ygTimesheet from '@hcengineering/yg-timesheet'
import serverYgTimesheet from '@hcengineering/server-yg-timesheet'

export { serverYgTimesheetId } from '@hcengineering/server-yg-timesheet'

export function createModel (builder: Builder): void {
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnTimesheetDecision,
    isAsync: true, // sync + findAll deadlocks the tx; async runs after the response (control.apply)
    txMatch: { _class: core.class.TxUpdateDoc, objectClass: ygTimesheet.class.Timesheet }
  })
}
