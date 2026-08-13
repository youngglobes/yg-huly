//
// YoungGlobes: timesheet plugin ids.
//
import type { Employee } from '@hcengineering/contact'
import { type AttachedDoc, type Class, type Client, type Doc, type Mixin, type Ref, type Space, type Timestamp } from '@hcengineering/core'
import type { Asset, IntlString, Plugin, Resource } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { Issue, Project, TimeSpendReport } from '@hcengineering/tracker'
import type { AnyComponent, Location, ResolvedLocation } from '@hcengineering/ui'

export type DayStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected'

/**
 * Status of one approvable unit (a task). Same four values the day used to carry.
 * `PartiallyApproved` is deliberately NOT here: it is only ever DERIVED for a day.
 */
export type TaskStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected'

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

/** Per-task (one issue per day) approval record — the unit an approver actions. */
export interface TimesheetTask extends AttachedDoc {
  date: Timestamp
  issue: Ref<Issue>
  identifier: string
  title: string
  project: Ref<Project>
  submittedHours: number
  status: TaskStatus
  /** PM + Team Lead of THIS task's project only, minus the employee. Stamped at submit time. */
  approvers: Ref<Employee>[]
  submittedOn?: Timestamp
  rejectReason?: string
  approvedHours?: number
  approvedBy?: Ref<Employee>
  approvedOn?: Timestamp
}

/**
 * The approval overlay for one task. Lives in the PRIVATE ygTimesheet.space.Approvals so employees
 * cannot read it — approved hours are for the PM-report audience and are discussed with the
 * employee at the weekly meeting, not shown on their own sheet.
 *
 * approvedBy / approvedOn are optional (same idiom as TimesheetDay/TimesheetTask's own stamps):
 * the CLIENT creates/updates this doc with `task` + `approvedHours` only — the server trigger
 * stamps approvedBy/approvedOn authoritatively, same division of labour as the task-level flow.
 */
export interface TimesheetApproval extends Doc {
  task: Ref<TimesheetTask>
  approvedHours: number
  approvedBy?: Ref<Employee>
  approvedOn?: Timestamp
}

/**
 * One reject/resubmit round for a single (employee, issue, date) unit of work.
 *
 * Deliberately NOT keyed by Ref<TimesheetTask>: submitDay deletes and recreates task rows on every
 * resubmit (yg-timesheet-resources utils/day.ts), so a task ref would orphan the history. The
 * employee+issue+date triple is stable across that churn, which is the whole reason this is a
 * separate doc rather than an array on the task.
 *
 * World-readable (core.space.Workspace), matching where rejectReason already lives on
 * TimesheetTask. Deliberate, see the 2026-08-05 approval-recycle design.
 */
export interface TimesheetRejectCycle extends Doc {
  employee: Ref<Employee>
  issue: Ref<Issue>
  /** Local midnight, same convention as TimesheetTask.date. */
  date: Timestamp
  rejectReason: string
  /** Absent on rows written by the backfill: the old task never stored who rejected it. */
  rejectedBy?: Ref<Employee>
  rejectedOn: Timestamp
  /** The employee's reply, captured at resubmit. Optional by design. */
  resubmitNote?: string
  /** Absent = the cycle is still open (rejected, not yet resubmitted). */
  resubmittedOn?: Timestamp
}

export interface ProjectApprovers extends Project {
  pm?: Ref<Employee>[]
  teamLead?: Ref<Employee>[]
}

export type WorkDesignation =
  | 'Software Engineer Trainee' | 'Associate Software Engineer' | 'Senior Software Engineer'
  | 'Team Leader' | 'Project Manager' | 'Software Test Engineer' | 'Senior Software Tester'
  | 'Web Designer' | 'Front End Developer' | 'Senior Front End Developer'
  | 'SEO Analyst Trainee' | 'SEO Analyst' | 'Senior SEO Analyst'
  | 'Business Development Executive' | 'Senior Business Development Executive'
  | 'Business Development Manager' | 'Salesforce Developer' | 'Senior Salesforce Developer'
  | 'Lead Generation Executive' | 'CEO' | 'CTO' | 'COO' | 'HR Executive' | 'Intern'
export type WorkDepartment = 'Development' | 'Testing' | 'SEO' | 'Sales' | 'HR'
export interface WorkProfile extends Employee {
  designation?: WorkDesignation
  department?: WorkDepartment
  // Free text, e.g. "YGS0024".
  employeeId?: string
  // Local time-of-day the employee is expected to start, in minutes since midnight (540 = 09:00).
  shiftStart?: number
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

/** Office vs work-from-home, set at punch-in and immutable thereafter. */
export type AttendanceMode = 'office' | 'wfh'

/**
 * One attendance session - a punch-in, later closed by a punch-out. Client-written,
 * immutable in the UI (v1): the only writes are create (punch in) and set punchOut/
 * punchOutNote (punch out). Duration is derived (punchOut - punchIn), never stored.
 */
export interface AttendanceSession extends Doc {
  employee: Ref<Employee>
  date: Timestamp // local midnight (ms) of the punch-in day - for day grouping/history
  punchIn: Timestamp // full ms timestamp of punch-in
  punchInNote?: string // optional note captured at punch-in
  mode: AttendanceMode // set at punch-in; immutable
  punchOut?: Timestamp // full ms timestamp of punch-out; absent while the session is open
  punchOutNote?: string // optional note captured at punch-out
  device?: string      // parsed from userAgent at punch-in
  browser?: string
  userAgent?: string   // raw, for audit
  ip?: string          // self-reported public IP
  ipCity?: string      // coarse "City, Region, Country" from the geo-IP call
  geoLat?: number      // GPS (when granted on a secure context)
  geoLng?: number
  geoAccuracy?: number // metres
}

/** An org-wide holiday (one per day). Non-working everywhere via isWorkingDay. */
export interface Holiday extends Doc {
  date: Timestamp // local midnight (ms) of the holiday day
  name: string    // e.g. "Diwali"
}

export type LatePermissionStatus = 'Pending' | 'Approved' | 'Rejected'

/** One per late day: a punch-in after the employee's shiftStart, with a reason HR approves/rejects. */
export interface LatePermission extends Doc {
  employee: Ref<Employee>
  date: Timestamp            // local midnight of the late day (same key as AttendanceSession.date)
  punchIn: Timestamp         // full ms of the triggering first punch-in
  shiftStartSnapshot: number // minutes since midnight, snapshot at creation
  minutesLate: number        // snapshot: punch-in time-of-day minus shiftStartSnapshot
  reason: string
  status: LatePermissionStatus
  approvedBy?: Ref<Employee>
  approvedOn?: Timestamp
  rejectReason?: string
}

/** Org-wide punch-reminder settings. Singleton (zero or one doc); code falls back to defaults when absent. */
export interface AttendanceReminderSettings extends Doc {
  enabled: boolean
  windowStartMin: number
  windowEndMin: number
  days: number[]
  punchInDelayMin: number
  repeatMin: number
  punchOutIdleMin: number
}

export const ygTimesheetId = 'yg-timesheet' as Plugin

export default plugin(ygTimesheetId, {
  class: {
    Timesheet: '' as Ref<Class<Timesheet>>,
    TimesheetDay: '' as Ref<Class<TimesheetDay>>,
    TimesheetTask: '' as Ref<Class<TimesheetTask>>,
    TimesheetApproval: '' as Ref<Class<TimesheetApproval>>,
    TimesheetRejectCycle: '' as Ref<Class<TimesheetRejectCycle>>,
    HrTimeEntry: '' as Ref<Class<HrTimeEntry>>,
    AttendanceSession: '' as Ref<Class<AttendanceSession>>,
    AttendanceReminderSettings: '' as Ref<Class<AttendanceReminderSettings>>,
    Holiday: '' as Ref<Class<Holiday>>,
    LatePermission: '' as Ref<Class<LatePermission>>
  },
  mixin: {
    ProjectApprovers: '' as Ref<Mixin<ProjectApprovers>>,
    WorkProfile: '' as Ref<Mixin<WorkProfile>>
  },
  space: {
    Timesheets: '' as Ref<Space>,
    HrData: '' as Ref<Space>,
    Approvals: '' as Ref<Space>
  },
  app: {
    Timesheet: '' as Ref<Doc>,
    HumanResource: '' as Ref<Doc>,
    Attendance: '' as Ref<Doc>,
    Dashboard: '' as Ref<Doc>
  },
  component: {
    Timesheet: '' as AnyComponent,
    ProjectApproversEditor: '' as AnyComponent,
    Approvals: '' as AnyComponent,
    Reports: '' as AnyComponent,
    HrTimesheet: '' as AnyComponent,
    HrRoster: '' as AnyComponent,
    HrOverview: '' as AnyComponent,
    HrExportDialog: '' as AnyComponent,
    ApproveTaskPopup: '' as AnyComponent,
    RejectTaskPopup: '' as AnyComponent,
    NotificationRedirect: '' as AnyComponent,
    Dashboard: '' as AnyComponent,
    MyAttendance: '' as AnyComponent,
    HrAttendance: '' as AnyComponent,
    AttendanceReminder: '' as AnyComponent,
    AttendanceReminderSettings: '' as AnyComponent,
    DashboardHome: '' as AnyComponent,
    WorkProfileEditor: '' as AnyComponent,
    Performance: '' as AnyComponent,
    HrHolidays: '' as AnyComponent,
    HrLatePermissions: '' as AnyComponent
  },
  icon: {
    Timesheet: '' as Asset
  },
  string: {
    Timesheet: '' as IntlString,
    MyTimesheet: '' as IntlString,
    Today: '' as IntlString,
    Total: '' as IntlString,
    Draft: '' as IntlString,
    Submitted: '' as IntlString,
    Approved: '' as IntlString,
    Rejected: '' as IntlString,
    Submit: '' as IntlString,
    Resubmit: '' as IntlString,
    Recall: '' as IntlString,
    Approve: '' as IntlString,
    Reapprove: '' as IntlString,
    ApproveWeek: '' as IntlString,
    Reject: '' as IntlString,
    Approvals: '' as IntlString,
    NothingToApprove: '' as IntlString,
    RejectReason: '' as IntlString,
    PM: '' as IntlString,
    TeamLead: '' as IntlString,
    Days: '' as IntlString,
    NoApprover: '' as IntlString,
    Projects: '' as IntlString,
    Configuration: '' as IntlString,
    Reports: '' as IntlString,
    From: '' as IntlString,
    To: '' as IntlString,
    Period: '' as IntlString,
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
    HrRosterDesc: '' as IntlString,
    HrOverview: '' as IntlString,
    Worker: '' as IntlString,
    WorkingDays: '' as IntlString,
    Target: '' as IntlString,
    NoEmployeeSelected: '' as IntlString,
    Export: '' as IntlString,
    ExportPeriod: '' as IntlString,
    PeriodWeekly: '' as IntlString,
    PeriodMonthly: '' as IntlString,
    SelectWeek: '' as IntlString,
    SelectMonth: '' as IntlString,
    ApprovedHours: '' as IntlString,
    SubmittedHours: '' as IntlString,
    ApproveTask: '' as IntlString,
    RejectTask: '' as IntlString,
    PartiallyApproved: '' as IntlString,
    Reset: '' as IntlString,
    AllProjects: '' as IntlString,
    AllMembers: '' as IntlString,
    SelectedCount: '' as IntlString,
    ApprovalNotification: '' as IntlString,
    Dashboard: '' as IntlString,
    InProgress: '' as IntlString,
    PendingApproval: '' as IntlString,
    HoursThisWeek: '' as IntlString,
    Overdue: '' as IntlString,
    ProjectsYouHandle: '' as IntlString,
    InProgressTasks: '' as IntlString,
    DueThisWeek: '' as IntlString,
    IssuesByStatus: '' as IntlString,
    HoursByProject: '' as IntlString,
    NothingWaiting: '' as IntlString,
    NoOverdue: '' as IntlString,
    Assignee: '' as IntlString,
    Unassigned: '' as IntlString,
    Inbox: '' as IntlString,
    InboxEmpty: '' as IntlString,
    TeamWorkload: '' as IntlString,
    PriorityWatch: '' as IntlString,
    Attendance: '' as IntlString,
    MyAttendance: '' as IntlString,
    PunchIn: '' as IntlString,
    PunchOut: '' as IntlString,
    Office: '' as IntlString,
    WFH: '' as IntlString,
    AddNote: '' as IntlString,
    In: '' as IntlString,
    Out: '' as IntlString,
    Duration: '' as IntlString,
    History: '' as IntlString,
    TodaysSessions: '' as IntlString,
    NoSessionsToday: '' as IntlString,
    NoSessionsOnDate: '' as IntlString,
    OnTheClock: '' as IntlString,
    NotPunchedIn: '' as IntlString,
    Sessions: '' as IntlString,
    FirstIn: '' as IntlString,
    LastOut: '' as IntlString,
    YourDay: '' as IntlString,
    Type: '' as IntlString,
    HrAttendance: '' as IntlString,
    AllEmployees: '' as IntlString,
    Individual: '' as IntlString,
    DaysPresent: '' as IntlString,
    OfficeHours: '' as IntlString,
    WfhHours: '' as IntlString,
    InNow: '' as IntlString,
    ReminderSettings: '' as IntlString,
    PunchReminders: '' as IntlString,
    EnableReminders: '' as IntlString,
    DisableReminders: '' as IntlString,
    RemindersOn: '' as IntlString,
    RemindersOff: '' as IntlString,
    ReminderPunchInTitle: '' as IntlString,
    ReminderPunchInBody: '' as IntlString,
    ReminderPunchOutTitle: '' as IntlString,
    ReminderPunchOutBody: '' as IntlString,
    Snooze: '' as IntlString,
    WorkWindow: '' as IntlString,
    WorkDays: '' as IntlString,
    PunchInDelay: '' as IntlString,
    RepeatEvery: '' as IntlString,
    PunchOutIdle: '' as IntlString,
    Minutes: '' as IntlString,
    Enabled: '' as IntlString,
    MyAttendanceToday: '' as IntlString,
    MyTasks: '' as IntlString,
    MyHoursThisWeek: '' as IntlString,
    HrDashboard: '' as IntlString,
    Headcount: '' as IntlString,
    PresentToday: '' as IntlString,
    WfhOffice: '' as IntlString,
    NotLoggedThisWeek: '' as IntlString,
    TimesheetSubmissions: '' as IntlString,
    AttendanceToday: '' as IntlString,
    TimesheetCompliance: '' as IntlString,
    OfficeVsWfh: '' as IntlString,
    HoursByPerson: '' as IntlString,
    NotSubmitted: '' as IntlString,
    LastActive: '' as IntlString,
    DaysLogged: '' as IntlString,
    Performance: '' as IntlString,
    OffDayWork: '' as IntlString,
    OvertimeCol: '' as IntlString,
    LateNightCol: '' as IntlString,
    TotalExtraHours: '' as IntlString,
    TeamProfiles: '' as IntlString,
    ShiftStart: '' as IntlString,
    Designation: '' as IntlString,
    Department: '' as IntlString,
    EmployeeId: '' as IntlString,
    Holidays: '' as IntlString,
    AddHoliday: '' as IntlString,
    HolidayName: '' as IntlString,
    RemoveHoliday: '' as IntlString,
    EmptyHolidays: '' as IntlString,
    LatePermissions: '' as IntlString,
    LateArrivals: '' as IntlString,
    LateStatusLate: '' as IntlString,
    LateStatusExcused: '' as IntlString,
    LateStatusPending: '' as IntlString,
    LateReasonLabel: '' as IntlString,
    LateReasonPlaceholder: '' as IntlString,
    ApproveLate: '' as IntlString,
    RejectLate: '' as IntlString,
    MinutesLate: '' as IntlString,
    NoLatePermissions: '' as IntlString,
    LatePermissionsIntro: '' as IntlString,
    Reason: '' as IntlString
  },
  function: {
    CanApprove: '' as Resource<(spaces: Space[]) => Promise<boolean>>,
    // view.mixin.ObjectTitle provider for TimesheetDay - supplies the Inbox card's subtitle (the
    // sheet date), under the @UX class-label title ("Timesheet"). Signature per getDocTitle.
    TimesheetDayTitle: '' as Resource<(client: Client, id: Ref<Doc>, doc?: Doc) => Promise<string>>,
    // May the current user create a project? Owner OR HR-space member OR PM/TeamLead on any
    // project OR leadership designation (WorkProfile). Consumed by core tracker-resources and
    // workbench-resources to hide the "Create project" affordance - imported as this PLUGIN only
    // (never yg-timesheet-resources) so those core packages stay free of a circular dependency.
    CanCreateProject: '' as Resource<() => Promise<boolean>>
  },
  resolver: {
    Location: '' as Resource<(loc: Location) => Promise<ResolvedLocation | undefined>>,
    AttendanceLocation: '' as Resource<(loc: Location) => Promise<ResolvedLocation | undefined>>
  }
})
