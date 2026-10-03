import type { Ref } from '@hcengineering/core'
import type { Employee } from '@hcengineering/contact'
import { canActOnTimesheetTask, reportTaskAction } from '@hcengineering/yg-timesheet'
import { isOpen } from '../utils/reject-cycle'

const E = (s: string): Ref<Employee> => s as Ref<Employee>
const base = { actor: E('pm'), owner: E('emp'), isAdmin: false, isHr: false, projectApprovers: [E('pm')] }

describe('canActOnTimesheetTask', () => {
  it('lets the project approver act', () => {
    expect(canActOnTimesheetTask(base)).toBe(true)
  })
  it('refuses an approver of a different project', () => {
    expect(canActOnTimesheetTask({ ...base, actor: E('otherpm'), projectApprovers: [E('pm')] })).toBe(false)
  })
  it('lets HR and admins act on any project', () => {
    expect(canActOnTimesheetTask({ ...base, actor: E('hr'), isHr: true, projectApprovers: [] })).toBe(true)
    expect(canActOnTimesheetTask({ ...base, actor: E('adm'), isAdmin: true, projectApprovers: [] })).toBe(true)
  })
  it('never on your own timesheet, admins and HR included', () => {
    expect(canActOnTimesheetTask({ ...base, actor: E('emp'), owner: E('emp'), projectApprovers: [E('emp')] })).toBe(false)
    expect(canActOnTimesheetTask({ ...base, actor: E('emp'), owner: E('emp'), isAdmin: true, isHr: true })).toBe(false)
  })
  it('fails closed when owner or actor is unknown', () => {
    expect(canActOnTimesheetTask({ ...base, owner: undefined })).toBe(false)
    expect(canActOnTimesheetTask({ ...base, actor: undefined, isAdmin: true })).toBe(false)
  })
})

describe('reportTaskAction', () => {
  it('maps task status to the Reports action', () => {
    expect(reportTaskAction('Submitted')).toBe('approve-reject')
    expect(reportTaskAction('Approved')).toBe('recall')
    expect(reportTaskAction('Rejected')).toBe('recall')
    expect(reportTaskAction('Draft')).toBe('none')
    expect(reportTaskAction(undefined)).toBe('none')
  })
})

describe('isOpen with recall', () => {
  const c = { employee: 'e', issue: 'i', date: 0, rejectReason: 'r', rejectedOn: 1 }
  it('a recalled rejection is no longer open', () => {
    expect(isOpen(c)).toBe(true)
    expect(isOpen({ ...c, recalledOn: 2 })).toBe(false)
    expect(isOpen({ ...c, resubmittedOn: 2 })).toBe(false)
  })
})
