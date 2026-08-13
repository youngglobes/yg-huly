import {
  todayBoard,
  attendanceSummary,
  individualLog,
  type SessionLike,
  type EmpRef
} from '../hr-attendance'

// Fixed clock: 2026-07-29 14:30 local. No Date.now() anywhere.
const now = new Date(2026, 6, 29, 14, 30, 0).getTime()
const mid = (d: number): number => new Date(2026, 6, d, 0, 0, 0).getTime()
const at = (d: number, hour: number, min = 0): number => new Date(2026, 6, d, hour, min, 0).getTime()

const alice = 'emp-alice' as any
const bob = 'emp-bob' as any
const employees: EmpRef[] = [
  { ref: bob, name: 'Bob' },
  { ref: alice, name: 'Alice' }
]

// A closed session for `emp` on day `d`.
const s = (emp: any, d: number, inH: number, outH: number, mode: 'office' | 'wfh' = 'office'): SessionLike => ({
  employee: emp, date: mid(d), punchIn: at(d, inH), punchOut: at(d, outH), mode
})
// An open session (no punchOut).
const open = (emp: any, d: number, inH: number, mode: 'office' | 'wfh' = 'office'): SessionLike => ({
  employee: emp, date: mid(d), punchIn: at(d, inH), mode
})

const HOUR = 3600_000

describe('todayBoard', () => {
  test('only today; per-employee first/last/sessions/total; sorted by name', () => {
    const sessions = [
      s(alice, 29, 9, 11, 'office'), // 2h
      s(alice, 29, 13, 14, 'wfh'), //  1h
      s(bob, 29, 10, 12, 'office'), // 2h
      s(alice, 28, 9, 17) //           yesterday - excluded
    ]
    const rows = todayBoard(sessions, employees, mid(29), now)
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Bob'])
    const a = rows[0]
    expect(a.status).toBe('out')
    expect(a.firstIn).toBe(at(29, 9))
    expect(a.lastOut).toBe(at(29, 14))
    expect(a.sessions).toBe(2)
    expect(a.totalMs).toBe(3 * HOUR)
    expect(a.mode).toBe('wfh') // most recent session's mode
  })
  test('an open session -> status in, lastOut undefined, total counts live to now', () => {
    const rows = todayBoard([open(bob, 29, 14, 'wfh')], employees, mid(29), now)
    const b = rows.find((r) => r.name === 'Bob')!
    expect(b.status).toBe('in')
    expect(b.lastOut).toBeUndefined()
    expect(b.totalMs).toBe(30 * 60_000) // 14:00 -> 14:30
  })
  test('employees with no session today are omitted', () => {
    const rows = todayBoard([s(alice, 29, 9, 10)], employees, mid(29), now)
    expect(rows.map((r) => r.name)).toEqual(['Alice'])
  })
})

describe('attendanceSummary', () => {
  test('every employee is a row (zeros for absent); office+wfh = total; days present', () => {
    const sessions = [
      s(alice, 27, 9, 11, 'office'), // 2h office
      s(alice, 27, 13, 14, 'wfh'), //  1h wfh (same day)
      s(alice, 28, 9, 12, 'office') // 3h office (2nd day)
    ]
    const rows = attendanceSummary(sessions, employees, mid(27), mid(30), now)
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Bob'])
    const a = rows[0]
    expect(a.daysPresent).toBe(2)
    expect(a.officeMs).toBe(5 * HOUR)
    expect(a.wfhMs).toBe(1 * HOUR)
    expect(a.totalMs).toBe(6 * HOUR)
    const b = rows[1]
    expect(b.daysPresent).toBe(0)
    expect(b.totalMs).toBe(0)
  })
  test('range is [from, to): sessions on `to` day are excluded', () => {
    const sessions = [s(alice, 30, 9, 17)]
    const rows = attendanceSummary(sessions, employees, mid(27), mid(30), now)
    expect(rows.find((r) => r.name === 'Alice')!.daysPresent).toBe(0)
  })
})

describe('individualLog', () => {
  test('only the employee, grouped by day newest-first, subtotals + summary', () => {
    const sessions = [
      s(alice, 27, 9, 11, 'office'), // 2h
      s(alice, 28, 13, 14, 'wfh'), //  1h
      s(bob, 27, 9, 17) //             other employee - excluded
    ]
    const log = individualLog(sessions, alice, mid(27), mid(30), now)
    expect(log.days.map((d) => d.date)).toEqual([mid(28), mid(27)]) // newest first
    expect(log.days[0].sessions).toHaveLength(1)
    expect(log.days[1].subtotalMs).toBe(2 * HOUR)
    expect(log.summary.daysPresent).toBe(2)
    expect(log.summary.totalMs).toBe(3 * HOUR)
    expect(log.summary.officeMs).toBe(2 * HOUR)
    expect(log.summary.wfhMs).toBe(1 * HOUR)
  })
  test('sessions within a day are ascending by punchIn', () => {
    const log = individualLog(
      [s(alice, 27, 13, 14), s(alice, 27, 9, 10)], alice, mid(27), mid(30), now
    )
    expect(log.days[0].sessions.map((x) => x.punchIn)).toEqual([at(27, 9), at(27, 13)])
  })
  test('capture fields (device/browser/ip/ipCity/geo) pass through untouched, per session', () => {
    const withCapture: SessionLike = {
      ...s(alice, 27, 9, 11, 'office'),
      device: 'iPhone',
      browser: 'Safari',
      ip: '203.0.113.7',
      ipCity: 'Chennai, TN, IN',
      geoLat: 13.0827,
      geoLng: 80.2707
    }
    const log = individualLog([withCapture], alice, mid(27), mid(30), now)
    const row = log.days[0].sessions[0]
    expect(row.device).toBe('iPhone')
    expect(row.browser).toBe('Safari')
    expect(row.ip).toBe('203.0.113.7')
    expect(row.ipCity).toBe('Chennai, TN, IN')
    expect(row.geoLat).toBe(13.0827)
    expect(row.geoLng).toBe(80.2707)
  })
})
