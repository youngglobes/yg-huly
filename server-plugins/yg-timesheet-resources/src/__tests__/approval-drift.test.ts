import { inDayWindow, localMidnightOf, roundedHoursDiffer, sumHoursInDayWindow } from '../approval-drift'

describe('localMidnightOf', () => {
  it("collapses any time-of-day to that calendar day's midnight", () => {
    const d = new Date(2026, 7, 7, 14, 30, 0) // 2026-08-07 14:30 local
    const mid = new Date(2026, 7, 7, 0, 0, 0).getTime()
    expect(localMidnightOf(d.getTime())).toBe(mid)
    expect(localMidnightOf(new Date(2026, 7, 7, 0, 0, 0).getTime())).toBe(mid)
    expect(localMidnightOf(new Date(2026, 7, 7, 23, 59, 59).getTime())).toBe(mid)
  })
})

describe('inDayWindow', () => {
  const dayStart = new Date(2026, 7, 7, 0, 0, 0).getTime()

  it('includes the exact start instant', () => {
    expect(inDayWindow(dayStart, dayStart)).toBe(true)
  })

  it('includes an instant just before the next midnight', () => {
    expect(inDayWindow(dayStart, dayStart + 86_400_000 - 1)).toBe(true)
  })

  it('excludes the next midnight itself (half-open window)', () => {
    expect(inDayWindow(dayStart, dayStart + 86_400_000)).toBe(false)
  })

  it('excludes an instant before the day starts', () => {
    expect(inDayWindow(dayStart, dayStart - 1)).toBe(false)
  })
})

describe('sumHoursInDayWindow', () => {
  const dayStart = new Date(2026, 7, 7, 0, 0, 0).getTime()
  const otherDay = new Date(2026, 7, 8, 0, 0, 0).getTime()

  it('sums only the reports that fall within the day', () => {
    const reports = [
      { date: dayStart + 1000, value: 2 },
      { date: dayStart + 3600_000, value: 1.5 },
      { date: otherDay + 1000, value: 4 } // different day, excluded
    ]
    expect(sumHoursInDayWindow(reports, dayStart)).toBe(3.5)
  })

  it('ignores reports with a null/undefined date', () => {
    const reports = [
      { date: null, value: 5 },
      { date: undefined, value: 5 },
      { date: dayStart, value: 1 }
    ]
    expect(sumHoursInDayWindow(reports, dayStart)).toBe(1)
  })

  it('rounds the total to 2dp', () => {
    const reports = [
      { date: dayStart, value: 0.1 },
      { date: dayStart + 1, value: 0.2 }
    ]
    expect(sumHoursInDayWindow(reports, dayStart)).toBe(0.3)
  })

  it('returns 0 for an empty list', () => {
    expect(sumHoursInDayWindow([], dayStart)).toBe(0)
  })
})

describe('roundedHoursDiffer', () => {
  it('is false when the values are exactly equal', () => {
    expect(roundedHoursDiffer(4, 4)).toBe(false)
  })

  it('is false when float noise rounds away at 2dp', () => {
    expect(roundedHoursDiffer(0.1 + 0.2, 0.3)).toBe(false)
  })

  it('is true when the live total is higher (the cheat: added time post-approval)', () => {
    expect(roundedHoursDiffer(4, 5)).toBe(true)
  })

  it('is true when the live total is lower (edited down after approval)', () => {
    expect(roundedHoursDiffer(4, 2.5)).toBe(true)
  })

  it('never thrashes on the same number re-approved', () => {
    expect(roundedHoursDiffer(6.25, 6.25)).toBe(false)
  })
})
