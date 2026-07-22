//
// Wide CSV for the HR Overview: one row per employee, one column per day in the period.
// Pure — no platform deps → unit-testable.
//
// Wide (not long) on purpose: this mirrors the grid HR reviews on screen. The long/pivot-friendly
// shape is already served by the PM report export (utils/reports.ts).
//
import { esc, escText } from './csv'
import type { Period } from './period'
import type { OverviewRow } from './hr-report'

const SHORTFALL_HEADER = 'Shortfall (vs 8h × weekdays)'

export function overviewToCSV (rows: OverviewRow[], period: Period): string {
  const header = ['Employee', ...period.days, 'Total', SHORTFALL_HEADER].map(esc).join(',')

  const body = rows.map((r) =>
    [escText(r.name), ...r.days.map((h) => String(h)), String(r.total), String(r.shortfall)].join(',')
  )

  // Org-wide totals. The shortfall column is intentionally blank: summing individual shortfalls
  // across employees is not a meaningful org number, and a figure there invites misreading.
  const dayTotals = period.days.map((_, i) => rows.reduce((sum, r) => sum + (r.days[i] ?? 0), 0))
  const grand = rows.reduce((sum, r) => sum + r.total, 0)
  const totals = [esc('Total'), ...dayTotals.map((n) => String(n)), String(grand), ''].join(',')

  return `${header}\n${[...body, totals].join('\n')}\n`
}

export function overviewFilename (period: Period): string {
  const kind = period.kind === 'week' ? 'weekly' : 'monthly'
  return `yg-overview-${kind}-${period.label}.csv`
}
