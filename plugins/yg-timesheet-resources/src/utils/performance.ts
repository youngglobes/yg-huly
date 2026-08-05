import { type WorkProfileCategory } from '@hcengineering/yg-timesheet'
import { isTracked } from './work-profile'
import { isWorkingDay } from './week'
import { localMidnight } from './attendance'

export interface PerfEmp { id: string; name: string; category?: WorkProfileCategory }
export interface PerfHours { employee: string; hours: number; date: number }
export interface PerfAtt { employee: string; punchIn: number; punchOut?: number }
export interface PerfRow {
  employee: string; name: string; category: WorkProfileCategory
  offDayDays: number; offDayHours: number
  overtimeHours: number; overtimeDays: number
  lateNightDays: number; totalExtraHours: number
}

const STD_HOURS = 8
// Late-night threshold, local time. 22:00 (10 PM): tracked devs finish by ~8:30 PM, so work past
// 9 PM is just minor overtime - only past 10 PM counts as genuine late-night effort. This also
// keeps a normal 8h day that merely ends late (started late, wrapped up 8:30-9 PM) out of the count.
const LATE_NIGHT_HOUR = 22
const HOUR_MS = 3_600_000

export function performanceRows (emps: PerfEmp[], hours: PerfHours[], atts: PerfAtt[], now: number): PerfRow[] {
  const included = emps.filter((e) => isTracked(e.category))
  const ids = new Set(included.map((e) => e.id))

  const dayHours = new Map<string, Map<number, number>>()
  for (const h of hours) {
    if (!ids.has(h.employee)) continue
    const day = localMidnight(h.date)
    let m = dayHours.get(h.employee)
    if (m === undefined) { m = new Map(); dayHours.set(h.employee, m) }
    m.set(day, round2((m.get(day) ?? 0) + h.hours))
  }

  const lateDays = new Map<string, Set<number>>()
  for (const a of atts) {
    if (!ids.has(a.employee)) continue
    const day = localMidnight(a.punchIn)
    const end = a.punchOut ?? now
    if (end > day + LATE_NIGHT_HOUR * HOUR_MS) {
      let s = lateDays.get(a.employee)
      if (s === undefined) { s = new Set(); lateDays.set(a.employee, s) }
      s.add(day)
    }
  }

  const rows = included.map((e): PerfRow => {
    const days = dayHours.get(e.id) ?? new Map<number, number>()
    let offDayDays = 0; let offDayHours = 0; let overtimeHours = 0; let overtimeDays = 0
    for (const [day, hrs] of days) {
      if (!isWorkingDay(day)) {
        if (hrs > 0) { offDayDays++; offDayHours = round2(offDayHours + hrs) }
      } else if (hrs > STD_HOURS) {
        overtimeHours = round2(overtimeHours + (hrs - STD_HOURS)); overtimeDays++
      }
    }
    return {
      employee: e.id, name: e.name, category: e.category as WorkProfileCategory,
      offDayDays, offDayHours, overtimeHours, overtimeDays,
      lateNightDays: lateDays.get(e.id)?.size ?? 0,
      totalExtraHours: round2(offDayHours + overtimeHours)
    }
  })
  return rows.sort((a, b) => b.totalExtraHours - a.totalExtraHours || a.name.localeCompare(b.name))
}

function round2 (n: number): number { return Math.round(n * 100) / 100 }
