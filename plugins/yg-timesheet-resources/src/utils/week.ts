//
// Pure week/grouping helpers for the timesheet view. No platform deps → unit-testable.
//
export type DayKey = string // YYYY-MM-DD (local)

export interface WeekRange {
  start: number
  end: number
  days: { key: DayKey, date: number }[]
}

export interface ReportLike {
  employee: string | null
  date: number | null
  value: number
  issueId: string
  issueIdentifier: string
  issueTitle: string
  project: string
}

export interface DayGroup {
  key: DayKey
  date: number
  total: number
  issues: { issueId: string, identifier: string, title: string, project: string, hours: number }[]
}

function localDayKey (ms: number): DayKey {
  const d = new Date(ms)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function weekRange (dateMs: number): WeekRange {
  const d = new Date(dateMs)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() // 0 Sun .. 6 Sat
  const backToMonday = dow === 0 ? 6 : dow - 1
  const monday = new Date(d)
  monday.setDate(d.getDate() - backToMonday)
  const days: { key: DayKey, date: number }[] = []
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday)
    dd.setDate(monday.getDate() + i)
    days.push({ key: localDayKey(dd.getTime()), date: dd.getTime() })
  }
  const end = new Date(monday)
  end.setDate(monday.getDate() + 7)
  return { start: monday.getTime(), end: end.getTime(), days }
}

export function groupByDay (reports: ReportLike[], week: WeekRange): { days: DayGroup[], weekTotal: number } {
  const byKey = new Map<DayKey, DayGroup>()
  for (const d of week.days) {
    byKey.set(d.key, { key: d.key, date: d.date, total: 0, issues: [] })
  }
  let weekTotal = 0
  for (const r of reports) {
    if (r.employee == null || r.date == null) continue
    const key = localDayKey(r.date)
    const grp = byKey.get(key)
    if (grp === undefined) continue // outside the week
    let issue = grp.issues.find((i) => i.issueId === r.issueId)
    if (issue === undefined) {
      issue = { issueId: r.issueId, identifier: r.issueIdentifier, title: r.issueTitle, project: r.project, hours: 0 }
      grp.issues.push(issue)
    }
    issue.hours += r.value
    grp.total += r.value
    weekTotal += r.value
  }
  const days = week.days.map((d) => {
    const g = byKey.get(d.key) as DayGroup
    g.issues.sort((a, b) => a.identifier.localeCompare(b.identifier))
    return g
  })
  return { days, weekTotal }
}

export function formatHours (n: number): string {
  if (n === 0) return '0h'
  const h = Math.floor(n)
  const m = Math.round((n - h) * 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}
