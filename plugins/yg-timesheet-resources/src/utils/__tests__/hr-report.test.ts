import { buildOverviewGrid } from '../hr-report'
import { weekPeriod, monthPeriod } from '../period'

const wk = weekPeriod(new Date(2026, 6, 15).getTime()) // week of Mon 2026-07-13
const emp = (id: string, name: string) => ({ ref: id as any, name })
const e = (employee: string, dayIso: string, hours: number) =>
  ({ employee, date: new Date(dayIso + 'T00:00:00').getTime(), hours, project: 'p', _id: Math.random().toString() } as any)

test('full weekday-8h week → complete, shortfall 0', () => {
  const rows = buildOverviewGrid(
    ['2026-07-13','2026-07-14','2026-07-15','2026-07-16','2026-07-17'].map(d => e('o', d, 8)),
    [emp('o','Oliver')], wk)
  expect(rows[0].total).toBe(40)
  expect(rows[0].complete).toBe(true)
  expect(rows[0].shortfall).toBe(0)
  expect(rows[0].days).toEqual([8,8,8,8,8,0,0])
})
test('partial week → under with correct shortfall', () => {
  const rows = buildOverviewGrid([e('p','2026-07-13',6), e('p','2026-07-14',5)], [emp('p','Praja')], wk)
  expect(rows[0].total).toBe(11)
  expect(rows[0].complete).toBe(false)
  expect(rows[0].shortfall).toBe(29) // (8-6)+(8-5)+8+8+8
})
test('employee with no entries → all-zero under row', () => {
  const rows = buildOverviewGrid([], [emp('z','Zoe')], wk)
  expect(rows[0].days).toEqual([0,0,0,0,0,0,0])
  expect(rows[0].complete).toBe(false)
  expect(rows[0].shortfall).toBe(40)
})
test('weekend hours count in weekTotal, not completeness', () => {
  const full = ['2026-07-13','2026-07-14','2026-07-15','2026-07-16','2026-07-17'].map(d => e('o', d, 8))
  const rows = buildOverviewGrid([...full, e('o','2026-07-18',4)], [emp('o','Oliver')], wk)
  expect(rows[0].total).toBe(44)
  expect(rows[0].complete).toBe(true)
  expect(rows[0].days[5]).toBe(4)
})
test('multiple entries same day sum into one cell', () => {
  const rows = buildOverviewGrid([e('o','2026-07-13',4), e('o','2026-07-13',4)], [emp('o','Oliver')], wk)
  expect(rows[0].days[0]).toBe(8)
})
test('rows sorted by name ascending', () => {
  const rows = buildOverviewGrid([], [emp('b','Bravo'), emp('a','Alpha')], wk)
  expect(rows.map(r => r.name)).toEqual(['Alpha','Bravo'])
})

test('month period: 31 day slots, hours land on the right day', () => {
  const p = monthPeriod(2026, 6) // July 2026
  const rows = buildOverviewGrid([e('p', '2026-07-01', 3), e('p', '2026-07-31', 4)], [emp('p', 'Praja')], p)
  expect(rows[0].days).toHaveLength(31)
  expect(rows[0].days[0]).toBe(3)
  expect(rows[0].days[30]).toBe(4)
  expect(rows[0].total).toBe(7)
})

test('month period: shortfall is the per-weekday sum, not the aggregate', () => {
  const p = monthPeriod(2026, 6) // 23 weekdays
  // 16h on Wed 2026-07-01 only. Per-weekday: that day is fully covered (8h target, 16 logged
  // → 0), the other 22 weekdays are 8h short each → 176. An aggregate formula would wrongly
  // say 23*8 - 16 = 168.
  const rows = buildOverviewGrid([e('p', '2026-07-01', 16)], [emp('p', 'Praja')], p)
  expect(rows[0].shortfall).toBe(176)
})

test('entries outside the period are ignored', () => {
  const p = monthPeriod(2026, 6)
  const rows = buildOverviewGrid([e('p', '2026-08-03', 8)], [emp('p', 'Praja')], p)
  expect(rows[0].total).toBe(0)
})
