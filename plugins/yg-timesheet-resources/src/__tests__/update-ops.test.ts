import { isOperator } from '@hcengineering/core'
import { splitUnset } from '../utils/update-ops'
import { approveTask, recallDay, recallTask, rejectTask } from '../utils/day'
import { approveLatePermission, rejectLatePermission } from '../utils/attendance-write'

jest.mock('@hcengineering/contact', () => ({ getCurrentEmployee: () => 'me' }))

// Records every updateDoc; finds return nothing, so only the task/permission writes are seen.
function fakeClient (): { client: any, updates: Array<Record<string, any>> } {
  const updates: Array<Record<string, any>> = []
  const client = {
    updateDoc: async (_c: any, _s: any, _id: any, ops: Record<string, any>) => { updates.push(ops) },
    findOne: async () => undefined,
    findAll: async () => [],
    remove: async () => {},
    createDoc: async () => 'x'
  }
  return { client, updates }
}

// The storage adapter applies `$unset` only when every key is an operator (isOperator); a mixed
// update loses it. Every update we send must be all-plain or all-operator.
function expectNoMixed (updates: Array<Record<string, any>>): void {
  for (const u of updates) {
    const keys = Object.keys(u)
    if (keys.some((k) => k.startsWith('$'))) expect(isOperator(u)).toBe(true)
  }
}

describe('splitUnset', () => {
  it('separates plain fields from $unset', () => {
    expect(splitUnset({ status: 'Submitted', $unset: { approvedHours: '' } } as any))
      .toEqual({ set: { status: 'Submitted' }, unset: { $unset: { approvedHours: '' } } })
  })
  it('leaves a side undefined when it is empty', () => {
    expect(splitUnset({ status: 'Draft' } as any)).toEqual({ set: { status: 'Draft' }, unset: undefined })
    expect(splitUnset({ $unset: { a: '' } } as any)).toEqual({ set: undefined, unset: { $unset: { a: '' } } })
    expect(splitUnset({ status: 'Draft', $unset: {} } as any)).toEqual({ set: { status: 'Draft' }, unset: undefined })
  })
})

describe('timesheet writes never mix plain fields and $unset', () => {
  it('recallTask: status first, then a pure $unset of the approval fields', async () => {
    const { client, updates } = fakeClient()
    await recallTask(client, { _id: 't', status: 'Approved' } as any)
    expect(updates).toEqual([
      { status: 'Submitted' },
      { $unset: { approvedHours: '', approvedBy: '', approvedOn: '', rejectReason: '' } }
    ])
    expectNoMixed(updates)
  })
  it('approveTask and rejectTask', async () => {
    const a = fakeClient()
    await approveTask(a.client, 't' as any, 2)
    expect(a.updates[0]).toMatchObject({ status: 'Approved', approvedHours: 2, approvedBy: 'me' })
    expect(a.updates[1]).toEqual({ $unset: { rejectReason: '' } })
    expectNoMixed(a.updates)

    const r = fakeClient()
    await rejectTask(r.client, 't' as any, 'why')
    expect(r.updates[0]).toEqual({ status: 'Rejected', rejectReason: 'why' })
    expect(r.updates[1]).toEqual({ $unset: { approvedHours: '', approvedBy: '', approvedOn: '' } })
    expectNoMixed(r.updates)
  })
  it('recallDay', async () => {
    const { client, updates } = fakeClient()
    client.findAll = async () => [{ _id: 't1' }]
    await recallDay(client, 'd' as any)
    expectNoMixed(updates)
    expect(updates).toContainEqual({ $unset: { submittedOn: '' } })
  })
  it('late permission approve/reject', async () => {
    const a = fakeClient()
    await approveLatePermission(a.client, 'p' as any, ' ok ')
    expect(a.updates[1]).toEqual({ $unset: { rejectReason: '' } })
    expectNoMixed(a.updates)
    const r = fakeClient()
    await rejectLatePermission(r.client, 'p' as any, 'no')
    expect(r.updates[1]).toEqual({ $unset: { approvedBy: '', approvedOn: '', approveReason: '' } })
    expectNoMixed(r.updates)
  })
})
