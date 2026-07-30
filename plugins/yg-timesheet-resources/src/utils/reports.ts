import { localDayKey } from './week'
import { esc, escText } from './csv'

// One row per time entry (TimeSpendReport) enriched with its issue's fields. A task worked
// on across 3 days is 3 rows. This is the PM report shape (matches the team's tracking sheet).
export interface ReportRow {
  date: number
  employee: string
  employeeName: string
  project: string
  projectName: string
  issue: string
  identifier: string
  title: string
  estimation: number // issue estimate, hours
  hours: number // spent, hours (TimeSpendReport.value)
  statusName: string // issue workflow status name (Todo / In Progress / …)
  priority: number // IssuePriority enum (0..4)
  dueDate: number | null
  note: string // TimeSpendReport.description (the note on the logged time)
  approvedHours?: number // from the per-task TimesheetApproval doc (private Approvals space)
  approvedByName?: string // approver's display name, resolved from TimesheetApproval.approvedBy
}

// status here = the issue's workflow-status NAME (not the timesheet approval status).
// projects/members are multi-select: undefined or an empty array means "All" (no filtering);
// a non-empty array matches rows whose project/employee is ANY of the listed values.
export interface ReportFilter { from: number; to: number; projects?: string[]; members?: string[]; status?: string }

export function filterRows (rows: ReportRow[], f: ReportFilter): ReportRow[] {
  return rows.filter((r) =>
    r.date >= f.from && r.date < f.to &&
    (f.projects == null || f.projects.length === 0 || f.projects.includes(r.project)) &&
    (f.members == null || f.members.length === 0 || f.members.includes(r.employee)) &&
    (f.status == null || r.statusName === f.status)
  )
}

// IssuePriority enum order: NoPriority, Urgent, High, Medium, Low (tracker/src/index.ts).
export const PRIORITY_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low']
export function priorityLabel (p: number): string {
  return PRIORITY_LABELS[p] ?? PRIORITY_LABELS[0]
}

// CSV date format: DD-MM-YYYY (matches the report's From/To filter inputs; avoids Excel showing
// ########). Uses local calendar parts, same as localDayKey.
export function ddmmyyyy (ms: number): string {
  const d = new Date(ms)
  const day = `${d.getDate()}`.padStart(2, '0')
  const month = `${d.getMonth() + 1}`.padStart(2, '0')
  return `${day}-${month}-${d.getFullYear()}`
}

// CSV export — everything, including the Issue Title (the on-screen table shows the linked id
// only). Hours are emitted as decimals (spreadsheet-friendly, matches the team's sheet); dates
// as YYYY-MM-DD; due date blank when unset.
//
// Of the four approval columns after "Spent": the TL/PM pair is now DATA-DRIVEN — sourced from
// the per-task TimesheetApproval doc (private ygTimesheet.space.Approvals), keyed by issue+day.
// Non-members of that space see 0 approval rows, so their columns come out blank — that's the
// correct, intended behavior (this report's approver columns are for the approver audience).
// The Client Approved pair remains an intentionally BLANK manual-entry placeholder (separate,
// out-of-scope process): the client-approved (billable) hours + who approved each, filled in
// the sheet for now.
const COLS = [
  'Date', 'Employee', 'Project', 'Huly ID', 'Issue Title', 'Estimated', 'Spent',
  'TL/PM Approved Hours', 'TL/PM Approved By', 'Client Approved Hours', 'Client Approved By',
  'Status', 'Priority', 'Due date', 'Notes'
]
export function toCSV (rows: ReportRow[]): string {
  const head = COLS.join(',')
  if (rows.length === 0) return `${head}\n`
  const body = rows.map((r) => [
    esc(ddmmyyyy(r.date)),
    escText(r.employeeName || r.employee),
    escText(r.projectName || r.project),
    escText(r.identifier),
    escText(r.title),
    String(r.estimation),
    String(r.hours),
    r.approvedHours != null ? String(r.approvedHours) : '', // TL/PM Approved Hours (from approval)
    r.approvedByName != null ? escText(r.approvedByName) : '', // TL/PM Approved By (from approval)
    '', // Client Approved Hours — manual
    '', // Client Approved By — manual
    escText(r.statusName),
    escText(priorityLabel(r.priority)),
    r.dueDate != null ? esc(ddmmyyyy(r.dueDate)) : '""',
    escText(r.note)
  ].join(',')).join('\n')
  return `${head}\n${body}\n`
}
