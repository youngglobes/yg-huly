//
// YoungGlobes: timesheet plugin ids (Phase 0 spike — one class only).
//
import type { Employee } from '@hcengineering/contact'
import { type Class, type Doc, type Ref, type Timestamp } from '@hcengineering/core'
import type { Asset, IntlString, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'

/** One timesheet per employee per week (weekStart = Monday 00:00 workspace tz). */
export interface Timesheet extends Doc {
  employee: Ref<Employee>
  weekStart: Timestamp
  // TEMPORARY (Phase 1b spike; removed in Task 3): status enforcement spike field.
  spikeStatus?: string
}

export const ygTimesheetId = 'yg-timesheet' as Plugin

export default plugin(ygTimesheetId, {
  class: {
    Timesheet: '' as Ref<Class<Timesheet>>
  },
  app: {
    Timesheet: '' as Ref<Doc>
  },
  component: {
    Timesheet: '' as AnyComponent
  },
  icon: {
    Timesheet: '' as Asset
  },
  string: {
    Timesheet: '' as IntlString,
    Today: '' as IntlString,
    Total: '' as IntlString
  }
})
