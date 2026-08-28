# Estimate-gate feedback + toast height — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the "Set an estimate first" toast on every status-change path the user hits (context menu / bulk / keybinding, and Kanban board drag), and fix the toast rendering ~22rem tall.

**Architecture:** All client-only. Extract the estimate check into a shared tracker-resources helper reused by the details-page dropdown and the board; add the toast to the Kanban drop path (via a new generic `move-blocked` event from the shared Kanban component) and to the shared `StatusSelector` (context menu / bulk / keybinding). Fix the toast height by renaming `NotificationToast`'s CSS class so it no longer inherits a global `.notifyPopup { min-height: 22rem }`.

**Tech Stack:** TypeScript, Svelte 3, jest + ts-jest, Huly `@hcengineering/{tracker,task,ui}`.

## Global Constraints

- **Repo / branch:** `youngglobes/yg-huly`, branch `yg_beta`. All changes are client-only (front-only build; no `upgrade-workspace`). NEVER merge to `yg_develop`.
- **The server guard is the enforcement** and already blocks every path — this plan only unifies client FEEDBACK. Do not touch the server guard.
- **Estimate rule (unchanged):** block iff the target status's category is `task.statusCategory.Active` AND `(estimation ?? 0) <= 0`.
- **Toast copy (match the existing one):** title `Set an estimate first`; message `Add an estimate to <identifier> before moving it to a started status.`; component = the plugin's thin `NotificationToast` wrapper; `NotificationSeverity.Error`.
- **Scope:** context menu / bulk / keybinding + Kanban board drag. NOT list-row drag between status groups (stays on the silent server block).
- **No em-dashes** in code, comments, or commit messages. No new i18n strings (toast copy is plain text, matching the existing gate).
- **Package direction:** `task-resources` is upstream of `tracker-resources`; `task-resources` must NOT import `tracker` refs or `tracker-resources` components (use a structural `'estimation' in d` check and its own toast wrapper).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/ui/src/components/NotificationToast.svelte` | **Modify.** Rename root class `notifyPopup` -> `toastCard` (decouple from the leaky global min-height). |
| `plugins/tracker-resources/src/components/issues/estimateGate.ts` | **Create.** Pure helper `estimateBlocksActivation`. |
| `plugins/tracker-resources/src/components/issues/estimateGate.test.ts` | **Create.** Unit tests for the helper. |
| `plugins/tracker-resources/src/components/issues/StatusEditor.svelte` | **Modify.** Use the shared helper (behaviour identical). |
| `packages/kanban/src/components/Kanban.svelte` | **Modify.** Emit `move-blocked` when a drop is rejected. |
| `plugins/tracker-resources/src/components/issues/KanbanView.svelte` | **Modify.** Block un-estimated drops in `getUpdateProps`; show the toast on `move-blocked`. |
| `plugins/task-resources/src/components/EstimateBlockedToast.svelte` | **Create.** Thin toast wrapper (task-resources can't import tracker's). |
| `plugins/task-resources/src/components/StatusSelector.svelte` | **Modify.** Gate the context-menu/bulk/keybinding path. |

---

## Task 1: Fix the toast height (all toasts)

**Files:**
- Modify: `packages/ui/src/components/NotificationToast.svelte`

**Interfaces:** none (self-contained CSS/markup rename).

- [ ] **Step 1: Rename the root class in the markup**

In `packages/ui/src/components/NotificationToast.svelte` line ~47, change the root div's class:

```svelte
<div
  class="toastCard"
```

(from `class="notifyPopup"` — leave the `class:sev-*` bindings and everything else on that element unchanged.)

- [ ] **Step 2: Rename the top-level style selector**

In the same file's `<style lang="scss">`, change the top-level rule (line ~86) from `.notifyPopup {` to:

```scss
  .toastCard {
```

Leave the nested selectors (`&::before`, `&.sev-*`, `.icon-*`, `.content`, `:global(.buttons-group)`, `.flex-between.gap-2`) unchanged — they are relative to the renamed parent.

- [ ] **Step 3: Confirm no other reference to the toast's old class**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly && grep -rn "notifyPopup" packages/ui/src`
Expected: NO matches in `NotificationToast.svelte` (both renamed). (Matches elsewhere — e.g. the calendar reminders / help popup — are the unrelated global `.notifyPopup`; leave them.)

- [ ] **Step 4: Type-check the ui package**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/packages/ui && node ../../common/scripts/install-run-rushx.js build 2>&1 | tail -5`
Expected: builds clean (no new errors). (Visual confirmation that the toast is now content-height happens in Task 5's smoke test.)

- [ ] **Step 5: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add packages/ui/src/components/NotificationToast.svelte
git commit -m "fix(ui): decouple toast card from global .notifyPopup min-height (rename to toastCard)"
```

---

## Task 2: Shared estimate-gate helper + StatusEditor refactor

**Files:**
- Create: `plugins/tracker-resources/src/components/issues/estimateGate.ts`
- Create: `plugins/tracker-resources/src/components/issues/estimateGate.test.ts`
- Modify: `plugins/tracker-resources/src/components/issues/StatusEditor.svelte`

**Interfaces:**
- Produces: `estimateBlocksActivation(newStatus: Ref<Status> | undefined, estimation: number | undefined, byId: IdMap<Status>): boolean` — true iff the move must be blocked (target status category is Active and no positive estimate). Consumed by StatusEditor (this task) and KanbanView (Task 3).

- [ ] **Step 1: Write the failing test**

Create `plugins/tracker-resources/src/components/issues/estimateGate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && node ../../common/scripts/install-run-rushx.js test 2>&1 | grep -A2 estimateGate`
Expected: FAIL — cannot find module `./estimateGate`.

- [ ] **Step 3: Write the helper**

Create `plugins/tracker-resources/src/components/issues/estimateGate.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && node ../../common/scripts/install-run-rushx.js test 2>&1 | grep -A2 estimateGate`
Expected: PASS.

- [ ] **Step 5: Refactor StatusEditor to use the helper**

In `plugins/tracker-resources/src/components/issues/StatusEditor.svelte`:

Change the task import (line ~18) from `import task, { getTaskTypeStates } from '@hcengineering/task'` to:
```ts
  import { getTaskTypeStates } from '@hcengineering/task'
```
Add, after the `import EstimateBlockedNotification ...` line:
```ts
  import { estimateBlocksActivation } from './estimateGate'
```
Replace the current gate block inside `changeStatus`:
```ts
    // Estimate gate (backlog #1): fast-fail the common path so an un-estimated issue never even
    // dispatches a change, instead of round-tripping through the server guard's revert. Mirrors
    // estimateRequiredToActivate (server-plugins/yg-timesheet-resources/src/estimate-gate.ts).
    if ('_class' in value) {
      const newCategory = $statusStore.byId.get(newStatus)?.category
      if (newCategory === task.statusCategory.Active && (value.estimation ?? 0) <= 0) {
        addNotification(
          'Set an estimate first',
          `Add an estimate to ${value.identifier} before moving it to a started status.`,
          EstimateBlockedNotification,
          undefined,
          NotificationSeverity.Error
        )
        return
      }
    }
```
with:
```ts
    // Estimate gate (backlog #1): fast-fail the common path so an un-estimated issue never even
    // dispatches a change, instead of round-tripping through the server guard's revert. Shared with
    // the Kanban drag path via estimateGate.ts (mirrors the server guard).
    if ('_class' in value && estimateBlocksActivation(newStatus, value.estimation, $statusStore.byId)) {
      addNotification(
        'Set an estimate first',
        `Add an estimate to ${value.identifier} before moving it to a started status.`,
        EstimateBlockedNotification,
        undefined,
        NotificationSeverity.Error
      )
      return
    }
```

- [ ] **Step 6: Type-check tracker-resources**

Run (its `rushx build` is compile-only; use svelte-check + validate):
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources
node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "StatusEditor.svelte|estimateGate" || echo "no errors in changed files"
node ../../common/scripts/install-run-rushx.js _phase:validate 2>&1 | tail -3
```
Expected: no errors referencing the changed files; `_phase:validate` clean.

- [ ] **Step 7: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/tracker-resources/src/components/issues/estimateGate.ts \
        plugins/tracker-resources/src/components/issues/estimateGate.test.ts \
        plugins/tracker-resources/src/components/issues/StatusEditor.svelte
git commit -m "refactor(tracker): extract estimateBlocksActivation helper; StatusEditor uses it"
```

---

## Task 3: Kanban board drag feedback

**Files:**
- Modify: `packages/kanban/src/components/Kanban.svelte`
- Modify: `plugins/tracker-resources/src/components/issues/KanbanView.svelte`

**Interfaces:**
- Consumes: `estimateBlocksActivation` (Task 2), the existing `EstimateBlockedNotification` component.
- Produces: a new generic `move-blocked` Svelte event on the `Kanban` component (`detail: { doc, state }`), dispatched only when a drop is rejected.

- [ ] **Step 1: Emit `move-blocked` from the drop handler**

In `packages/kanban/src/components/Kanban.svelte`, inside `move(state)`, the block that runs when `getUpdateProps` returns `undefined` currently reads:
```ts
    if (updates === undefined) {
      panelDragLeave(undefined, dragCardState)
      dragCard = undefined
      dragCardAvailableCategories = undefined
      return
    }
```
Change it to dispatch the event first (while `dragCard` is still set):
```ts
    if (updates === undefined) {
      dispatch('move-blocked', { doc: dragCard, state })
      panelDragLeave(undefined, dragCardState)
      dragCard = undefined
      dragCardAvailableCategories = undefined
      return
    }
```
(`dispatch` is already created at the top of this component. The other `getUpdateProps` call sites — the drag-over/hover handlers — are NOT changed, so the event fires only on an actual drop.)

- [ ] **Step 2: Block un-estimated drops + show the toast in KanbanView**

In `plugins/tracker-resources/src/components/issues/KanbanView.svelte`:

Add imports. `Issue` and `IssuesGrouping` are already imported from `@hcengineering/tracker`; extend that import to also bring `IssueStatus`, and ensure `Ref` (from `@hcengineering/core`) is imported (add it if missing). Add:
```ts
  import { estimateBlocksActivation } from './estimateGate'
  import EstimateBlockedNotification from './EstimateBlockedNotification.svelte'
  import { addNotification, NotificationSeverity } from '@hcengineering/ui'
```
(If `addNotification`/`NotificationSeverity` are already imported from `@hcengineering/ui`, merge into the existing import instead of duplicating.)

In `getUpdateProps`, block the estimate case (return `undefined` so the drop is rejected and the drag-preview will not enter the column). Change:
```ts
  const getUpdateProps = (doc: Doc, category: CategoryType): DocumentUpdate<Item> | undefined => {
    const groupValue =
      typeof category === 'object' ? category.values.find((it) => it.space === doc.space)?._id : category
    if (groupValue === undefined) {
      return undefined
    }
    return {
      [groupByKey]: groupValue,
      space: doc.space
    }
  }
```
to:
```ts
  const getUpdateProps = (doc: Doc, category: CategoryType): DocumentUpdate<Item> | undefined => {
    const groupValue =
      typeof category === 'object' ? category.values.find((it) => it.space === doc.space)?._id : category
    if (groupValue === undefined) {
      return undefined
    }
    // Estimate gate (backlog #1): reject a board drop that would start an un-estimated issue. Returning
    // undefined blocks the move (consistent with the server) and stops the card entering the column;
    // the toast is shown from the move-blocked handler below so it fires once, on drop only.
    if (
      groupByKey === IssuesGrouping.Status &&
      estimateBlocksActivation(groupValue as Ref<IssueStatus>, (doc as Issue).estimation, $statusStore.byId)
    ) {
      return undefined
    }
    return {
      [groupByKey]: groupValue,
      space: doc.space
    }
  }
```

Add the `move-blocked` handler to `<KanbanUI>` (alongside the existing `on:obj-focus` / `on:contextmenu` handlers):
```svelte
    on:move-blocked={(evt) => {
      const doc = evt.detail.doc as Issue
      const state = evt.detail.state
      const newStatus = (typeof state === 'object'
        ? state.values.find((it) => it.space === doc.space)?._id
        : state) as Ref<IssueStatus> | undefined
      if (groupByKey === IssuesGrouping.Status && estimateBlocksActivation(newStatus, doc.estimation, $statusStore.byId)) {
        addNotification(
          'Set an estimate first',
          `Add an estimate to ${doc.identifier} before moving it to a started status.`,
          EstimateBlockedNotification,
          undefined,
          NotificationSeverity.Error
        )
      }
    }}
```
(The re-check filters out the ordinary `groupValue === undefined` rejections that also emit `move-blocked`, so the toast only shows for the estimate case.)

- [ ] **Step 3: Type-check both packages**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/packages/kanban && node ../../common/scripts/install-run-rushx.js build 2>&1 | tail -3
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "KanbanView.svelte" || echo "no KanbanView errors"
```
Expected: kanban builds clean; no new errors on `KanbanView.svelte`.

- [ ] **Step 4: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add packages/kanban/src/components/Kanban.svelte \
        plugins/tracker-resources/src/components/issues/KanbanView.svelte
git commit -m "feat(tracker): estimate-gate toast on Kanban board drag (move-blocked event)"
```

---

## Task 4: Context menu / bulk / keybinding feedback

**Files:**
- Create: `plugins/task-resources/src/components/EstimateBlockedToast.svelte`
- Modify: `plugins/task-resources/src/components/StatusSelector.svelte`

**Interfaces:** none exported.

- [ ] **Step 1: Create the toast wrapper**

Create `plugins/task-resources/src/components/EstimateBlockedToast.svelte` (thin `NotificationToast` wrapper, same shape as tracker's `EstimateBlockedNotification`):

```svelte
<script lang="ts">
  //
  // Toast body for a status change blocked by the estimate gate (backlog #1) from the shared
  // Set-Status action (context menu / bulk / keybinding). task-resources cannot import
  // tracker-resources' EstimateBlockedNotification, so it has its own thin wrapper.
  //
  import { type Notification, NotificationToast } from '@hcengineering/ui'

  export let notification: Notification
  export let onRemove: () => void
</script>

<NotificationToast title={notification.title} severity={notification.severity} onClose={onRemove}>
  <svelte:fragment slot="content">
    {notification.subTitle}
  </svelte:fragment>
</NotificationToast>
```

- [ ] **Step 2: Gate the Set-Status chokepoint**

In `plugins/task-resources/src/components/StatusSelector.svelte`:

Change the task import (line ~6) from `import { Task, TaskType } from '@hcengineering/task'` to:
```ts
  import task, { Task, TaskType } from '@hcengineering/task'
```
Add these imports (near the other `@hcengineering/ui` / component imports):
```ts
  import { addNotification, NotificationSeverity } from '@hcengineering/ui'
  import EstimateBlockedToast from './EstimateBlockedToast.svelte'
```
In `changeStatus`, after `const docs = Array.isArray(value) ? value : [value]` and before building `ops`, insert the gate and exclude blocked docs from the update:
```ts
    // Estimate gate (backlog #1): the same feedback the details-page dropdown gives, for the shared
    // Set-Status action (context menu / bulk / keybinding, list AND board). task-resources is upstream
    // of tracker, so this uses a structural `estimation` check rather than a tracker.class.Issue ref.
    const cat = $statusStore.byId.get(newStatus)?.category
    const blocked = (d: Task): boolean =>
      cat === task.statusCategory.Active && 'estimation' in d && (((d as any).estimation ?? 0) <= 0)
    const blockedDocs = docs.filter(blocked)
    if (blockedDocs.length > 0) {
      const ids = blockedDocs.map((d) => (d as any).identifier as string | undefined).filter((s): s is string => s != null && s !== '')
      addNotification(
        'Set an estimate first',
        ids.length > 0
          ? `Add an estimate to ${ids.join(', ')} before moving to a started status.`
          : 'Add an estimate before moving to a started status.',
        EstimateBlockedToast,
        undefined,
        NotificationSeverity.Error
      )
    }
```
Then change the `changed` filter so blocked docs are not updated:
```ts
    const changed = (d: Task) => d.status !== newStatus && !blocked(d)
```
(Leave the rest of `changeStatus` — `ops.commit()`, `dispatch('close', ...)`, analytics — unchanged.)

- [ ] **Step 3: Type-check task-resources**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/task-resources
node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "StatusSelector.svelte|EstimateBlockedToast" || echo "no errors in changed files"
node ../../common/scripts/install-run-rushx.js _phase:validate 2>&1 | tail -3
```
Expected: no errors on the changed files; `_phase:validate` clean. (If `svelte-check`/`_phase:validate` is not wired in this package, run `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "StatusSelector|EstimateBlockedToast" || echo clean`.)

- [ ] **Step 4: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/task-resources/src/components/EstimateBlockedToast.svelte \
        plugins/task-resources/src/components/StatusSelector.svelte
git commit -m "feat(task): estimate-gate toast on Set-Status action (menu/bulk/keybinding)"
```

---

## Task 5: Batched front build, deploy, smoke

**Files:** none (build/deploy). **Do NOT start without the user's go-ahead.** This single front build ALSO carries the already-committed performance work (late-night + drill-down panel) on `yg_beta`.

- [ ] **Step 1: Front-only build**

Run the front build (`rush build` -> `dev/prod` package -> `pods/front` bundle+package+docker build, tagged `yg-local/front:beta`), e.g. reuse the scratchpad `build-front.sh`. Expected: fresh `yg-local/front:beta`; spot-check the new bundle no longer has the leaked min-height on the toast card (`docker run --rm yg-local/front:beta sh -c "grep -o 'toastCard' /app/dist/*.js | head -1"`), and includes the perf panel (`grep -o 'perf-panel'`).

- [ ] **Step 2: Deploy the new front**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d front
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
```
Expected: `front` recreated; `curl -s -o /dev/null -w "%{http_code}" http://localhost:8087/` = 200.

- [ ] **Step 3: Smoke test (manual)**

With an un-estimated issue, confirm the **compact** "Set an estimate first" toast appears (and is content-height, not a tall empty box) on each path:
1. Details-page status dropdown (regression — still works, now compact).
2. Right-click a **list** row -> Set status -> a started status.
3. Right-click a **board** card -> Set status -> a started status.
4. Bulk-select two issues -> Set status -> a started status (toast names the blocked ids).
5. `S S` keybinding on a focused issue.
6. **Drag** the card into a started column on the board -> card refuses to enter + toast.
7. Also confirm a normal toast elsewhere (e.g. a timesheet submit error) is compact now.
8. Confirm the performance report still works (K2 late-night per the perf plan; drill-down panel opens).

Record each result. If any fails, STOP and debug before claiming done.

---

## Self-Review

**Spec coverage** (`2026-08-05-estimate-gate-feedback.md`):
- Toast height via class rename -> Task 1. ✓
- Shared helper + StatusEditor uses it -> Task 2. ✓
- Kanban board drag feedback (block + move-blocked toast, drop-only) -> Task 3. ✓
- Context menu / bulk / keybinding feedback (structural check + own toast) -> Task 4. ✓
- List-row drag left on server block (out of scope) -> not touched. ✓
- Front-only, batched with performance -> Task 5. ✓

**Placeholder scan:** no TBD/TODO; full code in every code step. ✓

**Type consistency:** `estimateBlocksActivation(newStatus: Ref<Status> | undefined, estimation: number | undefined, byId: IdMap<Status>)` — identical signature in the helper, its test, StatusEditor, and KanbanView call sites. `move-blocked` event `detail: { doc, state }` — dispatched in Kanban.svelte, consumed in KanbanView with the same shape. Toast title/message string identical across StatusEditor, KanbanView, and StatusSelector. ✓
