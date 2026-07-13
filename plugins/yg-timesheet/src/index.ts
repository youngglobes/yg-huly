//
// YoungGlobes: timesheet plugin ids.
//
import type { Employee } from '@hcengineering/contact'
import { type AttachedDoc, type Class, type Doc, type Mixin, type Ref, type Timestamp } from '@hcengineering/core'
import type { Asset, IntlString, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { Issue, Project } from '@hcengineering/tracker'
import type { AnyComponent } from '@hcengineering/ui'

export type DayStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected'

export interface TimesheetLine {
  issue: Ref<Issue>
  identifier: string
  title: string
  project: string
  hours: number
  note: string
}

/** One timesheet per employee per week (weekStart = Monday 00:00 workspace tz). */
export interface Timesheet extends Doc {
  employee: Ref<Employee>
  weekStart: Timestamp
  days?: number
}

export interface TimesheetDay extends AttachedDoc {
  date: Timestamp
  status: DayStatus
  approvers: Ref<Employee>[]
  submittedOn?: Timestamp
  approvedBy?: Ref<Employee>
  approvedOn?: Timestamp
  rejectReason?: string
  totalHours: number
  snapshot?: TimesheetLine[]
}

export interface ProjectApprovers extends Project {
  pm?: Ref<Employee>
  teamLead?: Ref<Employee>
}

export const ygTimesheetId = 'yg-timesheet' as Plugin

export default plugin(ygTimesheetId, {
  class: {
    Timesheet: '' as Ref<Class<Timesheet>>,
    TimesheetDay: '' as Ref<Class<TimesheetDay>>
  },
  mixin: {
    ProjectApprovers: '' as Ref<Mixin<ProjectApprovers>>
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
    Total: '' as IntlString,
    Draft: '' as IntlString,
    Submitted: '' as IntlString,
    Approved: '' as IntlString,
    Rejected: '' as IntlString,
    Submit: '' as IntlString,
    Recall: '' as IntlString,
    Approve: '' as IntlString,
    Reject: '' as IntlString,
    Approvals: '' as IntlString,
    RejectReason: '' as IntlString,
    Drift: '' as IntlString,
    PM: '' as IntlString,
    TeamLead: '' as IntlString,
    Days: '' as IntlString,
    NoApprover: '' as IntlString
  }
})
