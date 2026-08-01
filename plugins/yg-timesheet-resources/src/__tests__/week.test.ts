import { weekRange, groupByDay, formatHours, isOddSaturday, isWorkingDay, lastWorkingDay, type ReportLike } from '../utils/week'

// A fixed Wednesday: 2026-07-15 10:00 local
const wed = new Date(2026, 6, 15, 10, 0, 0).getTime()

describe('weekRange', () => {
  it('spans Monday 00:00 to next Monday 00:00 with 7 day buckets', () => {
    const w = weekRange(wed)
    const start = new Date(w.start)
    expect(start.getDay()).toBe(1) // Monday
    expect(start.getHours()).toBe(0)
    expect(w.days).toHaveLength(7)
    expect(new Date(w.days[0].date).getDay()).toBe(1) // Mon
    expect(new Date(w.days[6].date).getDay()).toBe(0) // Sun
    expect(w.end).toBeGreaterThan(w.start)
  })

  it('rolls a Sunday input back to the preceding Monday', () => {
    const sun = new Date(2026, 6, 19, 10, 0, 0).getTime() // 2026-07-19 is a Sunday
    const w = weekRange(sun)
    expect(new Date(w.start).getDay()).toBe(1)
    expect(new Date(w.days[0].date).getDate()).toBe(13) // preceding Monday
    expect(new Date(w.days[6].date).getDate()).toBe(19) // the Sunday itself
  })
})

describe('formatHours', () => {
  it.each([
    [0, '0h'], [1, '1h'], [8, '8h'], [1.5, '1h 30m'], [0.25, '15m'], [2.75, '2h 45m'],
    [0.999, '1h'], [1.999, '2h']
  ])('formats %p as %p', (n, expected) => {
    expect(formatHours(n as number)).toBe(expected)
  })
})

describe('groupByDay', () => {
  const mk = (dayOffset: number, issueId: string, value: number, ident = issueId): ReportLike => {
    const w = weekRange(wed)
    return {
      employee: 'e1', date: w.days[dayOffset].date + 3600_000, value,
      issueId, issueIdentifier: ident, issueTitle: 't-' + issueId, project: 'P'
    }
  }
  it('buckets by day, sums same-issue reports, computes totals', () => {
    const w = weekRange(wed)
    const { days, weekTotal } = groupByDay([mk(0, 'A', 2), mk(0, 'A', 1), mk(0, 'B', 3), mk(2, 'C', 4)], w)
    expect(days).toHaveLength(7)
    expect(days[0].total).toBe(6)                 // Mon: A(2+1)+B(3)
    expect(days[0].issues.find(i => i.identifier === 'A')?.hours).toBe(3) // collapsed
    expect(days[2].total).toBe(4)                 // Wed
    expect(days[1].total).toBe(0)                 // Tue empty
    expect(weekTotal).toBe(10)
  })
  it('ignores reports with null date or employee', () => {
    const w = weekRange(wed)
    const bad: ReportLike = { employee: null, date: null, value: 5, issueId: 'X', issueIdentifier: 'X', issueTitle: 'x', project: 'P' }
    expect(groupByDay([bad], w).weekTotal).toBe(0)
  })
  it('excludes reports whose date falls outside the week window', () => {
    const w = weekRange(wed)
    const outside: ReportLike = {
      employee: 'e1', date: w.start - 86400_000, value: 5,
      issueId: 'X', issueIdentifier: 'X', issueTitle: 'x', project: 'P'
    }
    expect(groupByDay([outside], w).weekTotal).toBe(0)
  })
  it('sorts issues within a day ascending by identifier', () => {
    const w = weekRange(wed)
    const { days } = groupByDay([mk(0, 'b-id', 1, 'B'), mk(0, 'a-id', 2, 'A')], w)
    expect(days[0].issues[0].identifier).toBe('A')
  })
  it('sorts issue identifiers numerically (PROJ-2 before PROJ-10)', () => {
    const w = weekRange(wed)
    const { days } = groupByDay(
      [mk(0, 'i10', 1, 'PROJ-10'), mk(0, 'i2', 1, 'PROJ-2'), mk(0, 'i1', 1, 'PROJ-1')],
      w
    )
    expect(days[0].issues.map((i) => i.identifier)).toEqual(['PROJ-1', 'PROJ-2', 'PROJ-10'])
  })
})

// YoungGlobes work week: Mon-Fri + odd (1st/3rd/5th) Saturdays; even Sat + Sun off.
// Aug 2026 Saturdays: 1st=Aug 1, 2nd=Aug 8, 3rd=Aug 15, 4th=Aug 22, 5th=Aug 29.
const D = (y: number, m: number, d: number): number => new Date(y, m, d).getTime()

describe('isOddSaturday', () => {
  it('true for 1st/3rd/5th Saturday, false for 2nd/4th', () => {
    expect(isOddSaturday(D(2026, 7, 1))).toBe(true)   // 1st Sat
    expect(isOddSaturday(D(2026, 7, 8))).toBe(false)  // 2nd Sat
    expect(isOddSaturday(D(2026, 7, 15))).toBe(true)  // 3rd Sat
    expect(isOddSaturday(D(2026, 7, 22))).toBe(false) // 4th Sat
    expect(isOddSaturday(D(2026, 7, 29))).toBe(true)  // 5th Sat
  })
  it('false for any non-Saturday', () => {
    expect(isOddSaturday(D(2026, 7, 3))).toBe(false) // Monday
    expect(isOddSaturday(D(2026, 7, 2))).toBe(false) // Sunday
  })
})

describe('isWorkingDay', () => {
  it('Mon-Fri working, Sunday off', () => {
    expect(isWorkingDay(D(2026, 7, 3))).toBe(true)  // Mon
    expect(isWorkingDay(D(2026, 7, 7))).toBe(true)  // Fri
    expect(isWorkingDay(D(2026, 7, 2))).toBe(false) // Sun
  })
  it('odd Saturdays working, even Saturdays off', () => {
    expect(isWorkingDay(D(2026, 7, 1))).toBe(true)   // 1st Sat
    expect(isWorkingDay(D(2026, 7, 8))).toBe(false)  // 2nd Sat
    expect(isWorkingDay(D(2026, 7, 15))).toBe(true)  // 3rd Sat
  })
})

describe('lastWorkingDay (excludes today)', () => {
  it('from Monday skips Sunday, lands on the prior working Saturday if odd', () => {
    // Mon Aug 3 -> back over Sun Aug 2 (off) -> Sat Aug 1 (1st, odd, working)
    expect(lastWorkingDay(D(2026, 7, 3))).toBe(D(2026, 7, 1))
  })
  it('from Monday after an even Saturday lands on Friday', () => {
    // Mon Aug 10 -> Sun Aug 9 (off) -> Sat Aug 8 (2nd, even, off) -> Fri Aug 7 (working)
    expect(lastWorkingDay(D(2026, 7, 10))).toBe(D(2026, 7, 7))
  })
  it('from a working Saturday returns the prior Friday (today excluded)', () => {
    // Sat Aug 1 (working) -> Fri Jul 31
    expect(lastWorkingDay(D(2026, 7, 1))).toBe(D(2026, 6, 31))
  })
  it('from Tuesday returns Monday', () => {
    expect(lastWorkingDay(D(2026, 7, 4))).toBe(D(2026, 7, 3))
  })
})
