import { groupOpen, isMyTeamGroup, parseOverrides } from '../utils/approval-collapse'

describe('isMyTeamGroup', () => {
  it('is true when any pending task lists me as an approver', () => {
    const tasks = [{ approvers: ['pm-1', 'tl-2'] }, { approvers: ['pm-9'] }]
    expect(isMyTeamGroup(tasks, 'tl-2')).toBe(true)
  })

  it('is false when none of the tasks list me', () => {
    expect(isMyTeamGroup([{ approvers: ['pm-9'] }, { approvers: [] }], 'tl-2')).toBe(false)
  })

  it('tolerates tasks with no approvers field', () => {
    expect(isMyTeamGroup([{}], 'tl-2')).toBe(false)
  })
})

describe('groupOpen', () => {
  it('follows the smart default when there is no override', () => {
    expect(groupOpen('e1', {}, true)).toBe(true)
    expect(groupOpen('e1', {}, false)).toBe(false)
  })

  it('lets an explicit override win either way', () => {
    expect(groupOpen('e1', { e1: false }, true)).toBe(false)
    expect(groupOpen('e1', { e1: true }, false)).toBe(true)
  })

  it('ignores overrides for other people', () => {
    expect(groupOpen('e1', { e2: false }, true)).toBe(true)
  })
})

describe('parseOverrides', () => {
  it('reads a stored object of booleans', () => {
    expect(parseOverrides('{"e1":true,"e2":false}')).toEqual({ e1: true, e2: false })
  })

  it('drops non-boolean values', () => {
    expect(parseOverrides('{"e1":"yes","e2":false}')).toEqual({ e2: false })
  })

  it('returns an empty set for null, empty, arrays and garbage', () => {
    expect(parseOverrides(null)).toEqual({})
    expect(parseOverrides('')).toEqual({})
    expect(parseOverrides('[1,2]')).toEqual({})
    expect(parseOverrides('not json')).toEqual({})
  })
})
