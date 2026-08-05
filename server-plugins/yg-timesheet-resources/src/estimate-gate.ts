//
// YoungGlobes: estimate gate (backlog #1). Pure rule shared conceptually by the server guard
// (OnIssueEstimateGate) and the StatusEditor client pre-check: an issue may not move into a
// started (Active-category) status without a positive estimate.
//
import { type Ref } from '@hcengineering/core'
import { type StatusCategory } from '@hcengineering/task'

/**
 * True when moving an issue into `newCategory` must be blocked for lack of an estimate: the target
 * status is the Active (started) category and the issue has no positive estimate. Pure - the caller
 * passes the Active category ref (task.statusCategory.Active), so this has no platform-resolution
 * dependency and is trivially unit-testable.
 */
export function estimateRequiredToActivate (
  newCategory: Ref<StatusCategory> | undefined,
  activeCategory: Ref<StatusCategory>,
  estimation: number | undefined
): boolean {
  return newCategory === activeCategory && (estimation ?? 0) <= 0
}
