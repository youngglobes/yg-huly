//
// YoungGlobes: pure attendance helpers (Attendance module, Phase 1d).
//
// Date / duration / mode math the My Attendance page drives. No queries, no
// client, no Svelte - just plain functions over a minimal session shape, so it
// is fully unit-testable (see __tests__/attendance.test.ts). The real
// AttendanceSession doc is structurally compatible with AttendanceLike.
//
export type AttendanceMode = 'office' | 'wfh'

/** The minimal shape the helpers need from an AttendanceSession doc. */
export interface AttendanceLike {
  punchIn: number
  punchOut?: number
  mode: AttendanceMode
}

/** Local midnight (ms) of the day containing `ms` - the AttendanceSession.date key. */
export function localMidnight (ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Duration of a session in ms. An open session (no punchOut) is measured to `now`. */
export function sessionDuration (s: AttendanceLike, now: number): number {
  const end = s.punchOut ?? now
  return Math.max(0, end - s.punchIn)
}

/**
 * The single open session (no punchOut), or undefined. The UI enforces at most one
 * open session; if several are somehow open the earliest punchIn wins so Punch Out
 * closes the oldest.
 */
export function findOpenSession<T extends AttendanceLike> (sessions: T[]): T | undefined {
  return sessions
    .filter((s) => s.punchOut === undefined)
    .sort((a, b) => a.punchIn - b.punchIn)[0]
}

/** Sum of session durations for a set (typically one day). Open sessions count live to `now`. */
export function dailyTotal (sessions: AttendanceLike[], now: number): number {
  return sessions.reduce((sum, s) => sum + sessionDuration(s, now), 0)
}

/**
 * Mode to pre-select for the next punch-in: the most recent session's mode today,
 * else 'office'. Sticky within the day, resets to office each new day (the caller
 * passes only today's sessions). Order-independent.
 */
export function nextMode (todays: AttendanceLike[]): AttendanceMode {
  if (todays.length === 0) return 'office'
  return [...todays].sort((a, b) => b.punchIn - a.punchIn)[0].mode
}

/** Format an ms duration as "Hh MMm" (e.g. "2h 05m"); under a minute reads "0h 00m". */
export function formatDuration (ms: number): string {
  const totalMin = Math.floor(ms / 60000)
  const hrs = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  return `${hrs}h ${String(mins).padStart(2, '0')}m`
}

/** Group sessions by their `date` (local-midnight) key: newest day first, sessions ascending by punchIn. */
export function groupByDay<T extends { date: number, punchIn: number }> (
  sessions: T[]
): Array<{ date: number, sessions: T[] }> {
  const byDate = new Map<number, T[]>()
  for (const s of sessions) {
    const arr = byDate.get(s.date) ?? []
    arr.push(s)
    byDate.set(s.date, arr)
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([date, rows]) => ({ date, sessions: [...rows].sort((x, y) => x.punchIn - y.punchIn) }))
}
