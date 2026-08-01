// Pure aggregation for the HR dashboard. No platform deps -> unit-testable. HrDashboard.svelte maps
// live query results (AttendanceSession / HrTimeEntry / Timesheet / Employee) to these plain shapes
// and feeds them in, so all math is tested in isolation from queries/rendering.
export interface HrEmp { id: string; name: string; active: boolean }
export interface HrAtt { employee: string; mode: 'office' | 'wfh'; open: boolean; punchIn: number }
export interface HrHours { employee: string; hours: number; date: number }
export interface HrSub { employee: string; submitted: boolean }
export interface AttToday { employee: string; name: string; mode: 'office' | 'wfh'; open: boolean }
export interface PersonHours { employee: string; name: string; hours: number; days: number; lastActive: number }

const nameOf = (emps: HrEmp[], id: string): string => emps.find((e) => e.id === id)?.name ?? id
const activeIds = (emps: HrEmp[]): Set<string> => new Set(emps.filter((e) => e.active).map((e) => e.id))

export function headcount (emps: HrEmp[]): number {
  return emps.filter((e) => e.active).length
}

// One row per present employee, carrying the mode/open of their LATEST punch-in today (an employee
// may punch office then wfh; the most recent session wins). Ordered by employee name.
export function attendanceToday (att: HrAtt[], emps: HrEmp[]): AttToday[] {
  const latest = new Map<string, HrAtt>()
  for (const a of att) {
    const cur = latest.get(a.employee)
    if (cur === undefined || a.punchIn > cur.punchIn) latest.set(a.employee, a)
  }
  return [...latest.values()]
    .map((a) => ({ employee: a.employee, name: nameOf(emps, a.employee), mode: a.mode, open: a.open }))
    .sort((x, y) => x.name.localeCompare(y.name))
}

export function wfhOfficeSplit (att: HrAtt[], emps: HrEmp[]): { office: number, wfh: number } {
  const today = attendanceToday(att, emps)
  return {
    office: today.filter((t) => t.mode === 'office').length,
    wfh: today.filter((t) => t.mode === 'wfh').length
  }
}

export function notPunchedToday (att: HrAtt[], emps: HrEmp[]): HrEmp[] {
  const present = new Set(att.map((a) => a.employee))
  return emps.filter((e) => e.active && !present.has(e.id))
}

export function orgHoursTotal (hours: HrHours[]): number {
  return round2(hours.reduce((s, h) => s + h.hours, 0))
}

// Per-employee rollup: summed hours, distinct days logged, latest date. Sorted most hours first,
// then name. Only employees who logged something appear.
export function hoursByPerson (hours: HrHours[], emps: HrEmp[]): PersonHours[] {
  const sum = new Map<string, number>()
  const days = new Map<string, Set<number>>()
  const last = new Map<string, number>()
  for (const h of hours) {
    sum.set(h.employee, (sum.get(h.employee) ?? 0) + h.hours)
    if (!days.has(h.employee)) days.set(h.employee, new Set())
    days.get(h.employee)?.add(h.date)
    last.set(h.employee, Math.max(last.get(h.employee) ?? 0, h.date))
  }
  return [...sum.keys()]
    .map((id) => ({ employee: id, name: nameOf(emps, id), hours: round2(sum.get(id) ?? 0), days: days.get(id)?.size ?? 0, lastActive: last.get(id) ?? 0 }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))
}

export function notLoggedThisWeek (hours: HrHours[], emps: HrEmp[]): HrEmp[] {
  const logged = new Set(hours.map((h) => h.employee))
  return emps.filter((e) => e.active && !logged.has(e.id))
}

// submitted = count of distinct active employees with a submitted record; expected = active
// headcount; submittedList = the active employees who submitted; missing = active employees who did
// NOT submit (no record, or record with submitted=false).
export function submissionCompliance (
  subs: HrSub[], emps: HrEmp[]
): { submitted: number, expected: number, submittedList: HrEmp[], missing: HrEmp[] } {
  const done = new Set(subs.filter((s) => s.submitted).map((s) => s.employee))
  const active = activeIds(emps)
  const submittedList = emps.filter((e) => e.active && done.has(e.id))
  return {
    submitted: submittedList.length,
    expected: active.size,
    submittedList,
    missing: emps.filter((e) => e.active && !done.has(e.id))
  }
}

function round2 (n: number): number {
  return Math.round(n * 100) / 100
}
