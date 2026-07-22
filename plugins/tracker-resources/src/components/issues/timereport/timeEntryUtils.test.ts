//
// Copyright © 2026 YoungGlobes.
//
import {
  toHoursMinutes,
  fromHoursMinutes,
  normalizeHoursMinutes,
  localDayOffset,
  endOfLocalDay
} from './timeEntryUtils'

describe('toHoursMinutes', () => {
  it('decomposes common quarter-hour values', () => {
    expect(toHoursMinutes(0.25)).toEqual({ hours: 0, minutes: 15 })
    expect(toHoursMinutes(0.5)).toEqual({ hours: 0, minutes: 30 })
    expect(toHoursMinutes(0.75)).toEqual({ hours: 0, minutes: 45 })
    expect(toHoursMinutes(1)).toEqual({ hours: 1, minutes: 0 })
    expect(toHoursMinutes(8)).toEqual({ hours: 8, minutes: 0 })
  })

  it('decomposes a non-quarter value such as 20 minutes', () => {
    expect(toHoursMinutes(1 / 3)).toEqual({ hours: 0, minutes: 20 })
    expect(toHoursMinutes(1 + 1 / 3)).toEqual({ hours: 1, minutes: 20 })
  })

  it('rolls 60 minutes up into an hour rather than reporting 0h 60m', () => {
    expect(toHoursMinutes(0.999)).toEqual({ hours: 1, minutes: 0 })
  })

  it('treats missing, non-finite and negative values as zero', () => {
    expect(toHoursMinutes(undefined)).toEqual({ hours: 0, minutes: 0 })
    expect(toHoursMinutes(NaN)).toEqual({ hours: 0, minutes: 0 })
    expect(toHoursMinutes(-1)).toEqual({ hours: 0, minutes: 0 })
  })
})

describe('fromHoursMinutes', () => {
  it('composes hours and minutes into decimal man-hours', () => {
    expect(fromHoursMinutes(0, 15)).toBeCloseTo(0.25, 10)
    expect(fromHoursMinutes(1, 20)).toBeCloseTo(1 + 1 / 3, 10)
    expect(fromHoursMinutes(8, 0)).toBe(8)
  })

  it('treats non-finite and negative inputs as zero', () => {
    expect(fromHoursMinutes(NaN, 30)).toBeCloseTo(0.5, 10)
    expect(fromHoursMinutes(-5, 30)).toBeCloseTo(0.5, 10)
  })
})

describe('round trip', () => {
  it('survives decompose then recompose', () => {
    for (const value of [0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2, 4, 8]) {
      const { hours, minutes } = toHoursMinutes(value)
      expect(fromHoursMinutes(hours, minutes)).toBeCloseTo(value, 6)
    }
  })
})

describe('normalizeHoursMinutes', () => {
  it('carries minutes of 60 or more into hours', () => {
    expect(normalizeHoursMinutes(0, 90)).toEqual({ hours: 1, minutes: 30 })
    expect(normalizeHoursMinutes(1, 60)).toEqual({ hours: 2, minutes: 0 })
    expect(normalizeHoursMinutes(0, 125)).toEqual({ hours: 2, minutes: 5 })
  })

  it('leaves already-valid values alone', () => {
    expect(normalizeHoursMinutes(1, 20)).toEqual({ hours: 1, minutes: 20 })
    expect(normalizeHoursMinutes(0, 0)).toEqual({ hours: 0, minutes: 0 })
  })

  it('clamps negatives to zero', () => {
    expect(normalizeHoursMinutes(-3, -10)).toEqual({ hours: 0, minutes: 0 })
  })
})

describe('localDayOffset', () => {
  // 2026-07-20 is a Monday. 2026-07-18 is a Saturday.
  const monday = new Date(2026, 6, 20, 9, 30).valueOf()
  const saturday = new Date(2026, 6, 18, 9, 30).valueOf()
  const sunday = new Date(2026, 6, 19, 9, 30).valueOf()

  it('returns the same instant for an offset of zero', () => {
    expect(localDayOffset(0, monday)).toBe(monday)
  })

  it('does NOT skip weekends - yesterday from Monday is Sunday, not Friday', () => {
    const result = new Date(localDayOffset(-1, monday))
    expect(result.getDay()).toBe(0) // Sunday
    expect(result.getDate()).toBe(19)
  })

  it('supports weekend work - today on a Saturday is Saturday', () => {
    const result = new Date(localDayOffset(0, saturday))
    expect(result.getDay()).toBe(6) // Saturday
    expect(result.getDate()).toBe(18)
  })

  it('supports weekend work - yesterday on a Sunday is Saturday', () => {
    const result = new Date(localDayOffset(-1, sunday))
    expect(result.getDay()).toBe(6) // Saturday
    expect(result.getDate()).toBe(18)
  })

  it('preserves the time of day', () => {
    const result = new Date(localDayOffset(-1, monday))
    expect(result.getHours()).toBe(9)
    expect(result.getMinutes()).toBe(30)
  })
})

describe('endOfLocalDay', () => {
  it('returns the last millisecond of the given local day', () => {
    const result = new Date(endOfLocalDay(new Date(2026, 6, 20, 9, 30).valueOf()))
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(6)
    expect(result.getDate()).toBe(20)
    expect(result.getHours()).toBe(23)
    expect(result.getMinutes()).toBe(59)
    expect(result.getSeconds()).toBe(59)
    expect(result.getMilliseconds()).toBe(999)
  })

  it('accepts any time on that day and still lands on the same boundary', () => {
    const morning = endOfLocalDay(new Date(2026, 6, 20, 0, 0, 0, 0).valueOf())
    const evening = endOfLocalDay(new Date(2026, 6, 20, 23, 0, 0, 0).valueOf())
    expect(morning).toBe(evening)
  })

  it('treats a timestamp earlier today as not in the future', () => {
    const now = new Date(2026, 6, 20, 9, 30).valueOf()
    expect(now > endOfLocalDay(now)).toBe(false)
  })

  it('treats tomorrow as in the future', () => {
    const now = new Date(2026, 6, 20, 9, 30).valueOf()
    const tomorrow = localDayOffset(1, now)
    expect(tomorrow > endOfLocalDay(now)).toBe(true)
  })
})
