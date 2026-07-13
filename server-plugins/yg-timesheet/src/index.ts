//
// YoungGlobes: server-yg-timesheet plugin ids (Phase 1b spike).
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
    OnTimesheetDecision: '' as Resource<TriggerFunc>
  }
})
