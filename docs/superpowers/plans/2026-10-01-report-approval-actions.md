# Reports Action Column (Approve / Reject / Recall) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Timesheet Reports table loses the issue Status column and gains an Action column: Approve / Reject for pending tasks, Recall (with confirmation) for approved or rejected ones, all enforced on the server for the task's own project approvers, HR and admins.

**Architecture:** One shared pure predicate (`canActOnTimesheetTask`) decides who may act, used by both the Reports UI and the server guard `OnTimesheetTaskUpdate`. A new pure server module replays a task's tx history to know its previous state, so the guard can recognise a recall and restore the exact previous state on any unauthorized status write. The client gets `recallTask` plus a confirm popup; Reports reuses the Approvals page's approve and reject popups.

**Tech Stack:** TypeScript, Svelte 4, Huly model + server triggers, Jest per package, rush worktree `yg-huly-beta` (branch `yg_beta`).

**Spec:** `docs/superpowers/specs/2026-10-01-report-approval-actions-design.md` (same repo).

## Global Constraints

- Repo `/home/karthi_0008/dev/client-projects/yg-huly-beta`, branch `yg_beta`. Implementers do NOT run `git add` / `git commit` / `git stash` / `git reset`; the controller commits after the whole plan is reviewed.
- No em dash, en dash or other long dash in anything written; if a touched file already has some, replace them all in that file.
- Package folders (rush.json): `plugins/yg-timesheet`, `models/yg-timesheet`, `plugins/yg-timesheet-resources`, `plugins/yg-timesheet-assets`, `server-plugins/yg-timesheet-resources`.
- Who may act (approve, reject, recall): owner known AND actor known AND actor != owner AND (admin (Maintainer+) OR HR (member of `ygTimesheet.space.HrData`) OR actor in the task's project `ProjectApprovers.pm` / `teamLead`). The project comes from the task's ISSUE (`Issue.space`), never from the client-writable `TimesheetTask.project` or `TimesheetTask.approvers`.
- A recall is a write of `status: 'Submitted'` to a task whose previous status was `Approved` or `Rejected`. The employee's own day recall (`Submitted` -> `Draft`) and fresh submissions (task creation) are not recalls.
- Unauthorized status writes (approve, reject, recall) are reverted to the task's EXACT previous state (status and approval fields), and the `TimesheetApproval` row is made to match it (recreated if the previous state was Approved, removed otherwise).
- No notification on recall (user decision). Approve/reject notifications stay as today.
- Recall confirm text: `Recall the approval of {identifier} for {employee} on {date}? It goes back to Pending approval and its approved hours are removed.` / for a rejection: `Recall the rejection of {identifier} for {employee} on {date}? It goes back to Pending approval.`
- The client recall removes the `TimesheetApproval` row BEFORE updating the task (so a server revert's recreated row is not deleted afterwards).
- Model change (`TimesheetRejectCycle.recalledOn`, `recalledBy`): deploy needs `upgrade-workspace`.
- Plan amendment vs spec: restoring the previous state applies to unauthorized approve/reject writes as well as recall (the spec says "reverts the task to its previous status"; today those were reset to Submitted, which let an unauthorized Rejected write downgrade an Approved task).

## Review Focus

1. **A task approved twice, then recalled by an unauthorized user**: the revert must restore the LATEST approval (hours and approver), not the first. Test in Task 2 (`previousTaskState` with two approvals).
2. **Two time-entry rows of the same task on the same day**: both rows show one action and act on the same task. Test in Task 4 (`taskForRow` returns the same task for both).
3. **A project approver acting on their own timesheet**: no buttons and the server refuses. Test in Task 1.
4. **A recalled rejection must stop counting as "open"** (the employee must not be asked to fix it). Test in Task 1 (`isOpen` false when `recalledOn` set).
5. **An approver of a different project** sees no buttons and the server refuses. Test in Task 1.

---

### Task 1: Shared action rules and the reject-cycle "recalled" state

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts` (TimesheetRejectCycle ~line 93; helpers near the other pure helpers ~line 185; string ids)
- Modify: `models/yg-timesheet/src/index.ts` (`TTimesheetRejectCycle` ~line 125)
- Modify: `plugins/yg-timesheet-resources/src/utils/reject-cycle.ts` (`RejectCycleLike`, `isOpen`)
- Modify: `plugins/yg-timesheet-assets/lang/en.json` and `ru.json` (same English text in both)
- Test: `plugins/yg-timesheet-resources/src/__tests__/task-actions.test.ts` (new)

**Interfaces:**
- Produces (from `@hcengineering/yg-timesheet`):
  - `interface TaskActorContext { actor?: Ref<Employee>, owner?: Ref<Employee>, isAdmin: boolean, isHr: boolean, projectApprovers: Array<Ref<Employee>> }`
  - `function canActOnTimesheetTask (c: TaskActorContext): boolean`
  - `type ReportTaskAction = 'approve-reject' | 'recall' | 'none'`
  - `function reportTaskAction (status: TaskStatus | undefined): ReportTaskAction`
  - `TimesheetRejectCycle.recalledOn?: Timestamp`, `recalledBy?: Ref<Employee>`
  - strings (new): `Action`, `RecallApprovalConfirm`, `RecallRejectionConfirm`, `NotSubmitted`, `Recalled`. `Recall`, `Approve` and `Reject` ALREADY EXIST (ids and lang text): reuse them, do not add them again.
- Produces (yg-timesheet-resources): `RejectCycleLike.recalledOn?: number`; `isOpen` false when recalled.

- [ ] **Step 1: Write the failing tests** (`__tests__/task-actions.test.ts`)

```ts
import type { Ref } from '@hcengineering/core'
import type { Employee } from '@hcengineering/contact'
import { canActOnTimesheetTask, reportTaskAction } from '@hcengineering/yg-timesheet'
import { isOpen } from '../utils/reject-cycle'

const E = (s: string): Ref<Employee> => s as Ref<Employee>
const base = { actor: E('pm'), owner: E('emp'), isAdmin: false, isHr: false, projectApprovers: [E('pm')] }

describe('canActOnTimesheetTask', () => {
  it('lets the project approver act', () => {
    expect(canActOnTimesheetTask(base)).toBe(true)
  })
  it('refuses an approver of a different project', () => {
    expect(canActOnTimesheetTask({ ...base, actor: E('otherpm'), projectApprovers: [E('pm')] })).toBe(false)
  })
  it('lets HR and admins act on any project', () => {
    expect(canActOnTimesheetTask({ ...base, actor: E('hr'), isHr: true, projectApprovers: [] })).toBe(true)
    expect(canActOnTimesheetTask({ ...base, actor: E('adm'), isAdmin: true, projectApprovers: [] })).toBe(true)
  })
  it('never on your own timesheet, admins and HR included', () => {
    expect(canActOnTimesheetTask({ ...base, actor: E('emp'), owner: E('emp'), projectApprovers: [E('emp')] })).toBe(false)
    expect(canActOnTimesheetTask({ ...base, actor: E('emp'), owner: E('emp'), isAdmin: true, isHr: true })).toBe(false)
  })
  it('fails closed when owner or actor is unknown', () => {
    expect(canActOnTimesheetTask({ ...base, owner: undefined })).toBe(false)
    expect(canActOnTimesheetTask({ ...base, actor: undefined, isAdmin: true })).toBe(false)
  })
})

describe('reportTaskAction', () => {
  it('maps task status to the Reports action', () => {
    expect(reportTaskAction('Submitted')).toBe('approve-reject')
    expect(reportTaskAction('Approved')).toBe('recall')
    expect(reportTaskAction('Rejected')).toBe('recall')
    expect(reportTaskAction('Draft')).toBe('none')
    expect(reportTaskAction(undefined)).toBe('none')
  })
})

describe('isOpen with recall', () => {
  const c = { employee: 'e', issue: 'i', date: 0, rejectReason: 'r', rejectedOn: 1 }
  it('a recalled rejection is no longer open', () => {
    expect(isOpen(c)).toBe(true)
    expect(isOpen({ ...c, recalledOn: 2 })).toBe(false)
    expect(isOpen({ ...c, resubmittedOn: 2 })).toBe(false)
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (`cd plugins/yg-timesheet-resources && npx jest src/__tests__/task-actions.test.ts`): missing exports.

- [ ] **Step 3: Implement**

`plugins/yg-timesheet/src/index.ts`, in `TimesheetRejectCycle` after `resubmittedOn`:

```ts
  /** Set when an approver recalls the rejection (Reports page): the round is closed without a resubmit. */
  recalledOn?: Timestamp
  recalledBy?: Ref<Employee>
```

New exported helpers (next to the other pure helpers):

```ts
/** Who is acting on a TimesheetTask and on whose behalf. Same rule on server and client. */
export interface TaskActorContext {
  actor?: Ref<Employee>
  owner?: Ref<Employee>
  isAdmin: boolean
  isHr: boolean
  /** PM and team-lead refs of the task's project, read from the project (never from the task). */
  projectApprovers: Array<Ref<Employee>>
}

/** May `actor` approve, reject or recall this task? Fails closed; nobody acts on their own timesheet. */
export function canActOnTimesheetTask (c: TaskActorContext): boolean {
  if (c.owner === undefined || c.actor === undefined || c.actor === c.owner) return false
  return c.isAdmin || c.isHr || c.projectApprovers.includes(c.actor)
}

export type ReportTaskAction = 'approve-reject' | 'recall' | 'none'

/** The Reports Action column for a task in this state. */
export function reportTaskAction (status: TaskStatus | undefined): ReportTaskAction {
  if (status === 'Submitted') return 'approve-reject'
  if (status === 'Approved' || status === 'Rejected') return 'recall'
  return 'none'
}
```

(Import `type Employee` from `@hcengineering/contact` if the file does not already.) String ids: `Action`, `RecallApprovalConfirm`, `RecallRejectionConfirm`, `NotSubmitted`, `Recalled` (`Recall`, `Approve`, `Reject` already exist: do not add them; a duplicate lang key breaks the locale test).

`models/yg-timesheet/src/index.ts`, `TTimesheetRejectCycle`:

```ts
  @Prop(TypeDate(), core.string.Object) recalledOn?: Timestamp
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) recalledBy?: Ref<Employee>
```

`utils/reject-cycle.ts`: add `recalledOn?: number` to `RejectCycleLike`; `isOpen` becomes

```ts
/** Open = rejected, not yet resubmitted, and not recalled by an approver. */
export function isOpen (c: RejectCycleLike): boolean {
  return c.resubmittedOn == null && c.recalledOn == null
}
```

Lang (en.json and ru.json, insert after the `"string": {` line, English text in both):

```json
"Action": "Action",
"RecallApprovalConfirm": "Recall the approval of {identifier} for {employee} on {date}? It goes back to Pending approval and its approved hours are removed.",
"RecallRejectionConfirm": "Recall the rejection of {identifier} for {employee} on {date}? It goes back to Pending approval.",
"NotSubmitted": "Not submitted",
"Recalled": "Recalled",
```

- [ ] **Step 4: Build and test**: `cd plugins/yg-timesheet && npm run build`, then `cd ../yg-timesheet-resources && npx jest` (all suites) and `cd ../yg-timesheet-assets && npx jest` (locale equality), and JSON-parse both lang files. Expected: all PASS.

- [ ] **Step 5: Record changed files (no commit).**

---

### Task 2: Server guard: recall, project-scoped authorization, exact restore

**Files:**
- Create: `server-plugins/yg-timesheet-resources/src/task-guard.ts`
- Test: `server-plugins/yg-timesheet-resources/src/__tests__/task-guard.test.ts`
- Modify: `server-plugins/yg-timesheet-resources/src/index.ts` (`OnTimesheetTaskUpdate` ~lines 428-575)

**Interfaces:**
- Consumes: `canActOnTimesheetTask` (Task 1).
- Produces (`task-guard.ts`):
  - `interface TaskState { status?: string, approvedHours?: number, approvedBy?: string, approvedOn?: number, rejectReason?: string }`
  - `function previousTaskState (create: { attributes?: Record<string, any> } | undefined, updates: Array<{ _id: string, modifiedOn: number, operations?: Record<string, any> }>, currentTxId: string): TaskState`
  - `function isRecall (statusOp: unknown, prev: TaskState): boolean`
  - `function restoreOps (prev: TaskState): Record<string, any>`

- [ ] **Step 1: Write the failing tests** (`__tests__/task-guard.test.ts`)

```ts
import { isRecall, previousTaskState, restoreOps } from '../task-guard'

const create = { attributes: { status: 'Submitted' } }
const u = (id: string, t: number, operations: Record<string, any>): { _id: string, modifiedOn: number, operations: Record<string, any> } => ({ _id: id, modifiedOn: t, operations })

describe('previousTaskState', () => {
  it('replays updates before the current tx only', () => {
    const ups = [
      u('a', 1, { status: 'Approved', approvedHours: 2, approvedBy: 'pm1', approvedOn: 1 }),
      u('cur', 5, { status: 'Submitted', $unset: { approvedHours: '', approvedBy: '', approvedOn: '' } }),
      u('late', 9, { status: 'Rejected' })
    ]
    expect(previousTaskState(create, ups, 'cur')).toEqual({ status: 'Approved', approvedHours: 2, approvedBy: 'pm1', approvedOn: 1 })
  })
  it('keeps the latest of two approvals', () => {
    const ups = [
      u('a', 1, { status: 'Approved', approvedHours: 2, approvedBy: 'pm1', approvedOn: 1 }),
      u('b', 3, { approvedHours: 1.5, approvedBy: 'pm2', approvedOn: 3 }),
      u('cur', 5, { status: 'Submitted' })
    ]
    expect(previousTaskState(create, ups, 'cur')).toMatchObject({ status: 'Approved', approvedHours: 1.5, approvedBy: 'pm2' })
  })
  it('treats null and $unset as removed and is order-safe', () => {
    const ups = [
      u('b', 3, { status: 'Rejected', rejectReason: 'fix', approvedHours: null, $unset: { approvedBy: '' } }),
      u('a', 1, { status: 'Approved', approvedHours: 2, approvedBy: 'pm1' }),
      u('cur', 5, { status: 'Submitted' })
    ]
    expect(previousTaskState(create, ups, 'cur')).toEqual({ status: 'Rejected', rejectReason: 'fix' })
  })
  it('starts from the create attributes', () => {
    expect(previousTaskState(create, [u('cur', 1, { status: 'Approved' })], 'cur')).toEqual({ status: 'Submitted' })
  })
})

describe('isRecall', () => {
  it('is a recall only when going back to Submitted from Approved or Rejected', () => {
    expect(isRecall('Submitted', { status: 'Approved' })).toBe(true)
    expect(isRecall('Submitted', { status: 'Rejected' })).toBe(true)
    expect(isRecall('Submitted', { status: 'Submitted' })).toBe(false)
    expect(isRecall('Draft', { status: 'Approved' })).toBe(false)
    expect(isRecall('Approved', { status: 'Approved' })).toBe(false)
  })
})

describe('restoreOps', () => {
  it('sets present fields and unsets absent approval fields', () => {
    expect(restoreOps({ status: 'Approved', approvedHours: 2, approvedBy: 'pm', approvedOn: 1 }))
      .toEqual({ status: 'Approved', approvedHours: 2, approvedBy: 'pm', approvedOn: 1, $unset: { rejectReason: '' } })
    expect(restoreOps({ status: 'Submitted' }))
      .toEqual({ status: 'Submitted', $unset: { approvedHours: '', approvedBy: '', approvedOn: '', rejectReason: '' } })
  })
  it('falls back to Submitted when no status is known', () => {
    expect(restoreOps({}).status).toBe('Submitted')
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (`cd server-plugins/yg-timesheet-resources && npx jest src/__tests__/task-guard.test.ts`).

- [ ] **Step 3: Create `task-guard.ts`**

```ts
//
// YoungGlobes: pure helpers for OnTimesheetTaskUpdate. The trigger runs after the task is already
// updated, so the PREVIOUS state comes from the tx log (create + earlier updates), the same idiom
// as attendance-guard.ts. No platform deps: unit-testable.
//
export interface TaskState {
  status?: string
  approvedHours?: number
  approvedBy?: string
  approvedOn?: number
  rejectReason?: string
}

const FIELDS = ['status', 'approvedHours', 'approvedBy', 'approvedOn', 'rejectReason'] as const
type Field = typeof FIELDS[number]

interface UpdateLike {
  _id: string
  modifiedOn: number
  operations?: Record<string, any>
}

const before = (a: UpdateLike, b: UpdateLike): boolean =>
  a.modifiedOn < b.modifiedOn || (a.modifiedOn === b.modifiedOn && a._id < b._id)

/** The task's status and approval fields just before tx `currentTxId`. */
export function previousTaskState (
  create: { attributes?: Record<string, any> } | undefined,
  updates: UpdateLike[],
  currentTxId: string
): TaskState {
  const s: Record<string, any> = {}
  for (const f of FIELDS) {
    const v = create?.attributes?.[f]
    if (v !== undefined && v !== null) s[f] = v
  }
  const current = updates.find((x) => x._id === currentTxId)
  const ordered = updates
    .filter((x) => x._id !== currentTxId && (current === undefined || before(x, current)))
    .sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0))
  for (const x of ordered) {
    const ops = x.operations ?? {}
    for (const f of FIELDS) {
      if (Object.prototype.hasOwnProperty.call(ops, f)) {
        const v = ops[f]
        if (v === null || v === undefined) delete s[f]
        else s[f] = v
      }
      if (ops.$unset !== undefined && Object.prototype.hasOwnProperty.call(ops.$unset, f)) delete s[f]
    }
  }
  return s as TaskState
}

/** Going back to Submitted from Approved or Rejected. */
export function isRecall (statusOp: unknown, prev: TaskState): boolean {
  return statusOp === 'Submitted' && (prev.status === 'Approved' || prev.status === 'Rejected')
}

/** Update ops that put the task back to `prev`: present fields set, absent approval fields unset. */
export function restoreOps (prev: TaskState): Record<string, any> {
  const set: Record<string, any> = { status: prev.status ?? 'Submitted' }
  const unset: Record<string, string> = {}
  for (const f of FIELDS) {
    if (f === 'status') continue
    const v = prev[f as Field]
    if (v !== undefined) set[f] = v
    else unset[f] = ''
  }
  return Object.keys(unset).length > 0 ? { ...set, $unset: unset } : set
}
```

- [ ] **Step 4: Run the tests, expect PASS.**

- [ ] **Step 5: Change `OnTimesheetTaskUpdate`** (`index.ts`)

Imports: `import { isRecall, previousTaskState, restoreOps } from './task-guard'`; add `canActOnTimesheetTask` to the `@hcengineering/yg-timesheet` import; `tracker` is already imported.

Add a helper near `approverRoleSet`:

```ts
// PM/TL refs of the project the task's ISSUE lives in. The issue's space is server truth; the task's
// own `project` / `approvers` fields are client-writable and never trusted for authorization.
async function taskProjectApprovers (control: TriggerControl, task: TimesheetTask): Promise<Array<Ref<Employee>>> {
  const issue = (await control.findAll(control.ctx, tracker.class.Issue, { _id: task.issue }, { limit: 1 }))[0]
  if (issue === undefined) return []
  const project = (await control.findAll(control.ctx, tracker.class.Project, { _id: issue.space as Ref<Project> }, { limit: 1 }))[0]
  if (project === undefined) return []
  const pa = control.hierarchy.as(project, ygTimesheet.mixin.ProjectApprovers)
  return [...asRefArray(pa.pm), ...asRefArray(pa.teamLead)]
}

// HR = member of the HrData space (same signal as yg-hr's isHrAuthorized).
async function isHrMember (control: TriggerControl): Promise<boolean> {
  const hr = (await control.findAll(control.ctx, core.class.Space, { _id: ygTimesheet.space.HrData }, { limit: 1 }))[0]
  return hr !== undefined && (hr.members ?? []).includes(control.ctx.contextData.account.uuid)
}
```

(Import `type Project` from `@hcengineering/tracker` if missing.)

In the trigger loop:
1. Accept `Submitted` too: `if (statusOp !== 'Approved' && statusOp !== 'Rejected' && statusOp !== 'Submitted') continue`.
2. After loading `task`, load its history and compute the previous state:

```ts
    const creates = await control.findAll(control.ctx, core.class.TxCreateDoc, { objectId: task._id }, { limit: 1 })
    const updates = await control.findAll<TxUpdateDoc<TimesheetTask>>(control.ctx, core.class.TxUpdateDoc, { objectId: task._id }, {})
    const prev = previousTaskState(creates[0] as any, updates as any, utx._id)
    const recall = isRecall(statusOp, prev)
    if (statusOp === 'Submitted' && !recall) continue // not a recall: nothing to guard here
```

3. Replace the `authorized` computation with:

```ts
    const authorized = canActOnTimesheetTask({
      actor: actorId,
      owner,
      isAdmin,
      isHr: await isHrMember(control),
      projectApprovers: await taskProjectApprovers(control, task)
    })
```

4. Authorized branch: keep the existing approval stamp (only when `statusOp === 'Approved'`) and the existing approve/reject notification, but SKIP the notification when `recall` (no notification on recall). Then `continue`.
5. Unauthorized branch: keep the warn (add `recall` to its fields) and replace the compensating writes with an exact restore:

```ts
    const revertTxes: Tx[] = [
      control.txFactory.createTxUpdateDoc(task._class, task.space, task._id, restoreOps(prev) as any, false, Date.now(), core.account.System)
    ]
    const approvalRow = (
      await control.findAll(control.ctx, ygTimesheet.class.TimesheetApproval, { task: task._id }, { limit: 1 })
    )[0]
    if (prev.status === 'Approved' && prev.approvedHours !== undefined) {
      // The previous state was approved: its payroll row must match it (recreate if the forged
      // recall deleted it, or reset forged hours on it).
      const row = { task: task._id, approvedHours: prev.approvedHours, approvedBy: prev.approvedBy, approvedOn: prev.approvedOn }
      revertTxes.push(approvalRow === undefined
        ? control.txFactory.createTxCreateDoc(ygTimesheet.class.TimesheetApproval, ygTimesheet.space.Approvals, row as any, undefined, Date.now(), core.account.System)
        : control.txFactory.createTxUpdateDoc(approvalRow._class, approvalRow.space, approvalRow._id, row as any, false, Date.now(), core.account.System))
    } else if (approvalRow !== undefined) {
      // IMPORTANT D (unchanged): a task that is not approved must not keep a payroll row.
      revertTxes.push(control.txFactory.createTxRemoveDoc(approvalRow._class, approvalRow.space, approvalRow._id, Date.now(), core.account.System))
    }
    await control.apply(control.ctx, revertTxes)
```

6. If `lazyApproverRoleSet`/`getApproverSet` is no longer used in this trigger, remove the local `getApproverSet` variable (keep the helper functions if other triggers use them).
7. Update the comment block above the trigger: it now guards recall, scopes authorization to the issue's project approvers + HR + admin, and restores the exact previous state. Keep the KNOWN SECURITY GAP banner (still true for direct `TimesheetApproval` writes).

- [ ] **Step 6: Run** `cd server-plugins/yg-timesheet-resources && npx jest && npm run _phase:validate`. Expected: all PASS (existing 56 + new), validate exit 0.

- [ ] **Step 7: Record changed files (no commit).**

---

### Task 3: Client recall and its confirm popup

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/day.ts` (add `recallTask` after `rejectTask`)
- Create: `plugins/yg-timesheet-resources/src/components/RecallTaskPopup.svelte`

**Interfaces:**
- Consumes: `TimesheetRejectCycle.recalledOn/recalledBy`, strings `Recall`, `RecallApprovalConfirm`, `RecallRejectionConfirm` (Task 1).
- Produces: `async function recallTask (client: TxOperations, task: TimesheetTask, employee?: Ref<Employee>): Promise<void>`; `RecallTaskPopup` props `{ identifier: string, employeeName: string, dateLabel: string, wasApproved: boolean }`, closes with `{ confirmed: true }` or nothing.

- [ ] **Step 1: Add `recallTask`** to `utils/day.ts` (reuses the file's `resolveTaskEmployee` and imports):

```ts
/**
 * Recall an approval or rejection (Reports page). The task goes back to Submitted (pending
 * approval) with its approval fields cleared. ORDER MATTERS: the TimesheetApproval row is removed
 * FIRST; if the server then reverts an unauthorized recall it recreates the row, and nothing here
 * runs afterwards to delete it again. A recalled rejection's open TimesheetRejectCycle is closed
 * with recalledOn/recalledBy so the employee is no longer asked to fix it. No notification.
 */
export async function recallTask (
  client: TxOperations,
  task: TimesheetTask,
  employee?: Ref<Employee>
): Promise<void> {
  const approval = await client.findOne(ygTimesheet.class.TimesheetApproval, { task: task._id })
  if (approval !== undefined) await client.remove(approval)
  await client.updateDoc(ygTimesheet.class.TimesheetTask, core.space.Workspace, task._id, {
    status: 'Submitted',
    $unset: { approvedHours: '', approvedBy: '', approvedOn: '', rejectReason: '' }
  })
  if (task.status !== 'Rejected') return
  const owner = employee ?? (await resolveTaskEmployee(client, task))
  if (owner === undefined) return
  const cycles = await client.findAll(ygTimesheet.class.TimesheetRejectCycle, { employee: owner, issue: task.issue, date: task.date })
  const now = Date.now()
  for (const c of cycles) {
    if (c.resubmittedOn != null || c.recalledOn != null) continue
    await client.updateDoc(ygTimesheet.class.TimesheetRejectCycle, core.space.Workspace, c._id, {
      recalledOn: now,
      recalledBy: getCurrentEmployee()
    })
  }
}
```

- [ ] **Step 2: Create `RecallTaskPopup.svelte`**, matching `RejectTaskPopup.svelte`'s markup and styles (copy its `<style>` block and dialog structure verbatim, including the license header):

```svelte
<script lang="ts">
  //
  // Confirm before recalling an approval or rejection: the task goes back to pending approval.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  export let identifier: string
  export let employeeName: string
  export let dateLabel: string
  export let wasApproved: boolean

  const dispatch = createEventDispatcher()
  $: params = { identifier, employee: employeeName, date: dateLabel }
</script>

<div class="dialog">
  <div class="dialog__head">
    <div class="dialog__title"><Label label={ygTimesheet.string.Recall} /></div>
    <div class="dialog__sub">{identifier} · {employeeName} · {dateLabel}</div>
  </div>
  <div class="dialog__body">
    <Label
      label={wasApproved ? ygTimesheet.string.RecallApprovalConfirm : ygTimesheet.string.RecallRejectionConfirm}
      {params}
    />
  </div>
  <div class="dialog__foot">
    <button class="yg-btn yg-btn--ghost" on:click={() => dispatch('close', undefined)}>
      <Label label={ui.string.Cancel} />
    </button>
    <button class="yg-btn yg-btn--danger" on:click={() => dispatch('close', { confirmed: true })}>
      <Label label={ygTimesheet.string.Recall} />
    </button>
  </div>
</div>
```

- [ ] **Step 3: Validate**: `cd plugins/yg-timesheet-resources && npm run _phase:validate && npx jest` (svelte-check if available: no new errors). Expected: exit 0, all PASS.

- [ ] **Step 4: Record changed files (no commit).**

---

### Task 4: Reports table: Action column, Status column removed, exports updated

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Reports.svelte`
- Modify: `plugins/yg-timesheet-resources/src/utils/reports.ts` (`ReportRow`, CSV header and row) and `utils/report-xlsx.ts` (drop the Status column)
- Create: `plugins/yg-timesheet-resources/src/utils/report-actions.ts`
- Test: `plugins/yg-timesheet-resources/src/__tests__/report-actions.test.ts`; update `__tests__/reports.test.ts` for the CSV change

**Interfaces:**
- Consumes: `canActOnTimesheetTask`, `reportTaskAction` (Task 1); `recallTask`, `RecallTaskPopup` (Task 3); `approveTask`, `rejectTask`, `ApproveTaskPopup`, `RejectTaskPopup` (existing).
- Produces (`report-actions.ts`):
  - `interface TaskRef { id: string, employee: string, issue: string, start: number, status: TaskStatus }`
  - `function indexTasks (tasks: TaskRef[]): Map<string, TaskRef[]>` (key `${employee}|${issue}`)
  - `function taskForRow (index: Map<string, TaskRef[]>, employee: string, issue: string, date: number): TaskRef | undefined` (same absolute 24 h window as today's approved lookup)

- [ ] **Step 1: Failing tests** (`__tests__/report-actions.test.ts`)

```ts
import { indexTasks, taskForRow } from '../utils/report-actions'

const DAY = 86_400_000
const t0 = Date.UTC(2026, 8, 29) - 330 * 60000 // IST midnight 29 Sep
const tasks = [
  { id: 'task-a', employee: 'e1', issue: 'i1', start: t0, status: 'Approved' as const },
  { id: 'task-b', employee: 'e1', issue: 'i1', start: t0 + DAY, status: 'Submitted' as const }
]

describe('taskForRow', () => {
  const idx = indexTasks(tasks)
  it('two time entries of the same task and day resolve to the same task', () => {
    expect(taskForRow(idx, 'e1', 'i1', t0 + 2 * 3_600_000)?.id).toBe('task-a')
    expect(taskForRow(idx, 'e1', 'i1', t0 + 20 * 3_600_000)?.id).toBe('task-a')
  })
  it('the next day maps to that day\'s task', () => {
    expect(taskForRow(idx, 'e1', 'i1', t0 + DAY + 3_600_000)?.id).toBe('task-b')
  })
  it('no task for an unsubmitted entry or another person', () => {
    expect(taskForRow(idx, 'e1', 'i1', t0 + 5 * DAY)).toBeUndefined()
    expect(taskForRow(idx, 'e2', 'i1', t0)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, expect FAIL**, then create `utils/report-actions.ts`:

```ts
//
// Reports Action column: find the approval item (TimesheetTask) a time-entry row belongs to.
// Matches employee + issue and an ABSOLUTE 24 h window from the task's day start (the same rule
// the Approved column already uses, see the comment in Reports.svelte).
//
import type { TaskStatus } from '@hcengineering/yg-timesheet'
import { withinDay } from './week'

export interface TaskRef {
  id: string
  employee: string
  issue: string
  start: number
  status: TaskStatus
}

export function indexTasks (tasks: TaskRef[]): Map<string, TaskRef[]> {
  const m = new Map<string, TaskRef[]>()
  for (const t of tasks) {
    const k = `${t.employee}|${t.issue}`
    const list = m.get(k)
    if (list === undefined) m.set(k, [t])
    else list.push(t)
  }
  return m
}

export function taskForRow (index: Map<string, TaskRef[]>, employee: string, issue: string, date: number): TaskRef | undefined {
  return index.get(`${employee}|${issue}`)?.find((t) => withinDay(t.start, date))
}
```

- [ ] **Step 3: Reports.svelte**
  1. **Load every task, not only approved.** Change the `taskInfoQuery` to `{ status: { $in: ['Submitted', 'Approved', 'Rejected', 'Draft'] } }`, keep the whole `TimesheetTask` in a `tasksById: Map<string, TimesheetTask>`, and keep `approvedByEmpIssue` built only from `status === 'Approved'` tasks with `approvedHours` (the Approved / Approved-by columns must not change).
  2. Build `taskIndex = indexTasks([...])` from all loaded tasks whose employee resolves through `dayTimesheet`/`tsEmployee` (unresolved: skip, fail safe as today).
  3. Who am I: `const me = getCurrentEmployee()`; `isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)`; `isHr` from a live query of `core.class.Space` `{ _id: ygTimesheet.space.HrData }` (`members` includes `getCurrentAccount().uuid`); project approvers from a live query of `tracker.class.Project` with `client.getHierarchy().as(p, ygTimesheet.mixin.ProjectApprovers)` into `approversByProject: Map<string, Array<Ref<Employee>>>` (pm and teamLead arrays, missing = []).
  4. Per row: `const t = taskForRow(taskIndex, r.employee, r.issue, r.date)`; `action = reportTaskAction(t?.status)`; `allowed = canActOnTimesheetTask({ actor: me, owner: r.employee as Ref<Employee>, isAdmin, isHr, projectApprovers: approversByProject.get(r.project) ?? [] })`. (`r.project` is the issue's space, so this matches the server.)
  5. **Remove the Status column**: the `<th>` for status (and its sort arrow) and the status `<td>` with the chip. Keep the Status FILTER control above the table and `statusName` in rows (the filter uses it). Remove `'status'` from `SortKey` and its comparator branch; remove `statusChipVariant` and the `.schip` styles if nothing else uses them.
  6. **Add the Action column** as the last `<th class="left"><Label label={ygTimesheet.string.Action} /></th>` and cell:

```svelte
<td class="left">
  {#if action === 'none'}
    <span class="rp-muted"><Label label={ygTimesheet.string.NotSubmitted} /></span>
  {:else if !allowed}
    <span class="rp-muted">-</span>
  {:else if action === 'approve-reject'}
    <span class="rp-actions">
      <button class="rp-act" disabled={busy.has(t.id)} on:click={() => onApprove(t, r)}><Label label={ygTimesheet.string.Approve} /></button>
      <button class="rp-act rp-act--danger" disabled={busy.has(t.id)} on:click={() => onReject(t, r)}><Label label={ygTimesheet.string.Reject} /></button>
    </span>
  {:else}
    <button class="rp-act rp-act--danger" disabled={busy.has(t.id)} on:click={() => onRecall(t, r)}><Label label={ygTimesheet.string.Recall} /></button>
  {/if}
</td>
```

     (Compute `t`, `action`, `allowed` per row with a small helper function called in the `{#each}`, e.g. `rowAction(r)` returning `{ t, action, allowed }`, since Svelte has no per-row `$:`. `ygTimesheet.string.Approve`, `.Reject` and `.Recall` already exist.) Update the footer `colspan` so totals still align.
  7. Handlers, copied from `Approvals.svelte`'s `onApprove` / `onReject` (same popups, same `approveTask` / `rejectTask` calls and success notifications; pass `tasksById.get(t.id)` as the task). `onRecall` opens `RecallTaskPopup` with `{ identifier: r.identifier, employeeName: r.employeeName, dateLabel: dateFmt.format(r.date), wasApproved: t.status === 'Approved' }` and on `{ confirmed: true }` calls `recallTask(client, task, r.employee as Ref<Employee>)`. Track `busy: Set<string>` (task ids) while a call runs; on error call `setPlatformStatus(unknownError(err))` as the file already does.
  8. Styles: `.rp-actions { display: inline-flex; gap: 6px; }`, `.rp-act` compact text button using the page's existing button tokens, `.rp-act--danger` with the page's danger colour.

- [ ] **Step 4: Exports drop Status**: in `utils/reports.ts` remove `'Status'` from the CSV header (~line 69) and `escText(r.statusName),` from the row (~line 86); in `utils/report-xlsx.ts` remove the `{ column: 'Status', ... }` entry. Update `__tests__/reports.test.ts` expectations for the CSV header/rows accordingly (the `statusName` filter tests stay).

- [ ] **Step 5: Run** `cd plugins/yg-timesheet-resources && npx jest && npm run _phase:validate` (and svelte-check: no new errors). Expected: all PASS.

- [ ] **Step 6: Record changed files (no commit).**

---

### Task 5: Beta build, upgrade and end-to-end checks

**Files:** none new. Beta: `huly-migration/huly-selfhost`, compose project `huly_v7`, portal `http://localhost:8087`, REST `http://localhost:8087/_transactor/api/v1`.

- [ ] **Step 1: Build and deploy**: `YG_HULY_REPO=/home/karthi_0008/dev/client-projects/yg-huly-beta ./build-beta.sh`, confirm `branch: yg_beta`, run the printed recreate (transactor account front workspace) and nginx restart, then `./run-tool-beta.sh upgrade-workspace yg` (model change).
- [ ] **Step 2: Server checks over REST** (admin token from `./run-tool-beta.sh generate-token admin@local yg`, a non-approver USER token from `./run-tool-beta.sh generate-token jeya.youngglobes@gmail.com yg`; tx `modifiedBy` = the caller's social id):
  - Create a test approval: as admin (who is not the owner), approve a demo task of `Mukesh Test` (seeded sessions have no TimesheetTask; create a submitted day via REST the way `submitDay` does, or submit through the UI as the employee is not possible, so create one `TimesheetTask` row with `status: 'Submitted'` under a TimesheetDay for that employee and date). Then:
  - Non-approver recall (USER token: `status: 'Submitted'` on the approved task): reverted within about a minute to Approved with the same hours/approver, and the `TimesheetApproval` row exists again.
  - Admin recall: sticks; task Submitted, approval fields cleared, row gone.
  - Non-approver approve: reverted to the exact previous state (Submitted).
  - Reject then admin recall: task Submitted, the open `TimesheetRejectCycle` gets `recalledOn` / `recalledBy`.
  - Clean up everything created (tasks, days, cycles, approvals) and restore any shift/approver assignments changed.
- [ ] **Step 3: UI (browser, if available; otherwise list for the user)**: Reports page shows no issue Status column and an Action column; a pending task shows Approve / Reject (popups as on Approvals); an approved task shows Recall with the confirm text; after Recall the row shows Approve / Reject again and the Approved column clears; a user who is not an approver of that project sees "-"; unsubmitted entries show "Not submitted"; CSV and Excel exports have no Status column.
- [ ] **Step 4: Report** per step (commands, relevant output, PASS/FAIL) to the SDD workspace report file named in the dispatch.
