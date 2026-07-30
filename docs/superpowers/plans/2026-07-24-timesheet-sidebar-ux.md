# Timesheet App Sidebar UX Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the custom Timesheet workbench app from a tabbed single component into a left-sidebar navigator (mirroring the existing HR app), gate Approvals/Reports to admin-or-PM/TL, relocate PM/TL assignment to a sidebar item, and standardize the tables on the shared HR table style.

**Architecture:** Model-level change (an `Application`'s `navigatorModel.specials[]`) plus a registered async `visibleIf` predicate for role gating; the sub-view Svelte components are already self-contained and render directly as specials. A shared SCSS partial replaces the per-component duplicated table styles. No change to authorization, triggers, migration, or schema.

**Tech Stack:** Huly platform (Rush monorepo, pnpm, Svelte, TypeScript), `@hcengineering/{core,platform,model,workbench,contact,tracker,ui}`, ts-jest. Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`).

## Global Constraints

- **Branch:** all commits on `yg_beta`. **Never merge to `yg_develop`** (CI auto-deploys it to prod).
- **Build:** package scripts `node ../../common/scripts/install-run-rushx.js <script>`; repo-wide `node common/scripts/install-run-rush.js build --to <pkg>`. Tests `rushx test`. Types `rushx svelte-check`.
- **`svelte-check` mandatory** on any `.svelte` change. Known pre-existing baseline that is NOT yours: 3 `$lookup` errors (`Timesheet.svelte` ×1, `Approvals.svelte` ×2 — may shift as those files change) + ~21 in `text-editor-resources`. No NEW non-`$lookup` errors on touched files.
- **Admin threshold is `AccountRole.Maintainer`** everywhere in this feature (matches the server guard and existing gates). Owners are included (Owner > Maintainer).
- **Existing unit suite is 109 passing** and must not regress.
- **UX/structure only.** Do NOT change the approval authorization model, the server triggers, the migration, or the `TimesheetApproval` schema.
- `@hcengineering/yg-timesheet`'s generated `types/index.d.ts` is gitignored and can go stale — rebuild that package first if you hit spurious type errors.
- Design spec: `docs/superpowers/specs/2026-07-24-timesheet-sidebar-ux-design.md`.

---

### Task 1: `CanApprove` predicate (pure helper + registered visibleIf function)

Extract the "may this user see Approvals/Reports" decision (currently inline in `TimesheetApp.svelte:28-43`) into a testable pure helper plus a registered async resource used by the sidebar's `visibleIf`.

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/task-approval.ts` (add pure helper)
- Modify: `plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts` (test the helper)
- Modify: `plugins/yg-timesheet/src/index.ts` (declare `function.CanApprove` id)
- Modify: `plugins/yg-timesheet-resources/src/index.ts` (register the async wrapper)

**Interfaces:**
- Produces: `canApproveView(isAdmin: boolean, approverPairs: Array<{ pm?: string, teamLead?: string }>, me: string): boolean` (pure — uses `string` to match this file's existing style; `Ref<Employee>` values are assignable to `string`).
- Produces: `ygTimesheet.function.CanApprove: Resource<(spaces: Space[]) => Promise<boolean>>` (registered), used by Task 2's specials.

- [ ] **Step 1: Write the failing test**

Append to `plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts`:

```ts
import { canApproveView } from '../task-approval'

describe('canApproveView', () => {
  const me = 'emp-me'
  const other = 'emp-other'
  test('admin may always see approvals/reports', () => {
    expect(canApproveView(true, [], me)).toBe(true)
  })
  test('a PM on any project may see them', () => {
    expect(canApproveView(false, [{ pm: me }], me)).toBe(true)
  })
  test('a Team Lead on any project may see them', () => {
    expect(canApproveView(false, [{ teamLead: me }], me)).toBe(true)
  })
  test('someone who is neither admin nor PM/TL may not', () => {
    expect(canApproveView(false, [{ pm: other, teamLead: other }], me)).toBe(false)
  })
  test('empty approver set + not admin => false', () => {
    expect(canApproveView(false, [], me)).toBe(false)
  })
})
```

- [ ] **Step 2: Run — verify it fails**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- task-approval
```
Expected: FAIL — `canApproveView` is not exported.

- [ ] **Step 3: Add the pure helper**

In `plugins/yg-timesheet-resources/src/utils/task-approval.ts`, add (no new imports needed — the helper uses plain `string`):

```ts
/**
 * May the current user SEE the Approvals/Reports surfaces? Admin (Maintainer+) OR assigned as PM or
 * Team Lead on ANY project. `approverPairs` are the ProjectApprovers mixins across all projects;
 * `me` is the current employee. Pure — the caller supplies isAdmin and the pairs.
 */
export function canApproveView (
  isAdmin: boolean,
  approverPairs: Array<{ pm?: string, teamLead?: string }>,
  me: string
): boolean {
  if (isAdmin) return true
  return approverPairs.some((a) => a.pm === me || a.teamLead === me)
}
```

- [ ] **Step 4: Run — verify it passes**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test
```
Expected: all pass (109 + 5 new = 114).

- [ ] **Step 5: Declare the function id**

In `plugins/yg-timesheet/src/index.ts`, add a `function` block to the `plugin(ygTimesheetId, { ... })` default export (after the `icon`/`string` blocks). Ensure `Resource` is imported from `@hcengineering/platform` and `Space` from `@hcengineering/core` (add to existing imports if missing):

```ts
  function: {
    CanApprove: '' as Resource<(spaces: Space[]) => Promise<boolean>>
  },
```

- [ ] **Step 6: Register the async wrapper**

In `plugins/yg-timesheet-resources/src/index.ts`, add imports and register the function in the default export's returned object (it currently returns `{ component: { ... } }` — add a sibling `function` key):

```ts
import { AccountRole, getCurrentAccount, hasAccountRole, type Space } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import { getCurrentEmployee } from '@hcengineering/contact'
import tracker from '@hcengineering/tracker'
import ygTimesheet, { type ProjectApprovers } from '@hcengineering/yg-timesheet'
import { canApproveView } from './utils/task-approval'

async function CanApprove (_spaces: Space[]): Promise<boolean> {
  const isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)
  if (isAdmin) return true
  const me = getCurrentEmployee()
  const client = getClient()
  const h = client.getHierarchy()
  const projects = await client.findAll(tracker.class.Project, {})
  const pairs = projects
    .filter((p) => h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers))
    .map((p) => {
      const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers
      return { pm: a.pm, teamLead: a.teamLead }
    })
  return canApproveView(isAdmin, pairs, me)
}
```

Add to the default export:
```ts
export default async (): Promise<Resources> => ({
  component: { /* existing */ },
  function: { CanApprove }
})
```
(Import `type Resource`/`type Resources` from `@hcengineering/platform` as needed — `Resources` is already imported.)

- [ ] **Step 7: Build + commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet-resources
git add plugins/yg-timesheet/src/index.ts plugins/yg-timesheet-resources/src/index.ts \
        plugins/yg-timesheet-resources/src/utils/task-approval.ts \
        plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts
git commit -m "yg-timesheet: extract canApproveView + register CanApprove visibleIf predicate"
```

---

### Task 2: Timesheet app → left-sidebar navigator (retire the tab wrapper)

**Files:**
- Modify: `models/yg-timesheet/src/index.ts` (the `ygTimesheet.app.Timesheet` `createDoc`, currently `component: ygTimesheet.component.TimesheetApp` at ~lines 142-154)
- Modify: `plugins/yg-timesheet-resources/src/index.ts` (drop the `TimesheetApp` import + registration)
- Modify: `plugins/yg-timesheet/src/index.ts` (drop the `TimesheetApp` component id)
- Delete: `plugins/yg-timesheet-resources/src/components/TimesheetApp.svelte`

**Interfaces:**
- Consumes: `ygTimesheet.function.CanApprove` (Task 1); `ygTimesheet.component.{Timesheet,Approvals,Reports,ProjectApproversEditor}` (already registered).

- [ ] **Step 1: Replace the app registration with a navigatorModel**

In `models/yg-timesheet/src/index.ts`, find the `builder.createDoc(workbench.class.Application, ...)` for `ygTimesheet.app.Timesheet` (the one with `component: ygTimesheet.component.TimesheetApp`). Replace the `component: ...` line with a `navigatorModel` (mirror the `yg-hr` app in this same file at ~176-216). Use `ygTimesheet.icon.Timesheet` for every special's icon for now (guaranteed to exist; a later phase assigns distinct icons). `AccountRole` is already imported in this file:

```ts
      navigatorModel: {
        spaces: [],
        specials: [
          {
            id: 'my',
            label: ygTimesheet.string.Timesheet,
            icon: ygTimesheet.icon.Timesheet,
            component: ygTimesheet.component.Timesheet,
            position: 'top'
          },
          {
            id: 'approvals',
            label: ygTimesheet.string.Approvals,
            icon: ygTimesheet.icon.Timesheet,
            component: ygTimesheet.component.Approvals,
            visibleIf: ygTimesheet.function.CanApprove,
            position: 'top'
          },
          {
            id: 'reports',
            label: ygTimesheet.string.Reports,
            icon: ygTimesheet.icon.Timesheet,
            component: ygTimesheet.component.Reports,
            visibleIf: ygTimesheet.function.CanApprove,
            position: 'top'
          },
          {
            id: 'projects',
            label: ygTimesheet.string.Projects,
            icon: ygTimesheet.icon.Timesheet,
            component: ygTimesheet.component.ProjectApproversEditor,
            accessLevel: AccountRole.Maintainer,
            position: 'bottom'
          }
        ]
      }
```

Keep the rest of that `createDoc` (label, icon, alias `ygTimesheetId`, hidden, position `'top'`) exactly as-is; only the `component:` line becomes `navigatorModel:`.

- [ ] **Step 2: Drop the TimesheetApp registration**

In `plugins/yg-timesheet-resources/src/index.ts`: remove `import TimesheetApp from './components/TimesheetApp.svelte'` and remove the `TimesheetApp,` line from the `component` object.

In `plugins/yg-timesheet/src/index.ts`: remove the `TimesheetApp: '' as AnyComponent,` line from the `component` block.

- [ ] **Step 3: Delete the retired file**

```bash
git rm plugins/yg-timesheet-resources/src/components/TimesheetApp.svelte
```

- [ ] **Step 4: Build the model + resources**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-timesheet --to @hcengineering/yg-timesheet-resources
```
Expected: builds clean. Grep to confirm no other reference to `TimesheetApp` remains:
```bash
grep -rn "TimesheetApp" plugins/ models/ --include=*.ts --include=*.svelte
```
Expected: no matches.

- [ ] **Step 5: svelte-check + commit**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check
```
Report every error line naming a yg-timesheet file; there must be no NEW non-`$lookup` error (deleting TimesheetApp.svelte removes any it had).

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add models/yg-timesheet/src/index.ts plugins/yg-timesheet/src/index.ts plugins/yg-timesheet-resources/src/index.ts
git commit -m "yg-timesheet: convert Timesheet app to a left-sidebar navigator; retire TimesheetApp"
```

---

### Task 3: Shared table style partial (+ migrate the two HR components to it)

Create one shared SCSS partial and prove it by migrating the two components it was lifted from — visual parity confirms the extraction is faithful and gives Tasks 4-6 a single source of truth.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/yg-table.scss`
- Modify: `plugins/yg-timesheet-resources/src/components/HrOverview.svelte` (styles `~220-283`, markup `~168`)
- Modify: `plugins/yg-timesheet-resources/src/components/HrTimesheet.svelte` (styles `~242-283`, markup `~167`)

**Interfaces:**
- Produces: the SCSS classes `.yg-table`, `.yg-table th`, `.yg-table td`, `.yg-table td.bold`, `.yg-row:hover`, `.yg-num`, `.yg-totals`, `.yg-empty`, tokens `.amber`/`.green`/`.ok`/`.warn`, and status pills `.yg-pill` + `.yg-pill--{submitted,approved,rejected,partiallyapproved}` — reused by Tasks 4-6.

- [ ] **Step 1: Create the shared partial**

Create `plugins/yg-timesheet-resources/src/components/yg-table.scss` by lifting the rules from `HrOverview.svelte:220-283` (the `.hrTable` family: table, sticky `th`, `td`, `td.bold`, row hover, `.amber`/`.green`/`.ok`/`.warn`, `.totals td`, `.empty`) and the status-pill rules from `HrTimesheet.svelte:267-281` (`.hrt-pill` + the four `--{status}` modifiers, plus `.hrt-num` numeric-column rule from `:256`). Rename to the neutral namespace: `.hrTable`→`.yg-table`, `.hrt-table`→`.yg-table`, `.hrt-pill`→`.yg-pill`, `.hrt-num`→`.yg-num`, `.totals`→`.yg-totals`, `.empty`→`.yg-empty`, `.row`→`.yg-row`; keep `.amber`/`.green`/`.ok`/`.warn` names (consolidate the duplicated copies into one). Preserve every property value verbatim (colors like `var(--theme-warning-color)`, sticky-header rules, tabular-nums) so the look is byte-identical.

- [ ] **Step 2: Use the partial in HrOverview.svelte**

In `HrOverview.svelte`'s `<style lang="scss">`, replace the lifted `.hrTable`-family rules with `@use './yg-table' as *;` at the top of the block (keep any genuinely HrOverview-specific rules that were not lifted). Update the markup class names to the new namespace (`class="hrTable"`→`class="yg-table"`, and any `.row`/`.totals`/`.empty`/`.amber`/`.green`/`.ok`/`.warn` usages to the shared names). If `svelte-check`/the compiler reports unused-selector warnings for classes the file doesn't use, wrap those shared rules the file needs in the markup only (do not delete from the partial). If scoping drops the shared rules, mark them `:global(...)` inside the `@use`d partial usage as needed.

- [ ] **Step 3: Use the partial in HrTimesheet.svelte**

Same as Step 2 for `HrTimesheet.svelte`: `@use './yg-table' as *;`, swap `.hrt-table`→`.yg-table`, `.hrt-pill*`→`.yg-pill*`, `.hrt-num`→`.yg-num`, `.hrt-totals`→`.yg-totals`, tokens to shared, in both `<style>` and markup. Keep any HrTimesheet-only rules (e.g. `.hrt-task*` layout) local.

- [ ] **Step 4: Build + svelte-check**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet-resources
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check
```
Report every error line naming `HrOverview.svelte`/`HrTimesheet.svelte`; no NEW non-`$lookup`/non-unused-selector error. Note the change is visual — confirm parity by eye at the Task 9-equivalent manual check (not in this task).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/yg-table.scss \
        plugins/yg-timesheet-resources/src/components/HrOverview.svelte \
        plugins/yg-timesheet-resources/src/components/HrTimesheet.svelte
git commit -m "yg-timesheet: extract shared yg-table SCSS; migrate HR components to it"
```

---

### Task 4: Reports.svelte → shared table style

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Reports.svelte` (its local `.rp-*` table styles + markup class names)

**Interfaces:**
- Consumes: `yg-table.scss` classes (Task 3).

- [ ] **Step 1: Swap Reports' table to the shared style**

In `Reports.svelte`, add `@use './yg-table' as *;` to its `<style lang="scss">` and replace its local `.rp-*` table rules with the shared classes. Update the table markup: `<table class="rp-…">`→`<table class="yg-table">`, header/row/numeric cells to `.yg-table th` / `.yg-row` / `.yg-num`, totals to `.yg-totals`, empty state to `.yg-empty`. Keep any Reports-specific non-table styling (filters bar, export button) untouched. Do NOT change the query logic, the CSV export, or the approval-column data — layout/classes only.

- [ ] **Step 2: Build + svelte-check**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet-resources
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check && node ../../common/scripts/install-run-rushx.js test
```
Expected: builds clean; svelte-check no NEW non-`$lookup` error naming `Reports.svelte`; tests unchanged (114).

- [ ] **Step 3: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/Reports.svelte
git commit -m "yg-timesheet: Reports table uses shared yg-table style"
```

---

### Task 5: Approvals.svelte → restructure card-list into a shared-style table

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Approvals.svelte` (replace the `.ap-*` card-list markup + styles with a `.yg-table`)

**Interfaces:**
- Consumes: `yg-table.scss` classes (Task 3). Keeps the existing task query, role gate, employee resolution, and `showPopup` Approve/Reject wiring from the REV2 work — behavior unchanged, only the presentation becomes a table.

- [ ] **Step 1: Restructure the queue as a table**

In `Approvals.svelte`, replace the `.ap-*` card list with a `<table class="yg-table">` whose columns are **Employee · Date · Identifier · Title · Submitted hours · Actions**. One `<tr class="yg-row">` per submitted task, numeric cells `.yg-num`, the Actions cell holding the existing Approve and Reject buttons that call the existing `onApprove(task)` / `onReject(task)` handlers (which already `showPopup(ApproveTaskPopup/RejectTaskPopup, …)`). Keep the role-gate (`canApprove`) block, the reactive `TimesheetTask` query, and the nested `$lookup` employee resolution EXACTLY as-is — only the rendered markup and the `<style>` change. Add `@use './yg-table' as *;` and delete the local `.ap-*` rules. Preserve the empty-state via `.yg-empty` with `ygTimesheet.string.NothingToApprove`.

- [ ] **Step 2: Build + svelte-check**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet-resources
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check && node ../../common/scripts/install-run-rushx.js test
```
Expected: builds clean; the only `Approvals.svelte` svelte-check errors are the benign `$lookup` typing lines (unchanged in kind); tests unchanged (114).

- [ ] **Step 3: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/Approvals.svelte
git commit -m "yg-timesheet: Approvals queue rendered as a shared-style table"
```

---

### Task 6: Timesheet.svelte (My Timesheet) → shared table visual

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Timesheet.svelte` (its `.ts-*` weekly-view styles + status pills → shared classes)

**Interfaces:**
- Consumes: `yg-table.scss` classes incl. `.yg-pill--{status}` (Task 3).

- [ ] **Step 1: Adopt the shared table chrome for the weekly view**

In `Timesheet.svelte`, add `@use './yg-table' as *;` and migrate the weekly view's presentation to the shared classes: wrap the week's day rows in `.yg-table` (header row for the columns it shows — day/date, status, hours, actions), each day as `.yg-row`, numeric hours as `.yg-num`, and replace the local `.ts-pill--{status}` classes with the shared `.yg-pill--{status}` (including `partiallyapproved`). Preserve ALL behavior: the derived day status, the Submit/Recall buttons and their gates, per-task status + `rejectReason` on issue rows, and the rule that approved hours are NEVER displayed. This is a styling/markup change over the existing structure — keep the day-row semantics; do not re-layout the calendar logic. Remove the now-unused local `.ts-pill*`/table rules that the shared classes replace.

- [ ] **Step 2: Build + svelte-check**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet-resources
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check && node ../../common/scripts/install-run-rushx.js test
```
Expected: builds clean; the only `Timesheet.svelte` svelte-check error is the pre-existing benign `$lookup` line; tests unchanged (114).

- [ ] **Step 3: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/Timesheet.svelte
git commit -m "yg-timesheet: My Timesheet weekly view uses shared yg-table style"
```

---

## Post-implementation (not a task — for the operator)

The model change (Application `navigatorModel`) only takes effect after rebuilding the workspace/front images and `upgrade-workspace testws` (see the ops recipe). Manual verification: the Timesheet app shows a left sidebar; a plain-User employee sees only **My Timesheet**; a PM/TL sees **My Timesheet + Approvals + Reports**; a Maintainer+ also sees **Projects**; Reports/Approvals/My-Timesheet render in the shared table style; PM/TL assignment works from the Projects item.
