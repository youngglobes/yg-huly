//
// YoungGlobes: server-yg-timesheet plugin ids (Phase 1b).
//
import type { Plugin, Resource } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { TriggerFunc } from '@hcengineering/server-core'

/**
 * @public
 */
export const serverYgTimesheetId = 'server-yg-timesheet' as Plugin

/**
 * @public
 */
export default plugin(serverYgTimesheetId, {
  trigger: {
    OnTimesheetDayUpdate: '' as Resource<TriggerFunc>,
    OnTimesheetDaySubmitNotify: '' as Resource<TriggerFunc>,
    OnTimesheetTaskUpdate: '' as Resource<TriggerFunc>,
    OnProjectApproversChange: '' as Resource<TriggerFunc>,
    OnApprovalsMembershipGuard: '' as Resource<TriggerFunc>,
    OnProjectApproversMixinGuard: '' as Resource<TriggerFunc>,
    OnTimeSpendReportChange: '' as Resource<TriggerFunc>,
    OnHrDataMembershipGuard: '' as Resource<TriggerFunc>,
    OnHrMembershipChange: '' as Resource<TriggerFunc>,
    OnHrEmployeeCreate: '' as Resource<TriggerFunc>,
    OnIssueEstimateGate: '' as Resource<TriggerFunc>
  }
})
