//
// YoungGlobes: timesheet plugin ids (Phase 0 spike — one class only).
//
import type { Employee } from '@hcengineering/contact'
import { type Class, type Doc, type Ref, type Timestamp } from '@hcengineering/core'
import type { Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'

/** One timesheet per employee per week (weekStart = Monday 00:00 workspace tz). */
export interface Timesheet extends Doc {
  employee: Ref<Employee>
  weekStart: Timestamp
}

export const ygTimesheetId = 'yg-timesheet' as Plugin

export default plugin(ygTimesheetId, {
  class: {
    Timesheet: '' as Ref<Class<Timesheet>>
  }
})
