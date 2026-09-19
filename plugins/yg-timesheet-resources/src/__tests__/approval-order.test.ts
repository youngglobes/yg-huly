import { sortApprovalGroups } from '../utils/approval-order'

describe('sortApprovalGroups', () => {
  const g = (name: string, employee: string | undefined = name.toLowerCase()) => ({ name, employee })

  it('orders groups by employee name, case-insensitively', () => {
    const out = sortApprovalGroups([g('Sriram'), g('jeba'), g('Ananthan')])
    expect(out.map((x) => x.name)).toEqual(['Ananthan', 'jeba', 'Sriram'])
  })

  it('keeps the same order whichever tasks were approved (input order is irrelevant)', () => {
    const before = sortApprovalGroups([g('Jeba'), g('Sriram'), g('Ananthan')]).map((x) => x.name)
    const after = sortApprovalGroups([g('Sriram'), g('Ananthan'), g('Jeba')]).map((x) => x.name)
    expect(after).toEqual(before)
  })

  it('sinks the Unknown bucket to the end', () => {
    const out = sortApprovalGroups([g('Unknown', undefined), g('Jeba'), g('Ananthan')])
    expect(out.map((x) => x.name)).toEqual(['Ananthan', 'Jeba', 'Unknown'])
  })

  it('does not mutate the input', () => {
    const input = [g('Sriram'), g('Ananthan')]
    sortApprovalGroups(input)
    expect(input.map((x) => x.name)).toEqual(['Sriram', 'Ananthan'])
  })
})
