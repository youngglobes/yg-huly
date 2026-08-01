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

export function localDayKey (ms: number): DayKey {
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

export interface PeriodRange { start: number, end: number }

// First-of-month (inclusive) .. first-of-next-month (exclusive) for the month containing dateMs.
export function monthRange (dateMs: number): PeriodRange {
  const d = new Date(dateMs)
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
  }
}

// Resolve a dashboard period preset to a [start, end) ms range.
//   'thisWeek' (default) | 'lastWeek' | 'thisMonth' | 'custom' (fromStr/toStr = yyyy-mm-dd).
// An empty/invalid custom range falls back to this week.
export function periodRange (preset: string, fromStr: string, toStr: string, nowMs: number): PeriodRange {
  if (preset === 'lastWeek') {
    const lw = weekRange(nowMs - 7 * 24 * 60 * 60 * 1000)
    return { start: lw.start, end: lw.end }
  }
  if (preset === 'thisMonth') return monthRange(nowMs)
  if (preset === 'custom') {
    const s = new Date(fromStr).getTime()
    const e = new Date(toStr).getTime()
    if (!isNaN(s) && !isNaN(e) && e >= s) return { start: s, end: e + 24 * 60 * 60 * 1000 } // inclusive end day
  }
  const w = weekRange(nowMs)
  return { start: w.start, end: w.end }
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
    g.issues.sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }))
    return g
  })
  return { days, weekTotal }
}

export function formatHours (n: number): string {
  if (n === 0) return '0h'
  let h = Math.floor(n)
  let m = Math.round((n - h) * 60)
  if (m === 60) {
    h += 1
    m = 0
  }
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

// YoungGlobes work week: Mon-Fri, plus ODD Saturdays (the 1st/3rd/5th Saturday of the month). Even
// Saturdays (2nd/4th) and Sundays are holidays. "Odd/even" = the Saturday's ordinal within its
// month, ceil(dayOfMonth / 7).
export function isOddSaturday (dateMs: number): boolean {
  const d = new Date(dateMs)
  if (d.getDay() !== 6) return false
  return Math.ceil(d.getDate() / 7) % 2 === 1
}

export function isWorkingDay (dateMs: number): boolean {
  const dow = new Date(dateMs).getDay() // 0 Sun .. 6 Sat
  if (dow === 0) return false // Sunday off
  if (dow === 6) return isOddSaturday(dateMs) // Saturday: only odd ones
  return true // Mon-Fri
}

// The most recent completed working day STRICTLY before today (today is excluded - timesheets are
// submitted at end of day, so today's is not in yet). Walks back day by day; bounded so it always
// terminates. Returns local midnight of that day.
export function lastWorkingDay (nowMs: number): number {
  const t = new Date(nowMs)
  const midnight = new Date(t.getFullYear(), t.getMonth(), t.getDate())
  for (let i = 1; i <= 14; i++) {
    const d = new Date(midnight)
    d.setDate(midnight.getDate() - i)
    if (isWorkingDay(d.getTime())) return d.getTime()
  }
  return midnight.getTime() // unreachable in practice (a working day always exists within 14 days)
}
