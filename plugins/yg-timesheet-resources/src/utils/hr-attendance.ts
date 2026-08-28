//
// YoungGlobes: pure aggregation for the HR attendance report (today board, all-employees summary,
// individual session log). No queries, no client, no Svelte - plain functions over a minimal
// session shape (structurally the real AttendanceSession). Unit-tested in __tests__/hr-attendance.test.ts.
//
import type { Ref } from '@hcengineering/core'
import type { Employee } from '@hcengineering/contact'
import { dayMode, sessionDuration, type AttendanceMode, type DayMode } from './attendance'

/** Minimal shape the aggregators need from an AttendanceSession doc. Notes and the capture
 *  fields (device/browser/ip/geo) are carried (unused by the math) so the Individual log can
 *  render them - HR + owners only, per-session passthrough, no aggregation. */
export interface SessionLike {
  employee: Ref<Employee>
  date: number // local midnight of the punch-in day
  punchIn: number
  punchOut?: number
  mode: AttendanceMode
  punchInNote?: string
  punchOutNote?: string
  device?: string
  browser?: string
  ip?: string
  ipCity?: string
  geoLat?: number
  geoLng?: number
}

/** An employee row source (ref + display name). */
export interface EmpRef {
  ref: Ref<Employee>
  name: string
}

export interface TodayRow {
  employee: Ref<Employee>
  name: string
  status: 'in' | 'out'
  firstIn?: number
  lastOut?: number // undefined while a session is open, or none closed
  sessions: number
  totalMs: number // open session counts live to `now`
  mode?: DayMode // day category across today's sessions (office / wfh / partial)
}

export interface SummaryRow {
  employee: Ref<Employee>
  name: string
  daysPresent: number
  totalMs: number
  officeMs: number
  wfhMs: number
}

export interface DayGroup {
  date: number
  sessions: SessionLike[]
  subtotalMs: number
}

export interface IndividualLog {
  days: DayGroup[]
  summary: { daysPresent: number, totalMs: number, officeMs: number, wfhMs: number }
}

function splitByMode (sessions: SessionLike[], now: number): { officeMs: number, wfhMs: number } {
  let officeMs = 0
  let wfhMs = 0
  for (const s of sessions) {
    const d = sessionDuration(s, now)
    if (s.mode === 'wfh') wfhMs += d
    else officeMs += d
  }
  return { officeMs, wfhMs }
}

/** Live board of who punched today. One row per employee WITH a session today, sorted by name. */
export function todayBoard (
  sessions: SessionLike[], employees: EmpRef[], dayMidnight: number, now: number
): TodayRow[] {
  const nameOf = new Map(employees.map((e) => [e.ref, e.name]))
  const byEmp = new Map<Ref<Employee>, SessionLike[]>()
  for (const s of sessions) {
    if (s.date !== dayMidnight) continue
    const arr = byEmp.get(s.employee) ?? []
    arr.push(s)
    byEmp.set(s.employee, arr)
  }
  const rows: TodayRow[] = []
  for (const [emp, ss] of byEmp) {
    const openExists = ss.some((s) => s.punchOut === undefined)
    const outs = ss.filter((s) => s.punchOut !== undefined).map((s) => s.punchOut as number)
    rows.push({
      employee: emp,
      name: nameOf.get(emp) ?? '',
      status: openExists ? 'in' : 'out',
      firstIn: Math.min(...ss.map((s) => s.punchIn)),
      lastOut: openExists || outs.length === 0 ? undefined : Math.max(...outs),
      sessions: ss.length,
      totalMs: ss.reduce((sum, s) => sum + sessionDuration(s, now), 0),
      mode: dayMode(ss.map((s) => s.mode))
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/** All-employees summary over [from, to). EVERY employee is a row (zeros for absentees), sorted by name. */
export function attendanceSummary (
  sessions: SessionLike[], employees: EmpRef[], from: number, to: number, now: number
): SummaryRow[] {
  const inRange = sessions.filter((s) => s.date >= from && s.date < to)
  const byEmp = new Map<Ref<Employee>, SessionLike[]>()
  for (const s of inRange) {
    const arr = byEmp.get(s.employee) ?? []
    arr.push(s)
    byEmp.set(s.employee, arr)
  }
  return employees
    .map((e) => {
      const ss = byEmp.get(e.ref) ?? []
      const { officeMs, wfhMs } = splitByMode(ss, now)
      return {
        employee: e.ref,
        name: e.name,
        daysPresent: new Set(ss.map((s) => s.date)).size,
        totalMs: officeMs + wfhMs,
        officeMs,
        wfhMs
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Session-level log for one employee over [from, to): days newest-first, sessions ascending, + summary. */
export function individualLog (
  sessions: SessionLike[], employee: Ref<Employee>, from: number, to: number, now: number
): IndividualLog {
  const mine = sessions.filter((s) => s.employee === employee && s.date >= from && s.date < to)
  const byDate = new Map<number, SessionLike[]>()
  for (const s of mine) {
    const arr = byDate.get(s.date) ?? []
    arr.push(s)
    byDate.set(s.date, arr)
  }
  const days: DayGroup[] = [...byDate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([date, ss]) => ({
      date,
      sessions: [...ss].sort((a, b) => a.punchIn - b.punchIn),
      subtotalMs: ss.reduce((sum, s) => sum + sessionDuration(s, now), 0)
    }))
  const { officeMs, wfhMs } = splitByMode(mine, now)
  return {
    days,
    summary: { daysPresent: byDate.size, totalMs: officeMs + wfhMs, officeMs, wfhMs }
  }
}
