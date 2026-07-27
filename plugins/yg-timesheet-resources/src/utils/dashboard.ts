// Pure aggregation for the PM dashboard. No platform deps -> unit-testable. Dashboard.svelte maps
// live query results to these plain shapes (mapping Huly status.category -> Cat, TimeSpendReport ->
// DashTime, etc.) and feeds them in, so all math is tested in isolation from queries/rendering.
export type Cat = 'unstarted' | 'todo' | 'active' | 'won' | 'lost'

export interface DashIssue {
  id: string; identifier: string; title: string; project: string
  cat: Cat; assignee: string | null; priority: number; dueDate: number | null
}
export interface DashTime { issue: string; project: string; employee: string; date: number; hours: number }
export interface DashProject { id: string; name: string }
export interface ProjectStat { project: string; name: string; open: number; inProgress: number; done: number; hours: number; members: number }
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

export function projectStats (issues: DashIssue[], times: DashTime[], projects: DashProject[]): ProjectStat[] {
  return projects.map((p) => {
    const pi = issues.filter((i) => i.project === p.id)
    const pt = times.filter((t) => t.project === p.id)
    return {
      project: p.id,
      name: p.name,
      open: pi.filter((i) => isOpen(i.cat)).length,
      inProgress: pi.filter((i) => i.cat === 'active').length,
      done: pi.filter((i) => i.cat === 'won').length,
      hours: round2(pt.reduce((s, t) => s + t.hours, 0)),
      members: new Set(pt.map((t) => t.employee)).size
    }
  })
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
