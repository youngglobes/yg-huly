//
// Client-side estimate gate (backlog #1): mirrors the server guard's rule
// (server-plugins/yg-timesheet-resources/src/estimate-gate.ts). Shared by the status dropdown
// (StatusEditor) and the Kanban board drag (KanbanView) so every path fails the same way.
//
import { type IdMap, type Ref, type Status } from '@hcengineering/core'
import task from '@hcengineering/task'

/** True when moving into `newStatus` must be blocked: its category is Active (started) and the
 *  issue has no positive estimate. `byId` is the status store map ($statusStore.byId). */
export function estimateBlocksActivation (
  newStatus: Ref<Status> | undefined,
  estimation: number | undefined,
  byId: IdMap<Status>
): boolean {
  if (newStatus === undefined) return false
  return byId.get(newStatus)?.category === task.statusCategory.Active && (estimation ?? 0) <= 0
}
