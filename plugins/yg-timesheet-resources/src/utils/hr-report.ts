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

export interface OverviewRow {
  employee: any // Ref<Person>
  name: string
  days: number[] // len 7, Mon..Sun
  weekTotal: number
  complete: boolean
  shortfall: number
}

export function buildOverviewGrid (
  entries: any[],
  employees: Array<{ ref: any, name: string }>,
  week: { start: number },
  target = 8
): OverviewRow[] {
  const byEmp = new Map<string, number[]>()
  for (const emp of employees) byEmp.set(emp.ref as string, [0, 0, 0, 0, 0, 0, 0])

  // Build day-key -> index map (DST-safe, matches buildWeekGrid pattern)
  const dayKeyIdx = new Map<string, number>()
  const mon = new Date(week.start)
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    dayKeyIdx.set(localDayKey(d.getTime()), i)
  }

  for (const en of entries) {
    const days = byEmp.get(en.employee as string)
    if (days === undefined) continue // only employees in the row set
    const idx = dayKeyIdx.get(localDayKey(en.date))
    if (idx !== undefined) days[idx] += en.hours
  }
  return employees
    .map(({ ref, name }) => {
      const days = byEmp.get(ref as string) ?? [0, 0, 0, 0, 0, 0, 0]
      const weekTotal = days.reduce((a, b) => a + b, 0)
      let shortfall = 0
      for (let i = 0; i < 5; i++) shortfall += Math.max(0, target - days[i])
      return { employee: ref, name, days, weekTotal, complete: shortfall === 0, shortfall }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
