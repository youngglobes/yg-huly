import { performanceRows, type PerfEmp, type PerfHours, type PerfAtt } from '../utils/performance'

// Aug 2026: Aug 1 = Sat (1st, odd -> WORKING), Aug 2 = Sun (off), Aug 3 = Mon (working),
// Aug 8 = Sat (2nd, even -> OFF).
const D = (y: number, m: number, d: number, h = 10): number => new Date(y, m, d, h).getTime()
const NOW = D(2026, 7, 4, 12)
const emps: PerfEmp[] = [
  { id: 'e1', name: 'Alice A', category: 'junior-dev' },
  { id: 'e2', name: 'Bob B', category: 'senior-dev' },
  { id: 'sx', name: 'Sam Sales', category: 'sales' },   // excluded
  { id: 'ut', name: 'Un Tagged', category: undefined }  // excluded
]

describe('performanceRows', () => {
  it('includes only dev/senior-dev, excludes sales + untagged', () => {
    expect(performanceRows(emps, [], [], NOW).map((r) => r.employee)).toEqual(['e1', 'e2'])
  })

  it('off-day work = hours on non-working days (Sun/even-Sat)', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 5, date: D(2026, 7, 2) },  // Sun -> off-day
      { employee: 'e1', hours: 3, date: D(2026, 7, 8) },  // 2nd Sat -> off-day
      { employee: 'e1', hours: 6, date: D(2026, 7, 3) }   // Mon -> working, <=8, no OT
    ]
    const r = performanceRows(emps, hours, [], NOW).find((x) => x.employee === 'e1')!
    expect(r.offDayDays).toBe(2)
    expect(r.offDayHours).toBe(8)
    expect(r.overtimeHours).toBe(0)
    expect(r.totalExtraHours).toBe(8)
  })

  it('overtime = working-day hours beyond 8 (off-day hours NOT counted as OT)', () => {
    const hours: PerfHours[] = [
      { employee: 'e2', hours: 11, date: D(2026, 7, 3) },  // Mon -> 3h OT
      { employee: 'e2', hours: 9, date: D(2026, 7, 1) },   // odd Sat (working) -> 1h OT
      { employee: 'e2', hours: 12, date: D(2026, 7, 2) }   // Sun -> off-day (12h), NOT OT
    ]
    const r = performanceRows(emps, hours, [], NOW).find((x) => x.employee === 'e2')!
    expect(r.overtimeHours).toBe(4)   // 3 + 1
    expect(r.overtimeDays).toBe(2)
    expect(r.offDayDays).toBe(1)
    expect(r.offDayHours).toBe(12)
    expect(r.totalExtraHours).toBe(16) // 12 off-day + 4 OT
  })

  it('late-night = day with >8h logged AND a session past 22:00 (both gates required)', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 11, date: D(2026, 7, 3) }, // Mon: 11h logged
      { employee: 'e1', hours: 6, date: D(2026, 7, 1) },  // Sat (odd, working): 6h logged (<=8)
      { employee: 'e1', hours: 12, date: D(2026, 7, 6) }  // Thu: 12h logged
    ]
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 13), punchOut: D(2026, 7, 3, 23) }, // Mon out 11pm + 11h -> LATE
      { employee: 'e1', punchIn: D(2026, 7, 1, 15), punchOut: D(2026, 7, 2, 0) },  // Sat past 10pm but only 6h -> NOT late
      { employee: 'e1', punchIn: D(2026, 7, 6, 9), punchOut: D(2026, 7, 6, 21) }   // Thu 12h but out 9pm -> NOT late
    ]
    const r = performanceRows(emps, hours, atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.lateNightDays).toBe(1) // only Mon Aug 3
  })

  it('days = flagged days only, newest first, merged hours + punches, multi-signal once', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 11, date: D(2026, 7, 3) }, // Mon working: OT +3, plus late punch -> late-night
      { employee: 'e1', hours: 6, date: D(2026, 7, 2) },  // Sun off: off-day 6h
      { employee: 'e1', hours: 5, date: D(2026, 7, 4) }   // Tue working, 5h, no session -> NOT flagged
    ]
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 13), punchOut: D(2026, 7, 3, 23) } // Mon 1pm -> 11pm
    ]
    const r = performanceRows(emps, hours, atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.days.map((d) => d.date)).toEqual([D(2026, 7, 3, 0), D(2026, 7, 2, 0)]) // newest first, Tue excluded
    const mon = r.days[0]
    expect(mon.offDay).toBe(false)
    expect(mon.overtimeHours).toBe(3)
    expect(mon.lateNight).toBe(true)
    expect(mon.hoursLogged).toBe(11)
    expect(mon.punchIn).toBe(D(2026, 7, 3, 13))
    expect(mon.punchOut).toBe(D(2026, 7, 3, 23))
    const sun = r.days[1]
    expect(sun.offDay).toBe(true)
    expect(sun.overtimeHours).toBe(0)
    expect(sun.lateNight).toBe(false)
    expect(sun.hoursLogged).toBe(6)
    expect(sun.punchIn).toBeUndefined()
    expect(sun.punchOut).toBeUndefined()
  })

  it('sorts by totalExtraHours desc then name', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 10, date: D(2026, 7, 3) }, // 2h OT
      { employee: 'e2', hours: 13, date: D(2026, 7, 3) }  // 5h OT
    ]
    expect(performanceRows(emps, hours, [], NOW).map((r) => r.employee)).toEqual(['e2', 'e1'])
  })
})
