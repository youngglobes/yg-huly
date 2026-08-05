# Estimate Required Before a Task Starts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block an issue from entering a started (Active-category) status — In Progress / In Testing / In Review — unless it has a positive estimate, enforced server-side with a client-side fast-fail on the common path.

**Architecture:** A pure, unit-tested helper (`estimateRequiredToActivate`) encodes the rule. A new async server trigger (`OnIssueEstimateGate`, in `server-plugins/yg-timesheet-resources`) is the hard gate: it fires on any `TxUpdateDoc<Issue>` that changes `status`, and if the new status's category is `Active` while `estimation <= 0`, it reverts the issue to a not-started sibling status (System-attributed, loop-safe) and notifies the actor. The `StatusEditor.svelte` dropdown gets a client pre-check that mirrors the rule and blocks with a toast before writing, so the common path never round-trips through a revert. The existing submit-time estimation check stays as a final backstop.

**Tech Stack:** TypeScript, Huly platform (rush + pnpm workspace), Svelte 3, jest + ts-jest, Huly server triggers (`TriggerControl` / `txFactory` revert-guard pattern), CockroachDB-backed domain tables.

## Global Constraints

- **Repo / branch:** `youngglobes/yg-huly`, branch `yg_beta`. NEVER merge to `yg_develop` (auto-deploys) as part of this work — local build + verify only; prod cutover is a separate, batched step.
- **Version pin:** all `@hcengineering/*` workspace deps use `workspace:^0.7.426`.
- **Loop safety (server triggers):** the ONLY write a guard trigger makes is attributed to `core.account.System` (7th arg of `createTxUpdateDoc`), and every trigger skips `tx.modifiedBy === core.account.System` at the top of its loop so its own compensating write never re-enters.
- **"Has estimate" = `(estimation ?? 0) > 0`.** 0 or unset fails.
- **"Started" = the target status's `category === task.statusCategory.Active`.** Won/Lost (Done/Cancelled) and UnStarted/ToDo (Backlog/Todo) are never gated.
- **No em-dashes** in code comments, commit messages, or UI copy (team reads them as an AI tell).
- **i18n convention:** untranslated `ru.json` keys fall back to English on purpose; do not treat missing Russian strings as errors. (Not expected to matter here — the client toast uses plain strings, not IntlString.)
- **Model change:** this adds a server trigger, so deployment is the full 4-image build + `upgrade-workspace yg`, not a front-only build. The client `StatusEditor` change rides the same front image.

---

## File Structure

| File | Package | Responsibility |
|---|---|---|
| `server-plugins/yg-timesheet-resources/src/estimate-gate.ts` | server-yg-timesheet-resources | **New.** Pure rule helper `estimateRequiredToActivate`. |
| `server-plugins/yg-timesheet-resources/src/__tests__/estimate-gate.test.ts` | server-yg-timesheet-resources | **New.** Unit tests for the helper. |
| `server-plugins/yg-timesheet-resources/jest.config.js` | server-yg-timesheet-resources | **New.** ts-jest config (this package has a `test` script but no config yet). |
| `server-plugins/yg-timesheet-resources/package.json` | server-yg-timesheet-resources | **Modify.** Add `@hcengineering/task` dep. |
| `server-plugins/yg-timesheet-resources/src/index.ts` | server-yg-timesheet-resources | **Modify.** Implement `OnIssueEstimateGate`; add it to the exported trigger map. |
| `server-plugins/yg-timesheet/src/index.ts` | server-yg-timesheet (ids) | **Modify.** Declare the `OnIssueEstimateGate` trigger resource id. |
| `models/server-yg-timesheet/src/index.ts` | model-server-yg-timesheet | **Modify.** Register the trigger (`txMatch` on `TxUpdateDoc<Issue>`). |
| `plugins/tracker-resources/src/components/issues/EstimateBlockedNotification.svelte` | tracker-resources | **New.** Tiny toast body for the blocked-move notification. |
| `plugins/tracker-resources/src/components/issues/StatusEditor.svelte` | tracker-resources | **Modify.** Client pre-check in `changeStatus`. |

---

## Task 1: Pure gate helper + unit tests

**Files:**
- Create: `server-plugins/yg-timesheet-resources/src/estimate-gate.ts`
- Create: `server-plugins/yg-timesheet-resources/src/__tests__/estimate-gate.test.ts`
- Create: `server-plugins/yg-timesheet-resources/jest.config.js`
- Modify: `server-plugins/yg-timesheet-resources/package.json` (add `@hcengineering/task` dependency)

**Interfaces:**
- Produces: `estimateRequiredToActivate(newCategory: Ref<StatusCategory> | undefined, activeCategory: Ref<StatusCategory>, estimation: number | undefined): boolean` — `true` iff the move must be blocked (target is the Active category AND no positive estimate). Consumed by Task 2's trigger.

- [ ] **Step 1: Add the `@hcengineering/task` dependency**

In `server-plugins/yg-timesheet-resources/package.json`, add to `dependencies` (keep alphabetical among the `@hcengineering/*` entries), matching the existing version style:

```json
    "@hcengineering/task": "workspace:^0.7.426",
```

Then run the workspace install so the symlink exists:

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly && node common/scripts/install-run-rush.js update`
Expected: completes without error (may be a no-op if already linked).

- [ ] **Step 2: Add the jest config**

Create `server-plugins/yg-timesheet-resources/jest.config.js` (identical to the other server-plugins configs, e.g. `server-plugins/time-resources/jest.config.js`):

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)']
}
```

- [ ] **Step 3: Write the failing test**

Create `server-plugins/yg-timesheet-resources/src/__tests__/estimate-gate.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/server-plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test`
Expected: FAIL — cannot find module `../estimate-gate`.

- [ ] **Step 5: Write the helper**

Create `server-plugins/yg-timesheet-resources/src/estimate-gate.ts`:

```ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/server-plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test`
Expected: PASS — all 6 assertions green.

- [ ] **Step 7: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add server-plugins/yg-timesheet-resources/src/estimate-gate.ts \
        server-plugins/yg-timesheet-resources/src/__tests__/estimate-gate.test.ts \
        server-plugins/yg-timesheet-resources/jest.config.js \
        server-plugins/yg-timesheet-resources/package.json \
        common/config/rush/pnpm-lock.yaml 2>/dev/null
git commit -m "feat(estimate-gate): pure estimateRequiredToActivate helper + tests"
```

(If `pnpm-lock.yaml` did not change, the `git add` of it is a harmless no-op.)

---

## Task 2: Server guard trigger + registration

**Files:**
- Modify: `server-plugins/yg-timesheet-resources/src/index.ts` (implement `OnIssueEstimateGate`, add to exported trigger map)
- Modify: `server-plugins/yg-timesheet/src/index.ts` (declare the trigger resource id)
- Modify: `models/server-yg-timesheet/src/index.ts` (register the trigger)

**Interfaces:**
- Consumes: `estimateRequiredToActivate` from `./estimate-gate` (Task 1); existing helpers in `index.ts` — `getEmployee(control, socialId)`, `notifyInbox(control, tx, targets, obj, message)`.
- Produces: `OnIssueEstimateGate` trigger (a `TriggerFunc`), registered so it fires on every `TxUpdateDoc<tracker.class.Issue>`.

- [ ] **Step 1: Declare the trigger resource id**

In `server-plugins/yg-timesheet/src/index.ts`, add to the `trigger` map (after `OnHrEmployeeCreate`):

```ts
    OnHrEmployeeCreate: '' as Resource<TriggerFunc>,
    OnIssueEstimateGate: '' as Resource<TriggerFunc>
```

(Remove the trailing comma juggling: `OnHrEmployeeCreate` currently has no trailing comma as the last entry — add a comma to it and append the new line as shown.)

- [ ] **Step 2: Add the import in the resources plugin**

In `server-plugins/yg-timesheet-resources/src/index.ts`, add near the other `@hcengineering/*` imports (task is now a dependency):

```ts
import task from '@hcengineering/task'
```

and add, next to the other local util imports (or immediately after the `import ygTimesheet ...` block):

```ts
import { estimateRequiredToActivate } from './estimate-gate'
```

Confirm these are already imported in this file (they are, per the existing code — do NOT re-add): `core`, `type Tx`, `type TxUpdateDoc` from `@hcengineering/core`; `tracker, { type Issue }` from `@hcengineering/tracker`; `getEmployee` from `@hcengineering/server-contact`; `type TriggerControl` from `@hcengineering/server-core`.

- [ ] **Step 3: Implement the trigger**

In `server-plugins/yg-timesheet-resources/src/index.ts`, add this function immediately before the `export default async () => ({ ... })` block:

```ts
//
// Estimate gate (backlog #1): an issue may not enter a started (Active-category) status - In
// Progress / In Testing / In Review - unless it has a positive estimate. This is the HARD
// enforcement point: it covers every path that can change a status (the StatusEditor dropdown,
// kanban drag, bulk edit, and the raw API), complementing the StatusEditor client pre-check
// (which only fast-fails the common dropdown path). The submit-time check in Timesheet.svelte
// stays as the final backstop.
//
// LOOP-SAFETY: the only write is a System-attributed status revert (createTxUpdateDoc's 7th arg),
// which the top-of-loop `modifiedBy === System` guard skips - so it never re-enters and re-reverts.
//
export async function OnIssueEstimateGate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx.modifiedBy === core.account.System) continue
    if (tx._class !== core.class.TxUpdateDoc) continue
    const utx = tx as TxUpdateDoc<Issue>
    if (utx.objectClass !== tracker.class.Issue) continue

    const nextStatus = (utx.operations as Partial<Issue>).status
    if (nextStatus == null) continue

    // Resolve the target status's category; only Active (started) statuses are gated.
    const status = (
      await control.findAll(control.ctx, tracker.class.IssueStatus, { _id: nextStatus }, { limit: 1 })
    )[0]
    if (status === undefined) continue

    const issue = (
      await control.findAll(control.ctx, tracker.class.Issue, { _id: utx.objectId }, { limit: 1 })
    )[0]
    if (issue === undefined) continue

    if (!estimateRequiredToActivate(status.category, task.statusCategory.Active, issue.estimation)) continue

    // Revert to a not-started sibling status. Statuses of the same task type share `ofAttribute`,
    // so this stays within THIS issue's project type. Prefer ToDo (nearest not-started), else
    // UnStarted (Backlog). If neither exists we cannot safely revert - log and bail (the client
    // pre-check covers the common path; a project type with no not-started status is unheard of).
    const siblings = await control.findAll(
      control.ctx, tracker.class.IssueStatus, { ofAttribute: status.ofAttribute }
    )
    const revertTo =
      siblings.find((s) => s.category === task.statusCategory.ToDo)?._id ??
      siblings.find((s) => s.category === task.statusCategory.UnStarted)?._id
    if (revertTo == null || revertTo === nextStatus) {
      control.ctx.warn('yg-timesheet: estimate gate could not resolve a not-started status', {
        issue: issue._id, project: issue.space, attempted: nextStatus
      })
      continue
    }

    control.ctx.warn('yg-timesheet: estimate gate reverted un-estimated issue activation', {
      issue: issue._id, identifier: issue.identifier, actor: utx.modifiedBy, attempted: nextStatus
    })

    const revert = control.txFactory.createTxUpdateDoc(
      utx.objectClass,
      utx.objectSpace,
      utx.objectId,
      { status: revertTo } as any,
      false,
      Date.now(),
      core.account.System
    )
    await control.apply(control.ctx, [revert])

    // Notify the actor why it snapped back (best-effort; the visible revert is the primary signal).
    const actor = await getEmployee(control, utx.modifiedBy)
    if (actor !== undefined) {
      await notifyInbox(
        control,
        tx,
        [actor._id],
        issue,
        `Set an estimate on ${issue.identifier} before moving it to "${status.name}".`
      )
    }
  }
  return []
}
```

- [ ] **Step 4: Add the trigger to the exported map**

In the same file's `export default async () => ({ trigger: { ... } })`, add `OnIssueEstimateGate` to the list (append after `OnHrEmployeeCreate`, adding a comma to that line):

```ts
    OnHrEmployeeCreate,
    OnIssueEstimateGate
```

- [ ] **Step 5: Register the trigger in the model**

In `models/server-yg-timesheet/src/index.ts`, add this `builder.createDoc(...)` at the end of `createModel` (after the `OnHrEmployeeCreate` registration):

```ts
  // Estimate gate (backlog #1): an issue may not enter a started (Active-category) status without a
  // positive estimate. Broad objectClass match on Issue; OnIssueEstimateGate exits fast unless the
  // tx actually changes `status` to an Active-category status on an un-estimated issue.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnIssueEstimateGate,
    isAsync: true,
    txMatch: { _class: core.class.TxUpdateDoc, objectClass: tracker.class.Issue }
  })
```

(`tracker`, `serverCore`, `core`, `serverYgTimesheet` are all already imported in this file.)

- [ ] **Step 6: Type-check the three packages**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/server-plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js build`
Expected: PASS (tsc emits, no type errors). Then repeat for `server-plugins/yg-timesheet` and `models/server-yg-timesheet`:

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/server-plugins/yg-timesheet && node ../../common/scripts/install-run-rushx.js build
cd /home/karthi_0008/dev/client-projects/yg-huly/models/server-yg-timesheet && node ../../common/scripts/install-run-rushx.js build
```
Expected: all PASS.

- [ ] **Step 7: Re-run the unit tests (nothing regressed)**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/server-plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add server-plugins/yg-timesheet-resources/src/index.ts \
        server-plugins/yg-timesheet/src/index.ts \
        models/server-yg-timesheet/src/index.ts
git commit -m "feat(estimate-gate): server guard reverts un-estimated issue activation"
```

---

## Task 3: Client pre-check in the status dropdown

**Files:**
- Create: `plugins/tracker-resources/src/components/issues/EstimateBlockedNotification.svelte`
- Modify: `plugins/tracker-resources/src/components/issues/StatusEditor.svelte`

**Interfaces:**
- Consumes: `$statusStore` (already imported from `@hcengineering/view-resources`), `task.statusCategory.Active` (from `@hcengineering/task`, already a tracker-resources dependency via `getTaskTypeStates`), `addNotification` / `NotificationSeverity` (from `@hcengineering/ui`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Create the toast body component**

Create `plugins/tracker-resources/src/components/issues/EstimateBlockedNotification.svelte` (same thin `NotificationToast` wrapper the codebase uses everywhere for `addNotification`, e.g. `SubmitErrorNotification.svelte`):

```svelte
<script lang="ts">
  //
  // Toast body for a status change blocked by the estimate gate (backlog #1): the issue has no
  // estimate and the user tried to move it into a started status. Thin wrapper around the shared
  // NotificationToast, same pattern as yg-timesheet's SubmitErrorNotification.
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

- [ ] **Step 2: Add imports to StatusEditor**

In `plugins/tracker-resources/src/components/issues/StatusEditor.svelte`:

Add `addNotification` and `NotificationSeverity` to the existing `@hcengineering/ui` import block (the one that already imports `Button`, `SelectPopup`, `showPopup`, etc.):

```ts
  import {
    Button,
    ButtonKind,
    ButtonSize,
    IconSize,
    SelectPopup,
    TooltipAlignment,
    eventToHTMLElement,
    showPopup,
    addNotification,
    NotificationSeverity
  } from '@hcengineering/ui'
```

Add these two imports after the existing `import tracker from '../../plugin'` line:

```ts
  import task from '@hcengineering/task'
  import EstimateBlockedNotification from './EstimateBlockedNotification.svelte'
```

(`task` is already resolvable — the file imports `getTaskTypeStates` from `@hcengineering/task`. `$statusStore` is already imported from `@hcengineering/view-resources`.)

- [ ] **Step 3: Add the pre-check at the top of `changeStatus`**

In `plugins/tracker-resources/src/components/issues/StatusEditor.svelte`, replace the current start of `changeStatus`:

```ts
  const changeStatus = async (newStatus: Ref<IssueStatus> | undefined, refocus: boolean = true) => {
    if (!isEditable || newStatus == null || value.status === newStatus) {
      return
    }

    dispatch('change', newStatus)
```

with (insert the estimate gate BEFORE the optimistic `dispatch('change', ...)`, so a blocked move never updates parent UI):

```ts
  const changeStatus = async (newStatus: Ref<IssueStatus> | undefined, refocus: boolean = true) => {
    if (!isEditable || newStatus == null || value.status === newStatus) {
      return
    }

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

    dispatch('change', newStatus)
```

(Leave the rest of `changeStatus` — the `refocus` dispatch and the `if ('_class' in value) { await client.update(...) }` block — unchanged.)

- [ ] **Step 4: Type-check tracker-resources**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && node ../../common/scripts/install-run-rushx.js build`
Expected: PASS (svelte-check / tsc, no errors). If the package uses `svelte-check` via a `_phase:build` script, that is what `rushx build` runs — a clean run is the pass signal.

- [ ] **Step 5: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/tracker-resources/src/components/issues/EstimateBlockedNotification.svelte \
        plugins/tracker-resources/src/components/issues/StatusEditor.svelte
git commit -m "feat(estimate-gate): StatusEditor pre-check blocks un-estimated activation"
```

---

## Task 4: Local build, upgrade, and smoke test

**Files:** none (build + runtime verification only).

**Interfaces:** none.

- [ ] **Step 1: Full local image build (model change -> all 4 images)**

Run: `cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost && ./build-beta.sh`
Expected: all four images build and tag without error. (This is the model-change build; a front-only build would miss the new server trigger.)

- [ ] **Step 2: Recreate the stack and upgrade the workspace**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d --force-recreate transactor account front
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
./run-tool-beta.sh upgrade-workspace yg
```
Expected: services healthy; `upgrade-workspace yg` completes. (nginx restart per the 2026-07-23 ops rule: it resolves compose service IPs once at startup, so restart it after force-recreating anything it proxies.)

- [ ] **Step 3: Smoke test the gate (manual, in the local UI)**

Verify all four:
1. Take an issue with **no estimate**, open the inline status dropdown, choose **In Progress** -> a red "Set an estimate first" toast appears and the status does NOT change (client pre-check).
2. **Drag** that same un-estimated issue to the In Progress column on the board -> it snaps back to a not-started column, and an inbox notification arrives naming the issue (server guard; the client pre-check does not run on drag).
3. Set an **estimate > 0** on the issue, then move it to In Progress -> it moves and stays (both paths allow it).
4. Move an estimated OR un-estimated issue to **Done / Cancelled / Backlog / Todo** -> always allowed (non-Active categories are never gated).

Record the result of each of the four checks in the task ledger. If any fails, STOP and debug before proceeding — do not claim the gate works.

- [ ] **Step 4: Commit any notes (no code)**

If a runbook or note needs updating (e.g. a line in the backlog marking item 1 done locally), do it now:

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add docs/superpowers/specs/2026-08-04-yg-portal-backlog.md
git commit -m "docs: mark estimate-before-start built + verified locally (item 1)"
```

(Skip this step if there is nothing to record.)

---

## Self-Review

**Spec coverage** (`2026-08-04-estimate-before-start-design.md`):
- Pure helper `estimateRequiredToActivate` -> Task 1. ✓
- Server guard on `TxUpdateDoc<Issue>` status change, Active + `estimation <= 0` -> revert + notify, System-attributed, loop-safe -> Task 2. ✓
- Scope = "any move whose NEW status category is Active" -> Task 2 uses `status.category === task.statusCategory.Active`. ✓
- Revert to a not-started status (previous if recoverable, else project default) -> Task 2 reverts to a ToDo/UnStarted sibling scoped by `ofAttribute` (design's "otherwise the project's default Backlog/ToDo status" — implemented as the sibling ToDo/UnStarted, which is the robust server-resolvable equivalent since async triggers run post-apply and cannot read the pre-image status). ✓
- Client pre-check on `StatusEditor.svelte` before the update, reusing the rule -> Task 3. ✓
- Submit-time check stays -> untouched (Task list never modifies `Timesheet.svelte`). ✓
- Deploy = 4-image build + `upgrade-workspace` -> Task 4. ✓

**Placeholder scan:** no TBD / "add error handling" / "similar to Task N" — every code step is literal. ✓

**Type consistency:** `estimateRequiredToActivate(newCategory, activeCategory, estimation)` signature is identical in Task 1's definition, its tests, and Task 2's call site. `OnIssueEstimateGate` name matches across the id declaration (server-plugins/yg-timesheet), the implementation + export map (server-plugins/yg-timesheet-resources), and the model registration (models/server-yg-timesheet). ✓

**Known deviation from the spec (intentional):** the spec says the client helper is "reused" by StatusEditor. Because `StatusEditor` lives in the upstream `tracker-resources` package and the helper lives in `server-plugins/yg-timesheet-resources`, importing across would add an undesirable package dependency from upstream client code onto our server plugin. The client therefore inlines the one-expression rule with a comment pointing at the tested helper as the spec-of-record. The rule is identical; only its location differs.
