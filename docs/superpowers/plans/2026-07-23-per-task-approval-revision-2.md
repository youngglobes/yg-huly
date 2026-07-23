# Per-Task Approval — Revision 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any assigned PM or Team Lead (or admin) may approve any task, with the approver recorded; approved hours are visible only to PM/TL/admin, never to the employee.

**Architecture:** Authorization becomes a **role check** — "is this actor assigned as PM or Team Lead on any project" — instead of a per-task data lookup, which removes the class of bypass that data-driven authorization kept re-opening. The payroll-relevant fields (`approvedHours`, `approvedBy`, `approvedOn`) move out of the shared space into a **private `Approvals` space** whose members are the approvers, so a non-member's write or read is refused by the server outright rather than caught after the fact by an enumerating trigger.

**Tech Stack:** Huly platform (Rush monorepo, pnpm, Svelte, TypeScript), `@hcengineering/{core,model,model-core,contact,tracker,presentation,ui,server-core}`, ts-jest. Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`).

## Status of the previous plan

`docs/superpowers/plans/2026-07-23-per-task-timesheet-approval.md` Tasks 1–4 are **complete and
committed** (pure lib, `TimesheetTask` model, submit path, migration). Task 5 is committed but
**superseded** by this plan. Tasks 6–10 were never started and are re-specified here.

## Global Constraints

- **Branch:** all commits on `yg_beta`; pushing to `origin/yg_beta` is fine (demo branch). **Never merge to `yg_develop`** — that is the branch CI builds and auto-deploys to production.
- **Spec:** `docs/superpowers/specs/2026-07-22-per-task-timesheet-approval-design.md`, **REVISION 2 section** — it supersedes the authorization model in the body of that document.
- **Build:** package scripts `node ../../common/scripts/install-run-rushx.js <script>`; repo-wide `node common/scripts/install-run-rush.js build --to <pkg>`. Tests `rushx test`. Svelte types `rushx svelte-check`.
- **`svelte-check` is mandatory** on any task touching `.svelte`. Known pre-existing baseline that is NOT yours: 3 `$lookup` errors in `Timesheet.svelte`/`Approvals.svelte`, 21 errors in `text-editor-resources`.
- **Cross-project approval is INTENDED, not a defect.** Any assigned PM/TL may approve any task — a TL covering for an absent one is the motivating case.
- **Self-approval is forbidden for everyone**, including admins. The employee whose timesheet it is may never approve their own task.
- **Employees must never see `approvedHours`**, including their own.
- **`approvedBy` / `approvedOn` are stamped by the server**, never accepted from a client. Attribution is the point of this feature.
- **Approval never mutates the employee's logged time** — `TimeSpendReport` stays their record.
- `@hcengineering/yg-timesheet`'s generated `types/index.d.ts` is gitignored and goes stale; rebuild that package first if you hit spurious `TimesheetTask`/`TaskStatus` type errors.
- Existing suite is **103 passing** and must not regress.

---

## Field split — read this before starting

| Field | Space | Rationale |
|---|---|---|
| `date`, `issue`, `identifier`, `title`, `project`, `submittedHours`, `status`, `approvers`, `submittedOn`, `rejectReason` | shared `Timesheets` | the employee must see their own task, its status and why it was rejected |
| **`approvedHours`, `approvedBy`, `approvedOn`** | **private `Approvals`** | payroll-relevant; employees must not see them, and a non-member's write is refused by the server |

`status` deliberately stays in the shared space because the employee has to see it. It is therefore
still trigger-guarded (a simple role check). The **numbers** are structurally protected by the space
boundary; the **status** is trigger-protected. A forged status without a matching approval record
shows as approved-with-blank-hours in the PM report and is reverted by the trigger — misleading for
a moment, but it cannot move money.

---

### Task 1: Authorization becomes a role check

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/task-approval.ts`
- Modify: `plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts`

**Interfaces:**
- Produces: `canApproveTask (isApproverRole: boolean, employee: string, actor: string, isAdmin: boolean): boolean` — **signature changed**; it no longer takes the task's approver list.
- `buildTaskUnits` is unchanged in behaviour; only its documentation changes (the `approvers` it stamps are now notification routing, not authorization).

- [ ] **Step 1: Invert the two defect tests and update the rest**

In `plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts`, DELETE the test named
`canApproveTask: only this task approvers, never the employee` and replace it with:

```ts
test('any assigned PM/TL may approve any task — cross-project is INTENDED', () => {
  // TL-B is not this task's project lead, but is an assigned approver somewhere. Allowed:
  // covering for an absent lead is the motivating case for this rule.
  expect(canApproveTask(true, 'k2', 'tl-b', false)).toBe(true)
  expect(canApproveTask(true, 'k2', 'tl-a', false)).toBe(true)
})

test('someone with no approver role cannot approve, even for their own project', () => {
  expect(canApproveTask(false, 'k2', 'random-dev', false)).toBe(false)
})

test('self-approval is forbidden for everyone, including admins', () => {
  expect(canApproveTask(true, 'k2', 'k2', false)).toBe(false)
  expect(canApproveTask(true, 'k2', 'k2', true)).toBe(false)
})

test('admins may approve without an approver role', () => {
  expect(canApproveTask(false, 'k2', 'some-admin', true)).toBe(true)
})
```

Also update the test named `THE DEFECT: each unit carries ONLY its own project approvers` — the
assertions stay EXACTLY as they are (the per-project stamping behaviour is unchanged), but rename it
to:

```ts
test('each unit is stamped with its own project approvers — for NOTIFICATION routing', () => {
```

- [ ] **Step 2: Run — verify the new tests fail**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- task-approval
```

Expected: FAIL — `canApproveTask` still has the old arity/semantics.

- [ ] **Step 3: Rewrite `canApproveTask`**

In `plugins/yg-timesheet-resources/src/utils/task-approval.ts`, replace `canApproveTask` with:

```ts
/**
 * May this actor approve/reject this task?
 *
 * REVISION 2 (2026-07-23): authorization is a ROLE check, not a per-project one. Any employee
 * assigned as PM or Team Lead on ANY project may approve ANY task — when a project's own lead is
 * away, another lead who knows the work must be able to sign it off. What the business needs is
 * ATTRIBUTION (who approved), not prevention.
 *
 * Deliberately does NOT consult the task's stored `approvers` list: that field is client-writable
 * and is only notification routing. Authorization must never depend on data an attacker can write.
 *
 * `isApproverRole` is derived server-side from the ProjectApprovers assignments; the caller must
 * not compute it from anything the acting user controls.
 */
export function canApproveTask (
  isApproverRole: boolean, employee: string, actor: string, isAdmin: boolean
): boolean {
  if (actor === employee) return false // no self-approve, ever — not even admins
  return isAdmin || isApproverRole
}
```

Update the doc comment on `buildTaskUnits` so its `approvers` output is described as **notification
routing**, not authorization.

- [ ] **Step 4: Run — verify they pass**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test
```

Expected: all pass (103 total, with the replaced tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/task-approval.ts \
        plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts
git commit -m "yg-timesheet: authorization is a role check; cross-project approval is intended"
```

---

### Task 2: Private `Approvals` space + `TimesheetApproval` doc

Moves the payroll-relevant fields out of the shared space so the server refuses them to
non-approvers — structurally, not by enumeration.

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts`
- Modify: `models/yg-timesheet/src/index.ts`
- Modify: `models/yg-timesheet/src/migration.ts`
- Modify: `plugins/yg-timesheet-assets/lang/en.json`, `ru.json`

**Interfaces:**
- Produces: `ygTimesheet.space.Approvals`; `ygTimesheet.class.TimesheetApproval`;
  `interface TimesheetApproval extends Doc { task: Ref<TimesheetTask>, approvedHours: number, approvedBy: Ref<Employee>, approvedOn: Timestamp }`.

- [ ] **Step 1: Add the interface and ids**

In `plugins/yg-timesheet/src/index.ts`, add:

```ts
/**
 * The approval overlay for one task. Lives in the PRIVATE ygTimesheet.space.Approvals so employees
 * cannot read it — approved hours are for the PM-report audience and are discussed with the
 * employee at the weekly meeting, not shown on their own sheet.
 */
export interface TimesheetApproval extends Doc {
  task: Ref<TimesheetTask>
  approvedHours: number
  approvedBy: Ref<Employee>
  approvedOn: Timestamp
}
```

REMOVE `approvedHours`, `approvedBy` and `approvedOn` from the `TimesheetTask` interface — they now
live on `TimesheetApproval`. Keep `status`, `rejectReason`, `approvers` and the rest.

Add to the plugin block — under `class`: `TimesheetApproval: '' as Ref<Class<TimesheetApproval>>`;
under `space`: `Approvals: '' as Ref<Space>`.

- [ ] **Step 2: Add the model class and drop the moved Props**

In `models/yg-timesheet/src/index.ts`, delete the `approvedHours`, `approvedBy` and `approvedOn`
`@Prop` lines from `TTimesheetTask`, and add:

```ts
@Model(ygTimesheet.class.TimesheetApproval, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TTimesheetApproval extends TDoc implements TimesheetApproval {
  @Prop(TypeRef(ygTimesheet.class.TimesheetTask), core.string.Object) task!: Ref<TimesheetTask>
  @Prop(TypeNumber(), core.string.Object) approvedHours!: number
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) approvedBy!: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) approvedOn!: Timestamp
}
```

Register it: `builder.createModel(TTimesheet, TTimesheetDay, TTimesheetTask, TTimesheetApproval, TProjectApprovers, THrTimeEntry)`.

- [ ] **Step 3: Create the private space in the migration**

The space MUST be created as a real domain space via migration, not `builder.createDoc` into
`core.space.Model` — a model-defined space is invisible to clients. This is the same trap the HR
space hit; copy the working `createHrSpace` pattern in this same file.

In `models/yg-timesheet/src/migration.ts`, add and call:

```ts
// Private space holding the approval overlay (approved hours + who approved). Members are the
// assigned PMs/TLs and admins — maintained by OnProjectApproversChange (Task R3). Private so the
// server refuses every row to a non-member: employees must not see approved hours.
async function createApprovalsSpace (tx: TxOperations): Promise<void> {
  const existing = await tx.findOne(core.class.Space, { _id: ygTimesheet.space.Approvals })
  if (existing !== undefined) return
  await tx.createDoc(
    core.class.Space,
    core.space.Space,
    {
      name: 'Timesheet Approvals',
      description: 'Approved hours + approver attribution. Members = assigned PMs/TLs.',
      private: true,
      archived: false,
      members: [],
      owners: [],
      autoJoin: false
    },
    ygTimesheet.space.Approvals
  )
}
```

- [ ] **Step 4: Migrate existing approval data out of the task rows**

Extend the existing `migrateDaysToTasks` migration (added by the previous plan's Task 4) so that any
task it creates with status `Approved` ALSO gets a `TimesheetApproval` row in the new space carrying
the same `approvedHours`/`approvedBy`/`approvedOn`, and those fields are no longer written onto the
task itself. Keep the existing idempotency guard.

- [ ] **Step 5: Build**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-timesheet
```

- [ ] **Step 6: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts models/yg-timesheet/src/index.ts models/yg-timesheet/src/migration.ts
git commit -m "yg-timesheet: move approval overlay into a private Approvals space"
```

---

### Task 3: Server enforcement — role check, self-approval bar, attribution

Replaces the superseded `OnTimesheetTaskUpdate`. Far smaller than the old one, because the payroll
fields are now protected by the space boundary rather than by enumerating dangerous operations.

**Files:**
- Modify: `server-plugins/yg-timesheet-resources/src/index.ts`
- Modify: `models/server-yg-timesheet/src/index.ts`

**Interfaces:**
- Produces: a rewritten `OnTimesheetTaskUpdate`, plus `OnProjectApproversChange` maintaining
  `Approvals` space membership.

- [ ] **Step 1: Rewrite the task trigger**

Replace the entire body of `OnTimesheetTaskUpdate` (keep the exported name) with a role-based check:

```ts
//
// REVISION 2 authorization. Any employee assigned as PM or Team Lead on ANY project may approve any
// task; admins too; the timesheet's own employee never may. Attribution — not prevention — is the
// requirement, so the server stamps who approved.
//
// The approver ROLE is derived from the ProjectApprovers assignments, which only admins/project
// owners may edit. It is NEVER read from the task's own `approvers` field: that is client-writable
// and is only notification routing.
//
async function approverRoleSet (control: TriggerControl): Promise<Set<Ref<Employee>>> {
  const projects = await control.findAll(control.ctx, tracker.class.Project, {})
  const set = new Set<Ref<Employee>>()
  for (const p of projects) {
    const pa = control.hierarchy.as(p, ygTimesheet.mixin.ProjectApprovers)
    if (pa.pm != null) set.add(pa.pm)
    if (pa.teamLead != null) set.add(pa.teamLead)
  }
  return set
}
```

Then in the trigger, for any non-System `TxUpdateDoc` on a `TimesheetTask` whose operations set
`status` to `Approved` or `Rejected`: resolve the actor via `getEmployee(control, tx.modifiedBy)`,
resolve the timesheet owner via the task's day → timesheet, compute
`isAdmin = hasAccountRole(control.ctx.contextData.account, AccountRole.Maintainer)`, and allow only
when `owner` resolved AND `actor !== owner` AND (`isAdmin` OR `approverRoleSet` contains the actor).
On denial, revert `status` to `'Submitted'`, `$unset` `rejectReason`, and `control.ctx.warn` naming
the task, actor and reason. Keep the existing top-of-loop
`if (tx.modifiedBy === core.account.System) continue` guard — every compensating write must pass
`core.account.System` as the `modifiedBy` argument or the trigger re-enters itself endlessly.

The trigger no longer needs to guard `approvedHours`/`approvedBy`/`approvedOn` — those fields are
not on this document any more, and the space boundary refuses non-member writes to the approval doc.

- [ ] **Step 2: Maintain `Approvals` space membership**

Add a trigger keeping the private space's members in step with the PM/TL assignments, so a newly
assigned lead can immediately read approvals:

```ts
// Membership of the private Approvals space = every assigned PM/TL. Reconciles on any change to a
// project's ProjectApprovers mixin. Idempotent; System-authored so it cannot re-enter itself.
export async function OnProjectApproversChange (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx.modifiedBy === core.account.System) continue
    const roles = await approverRoleSet(control)
    const space = (
      await control.findAll(control.ctx, core.class.Space, { _id: ygTimesheet.space.Approvals }, { limit: 1 })
    )[0]
    if (space === undefined) continue
    const wanted = new Set<AccountUuid>()
    for (const ref of roles) {
      const emp = (await control.findAll(control.ctx, contact.mixin.Employee, { _id: ref }, { limit: 1 }))[0]
      if (emp?.personUuid != null) wanted.add(emp.personUuid)
    }
    const current = new Set(space.members)
    if (wanted.size === current.size && [...wanted].every((m) => current.has(m))) continue
    const t = control.txFactory.createTxUpdateDoc(
      space._class, space.space, space._id, { members: [...wanted] } as any,
      false, Date.now(), core.account.System
    )
    await control.apply(control.ctx, [t])
  }
  return []
}
```

Declare `OnProjectApproversChange` in `server-plugins/yg-timesheet/src/index.ts`'s `trigger` block,
add it to the resources default export, and register it in `models/server-yg-timesheet/src/index.ts`
with `txMatch: { objectClass: tracker.class.Project }`.

- [ ] **Step 3: Build**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/model-server-yg-timesheet --to @hcengineering/server-yg-timesheet-resources
```

- [ ] **Step 4: Commit**

```bash
git add server-plugins/ models/server-yg-timesheet/
git commit -m "yg-timesheet: role-based approval enforcement + Approvals space membership"
```

---

### Task 4: Assign PM and Team Lead in project settings

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/ProjectApproversList.svelte` (the component registered as `ProjectApproversEditor`)
- Modify: `models/yg-timesheet/src/index.ts` (attach the editor to the project settings panel)

- [ ] **Step 1: Two person selectors, like Owners / Members**

Render two labelled `UserBox` (single-select employee) controls — **PM** and **Team Lead** — writing
`pm` and `teamLead` on the project's `ProjectApprovers` mixin, presented the way the stock project
settings renders Owners and Members. Use the existing `ygTimesheet.string.PM` and
`ygTimesheet.string.TeamLead` labels.

- [ ] **Step 2: Restrict who may assign**

**This is load-bearing for the whole security model.** Since being a PM/TL now grants approval
rights over every timesheet, assignment must be restricted to admins/project owners — otherwise a
member can promote themselves and defeat the role check. Gate the editor with
`hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)` and confirm the mixin write is refused
server-side for non-admins; if it is not, add that guard to `OnProjectApproversChange`.

- [ ] **Step 3: Build + svelte-check**

```bash
cd plugins/yg-timesheet-resources
node ../../common/scripts/install-run-rushx.js build
node ../../common/scripts/install-run-rushx.js svelte-check
```

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/ProjectApproversList.svelte models/yg-timesheet/src/index.ts
git commit -m "yg-timesheet: assign PM/Team Lead from project settings (admin-only)"
```

---

### Task 5: Approve / reject popups

Same as the superseded plan's Task 6 — create `ApproveTaskPopup.svelte` (captures approved hours,
defaulting to the submitted hours) and `RejectTaskPopup.svelte` (requires a reason), register both
in `plugins/yg-timesheet-resources/src/index.ts`, use the stock `ui.string.Cancel`, and run
`svelte-check` confirming no error names either new file. Approving writes a `TimesheetApproval` doc
in `ygTimesheet.space.Approvals` **and** sets the task's `status` to `Approved`; the server stamps
`approvedBy`/`approvedOn`.

---

### Task 6: Approvals queue

**Files:** `plugins/yg-timesheet-resources/src/components/Approvals.svelte`

The queue no longer filters by `approvers: me` — **any assigned PM/TL sees every submitted task**,
because any of them may approve. Query
`{ space: core.space.Workspace, status: 'Submitted' }` on `ygTimesheet.class.TimesheetTask`, sorted
by date then identifier, and show the employee, date, identifier, title and submitted hours with
Approve / Reject actions per row. Non-approvers must not reach this view at all — gate it on the
same role check. Run `svelte-check`.

---

### Task 7: Derived day status across the surfaces

Unchanged from the superseded plan's Task 8: `Timesheet.svelte`, `HrTimesheet.svelte` and
`HrOverview.svelte` compute the day label with `deriveDayStatus` over the day's tasks instead of
reading the deprecated `TimesheetDay.status`, and render the new `PartiallyApproved` state in amber.

**This task also closes a regression carried since the previous plan's Task 3:** `submitDay` stopped
writing `TimesheetDay.status`, so the Recall button — which renders only when the day's status is
`Submitted` — is currently unreachable. Deriving the status restores it. Verify Recall works.

`Timesheet.svelte` must show each task's own status and its `rejectReason` when rejected, and must
**never** display approved hours.

---

### Task 8: PM report columns

Unchanged in intent from the superseded plan's Task 9, with one difference: `approvedHours` and
`approvedBy` are read from the `TimesheetApproval` docs in the private space, not from the task.
Users without access to that space see the columns blank, which is correct — the PM report is the
approver audience's view. `Client Approved Hours` / `Client Approved By` stay manual.

---

### Task 9: Local end-to-end

Rebuild **all four** images (model + server trigger changed) and `upgrade-workspace testws`, per the
recipe in the superseded plan's Task 10 Step 1. Login is OTP-only; read the code from
`global_account.otp` (it expires in 60s).

Gates:
- (a) **Cross-project approval works**: TL-B approves a task on TL-A's project. This is now the
  intended behaviour — it must succeed.
- (b) **Attribution**: that task's `TimesheetApproval` records `approvedBy = TL-B`.
- (c) **Self-approval blocked**: the employee cannot approve their own task, and a direct write is
  reverted by the trigger.
- (d) **Non-approver blocked**: an ordinary employee (no PM/TL assignment) cannot approve, and a
  direct write is reverted.
- (e) **Approved hours are invisible to the employee**: querying `TimesheetApproval` as the employee
  returns 0 rows, and their own timesheet shows status but no hours figure.
- (f) **Approvals space membership** updates when a project's PM/TL assignment changes.
- (g) **Partially approved** renders when one task of a two-task day is approved; **Recall** works.
- (h) **PM report** exports the approved hours and approver for the approved task.
- (i) **Migration**: a pre-existing Approved day yields task rows plus `TimesheetApproval` rows
  carrying the original approver.

Record results in `.superpowers/sdd/hr-timesheet-integration.md`; report failures honestly rather
than narrowing a gate.
