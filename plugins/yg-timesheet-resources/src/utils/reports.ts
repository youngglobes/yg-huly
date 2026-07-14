import { weekRange, localDayKey } from './week'

export type ReportStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected'
export interface ReportRow {
  date: number; employee: string; employeeName: string
  project: string; projectName: string
  issue: string; identifier: string; title: string
  hours: number; status: ReportStatus; note: string
}
export interface ReportFilter { from: number; to: number; project?: string; member?: string; status?: ReportStatus }
export type GroupDim = 'project' | 'member' | 'day' | 'week' | 'month' | 'detail'
export interface ReportGroup { key: string; label: string; totalHours: number; count: number; rows: ReportRow[] }

export function filterRows (rows: ReportRow[], f: ReportFilter): ReportRow[] {
  return rows.filter((r) =>
    r.date >= f.from && r.date < f.to &&
    (f.project == null || r.project === f.project) &&
    (f.member == null || r.employee === f.member) &&
    (f.status == null || r.status === f.status)
  )
}

function monthKey (ms: number): string { const d = new Date(ms); return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}` }

function keyLabel (r: ReportRow, dim: GroupDim): { key: string, label: string } {
  switch (dim) {
    case 'project': return { key: r.project, label: r.projectName || r.project }
    case 'member': return { key: r.employee, label: r.employeeName || r.employee }
    case 'day': return { key: localDayKey(r.date), label: localDayKey(r.date) }
    case 'week': { const w = weekRange(r.date); return { key: String(w.start), label: localDayKey(w.start) } }
    case 'month': return { key: monthKey(r.date), label: monthKey(r.date) }
    default: return { key: 'all', label: 'All' }
  }
}

export function groupRows (rows: ReportRow[], dim: GroupDim): ReportGroup[] {
  if (dim === 'detail') {
    const total = rows.reduce((s, r) => s + r.hours, 0)
    return [{ key: 'all', label: 'All', totalHours: total, count: rows.length, rows: [...rows] }]
  }
  const byKey = new Map<string, ReportGroup>()
  for (const r of rows) {
    const { key, label } = keyLabel(r, dim)
    let g = byKey.get(key)
    if (g === undefined) { g = { key, label, totalHours: 0, count: 0, rows: [] }; byKey.set(key, g) }
    g.totalHours += r.hours; g.count += 1; g.rows.push(r)
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

const COLS = ['Date', 'Employee', 'Project', 'Issue', 'Title', 'Hours', 'Status', 'Description']
function esc (v: string): string { return `"${v.replace(/"/g, '""')}"` }
export function toCSV (rows: ReportRow[]): string {
  const head = COLS.join(',')
  const body = rows.map((r) => [
    esc(localDayKey(r.date)), esc(r.employeeName || r.employee), esc(r.projectName || r.project),
    esc(r.identifier), esc(r.title), String(r.hours), r.status, esc(r.note)
  ].join(',')).join('\n')
  return `${head}\n${body}\n`
}
