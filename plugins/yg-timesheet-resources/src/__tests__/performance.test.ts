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

  it('late-night = distinct days with a session past 22:00 (incl. cross-midnight + open)', () => {
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 14), punchOut: D(2026, 7, 3, 23) },        // out 11pm -> past 22:00 -> late (Aug 3)
      { employee: 'e1', punchIn: D(2026, 7, 3, 9), punchOut: D(2026, 7, 3, 17) },         // same day, not late -> still 1 day
      { employee: 'e1', punchIn: D(2026, 7, 6, 13), punchOut: D(2026, 7, 6, 21) + 30 * 60_000 }, // out 9:30pm -> past 21:00 but NOT 22:00 -> NOT late
      { employee: 'e1', punchIn: D(2026, 7, 1, 20), punchOut: D(2026, 7, 2, 1) },         // 8pm -> 1am cross-midnight -> late on Aug 1
      { employee: 'e1', punchIn: D(2026, 7, 4, 19) }                                      // open, now=12:00 same day -> NOT past 22:00
    ]
    const r = performanceRows(emps, [], atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.lateNightDays).toBe(2) // Aug 3 (11pm) + Aug 1 (cross-midnight); Aug 6 excluded (out 9:30pm)
  })

  it('sorts by totalExtraHours desc then name', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 10, date: D(2026, 7, 3) }, // 2h OT
      { employee: 'e2', hours: 13, date: D(2026, 7, 3) }  // 5h OT
    ]
    expect(performanceRows(emps, hours, [], NOW).map((r) => r.employee)).toEqual(['e2', 'e1'])
  })
})
