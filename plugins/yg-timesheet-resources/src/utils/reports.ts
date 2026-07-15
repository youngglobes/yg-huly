import { localDayKey } from './week'

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
}

// status here = the issue's workflow-status NAME (not the timesheet approval status).
export interface ReportFilter { from: number; to: number; project?: string; member?: string; status?: string }

export function filterRows (rows: ReportRow[], f: ReportFilter): ReportRow[] {
  return rows.filter((r) =>
    r.date >= f.from && r.date < f.to &&
    (f.project == null || r.project === f.project) &&
    (f.member == null || r.employee === f.member) &&
    (f.status == null || r.statusName === f.status)
  )
}

// IssuePriority enum order: NoPriority, Urgent, High, Medium, Low (tracker/src/index.ts).
export const PRIORITY_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low']
export function priorityLabel (p: number): string {
  return PRIORITY_LABELS[p] ?? PRIORITY_LABELS[0]
}

// CSV export — everything, including the Issue Title (the on-screen table shows the linked id
// only). Hours are emitted as decimals (spreadsheet-friendly, matches the team's sheet); dates
// as YYYY-MM-DD; due date blank when unset.
const COLS = [
  'Date', 'Employee', 'Project', 'Huly ID', 'Issue Title',
  'Estimated', 'Spent', 'Status', 'Priority', 'Due date', 'Notes'
]
function esc (v: string): string { return `"${v.replace(/"/g, '""')}"` }
// Cells whose first char could be interpreted as a spreadsheet formula (=, +, -, @) or a
// tab/CR (used in some formula-injection payloads) get apostrophe-prefixed before quoting,
// so opening the CSV in Excel/Sheets doesn't execute attacker-controlled text as a formula.
const RISKY_PREFIX = /^[=+\-@\t\r]/
function escText (v: string): string {
  return esc(RISKY_PREFIX.test(v) ? `'${v}` : v)
}
export function toCSV (rows: ReportRow[]): string {
  const head = COLS.join(',')
  if (rows.length === 0) return `${head}\n`
  const body = rows.map((r) => [
    esc(localDayKey(r.date)),
    escText(r.employeeName || r.employee),
    escText(r.projectName || r.project),
    escText(r.identifier),
    escText(r.title),
    String(r.estimation),
    String(r.hours),
    escText(r.statusName),
    escText(priorityLabel(r.priority)),
    r.dueDate != null ? esc(localDayKey(r.dueDate)) : '""',
    escText(r.note)
  ].join(',')).join('\n')
  return `${head}\n${body}\n`
}
