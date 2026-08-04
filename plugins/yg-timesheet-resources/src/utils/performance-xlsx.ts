//
// Copyright © 2026 YoungGlobes
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

// Excel (.xlsx) export of the Performance report - same idiom as utils/hr-attendance-xlsx.ts:
// a header row + one row per PerfRow, numbers as typed Number cells, client-side download via
// write-excel-file.
import writeXlsxFile, { type SheetData } from 'write-excel-file'
import { type PerfRow } from './performance'

// yyyy-mm-dd (local) for filenames.
function ymd (ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function num (n: number, decimals = 2): any {
  return { value: Math.round(n * 10 ** decimals) / 10 ** decimals, type: Number }
}

// Mirrors the readable category labels in plugins/yg-timesheet-assets/lang/en.json
// (CatJuniorDev/CatSeniorDev/CatSales/CatSalesforce/CatOther) so the export matches the on-screen table.
const CATEGORY_LABEL: Record<string, string> = {
  'junior-dev': 'Junior developer',
  'senior-dev': 'Senior developer',
  sales: 'Sales',
  salesforce: 'Salesforce',
  other: 'Other'
}

export async function exportPerformanceXlsx (rows: PerfRow[], from: number, to: number): Promise<void> {
  const header = [
    { value: 'Employee', type: String, fontWeight: 'bold' },
    { value: 'Category', type: String, fontWeight: 'bold' },
    { value: 'Off-day days', type: String, fontWeight: 'bold' },
    { value: 'Off-day hours', type: String, fontWeight: 'bold' },
    { value: 'Overtime hours', type: String, fontWeight: 'bold' },
    { value: 'Overtime days', type: String, fontWeight: 'bold' },
    { value: 'Late-night days', type: String, fontWeight: 'bold' },
    { value: 'Total extra hours', type: String, fontWeight: 'bold' }
  ]
  const body = rows.map((r) => [
    { value: r.name, type: String },
    { value: CATEGORY_LABEL[r.category] ?? r.category, type: String },
    num(r.offDayDays, 0),
    num(r.offDayHours),
    num(r.overtimeHours),
    num(r.overtimeDays, 0),
    num(r.lateNightDays, 0),
    num(r.totalExtraHours)
  ])
  const data = [header, ...body] as unknown as SheetData
  // `to` is the exclusive end; label the last included day (to - 1 day).
  const lastDay = to - 86_400_000
  await writeXlsxFile(data, {
    fileName: `performance-${ymd(from)}_${ymd(lastDay)}.xlsx`,
    stickyRowsCount: 1
  })
}
