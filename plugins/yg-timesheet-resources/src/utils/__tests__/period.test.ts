import { weekPeriod, monthPeriod, weekdayCount, isWeekendKey } from '../period'

// 2026-07-22 is a Wednesday; its week is Mon 2026-07-20 .. Sun 2026-07-26.
const wed = new Date(2026, 6, 22, 13, 0, 0).getTime()

test('weekPeriod: 7 days, Monday first, Sunday last', () => {
  const p = weekPeriod(wed)
  expect(p.kind).toBe('week')
  expect(p.days).toHaveLength(7)
  expect(p.days[0]).toBe('2026-07-20')
  expect(p.days[6]).toBe('2026-07-26')
})

test('weekPeriod: end is exclusive (the following Monday)', () => {
  const p = weekPeriod(wed)
  expect(new Date(p.start).getDate()).toBe(20)
  expect(new Date(p.end).getDate()).toBe(27)
})

test('weekPeriod: a Sunday belongs to the week that started the previous Monday', () => {
  const sun = new Date(2026, 6, 26, 9, 0, 0).getTime()
  expect(weekPeriod(sun).days[0]).toBe('2026-07-20')
})

test('monthPeriod: 31-day month', () => {
  const p = monthPeriod(2026, 6) // July
  expect(p.kind).toBe('month')
  expect(p.days).toHaveLength(31)
  expect(p.days[0]).toBe('2026-07-01')
  expect(p.days[30]).toBe('2026-07-31')
})

test('monthPeriod: 30-day month', () => {
  expect(monthPeriod(2026, 8).days).toHaveLength(30) // September
})

test('monthPeriod: February in a non-leap year', () => {
  const p = monthPeriod(2026, 1)
  expect(p.days).toHaveLength(28)
  expect(p.days[27]).toBe('2026-02-28')
})

test('monthPeriod: February in a leap year', () => {
  const p = monthPeriod(2024, 1)
  expect(p.days).toHaveLength(29)
  expect(p.days[28]).toBe('2024-02-29')
})

test('monthPeriod: December rolls over into the next January', () => {
  const p = monthPeriod(2026, 11)
  expect(p.days).toHaveLength(31)
  expect(new Date(p.end).getFullYear()).toBe(2027)
  expect(new Date(p.end).getMonth()).toBe(0)
})

test('monthPeriod: no duplicate or missing day keys (DST-safe)', () => {
  // March 2026 contains a DST transition in many locales.
  const p = monthPeriod(2026, 2)
  expect(new Set(p.days).size).toBe(p.days.length)
  expect(p.days).toHaveLength(31)
})

test('isWeekendKey', () => {
  expect(isWeekendKey('2026-07-25')).toBe(true)  // Saturday
  expect(isWeekendKey('2026-07-26')).toBe(true)  // Sunday
  expect(isWeekendKey('2026-07-24')).toBe(false) // Friday
})

test('weekdayCount: a normal week is 5', () => {
  expect(weekdayCount(weekPeriod(wed))).toBe(5)
})

test('weekdayCount: July 2026 has 23 weekdays', () => {
  expect(weekdayCount(monthPeriod(2026, 6))).toBe(23)
})

test('labels', () => {
  expect(weekPeriod(wed).label).toBe('2026-07-20')
  expect(monthPeriod(2026, 6).label).toBe('2026-07')
})
