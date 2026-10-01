import type { Ref } from '@hcengineering/core'
import {
  dayStartFor,
  dayStartInsideHours,
  isAfterWorkDayDate,
  istDayStart,
  istWorkDayStart,
  minutesLateInWorkDay,
  type ShiftType
} from '@hcengineering/yg-timesheet'

// IST is UTC+5:30, so IST hh:mm on a date == UTC (hh:mm - 5:30).
const ist = (y: number, mo: number, d: number, h: number, mi: number, s = 0, ms = 0): number =>
  Date.UTC(y, mo - 1, d, h, mi, s, ms) - 330 * 60000
const SEP30 = istDayStart(ist(2026, 9, 30, 12, 0))
const OCT1 = istDayStart(ist(2026, 10, 1, 12, 0))

describe('istWorkDayStart', () => {
  it('day start 0 is the IST calendar day', () => {
    expect(istWorkDayStart(ist(2026, 10, 1, 0, 10), 0)).toBe(OCT1)
  })
  it('UK 00:10 with day start 06:00 belongs to the previous day', () => {
    expect(istWorkDayStart(ist(2026, 10, 1, 0, 10), 360)).toBe(SEP30)
  })
  it('exactly at the day start belongs to the new day', () => {
    expect(istWorkDayStart(ist(2026, 10, 1, 6, 0, 0, 0), 360)).toBe(OCT1)
  })
  it('one millisecond before the day start belongs to the previous day', () => {
    expect(istWorkDayStart(ist(2026, 10, 1, 5, 59, 59, 999), 360)).toBe(SEP30)
  })
  it('an afternoon punch is the same day for any day start up to then', () => {
    expect(istWorkDayStart(ist(2026, 9, 30, 15, 0), 360)).toBe(SEP30)
  })
})

describe('minutesLateInWorkDay', () => {
  it('Day shift start 09:00, punch 09:20: 20 late', () => {
    expect(minutesLateInWorkDay(ist(2026, 9, 30, 9, 20), SEP30, 540, 360)).toBe(20)
  })
  it('on time is 0 and early is negative', () => {
    expect(minutesLateInWorkDay(ist(2026, 9, 30, 9, 0), SEP30, 540, 360)).toBe(0)
    expect(minutesLateInWorkDay(ist(2026, 9, 30, 8, 50), SEP30, 540, 360)).toBe(-10)
  })
  it('UK start 15:00, FIRST punch 00:10 next date is 550 late', () => {
    expect(minutesLateInWorkDay(ist(2026, 10, 1, 0, 10), SEP30, 900, 360)).toBe(550)
  })
  it('US start 18:30, first punch 01:00 next date is 390 late', () => {
    expect(minutesLateInWorkDay(ist(2026, 10, 1, 1, 0), SEP30, 1110, 360)).toBe(390)
  })
  it('start after midnight, punch earlier on the work day is early', () => {
    expect(minutesLateInWorkDay(ist(2026, 9, 30, 7, 0), SEP30, 30, 360)).toBe(-1050)
  })
  it('start after midnight but before day start is anchored to the next calendar date', () => {
    // US worker, personal start 00:30, day start 06:00: punch 00:45 on Oct 1 is 15 late for the Sep 30 work day
    expect(minutesLateInWorkDay(ist(2026, 10, 1, 0, 45), SEP30, 30, 360)).toBe(15)
  })
})

describe('isAfterWorkDayDate', () => {
  it('true for a punch on a later IST date than its work day', () => {
    expect(isAfterWorkDayDate(ist(2026, 10, 1, 0, 10), SEP30)).toBe(true)
  })
  it('false on the same IST date', () => {
    expect(isAfterWorkDayDate(ist(2026, 9, 30, 23, 50), SEP30)).toBe(false)
  })
})

describe('dayStartInsideHours', () => {
  it('normal range', () => {
    expect(dayStartInsideHours(720, 240, 960)).toBe(true) // Aus 12:00 inside 04:00-16:00
    expect(dayStartInsideHours(0, 240, 960)).toBe(false)
  })
  it('range crossing midnight', () => {
    expect(dayStartInsideHours(30, 810, 60)).toBe(true) // 00:30 inside 13:30-01:00
    expect(dayStartInsideHours(360, 810, 60)).toBe(false) // 06:00 outside
  })
  it('boundaries are not inside, missing hours never warn', () => {
    expect(dayStartInsideHours(240, 240, 960)).toBe(false)
    expect(dayStartInsideHours(960, 240, 960)).toBe(false)
    expect(dayStartInsideHours(300, undefined, 960)).toBe(false)
  })
})

describe('dayStartFor', () => {
  const types = [{ _id: 'uk' as Ref<ShiftType>, dayStartMin: 360 }]
  it('uses the assigned type', () => {
    expect(dayStartFor('uk' as Ref<ShiftType>, types)).toBe(360)
  })
  it('falls back to 0 when unassigned or the type is unknown', () => {
    expect(dayStartFor(undefined, types)).toBe(0)
    expect(dayStartFor('gone' as Ref<ShiftType>, types)).toBe(0)
  })
})
