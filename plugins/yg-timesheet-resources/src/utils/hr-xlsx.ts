//
// Excel (.xlsx) export of the HR Overview grid — one row per employee, one column per day in the
// period, plus an org-wide totals row (mirrors the on-screen grid and the retired wide CSV). Hours
// are written as Excel TIME values (a fraction of a day) with an `[h]:mm` format, so they display
// as `1:30` like the grid AND sum correctly — the same reasoning the CSV used for `h:mm`, but as a
// real numeric cell rather than text. Client-side via write-excel-file; `fileName` downloads it.
//
import writeXlsxFile, { type SheetData } from 'write-excel-file'
import { formatDayHeader } from './hr-csv'
import type { Period } from './period'
import type { OverviewRow } from './hr-report'

// Excel stores time as a fraction of a 24h day (1h = 1/24). `[h]:mm` lets totals exceed 24h.
const HM = '[h]:mm'
function hoursCell (h: number, bold = false): any {
  return { value: h / 24, type: Number, format: HM, ...(bold ? { fontWeight: 'bold' } : {}) }
}

export async function exportOverviewXlsx (rows: OverviewRow[], period: Period): Promise<void> {
  const dayTotals = period.days.map((_, i) => rows.reduce((sum, r) => sum + (r.days[i] ?? 0), 0))
  const grand = rows.reduce((sum, r) => sum + r.total, 0)

  const header = [
    { value: 'Employee', type: String, fontWeight: 'bold' },
    ...period.days.map((k) => ({ value: formatDayHeader(k), type: String, fontWeight: 'bold' })),
    { value: 'Total', type: String, fontWeight: 'bold' }
  ]
  const body = rows.map((r) => [
    { value: r.name, type: String },
    ...r.days.map((h) => hoursCell(h)),
    hoursCell(r.total, true)
  ])
  const totals = [
    { value: 'Total', type: String, fontWeight: 'bold' },
    ...dayTotals.map((t) => hoursCell(t, true)),
    hoursCell(grand, true)
  ]

  const data = [header, ...body, totals] as unknown as SheetData
  await writeXlsxFile(data, { fileName: overviewXlsxFilename(period), stickyRowsCount: 1, stickyColumnsCount: 1 })
}

export function overviewXlsxFilename (period: Period): string {
  const kind = period.kind === 'week' ? 'weekly' : 'monthly'
  return `yg-overview-${kind}-${period.label}.xlsx`
}
