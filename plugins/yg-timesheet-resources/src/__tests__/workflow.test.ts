import {
  legalTransition, resolveApprovers, buildSnapshot, canApprove, canEditApproved, driftHours,
  type DayReportLike, type ProjectApproverLike
} from '../utils/workflow'

const rep = (project: string, issue: string, value: number, id = issue): DayReportLike => ({
  project, employee: 'A', issue, identifier: id, title: 't-' + issue, value, note: 'n-' + issue
})

describe('legalTransition', () => {
  it.each([
    ['Draft', 'Submitted', true], ['Submitted', 'Approved', true], ['Submitted', 'Rejected', true],
    ['Submitted', 'Draft', true], ['Approved', 'Draft', true], ['Rejected', 'Draft', true],
    ['Rejected', 'Submitted', true], ['Draft', 'Approved', false], ['Approved', 'Submitted', false],
    ['Draft', 'Draft', false]
  ] as const)('%s -> %s = %p', (a, b, ok) => { expect(legalTransition(a as any, b as any)).toBe(ok) })
})

describe('resolveApprovers', () => {
  const by = new Map<string, ProjectApproverLike>([
    ['P1', { pm: 'C', teamLead: 'B' }], ['P2', { pm: 'C', teamLead: null }]
  ])
  it('unions pm+teamLead over the day projects, minus the employee', () => {
    const got = resolveApprovers([rep('P1', 'i1', 2), rep('P2', 'i2', 1)], by, 'A').sort()
    expect(got).toEqual(['B', 'C'])
  })
  it('drops the employee even if they are an approver (no self-approve)', () => {
    const got = resolveApprovers([rep('P1', 'i1', 2)], new Map([['P1', { pm: 'A', teamLead: 'B' }]]), 'A')
    expect(got).toEqual(['B'])
  })
  it('returns empty when no project has approvers', () => {
    expect(resolveApprovers([rep('PX', 'i1', 2)], new Map(), 'A')).toEqual([])
  })
})

describe('buildSnapshot', () => {
  it('collapses same-issue reports and totals hours', () => {
    const { lines, totalHours } = buildSnapshot([rep('P1', 'i1', 2), rep('P1', 'i1', 1), rep('P1', 'i2', 3)])
    expect(totalHours).toBe(6)
    expect(lines.find((l) => l.issue === 'i1')?.hours).toBe(3)
    expect(lines).toHaveLength(2)
  })
})

describe('canApprove', () => {
  it('true for an approver who is not the employee', () => { expect(canApprove(['B', 'C'], 'A', 'B', false)).toBe(true) })
  it('false for the employee even if admin (no self-approve)', () => { expect(canApprove(['B'], 'A', 'A', true)).toBe(false) })
  it('true for admin who is not the employee, even if not in the set', () => { expect(canApprove(['B'], 'A', 'Z', true)).toBe(true) })
  it('false for a non-approver non-admin', () => { expect(canApprove(['B'], 'A', 'Z', false)).toBe(false) })
})

describe('canEditApproved', () => {
  it('only the approver (or admin) may edit an approved day', () => {
    expect(canEditApproved('B', 'B', false)).toBe(true)
    expect(canEditApproved('B', 'C', false)).toBe(false)
    expect(canEditApproved('B', 'C', true)).toBe(true)
    expect(canEditApproved(undefined, 'C', false)).toBe(false)
  })
})

describe('driftHours', () => {
  it('reports live-minus-snapshot rounded to 2dp', () => { expect(driftHours(8, 8.5)).toBe(0.5); expect(driftHours(8, 8)).toBe(0) })
})
