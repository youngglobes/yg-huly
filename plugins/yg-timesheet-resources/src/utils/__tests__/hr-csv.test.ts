import { overviewToCSV, overviewFilename } from '../hr-csv'
import { weekPeriod, monthPeriod } from '../period'
import type { OverviewRow } from '../hr-report'

const wk = weekPeriod(new Date(2026, 6, 22).getTime()) // Mon 2026-07-20 .. Sun 2026-07-26

function row (name: string, days: number[], shortfall = 0): OverviewRow {
  const total = days.reduce((a, b) => a + b, 0)
  return { employee: name as any, name, days, total, complete: shortfall === 0, shortfall }
}

test('header: Employee, one column per day, Total, Shortfall', () => {
  const csv = overviewToCSV([], wk)
  const head = csv.split('\n')[0]
  expect(head).toBe(
    '"Employee","2026-07-20","2026-07-21","2026-07-22","2026-07-23","2026-07-24","2026-07-25","2026-07-26","Total","Shortfall (vs 8h × weekdays)"'
  )
})

test('a row emits hours as decimals and ends with total + shortfall', () => {
  const csv = overviewToCSV([row('Praja', [8, 8, 8, 8, 8, 0, 0], 0)], wk)
  const line = csv.split('\n')[1]
  expect(line).toBe('"Praja",8,8,8,8,8,0,0,40,0')
})

test('zero-hour employees are still emitted (that is the point of the report)', () => {
  const csv = overviewToCSV([row('Zoe', [0, 0, 0, 0, 0, 0, 0], 40)], wk)
  expect(csv.split('\n')[1]).toBe('"Zoe",0,0,0,0,0,0,0,0,40')
})

test('totals row sums each day and the grand total', () => {
  const csv = overviewToCSV([row('A', [8, 0, 0, 0, 0, 0, 0]), row('B', [2, 3, 0, 0, 0, 0, 0])], wk)
  const lines = csv.trim().split('\n')
  expect(lines[lines.length - 1]).toBe('"Total",10,3,0,0,0,0,0,13,')
})

test('empty row set still emits a valid header and totals row', () => {
  const lines = overviewToCSV([], wk).trim().split('\n')
  expect(lines).toHaveLength(2)
  expect(lines[1]).toBe('"Total",0,0,0,0,0,0,0,0,')
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

test('month period produces 31 day columns', () => {
  const csv = overviewToCSV([], monthPeriod(2026, 6))
  expect(csv.split('\n')[0].split(',')).toHaveLength(31 + 3)
})

test('filenames encode the period', () => {
  expect(overviewFilename(wk)).toBe('yg-overview-weekly-2026-07-20.csv')
  expect(overviewFilename(monthPeriod(2026, 6))).toBe('yg-overview-monthly-2026-07.csv')
})
