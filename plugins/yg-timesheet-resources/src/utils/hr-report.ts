import { localDayKey, type WeekRange } from './week'

export interface HrEntry {
  date: number
  project: string
  projectName: string
  issue: string
  identifier: string
  title: string
  hours: number
  note: string
}
export interface HrGridRow {
  project: string
  projectName: string
  issue: string
  identifier: string
  title: string
  cells: number[]
  rowTotal: number
  notesByDay: Array<string | undefined>
}
export interface HrGrid {
  rows: HrGridRow[]
  dayTotals: number[]
  grandTotal: number
}

export function buildWeekGrid (entries: HrEntry[], week: WeekRange): HrGrid {
  const dayKeys = week.days.map((d) => d.key)
  const idx = new Map<string, number>(dayKeys.map((k, i) => [k, i]))
  const byTask = new Map<string, HrGridRow>()
  for (const en of entries) {
    const di = idx.get(localDayKey(en.date))
    if (di === undefined) continue // outside the week
    let row = byTask.get(en.issue)
    if (row === undefined) {
      row = {
        project: en.project,
        projectName: en.projectName,
        issue: en.issue,
        identifier: en.identifier,
        title: en.title,
        cells: new Array(7).fill(0),
        rowTotal: 0,
        notesByDay: new Array(7).fill(undefined)
      }
      byTask.set(en.issue, row)
    }
    row.cells[di] += en.hours
    row.rowTotal += en.hours
    if (en.note !== '' && row.notesByDay[di] === undefined) row.notesByDay[di] = en.note
  }
  const rows = [...byTask.values()].sort((a, b) => {
    const byProject = a.projectName.localeCompare(b.projectName, undefined, { numeric: true })
    if (byProject !== 0) return byProject
    return a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
  })
  const dayTotals = new Array(7).fill(0)
  let grandTotal = 0
  for (const r of rows) {
    for (let i = 0; i < 7; i++) dayTotals[i] += r.cells[i]
    grandTotal += r.rowTotal
  }
  return { rows, dayTotals, grandTotal }
}
