// Pure aggregation for the PM dashboard. No platform deps -> unit-testable. Dashboard.svelte maps
// live query results to these plain shapes (mapping Huly status.category -> Cat, TimeSpendReport ->
// DashTime, etc.) and feeds them in, so all math is tested in isolation from queries/rendering.
import type { WorkDesignation } from '@hcengineering/yg-timesheet'

export type Cat = 'unstarted' | 'todo' | 'active' | 'won' | 'lost'

export interface DashIssue {
  id: string; identifier: string; title: string; project: string
  // cat = coarse status category (used for open/done/overdue logic). status = the real status NAME
  // (e.g. "In Progress", "In Testing", "In Review") - many custom statuses share the 'active' cat,
  // so the per-status breakdown must key off the name, not the category.
  cat: Cat; status: string; assignee: string | null; priority: number; dueDate: number | null
  // estimation = planned hours on the issue; reportedTime = all-time logged hours (aggregated by
  // tracker on the Issue itself), so the budget view needs no separate time-report query.
  estimation: number; reportedTime: number
}
export interface DashTime { issue: string; project: string; employee: string; date: number; hours: number }
export interface DashProject { id: string; name: string }
export interface ProjectStat {
  project: string; name: string; open: number; inProgress: number; done: number
  // byStatus: count of OPEN issues per real status name (e.g. { 'Todo': 4, 'In Progress': 3 }).
  // Feeds the per-status columns; the coarse inProgress/done stay for KPIs/back-compat.
  byStatus: Record<string, number>
  // hours = logged in the selected period; approvedHours = approved timesheet hours in that same
  // period (both react to the dashboard's period filter). estimated/spent stay all-time.
  hours: number; approvedHours: number; members: number; estimated: number; spent: number
}
export interface Kpis { inProgress: number; hoursThisWeek: number; overdue: number }

export function greetingFor (hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function isOpen (c: Cat): boolean {
  return c !== 'won' && c !== 'lost'
}

export function inProgressIssues (issues: DashIssue[]): DashIssue[] {
  return issues.filter((i) => i.cat === 'active')
}

export function todayStart (now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function overdueIssues (issues: DashIssue[], now: number): DashIssue[] {
  const start = todayStart(now)
  return issues.filter((i) => isOpen(i.cat) && i.dueDate != null && i.dueDate < start)
}

export function dueSoonIssues (issues: DashIssue[], now: number, days: number): DashIssue[] {
  const start = todayStart(now)
  const end = start + days * 24 * 60 * 60 * 1000
  return issues.filter((i) => isOpen(i.cat) && i.dueDate != null && i.dueDate >= start && i.dueDate < end)
}

export function statusBuckets (issues: DashIssue[]): Record<Cat, number> {
  const b: Record<Cat, number> = { unstarted: 0, todo: 0, active: 0, won: 0, lost: 0 }
  for (const i of issues) b[i.cat]++
  return b
}

export function hoursByProject (times: DashTime[], projects: DashProject[]): Array<{ project: string; name: string; hours: number }> {
  const sum = new Map<string, number>()
  for (const t of times) sum.set(t.project, (sum.get(t.project) ?? 0) + t.hours)
  return projects.map((p) => ({ project: p.id, name: p.name, hours: round2(sum.get(p.id) ?? 0) }))
}

// Distinct OPEN status names across the issues, ordered by workflow (backlog -> todo -> active),
// then alphabetically within a category. Drives the per-status columns and the status chart.
const CAT_ORDER: Record<Cat, number> = { unstarted: 0, todo: 1, active: 2, won: 3, lost: 4 }
export function openStatusNames (issues: DashIssue[]): string[] {
  const cat = new Map<string, Cat>()
  for (const i of issues) if (isOpen(i.cat) && !cat.has(i.status)) cat.set(i.status, i.cat)
  return [...cat.keys()].sort((a, b) => {
    const d = CAT_ORDER[cat.get(a) as Cat] - CAT_ORDER[cat.get(b) as Cat]
    return d !== 0 ? d : a.localeCompare(b)
  })
}

// Open-issue totals per status name (for the "Issues by status" chart), in openStatusNames order.
export function openStatusTotals (issues: DashIssue[]): Array<{ name: string; count: number }> {
  const c = new Map<string, number>()
  for (const i of issues) if (isOpen(i.cat)) c.set(i.status, (c.get(i.status) ?? 0) + 1)
  return openStatusNames(issues).map((n) => ({ name: n, count: c.get(n) ?? 0 }))
}

// approvedByProject: project id -> approved hours in the selected period (built in the component from
// TimesheetApproval + the approved tasks' project/date). Defaults to empty so callers that do not
// track approvals still get approvedHours: 0.
export function projectStats (
  issues: DashIssue[],
  times: DashTime[],
  projects: DashProject[],
  approvedByProject: Map<string, number> = new Map()
): ProjectStat[] {
  return projects.map((p) => {
    const pi = issues.filter((i) => i.project === p.id)
    const pt = times.filter((t) => t.project === p.id)
    const byStatus: Record<string, number> = {}
    for (const i of pi) if (isOpen(i.cat)) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1
    return {
      project: p.id,
      name: p.name,
      open: pi.filter((i) => isOpen(i.cat)).length,
      inProgress: pi.filter((i) => i.cat === 'active').length,
      done: pi.filter((i) => i.cat === 'won').length,
      byStatus,
      hours: round2(pt.reduce((s, t) => s + t.hours, 0)),
      approvedHours: round2(approvedByProject.get(p.id) ?? 0),
      members: new Set(pt.map((t) => t.employee)).size,
      estimated: round2(pi.reduce((s, i) => s + i.estimation, 0)),
      spent: round2(pi.reduce((s, i) => s + i.reportedTime, 0))
    }
  })
}

// Portfolio totals across the PM's projects: planned (estimated) vs actual (spent), for the summary
// line above the project table.
export function portfolioHours (stats: ProjectStat[]): { estimated: number; spent: number } {
  return {
    estimated: round2(stats.reduce((s, p) => s + p.estimated, 0)),
    spent: round2(stats.reduce((s, p) => s + p.spent, 0))
  }
}

export interface TeamMember { employee: string; hours: number; open: number }

// Team workload this week: for everyone who logged time (this week) OR owns an open issue on the
// PM's projects, their hours logged this week + count of open issues assigned. Sorted busiest first,
// so a PM can spot who is overloaded vs idle.
// Team this week: hours logged + open issues assigned, per member on the scoped projects. Members
// in `excludePms` (the scoped projects' pm approvers) are omitted so a lead sees the people working
// under them, not the project's PM - the PM is usually assigned issues on their own projects.
export function teamWorkload (
  issues: DashIssue[], times: DashTime[], excludePms: ReadonlySet<string> = new Set()
): TeamMember[] {
  const hours = new Map<string, number>()
  for (const t of times) if (t.employee !== '') hours.set(t.employee, (hours.get(t.employee) ?? 0) + t.hours)
  const open = new Map<string, number>()
  for (const i of issues) if (i.assignee != null && isOpen(i.cat)) open.set(i.assignee, (open.get(i.assignee) ?? 0) + 1)
  const emps = new Set<string>([...hours.keys(), ...open.keys()])
  return [...emps]
    .filter((e) => !excludePms.has(e))
    .map((e) => ({ employee: e, hours: round2(hours.get(e) ?? 0), open: open.get(e) ?? 0 }))
    .sort((a, b) => b.hours - a.hours || b.open - a.open)
}

// Priority watch: open issues at Urgent (1) or High (2) priority, most-urgent first then soonest
// due. IssuePriority enum: 0 NoPriority, 1 Urgent, 2 High, 3 Medium, 4 Low.
export function priorityWatch (issues: DashIssue[]): DashIssue[] {
  return issues
    .filter((i) => isOpen(i.cat) && (i.priority === 1 || i.priority === 2))
    .sort((a, b) => a.priority - b.priority || (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
}

// Issues assigned to a specific employee (the "me"-scope for the Employee dashboard).
export function assignedTo (issues: DashIssue[], employee: string): DashIssue[] {
  return issues.filter((i) => i.assignee === employee)
}

export function computeKpis (issues: DashIssue[], times: DashTime[], now: number): Kpis {
  return {
    inProgress: inProgressIssues(issues).length,
    hoursThisWeek: round2(times.reduce((s, t) => s + t.hours, 0)),
    overdue: overdueIssues(issues, now).length
  }
}

function round2 (n: number): number {
  return Math.round(n * 100) / 100
}

export type DashboardRole = 'pm' | 'teamLead' | 'hr' | 'employee'

export interface DashboardRoleInput {
  designation: WorkDesignation | undefined
  isAdmin: boolean
  isPmApprover: boolean
  isTlApprover: boolean
  isHr: boolean
}

// Which dashboard a user lands on. Designation is the primary signal (a single value on the user's
// WorkProfile); only the two manager designations force a manager dashboard. Everything else falls
// back to the approver config, then HR, then the plain employee view. Admins always see the PM
// dashboard (all projects). Pure so the router stays a thin shell - same idiom as canApproveView.
export function resolveDashboardRole (input: DashboardRoleInput): DashboardRole {
  if (input.isAdmin) return 'pm'
  if (input.designation === 'Team Leader') return 'teamLead'
  if (input.designation === 'Project Manager') return 'pm'
  if (input.isPmApprover) return 'pm'
  if (input.isTlApprover) return 'teamLead'
  if (input.isHr) return 'hr'
  return 'employee'
}
