# Dashboard Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level role-based "Dashboard" app: PMs/admins see the existing PM dashboard, everyone else sees a new Employee dashboard, and it becomes the default landing app.

**Architecture:** A new `workbench.class.Application` ("Dashboard", visible to all, single top-level component) renders `DashboardHome`, a thin router that branches on role (admin/approver → existing `Dashboard`; else → new `EmployeeDashboard`). The Employee dashboard reuses the pure aggregation lib (`utils/dashboard.ts`) and existing widgets, scoped to the current employee. The old `Timesheet → dashboard` special is removed and the front default app retargeted.

**Tech Stack:** Huly platform (TypeScript, Svelte 4, rush/pnpm monorepo), `@hcengineering/yg-timesheet` plugin + model + resources + assets, jest for pure-lib tests.

## Global Constraints

- Branch: `yg_beta` (NEVER merge to `yg_develop` — CI auto-deploys prod). Work only on `yg_beta`.
- No em-dashes in UI copy, commit messages, or strings (user preference).
- Node 22 for builds: `source ~/.nvm/nvm.sh && nvm use 22 && export NODE_OPTIONS=--max-old-space-size=6144`.
- Plugin string/id additions require regenerating plugin types: in `plugins/yg-timesheet/` run `rushx _phase:build && rushx _phase:validate` (via `node ../../common/scripts/install-run-rushx.js <script>`), or svelte-check fails "Property X does not exist".
- This is a MODEL change → deploy is the full 4-image rebuild (`front/workspace/transactor/tool` `yg-local/*:beta`) + `./run-tool-beta.sh upgrade-workspace yg`, per the established flow. Front-only rebuild is NOT sufficient.
- Follow existing patterns: the Attendance app definition (`models/yg-timesheet/src/index.ts` ~322-346) and the PM dashboard cards (`plugins/yg-timesheet-resources/src/components/dashboard/*`) are the templates.
- Reuse the pure lib in `utils/dashboard.ts`; put no aggregation math in Svelte.

---

### Task 1: `assignedTo` pure helper (me-scoped issue filter)

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/dashboard.ts`
- Test: `plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts`

**Interfaces:**
- Produces: `export function assignedTo (issues: DashIssue[], employee: string): DashIssue[]` — returns issues whose `assignee === employee`.

- [ ] **Step 1: Write the failing test** (append to `dashboard.test.ts`)

```ts
describe('assignedTo', () => {
  const issues = [
    iss({ id: 'a', assignee: 'e1' }),
    iss({ id: 'b', assignee: 'e2' }),
    iss({ id: 'c', assignee: null }),
    iss({ id: 'd', assignee: 'e1' })
  ]
  it('keeps only the given employee assignments', () => {
    expect(assignedTo(issues, 'e1').map((i) => i.id)).toEqual(['a', 'd'])
  })
  it('empty when none match', () => {
    expect(assignedTo(issues, 'zzz')).toEqual([])
  })
})
```

Add `assignedTo` to the import at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run (from `plugins/yg-timesheet-resources`): `node ../../common/scripts/install-run-rushx.js test`
Expected: FAIL — `assignedTo is not a function`.

- [ ] **Step 3: Write minimal implementation** (add to `utils/dashboard.ts`, near `priorityWatch`)

```ts
// Issues assigned to a specific employee (the "me"-scope for the Employee dashboard).
export function assignedTo (issues: DashIssue[], employee: string): DashIssue[] {
  return issues.filter((i) => i.assignee === employee)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ../../common/scripts/install-run-rushx.js test`
Expected: PASS (all suites green).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/dashboard.ts plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts
git commit -m "feat(dashboard): add assignedTo me-scope helper"
```

---

### Task 2: Plugin ids + strings for the Dashboard app

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts`
- Modify: `plugins/yg-timesheet-assets/lang/en.json` (and any other lang files present, e.g. `ru.json` — copy the English value)

**Interfaces:**
- Produces (ids, all `'' as <Type>` in the plugin descriptor):
  - `app.Dashboard: '' as Ref<Doc>`
  - `component.DashboardHome: '' as AnyComponent`
  - `string.Dashboard` already exists (reuse for the app label). New strings:
    `string.MyAttendanceToday`, `string.MyTasks`, `string.MyHoursThisWeek`,
    `string.MyPriority`, `string.MyOverdue` — all `'' as IntlString`.

- [ ] **Step 1: Add the ids** to the `plugin(ygTimesheetId, {...})` descriptor in `plugins/yg-timesheet/src/index.ts`.
  - Under `app:` add `Dashboard: '' as Ref<Doc>`.
  - Under `component:` add `DashboardHome: '' as AnyComponent`.
  - Under `string:` add the five new strings above (each `'' as IntlString`).

- [ ] **Step 2: Add the English copy** to `plugins/yg-timesheet-assets/lang/en.json` (no em-dashes):

```json
"MyAttendanceToday": "My attendance today",
"MyTasks": "My tasks",
"MyHoursThisWeek": "My hours this week",
"MyPriority": "My priority",
"MyOverdue": "My overdue / due this week"
```

(The `Dashboard` string already exists as the app label.)

- [ ] **Step 3: Regenerate plugin types**

Run (from `plugins/yg-timesheet`):
`node ../../common/scripts/install-run-rushx.js _phase:build && node ../../common/scripts/install-run-rushx.js _phase:validate`
Expected: regenerates `types/index.d.ts` with the new ids, exit 0.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet/src plugins/yg-timesheet-assets/lang
git commit -m "feat(dashboard): plugin ids + strings for the Dashboard app"
```

---

### Task 3: Employee dashboard cards (three new focused cards)

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/dashboard/MyAttendanceCard.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/dashboard/MyTasksCard.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/dashboard/MyHoursCard.svelte`

**Interfaces (props each card consumes — the parent `EmployeeDashboard` supplies these):**
- `MyAttendanceCard`: `export let open: boolean; export let mode: 'office'|'wfh'|undefined; export let todayMs: number; export let sessions: number; export let firstIn: number|undefined` — renders punch state + today total (`formatDuration`).
- `MyTasksCard`: `export let issues: DashIssue[]; export let statusColumns: string[]` — my open issues grouped by real status; renders a compact "status: count" row plus a scrollable list (reuse `.yg-table` + `openStatusNames` upstream). Card root uses the yg-table panel style (copy the `.pw` block from `PriorityWatch.svelte`).
- `MyHoursCard`: `export let hours: number; export let entries: Array<{ identifier: string; title: string; hours: number; date: number }>` — this-week total + recent entries list.

- [ ] **Step 1: Build `MyAttendanceCard.svelte`** — copy the panel shell + tokens from `dashboard/PriorityWatch.svelte` (`.pw` card style, `<Label>` title). Show:
  - Title `<Label label={ygTimesheet.string.MyAttendanceToday} />`.
  - A status line: if `open` → "On the clock ({mode})" with the accent dot; else "Not punched in".
  - Today total via `formatDuration(todayMs)`, `sessions` count, `firstIn` time (use the existing `hmns`/time formatting already in `MyAttendance.svelte`).
  - No punch actions in v1 (glance only; actions live in the Attendance app).

- [ ] **Step 2: Build `MyTasksCard.svelte`** — copy the `.pw`/`.yg-table` pattern. Render one row per `statusColumns` name with its count (from `issues` grouped by `i.status`), then a scrollable (`max-height: 260px; overflow:auto`) list of the issues (id badge + title + status), each linking via `getPanelURI(tracker.component.EditIssue, ...)` exactly like `PriorityWatch.svelte`.

- [ ] **Step 3: Build `MyHoursCard.svelte`** — panel shell; big `formatHours(hours)` for the week total, then a short list of `entries` (identifier + title + `formatHours(e.hours)`), newest first.

- [ ] **Step 4: svelte-check**

Run (from `plugins/yg-timesheet-resources`): `node ../../common/scripts/install-run-rushx.js svelte-check`
Expected: no NEW errors in the three new files (the 7 pre-existing `$lookup` baseline errors in Approvals/HrTimesheet/Timesheet are unrelated and expected).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/dashboard/My*.svelte
git commit -m "feat(dashboard): employee cards (attendance, tasks, hours)"
```

---

### Task 4: `EmployeeDashboard.svelte` (owns queries, lays out the six cards)

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/EmployeeDashboard.svelte`

**Interfaces:**
- Consumes: `MyAttendanceCard`, `MyTasksCard`, `MyHoursCard` (Task 3); reuses `InboxWidget`, `PriorityWatch`, `OverdueList` (existing `dashboard/*`); `assignedTo` (Task 1) and existing `openStatusNames/overdueIssues/dueSoonIssues/priorityWatch/formatName`.
- Produces: a default-exported Svelte component (used by `DashboardHome`).

- [ ] **Step 1: Build the component.** Mirror `Dashboard.svelte`'s query+map pattern but scope to the current employee (`const me = getCurrentEmployee()`):
  - Query `tracker.class.Issue` where `assignee: me` → map to `DashIssue[]` (reuse the exact mapping from `Dashboard.svelte`, incl. `status: statusName.get(i.status)`), plus the `IssueStatus` query for `statusCat`/`statusName`.
  - Query `tracker.class.TimeSpendReport` where `{ employee: me, date: { $gte: weekStart, $lt: weekEnd } }` (use `weekRange(Date.now())`) → my hours + entries.
  - Query `ygTimesheet.class.AttendanceSession` where `{ employee: me, date: localMidnight(now) }` → today's punch state via `findOpenSession` + `dayStats` (from `utils/attendance.ts`).
  - Derive: `myIssues = assignedTo(issues, me)` (already scoped, but keep explicit); `statusColumns = openStatusNames(myIssues)`; `priority = priorityWatch(myIssues)`; `overdue = overdueIssues(myIssues, now)`; `dueSoon = dueSoonIssues(myIssues, now, 7)`; `employeeNames` map (query `contact.mixin.Employee` for name display).
  - Layout: reuse `GreetingCard`, then a grid with the six cards. Use the `.dash-attention` 2x2 pattern (copy its CSS from `Dashboard.svelte`): row 1 = `MyAttendanceCard`, `InboxWidget`; row 2 = `MyPriority` (`PriorityWatch issues={priority}`), `MyOverdue` (`OverdueList overdue={overdue} dueSoon={dueSoon}`); then full-width `MyTasksCard issues={myIssues} statusColumns={statusColumns}` and `MyHoursCard`.

- [ ] **Step 2: svelte-check** (from `plugins/yg-timesheet-resources`): `node ../../common/scripts/install-run-rushx.js svelte-check` — no new errors.

- [ ] **Step 3: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/EmployeeDashboard.svelte
git commit -m "feat(dashboard): EmployeeDashboard with six me-scoped cards"
```

---

### Task 5: `DashboardHome.svelte` role router

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/DashboardHome.svelte`

**Interfaces:**
- Consumes: existing `Dashboard.svelte` (PM), `EmployeeDashboard.svelte` (Task 4); role detection copied from `Dashboard.svelte` (`isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)`; `isApprover` via `canApproveView` over the `ProjectApprovers` mixin pairs). 
- Produces: default-exported component registered as `ygTimesheet.component.DashboardHome`.

- [ ] **Step 1: Build the router.** Copy the `isAdmin`/`isApprover`/`canView` block verbatim from `Dashboard.svelte` (the `projectQuery` that computes `isApprover`). Then:

```svelte
{#if !ready}
  <!-- projects query still resolving; render nothing to avoid a PM->employee flash -->
{:else if isPM}
  <Dashboard />
{:else}
  <EmployeeDashboard />
{/if}
```

where `isPM = isAdmin || isApprover` and `ready` flips true once the projects query first returns (add a `let ready = false` set in the query callback). Import `Dashboard` and `EmployeeDashboard`.

- [ ] **Step 2: svelte-check** — no new errors.

- [ ] **Step 3: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/DashboardHome.svelte
git commit -m "feat(dashboard): DashboardHome role router"
```

---

### Task 6: Register `DashboardHome` in the resources index

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/index.ts`

- [ ] **Step 1:** Import `DashboardHome from './components/DashboardHome.svelte'` and add `DashboardHome` to the `component: { ... }` map in the default `Resources` export (next to `Dashboard`).

- [ ] **Step 2: svelte-check** — no new errors.

- [ ] **Step 3: Commit**

```bash
git add plugins/yg-timesheet-resources/src/index.ts
git commit -m "feat(dashboard): register DashboardHome component"
```

---

### Task 7: Model — create the Dashboard app, remove the Timesheet dashboard special

**Files:**
- Modify: `models/yg-timesheet/src/index.ts`

**Interfaces:**
- Consumes: `ygTimesheet.app.Dashboard`, `ygTimesheet.component.DashboardHome`, `ygTimesheet.string.Dashboard` (Task 2).

- [ ] **Step 1: Create the Dashboard Application** — near the other `builder.createDoc(workbench.class.Application, ...)` calls, add:

```ts
builder.createDoc(
  workbench.class.Application,
  core.space.Model,
  {
    label: ygTimesheet.string.Dashboard,
    icon: tracker.icon.Home, // dashboard/home glyph (swap if a better asset exists)
    alias: 'yg-dashboard',
    hidden: false,
    position: 'top',
    // Single view that routes internally by role; no navigatorModel/specials.
    component: ygTimesheet.component.DashboardHome
  },
  ygTimesheet.app.Dashboard
)
```

- [ ] **Step 2: Remove the old special** — in the Timesheet app's `navigatorModel.specials`, delete the `{ id: 'dashboard', ... component: ygTimesheet.component.Dashboard, visibleIf: ygTimesheet.function.CanApprove, ... }` entry (around line 192-199). Leave `my`, `approvals`, `reports`, `projects`, `reminders`. The `Dashboard` component id stays (still rendered by `DashboardHome`).

- [ ] **Step 3: Transpile check** — from repo root: `node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-timesheet` (or the model package name); expected exit 0.

- [ ] **Step 4: Commit**

```bash
git add models/yg-timesheet/src/index.ts
git commit -m "feat(dashboard): top-level Dashboard app; drop Timesheet dashboard special"
```

---

### Task 8: Default landing app → Dashboard

**Files:**
- Modify: `dev/prod/src/platform.ts:741-743`

- [ ] **Step 1:** Change the default application fallback from `'tracker'` to the Dashboard app alias, and null out the tracker-specific default space/special (a component-only app ignores them):

```ts
setMetadata(workbench.metadata.DefaultApplication, myBranding.defaultApplication ?? 'yg-dashboard')
setMetadata(workbench.metadata.DefaultSpace, myBranding.defaultSpace ?? undefined)
setMetadata(workbench.metadata.DefaultSpecial, myBranding.defaultSpecial ?? undefined)
```

(Keep respecting `myBranding.*` if set; only the fallbacks change.)

- [ ] **Step 2: Commit**

```bash
git add dev/prod/src/platform.ts
git commit -m "feat(dashboard): land on the Dashboard app by default"
```

---

### Task 9: Build, upgrade, deploy, verify

**Files:** none (build/deploy).

- [ ] **Step 1: Full 4-image build.** Model changed, so rebuild all four `yg-local/*:beta` images (front + workspace + transactor + tool) from `yg_beta`, per the established build flow (`nvm use 22`, `NODE_OPTIONS=--max-old-space-size=6144`, rush build → dev/prod package → pods/{front,workspace,transactor,tool} docker builds). Confirm all four images are freshly built.

- [ ] **Step 2: Deploy + upgrade** (from `huly-selfhost/`):

```bash
C="docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml"
$C up -d redpanda
$C up -d --force-recreate front workspace transactor
$C up -d
./run-tool-beta.sh upgrade-workspace yg
$C restart nginx      # nginx caches front/transactor IPs after recreate
```

Expected: `upgrade-workspace done`; front returns HTTP 200. Ignore the stock `relation "comment" does not exist` chunter migration noise.

- [ ] **Step 3: Manual verify.**
  - Log in as **pravin** (approver) → the **Dashboard** app appears top of the left rail and opens the **PM dashboard**; the **Timesheet** app no longer has a Dashboard sub-item.
  - Log in as a **non-PM employee** → the Dashboard app opens the **Employee dashboard** with the six cards populated from that user's own data (attendance today, inbox, my priority, my overdue, my tasks by status, my hours this week).
  - After login (bare workspace URL), users **land on the Dashboard app** by default.

- [ ] **Step 4: Commit** (only if any fix-ups were needed during verify; the feature commits already landed in Tasks 1-8).

---

## Self-Review

- **Spec coverage:** top-level app (T7) · role router (T5) · PM moved in (T5 renders existing `Dashboard`) · Employee dashboard + 6 cards (T3/T4, InboxWidget/PriorityWatch/OverdueList reused) · remove old special (T7) · default landing (T8) · model rebuild + upgrade (T9). HR explicitly deferred (spec Phase 2) — no task, correct. All spec sections map to a task.
- **Placeholder scan:** none — every task has concrete files, code, and commands. The one runtime asset choice (`tracker.icon.Home`) is flagged as swappable but is a real, valid asset ref.
- **Type consistency:** `assignedTo(issues, employee)` (T1) used in T4; `app.Dashboard`/`component.DashboardHome`/the 5 strings (T2) used in T5/T6/T7; `alias 'yg-dashboard'` (T7) matches the default-app value (T8). Consistent.
