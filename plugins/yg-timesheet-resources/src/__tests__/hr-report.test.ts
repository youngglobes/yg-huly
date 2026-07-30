import { buildWeekGrid, type HrEntry } from '../utils/hr-report'
import { weekRange } from '../utils/week'

// Mon 2026-07-13 .. Sun 2026-07-19
const W = weekRange(new Date(2026, 6, 15).getTime())
const at = (y: number, m: number, d: number): number => new Date(y, m, d, 9).getTime()
const e = (o: Partial<HrEntry>): HrEntry => ({
  date: at(2026, 6, 13),
  project: 'p1',
  projectName: 'Proj 1',
  issue: 'i1',
  identifier: 'A-1',
  title: 't1',
  hours: 2,
  note: '',
  ...o
})

describe('buildWeekGrid', () => {
  it('pivots entries to Project→Task rows with Mon..Sun cells', () => {
    const g = buildWeekGrid([e({ date: at(2026, 6, 13), hours: 2 }), e({ date: at(2026, 6, 15), hours: 1 })], W)
    expect(g.rows).toHaveLength(1)
    expect(g.rows[0].cells).toEqual([2, 0, 1, 0, 0, 0, 0]) // Mon=2, Wed=1
    expect(g.rows[0].rowTotal).toBe(3)
  })
  it('sums multiple entries for the same task+day into one cell', () => {
    const g = buildWeekGrid([e({ date: at(2026, 6, 13), hours: 2 }), e({ date: at(2026, 6, 13), hours: 1 })], W)
    expect(g.rows[0].cells[0]).toBe(3)
  })
  it('separate tasks are separate rows; day + grand totals aggregate across rows', () => {
    const g = buildWeekGrid(
      [
        e({ issue: 'i1', identifier: 'A-1', date: at(2026, 6, 13), hours: 2 }),
        e({ issue: 'i2', identifier: 'A-2', title: 't2', date: at(2026, 6, 13), hours: 3 })
      ],
      W
    )
    expect(g.rows).toHaveLength(2)
    expect(g.dayTotals[0]).toBe(5)
    expect(g.grandTotal).toBe(5)
  })
  it('drops entries outside the week', () => {
    const g = buildWeekGrid([e({ date: at(2026, 6, 20), hours: 9 })], W) // next Mon
    expect(g.rows).toHaveLength(0)
    expect(g.grandTotal).toBe(0)
  })
  it('sorts rows by projectName then identifier (numeric-aware)', () => {
    const g = buildWeekGrid(
      [
        e({ project: 'p1', projectName: 'Beta', identifier: 'B-2', issue: 'x' }),
        e({ project: 'p1', projectName: 'Beta', identifier: 'B-10', issue: 'y' }),
        e({ project: 'p2', projectName: 'Alpha', identifier: 'A-1', issue: 'z' })
      ],
      W
    )
    expect(g.rows.map((r) => r.identifier)).toEqual(['A-1', 'B-2', 'B-10'])
  })
  it('captures the note per cell', () => {
    const g = buildWeekGrid([e({ date: at(2026, 6, 13), note: 'fixed login' })], W)
    expect(g.rows[0].notesByDay[0]).toBe('fixed login')
  })
})
