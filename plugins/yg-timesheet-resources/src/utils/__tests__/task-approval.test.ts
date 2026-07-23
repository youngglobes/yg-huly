import { buildTaskUnits, deriveDayStatus, canApproveTask, taskDrift } from '../task-approval'
import type { DayReportLike, ProjectApproverLike } from '../workflow'

function rep (issue: string, project: string, value: number, identifier = issue): DayReportLike {
  return { project, employee: 'k2', issue, identifier, title: `T ${issue}`, value, note: '' }
}
const approvers = new Map<string, ProjectApproverLike>([
  ['proj-1', { pm: 'pm-1', teamLead: 'tl-a' }],
  ['proj-2', { pm: 'pm-1', teamLead: 'tl-b' }]
])

test('one unit per issue, hours summed across entries on the same issue', () => {
  const units = buildTaskUnits([rep('i1', 'proj-1', 2), rep('i1', 'proj-1', 1)], approvers, 'k2')
  expect(units).toHaveLength(1)
  expect(units[0].submittedHours).toBe(3)
})

test('separate issues stay separate units', () => {
  const units = buildTaskUnits([rep('i1', 'proj-1', 3), rep('i2', 'proj-2', 5)], approvers, 'k2')
  expect(units).toHaveLength(2)
})

test('THE DEFECT: each unit carries ONLY its own project approvers', () => {
  const units = buildTaskUnits([rep('i1', 'proj-1', 3), rep('i2', 'proj-2', 5)], approvers, 'k2')
  const u1 = units.find((u) => u.issue === 'i1')!
  const u2 = units.find((u) => u.issue === 'i2')!
  expect(u1.approvers.sort()).toEqual(['pm-1', 'tl-a'])
  expect(u2.approvers.sort()).toEqual(['pm-1', 'tl-b'])
  expect(u1.approvers).not.toContain('tl-b')
  expect(u2.approvers).not.toContain('tl-a')
})

test('the employee is never their own approver', () => {
  const self = new Map<string, ProjectApproverLike>([['proj-1', { pm: 'k2', teamLead: 'tl-a' }]])
  expect(buildTaskUnits([rep('i1', 'proj-1', 2)], self, 'k2')[0].approvers).toEqual(['tl-a'])
})

test('a project with no PM/TL yields an empty approver list (surfaced, not guessed)', () => {
  const none = new Map<string, ProjectApproverLike>([['proj-9', {}]])
  expect(buildTaskUnits([rep('i9', 'proj-9', 2)], none, 'k2')[0].approvers).toEqual([])
})

test('units are sorted by identifier, numeric-aware', () => {
  const units = buildTaskUnits(
    [rep('i10', 'proj-1', 1, 'TSK-10'), rep('i2', 'proj-1', 1, 'TSK-2')], approvers, 'k2'
  )
  expect(units.map((u) => u.identifier)).toEqual(['TSK-2', 'TSK-10'])
})

test('deriveDayStatus: any rejected wins', () => {
  expect(deriveDayStatus(['Approved', 'Rejected'])).toBe('Rejected')
})

test('deriveDayStatus: all approved', () => {
  expect(deriveDayStatus(['Approved', 'Approved'])).toBe('Approved')
})

test('deriveDayStatus: mixed approved and submitted = PartiallyApproved', () => {
  expect(deriveDayStatus(['Approved', 'Submitted'])).toBe('PartiallyApproved')
})

test('deriveDayStatus: submitted only', () => {
  expect(deriveDayStatus(['Submitted', 'Submitted'])).toBe('Submitted')
})

test('deriveDayStatus: drafts only, and the empty day', () => {
  expect(deriveDayStatus(['Draft'])).toBe('Draft')
  expect(deriveDayStatus([])).toBe('Draft')
})

test('deriveDayStatus: approved + draft is still PartiallyApproved', () => {
  expect(deriveDayStatus(['Approved', 'Draft'])).toBe('PartiallyApproved')
})

test('taskDrift: hours edited after approval are flagged, not locked', () => {
  expect(taskDrift(3, 3)).toBe(0)
  expect(taskDrift(3, 4.5)).toBe(1.5) // logged more after approval
  expect(taskDrift(3, 2)).toBe(-1)    // logged less after approval
  expect(taskDrift(1 / 3, 1 / 3)).toBe(0) // no float noise
})

test('canApproveTask: only this task approvers, never the employee', () => {
  expect(canApproveTask(['tl-a'], 'k2', 'tl-a', false)).toBe(true)
  expect(canApproveTask(['tl-a'], 'k2', 'tl-b', false)).toBe(false) // THE DEFECT, closed
  expect(canApproveTask(['tl-a'], 'k2', 'k2', true)).toBe(false) // no self-approve, even admin
  expect(canApproveTask([], 'k2', 'someone', true)).toBe(true) // admin override
})
