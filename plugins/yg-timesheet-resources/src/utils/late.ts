//
// YoungGlobes: pure late-arrival rules. No platform deps, so trivially unit-testable - same idiom
// as approval-drift.ts / performance.ts. "Late" = punch-in local time-of-day strictly after the
// employee's shiftStart (minutes since midnight). Snapshots are taken at record time so a later
// shiftStart edit never rewrites history.
//
import type { LatePermissionStatus } from '@hcengineering/yg-timesheet'

/** Minutes elapsed since local midnight for the instant `ms`. */
export function localTimeOfDayMin (ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/** Strictly-after: on-time (equal) is NOT late. */
export function isLate (punchInMs: number, shiftStartMin: number): boolean {
  return localTimeOfDayMin(punchInMs) > shiftStartMin
}

/** Positive minutes late, 0 when on time or early. */
export function minutesLateOf (punchInMs: number, shiftStartMin: number): number {
  return Math.max(0, localTimeOfDayMin(punchInMs) - shiftStartMin)
}

export type LateDayStatus = 'none' | 'pending' | 'late' | 'excused'

/** Per-day display status derived from the day's LatePermission (if any). */
export function dayLateStatus (status: LatePermissionStatus | undefined): LateDayStatus {
  if (status === undefined) return 'none'
  if (status === 'Approved') return 'excused'
  if (status === 'Pending') return 'pending'
  return 'late' // Rejected
}

/** Late days that count against the employee: everything not Approved. */
export function countUnexcusedLate (statuses: LatePermissionStatus[]): number {
  return statuses.filter((s) => s !== 'Approved').length
}
