import { filterRows, groupRows, toCSV, type ReportRow } from '../utils/reports'

const D = (y: number, m: number, d: number): number => new Date(y, m, d, 9, 0, 0).getTime()
const row = (o: Partial<ReportRow>): ReportRow => ({
  date: D(2026, 6, 14), employee: 'e1', employeeName: 'Alice', project: 'p1', projectName: 'Proj 1',
  issue: 'i1', identifier: 'A-1', title: 't1', hours: 2, status: 'Approved', note: '', ...o
})

describe('filterRows', () => {
  const rows = [
    row({ date: D(2026, 6, 13), hours: 1, status: 'Draft' }),
    row({ date: D(2026, 6, 14), hours: 2, employee: 'e2', employeeName: 'Bob', project: 'p2', projectName: 'Proj 2' }),
    row({ date: D(2026, 6, 20), hours: 3 })
  ]
  it('filters by date range [from,to)', () => {
    const r = filterRows(rows, { from: D(2026, 6, 14), to: D(2026, 6, 15) })
    expect(r).toHaveLength(1); expect(r[0].hours).toBe(2)
  })
  it('filters by project + member + status', () => {
    expect(filterRows(rows, { from: 0, to: D(2027, 0, 1), project: 'p2' })).toHaveLength(1)
    expect(filterRows(rows, { from: 0, to: D(2027, 0, 1), member: 'e2' })).toHaveLength(1)
    expect(filterRows(rows, { from: 0, to: D(2027, 0, 1), status: 'Draft' })).toHaveLength(1)
  })
})

describe('groupRows', () => {
  const rows = [row({ project: 'p1', projectName: 'Proj 1', hours: 2 }), row({ project: 'p1', projectName: 'Proj 1', hours: 3 }), row({ project: 'p2', projectName: 'Proj 2', hours: 4, employee: 'e2', employeeName: 'Bob' })]
  it('groups by project with totals + counts', () => {
    const g = groupRows(rows, 'project')
    const p1 = g.find((x) => x.key === 'p1')
    expect(p1?.label).toBe('Proj 1'); expect(p1?.totalHours).toBe(5); expect(p1?.count).toBe(2)
    expect(g).toHaveLength(2)
  })
  it('groups by member', () => { expect(groupRows(rows, 'member').find((x) => x.key === 'e2')?.totalHours).toBe(4) })
  it('groups by week bucket', () => { expect(groupRows(rows, 'week')).toHaveLength(1) })
  it("detail returns one group of all rows", () => { const g = groupRows(rows, 'detail'); expect(g).toHaveLength(1); expect(g[0].rows).toHaveLength(3) })
})

describe('toCSV', () => {
  it('emits a header + quoted rows, escaping quotes/commas', () => {
    const csv = toCSV([row({ note: 'a,"b"', title: 'x' })])
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('Date,Employee,Project,Issue,Title,Hours,Status,Description')
    expect(lines[1]).toContain('"a,""b"""')
    expect(lines[1]).toContain(',2,')
  })
})
