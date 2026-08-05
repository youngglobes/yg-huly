import { type WorkProfileCategory } from '@hcengineering/yg-timesheet'
import { isTracked } from './work-profile'
import { isWorkingDay } from './week'
import { localMidnight } from './attendance'

export interface PerfEmp { id: string; name: string; category?: WorkProfileCategory }
export interface PerfHours { employee: string; hours: number; date: number }
export interface PerfAtt { employee: string; punchIn: number; punchOut?: number }

/** One flagged day in an employee's drill-down (only days that fired a signal are kept). */
export interface FlaggedDay {
  date: number          // localMidnight (ms) of the day
  offDay: boolean       // non-working day with hoursLogged > 0
  overtimeHours: number // working day: max(0, hoursLogged - 8); 0 otherwise
  lateNight: boolean    // hoursLogged > 8 AND a session that day ran past 22:00
  hoursLogged: number   // summed logged hours that day
  punchIn?: number      // earliest punch-in of the day (if any session)
  punchOut?: number     // latest punch-out of the day (undefined if none closed / no session)
}

export interface PerfRow {
  employee: string; name: string; category: WorkProfileCategory
  offDayDays: number; offDayHours: number
  overtimeHours: number; overtimeDays: number
  lateNightDays: number; totalExtraHours: number
  days: FlaggedDay[] // flagged days only, newest first
}

const STD_HOURS = 8
// Late-night threshold, local time. 22:00 (10 PM): tracked devs finish by ~8:30 PM, so work past
// 9 PM is just minor overtime. Late-night ALSO requires > 8 production (logged) hours that day, so a
// normal 8h day that merely ends late does not count - only genuine heavy work that ran late does.
const LATE_NIGHT_HOUR = 22
const HOUR_MS = 3_600_000

interface DayAcc {
  hoursLogged: number
  punchIn?: number  // earliest in
  punchOut?: number // latest closed out
  latestEnd: number // max(punchOut ?? now) across the day's sessions; 0 if no session
}

export function performanceRows (emps: PerfEmp[], hours: PerfHours[], atts: PerfAtt[], now: number): PerfRow[] {
  const included = emps.filter((e) => isTracked(e.category))
  const ids = new Set(included.map((e) => e.id))

  // Per-employee, per-day accumulator merging logged hours with that day's attendance.
  const byEmp = new Map<string, Map<number, DayAcc>>()
  const acc = (emp: string, day: number): DayAcc => {
    let m = byEmp.get(emp)
    if (m === undefined) { m = new Map(); byEmp.set(emp, m) }
    let d = m.get(day)
    if (d === undefined) { d = { hoursLogged: 0, latestEnd: 0 }; m.set(day, d) }
    return d
  }

  for (const hh of hours) {
    if (!ids.has(hh.employee)) continue
    const d = acc(hh.employee, localMidnight(hh.date))
    d.hoursLogged = round2(d.hoursLogged + hh.hours)
  }

  for (const a of atts) {
    if (!ids.has(a.employee)) continue
    const day = localMidnight(a.punchIn)
    const d = acc(a.employee, day)
    d.punchIn = d.punchIn === undefined ? a.punchIn : Math.min(d.punchIn, a.punchIn)
    if (a.punchOut !== undefined) {
      d.punchOut = d.punchOut === undefined ? a.punchOut : Math.max(d.punchOut, a.punchOut)
    }
    const end = a.punchOut ?? now
    if (end > d.latestEnd) d.latestEnd = end
  }

  const rows = included.map((e): PerfRow => {
    const dayMap = byEmp.get(e.id) ?? new Map<number, DayAcc>()
    let offDayDays = 0; let offDayHours = 0; let overtimeHours = 0; let overtimeDays = 0
    const days: FlaggedDay[] = []

    for (const [day, d] of dayMap) {
      const working = isWorkingDay(day)
      const offDay = !working && d.hoursLogged > 0
      const ot = working && d.hoursLogged > STD_HOURS ? round2(d.hoursLogged - STD_HOURS) : 0
      const lateNight = d.hoursLogged > STD_HOURS && d.latestEnd > day + LATE_NIGHT_HOUR * HOUR_MS

      if (offDay) { offDayDays++; offDayHours = round2(offDayHours + d.hoursLogged) }
      if (ot > 0) { overtimeHours = round2(overtimeHours + ot); overtimeDays++ }

      if (offDay || ot > 0 || lateNight) {
        days.push({
          date: day,
          offDay,
          overtimeHours: ot,
          lateNight,
          hoursLogged: d.hoursLogged,
          punchIn: d.punchIn,
          punchOut: d.punchOut
        })
      }
    }

    days.sort((a, b) => b.date - a.date) // newest first
    return {
      employee: e.id, name: e.name, category: e.category as WorkProfileCategory,
      offDayDays, offDayHours, overtimeHours, overtimeDays,
      lateNightDays: days.filter((x) => x.lateNight).length,
      totalExtraHours: round2(offDayHours + overtimeHours),
      days
    }
  })
  return rows.sort((a, b) => b.totalExtraHours - a.totalExtraHours || a.name.localeCompare(b.name))
}

function round2 (n: number): number { return Math.round(n * 100) / 100 }
