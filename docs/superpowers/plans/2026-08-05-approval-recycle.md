# Approval Re-Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the reject/resubmit cycle a durable history so the approver sees why a task was rejected last round and what the employee replied, the employee sees every reason on the right task row, and the buttons read Resubmit / Reapprove on the second pass. Covers backlog items 2, 3 and 4.

**Architecture:** A new `TimesheetRejectCycle` doc records one reject/resubmit round, keyed by `employee + issue + date` rather than by task ref, because `submitDay` deletes and recreates task rows on every resubmit and a task ref would orphan the history. `rejectTask` creates a cycle; `submitDay` closes it with the employee's optional reply. Pure grouping and ordering logic lives in a unit-tested `utils/reject-cycle.ts`; both screens read cycles through it. A migration backfills one cycle per pre-existing rejected task.

**Tech Stack:** TypeScript, Huly platform (rush + pnpm workspace), Svelte 3, jest + ts-jest, CockroachDB-backed domain tables.

**Spec:** `docs/superpowers/specs/2026-08-05-approval-recycle-design.md`

## Global Constraints

- **Repo / branch:** `youngglobes/yg-huly`, branch `yg_beta`. NEVER merge to `yg_develop` (auto-deploys) as part of this work. Local build and verify only.
- **Version pin:** all `@hcengineering/*` workspace deps use `workspace:^0.7.426`.
- **No em-dashes** in code comments, commit messages, or UI copy (the team reads them as an AI tell).
- **i18n convention:** new keys are added to `en.json` only. Untranslated `ru.json` keys fall back to English on purpose; do not treat missing Russian strings as errors.
- **Cycle records are world-readable.** They live in `core.space.Workspace`, matching where `rejectReason` already sits on `TimesheetTask`. This is a deliberate choice recorded in the spec, not an oversight.
- **Write ordering is load-bearing.** `rejectTask` updates the task FIRST, then creates the cycle. A missing history entry degrades to today's behaviour and is repairable by the backfill; a cycle asserting a rejection that never happened would be a false entry in an audit trail.
- **`submitDay` deletes nothing new.** The remove-and-recreate at `utils/day.ts:121-128` and its invariant that `Approved` siblings are preserved must remain exactly as they are.
- **Model change:** this adds a model class and a migration, so deployment is the full 4-image build plus `upgrade-workspace yg`, not a front-only build.

---

## File Structure

| File | Package | Responsibility |
|---|---|---|
| `plugins/yg-timesheet/src/index.ts` | yg-timesheet (ids) | **Modify.** `TimesheetRejectCycle` interface, class id, two new IntlStrings. |
| `models/yg-timesheet/src/index.ts` | model-yg-timesheet | **Modify.** `TTimesheetRejectCycle` model class. |
| `plugins/yg-timesheet-resources/src/utils/reject-cycle.ts` | yg-timesheet-resources | **New.** Pure grouping / ordering / open-closed logic. |
| `plugins/yg-timesheet-resources/src/utils/__tests__/reject-cycle.test.ts` | yg-timesheet-resources | **New.** Unit tests for the above. |
| `plugins/yg-timesheet-resources/src/utils/day.ts` | yg-timesheet-resources | **Modify.** `rejectTask` creates a cycle; `submitDay` closes cycles. |
| `plugins/yg-timesheet-resources/src/components/ResubmitDayPopup.svelte` | yg-timesheet-resources | **New.** Per-task reply dialog shown before a resubmit. |
| `plugins/yg-timesheet-resources/src/components/Timesheet.svelte` | yg-timesheet-resources | **Modify.** Resubmit branch + label, per-task reason with expandable history. |
| `plugins/yg-timesheet-resources/src/components/Approvals.svelte` | yg-timesheet-resources | **Modify.** Cycles query, prior-rejection line, Reapprove label. |
| `plugins/yg-timesheet-resources/src/components/ApproveTaskPopup.svelte` | yg-timesheet-resources | **Modify.** Title reads "Reapprove task" when the task has history. |
| `plugins/yg-timesheet-assets/lang/en.json` | yg-timesheet-assets | **Modify.** `Resubmit`, `Reapprove`. |
| `models/yg-timesheet/src/migration.ts` | model-yg-timesheet | **Modify.** `reject-cycle-backfill-0001` state. |

---

## Task 1: The `TimesheetRejectCycle` class

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts`
- Modify: `models/yg-timesheet/src/index.ts`

**Interfaces:**
- Produces: `TimesheetRejectCycle` interface and `ygTimesheet.class.TimesheetRejectCycle` id, consumed by every later task.

- [ ] **Step 1: Add the interface**

In `plugins/yg-timesheet/src/index.ts`, add immediately after the `TimesheetApproval` interface (which ends with its closing brace before `export interface ProjectApprovers`):

```ts
/**
 * One reject/resubmit round for a single (employee, issue, date) unit of work.
 *
 * Deliberately NOT keyed by Ref<TimesheetTask>: submitDay deletes and recreates task rows on every
 * resubmit (yg-timesheet-resources utils/day.ts), so a task ref would orphan the history. The
 * employee+issue+date triple is stable across that churn, which is the whole reason this is a
 * separate doc rather than an array on the task.
 *
 * World-readable (core.space.Workspace), matching where rejectReason already lives on
 * TimesheetTask. Deliberate, see the 2026-08-05 approval-recycle design.
 */
export interface TimesheetRejectCycle extends Doc {
  employee: Ref<Employee>
  issue: Ref<Issue>
  /** Local midnight, same convention as TimesheetTask.date. */
  date: Timestamp
  rejectReason: string
  /** Absent on rows written by the backfill: the old task never stored who rejected it. */
  rejectedBy?: Ref<Employee>
  rejectedOn: Timestamp
  /** The employee's reply, captured at resubmit. Optional by design. */
  resubmitNote?: string
  /** Absent = the cycle is still open (rejected, not yet resubmitted). */
  resubmittedOn?: Timestamp
}
```

- [ ] **Step 2: Register the class id**

In the same file, in the `class:` map of the `plugin(...)` call, add after the `TimesheetApproval` line (add a comma to it):

```ts
    TimesheetApproval: '' as Ref<Class<TimesheetApproval>>,
    TimesheetRejectCycle: '' as Ref<Class<TimesheetRejectCycle>>,
```

- [ ] **Step 3: Add the model class**

In `models/yg-timesheet/src/index.ts`, add `type TimesheetRejectCycle` to the type import block from `@hcengineering/yg-timesheet` (keep it alphabetical, it goes immediately after `type TimesheetLine`):

```ts
  type TimesheetLine,
  type TimesheetRejectCycle,
  type TimesheetTask,
```

Then add this model class immediately after `TTimesheetApproval` (which ends at the closing brace before the next `@Model`):

```ts
@Model(ygTimesheet.class.TimesheetRejectCycle, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TTimesheetRejectCycle extends TDoc implements TimesheetRejectCycle {
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) employee!: Ref<Employee>
  @Prop(TypeRef(tracker.class.Issue), core.string.Object) issue!: Ref<Issue>
  @Prop(TypeDate(), core.string.Object) date!: Timestamp
  @Prop(TypeString(), core.string.Object) rejectReason!: string
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) rejectedBy?: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) rejectedOn!: Timestamp
  @Prop(TypeString(), core.string.Object) resubmitNote?: string
  @Prop(TypeDate(), core.string.Object) resubmittedOn?: Timestamp
}
```

- [ ] **Step 4: Add it to the model builder**

In the same file, find the `createModel` function's `builder.createModel(...)` call listing the `T*` classes (it lists `TTimesheet`, `TTimesheetDay`, `TTimesheetTask`, `TTimesheetApproval`, and so on). Add `TTimesheetRejectCycle` to that list, immediately after `TTimesheetApproval`.

- [ ] **Step 5: Build both packages**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet && node ../../common/scripts/install-run-rushx.js build
cd /home/karthi_0008/dev/client-projects/yg-huly/models/yg-timesheet && node ../../common/scripts/install-run-rushx.js build
```
Expected: both PASS, tsc emits with no type errors.

- [ ] **Step 6: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet/src/index.ts models/yg-timesheet/src/index.ts
git commit -m "feat(reject-cycle): TimesheetRejectCycle class for durable rejection history"
```

---

## Task 2: Pure cycle helpers + unit tests

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/reject-cycle.ts`
- Create: `plugins/yg-timesheet-resources/src/utils/__tests__/reject-cycle.test.ts`

**Interfaces:**
- Produces, all consumed by Tasks 4, 6 and 7:
  - `cycleKey(employee: string, issue: string, date: number): string`
  - `groupCycles<T extends RejectCycleLike>(cycles: T[]): Map<string, T[]>`: grouped by key, each list sorted by `rejectedOn` ascending (round order)
  - `isOpen(c: RejectCycleLike): boolean`
  - `openCycle<T extends RejectCycleLike>(list: T[]): T | undefined`
  - `closedCycles<T extends RejectCycleLike>(list: T[]): T[]`
  - `cyclesToClose<T extends RejectCycleLike>(cycles: T[], issues: Set<string>): T[]`

The package already has jest wired (`jest.config.js`, ten existing test files). No new test infrastructure.

- [ ] **Step 1: Write the failing test**

Create `plugins/yg-timesheet-resources/src/utils/__tests__/reject-cycle.test.ts`:

```ts
import {
  cycleKey,
  groupCycles,
  isOpen,
  openCycle,
  closedCycles,
  cyclesToClose,
  type RejectCycleLike
} from '../reject-cycle'

const DAY = new Date(2026, 7, 5).getTime()

function cyc (over: Partial<RejectCycleLike> = {}): RejectCycleLike {
  return {
    employee: 'emp-1',
    issue: 'YG-98',
    date: DAY,
    rejectReason: 'too high',
    rejectedOn: 1000,
    ...over
  }
}

test('cycleKey joins the triple and separates distinct units', () => {
  expect(cycleKey('emp-1', 'YG-98', DAY)).toBe(cycleKey('emp-1', 'YG-98', DAY))
  expect(cycleKey('emp-1', 'YG-98', DAY)).not.toBe(cycleKey('emp-2', 'YG-98', DAY))
  expect(cycleKey('emp-1', 'YG-98', DAY)).not.toBe(cycleKey('emp-1', 'YG-99', DAY))
  expect(cycleKey('emp-1', 'YG-98', DAY)).not.toBe(cycleKey('emp-1', 'YG-98', DAY + 86400000))
})

test('groupCycles buckets by the triple', () => {
  const g = groupCycles([cyc(), cyc({ issue: 'YG-99' }), cyc({ rejectedOn: 2000 })])
  expect(g.size).toBe(2)
  expect(g.get(cycleKey('emp-1', 'YG-98', DAY))).toHaveLength(2)
  expect(g.get(cycleKey('emp-1', 'YG-99', DAY))).toHaveLength(1)
})

test('groupCycles sorts each bucket into round order, oldest first', () => {
  const g = groupCycles([
    cyc({ rejectedOn: 3000, rejectReason: 'third' }),
    cyc({ rejectedOn: 1000, rejectReason: 'first' }),
    cyc({ rejectedOn: 2000, rejectReason: 'second' })
  ])
  const list = g.get(cycleKey('emp-1', 'YG-98', DAY)) ?? []
  expect(list.map((c) => c.rejectReason)).toEqual(['first', 'second', 'third'])
})

test('isOpen is true only while resubmittedOn is absent', () => {
  expect(isOpen(cyc())).toBe(true)
  expect(isOpen(cyc({ resubmittedOn: 5000 }))).toBe(false)
})

test('openCycle returns the one unresubmitted round', () => {
  const list = [cyc({ rejectedOn: 1000, resubmittedOn: 1500 }), cyc({ rejectedOn: 2000 })]
  expect(openCycle(list)?.rejectedOn).toBe(2000)
})

test('openCycle returns undefined when every round is closed', () => {
  expect(openCycle([cyc({ resubmittedOn: 1500 })])).toBeUndefined()
})

test('openCycle returns the latest when several are somehow open', () => {
  // Defensive: a partial-failure write could leave two open. Prefer the newest.
  const list = [cyc({ rejectedOn: 1000 }), cyc({ rejectedOn: 4000 })]
  expect(openCycle(list)?.rejectedOn).toBe(4000)
})

test('closedCycles returns only resubmitted rounds, in round order', () => {
  const list = [
    cyc({ rejectedOn: 1000, resubmittedOn: 1500, rejectReason: 'r1' }),
    cyc({ rejectedOn: 2000, resubmittedOn: 2500, rejectReason: 'r2' }),
    cyc({ rejectedOn: 3000, rejectReason: 'open' })
  ]
  expect(closedCycles(list).map((c) => c.rejectReason)).toEqual(['r1', 'r2'])
})

test('cyclesToClose picks open cycles whose issue is being resubmitted', () => {
  const cycles = [
    cyc({ issue: 'YG-98' }),
    cyc({ issue: 'YG-104' }),
    cyc({ issue: 'YG-200' })
  ]
  const picked = cyclesToClose(cycles, new Set(['YG-98', 'YG-104']))
  expect(picked.map((c) => c.issue).sort()).toEqual(['YG-104', 'YG-98'])
})

test('cyclesToClose skips already-closed cycles', () => {
  const cycles = [cyc({ issue: 'YG-98', resubmittedOn: 9000 }), cyc({ issue: 'YG-104' })]
  expect(cyclesToClose(cycles, new Set(['YG-98', 'YG-104'])).map((c) => c.issue)).toEqual(['YG-104'])
})

test('cyclesToClose skips issues the employee dropped from the day', () => {
  // Rejected, then removed from the day entirely: the cycle stays open on purpose.
  const cycles = [cyc({ issue: 'YG-98' })]
  expect(cyclesToClose(cycles, new Set(['YG-104']))).toEqual([])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- reject-cycle`
Expected: FAIL, cannot find module `../reject-cycle`.

- [ ] **Step 3: Write the helpers**

Create `plugins/yg-timesheet-resources/src/utils/reject-cycle.ts`:

```ts
//
// YoungGlobes: pure logic for the reject/resubmit history (backlog items 2-4).
//
// Cycles are keyed by employee + issue + date, NOT by task ref, because submitDay deletes and
// recreates task rows on every resubmit. Everything here is pure and structurally typed so the
// real TimesheetRejectCycle docs (whose Refs are branded strings) pass straight in.
//

/** Structural shape of a cycle. Ref<T> is a branded string, so real docs satisfy this. */
export interface RejectCycleLike {
  employee: string
  issue: string
  date: number
  rejectReason: string
  rejectedBy?: string
  rejectedOn: number
  resubmitNote?: string
  resubmittedOn?: number
}

/** Stable grouping key for one unit of work. */
export function cycleKey (employee: string, issue: string, date: number): string {
  return `${employee}|${issue}|${date}`
}

/**
 * Bucket cycles by their triple, each bucket sorted oldest-first so the array index IS the round
 * number. Round is derived here rather than stored: a stored counter would drift if a create ever
 * failed, and the only read is "how many rounds" plus their order.
 */
export function groupCycles<T extends RejectCycleLike> (cycles: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const c of cycles) {
    const key = cycleKey(c.employee, c.issue, c.date)
    const list = out.get(key)
    if (list === undefined) out.set(key, [c])
    else list.push(c)
  }
  for (const list of out.values()) list.sort((a, b) => a.rejectedOn - b.rejectedOn)
  return out
}

/** Open = rejected, not yet resubmitted. */
export function isOpen (c: RejectCycleLike): boolean {
  return c.resubmittedOn == null
}

/**
 * The single open round, if any. Normally there is at most one; if a partial write ever left two,
 * prefer the newest so the employee is shown the reason that actually applies now.
 */
export function openCycle<T extends RejectCycleLike> (list: T[]): T | undefined {
  let best: T | undefined
  for (const c of list) {
    if (!isOpen(c)) continue
    if (best === undefined || c.rejectedOn > best.rejectedOn) best = c
  }
  return best
}

/** Completed rounds (rejected then resubmitted), oldest first. */
export function closedCycles<T extends RejectCycleLike> (list: T[]): T[] {
  return list.filter((c) => !isOpen(c)).sort((a, b) => a.rejectedOn - b.rejectedOn)
}

/**
 * Which open cycles a resubmit should close: those whose issue is actually in the day being
 * submitted. An issue the employee dropped from the day is NOT closed - nothing was resubmitted
 * for it, so its cycle stays open on purpose.
 */
export function cyclesToClose<T extends RejectCycleLike> (cycles: T[], issues: Set<string>): T[] {
  return cycles.filter((c) => isOpen(c) && issues.has(c.issue))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- reject-cycle`
Expected: PASS, all 11 tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/utils/reject-cycle.ts \
        plugins/yg-timesheet-resources/src/utils/__tests__/reject-cycle.test.ts
git commit -m "feat(reject-cycle): pure grouping and round-ordering helpers + tests"
```

---

## Task 3: `rejectTask` writes a cycle

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/day.ts` (the `rejectTask` function, currently at line 288)
- Modify: `plugins/yg-timesheet-resources/src/components/Approvals.svelte` (the `onReject` handler at line 167)

**Interfaces:**
- Produces: `rejectTask(client, taskId, reason, employee?)`. The fourth parameter is new and optional.

- [ ] **Step 1: Add the employee resolver**

In `plugins/yg-timesheet-resources/src/utils/day.ts`, add this helper immediately BEFORE the existing `rejectTask` function:

```ts
/**
 * Resolve the employee who owns a task. TimesheetTask has no employee field: it is reachable only
 * via attachedTo -> TimesheetDay -> attachedTo -> Timesheet -> employee. Used when the caller could
 * not supply it (Approvals.svelte's lookup can miss, see its "Unknown" bucket).
 */
async function resolveTaskEmployee (
  client: TxOperations, task: TimesheetTask
): Promise<Ref<Employee> | undefined> {
  const day = await client.findOne(ygTimesheet.class.TimesheetDay, {
    _id: task.attachedTo as Ref<TimesheetDay>
  })
  if (day === undefined) return undefined
  const sheet = await client.findOne(ygTimesheet.class.Timesheet, {
    _id: day.attachedTo as Ref<Timesheet>
  })
  return sheet?.employee
}
```

- [ ] **Step 2: Rewrite `rejectTask`**

In the same file, replace the whole existing `rejectTask` function (its docblock plus body) with:

```ts
/**
 * Reject ONE task with a required reason; it returns to Draft for the employee to fix.
 * A rejected task must not keep an approval record, so any existing TimesheetApproval row for
 * this task (from a prior approval) is removed.
 *
 * Also records a TimesheetRejectCycle so the rejection survives the employee's resubmit (submitDay
 * deletes and recreates task rows, which is why the cycle is keyed by employee+issue+date and not
 * by task ref). ORDER MATTERS: the task update runs FIRST. If the cycle create then fails we get a
 * rejected task with no history, which is exactly the pre-2026-08-05 behaviour and is repairable by
 * the backfill migration. The reverse order could leave a cycle asserting a rejection that never
 * happened, and a false entry in an audit trail is worse than a missing one.
 */
export async function rejectTask (
  client: TxOperations,
  taskId: Ref<TimesheetTask>,
  reason: string,
  employee?: Ref<Employee>
): Promise<void> {
  const task = await client.findOne(ygTimesheet.class.TimesheetTask, { _id: taskId })

  await client.updateDoc(ygTimesheet.class.TimesheetTask, core.space.Workspace, taskId, {
    status: 'Rejected',
    rejectReason: reason
  })

  const existing = await client.findOne(ygTimesheet.class.TimesheetApproval, { task: taskId })
  if (existing !== undefined) {
    await client.remove(existing)
  }

  if (task === undefined) return
  const owner = employee ?? (await resolveTaskEmployee(client, task))
  // No owner means the cycle cannot be keyed. The task is still rejected (the update above already
  // landed); we simply skip the history rather than write a mis-keyed record that would surface in
  // some other employee's history.
  if (owner === undefined) return

  await client.createDoc(ygTimesheet.class.TimesheetRejectCycle, core.space.Workspace, {
    employee: owner,
    issue: task.issue,
    date: task.date,
    rejectReason: reason,
    rejectedBy: getCurrentEmployee(),
    rejectedOn: Date.now()
  })
}
```

- [ ] **Step 3: Pass the employee from the approval screen**

In `plugins/yg-timesheet-resources/src/components/Approvals.svelte`, replace the `onReject` function (line 167) with:

```ts
  function onReject (task: TimesheetTask): void {
    // employeeOf can miss (the "Unknown" group); rejectTask resolves it itself in that case.
    const employee = employeeOf(task)
    showPopup(
      RejectTaskPopup,
      { identifier: task.identifier, title: task.title },
      undefined,
      (res?: { reason: string }) => {
        if (res !== undefined) void rejectTask(client, task._id, res.reason, employee)
      }
    )
  }
```

- [ ] **Step 4: Build the package**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js build`
Expected: PASS, no type errors.

- [ ] **Step 5: Re-run the unit tests**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test`
Expected: PASS, nothing regressed.

- [ ] **Step 6: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/utils/day.ts \
        plugins/yg-timesheet-resources/src/components/Approvals.svelte
git commit -m "feat(reject-cycle): rejectTask records a durable rejection round"
```

---

## Task 4: `submitDay` closes cycles

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/day.ts` (`SubmitArgs` at line 76, `submitDay` at line 97)

**Interfaces:**
- Consumes: `cyclesToClose` from `./reject-cycle` (Task 2).
- Produces: `SubmitArgs.resubmitNotes?: Map<Ref<Issue>, string>`, consumed by Task 5.

- [ ] **Step 1: Import the helper**

In `plugins/yg-timesheet-resources/src/utils/day.ts`, add after the existing `import { buildTaskUnits } from './task-approval'` line:

```ts
import { cyclesToClose } from './reject-cycle'
```

- [ ] **Step 2: Extend `SubmitArgs`**

Replace the existing `SubmitArgs` interface (line 76) with:

```ts
export interface SubmitArgs {
  employee: Ref<Employee>
  date: number
  reports: DayReportLike[]
  approversByProject: Map<string, ProjectApproverLike>
  /**
   * Employee replies keyed by issue, captured by ResubmitDayPopup on a resubmit. Optional: a plain
   * Draft submit passes nothing and the cycle-closing loop below simply finds no open cycles.
   */
  resubmitNotes?: Map<Ref<Issue>, string>
}
```

- [ ] **Step 3: Destructure the new field**

Replace the `submitDay` signature line:

```ts
export async function submitDay (
  client: TxOperations,
  { employee, date, reports, approversByProject }: SubmitArgs
): Promise<Ref<TimesheetDay> | NoApproverResult> {
```

with:

```ts
export async function submitDay (
  client: TxOperations,
  { employee, date, reports, approversByProject, resubmitNotes }: SubmitArgs
): Promise<Ref<TimesheetDay> | NoApproverResult> {
```

- [ ] **Step 4: Close the open cycles**

In `submitDay`, insert this block immediately BEFORE the closing `return dayId` (that is, after the existing `await client.updateDoc(ygTimesheet.class.TimesheetDay, ...)` call that sets approvers/submittedOn/totalHours):

```ts
  // Close any open reject cycles for the issues actually being resubmitted, stamping the employee's
  // reply. Runs AFTER the task rows are written: if this fails, the resubmitted task still reaches
  // the approver's queue and the stale-open cycle reads as "waiting on employee", which is visibly
  // wrong rather than quietly wrong. Nothing here deletes; the remove-and-recreate above is untouched.
  //
  // resubmittedOn is stamped whether or not a note was given - the resubmit closes the round either
  // way. resubmitNote is only written when the reply is non-blank.
  const submittedIssues = new Set<string>(units.map((u) => u.issue))
  // Filter open-ness in code rather than querying it: keeps the query to plain equality matches.
  const dayCycles = await client.findAll(ygTimesheet.class.TimesheetRejectCycle, { employee, date })
  const resubmittedOn = Date.now()
  for (const cycle of cyclesToClose(dayCycles, submittedIssues)) {
    const note = (resubmitNotes?.get(cycle.issue) ?? '').trim()
    await client.updateDoc(ygTimesheet.class.TimesheetRejectCycle, core.space.Workspace, cycle._id, {
      resubmittedOn,
      ...(note !== '' ? { resubmitNote: note } : {})
    })
  }
```

- [ ] **Step 5: Build the package**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js build`
Expected: PASS.

- [ ] **Step 6: Run the unit tests**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/utils/day.ts
git commit -m "feat(reject-cycle): submitDay closes open rounds with the employee reply"
```

---

## Task 5: Resubmit dialog + Resubmit label

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/ResubmitDayPopup.svelte`
- Modify: `plugins/yg-timesheet-resources/src/components/Timesheet.svelte` (`onSubmit` at line 197, button label at line 288)
- Modify: `plugins/yg-timesheet/src/index.ts` (add the `Resubmit` IntlString)
- Modify: `plugins/yg-timesheet-assets/lang/en.json` (add `Resubmit`)

**Interfaces:**
- Consumes: `SubmitArgs.resubmitNotes` (Task 4).
- Produces: `ResubmitDayPopup` closes with `{ notes: Map<string, string> }` keyed by issue ref, or `undefined` on cancel.

- [ ] **Step 1: Add the IntlString id**

In `plugins/yg-timesheet/src/index.ts`, in the `string:` map, add immediately after the `Submit: '' as IntlString,` line:

```ts
    Resubmit: '' as IntlString,
```

- [ ] **Step 2: Add the English label**

In `plugins/yg-timesheet-assets/lang/en.json`, add after the `"Submit": "Submit",` line:

```json
    "Resubmit": "Resubmit",
```

(Do NOT add it to `ru.json`. Untranslated keys fall back to English on purpose.)

- [ ] **Step 3: Create the dialog**

Create `plugins/yg-timesheet-resources/src/components/ResubmitDayPopup.svelte`:

```svelte
<!--
// Copyright © 2026 YoungGlobes
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  //
  // Shown before a resubmit of a day that has rejected tasks (backlog item 4). One optional reply
  // per rejected task: the employee may leave any or all blank and still resubmit. Only issues
  // still present in the day are listed - one the employee dropped is not being resubmitted, so
  // there is nothing to reply to and its cycle stays open (see utils/day.ts submitDay).
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  export interface RejectedRow {
    issue: string
    identifier: string
    title: string
    hours: string
    reason: string
    rejectedBy: string
  }

  export let dayLabel: string
  export let rows: RejectedRow[]

  const dispatch = createEventDispatcher()
  const notes: Record<string, string> = {}

  function confirm (): void {
    const out = new Map<string, string>()
    for (const row of rows) {
      const note = (notes[row.issue] ?? '').trim()
      if (note !== '') out.set(row.issue, note)
    }
    dispatch('close', { notes: out })
  }
</script>

<div class="dialog">
  <div class="dialog__head">
    <div class="dialog__title"><Label label={ygTimesheet.string.Resubmit} /></div>
    <div class="dialog__sub">{dayLabel}</div>
  </div>
  <div class="dialog__body">
    {#each rows as row (row.issue)}
      <div class="row">
        <div class="row__head">
          <span class="yg-idbadge">{row.identifier}</span>
          <span class="row__title">{row.title}</span>
          <span class="spacer" />
          <span class="row__hrs">{row.hours}</span>
        </div>
        <div class="row__reason">
          {#if row.rejectedBy !== ''}
            Rejected by {row.rejectedBy}: "{row.reason}"
          {:else}
            Rejected: "{row.reason}"
          {/if}
        </div>
        <span class="lbl">Your reply (optional)</span>
        <textarea
          class="reason-input"
          rows="2"
          placeholder="What did you change?"
          bind:value={notes[row.issue]}
        />
      </div>
    {/each}
  </div>
  <div class="dialog__foot">
    <button class="yg-btn yg-btn--ghost" on:click={() => dispatch('close', undefined)}>
      <Label label={ui.string.Cancel} />
    </button>
    <button class="yg-btn yg-btn--primary" on:click={confirm}>
      <Label label={ygTimesheet.string.Resubmit} />
    </button>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;

  .dialog {
    width: 440px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--yg-panel);
    border: 1px solid var(--yg-border-strong);
    border-radius: 14px;
    box-shadow: 0 24px 60px rgba(10, 12, 25, 0.32);
    overflow: hidden;
  }
  .dialog__head { padding: 16px 18px 6px; flex: none; }
  .dialog__title { font-weight: 660; font-size: 15px; letter-spacing: -0.01em; }
  .dialog__sub { font-size: 12.5px; color: var(--yg-text-faint); margin-top: 2px; }
  .dialog__body {
    padding: 12px 18px 4px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
  }
  .row { display: flex; flex-direction: column; gap: 6px; }
  .row__head { display: flex; align-items: center; gap: 8px; }
  .row__title { font-size: 13px; color: var(--yg-text); }
  .row__hrs { font-size: 12.5px; color: var(--yg-text-dim); }
  .row__reason { font-size: 12.5px; color: var(--yg-text-dim); }
  .lbl { font-size: 12.5px; color: var(--yg-text-faint); }
  .spacer { flex: 1; }
  .reason-input {
    resize: vertical;
    min-height: 3rem;
    border: 1px solid var(--yg-border-strong);
    border-radius: 8px;
    background: var(--yg-panel-soft);
    color: var(--yg-text);
    font: inherit;
    font-size: 13px;
    padding: 8px 10px;
  }
  .reason-input:focus { outline: none; border-color: var(--yg-text-faint); }
  .dialog__foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 18px; flex: none; }
</style>
```

- [ ] **Step 4: Wire the dialog into `onSubmit`**

In `plugins/yg-timesheet-resources/src/components/Timesheet.svelte`, add these imports next to the existing component imports (near `import SubmitErrorNotification from './SubmitErrorNotification.svelte'`):

```ts
  import ResubmitDayPopup from './ResubmitDayPopup.svelte'
  import { showPopup } from '@hcengineering/ui'
```

(If `showPopup` is already imported from `@hcengineering/ui` in this file, add it to that existing import block instead of writing a second one.)

Then replace the `submitDay` call inside `onSubmit` (line 211):

```ts
    const res = await submitDay(client, { employee: me, date: day.date, reports, approversByProject })
```

with:

```ts
    // Backlog item 4: a day whose derived status is Rejected collects one optional reply per
    // rejected task before it goes back. deriveDayStatus returns 'Rejected' iff at least one task
    // is rejected, and the Submit button only renders for Draft or Rejected, so this single check
    // is sufficient. The Draft path is untouched: no dialog, zero added friction.
    const dayTasksNow = tasksByKey.get(day.key) ?? []
    const isResubmit = deriveDayStatus(dayTasksNow.map((t) => t.status)) === 'Rejected'
    let resubmitNotes: Map<string, string> | undefined
    if (isResubmit) {
      const rows = dayTasksNow
        .filter((t) => t.status === 'Rejected')
        .filter((t) => reports.some((r) => r.issue === t.issue))
        .map((t) => ({
          issue: t.issue as string,
          identifier: t.identifier,
          title: t.title,
          hours: formatHours(t.submittedHours),
          reason: t.rejectReason ?? '',
          rejectedBy: rejectedByName(t) ?? ''
        }))
      if (rows.length > 0) {
        const answered = await new Promise<Map<string, string> | undefined>((resolve) => {
          showPopup(
            ResubmitDayPopup,
            { dayLabel: weekdayLongFmt.format(day.date), rows },
            undefined,
            (out?: { notes: Map<string, string> }) => {
              resolve(out?.notes)
            }
          )
        })
        // Cancel (undefined) aborts the resubmit entirely; an empty map means "no replies, proceed".
        if (answered === undefined) return
        resubmitNotes = answered
      }
    }

    const res = await submitDay(client, {
      employee: me,
      date: day.date,
      reports,
      approversByProject,
      resubmitNotes: resubmitNotes as Map<Ref<Issue>, string> | undefined
    })
```

Note: `deriveDayStatus` is already imported in this file (it is used at line 266). `formatHours` is already used at line 257. `rejectedByName` is added in Task 7; until then it does not exist, so for THIS task use `''` in its place and Task 7 replaces it:

```ts
          rejectedBy: ''
```

- [ ] **Step 5: Relabel the button**

In the same file, replace the Submit button block (lines 286-289):

```svelte
          {#if (status === 'Draft' || status === 'Rejected') && hasTasks}
            <button class="yg-btn yg-btn--primary" on:click={() => onSubmit(day)}>
              <Label label={ygTimesheet.string.Submit} />
            </button>
```

with:

```svelte
          {#if (status === 'Draft' || status === 'Rejected') && hasTasks}
            <button class="yg-btn yg-btn--primary" on:click={() => onSubmit(day)}>
              <Label label={status === 'Rejected' ? ygTimesheet.string.Resubmit : ygTimesheet.string.Submit} />
            </button>
```

- [ ] **Step 6: Build the packages**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet && node ../../common/scripts/install-run-rushx.js build
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js build
```
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/components/ResubmitDayPopup.svelte \
        plugins/yg-timesheet-resources/src/components/Timesheet.svelte \
        plugins/yg-timesheet/src/index.ts \
        plugins/yg-timesheet-assets/lang/en.json
git commit -m "feat(reject-cycle): resubmit dialog captures a reply per rejected task"
```

---

## Task 6: Approver screen shows prior rejections

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Approvals.svelte`
- Modify: `plugins/yg-timesheet-resources/src/components/ApproveTaskPopup.svelte`
- Modify: `plugins/yg-timesheet/src/index.ts` (add `Reapprove`)
- Modify: `plugins/yg-timesheet-assets/lang/en.json` (add `Reapprove`)

**Interfaces:**
- Consumes: `cycleKey`, `groupCycles`, `closedCycles` from `./reject-cycle` (Task 2); `employeeOf` and `employeeNames` already in this component.

- [ ] **Step 1: Add the IntlString id and label**

Only ONE new string is needed. The approve popup's title is a plain string literal, not a `Label`
(verified: `ApproveTaskPopup.svelte:48` reads `<div class="dialog__title">Approve time</div>`), so it
is handled as plain text in Step 5 and needs no IntlString.

In `plugins/yg-timesheet/src/index.ts`, in the `string:` map, add immediately after the
`Approve: '' as IntlString,` line:

```ts
    Reapprove: '' as IntlString,
```

In `plugins/yg-timesheet-assets/lang/en.json`, add after `"Approve": "Approve",`:

```json
    "Reapprove": "Reapprove",
```

- [ ] **Step 2: Query the cycles**

In `plugins/yg-timesheet-resources/src/components/Approvals.svelte`, add to the imports:

```ts
  import { cycleKey, groupCycles, closedCycles } from '../utils/reject-cycle'
  import type { TimesheetRejectCycle } from '@hcengineering/yg-timesheet'
```

Then add this block immediately after the `groups` reactive statement (after the closing `})()` around line 123):

```ts
  //
  // Prior rejection history for the tasks currently in the queue (backlog item 2). Bounded by the
  // queue, not by total history: we ask only for the issues on screen and filter the
  // employee+date part of the key in code.
  //
  // CAREFUL - same trap as the `query` block above: this reactive statement READS `cycleQuery`, so
  // it must never ASSIGN to it, or Svelte re-runs the statement forever. Results go to a separate
  // variable, and the empty case calls unsubscribe() rather than reassigning.
  const cycleQuery = createQuery()
  let cycles: TimesheetRejectCycle[] = []
  $: queueIssues = [...new Set(queue.map((t) => t.issue))]
  $: if (queueIssues.length > 0) {
    cycleQuery.query(
      ygTimesheet.class.TimesheetRejectCycle,
      { issue: { $in: queueIssues } },
      (res: TimesheetRejectCycle[]) => {
        cycles = res
      }
    )
  } else {
    cycleQuery.unsubscribe()
    cycles = []
  }

  $: cyclesByKey = groupCycles(cycles)

  /** Completed rounds for a task, oldest first. Empty for a task that was never rejected. */
  function historyFor (task: TimesheetTask): TimesheetRejectCycle[] {
    const employee = employeeOf(task)
    if (employee === undefined) return []
    return closedCycles(cyclesByKey.get(cycleKey(employee, task.issue, task.date)) ?? [])
  }

  // Which rows have their older rounds expanded. Component-local, nothing persisted.
  let expanded = new Set<string>()
  function toggle (id: string): void {
    if (expanded.has(id)) expanded.delete(id)
    else expanded.add(id)
    expanded = expanded
  }
</script>
```

(That closing `</script>` replaces the existing one; keep the `dayFmt` line that currently precedes it.)

- [ ] **Step 3: Render the rejection line and relabel the button**

Replace the `approw` block (lines 207-226) with:

```svelte
            {@const history = historyFor(task)}
            {@const latest = history[history.length - 1]}
            <div class="approw">
              <span class="approw__date">{dayFmt.format(task.date)}</span>
              <span class="yg-idbadge">{task.identifier}</span>
              <a
                class="approw__title"
                href="#{getPanelURI(tracker.component.EditIssue, task.issue, tracker.class.Issue, 'content')}"
              >
                {task.title}
                <span class="go">↗</span>
              </a>
              <span class="approw__hrs">{formatHours(task.submittedHours)}</span>
              <span class="ap-actions">
                <button class="yg-btn yg-btn--primary" on:click={() => { void onApprove(task, history.length > 0) }}>
                  <Label label={history.length > 0 ? ygTimesheet.string.Reapprove : ygTimesheet.string.Approve} />
                </button>
                <button class="yg-btn yg-btn--danger" on:click={() => onReject(task)}>
                  <Label label={ygTimesheet.string.Reject} />
                </button>
              </span>
            </div>
            {#if latest !== undefined}
              <div class="prior">
                <div class="prior__line">⟲ previously rejected: "{latest.rejectReason}"</div>
                {#if (latest.resubmitNote ?? '') !== ''}
                  <div class="prior__reply">{employeeNames.get(g.employee ?? '') ?? 'Employee'} replied: "{latest.resubmitNote}"</div>
                {/if}
                {#if history.length > 1}
                  <button class="prior__more" on:click={() => toggle(task._id)}>
                    rejected {history.length}x {expanded.has(task._id) ? '▴' : '▾'}
                  </button>
                  {#if expanded.has(task._id)}
                    {#each history.slice(0, -1) as round, ri (round._id)}
                      <div class="prior__round">
                        <b>round {ri + 1}:</b> "{round.rejectReason}"
                        {#if (round.resubmitNote ?? '') !== ''}
                          <span class="prior__reply">replied: "{round.resubmitNote}"</span>
                        {/if}
                      </div>
                    {/each}
                  {/if}
                {/if}
              </div>
            {/if}
```

- [ ] **Step 4: Pass the flag to the approve popup**

In the same file, replace the `onApprove` signature and its `showPopup` props. Change:

```ts
  async function onApprove (task: TimesheetTask): Promise<void> {
```

to:

```ts
  async function onApprove (task: TimesheetTask, isReapproval: boolean = false): Promise<void> {
```

and inside its `showPopup(ApproveTaskPopup, { ... })` props object, add `isReapproval` after `notes`:

```ts
        notes,
        isReapproval
```

- [ ] **Step 5: Use the flag in the popup title**

In `plugins/yg-timesheet-resources/src/components/ApproveTaskPopup.svelte`, add to the script block,
immediately after the existing `export let notes: string[] = []` line (line 34):

```ts
  export let isReapproval: boolean = false
```

Then replace the title element at line 48:

```svelte
    <div class="dialog__title">Approve time</div>
```

with:

```svelte
    <div class="dialog__title">{isReapproval ? 'Reapprove time' : 'Approve time'}</div>
```

(Plain text, matching the existing copy. "Reapprove time" rather than "Reapprove task" so it stays
consistent with the title already there.)

- [ ] **Step 6: Add the styles**

In `Approvals.svelte`'s `<style lang="scss">` block, add:

```scss
  .prior {
    padding: 2px 0 8px 84px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .prior__line { font-size: 12.5px; color: var(--yg-text-dim); }
  .prior__reply { font-size: 12.5px; color: var(--yg-text-faint); }
  .prior__more {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--yg-text-faint);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .prior__more:hover { color: var(--yg-text-dim); }
  .prior__round { font-size: 12.5px; color: var(--yg-text-faint); padding-left: 10px; }
```

- [ ] **Step 7: Build**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/components/Approvals.svelte \
        plugins/yg-timesheet-resources/src/components/ApproveTaskPopup.svelte \
        plugins/yg-timesheet/src/index.ts \
        plugins/yg-timesheet-assets/lang/en.json
git commit -m "feat(reject-cycle): approval screen shows prior rejection and Reapprove"
```

---

## Task 7: Employee screen, per-task reasons with history

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Timesheet.svelte`

**Interfaces:**
- Consumes: `cycleKey`, `groupCycles`, `closedCycles`, `openCycle` from `./reject-cycle` (Task 2).
- Produces: `rejectedByName(task)`, referenced by Task 5's `onSubmit` placeholder.

- [ ] **Step 1: Query the employee's own cycles**

In `plugins/yg-timesheet-resources/src/components/Timesheet.svelte`, add to the imports:

```ts
  import { cycleKey, groupCycles, closedCycles, openCycle } from '../utils/reject-cycle'
  import type { TimesheetRejectCycle } from '@hcengineering/yg-timesheet'
```

Add this block after the existing `tasksByKey` derivation:

```ts
  //
  // The employee's own rejection history for the visible week (backlog item 2, employee side).
  // Scoped to `me` and the week window so it stays small.
  //
  const cycleQuery = createQuery()
  let cycles: TimesheetRejectCycle[] = []
  $: cycleQuery.query(
    ygTimesheet.class.TimesheetRejectCycle,
    { employee: me, date: { $gte: week.start, $lt: week.end } },
    (res: TimesheetRejectCycle[]) => {
      cycles = res
    }
  )
  $: cyclesByKey = groupCycles(cycles)

  const empNameQuery = createQuery()
  let approverNames: Map<string, string> = new Map()
  empNameQuery.query(contact.mixin.Employee, {}, (res: Employee[]) => {
    const m = new Map<string, string>()
    for (const e of res) m.set(e._id, formatName(e.name))
    approverNames = m
  })

  function cyclesFor (task: TimesheetTask): TimesheetRejectCycle[] {
    return cyclesByKey.get(cycleKey(me, task.issue, task.date)) ?? []
  }

  /** Who rejected the current open round, formatted for display. Empty when unattributed. */
  function rejectedByName (task: TimesheetTask): string {
    const open = openCycle(cyclesFor(task))
    if (open?.rejectedBy == null) return ''
    return approverNames.get(open.rejectedBy) ?? ''
  }

  let expanded = new Set<string>()
  function toggle (id: string): void {
    if (expanded.has(id)) expanded.delete(id)
    else expanded.add(id)
    expanded = expanded
  }

  const agoFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
```

Verified against the current file, these are the imports you must ADD. `createQuery` is already
imported (line 19) and `week.start` / `week.end` are already used (line 67), so leave both alone.
`Timesheet.svelte` imports only `getCurrentEmployee` from `@hcengineering/contact`, so replace that
line:

```ts
  import { getCurrentEmployee } from '@hcengineering/contact'
```

with:

```ts
  import contact, { formatName, getCurrentEmployee, type Employee } from '@hcengineering/contact'
```

- [ ] **Step 2: Fill in Task 5's placeholder**

Replace the `rejectedBy: ''` line added in Task 5's `onSubmit` with:

```ts
          rejectedBy: rejectedByName(t)
```

- [ ] **Step 3: Remove the day-level reason block**

Delete line 268 entirely:

```svelte
      {@const rejectedTask = dayTasks.find((t) => t.status === 'Rejected' && (t.rejectReason ?? '') !== '')}
```

and delete the whole block at lines 320-325:

```svelte
        {#if rejectedTask !== undefined}
          <div class="reason">
            <b>Rejected: "{rejectedTask.rejectReason}."</b>
            <span class="fix">Open the task, fix it, then resubmit the day.</span>
          </div>
        {/if}
```

- [ ] **Step 4: Render the reason on each rejected task row**

Replace the task row block (lines 298-317) with:

```svelte
            {#each day.issues as it (it.issueId)}
              {@const task = dayTasks.find((t) => t.issue === it.issueId)}
              {@const rounds = task !== undefined ? cyclesFor(task) : []}
              {@const open = openCycle(rounds)}
              {@const past = closedCycles(rounds)}
              <div class="task">
                <span class="yg-idbadge">{it.identifier}</span>
                <a
                  class="task__title"
                  href="#{getPanelURI(tracker.component.EditIssue, it.issueId, tracker.class.Issue, 'content')}"
                >
                  {it.title}
                  <span class="go">↗</span>
                </a>
                <span class="task__hrs">{formatHours(it.hours)}</span>
                {#if task !== undefined}
                  <span class="yg-tag yg-tag--{task.status.toLowerCase()}">
                    <span class="tick" />
                    <Label label={statusString(task.status)} />
                  </span>
                {/if}
              </div>
              {#if task !== undefined && task.status === 'Rejected' && (task.rejectReason ?? '') !== ''}
                <div class="reason">
                  <div class="reason__text">⤷ "{task.rejectReason}"</div>
                  <div class="reason__meta">
                    {#if open !== undefined}
                      {#if rejectedByName(task) !== ''}{rejectedByName(task)}, {/if}{agoFmt.format(open.rejectedOn)}
                    {/if}
                    {#if past.length > 0}
                      <button class="reason__more" on:click={() => toggle(task._id)}>
                        rejected {past.length + 1}x {expanded.has(task._id) ? '▴' : '▾'}
                      </button>
                    {/if}
                  </div>
                  {#if past.length > 0 && expanded.has(task._id)}
                    {#each past as round, ri (round._id)}
                      <div class="reason__round">
                        <b>round {ri + 1}:</b> "{round.rejectReason}"
                        {#if (round.resubmitNote ?? '') !== ''}
                          <span class="reason__reply">you replied: "{round.resubmitNote}"</span>
                        {/if}
                      </div>
                    {/each}
                  {/if}
                </div>
              {/if}
            {/each}
```

- [ ] **Step 5: Update the styles**

In the `<style lang="scss">` block, replace the existing `.reason` and `.fix` rules (they styled the removed day-level block) with:

```scss
  .reason {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 0 8px 30px;
  }
  .reason__text { font-size: 12.5px; color: var(--yg-text-dim); }
  .reason__meta {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--yg-text-faint);
  }
  .reason__more {
    padding: 0;
    border: none;
    background: none;
    color: var(--yg-text-faint);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .reason__more:hover { color: var(--yg-text-dim); }
  .reason__round { font-size: 12.5px; color: var(--yg-text-faint); padding-left: 10px; }
  .reason__reply { color: var(--yg-text-faint); }
```

- [ ] **Step 6: Build**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/components/Timesheet.svelte
git commit -m "feat(reject-cycle): per-task reasons with expandable history on the timesheet"
```

---

## Task 8: Backfill migration

**Files:**
- Modify: `models/yg-timesheet/src/migration.ts`

**Interfaces:**
- Consumes: `ygTimesheet.class.TimesheetRejectCycle` (Task 1).

Without this, tasks already sitting at `Rejected` show as never-rejected, because they have a `rejectReason` and no cycle record. This codebase has shipped that exact bug before: the HR projection went out without backfilling `HrTimeEntry` and showed empty history until `da3a61c9e` patched it.

- [ ] **Step 1: Write the backfill function**

In `models/yg-timesheet/src/migration.ts`, add this function immediately after `backfillHrTimeEntries` (before the `export const ygTimesheetOperation` block):

```ts
// Backfill one TimesheetRejectCycle per EXISTING rejected task. rejectTask only records cycles for
// rejections made AFTER this ships, so without this every pre-existing rejected task displays as
// never-rejected. Mirrors rejectTask's field mapping, with two unavoidable gaps:
//  - rejectedBy is left unset: the task never stored who rejected it, so it is not recoverable.
//  - rejectedOn falls back to the task's submittedOn (then to its date) as the closest available
//    approximation of when the rejection happened.
// The row is left OPEN (no resubmittedOn) because a rejected task is by definition not resubmitted.
// Idempotent: skips any (employee, issue, date) that already has a cycle, so it is safe to re-run.
async function backfillRejectCycles (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  const tasks = await ops.findAll(ygTimesheet.class.TimesheetTask, { status: 'Rejected' })
  if (tasks.length === 0) return

  const have = new Set(
    (await ops.findAll(ygTimesheet.class.TimesheetRejectCycle, {})).map(
      (c) => `${c.employee}|${c.issue}|${c.date}`
    )
  )
  // Resolve each task's employee via day -> timesheet, pre-loading both levels once.
  const dayById = new Map((await ops.findAll(ygTimesheet.class.TimesheetDay, {})).map((d) => [d._id, d]))
  const sheetById = new Map((await ops.findAll(ygTimesheet.class.Timesheet, {})).map((s) => [s._id, s]))

  for (const task of tasks) {
    const reason = task.rejectReason ?? ''
    if (reason === '') continue // nothing to show; not worth a row
    const day = dayById.get(task.attachedTo as Ref<TimesheetDay>)
    const sheet = day !== undefined ? sheetById.get(day.attachedTo as Ref<Timesheet>) : undefined
    const employee = sheet?.employee
    if (employee == null) continue // cannot key it; skip rather than mis-attribute
    if (have.has(`${employee}|${task.issue}|${task.date}`)) continue // idempotent
    await ops.createDoc(ygTimesheet.class.TimesheetRejectCycle, core.space.Workspace, {
      employee,
      issue: task.issue,
      date: task.date,
      rejectReason: reason,
      rejectedOn: task.submittedOn ?? task.date
    })
    have.add(`${employee}|${task.issue}|${task.date}`)
  }
}
```

- [ ] **Step 2: Add the missing type imports**

At the top of `models/yg-timesheet/src/migration.ts`, extend the `@hcengineering/yg-timesheet` import to include `Timesheet`:

```ts
import ygTimesheet, { ygTimesheetId, type Timesheet, type TimesheetDay } from '@hcengineering/yg-timesheet'
```

- [ ] **Step 3: Register the migration state**

In the `tryUpgrade(...)` array in `ygTimesheetOperation.upgrade`, add this entry at the END of the array (after the `hr-app-icon-0001` entry, adding a comma to it):

```ts
      {
        // One-shot backfill of rejection history for tasks rejected before the reject-cycle feature
        // shipped. Last in the array: it depends only on TimesheetTask rows, which all earlier
        // states leave alone.
        state: 'reject-cycle-backfill-0001',
        func: backfillRejectCycles
      }
```

- [ ] **Step 4: Build the model package**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/models/yg-timesheet && node ../../common/scripts/install-run-rushx.js build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add models/yg-timesheet/src/migration.ts
git commit -m "feat(reject-cycle): backfill history for pre-existing rejected tasks"
```

---

## Task 9: Build, upgrade, smoke test

**Files:** none (build and runtime verification only).

**Interfaces:** none.

- [ ] **Step 1: Full local image build**

Run: `cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost && ./build-beta.sh`
Expected: all four images build and tag without error. A front-only build would miss the new model class and the migration.

- [ ] **Step 2: Recreate the stack and upgrade the workspace**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d --force-recreate transactor account front
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
./run-tool-beta.sh upgrade-workspace yg
```
Expected: services healthy; `upgrade-workspace yg` completes and runs `reject-cycle-backfill-0001`.

(The nginx restart is the 2026-07-23 ops rule: nginx resolves compose service names once at startup, so it must be restarted after force-recreating anything it proxies to.)

- [ ] **Step 3: Verify the backfill landed**

If any task was already `Rejected` before this change, open that employee's timesheet for the relevant week. Expected: the reason appears on the task row with no approver name (backfilled rows carry no `rejectedBy`). If there were no pre-existing rejected tasks, record that and skip.

- [ ] **Step 4: Smoke test, six checks**

Record the result of each check in the task ledger. If any fails, STOP and debug before proceeding. Do not claim the feature works.

1. **Reason moves to the task row.** Reject one task. As the employee, confirm the reason renders under that task row and NOT as a single line on the day card.
2. **Both reasons reach the employee.** Reject two tasks in the same day with different reasons. Confirm both appear, each under its own row. (This is the bug being fixed: the old code showed only the first.)
3. **Reply reaches the approver.** Resubmit that day, filling a reply for one task and leaving the other blank. Confirm the approver sees "previously rejected" plus the reply on the first, "previously rejected" with no reply line on the second, and `Reapprove` on both buttons. Confirm the approve popup title reads "Reapprove time".
4. **History accumulates.** Reject and resubmit the same task a second time. Confirm "rejected 2x" appears on BOTH screens and expands to show round 1 with its reason and the employee's reply.
5. **The wipe attempt.** Reject a task, delete its time entry, resubmit the day without it, then re-add the issue and submit again. Confirm the history is still present and the approver still sees `Reapprove`. **This is the case that drove the whole storage design, so it must pass.**
6. **No regression on the clean path.** Submit a fresh day that was never rejected. Confirm the button reads `Submit` (not `Resubmit`), no dialog appears, and the approver sees `Approve` with no rejection line.

- [ ] **Step 5: Update the backlog**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
```

In `docs/superpowers/specs/2026-08-04-yg-portal-backlog.md`, mark items 2, 3 and 4 as built and verified locally, in the same style item 1 uses.

```bash
git add docs/superpowers/specs/2026-08-04-yg-portal-backlog.md
git commit -m "docs: mark approval re-cycle items built + verified locally (items 2-4)"
```

---

## Self-Review

**Spec coverage** (`2026-08-05-approval-recycle-design.md`):

| Spec requirement | Task |
|---|---|
| `TimesheetRejectCycle` class, keyed employee + issue + date | Task 1 ✓ |
| No stored round number, derived from `rejectedOn` order | Task 2 (`groupCycles` sorts; index is the round) ✓ |
| `rejectTask` creates a cycle, task update FIRST | Task 3 ✓ |
| Employee resolution with `findOne` fallback, skip when unresolvable | Task 3 ✓ |
| `submitDay` closes cycles, stamps `resubmittedOn` always and `resubmitNote` only when non-blank | Task 4 ✓ |
| `submitDay` deletes nothing new | Task 4 (insert is additive, before `return dayId`) ✓ |
| Dropped-issue cycle stays open | Task 2 `cyclesToClose` + Task 4 ✓ |
| Approver sees prior reason, reply, and expandable history | Task 6 ✓ |
| Reactive-loop trap respected on the new query | Task 6 Step 2 (explicit comment, `unsubscribe()`, separate result var) ✓ |
| Employee sees per-task reason with expandable history; day-level block removed | Task 7 ✓ |
| Resubmit dialog, per task, optional | Task 5 ✓ |
| Draft path untouched | Task 5 Step 4 (branch on derived status) ✓ |
| `Submit` → `Resubmit` | Task 5 Step 5 ✓ |
| `Approve` → `Reapprove`, popup title → "Reapprove time" | Task 6 Steps 1, 3, 5 ✓ |
| `en.json` only, no `ru.json` | Tasks 5 and 6 ✓ |
| Backfill migration, `rejectedBy` unset | Task 8 ✓ |
| 4-image build + `upgrade-workspace`, nginx restart | Task 9 ✓ |
| Six smoke tests including the wipe attempt | Task 9 Step 4 ✓ |

**Placeholder scan:** no TBD, no "add error handling", no "similar to Task N". Every code step is literal. The one forward reference (Task 5 uses `rejectedBy: ''`, Task 7 replaces it with `rejectedByName(t)`) is called out explicitly in both tasks so a subagent reading either in isolation knows what to write. ✓

**Type consistency:**
- `RejectCycleLike` fields match `TimesheetRejectCycle` exactly, with `Ref<T>` narrowing to `string` structurally.
- `cycleKey(employee, issue, date)` has the same argument order in its definition (Task 2), the approver's `historyFor` (Task 6), the employee's `cyclesFor` (Task 7), and the backfill's inline `${employee}|${issue}|${date}` (Task 8).
- `rejectTask(client, taskId, reason, employee?)` matches between its definition (Task 3) and its only call site (Task 3 Step 3).
- `SubmitArgs.resubmitNotes` is `Map<Ref<Issue>, string>` in Task 4 and is cast from `Map<string, string>` at the single call site in Task 5.
- `onApprove(task, isReapproval)` matches its definition, both call sites, and `ApproveTaskPopup`'s `export let isReapproval`.
- Helper names are stable across tasks: `groupCycles`, `closedCycles`, `openCycle`, `isOpen`, `cyclesToClose`, `cycleKey`.

**Known risk flagged for the implementer:** Task 6 Step 2 and Task 7 Step 1 both declare `cycleQuery`, `cycles`, `cyclesByKey`, `expanded` and `toggle`. These are in two DIFFERENT components, so there is no collision. Do not attempt to share them.
