//
// Export periods for the HR reports: a week or a calendar month, reduced to a plain list of
// local day keys. Pure — no platform deps → unit-testable.
//
// Day lists are built by incrementing a local Date (never by adding 86400000ms), so a period
// spanning a DST transition still yields exactly one key per calendar day. Same convention as
// weekRange()/buildOverviewGrid() in this package.
//
import { localDayKey, type DayKey } from './week'

export type PeriodKind = 'week' | 'month'

export interface Period {
  kind: PeriodKind
  start: number // inclusive
  end: number // exclusive
  days: DayKey[]
  label: string // 'YYYY-MM-DD' (week, its Monday) | 'YYYY-MM' (month) — used in filenames
}

function daysBetween (startMs: number, count: number): DayKey[] {
  const out: DayKey[] = []
  const d = new Date(startMs)
  for (let i = 0; i < count; i++) {
    const dd = new Date(d)
    dd.setDate(d.getDate() + i)
    out.push(localDayKey(dd.getTime()))
  }
  return out
}

export function weekPeriod (dateMs: number): Period {
  const d = new Date(dateMs)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() // 0 Sun .. 6 Sat
  const backToMonday = dow === 0 ? 6 : dow - 1
  const monday = new Date(d)
  monday.setDate(d.getDate() - backToMonday)
  const end = new Date(monday)
  end.setDate(monday.getDate() + 7)
  return {
    kind: 'week',
    start: monday.getTime(),
    end: end.getTime(),
    days: daysBetween(monday.getTime(), 7),
    label: localDayKey(monday.getTime())
  }
}

export function monthPeriod (year: number, month0: number): Period {
  const first = new Date(year, month0, 1)
  first.setHours(0, 0, 0, 0)
  const end = new Date(year, month0 + 1, 1)
  end.setHours(0, 0, 0, 0)
  // Day count from the calendar, not from arithmetic on ms (DST-safe).
  const count = new Date(year, month0 + 1, 0).getDate()
  const mm = `${month0 + 1}`.padStart(2, '0')
  return {
    kind: 'month',
    start: first.getTime(),
    end: end.getTime(),
    days: daysBetween(first.getTime(), count),
    label: `${year}-${mm}`
  }
}

/** True for Saturday/Sunday. Parses the key directly so it stays timezone-independent. */
export function isWeekendKey (k: DayKey): boolean {
  const [y, m, d] = k.split('-').map((n) => parseInt(n, 10))
  const dow = new Date(y, m - 1, d).getDay()
  return dow === 0 || dow === 6
}

export function weekdayCount (p: Period): number {
  return p.days.filter((k) => !isWeekendKey(k)).length
}
