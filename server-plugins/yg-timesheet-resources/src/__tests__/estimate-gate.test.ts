import task from '@hcengineering/task'
import { estimateRequiredToActivate } from '../estimate-gate'

const ACTIVE = task.statusCategory.Active
const TODO = task.statusCategory.ToDo

describe('estimateRequiredToActivate', () => {
  it('blocks a move into Active with no estimate (unset)', () => {
    expect(estimateRequiredToActivate(ACTIVE, ACTIVE, undefined)).toBe(true)
  })

  it('blocks a move into Active with a zero estimate', () => {
    expect(estimateRequiredToActivate(ACTIVE, ACTIVE, 0)).toBe(true)
  })

  it('allows a move into Active when a positive estimate exists', () => {
    expect(estimateRequiredToActivate(ACTIVE, ACTIVE, 4)).toBe(false)
  })

  it('allows a move into a non-Active status regardless of estimate', () => {
    expect(estimateRequiredToActivate(TODO, ACTIVE, 0)).toBe(false)
    expect(estimateRequiredToActivate(TODO, ACTIVE, undefined)).toBe(false)
  })

  it('allows when the target category is undefined', () => {
    expect(estimateRequiredToActivate(undefined, ACTIVE, 0)).toBe(false)
  })

  it('treats a negative estimate as no estimate', () => {
    expect(estimateRequiredToActivate(ACTIVE, ACTIVE, -1)).toBe(true)
  })
})
