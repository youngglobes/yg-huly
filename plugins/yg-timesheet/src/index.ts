//
// YoungGlobes: timesheet plugin ids.
//
import type { Employee } from '@hcengineering/contact'
import { type AttachedDoc, type Class, type Doc, type Mixin, type Ref, type Space, type Timestamp } from '@hcengineering/core'
import type { Asset, IntlString, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { Issue, Project, TimeSpendReport } from '@hcengineering/tracker'
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

/** Denormalized mirror of a TimeSpendReport, readable by HR (see hr-timesheet spec). */
export interface HrTimeEntry extends Doc {
  source: Ref<TimeSpendReport>
  employee: Ref<Employee>
  date: Timestamp
  hours: number
  project: Ref<Project>
  projectName: string
  issue: Ref<Issue>
  identifier: string
  title: string
  note: string
}

export const ygTimesheetId = 'yg-timesheet' as Plugin

export default plugin(ygTimesheetId, {
  class: {
    Timesheet: '' as Ref<Class<Timesheet>>,
    TimesheetDay: '' as Ref<Class<TimesheetDay>>,
    HrTimeEntry: '' as Ref<Class<HrTimeEntry>>
  },
  mixin: {
    ProjectApprovers: '' as Ref<Mixin<ProjectApprovers>>
  },
  space: {
    Timesheets: '' as Ref<Space>,
    HrData: '' as Ref<Space>
  },
  app: {
    Timesheet: '' as Ref<Doc>,
    HumanResource: '' as Ref<Doc>
  },
  component: {
    Timesheet: '' as AnyComponent,
    TimesheetApp: '' as AnyComponent,
    ProjectApproversEditor: '' as AnyComponent,
    Approvals: '' as AnyComponent,
    Reports: '' as AnyComponent,
    HrApp: '' as AnyComponent,
    HrTimesheet: '' as AnyComponent,
    HrRoster: '' as AnyComponent
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
    ApproveWeek: '' as IntlString,
    Reject: '' as IntlString,
    Approvals: '' as IntlString,
    NothingToApprove: '' as IntlString,
    RejectReason: '' as IntlString,
    Drift: '' as IntlString,
    PM: '' as IntlString,
    TeamLead: '' as IntlString,
    Days: '' as IntlString,
    NoApprover: '' as IntlString,
    Projects: '' as IntlString,
    Reports: '' as IntlString,
    From: '' as IntlString,
    To: '' as IntlString,
    Project: '' as IntlString,
    Member: '' as IntlString,
    Status: '' as IntlString,
    GroupBy: '' as IntlString,
    Detail: '' as IntlString,
    Employees: '' as IntlString,
    All: '' as IntlString,
    ExportCsv: '' as IntlString,
    TotalHours: '' as IntlString,
    Entries: '' as IntlString,
    NoData: '' as IntlString,
    Date: '' as IntlString,
    Employee: '' as IntlString,
    Issue: '' as IntlString,
    Description: '' as IntlString,
    Hours: '' as IntlString,
    Week: '' as IntlString,
    Day: '' as IntlString,
    Month: '' as IntlString,
    HulyId: '' as IntlString,
    Estimated: '' as IntlString,
    Spent: '' as IntlString,
    Priority: '' as IntlString,
    DueDate: '' as IntlString,
    Notes: '' as IntlString,
    RowsPerPage: '' as IntlString,
    HumanResource: '' as IntlString,
    HrTimesheets: '' as IntlString,
    HrRoster: '' as IntlString,
    HrOverview: '' as IntlString,
    Worker: '' as IntlString,
    WorkingDays: '' as IntlString,
    Target: '' as IntlString,
    NoEmployeeSelected: '' as IntlString
  }
})
