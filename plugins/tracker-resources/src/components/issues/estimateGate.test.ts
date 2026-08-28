import { type IdMap, type Ref, type Status } from '@hcengineering/core'
import task from '@hcengineering/task'
import { estimateBlocksActivation } from './estimateGate'

const ACTIVE = task.statusCategory.Active
const TODO = task.statusCategory.ToDo
const byId = new Map<Ref<Status>, Status>([
  ['s-active' as Ref<Status>, { category: ACTIVE } as Status],
  ['s-todo' as Ref<Status>, { category: TODO } as Status]
]) as unknown as IdMap<Status>

describe('estimateBlocksActivation', () => {
  it('blocks Active target with no estimate', () => {
    expect(estimateBlocksActivation('s-active' as Ref<Status>, 0, byId)).toBe(true)
    expect(estimateBlocksActivation('s-active' as Ref<Status>, undefined, byId)).toBe(true)
  })
  it('allows Active target with a positive estimate', () => {
    expect(estimateBlocksActivation('s-active' as Ref<Status>, 4, byId)).toBe(false)
  })
  it('allows a non-Active target regardless of estimate', () => {
    expect(estimateBlocksActivation('s-todo' as Ref<Status>, 0, byId)).toBe(false)
  })
  it('allows an undefined target', () => {
    expect(estimateBlocksActivation(undefined, 0, byId)).toBe(false)
  })
})
