import { overviewToCSV, overviewFilename, formatHm, formatDayHeader } from '../hr-csv'
import { weekPeriod, monthPeriod } from '../period'
import type { OverviewRow } from '../hr-report'

const wk = weekPeriod(new Date(2026, 6, 22).getTime()) // Mon 2026-07-20 .. Sun 2026-07-26

function row (name: string, days: number[], shortfall = 0): OverviewRow {
  const total = days.reduce((a, b) => a + b, 0)
  return { employee: name as any, name, days, total, complete: shortfall === 0, shortfall }
}

test('header: Employee, one "Dow DD" column per day, Total — no Shortfall', () => {
  const csv = overviewToCSV([], wk)
  const head = csv.split('\n')[0]
  expect(head).toBe(
    '"Employee","Mon 20","Tue 21","Wed 22","Thu 23","Fri 24","Sat 25","Sun 26","Total"'
  )
  expect(head).not.toContain('Shortfall')
})

test('formatDayHeader omits the month (it is already in the filename)', () => {
  expect(formatDayHeader('2026-07-20')).toBe('Mon 20')
  expect(formatDayHeader('2026-07-01')).toBe('Wed 1')
})

test('formatHm renders decimal hours as h:mm', () => {
  expect(formatHm(0)).toBe('0:00')
  expect(formatHm(1.5)).toBe('1:30')
  expect(formatHm(8)).toBe('8:00')
  expect(formatHm(38.5)).toBe('38:30')
})

test('formatHm rounds to the nearest minute rather than emitting float noise', () => {
  // 20 minutes logged: 0.3333333333333333 must not leak into the file.
  expect(formatHm(1 / 3)).toBe('0:20')
  expect(formatHm(1.8333333333333333)).toBe('1:50')
})

test('formatHm rolls 60 minutes into the hour (no "0:60")', () => {
  expect(formatHm(0.999)).toBe('1:00')
})

test('a row emits hours as h:mm and ends with the total', () => {
  const csv = overviewToCSV([row('Praja', [8, 8, 8, 8, 8, 0, 0], 0)], wk)
  const line = csv.split('\n')[1]
  expect(line).toBe('"Praja",8:00,8:00,8:00,8:00,8:00,0:00,0:00,40:00')
})

test('zero-hour employees are still emitted (that is the point of the report)', () => {
  const csv = overviewToCSV([row('Zoe', [0, 0, 0, 0, 0, 0, 0], 40)], wk)
  expect(csv.split('\n')[1]).toBe('"Zoe",0:00,0:00,0:00,0:00,0:00,0:00,0:00,0:00')
})

test('totals row sums each day and the grand total', () => {
  const csv = overviewToCSV([row('A', [8, 0, 0, 0, 0, 0, 0]), row('B', [2, 3, 0, 0, 0, 0, 0])], wk)
  const lines = csv.trim().split('\n')
  expect(lines[lines.length - 1]).toBe('"Total",10:00,3:00,0:00,0:00,0:00,0:00,0:00,13:00')
})

test('totals are summed from raw hours, so rounding never drifts', () => {
  // Three 20-minute entries on the same day = exactly 1:00, not 3 x "0:20" re-added.
  const csv = overviewToCSV(
    [row('A', [1 / 3, 0, 0, 0, 0, 0, 0]), row('B', [1 / 3, 0, 0, 0, 0, 0, 0]), row('C', [1 / 3, 0, 0, 0, 0, 0, 0])],
    wk
  )
  const lines = csv.trim().split('\n')
  expect(lines[lines.length - 1]).toContain('"Total",1:00,')
})

test('empty row set still emits a valid header and totals row', () => {
  const lines = overviewToCSV([], wk).trim().split('\n')
  expect(lines).toHaveLength(2)
  expect(lines[1]).toBe('"Total",0:00,0:00,0:00,0:00,0:00,0:00,0:00,0:00')
})

test('formula injection: a leading = is apostrophe-prefixed', () => {
  const csv = overviewToCSV([row('=cmd|calc', [0, 0, 0, 0, 0, 0, 0])], wk)
  expect(csv.split('\n')[1]).toContain('"\'=cmd|calc"')
})

test('formula injection: leading +, -, @ are all neutralised', () => {
  for (const bad of ['+1', '-1', '@x']) {
    const csv = overviewToCSV([row(bad, [0, 0, 0, 0, 0, 0, 0])], wk)
    expect(csv.split('\n')[1]).toContain(`"'${bad}"`)
  }
})

test('a name containing a comma stays one field', () => {
  const csv = overviewToCSV([row('Doe, Jane', [0, 0, 0, 0, 0, 0, 0])], wk)
  expect(csv.split('\n')[1]).toContain('"Doe, Jane"')
})

test('a name containing a double quote is doubled', () => {
  const csv = overviewToCSV([row('Jane "JJ" Doe', [0, 0, 0, 0, 0, 0, 0])], wk)
  expect(csv.split('\n')[1]).toContain('"Jane ""JJ"" Doe"')
})

test('month period produces 31 day columns + Employee + Total', () => {
  const csv = overviewToCSV([], monthPeriod(2026, 6))
  expect(csv.split('\n')[0].split(',')).toHaveLength(31 + 2)
})

test('filenames encode the period', () => {
  expect(overviewFilename(wk)).toBe('yg-overview-weekly-2026-07-20.csv')
  expect(overviewFilename(monthPeriod(2026, 6))).toBe('yg-overview-monthly-2026-07.csv')
})
