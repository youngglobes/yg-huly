import { performanceRows, type PerfEmp, type PerfHours, type PerfAtt } from '../utils/performance'

// Aug 2026: Aug 1 = Sat (1st, odd -> WORKING), Aug 2 = Sun (off), Aug 3 = Mon (working),
// Aug 4 = Tue (working, and = NOW's day), Aug 6 = Thu (working), Aug 8 = Sat (2nd, even -> OFF).
const D = (y: number, m: number, d: number, h = 10): number => new Date(y, m, d, h).getTime()
const MIN = 60_000
const NOW = D(2026, 7, 4, 12) // today = Aug 4
const emps: PerfEmp[] = [
  { id: 'e1', name: 'Alice A', designation: 'Associate Software Engineer' }, // tracked
  { id: 'e2', name: 'Bob B', designation: 'Senior Software Engineer' },       // tracked
  { id: 'sx', name: 'Sam Sales', designation: 'Business Development Executive' }, // excluded
  { id: 'ut', name: 'Un Tagged', designation: undefined }                     // excluded
]

describe('performanceRows', () => {
  it('includes only tracked designations, excludes untracked + untagged', () => {
    expect(performanceRows(emps, [], [], NOW).map((r) => r.employee)).toEqual(['e1', 'e2'])
  })

  // --- fallback: no punch data -> worked hours = self-logged timesheet hours ---
  it('off-day work (fallback): logged hours on non-working days when no punch data', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 5, date: D(2026, 7, 2) }, // Sun -> off-day
      { employee: 'e1', hours: 3, date: D(2026, 7, 8) }, // 2nd Sat -> off-day
      { employee: 'e1', hours: 6, date: D(2026, 7, 3) }  // Mon -> working, <=8, no OT
    ]
    const r = performanceRows(emps, hours, [], NOW).find((x) => x.employee === 'e1')!
    expect(r.offDayDays).toBe(2)
    expect(r.offDayHours).toBe(8)
    expect(r.overtimeHours).toBe(0)
    expect(r.totalExtraHours).toBe(8)
  })

  it('overtime (fallback): logged hours beyond 8 on working days when no punch data', () => {
    const hours: PerfHours[] = [
      { employee: 'e2', hours: 11, date: D(2026, 7, 3) }, // Mon -> 3h OT
      { employee: 'e2', hours: 9, date: D(2026, 7, 1) },  // odd Sat (working) -> 1h OT
      { employee: 'e2', hours: 12, date: D(2026, 7, 2) }  // Sun -> off-day (12h), NOT OT
    ]
    const r = performanceRows(emps, hours, [], NOW).find((x) => x.employee === 'e2')!
    expect(r.overtimeHours).toBe(4)
    expect(r.overtimeDays).toBe(2)
    expect(r.offDayDays).toBe(1)
    expect(r.offDayHours).toBe(12)
    expect(r.totalExtraHours).toBe(16)
  })

  // --- punch sessions are the source when present ---
  it('worked hours = summed punch sessions (break gaps excluded), not the span, and logged is ignored', () => {
    const hours: PerfHours[] = [{ employee: 'e2', hours: 20, date: D(2026, 7, 3) }] // ignored (day has punch)
    const atts: PerfAtt[] = [
      { employee: 'e2', punchIn: D(2026, 7, 3, 9), punchOut: D(2026, 7, 3, 13) },        // 4h
      { employee: 'e2', punchIn: D(2026, 7, 3, 14), punchOut: D(2026, 7, 3, 19) + 30 * MIN } // 5.5h (14:00-19:30)
    ]
    const r = performanceRows(emps, hours, atts, NOW).find((x) => x.employee === 'e2')!
    expect(r.overtimeHours).toBe(1.5)   // 9.5h worked - 8; NOT 2.5 (10.5h span) and NOT 12 (20h logged)
    expect(r.overtimeDays).toBe(1)
    expect(r.days[0].workedHours).toBe(9.5)
  })

  it('under-8h once break gaps are removed -> no overtime', () => {
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 9), punchOut: D(2026, 7, 3, 12) },  // 3h
      { employee: 'e1', punchIn: D(2026, 7, 3, 13), punchOut: D(2026, 7, 3, 18) }  // 5h  => 8h worked, span 9h
    ]
    const r = performanceRows(emps, [], atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.overtimeHours).toBe(0) // 8h worked is not > 8, even though the span is 9h
    expect(r.days).toHaveLength(0)
  })

  it('fallback per day: a day with no punch uses logged hours even if other days have punch', () => {
    const hours: PerfHours[] = [{ employee: 'e1', hours: 10, date: D(2026, 7, 3) }] // Mon, no punch -> fallback
    const atts: PerfAtt[] = [{ employee: 'e1', punchIn: D(2026, 7, 4, 9), punchOut: D(2026, 7, 4, 11) }] // Tue, 2h
    const r = performanceRows(emps, hours, atts, NOW).find((x) => x.employee === 'e1')!
    const mon = r.days.find((d) => d.date === D(2026, 7, 3, 0))!
    expect(mon.workedHours).toBe(10) // fallback
    expect(mon.overtimeHours).toBe(2)
  })

  it('open session: today counts to now; a past open session contributes 0', () => {
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 4, 0) + 30 * MIN }, // today (Aug 4) open, now=12:00 -> 11.5h
      { employee: 'e1', punchIn: D(2026, 7, 3, 9) }             // past (Aug 3) open -> 0h, not flagged
    ]
    const r = performanceRows(emps, [], atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.overtimeHours).toBe(3.5) // only Aug 4: 11.5h - 8
    expect(r.days.map((d) => d.date)).toEqual([D(2026, 7, 4, 0)]) // Aug 3 (past open, 0h) excluded
    expect(r.days[0].workedHours).toBe(11.5)
    expect(r.days[0].lateNight).toBe(false) // latestEnd = now (12:00) is not past 22:00
  })

  it('a past-open-only day with logged hours falls back to logged (not zeroed)', () => {
    const hours: PerfHours[] = [{ employee: 'e1', hours: 9, date: D(2026, 7, 1) }] // Aug 1 (odd Sat, working)
    const atts: PerfAtt[] = [{ employee: 'e1', punchIn: D(2026, 7, 1, 9) }] // past open (Aug 1 != today Aug 4) -> 0h session
    const r = performanceRows(emps, hours, atts, NOW).find((x) => x.employee === 'e1')!
    const d = r.days.find((x) => x.date === D(2026, 7, 1, 0))!
    expect(d.workedHours).toBe(9)      // fell back to logged, not 0
    expect(d.overtimeHours).toBe(1)    // 9 - 8
  })

  it('late-night = summed sessions > 8 AND a session past 22:00 (both gates)', () => {
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 13), punchOut: D(2026, 7, 3, 23) }, // 10h, out 23:00 -> LATE
      { employee: 'e1', punchIn: D(2026, 7, 6, 9), punchOut: D(2026, 7, 6, 21) },  // 12h, out 21:00 -> not late (time)
      { employee: 'e1', punchIn: D(2026, 7, 1, 20), punchOut: D(2026, 7, 1, 23) }  // 3h, out 23:00 -> not late (hours)
    ]
    const r = performanceRows(emps, [], atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.lateNightDays).toBe(1) // only Aug 3
  })

  it('days = flagged only, newest first, workedHours field, multi-signal once', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 6, date: D(2026, 7, 2) }, // Sun off, no punch -> fallback 6h off-day
      { employee: 'e1', hours: 5, date: D(2026, 7, 4) }  // Tue working, 5h, no punch -> not flagged
    ]
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 13), punchOut: D(2026, 7, 3, 23) } // Mon: 10h worked, out 23:00
    ]
    const r = performanceRows(emps, hours, atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.days.map((d) => d.date)).toEqual([D(2026, 7, 3, 0), D(2026, 7, 2, 0)]) // newest first, Tue excluded
    const mon = r.days[0]
    expect(mon.offDay).toBe(false)
    expect(mon.overtimeHours).toBe(2)   // 10 - 8
    expect(mon.lateNight).toBe(true)
    expect(mon.workedHours).toBe(10)
    expect(mon.punchIn).toBe(D(2026, 7, 3, 13))
    expect(mon.punchOut).toBe(D(2026, 7, 3, 23))
    const sun = r.days[1]
    expect(sun.offDay).toBe(true)
    expect(sun.overtimeHours).toBe(0)
    expect(sun.lateNight).toBe(false)
    expect(sun.workedHours).toBe(6) // fallback
    expect(sun.punchIn).toBeUndefined()
    expect(sun.punchOut).toBeUndefined()
  })

  it('merges multiple sessions per day (earliest in / latest out) incl cross-midnight', () => {
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 9), punchOut: D(2026, 7, 3, 13) },        // 4h
      { employee: 'e1', punchIn: D(2026, 7, 3, 20), punchOut: D(2026, 7, 4, 0) + 30 * MIN } // 4.5h, cross-midnight
    ]
    const r = performanceRows(emps, [], atts, NOW).find((x) => x.employee === 'e1')!
    const mon = r.days.find((d) => d.date === D(2026, 7, 3, 0))!
    expect(mon.workedHours).toBe(8.5)                             // 4 + 4.5, gap 13:00-20:00 excluded
    expect(mon.punchIn).toBe(D(2026, 7, 3, 9))                    // earliest in
    expect(mon.punchOut).toBe(D(2026, 7, 4, 0) + 30 * MIN)        // latest out (past midnight)
    expect(mon.overtimeHours).toBe(0.5)                          // 8.5 - 8
    expect(mon.lateNight).toBe(true)                            // 8.5 > 8 AND a session ended past 22:00
    expect(r.lateNightDays).toBe(1)
  })

  it('sorts by totalExtraHours desc then name', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 10, date: D(2026, 7, 3) },
      { employee: 'e2', hours: 13, date: D(2026, 7, 3) }
    ]
    expect(performanceRows(emps, hours, [], NOW).map((r) => r.employee)).toEqual(['e2', 'e1'])
  })

  it('a holiday makes a working day count as off-day effort (not overtime)', () => {
    const hours: PerfHours[] = [{ employee: 'e2', hours: 10, date: D(2026, 7, 3) }] // Mon, 10h logged
    const holidays = new Set<number>([new Date(2026, 7, 3).getTime()])              // Aug 3 is a holiday
    const r = performanceRows(emps, hours, [], NOW, holidays).find((x) => x.employee === 'e2')!
    expect(r.offDayDays).toBe(1)        // holiday -> non-working -> off-day
    expect(r.offDayHours).toBe(10)
    expect(r.overtimeHours).toBe(0)     // not overtime (it is not a working day)
    expect(r.days[0].offDay).toBe(true)
  })
})
