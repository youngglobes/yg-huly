//
// YoungGlobes: model-side id extensions for the My Timesheet workbench application.
//
import { ygTimesheetId } from '@hcengineering/yg-timesheet'
import ygTimesheet from '@hcengineering/yg-timesheet'
import { mergeIds } from '@hcengineering/platform'
import type { IntlString } from '@hcengineering/platform'

export default mergeIds(ygTimesheetId, ygTimesheet, {
  string: {
    Timesheet: '' as IntlString
  }
})
