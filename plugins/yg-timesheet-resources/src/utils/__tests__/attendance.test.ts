import {
  localMidnight,
  sessionDuration,
  findOpenSession,
  dailyTotal,
  nextMode,
  formatDuration,
  groupByDay,
  type AttendanceLike
} from '../attendance'

// Fixed clock: 2026-07-28 14:30 local. No Date.now() anywhere - every value is explicit.
const now = new Date(2026, 6, 28, 14, 30, 0).getTime()
const mid = new Date(2026, 6, 28, 0, 0, 0).getTime()
const h = (hour: number, min = 0): number => new Date(2026, 6, 28, hour, min, 0).getTime()

describe('localMidnight', () => {
  test('collapses any instant to that local day 00:00', () => {
    expect(localMidnight(h(14, 30))).toBe(mid)
    expect(localMidnight(h(0, 0))).toBe(mid)
    expect(localMidnight(h(23, 59))).toBe(mid)
  })
})

describe('sessionDuration', () => {
  test('closed session = out - in', () => {
    expect(sessionDuration({ punchIn: h(9), punchOut: h(11), mode: 'office' }, now)).toBe(2 * 3600_000)
  })
  test('open session is measured to now', () => {
    expect(sessionDuration({ punchIn: h(14), mode: 'wfh' }, now)).toBe(30 * 60_000)
  })
  test('never negative', () => {
    expect(sessionDuration({ punchIn: h(15), punchOut: h(14), mode: 'office' }, now)).toBe(0)
  })
})

describe('findOpenSession', () => {
  const closed: AttendanceLike = { punchIn: h(9), punchOut: h(10), mode: 'office' }
  const open: AttendanceLike = { punchIn: h(14), mode: 'wfh' }
  test('returns the session with no punchOut', () => {
    expect(findOpenSession([closed, open])).toBe(open)
  })
  test('undefined when all sessions are closed', () => {
    expect(findOpenSession([closed])).toBeUndefined()
  })
  test('earliest open wins if several are open', () => {
    const early: AttendanceLike = { punchIn: h(12), mode: 'office' }
    expect(findOpenSession([open, early])).toBe(early)
  })
})

describe('dailyTotal', () => {
  test('sums closed durations plus the live open session', () => {
    const sessions: AttendanceLike[] = [
      { punchIn: h(9), punchOut: h(11), mode: 'office' }, // 2h
      { punchIn: h(14), mode: 'wfh' } //                     0.5h live
    ]
    expect(dailyTotal(sessions, now)).toBe(2.5 * 3600_000)
  })
  test('empty day is zero', () => {
    expect(dailyTotal([], now)).toBe(0)
  })
})

describe('nextMode', () => {
  test('office when there are no sessions today', () => {
    expect(nextMode([])).toBe('office')
  })
  test('mirrors the most recent session today', () => {
    const sessions: AttendanceLike[] = [
      { punchIn: h(9), punchOut: h(10), mode: 'office' },
      { punchIn: h(13), punchOut: h(14), mode: 'wfh' }
    ]
    expect(nextMode(sessions)).toBe('wfh')
  })
  test('ignores the order of the input array', () => {
    const sessions: AttendanceLike[] = [
      { punchIn: h(13), mode: 'wfh' },
      { punchIn: h(9), mode: 'office' }
    ]
    expect(nextMode(sessions)).toBe('wfh')
  })
})

describe('formatDuration', () => {
  test('hours with zero-padded minutes', () => {
    expect(formatDuration(2 * 3600_000 + 5 * 60_000)).toBe('2h 05m')
  })
  test('sub-minute rounds down to 0h 00m', () => {
    expect(formatDuration(59_000)).toBe('0h 00m')
  })
})

describe('groupByDay', () => {
  const d28 = new Date(2026, 6, 28).getTime()
  const d27 = new Date(2026, 6, 27).getTime()
  test('groups by date, newest day first, sessions ascending by punchIn', () => {
    const rows = [
      { date: d27, punchIn: h(9), mode: 'office' as const },
      { date: d28, punchIn: h(13), mode: 'wfh' as const },
      { date: d28, punchIn: h(9), mode: 'office' as const }
    ]
    const g = groupByDay(rows)
    expect(g.map((x) => x.date)).toEqual([d28, d27])
    expect(g[0].sessions.map((s) => s.punchIn)).toEqual([h(9), h(13)])
  })
})
