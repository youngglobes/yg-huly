import { weekRange, groupByDay, formatHours, type ReportLike } from '../utils/week'

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
})
