//
// Excel (.xlsx) export of the PM report. Same column set as the report's table/legacy CSV, but
// real typed cells: dates as dates, hours as numbers — so Excel sorts dates and sums hour columns
// natively (no CSV re-parsing quirks). Client-side via write-excel-file (browser build); the
// `fileName` option triggers the download directly. The two Client-Approved columns stay blank —
// they are a separate, manual, out-of-scope process, exactly as in the sheet.
//
import writeXlsxFile, { type Schema } from 'write-excel-file'
import { priorityLabel, type ReportRow } from './reports'

const DATE_FMT = 'dd-mm-yyyy' // matches the report's From/To inputs + the retired CSV

const schema: Schema<ReportRow> = [
  { column: 'Date', type: Date, format: DATE_FMT, value: (r) => new Date(r.date) },
  { column: 'Employee', type: String, value: (r) => r.employeeName || r.employee },
  { column: 'Project', type: String, value: (r) => r.projectName || r.project },
  { column: 'Huly ID', type: String, value: (r) => r.identifier },
  { column: 'Issue Title', type: String, value: (r) => r.title },
  { column: 'Estimated', type: Number, value: (r) => r.estimation },
  { column: 'Spent', type: Number, value: (r) => r.hours },
  { column: 'TL/PM Approved Hours', type: Number, value: (r) => r.approvedHours ?? null },
  { column: 'TL/PM Approved By', type: String, value: (r) => r.approvedByName ?? null },
  { column: 'Client Approved Hours', type: Number, value: () => null },
  { column: 'Client Approved By', type: String, value: () => null },
  { column: 'Status', type: String, value: (r) => r.statusName || null },
  { column: 'Priority', type: String, value: (r) => priorityLabel(r.priority) },
  { column: 'Due date', type: Date, format: DATE_FMT, value: (r) => (r.dueDate != null ? new Date(r.dueDate) : null) },
  { column: 'Notes', type: String, value: (r) => r.note || null }
]

export async function exportReportXlsx (rows: ReportRow[]): Promise<void> {
  await writeXlsxFile(rows, { schema, fileName: 'pm-timesheet-report.xlsx', stickyRowsCount: 1 })
}
