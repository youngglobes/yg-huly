# Per-Task Timesheet Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move timesheet approval from the day to the individual task (one issue per day), each with its own approver, approved hours and reject reason — fixing the defect where any approver on a multi-project day can approve another lead's work.

**Architecture:** A new `TimesheetTask` doc is attached to each `TimesheetDay`, one per issue per day, stamped at submit time with the PM + Team Lead of **that task's project only**. Approve/reject acts on the task. The day's status becomes a derived label computed client-side from its tasks (adding a new `PartiallyApproved` value); the Approvals queue queries `TimesheetTask` directly, so each approver sees exactly the tasks they may action.

**Tech Stack:** Huly platform (Rush monorepo, pnpm, Svelte, TypeScript), `@hcengineering/{core,model,model-core,contact,tracker,presentation,ui,server-core}`, ts-jest. Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`).

## Global Constraints

- **Branch:** all commits on `yg_beta`. Push to `origin/yg_beta` is allowed (demo branch). **Never merge to `yg_develop`**, which is the branch CI builds and auto-deploys to production.
- **Spec:** `docs/superpowers/specs/2026-07-22-per-task-timesheet-approval-design.md`.
- **Build:** from a package dir, `node ../../common/scripts/install-run-rushx.js <script>`; repo-wide `node common/scripts/install-run-rush.js build --to <pkg>`. Tests `rushx test`. Svelte types `rushx svelte-check`.
- **`svelte-check` is mandatory** on any task touching `.svelte` — jest cannot see those files. Known pre-existing baseline that is NOT yours: 3 `$lookup` errors in `Timesheet.svelte`/`Approvals.svelte`, and 21 errors in the sibling `text-editor-resources` package.
- **Approval NEVER mutates the employee's logged time.** `TimeSpendReport` stays the employee's record. Approved hours are an overlay.
- **Approval unit = one issue per day.** Multiple `TimeSpendReport` entries on the same issue+date collapse into ONE task.
- **Approvers are stamped at submit time**, per task, from that task's project only, minus the employee (no self-approve).
- **Drift is flagged, never locked** — carry forward `driftHours()`.
- **Day status is derived for display only. Never stored, never queried.** `TimesheetDay.status` becomes legacy/deprecated — keep the field for migration compatibility, stop reading it.
- **Reject requires a reason; approve requires hours** (defaulted to submitted hours).
- Existing suite is currently **89 passing** in `yg-timesheet-resources` — must never regress.

---

## File Structure

**Create**
- `plugins/yg-timesheet-resources/src/utils/task-approval.ts` — pure lib: build task units, derive day status, per-task authorization. No platform deps.
- `plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts`
- `plugins/yg-timesheet-resources/src/components/ApproveTaskPopup.svelte` — approve dialog capturing approved hours.
- `plugins/yg-timesheet-resources/src/components/RejectTaskPopup.svelte` — reject dialog capturing a required reason.

**Modify**
- `plugins/yg-timesheet/src/index.ts` — `TaskStatus`, `TimesheetTask` interface, `DayStatus` + `PartiallyApproved`, ids, strings.
- `models/yg-timesheet/src/index.ts` — `TTimesheetTask` model class; register it.
- `models/yg-timesheet/src/migration.ts` — derive tasks from existing days' snapshots.
- `plugins/yg-timesheet-resources/src/utils/day.ts` — `submitDay` creates task records; add approve/reject helpers.
- `plugins/yg-timesheet-resources/src/utils/workflow.ts` — `resolveApprovers` narrowed to one project.
- `plugins/yg-timesheet-resources/src/components/Approvals.svelte` — queue over `TimesheetTask`.
- `plugins/yg-timesheet-resources/src/components/Timesheet.svelte` — per-task status + derived day label.
- `plugins/yg-timesheet-resources/src/components/HrOverview.svelte`, `HrTimesheet.svelte` — handle `PartiallyApproved`.
- `plugins/yg-timesheet-resources/src/utils/reports.ts` — fill the two TL/PM approval columns.
- `server-plugins/yg-timesheet-resources/src/index.ts` — per-task authorization revert.
- `models/server-yg-timesheet/src/index.ts` — register the trigger.
- `plugins/yg-timesheet-assets/lang/en.json`, `ru.json` — new strings.

---

### Task 1: Pure lib — task units, derived day status, per-task authorization (TDD)

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts` (declare `TaskStatus` — Step 0)
- Create: `plugins/yg-timesheet-resources/src/utils/task-approval.ts`
- Test: `plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts`

**Interfaces:**
- Consumes: `DayReportLike` and `ProjectApproverLike` from `./workflow`.
- Produces:
  - `type TaskStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected'` — declared in the plugin
    package, re-exported from the lib

- [ ] **Step 0: Declare the shared status type**

The status values must have ONE definition so the model (Task 2) and this lib cannot drift. Add to
`plugins/yg-timesheet/src/index.ts`, next to the existing `DayStatus`:

```ts
/**
 * Status of one approvable unit (a task). Same four values the day used to carry.
 * `PartiallyApproved` is deliberately NOT here: it is only ever DERIVED for a day.
 */
export type TaskStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected'
```

Then build it so the lib can import it:

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet
```
  - `type DerivedDayStatus = 'Draft' | 'Submitted' | 'PartiallyApproved' | 'Approved' | 'Rejected'`
  - `interface TaskUnit { issue: string, identifier: string, title: string, project: string, submittedHours: number, approvers: string[] }`
  - `buildTaskUnits (reports: DayReportLike[], byProject: Map<string, ProjectApproverLike>, employee: string): TaskUnit[]`
  - `deriveDayStatus (statuses: TaskStatus[]): DerivedDayStatus`
  - `canApproveTask (taskApprovers: string[], employee: string, actor: string, isAdmin: boolean): boolean`

- [ ] **Step 1: Write the failing tests**

Create `plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts`:

```ts
import { buildTaskUnits, deriveDayStatus, canApproveTask, taskDrift } from '../task-approval'
import type { DayReportLike, ProjectApproverLike } from '../workflow'

function rep (issue: string, project: string, value: number, identifier = issue): DayReportLike {
  return { project, employee: 'k2', issue, identifier, title: `T ${issue}`, value, note: '' }
}
const approvers = new Map<string, ProjectApproverLike>([
  ['proj-1', { pm: 'pm-1', teamLead: 'tl-a' }],
  ['proj-2', { pm: 'pm-1', teamLead: 'tl-b' }]
])

test('one unit per issue, hours summed across entries on the same issue', () => {
  const units = buildTaskUnits([rep('i1', 'proj-1', 2), rep('i1', 'proj-1', 1)], approvers, 'k2')
  expect(units).toHaveLength(1)
  expect(units[0].submittedHours).toBe(3)
})

test('separate issues stay separate units', () => {
  const units = buildTaskUnits([rep('i1', 'proj-1', 3), rep('i2', 'proj-2', 5)], approvers, 'k2')
  expect(units).toHaveLength(2)
})

test('THE DEFECT: each unit carries ONLY its own project approvers', () => {
  const units = buildTaskUnits([rep('i1', 'proj-1', 3), rep('i2', 'proj-2', 5)], approvers, 'k2')
  const u1 = units.find((u) => u.issue === 'i1')!
  const u2 = units.find((u) => u.issue === 'i2')!
  expect(u1.approvers.sort()).toEqual(['pm-1', 'tl-a'])
  expect(u2.approvers.sort()).toEqual(['pm-1', 'tl-b'])
  expect(u1.approvers).not.toContain('tl-b')
  expect(u2.approvers).not.toContain('tl-a')
})

test('the employee is never their own approver', () => {
  const self = new Map<string, ProjectApproverLike>([['proj-1', { pm: 'k2', teamLead: 'tl-a' }]])
  expect(buildTaskUnits([rep('i1', 'proj-1', 2)], self, 'k2')[0].approvers).toEqual(['tl-a'])
})

test('a project with no PM/TL yields an empty approver list (surfaced, not guessed)', () => {
  const none = new Map<string, ProjectApproverLike>([['proj-9', {}]])
  expect(buildTaskUnits([rep('i9', 'proj-9', 2)], none, 'k2')[0].approvers).toEqual([])
})

test('units are sorted by identifier, numeric-aware', () => {
  const units = buildTaskUnits(
    [rep('i10', 'proj-1', 1, 'TSK-10'), rep('i2', 'proj-1', 1, 'TSK-2')], approvers, 'k2'
  )
  expect(units.map((u) => u.identifier)).toEqual(['TSK-2', 'TSK-10'])
})

test('deriveDayStatus: any rejected wins', () => {
  expect(deriveDayStatus(['Approved', 'Rejected'])).toBe('Rejected')
})

test('deriveDayStatus: all approved', () => {
  expect(deriveDayStatus(['Approved', 'Approved'])).toBe('Approved')
})

test('deriveDayStatus: mixed approved and submitted = PartiallyApproved', () => {
  expect(deriveDayStatus(['Approved', 'Submitted'])).toBe('PartiallyApproved')
})

test('deriveDayStatus: submitted only', () => {
  expect(deriveDayStatus(['Submitted', 'Submitted'])).toBe('Submitted')
})

test('deriveDayStatus: drafts only, and the empty day', () => {
  expect(deriveDayStatus(['Draft'])).toBe('Draft')
  expect(deriveDayStatus([])).toBe('Draft')
})

test('deriveDayStatus: approved + draft is still PartiallyApproved', () => {
  expect(deriveDayStatus(['Approved', 'Draft'])).toBe('PartiallyApproved')
})

test('taskDrift: hours edited after approval are flagged, not locked', () => {
  expect(taskDrift(3, 3)).toBe(0)
  expect(taskDrift(3, 4.5)).toBe(1.5) // logged more after approval
  expect(taskDrift(3, 2)).toBe(-1)    // logged less after approval
  expect(taskDrift(1 / 3, 1 / 3)).toBe(0) // no float noise
})

test('canApproveTask: only this task approvers, never the employee', () => {
  expect(canApproveTask(['tl-a'], 'k2', 'tl-a', false)).toBe(true)
  expect(canApproveTask(['tl-a'], 'k2', 'tl-b', false)).toBe(false) // THE DEFECT, closed
  expect(canApproveTask(['tl-a'], 'k2', 'k2', true)).toBe(false) // no self-approve, even admin
  expect(canApproveTask([], 'k2', 'someone', true)).toBe(true) // admin override
})
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- task-approval
```

Expected: FAIL — `Cannot find module '../task-approval'`.

- [ ] **Step 3: Implement `task-approval.ts`**

Create `plugins/yg-timesheet-resources/src/utils/task-approval.ts`:

```ts
//
// Per-task approval logic. Pure — no platform deps → unit-testable.
//
// Replaces the day-level model, which had a single status and a single approver list built from
// the UNION of every project in the day. That let the lead of one project approve another lead's
// hours (and whoever clicked first locked the other out). Here each task carries only its own
// project's approvers, so that is structurally impossible.
//
import type { DayReportLike, ProjectApproverLike } from './workflow'
// Single source of truth for the per-task status values — declared in the plugin package
// (plugins/yg-timesheet/src/index.ts) and re-exported here so the model and this lib cannot drift.
import type { TaskStatus } from '@hcengineering/yg-timesheet'

export type { TaskStatus }

/** Day status is DERIVED from its tasks — for display only. Never stored, never queried. */
export type DerivedDayStatus = 'Draft' | 'Submitted' | 'PartiallyApproved' | 'Approved' | 'Rejected'

export interface TaskUnit {
  issue: string
  identifier: string
  title: string
  project: string
  submittedHours: number
  approvers: string[]
}

/**
 * Collapse a day's time entries into one unit per ISSUE, summing hours, and stamp each unit with
 * the PM + Team Lead of ITS OWN project only. An empty approver list means the project has no
 * PM/TL configured — surfaced to the user, never silently rerouted.
 */
export function buildTaskUnits (
  reports: DayReportLike[],
  byProject: Map<string, ProjectApproverLike>,
  employee: string
): TaskUnit[] {
  const byIssue = new Map<string, TaskUnit>()
  for (const r of reports) {
    let unit = byIssue.get(r.issue)
    if (unit === undefined) {
      const pa = byProject.get(r.project)
      const set = new Set<string>()
      if (pa?.pm != null && pa.pm !== '') set.add(pa.pm)
      if (pa?.teamLead != null && pa.teamLead !== '') set.add(pa.teamLead)
      set.delete(employee) // no self-approve
      unit = {
        issue: r.issue,
        identifier: r.identifier,
        title: r.title,
        project: r.project,
        submittedHours: 0,
        approvers: [...set]
      }
      byIssue.set(r.issue, unit)
    }
    unit.submittedHours += r.value
  }
  return [...byIssue.values()].sort((a, b) =>
    a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
  )
}

export function deriveDayStatus (statuses: TaskStatus[]): DerivedDayStatus {
  if (statuses.length === 0) return 'Draft'
  if (statuses.includes('Rejected')) return 'Rejected'
  const approved = statuses.filter((s) => s === 'Approved').length
  if (approved === statuses.length) return 'Approved'
  if (approved > 0) return 'PartiallyApproved'
  if (statuses.includes('Submitted')) return 'Submitted'
  return 'Draft'
}

export function canApproveTask (
  taskApprovers: string[], employee: string, actor: string, isAdmin: boolean
): boolean {
  if (actor === employee) return false // no self-approve, even admin
  return isAdmin || taskApprovers.includes(actor)
}

/**
 * Hours logged against this task since it was submitted, as a signed delta. FLAG ONLY — editing
 * time after approval is never blocked (the day-level `driftHours()` precedent, carried forward
 * per task). Rounded to 2dp so float noise never shows as spurious drift.
 */
export function taskDrift (submittedHours: number, liveHours: number): number {
  return Math.round((liveHours - submittedHours) * 100) / 100
}
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test
```

Expected: 89 existing + 12 new all pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/task-approval.ts \
        plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts
git commit -m "yg-timesheet: pure per-task approval lib (units, derived day status, authz) TDD"
```

---

### Task 2: Data model — `TimesheetTask`

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts`
- Modify: `models/yg-timesheet/src/index.ts`
- Modify: `plugins/yg-timesheet-assets/lang/en.json`, `ru.json`

**Interfaces:**
- Produces: `ygTimesheet.class.TimesheetTask`; `interface TimesheetTask extends AttachedDoc`; strings `ApprovedHours`, `ApproveTask`, `RejectTask`, `RejectReason`, `PartiallyApproved`, `SubmittedHours`.

- [ ] **Step 1: Add the interface and ids to the plugin**

`TaskStatus` was already declared in Task 1 Step 0 — do not redeclare it. In
`plugins/yg-timesheet/src/index.ts`, add after the `TimesheetDay` interface:

```ts
/** Per-task (one issue per day) approval record — the unit an approver actions. */
export interface TimesheetTask extends AttachedDoc {
  date: Timestamp
  issue: Ref<Issue>
  identifier: string
  title: string
  project: Ref<Project>
  submittedHours: number
  status: TaskStatus
  /** PM + Team Lead of THIS task's project only, minus the employee. Stamped at submit time. */
  approvers: Ref<Employee>[]
  submittedOn?: Timestamp
  approvedHours?: number
  approvedBy?: Ref<Employee>
  approvedOn?: Timestamp
  rejectReason?: string
}
```

`TimesheetTask.attachedTo` is the `TimesheetDay`. Note `status` reuses the existing `DayStatus`
union (`Draft | Submitted | Approved | Rejected`) — `PartiallyApproved` is **never** stored on a
task, only derived for a day.

Add to the `plugin(ygTimesheetId, {...})` block — under `class`:

```ts
    TimesheetTask: '' as Ref<Class<TimesheetTask>>,
```

under `string`:

```ts
    ApprovedHours: '' as IntlString,
    SubmittedHours: '' as IntlString,
    ApproveTask: '' as IntlString,
    RejectTask: '' as IntlString,
    RejectReason: '' as IntlString,
    PartiallyApproved: '' as IntlString,
```

under `component`:

```ts
    ApproveTaskPopup: '' as AnyComponent,
    RejectTaskPopup: '' as AnyComponent,
```

- [ ] **Step 2: Add the model class**

In `models/yg-timesheet/src/index.ts`, add after `TTimesheetDay`:

```ts
@Model(ygTimesheet.class.TimesheetTask, core.class.AttachedDoc, DOMAIN_YG_TIMESHEET)
export class TTimesheetTask extends TAttachedDoc implements TimesheetTask {
  @Prop(TypeRef(ygTimesheet.class.TimesheetDay), core.string.Object)
  declare attachedTo: Ref<TimesheetDay>

  @Prop(TypeDate(), core.string.Object) date!: Timestamp
  @Prop(TypeRef(tracker.class.Issue), core.string.Object) issue!: Ref<Issue>
  @Prop(TypeString(), core.string.Object) identifier!: string
  @Prop(TypeString(), core.string.Object) title!: string
  @Prop(TypeRef(tracker.class.Project), core.string.Object) project!: Ref<Project>
  @Prop(TypeNumber(), core.string.Object) submittedHours!: number
  @Prop(TypeString(), core.string.Object) status!: TaskStatus
  @Prop(ArrOf(TypeRef(contact.mixin.Employee)), core.string.Object) approvers!: Ref<Employee>[]
  @Prop(TypeDate(), core.string.Object) submittedOn?: Timestamp
  @Prop(TypeNumber(), core.string.Object) approvedHours?: number
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) approvedBy?: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) approvedOn?: Timestamp
  @Prop(TypeString(), core.string.Object) rejectReason?: string
}
```

Import `TimesheetTask` alongside the other types, and register the class by changing:

```ts
  builder.createModel(TTimesheet, TTimesheetDay, TProjectApprovers, THrTimeEntry)
```

to:

```ts
  builder.createModel(TTimesheet, TTimesheetDay, TTimesheetTask, TProjectApprovers, THrTimeEntry)
```

Also add a deprecation comment above `TTimesheetDay.status`:

```ts
  // DEPRECATED (2026-07-23): the day's status is now DERIVED from its TimesheetTask children
  // (see utils/task-approval.ts deriveDayStatus). Field retained so pre-migration rows stay
  // readable; nothing reads it any more. Do not write it.
```

- [ ] **Step 3: Add the strings (en + ru must have identical key sets)**

`plugins/yg-timesheet-assets/lang/en.json`, inside `"string"`:

```json
    "ApprovedHours": "Approved hours",
    "SubmittedHours": "Submitted hours",
    "ApproveTask": "Approve task",
    "RejectTask": "Reject task",
    "RejectReason": "Reason",
    "PartiallyApproved": "Partially approved"
```

`plugins/yg-timesheet-assets/lang/ru.json`, inside `"string"`:

```json
    "ApprovedHours": "Утверждённые часы",
    "SubmittedHours": "Отправленные часы",
    "ApproveTask": "Утвердить задачу",
    "RejectTask": "Отклонить задачу",
    "RejectReason": "Причина",
    "PartiallyApproved": "Частично утверждено"
```

- [ ] **Step 4: Build**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-timesheet --to @hcengineering/yg-timesheet-assets
```

Expected: both succeed. A key present in one lang file but not the other is the usual failure.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts models/yg-timesheet/src/index.ts \
        plugins/yg-timesheet-assets/lang/en.json plugins/yg-timesheet-assets/lang/ru.json
git commit -m "yg-timesheet: TimesheetTask model + strings for per-task approval"
```

---

### Task 3: Submit path — create one task record per issue

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/day.ts`

**Interfaces:**
- Consumes: `buildTaskUnits` from `./task-approval`.
- Produces:
  - `interface NoApproverResult { kind: typeof NO_APPROVER, projects: string[] }` — exported from
    `day.ts`; `projects` holds the project refs that have no PM/TL configured.
  - `submitDay (client, args): Promise<Ref<TimesheetDay> | NoApproverResult>` — now also creates
    `TimesheetTask` rows. **Callers must be updated**: the old contract returned the bare
    `NO_APPROVER` string sentinel, so a `res === NO_APPROVER` check no longer matches. Use
    `typeof res === 'object' && 'kind' in res`.
  - `approveTask (client, taskId, approvedHours): Promise<void>`
  - `rejectTask (client, taskId, reason): Promise<void>`

`Timesheet.svelte` currently does `const res = await submitDay(...)` and compares against
`NO_APPROVER`. Update that call site in this task to show which projects are misconfigured, using
the existing `ygTimesheet.string.NoApprover` message plus the project names.

- [ ] **Step 1: Rewrite `submitDay` to create task records**

In `plugins/yg-timesheet-resources/src/utils/day.ts`, add to the imports:

```ts
import { buildTaskUnits } from './task-approval'
```

Replace the body of `submitDay` with:

```ts
export async function submitDay (
  client: TxOperations,
  { employee, date, reports, approversByProject }: SubmitArgs
): Promise<Ref<TimesheetDay> | typeof NO_APPROVER> {
  const units = buildTaskUnits(reports, approversByProject, employee)
  // Every task must have somewhere to go. If ANY task's project has no PM/TL configured we do not
  // write at all — the UI surfaces the error so the missing project config gets fixed, rather than
  // silently parking that task where nobody will ever see it.
  //
  // NOTE this is STRICTER than the old day-level rule, which submitted as long as ONE project in
  // the day had an approver (leaving the rest unapprovable). Returning the offending projects
  // rather than a bare sentinel is deliberate (user decision 2026-07-23): a generic "No approver"
  // tells the employee nothing about who to chase.
  if (units.length === 0) return NO_APPROVER
  const unapprovable = units.filter((u) => u.approvers.length === 0)
  if (unapprovable.length > 0) {
    return { kind: NO_APPROVER, projects: [...new Set(unapprovable.map((u) => u.project))] }
  }

  const totalHours = units.reduce((sum, u) => sum + u.submittedHours, 0)
  const submittedOn = Date.now()
  const tsId = await ensureTimesheet(client, employee, weekStartOf(date))
  const dayId = await ensureDay(client, tsId, date)

  // Replace any task rows from a previous submit of this day so a re-submit after edits cannot
  // leave stale issues behind. Approved rows are preserved — re-submitting a corrected task must
  // not silently discard a sibling task an approver already signed off.
  const existing = await client.findAll(ygTimesheet.class.TimesheetTask, { attachedTo: dayId })
  for (const t of existing) {
    if (t.status !== 'Approved') await client.remove(t)
  }
  const keptIssues = new Set(existing.filter((t) => t.status === 'Approved').map((t) => t.issue))

  for (const u of units) {
    if (keptIssues.has(u.issue as Ref<Issue>)) continue
    await client.addCollection(
      ygTimesheet.class.TimesheetTask,
      core.space.Workspace,
      dayId,
      ygTimesheet.class.TimesheetDay,
      'tasks',
      {
        date,
        issue: u.issue as Ref<Issue>,
        identifier: u.identifier,
        title: u.title,
        project: u.project as Ref<Project>,
        submittedHours: u.submittedHours,
        status: 'Submitted',
        approvers: u.approvers as Ref<Employee>[],
        submittedOn
      }
    )
  }

  await client.updateDoc(ygTimesheet.class.TimesheetDay, core.space.Workspace, dayId, {
    approvers: [...new Set(units.flatMap((u) => u.approvers))] as Ref<Employee>[],
    submittedOn,
    totalHours
  })
  return dayId
}
```

Add `Issue`, `Project` to the `@hcengineering/tracker` type imports at the top of the file if not
already present.

- [ ] **Step 2: Add the approve/reject helpers**

Append to `plugins/yg-timesheet-resources/src/utils/day.ts`:

```ts
/**
 * Approve ONE task with the approver's agreed hours. The server trigger stamps approvedBy /
 * approvedOn — do NOT set them here (same division of labour as the day-level flow).
 * Never touches the employee's TimeSpendReport: their logged time stays their record.
 */
export async function approveTask (
  client: TxOperations, taskId: Ref<TimesheetTask>, approvedHours: number
): Promise<void> {
  await client.updateDoc(ygTimesheet.class.TimesheetTask, core.space.Workspace, taskId, {
    status: 'Approved',
    approvedHours,
    $unset: { rejectReason: '' }
  })
}

/** Reject ONE task with a required reason; it returns to Draft for the employee to fix. */
export async function rejectTask (
  client: TxOperations, taskId: Ref<TimesheetTask>, reason: string
): Promise<void> {
  await client.updateDoc(ygTimesheet.class.TimesheetTask, core.space.Workspace, taskId, {
    status: 'Rejected',
    rejectReason: reason,
    $unset: { approvedHours: '', approvedBy: '', approvedOn: '' }
  })
}
```

Import `TimesheetTask` from `@hcengineering/yg-timesheet` at the top of the file.

- [ ] **Step 3: Build and run the suite**

```bash
cd plugins/yg-timesheet-resources
node ../../common/scripts/install-run-rushx.js build
node ../../common/scripts/install-run-rushx.js test
```

Expected: build succeeds; 101 tests pass (89 + 12 from Task 1).

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/day.ts
git commit -m "yg-timesheet: submit creates per-task records; add approveTask/rejectTask"
```

---

### Task 4: Migration — derive tasks for existing days

**Files:**
- Modify: `models/yg-timesheet/src/migration.ts`

**Interfaces:**
- Consumes: `ygTimesheet.class.TimesheetTask` (Task 2).

- [ ] **Step 1: Write the migration**

In `models/yg-timesheet/src/migration.ts`, add this function and call it from the existing
`ygTimesheetOperation` migrate step, after the other migrations:

```ts
// Per-task approval (2026-07-23): existing TimesheetDay rows carry a single status and a
// snapshot of their lines. Derive one TimesheetTask per snapshot line so history survives.
// Days with no snapshot yield no tasks and therefore read as Draft — accepted.
async function migrateDaysToTasks (client: MigrationClient): Promise<void> {
  const days = await client.find<TimesheetDay>(DOMAIN_YG_TIMESHEET, {
    _class: ygTimesheet.class.TimesheetDay
  })
  for (const day of days) {
    const already = await client.find(DOMAIN_YG_TIMESHEET, {
      _class: ygTimesheet.class.TimesheetTask,
      attachedTo: day._id
    })
    if (already.length > 0) continue // idempotent — safe to re-run
    for (const line of day.snapshot ?? []) {
      await client.create(DOMAIN_YG_TIMESHEET, {
        _class: ygTimesheet.class.TimesheetTask,
        space: core.space.Workspace,
        attachedTo: day._id,
        attachedToClass: ygTimesheet.class.TimesheetDay,
        collection: 'tasks',
        modifiedBy: day.modifiedBy,
        modifiedOn: day.modifiedOn,
        date: day.date,
        issue: line.issue,
        identifier: line.identifier,
        title: line.title,
        project: line.project,
        submittedHours: line.hours,
        status: day.status,
        approvers: day.approvers,
        submittedOn: day.submittedOn,
        // Carry the day's sign-off down to each line so approved history is not lost. Approved
        // hours default to what was submitted — nobody re-judged these retrospectively.
        ...(day.status === 'Approved'
          ? { approvedHours: line.hours, approvedBy: day.approvedBy, approvedOn: day.approvedOn }
          : {}),
        ...(day.rejectReason != null ? { rejectReason: day.rejectReason } : {})
      })
    }
  }
}
```

Import `DOMAIN_YG_TIMESHEET` and the `TimesheetDay` type in this file if not already imported.

- [ ] **Step 2: Build**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-timesheet
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add models/yg-timesheet/src/migration.ts
git commit -m "yg-timesheet: migrate existing TimesheetDay snapshots into per-task records"
```

---

### Task 5: Server-side authorization for task approvals

The UI must not be the only thing stopping TL-A from approving TL-B's task. This mirrors the
existing `OnTimesheetDayUpdate` compensating-revert pattern.

**Files:**
- Modify: `server-plugins/yg-timesheet-resources/src/index.ts`
- Modify: `server-plugins/yg-timesheet/src/index.ts`
- Modify: `models/server-yg-timesheet/src/index.ts`

**Interfaces:**
- Produces: `OnTimesheetTaskUpdate` trigger.

- [ ] **Step 1: Write the trigger**

Append to `server-plugins/yg-timesheet-resources/src/index.ts`:

```ts
//
// Per-task approval authorization. The client is trusted to PROPOSE an approval; the server
// decides whether it stands. Reverts any approve/reject written by someone who is not an approver
// of THAT task, and stamps approvedBy/approvedOn authoritatively so they cannot be forged.
//
export async function OnTimesheetTaskUpdate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    // Our own compensating writes are System-authored — skip so they never re-enter.
    if (tx.modifiedBy === core.account.System) continue

    const utx = tx as TxUpdateDoc<TimesheetTask>
    if (utx.objectClass !== ygTimesheet.class.TimesheetTask) continue

    const ops = utx.operations as Record<string, any>
    if (ops.status !== 'Approved' && ops.status !== 'Rejected') continue

    const task = (
      await control.findAll(control.ctx, ygTimesheet.class.TimesheetTask, { _id: utx.objectId }, { limit: 1 })
    )[0]
    if (task === undefined) continue

    const day = (
      await control.findAll(control.ctx, ygTimesheet.class.TimesheetDay, { _id: task.attachedTo }, { limit: 1 })
    )[0]
    const sheet = day === undefined
      ? undefined
      : (await control.findAll(control.ctx, ygTimesheet.class.Timesheet, { _id: day.attachedTo }, { limit: 1 }))[0]

    const actor = await getEmployee(control, tx.modifiedBy)
    const actorId = actor?._id
    const isOwner = task.approvers.includes(actorId as Ref<Employee>)
    const isSelf = actorId !== undefined && sheet?.employee === actorId

    if (isSelf || !isOwner) {
      // Not an approver of THIS task (or approving their own work) — revert to Submitted.
      const revert = control.txFactory.createTxUpdateDoc(
        task._class, task.space, task._id,
        { status: 'Submitted', $unset: { approvedHours: '', approvedBy: '', approvedOn: '', rejectReason: '' } } as any,
        false, Date.now(), core.account.System
      )
      await control.apply(control.ctx, [revert])
      continue
    }

    if (ops.status === 'Approved' && actorId !== undefined) {
      const stamp = control.txFactory.createTxUpdateDoc(
        task._class, task.space, task._id,
        { approvedBy: actorId, approvedOn: Date.now() } as any,
        false, Date.now(), core.account.System
      )
      await control.apply(control.ctx, [stamp])
    }
  }
  return []
}
```

Add `TimesheetTask` to the `@hcengineering/yg-timesheet` type import at the top of the file, and
add `OnTimesheetTaskUpdate` to the default export's `trigger` object.

- [ ] **Step 2: Declare and register the trigger**

In `server-plugins/yg-timesheet/src/index.ts`, add to the `trigger` block:

```ts
    OnTimesheetTaskUpdate: '' as Resource<TriggerFunc>
```

In `models/server-yg-timesheet/src/index.ts`, add:

```ts
  // Per-task approval authorization: reverts an approve/reject by anyone who is not an approver
  // of that specific task, and stamps approvedBy/approvedOn authoritatively.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnTimesheetTaskUpdate,
    isAsync: true,
    txMatch: { _class: core.class.TxUpdateDoc, objectClass: ygTimesheet.class.TimesheetTask }
  })
```

- [ ] **Step 3: Build**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/model-server-yg-timesheet --to @hcengineering/server-yg-timesheet-resources
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add server-plugins/yg-timesheet-resources/src/index.ts server-plugins/yg-timesheet/src/index.ts \
        models/server-yg-timesheet/src/index.ts
git commit -m "yg-timesheet: server-side per-task approval authorization + authoritative stamps"
```

---

### Task 6: Approve / reject popups

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/ApproveTaskPopup.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/RejectTaskPopup.svelte`
- Modify: `plugins/yg-timesheet-resources/src/index.ts` (register both)

**Interfaces:**
- Produces: two dialogs. Approve dispatches `close` with `{ approvedHours: number }` or
  `undefined`; Reject dispatches `close` with `{ reason: string }` or `undefined`.

- [ ] **Step 1: Write the approve popup**

Create `plugins/yg-timesheet-resources/src/components/ApproveTaskPopup.svelte`:

```svelte
<script lang="ts">
  //
  // Approve one task, confirming the hours the approver actually agrees to. Defaults to the
  // submitted hours so the common case (agree as logged) is a single click. Reducing this does
  // NOT rewrite the employee's logged time — it is the approver's overlay.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Button, Label, EditBox } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  export let identifier: string
  export let title: string
  export let submittedHours: number

  const dispatch = createEventDispatcher()
  let hours: number = submittedHours

  $: valid = Number.isFinite(hours) && hours >= 0
</script>

<div class="approve-popup">
  <div class="title">{identifier} — {title}</div>
  <div class="row">
    <span class="lbl"><Label label={ygTimesheet.string.SubmittedHours} /></span>
    <span>{submittedHours}</span>
  </div>
  <div class="row">
    <span class="lbl"><Label label={ygTimesheet.string.ApprovedHours} /></span>
    <EditBox bind:value={hours} format={'number'} />
  </div>
  <div class="row actions">
    <Button label={ui.string.Cancel} on:click={() => dispatch('close', undefined)} />
    <Button
      kind="primary"
      label={ygTimesheet.string.ApproveTask}
      disabled={!valid}
      on:click={() => dispatch('close', { approvedHours: hours })}
    />
  </div>
</div>

<style lang="scss">
  .approve-popup {
    display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; min-width: 22rem;
    background: var(--theme-popup-color); border-radius: 0.75rem;
  }
  .title { font-weight: 500; }
  .row { display: flex; align-items: center; gap: 0.75rem; }
  .lbl { min-width: 9rem; color: var(--theme-dark-color); }
  .actions { justify-content: flex-end; }
</style>
```

- [ ] **Step 2: Write the reject popup**

Create `plugins/yg-timesheet-resources/src/components/RejectTaskPopup.svelte`:

```svelte
<script lang="ts">
  //
  // Reject one task with a REQUIRED reason — the employee needs to know what to fix. Only this
  // task returns to Draft; sibling tasks already approved by another lead are untouched.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Button, Label, EditBox } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  export let identifier: string
  export let title: string

  const dispatch = createEventDispatcher()
  let reason: string = ''

  $: valid = reason.trim().length > 0
</script>

<div class="reject-popup">
  <div class="title">{identifier} — {title}</div>
  <div class="row">
    <span class="lbl"><Label label={ygTimesheet.string.RejectReason} /></span>
    <EditBox bind:value={reason} placeholder={ygTimesheet.string.RejectReason} />
  </div>
  <div class="row actions">
    <Button label={ui.string.Cancel} on:click={() => dispatch('close', undefined)} />
    <Button
      kind="dangerous"
      label={ygTimesheet.string.RejectTask}
      disabled={!valid}
      on:click={() => dispatch('close', { reason: reason.trim() })}
    />
  </div>
</div>

<style lang="scss">
  .reject-popup {
    display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; min-width: 24rem;
    background: var(--theme-popup-color); border-radius: 0.75rem;
  }
  .title { font-weight: 500; }
  .row { display: flex; align-items: center; gap: 0.75rem; }
  .lbl { min-width: 5rem; color: var(--theme-dark-color); }
  .actions { justify-content: flex-end; }
</style>
```

- [ ] **Step 3: Register both components**

In `plugins/yg-timesheet-resources/src/index.ts`, add the imports and add both to the `component`
object of the default export:

```ts
import ApproveTaskPopup from './components/ApproveTaskPopup.svelte'
import RejectTaskPopup from './components/RejectTaskPopup.svelte'
```

```ts
    ApproveTaskPopup,
    RejectTaskPopup,
```

- [ ] **Step 4: Build + svelte-check**

```bash
cd plugins/yg-timesheet-resources
node ../../common/scripts/install-run-rushx.js build
node ../../common/scripts/install-run-rushx.js svelte-check
```

Expected: build succeeds; no `svelte-check` error naming `ApproveTaskPopup.svelte` or
`RejectTaskPopup.svelte` (the 3 + 21 baseline errors are pre-existing and not yours).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/ApproveTaskPopup.svelte \
        plugins/yg-timesheet-resources/src/components/RejectTaskPopup.svelte \
        plugins/yg-timesheet-resources/src/index.ts
git commit -m "yg-timesheet: approve (with hours) and reject (with reason) task popups"
```

---

### Task 7: Approvals queue over tasks

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Approvals.svelte`

**Interfaces:**
- Consumes: `approveTask`, `rejectTask` (Task 3); `ApproveTaskPopup`, `RejectTaskPopup` (Task 6).

- [ ] **Step 1: Repoint the queue at `TimesheetTask`**

In `plugins/yg-timesheet-resources/src/components/Approvals.svelte`, replace the day query

```ts
    { space: core.space.Workspace, status: 'Submitted', approvers: me },
```

with a task query. The whole point: this returns only tasks **I** may action, never a whole day
belonging to another lead.

```ts
  // Submitted TASKS routed to me. Each row is one issue on one day; I only ever see tasks whose
  // project I lead, so approving TL-B's work is not merely hidden — it is unreachable.
  const query = createQuery()
  let tasks: TimesheetTask[] = []
  query.query(
    ygTimesheet.class.TimesheetTask,
    { space: core.space.Workspace, status: 'Submitted', approvers: me },
    (res) => { tasks = res },
    { sort: { date: 1, identifier: 1 } }
  )
```

Import `TimesheetTask` from `@hcengineering/yg-timesheet`.

- [ ] **Step 2: Wire the per-row actions**

Each row shows the employee, date, `identifier`, `title`, and `submittedHours`, with Approve and
Reject buttons:

```ts
  import { showPopup } from '@hcengineering/ui'
  import ApproveTaskPopup from './ApproveTaskPopup.svelte'
  import RejectTaskPopup from './RejectTaskPopup.svelte'
  import { approveTask, rejectTask } from '../utils/day'

  function onApprove (t: TimesheetTask): void {
    showPopup(
      ApproveTaskPopup,
      { identifier: t.identifier, title: t.title, submittedHours: t.submittedHours },
      undefined,
      (res?: { approvedHours: number }) => {
        if (res !== undefined) void approveTask(client, t._id, res.approvedHours)
      }
    )
  }

  function onReject (t: TimesheetTask): void {
    showPopup(
      RejectTaskPopup,
      { identifier: t.identifier, title: t.title },
      undefined,
      (res?: { reason: string }) => {
        if (res !== undefined) void rejectTask(client, t._id, res.reason)
      }
    )
  }
```

Remove the old day-level approve/reject and approve-week handlers, and the `$lookup` on the parent
`Timesheet` that fed them. To show the employee name per row, resolve it from the task's parent day
→ timesheet the same way the file already resolves employees elsewhere.

- [ ] **Step 3: Build + svelte-check + tests**

```bash
cd plugins/yg-timesheet-resources
node ../../common/scripts/install-run-rushx.js build
node ../../common/scripts/install-run-rushx.js svelte-check
node ../../common/scripts/install-run-rushx.js test
```

Expected: build succeeds; no new `svelte-check` error naming `Approvals.svelte` beyond the known
`$lookup` baseline (which this task may legitimately remove — fewer baseline errors is fine, more
is not); 101 tests pass.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/Approvals.svelte
git commit -m "yg-timesheet: Approvals queue is per-task, scoped to the tasks I may action"
```

---

### Task 8: Derived day status across the surfaces

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Timesheet.svelte`
- Modify: `plugins/yg-timesheet-resources/src/components/HrTimesheet.svelte`
- Modify: `plugins/yg-timesheet-resources/src/components/HrOverview.svelte`

**Interfaces:**
- Consumes: `deriveDayStatus`, `type DerivedDayStatus` from `../utils/task-approval`.

- [ ] **Step 1: Derive the label instead of reading `day.status`**

In each of the three components, query the day's `TimesheetTask` rows and compute the label rather
than reading the deprecated `TimesheetDay.status`:

```ts
  import { deriveDayStatus, type DerivedDayStatus } from '../utils/task-approval'

  // The day's status is derived from its tasks — never stored, never queried (see the spec).
  function dayStatusOf (dayTasks: TimesheetTask[]): DerivedDayStatus {
    return deriveDayStatus(dayTasks.map((t) => t.status))
  }
```

- [ ] **Step 2: Render `PartiallyApproved`**

Wherever a status label or colour is chosen, add the new case. Use
`ygTimesheet.string.PartiallyApproved` for the label and an amber treatment, distinct from both
Approved (green) and Submitted (neutral) — a half-approved day must not look like an untouched one:

```svelte
{#if status === 'PartiallyApproved'}
  <span class="status partial"><Label label={ygTimesheet.string.PartiallyApproved} /></span>
{/if}
```

```scss
  .status.partial { color: var(--theme-warning-color); }
```

In `Timesheet.svelte`, additionally show each task's own status and, when rejected, its
`rejectReason` — the employee must be able to see which task to fix and why.

- [ ] **Step 3: Build + svelte-check**

```bash
cd plugins/yg-timesheet-resources
node ../../common/scripts/install-run-rushx.js build
node ../../common/scripts/install-run-rushx.js svelte-check
```

Expected: build succeeds; no new error naming these three files.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/Timesheet.svelte \
        plugins/yg-timesheet-resources/src/components/HrTimesheet.svelte \
        plugins/yg-timesheet-resources/src/components/HrOverview.svelte
git commit -m "yg-timesheet: derive day status from tasks, render Partially approved"
```

---

### Task 9: PM report — the TL/PM approval columns stop being manual

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/reports.ts`
- Modify: `plugins/yg-timesheet-resources/src/__tests__/reports.test.ts`
- Modify: `plugins/yg-timesheet-resources/src/components/Reports.svelte`

**Interfaces:**
- Produces: `ReportRow` gains `approvedHours?: number` and `approvedByName?: string`.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/yg-timesheet-resources/src/__tests__/reports.test.ts`:

```ts
test('CSV fills TL/PM approved hours and approver when the task was approved', () => {
  const rows = [{ ...baseRow, hours: 2, approvedHours: 1, approvedByName: 'Tina Lead' }]
  const line = toCSV(rows as any).split('\n')[1]
  expect(line).toContain('1')
  expect(line).toContain('"Tina Lead"')
})

test('CSV leaves the approval columns blank when not yet approved', () => {
  const line = toCSV([baseRow] as any).split('\n')[1]
  // The four placeholder columns sit between Spent and Status; unapproved rows keep two blank.
  expect(line).toContain(',,')
})

test('client approval columns stay blank — that process is out of scope', () => {
  const rows = [{ ...baseRow, approvedHours: 1, approvedByName: 'Tina Lead' }]
  const cells = toCSV(rows as any).split('\n')[1].split(',')
  expect(cells[9]).toBe('')
  expect(cells[10]).toBe('')
})
```

Reuse the `baseRow` fixture already defined in that file; if it is named differently, use the
existing fixture rather than creating a second one.

- [ ] **Step 2: Run — verify they fail**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- reports
```

Expected: FAIL — the approval cells are still hardcoded empty.

- [ ] **Step 3: Fill the two columns**

In `plugins/yg-timesheet-resources/src/utils/reports.ts`, add the two optional fields to
`ReportRow`:

```ts
  approvedHours?: number
  approvedByName?: string
```

and in `toCSV`, replace the first two blank placeholders:

```ts
    '', // TL/PM Approved Hours — manual
    '', // TL/PM Approved By — manual
```

with:

```ts
    r.approvedHours != null ? String(r.approvedHours) : '', // TL/PM Approved Hours (from approval)
    r.approvedByName != null ? escText(r.approvedByName) : '', // TL/PM Approved By (from approval)
```

Leave the two Client columns exactly as they are — client sign-off is a separate process and is
explicitly out of scope. Update the comment block above `COLS` to say the first pair is now
data-driven and only the client pair remains manual.

- [ ] **Step 4: Populate the fields where rows are built**

In `plugins/yg-timesheet-resources/src/components/Reports.svelte`, query the approved tasks for the
reporting window and index them by issue+date, then set the two fields while assembling each
`ReportRow`. Key on `issue + localDayKey(date)` because a task is one issue per day:

```ts
  import { localDayKey } from '../utils/week'

  const taskQuery = createQuery()
  let approvedByKey = new Map<string, TimesheetTask>()
  taskQuery.query(
    ygTimesheet.class.TimesheetTask,
    { space: core.space.Workspace, status: 'Approved' },
    (res) => {
      const m = new Map<string, TimesheetTask>()
      for (const t of res) m.set(`${t.issue}|${localDayKey(t.date)}`, t)
      approvedByKey = m
    }
  )

  // ...while building each ReportRow:
  const approved = approvedByKey.get(`${r.issueId}|${localDayKey(r.date)}`)
  const row: ReportRow = {
    ...base,
    approvedHours: approved?.approvedHours,
    approvedByName: approved?.approvedBy != null ? employeeName(approved.approvedBy) : undefined
  }
```

Use the file's existing employee-name resolution for `employeeName`; if it resolves names by a
different helper, use that one rather than adding a second lookup path.

- [ ] **Step 5: Run tests + svelte-check**

```bash
cd plugins/yg-timesheet-resources
node ../../common/scripts/install-run-rushx.js test
node ../../common/scripts/install-run-rushx.js svelte-check
```

Expected: all tests pass (101 + 3 new); no new error naming `Reports.svelte`.

- [ ] **Step 6: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/reports.ts \
        plugins/yg-timesheet-resources/src/__tests__/reports.test.ts \
        plugins/yg-timesheet-resources/src/components/Reports.svelte
git commit -m "yg-timesheet: PM report exports real TL/PM approved hours + approver"
```

---

### Task 10: Local end-to-end

This touches the model, a migration and a server trigger, so **all four images** must be rebuilt —
not front only.

- [ ] **Step 1: Rebuild all 4 images + redeploy**

```bash
# Stop the stack first — the webpack build needs ~4GB on a ~9GB box.
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -f compose.yml -f compose.override.beta.yml stop

cd /home/karthi_0008/dev/client-projects/yg-huly
source ~/.nvm/nvm.sh && nvm use 22
(cd dev/prod && NODE_OPTIONS=--max-old-space-size=4096 node ../../common/scripts/install-run-rushx.js package)
(cd pods/front && node ../../common/scripts/install-run-rushx.js bundle && node ../../common/scripts/install-run-rushx.js package && docker build -t yg-local/front:beta .)
(cd pods/workspace && node ../../common/scripts/install-run-rushx.js bundle && docker build -t yg-local/workspace:beta .)
(cd pods/server && node ../../common/scripts/install-run-rushx.js bundle && docker build -t yg-local/transactor:beta .)
(cd dev/tool && node ../../common/scripts/install-run-rushx.js bundle && docker build -t yg-local/tool:beta .)

cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -f compose.yml -f compose.override.beta.yml up -d
docker compose -f compose.yml -f compose.override.beta.yml up -d --force-recreate front workspace transactor
./run-tool-beta.sh upgrade-workspace testws
```

- [ ] **Step 2: Fixture**

Workspace `testws`, `http://localhost:8087/`. Login is **OTP-only** (no SMTP locally) — request the
code in the UI, then read it immediately (it expires in 60s):

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
U=$(grep -E "^CR_DB_URL" huly_v7.conf | cut -d= -f2-)"?sslmode=disable"
docker compose -f compose.yml -f compose.override.beta.yml exec -T cockroach \
  ./cockroach sql --url "$U" -e "SELECT code FROM global_account.otp ORDER BY created_on DESC LIMIT 1;"
```

Build the two-project fixture this feature exists for: **Proj-1** with Team Lead **TL-A**, **Proj-2**
with Team Lead **TL-B** (set via the ProjectApprovers editor), and one employee **K2** who logs
**3h on a Proj-1 issue and 5h on a Proj-2 issue on the same date**, then submits that day.

- [ ] **Step 3: Verify (the gates)**

- (a) **The defect is closed.** As **TL-A**, the Approvals queue shows **only** the Proj-1 task —
  the Proj-2 task is absent. As **TL-B**, only the Proj-2 task.
- (b) **Server enforcement.** Not just UI: confirm the Proj-2 task's approvers array does not
  contain TL-A, and that a direct approval written as TL-A reverts to `Submitted`
  (`OnTimesheetTaskUpdate`).
- (c) **Approved hours.** TL-A approves the 3h task entering **2** as approved hours. The task
  records `approvedHours = 2`, `approvedBy = TL-A`; **K2's own timesheet still shows 3h logged**.
- (d) **Partially approved.** With Proj-1 approved and Proj-2 still submitted, the day renders
  **Partially approved** for K2 and in the HR grid — visibly different from both Approved and
  Submitted.
- (e) **Per-task rejection.** TL-B rejects the Proj-2 task with a reason. Only that task moves to
  `Rejected` with the reason visible to K2, and K2 can edit and re-submit it; TL-A's approved task
  is untouched throughout.
- (e2) **Drift is flagged, not locked.** After TL-A approves, K2 edits the logged time on that
  issue. The edit is permitted, and the task shows drift rather than blocking the change.
- (f) **PM report.** Export the PM report: the approved row carries `TL/PM Approved Hours = 2` and
  `TL/PM Approved By = TL-A`; the client columns remain blank.
- (g) **Migration.** A `TimesheetDay` that was Approved before the upgrade now has task rows
  carrying that status, with `approvedHours` equal to the submitted hours and the original
  `approvedBy`.

- [ ] **Step 4: Record the results**

Append a `## Per-task approval — <date>` section to `.superpowers/sdd/hr-timesheet-integration.md`
stating which gates passed, with any findings. Report failures honestly rather than narrowing a
gate to make it pass.

---

## Verification Summary

| Layer | Command | Expected |
|---|---|---|
| Unit | `rushx test` in `yg-timesheet-resources` | 89 existing + 12 (Task 1) + 3 (Task 9) pass |
| Types | `rushx svelte-check` | No new errors vs the 3 + 21 known baseline |
| Build | `rush build --to @hcengineering/model-yg-timesheet` etc. | Succeeds |
| E2E | Task 10 gates (a)–(g) | All pass |
