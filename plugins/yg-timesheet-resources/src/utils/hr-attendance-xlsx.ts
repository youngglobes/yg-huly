//
// Excel (.xlsx) export of the HR attendance report, one function per mode. Hours are written as
// Excel TIME values (a fraction of a 24h day) with an `[h]:mm` format so they display like `1:30`
// and sum - the same idiom as utils/hr-xlsx.ts. Times/dates are typed cells. Client-side via
// write-excel-file; the `fileName` option triggers the browser download.
//
import writeXlsxFile, { type SheetData } from 'write-excel-file'
import type { TodayRow, SummaryRow, IndividualLog } from './hr-attendance'

const HM = '[h]:mm'
function hoursCell (ms: number, bold = false): any {
  return { value: ms / 86_400_000, type: Number, format: HM, ...(bold ? { fontWeight: 'bold' } : {}) }
}
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

// yyyy-mm-dd (local) for filenames.
function ymd (ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function safeName (s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'employee'
}

export async function exportTodayXlsx (rows: TodayRow[]): Promise<void> {
  const header = [
    { value: 'Employee', type: String, fontWeight: 'bold' },
    { value: 'Status', type: String, fontWeight: 'bold' },
    { value: 'First in', type: String, fontWeight: 'bold' },
    { value: 'Last out', type: String, fontWeight: 'bold' },
    { value: 'Sessions', type: String, fontWeight: 'bold' },
    { value: 'Total', type: String, fontWeight: 'bold' },
    { value: 'Type', type: String, fontWeight: 'bold' }
  ]
  const body = rows.map((r) => [
    { value: r.name, type: String },
    { value: r.status === 'in' ? 'In now' : 'Out', type: String },
    { value: r.firstIn !== undefined ? timeFmt.format(r.firstIn) : '-', type: String },
    { value: r.lastOut !== undefined ? timeFmt.format(r.lastOut) : '-', type: String },
    { value: r.sessions, type: Number },
    hoursCell(r.totalMs),
    { value: r.mode === 'wfh' ? 'WFH' : 'Office', type: String }
  ])
  const data = [header, ...body] as unknown as SheetData
  await writeXlsxFile(data, { fileName: `hr-attendance-today-${ymd(Date.now())}.xlsx`, stickyRowsCount: 1 })
}

export async function exportSummaryXlsx (rows: SummaryRow[], from: number, to: number): Promise<void> {
  const totalMs = rows.reduce((s, r) => s + r.totalMs, 0)
  const officeMs = rows.reduce((s, r) => s + r.officeMs, 0)
  const wfhMs = rows.reduce((s, r) => s + r.wfhMs, 0)
  const header = [
    { value: 'Employee', type: String, fontWeight: 'bold' },
    { value: 'Days present', type: String, fontWeight: 'bold' },
    { value: 'Total', type: String, fontWeight: 'bold' },
    { value: 'Office', type: String, fontWeight: 'bold' },
    { value: 'WFH', type: String, fontWeight: 'bold' }
  ]
  const body = rows.map((r) => [
    { value: r.name, type: String },
    { value: r.daysPresent, type: Number },
    hoursCell(r.totalMs),
    hoursCell(r.officeMs),
    hoursCell(r.wfhMs)
  ])
  const totals = [
    { value: 'Total', type: String, fontWeight: 'bold' },
    { value: '', type: String },
    hoursCell(totalMs, true),
    hoursCell(officeMs, true),
    hoursCell(wfhMs, true)
  ]
  const data = [header, ...body, totals] as unknown as SheetData
  // `to` is the exclusive end; label the last included day (to - 1 day).
  const lastDay = to - 86_400_000
  await writeXlsxFile(data, {
    fileName: `hr-attendance-summary-${ymd(from)}_${ymd(lastDay)}.xlsx`,
    stickyRowsCount: 1
  })
}

export async function exportIndividualXlsx (
  log: IndividualLog, employeeName: string, from: number, to: number
): Promise<void> {
  const header = [
    { value: 'Date', type: String, fontWeight: 'bold' },
    { value: 'In', type: String, fontWeight: 'bold' },
    { value: 'Out', type: String, fontWeight: 'bold' },
    { value: 'Type', type: String, fontWeight: 'bold' },
    { value: 'Duration', type: String, fontWeight: 'bold' }
  ]
  const body: any[] = []
  for (const day of log.days) {
    for (const s of day.sessions) {
      body.push([
        { value: ymd(s.date), type: String },
        { value: timeFmt.format(s.punchIn), type: String },
        { value: s.punchOut !== undefined ? timeFmt.format(s.punchOut) : '-', type: String },
        { value: s.mode === 'wfh' ? 'WFH' : 'Office', type: String },
        s.punchOut !== undefined ? hoursCell(s.punchOut - s.punchIn) : { value: '-', type: String }
      ])
    }
  }
  const totals = [
    { value: 'Total', type: String, fontWeight: 'bold' },
    { value: '', type: String },
    { value: '', type: String },
    { value: '', type: String },
    hoursCell(log.summary.totalMs, true)
  ]
  const lastDay = to - 86_400_000
  const data = [header, ...body, totals] as unknown as SheetData
  await writeXlsxFile(data, {
    fileName: `hr-attendance-${safeName(employeeName)}-${ymd(from)}_${ymd(lastDay)}.xlsx`,
    stickyRowsCount: 1
  })
}
