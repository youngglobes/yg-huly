import {
  localMidnight,
  sessionDuration,
  findOpenSession,
  dailyTotal,
  nextMode,
  formatDuration,
  groupByDay,
  dayStats,
  buildDayTimeline,
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

describe('dayStats', () => {
  test('empty day is all zero, no first/last', () => {
    expect(dayStats([], now)).toEqual({ count: 0, totalMs: 0 })
  })
  test('two closed sessions: count, total, firstIn (min), lastOut (max)', () => {
    const sessions: AttendanceLike[] = [
      { punchIn: h(9), punchOut: h(11), mode: 'office' }, // 2h
      { punchIn: h(13), punchOut: h(14), mode: 'wfh' } //    1h
    ]
    expect(dayStats(sessions, now)).toEqual({
      count: 2,
      totalMs: 3 * 3600_000,
      firstIn: h(9),
      lastOut: h(14)
    })
  })
  test('an open session leaves lastOut undefined but still counts + accrues live', () => {
    const sessions: AttendanceLike[] = [
      { punchIn: h(9), punchOut: h(11), mode: 'office' }, // 2h
      { punchIn: h(14), mode: 'wfh' } //                     0.5h live to 14:30
    ]
    const s = dayStats(sessions, now)
    expect(s.count).toBe(2)
    expect(s.firstIn).toBe(h(9))
    expect(s.lastOut).toBeUndefined()
    expect(s.totalMs).toBe(2.5 * 3600_000)
  })
})

describe('buildDayTimeline', () => {
  test('positions a closed session as a percentage of the default 8..19 window', () => {
    // window = 08:00..19:00 = 11h. Session 09:00..11:00 -> left (9-8)/11, width 2/11.
    const tl = buildDayTimeline([{ punchIn: h(9), punchOut: h(11), mode: 'office' }], mid, now)
    expect(tl.startMs).toBe(h(8))
    expect(tl.endMs).toBe(h(19))
    expect(tl.blocks).toHaveLength(1)
    expect(tl.blocks[0].leftPct).toBeCloseTo((1 / 11) * 100, 5)
    expect(tl.blocks[0].widthPct).toBeCloseTo((2 / 11) * 100, 5)
    expect(tl.blocks[0].open).toBe(false)
  })
  test('an open session extends to now and is flagged open; now marker present', () => {
    const tl = buildDayTimeline([{ punchIn: h(14), mode: 'wfh' }], mid, now)
    const b = tl.blocks[0]
    expect(b.open).toBe(true)
    // right edge at now (14:30): width = (14.5-14)/11
    expect(b.widthPct).toBeCloseTo((0.5 / 11) * 100, 5)
    expect(tl.nowPct).toBeCloseTo(((14.5 - 8) / 11) * 100, 5)
  })
  test('window expands to include an out-of-window early punch', () => {
    // 06:30 is before the 08:00 default start -> window starts at 06:30.
    const tl = buildDayTimeline([{ punchIn: h(6, 30), punchOut: h(7, 30), mode: 'office' }], mid, now)
    expect(tl.startMs).toBe(h(6, 30))
    expect(tl.blocks[0].leftPct).toBe(0)
  })
  test('whole-hour ticks fall inside the window', () => {
    const tl = buildDayTimeline([], mid, h(12))
    // default 08..19 -> hours 8..19 inclusive = 12 ticks, all within [0,100].
    expect(tl.ticks.map((t) => t.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(tl.ticks.every((t) => t.pct >= 0 && t.pct <= 100)).toBe(true)
  })
})
