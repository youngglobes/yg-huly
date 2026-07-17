import { buildOverviewGrid } from '../hr-report'

const wk = { start: new Date('2026-07-13T00:00:00').getTime() } // Mon
const emp = (id: string, name: string) => ({ ref: id as any, name })
const e = (employee: string, dayIso: string, hours: number) =>
  ({ employee, date: new Date(dayIso + 'T00:00:00').getTime(), hours, project: 'p', _id: Math.random().toString() } as any)

test('full weekday-8h week → complete, shortfall 0', () => {
  const rows = buildOverviewGrid(
    ['2026-07-13','2026-07-14','2026-07-15','2026-07-16','2026-07-17'].map(d => e('o', d, 8)),
    [emp('o','Oliver')], wk)
  expect(rows[0].weekTotal).toBe(40)
  expect(rows[0].complete).toBe(true)
  expect(rows[0].shortfall).toBe(0)
  expect(rows[0].days).toEqual([8,8,8,8,8,0,0])
})
test('partial week → under with correct shortfall', () => {
  const rows = buildOverviewGrid([e('p','2026-07-13',6), e('p','2026-07-14',5)], [emp('p','Praja')], wk)
  expect(rows[0].weekTotal).toBe(11)
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
  expect(rows[0].weekTotal).toBe(44)
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
