//
// Wide CSV for the HR Overview: one row per employee, one column per day in the period.
// Pure — no platform deps → unit-testable.
//
// Wide (not long) on purpose: this mirrors the grid HR reviews on screen. The long/pivot-friendly
// shape is already served by the PM report export (utils/reports.ts).
//
import { esc, escText } from './csv'
import type { DayKey } from './week'
import type { Period } from './period'
import type { OverviewRow } from './hr-report'

/**
 * Day column header, e.g. `Mon 20`. The month is deliberately omitted — it is already in the
 * filename (`yg-overview-monthly-2026-07.csv`), and repeating it in all 31 headers is noise.
 * Locale-aware, matching the Intl usage in HrOverview.svelte's on-screen headers.
 */
export function formatDayHeader (key: DayKey): string {
  const [y, m, d] = key.split('-').map((n) => parseInt(n, 10))
  const date = new Date(y, m - 1, d)
  const dow = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)
  return `${dow} ${d}`
}

/**
 * Hours as `h:mm` (1.5 -> `1:30`), so HR reads the file the same way they read the grid.
 *
 * NOT `hh.mm` (1.30) and NOT raw decimals: `1.30` would be read by a spreadsheet as the number
 * 1.3, so a column of them sums to a silently wrong total — unacceptable in a file that gets
 * emailed on for reconciliation. `h:mm` stays readable AND sums correctly when the column is
 * formatted as `[h]:mm`. Emitted unquoted so spreadsheets parse it as a time value.
 */
export function formatHm (hours: number): string {
  const totalMin = Math.round(hours * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

export function overviewToCSV (rows: OverviewRow[], period: Period): string {
  const header = ['Employee', ...period.days.map(formatDayHeader), 'Total'].map(esc).join(',')

  const body = rows.map((r) =>
    [escText(r.name), ...r.days.map(formatHm), formatHm(r.total)].join(',')
  )

  // Org-wide totals row.
  const dayTotals = period.days.map((_, i) => rows.reduce((sum, r) => sum + (r.days[i] ?? 0), 0))
  const grand = rows.reduce((sum, r) => sum + r.total, 0)
  const totals = [esc('Total'), ...dayTotals.map(formatHm), formatHm(grand)].join(',')

  return `${header}\n${[...body, totals].join('\n')}\n`
}

export function overviewFilename (period: Period): string {
  const kind = period.kind === 'week' ? 'weekly' : 'monthly'
  return `yg-overview-${kind}-${period.label}.csv`
}
