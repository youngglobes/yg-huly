import { filterRows, toCSV, priorityLabel, type ReportRow } from '../utils/reports'

const D = (y: number, m: number, d: number): number => new Date(y, m, d, 9, 0, 0).getTime()
const row = (o: Partial<ReportRow>): ReportRow => ({
  date: D(2026, 6, 14), employee: 'e1', employeeName: 'Alice', project: 'p1', projectName: 'Proj 1',
  issue: 'i1', identifier: 'A-1', title: 't1', estimation: 4, hours: 2,
  statusName: 'In Progress', priority: 3, dueDate: null, note: '', ...o
})

describe('filterRows', () => {
  const rows = [
    row({ date: D(2026, 6, 13), hours: 1, statusName: 'Todo' }),
    row({ date: D(2026, 6, 14), hours: 2, employee: 'e2', employeeName: 'Bob', project: 'p2', projectName: 'Proj 2' }),
    row({ date: D(2026, 6, 20), hours: 3 })
  ]
  it('filters by date range [from,to)', () => {
    const r = filterRows(rows, { from: D(2026, 6, 14), to: D(2026, 6, 15) })
    expect(r).toHaveLength(1); expect(r[0].hours).toBe(2)
  })
  it('filters by project + member + status(name)', () => {
    expect(filterRows(rows, { from: 0, to: D(2027, 0, 1), project: 'p2' })).toHaveLength(1)
    expect(filterRows(rows, { from: 0, to: D(2027, 0, 1), member: 'e2' })).toHaveLength(1)
    expect(filterRows(rows, { from: 0, to: D(2027, 0, 1), status: 'Todo' })).toHaveLength(1)
  })
})

describe('priorityLabel', () => {
  it('maps the IssuePriority enum to a label', () => {
    expect(priorityLabel(0)).toBe('No priority')
    expect(priorityLabel(1)).toBe('Urgent')
    expect(priorityLabel(2)).toBe('High')
    expect(priorityLabel(3)).toBe('Medium')
    expect(priorityLabel(4)).toBe('Low')
  })
  it('falls back to No priority for an unknown value', () => {
    expect(priorityLabel(99)).toBe('No priority')
  })
})

describe('toCSV', () => {
  const HEAD =
    'Date,Employee,Project,Huly ID,Issue Title,Estimated,Spent,' +
    'TL/PM Approved Hours,TL/PM Approved By,Client Approved Hours,Client Approved By,' +
    'Status,Priority,Due date,Notes'
  it('emits a header + quoted rows, escaping quotes/commas', () => {
    const csv = toCSV([row({ note: 'a,"b"', title: 'x' })])
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe(HEAD)
    expect(lines[1]).toContain('"a,""b"""')
    // Estimated=4, Spent=2 emitted as bare decimals, then the four blank approval columns.
    expect(lines[1]).toContain(',4,2,,,,,')
  })
  it('leaves the four manual approval columns blank', () => {
    const csv = toCSV([row({})])
    const cells = csv.trim().split('\n')[1].split(',')
    // indices: 0 Date,1 Employee,2 Project,3 HulyID,4 Title,5 Estimated,6 Spent,
    //          7 TL/PM hrs,8 TL/PM by,9 Client hrs,10 Client by,11 Status,...
    expect(cells.slice(7, 11)).toEqual(['', '', '', ''])
  })
  it('includes the issue title, priority label and formatted due date', () => {
    const csv = toCSV([row({ title: 'Fix login', priority: 1, dueDate: D(2026, 6, 31) })])
    const lines = csv.trim().split('\n')
    expect(lines[1]).toContain('"Fix login"')
    expect(lines[1]).toContain('"Urgent"')
    expect(lines[1]).toContain('"2026-07-31"')
  })
  it('leaves due date blank when unset', () => {
    const csv = toCSV([row({ dueDate: null })])
    // trailing ...,"",note — the due-date cell is an empty quoted string.
    expect(csv.trim().split('\n')[1]).toContain(',"",""')
  })
  it('guards a formula-like text cell with a leading apostrophe', () => {
    const csv = toCSV([row({ title: '=HYPERLINK("http://evil","x")' })])
    const lines = csv.trim().split('\n')
    expect(lines[1]).toContain('"\'=HYPERLINK(""http://evil"",""x"")"')
  })
  it('returns just the header + newline for an empty row list', () => {
    expect(toCSV([])).toBe(`${HEAD}\n`)
  })
  it('fills TL/PM approved hours + approver when the task was approved', () => {
    const cells = toCSV([row({ approvedHours: 1, approvedByName: 'Tina Lead' })]).trim().split('\n')[1].split(',')
    expect(cells[7]).toBe('1')
    expect(cells[8]).toBe('"Tina Lead"')
  })
  it('leaves TL/PM approval columns blank when not approved', () => {
    const cells = toCSV([row({})]).trim().split('\n')[1].split(',')
    expect(cells[7]).toBe('')
    expect(cells[8]).toBe('')
  })
  it('client approval columns stay blank even when TL/PM approved', () => {
    const cells = toCSV([row({ approvedHours: 1, approvedByName: 'Tina Lead' })]).trim().split('\n')[1].split(',')
    expect(cells[9]).toBe('')
    expect(cells[10]).toBe('')
  })
})
