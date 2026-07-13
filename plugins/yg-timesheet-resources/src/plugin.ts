//
// YoungGlobes: resource-local id extensions for the timesheet UI.
// Adds the component id (loaded by Resources) and the extra string ids
// used by Timesheet.svelte that the base plugin (yg-timesheet) does not
// declare — translations for these already exist in yg-timesheet-assets/lang.
//
import { ygTimesheetId } from '@hcengineering/yg-timesheet'
import ygTimesheet from '@hcengineering/yg-timesheet'
import { mergeIds, type IntlString } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'

export default mergeIds(ygTimesheetId, ygTimesheet, {
  component: {
    Timesheet: '' as AnyComponent
  },
  string: {
    Today: '' as IntlString,
    Total: '' as IntlString
  }
})
