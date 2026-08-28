# Estimate-gate: consistent blocked-status feedback + toast height fix

**Date:** 2026-08-05
**Status:** Design (approved)
**Repo:** youngglobes/yg-huly (branch `yg_beta`)
**Builds on:** the estimate gate (`2026-08-04-estimate-before-start-design.md`) - the server guard already
blocks EVERY status-change path; this only makes the client FEEDBACK consistent.

## Problems

1. **Blocked-status toast only fires on one path.** The client pre-check lives in `StatusEditor.svelte`
   (details page / hover card / list inline dropdown). The other status-change paths - the context
   menu / bulk / `S S` keybinding, and Kanban board drag - are reverted by the server but show no
   toast, so the user sees a silent snap-back.
2. **The toast renders ~22rem tall** (fixed empty box). Root cause: `NotificationToast` uses the CSS
   class name `notifyPopup`, which collides with a GLOBAL `.notifyPopup` rule (the calendar reminders /
   help-and-support popup) carrying `min-height: 22rem`. `NotificationToast` sets no `min-height`, so the
   global one leaks in and forces every toast to 22rem. (Confirmed in the deployed bundle:
   `.notifyPopup,.helpAndSupportPopup{...min-height:22rem}`.)

## Scope (approved: menus + board drag)

Cover the **context menu / bulk / keybinding** path and the **Kanban board drag** path. The
details/inline-dropdown path already works. Dragging a list ROW between status groups stays on the
silent server block (no clean tracker-only seam; out of scope). All client-only -> one front build,
batched with the pending performance work.

## Fix 1 - toast height (all toasts, one component)

`packages/ui/src/components/NotificationToast.svelte`: rename the root card's CSS class from
`notifyPopup` to a unique name (`toastCard`) - the class attribute on the root `<div>` and the
top-level `.notifyPopup { }` selector in its scoped `<style>` (nested `&.sev-*`, `.icon-*`, `.content`,
`&::before`, `:global(.buttons-group)` stay as-is, relative to the renamed parent). This decouples the
toast from the leaky global `.notifyPopup { min-height: 22rem }` so the card sizes to its content.
Nothing else targets the toast via `.notifyPopup` (the only external `.notifyPopup` rule is the
reminders/help popup's own), so the rename is self-contained.

## Fix 2 - shared client gate helper (tracker-resources)

The estimate check is currently inlined in `StatusEditor.changeStatus`. Extract it to a tiny shared
helper so `StatusEditor` and `KanbanView` (same package) use one implementation:

`plugins/tracker-resources/src/issues/estimateGate.ts` (new):
```ts
import { type Ref } from '@hcengineering/core'
import { type IssueStatus } from '@hcengineering/tracker'
import { type IdMap } from '@hcengineering/core'
import task from '@hcengineering/task'

/** True when moving an issue with estimate `estimation` into status `newStatus` must be blocked:
 *  the target status's category is Active (started) and the issue has no positive estimate. */
export function estimateBlocksActivation (
  newStatus: Ref<IssueStatus> | undefined,
  estimation: number | undefined,
  byId: IdMap<IssueStatus>
): boolean {
  if (newStatus === undefined) return false
  return byId.get(newStatus)?.category === task.statusCategory.Active && (estimation ?? 0) <= 0
}
```
`StatusEditor.svelte` replaces its inlined condition with `estimateBlocksActivation(newStatus, value.estimation, $statusStore.byId)` (behaviour identical). It keeps using its existing `EstimateBlockedNotification` toast.

## Fix 3 - Kanban board drag (tracker-resources + packages/kanban)

Two small changes:

- `packages/kanban/src/components/Kanban.svelte` `move(state)` (the DROP handler): when
  `getUpdateProps(...)` returns `undefined` (the move is rejected), `dispatch('move-blocked', { doc: dragCard, state })`
  before clearing `dragCard`. This is additive and generic (a rejected drop simply emits an event); the
  hover/drag-over calls to `getUpdateProps` (the other call sites) do NOT dispatch, so the event fires
  only on an actual drop.
- `plugins/tracker-resources/src/components/issues/KanbanView.svelte`:
  - In `getUpdateProps`, when `groupByKey === IssuesGrouping.Status` and the resolved target status
    would block an un-estimated issue (`estimateBlocksActivation(groupValue, (doc as Issue).estimation, $statusStore.byId)`),
    return `undefined` (blocks the drop, consistent with the server; also stops the drag-preview from
    entering the blocked column).
  - Add `on:move-blocked` on `<KanbanUI>`: re-check the estimate case for `evt.detail.doc`/`state` and,
    if it is the estimate block, show the existing `EstimateBlockedNotification` toast (same
    title/message as `StatusEditor`, naming `issue.identifier`). Re-checking filters out the unrelated
    `groupValue === undefined` rejections that also emit `move-blocked`.

## Fix 4 - context menu / bulk / keybinding (task-resources)

`plugins/task-resources/src/components/StatusSelector.svelte` `changeStatus(newStatus)` (the single
chokepoint for the `SetStatus` action - context menu on list AND board, bulk multi-select, `S S`
keybinding): before the update loop, split `docs` into blocked vs allowed. A doc is blocked when it is
Issue-like AND the estimate gate applies:
```ts
const cat = $statusStore.byId.get(newStatus)?.category
const isBlocked = (d: Task): boolean =>
  cat === task.statusCategory.Active && 'estimation' in d && (((d as any).estimation ?? 0) <= 0)
```
Update only the non-blocked docs; if any were blocked, show ONE toast ("Set an estimate first" / naming
the blocked identifier(s)). `task` (default) and `$statusStore` are already reachable here (`statusStore`
is imported; add `import task from '@hcengineering/task'`). Because `task-resources` is upstream of
`tracker-resources`, it cannot import `tracker`'s class ref or `tracker-resources`' toast, so it uses the
structural `'estimation' in d` check and its own tiny toast wrapper:

`plugins/task-resources/src/components/EstimateBlockedToast.svelte` (new) - a 5-line `NotificationToast`
wrapper identical in shape to tracker's `EstimateBlockedNotification` / yg's `SubmitErrorNotification`.

Note on the structural check: the server reverts ONLY `tracker.class.Issue`. No other `Task` subclass in
this workspace carries a numeric `estimation`, so `'estimation' in d` is an accurate proxy; a spurious
toast on some future non-Issue Task with an `estimation` field is the only (cosmetic, unlikely) downside.

## Testing

- **Pure helper** `estimateBlocksActivation`: jest (tracker-resources or its test dir) - Active + no
  estimate -> true; Active + estimate -> false; non-Active -> false; undefined status -> false.
- **Manual (smoke, in the batched build):** with an un-estimated issue, confirm the "Set an estimate
  first" toast now appears AND is compact (content height, not 22rem) on: details dropdown (regression),
  right-click "Set status" from a LIST row, right-click from a BOARD card, bulk-select two issues + Set
  status, the `S S` keybinding, and a BOARD drag into a started column (card refuses to enter + toast).
  Verify a normal toast elsewhere (e.g. a timesheet submit error) is also compact now.

## Out of scope

- List ROW drag between status groups (server block only, per the approved scope).
- Changing the server guard or the details-page path's behaviour (only the check is extracted).
- Any model change - everything here is client-only (front-only build).

## Deploy

Front-only build (`yg-local/front:beta`) + `up -d front` + restart nginx. No `upgrade-workspace`.
Batched with the pending performance front build (late-night + drill-down). Local first, prod later.
