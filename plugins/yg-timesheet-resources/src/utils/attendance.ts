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

/** Headline numbers for one day's sessions, for the "Today at a glance" panel. */
export interface DayStats {
  count: number
  totalMs: number
  firstIn?: number
  /** Last punch-out of the day, or undefined while a session is still open (or none closed). */
  lastOut?: number
}

/** Compute the day's headline stats. Open sessions still count toward count + live totalMs. */
export function dayStats (sessions: AttendanceLike[], now: number): DayStats {
  if (sessions.length === 0) return { count: 0, totalMs: 0 }
  const firstIn = Math.min(...sessions.map((s) => s.punchIn))
  const anyOpen = sessions.some((s) => s.punchOut === undefined)
  const outs = sessions.filter((s) => s.punchOut !== undefined).map((s) => s.punchOut as number)
  const lastOut = anyOpen || outs.length === 0 ? undefined : Math.max(...outs)
  return { count: sessions.length, totalMs: dailyTotal(sessions, now), firstIn, lastOut }
}

/** One session rendered onto the day-timeline track, positioned as percentages of the window. */
export interface TimelineBlock {
  mode: AttendanceMode
  open: boolean
  leftPct: number
  widthPct: number
}

/** A whole-hour gridline on the day timeline (hour = 0..23 local). */
export interface TimelineTick {
  pct: number
  hour: number
}

export interface DayTimeline {
  startMs: number
  endMs: number
  blocks: TimelineBlock[]
  ticks: TimelineTick[]
  /** Position of the live "now" marker, only when `now` falls within the window. */
  nowPct?: number
}

/**
 * Lay one day's sessions onto a horizontal timeline. The window defaults to
 * [dayMidnight+startHour, dayMidnight+endHour] but expands to include any punch (or the live
 * `now` of an open session) that falls outside it, so nothing is ever clipped off the ends.
 * Positions are percentages of the window width, ready for CSS `left`/`width`.
 */
export function buildDayTimeline (
  sessions: AttendanceLike[],
  dayMidnight: number,
  now: number,
  startHour = 8,
  endHour = 19
): DayTimeline {
  const HOUR = 3_600_000
  let winStart = dayMidnight + startHour * HOUR
  let winEnd = dayMidnight + endHour * HOUR
  for (const s of sessions) {
    winStart = Math.min(winStart, s.punchIn)
    winEnd = Math.max(winEnd, s.punchOut ?? s.punchIn)
  }
  const anyOpen = sessions.some((s) => s.punchOut === undefined)
  if (anyOpen && now > winEnd) winEnd = now
  const span = Math.max(1, winEnd - winStart)
  const pct = (t: number): number => ((t - winStart) / span) * 100

  const blocks: TimelineBlock[] = sessions.map((s) => {
    const left = pct(s.punchIn)
    const right = pct(s.punchOut ?? now)
    return { mode: s.mode, open: s.punchOut === undefined, leftPct: left, widthPct: Math.max(0, right - left) }
  })

  const ticks: TimelineTick[] = []
  const firstHour = Math.ceil((winStart - dayMidnight) / HOUR)
  const lastHour = Math.floor((winEnd - dayMidnight) / HOUR)
  for (let h = firstHour; h <= lastHour; h++) {
    ticks.push({ pct: pct(dayMidnight + h * HOUR), hour: h })
  }

  const timeline: DayTimeline = { startMs: winStart, endMs: winEnd, blocks, ticks }
  if (now >= winStart && now <= winEnd) timeline.nowPct = pct(now)
  return timeline
}
