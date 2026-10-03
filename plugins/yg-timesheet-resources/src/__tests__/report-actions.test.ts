import { indexTasks, taskForRow } from '../utils/report-actions'

const DAY = 86_400_000
const t0 = Date.UTC(2026, 8, 29) - 330 * 60000 // IST midnight 29 Sep
const tasks = [
  { id: 'task-a', employee: 'e1', issue: 'i1', start: t0, status: 'Approved' as const },
  { id: 'task-b', employee: 'e1', issue: 'i1', start: t0 + DAY, status: 'Submitted' as const }
]

describe('taskForRow', () => {
  const idx = indexTasks(tasks)
  it('two time entries of the same task and day resolve to the same task', () => {
    expect(taskForRow(idx, 'e1', 'i1', t0 + 2 * 3_600_000)?.id).toBe('task-a')
    expect(taskForRow(idx, 'e1', 'i1', t0 + 20 * 3_600_000)?.id).toBe('task-a')
  })
  it('the next day maps to that day\'s task', () => {
    expect(taskForRow(idx, 'e1', 'i1', t0 + DAY + 3_600_000)?.id).toBe('task-b')
  })
  it('no task for an unsubmitted entry or another person', () => {
    expect(taskForRow(idx, 'e1', 'i1', t0 + 5 * DAY)).toBeUndefined()
    expect(taskForRow(idx, 'e2', 'i1', t0)).toBeUndefined()
  })
})
