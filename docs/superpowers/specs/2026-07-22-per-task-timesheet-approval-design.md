# Per-Task Timesheet Approval — Design Spec

**Date:** 2026-07-22
**Branch:** `yg_beta` (local + `origin/yg_beta` for demos; NOT deployed to prod, never merged to `yg_develop`)
**Status:** approved in brainstorming, pending implementation plan
**Supersedes:** the day-level approval model built in Phase 1b

## Why — the defect this fixes

`TimesheetDay` carries a **single** `status`, a **single** `approvedBy` and a **single**
`rejectReason`. Its `approvers` field is the *union* of PM + Team Lead across every project
appearing in that day, and `canApprove()` only checks that the actor is somewhere in that union.

So for a day containing two projects led by different people:

> K2 logs Proj-1: 3h (led by TL-A) and Proj-2: 5h (led by TL-B) on the same date.

**TL-A can approve the entire day, including TL-B's 5 hours on Proj-2**, and whoever clicks first
locks the other out. This is an authorization defect, not a UX gap: an approver can sign off work
for a project they do not lead. `snapshot: TimesheetLine[]` records the lines but gives them no
individual status, so there is nowhere to express "Proj-1 approved, Proj-2 still pending".

It surfaced while designing submit notifications: there was no correct way to tell two TLs to go
approve "a day" that only one of them should be touching.

## Goal

Move approval from the day to the **task**, and capture the approver's **agreed hours** at the same
time — so the PM report's approval columns come from data instead of being typed into a spreadsheet.

## Decisions (locked in brainstorming, 2026-07-22)

1. **Approval unit = one issue per day.** Multiple `TimeSpendReport` entries against the same issue
   on the same date collapse into ONE approvable row (e.g. 2h in the morning + 1h after lunch =
   "TSK-1 — 3h", one approve/reject). Chosen over per-`TimeSpendReport` because it is what "two
   tasks in a sheet" means in plain language, it keeps the approver's list short, and it stays
   stable when someone splits their logging across a day.
2. **Submit stays per-day.** One Submit button submits every task on that day. The employee does not
   need granularity; the approver does.
3. **Approve/reject is per-task**, each with its own approver, timestamp and reject reason.
4. **Rejection returns only that task to Draft.** Already-approved sibling tasks are untouched.
5. **Day status is DERIVED, not stored-and-edited** (see State model).
6. **Drift is flagged, never locked** — carrying forward the existing `driftHours()` precedent.
7. **Approved hours are captured at approval time**, defaulting to the submitted hours.
8. **Approval never mutates the employee's logged time.** The `TimeSpendReport` remains the
   employee's record of what they worked; approved hours are an overlay by the approver. A TL
   agreeing to 1h against a submitted 2h does NOT rewrite the employee's 2h.

## State model

Per-task status: `Draft | Submitted | Approved | Rejected`.

Day status is computed from its tasks, never written directly:

| Condition on the day's tasks | Derived day status |
|---|---|
| any task Rejected | **Rejected** |
| all tasks Approved | **Approved** |
| at least one Approved, others not | **Partially Approved** *(new)* |
| any Submitted, none Approved | **Submitted** |
| otherwise | **Draft** |

**`Partially Approved` is a new state that does not exist today.** Every surface rendering a day
status must handle it: the Approvals queue, the HR Overview status row, the HR Timesheet grid, and
the PM report. This is the bulk of the UI cost.

**Derived means computed for display, never queried.** Today `Approvals.svelte` queries
`{ status: 'Submitted', approvers: me }` on `TimesheetDay` — that query cannot survive a status
that is not stored. The Approvals queue therefore queries the **per-task records** instead
(`{ status: 'Submitted', approvers: me }` on the task record), which is also what makes the queue
correct: each approver sees exactly the tasks they may action, never a whole day belonging to
someone else. The derived day status is computed client-side from the task records already loaded,
purely to render a label. No trigger denormalises it onto the day.

The rejected alternative — keep the day binary, Approved only when every task is approved — was
turned down because a day sitting half-approved for a week would look identical to one nobody had
touched, hiding exactly the "who is holding this up" question this change exists to answer.

## Approved hours

When an approver approves a task they confirm an **approved hours** value:

- **Defaults to the submitted hours**, so the common case (agree as logged) is one click.
- The approver may reduce it (the motivating case: "2h submitted, I judge it 1h") or raise it.
- Recorded with **who** approved and **when**.
- Rejection does NOT capture hours — it captures a **reason** (free text, required).

Consequence to keep straight, because two different numbers now exist for the same work:

| Surface | Shows |
|---|---|
| Employee's own timesheet | **Logged** hours (their record, never rewritten) |
| HR Overview + HR CSV export | **Logged** hours (actuals — unchanged by this work) |
| PM report | **Both**: logged, and approved + approved-by |

## PM report — the columns stop being manual

`utils/reports.ts` `toCSV()` currently emits four intentionally-blank placeholder columns, with a
comment saying a future increment would capture them. This is that increment, for the first pair:

- `TL/PM Approved Hours` → the approved hours recorded here.
- `TL/PM Approved By` → the approving employee's display name.
- `Client Approved Hours` / `Client Approved By` → **remain blank/manual**. Client sign-off is a
  separate process and explicitly out of scope.

A task that is not yet approved leaves its two columns blank, as today.

## Architecture

### Data model

A per-task approval record keyed by (timesheet day, issue), holding: the issue and its project,
the submitted hours (sum of that issue's entries that day), `status`, `approvedHours`,
`approvedBy`, `approvedOn`, and `rejectReason`. It carries its own `approvers` list — the PM and
Team Lead **of that task's project only**, minus the employee.

That `approvers` list is resolved and stamped **at submit time**, exactly as the day-level one is
today (the client computes it and sends it; `resolveApprovers()` already does this work, and is
narrowed here from "every project in the day" to "this task's project"). Stamping at submit means a
later change of a project's PM/TL does not silently re-route sheets already awaiting approval.

`TimesheetDay` keeps `date`, `totalHours` and `snapshot`; its `status`, `approvedBy`, `approvedOn`
and `rejectReason` fields are superseded by the derived value and the per-task records.

### Authorization

`canApprove` moves from "actor ∈ the day's union of approvers" to "actor ∈ **this task's** project
approvers". This is the fix: TL-A is not in Proj-2's approver list, so TL-A cannot action Proj-2's
task at any layer. Enforced server-side by the existing compensating-revert trigger pattern
(`OnTimesheetDayUpdate`), not only in the UI. Self-approval stays forbidden.

### Projects with no PM/TL configured

`day.ts` already defines a `NO_APPROVER` sentinel. With per-task approval this becomes per-task: a
task whose project has neither PM nor Team Lead set has nobody who can action it. It must be
**visible, not silently stuck** — surfaced to the employee at submit time and listed for admins, so
the missing project configuration gets fixed. Silently routing it to all PMs is rejected: it hides
a configuration error behind a guess.

### Migration

Existing `TimesheetDay` records must not lose their history. For each existing day, derive
per-task records from its `snapshot`, seeding each with the day's current status and, where the day
was Approved, `approvedHours` = the submitted hours and `approvedBy` = the day's `approvedBy`.
Days with no snapshot yield no task records and read as Draft.

## Scope

**In scope:** the data model, submit path, per-task approve/reject with hours and reason, derived
day status across all four surfaces, `canApprove` authorization, migration, and wiring the two
TL/PM columns in the PM report.

**Out of scope:** submit notifications to PM/TL (the next project — it is specified *after* this,
because the notification's recipients and content are defined by the approval unit); client
approval columns; changing what the HR Overview/export measure; per-`TimeSpendReport` approval.

## Testing

- Pure lib, TDD: day-status derivation across all five conditions; grouping multiple entries on one
  issue/day into a single unit; `canApprove` per task — specifically that TL-A **cannot** approve
  Proj-2's task in the two-project day above; drift detection per task after an edit.
- The two-TL scenario is the regression test for the defect and must exist.
- Migration: an existing Approved day yields approved task records with hours and approver carried
  over; a day with no snapshot yields none.
- Server: the compensating revert fires when a non-approver writes an approval directly.
- E2E on the local stack: two projects with different TLs, one employee, one day — each TL sees and
  can action only their own task; day shows Partially Approved after the first approval; the PM
  report exports the approved hours and approver.

---

# REVISION 2 — access model (2026-07-23)

This revision **supersedes the authorization model above**, following the user's clarification. The
per-task unit, approved hours, derived day status and PM-report wiring are unchanged.

## What changed, and why it matters

The original spec treated cross-project approval as an **authorization defect**: TL-A approving
TL-B's project was the bug the whole feature existed to fix.

**That was wrong about the business rule.** Per the user (2026-07-23): *any* TL or PM may approve
*any* task, deliberately — when a project's own TL is absent, another TL who knows the work must be
able to approve it. Cross-project approval is a **feature, not a defect**. What the business needs
is not prevention but **attribution**: recording precisely who approved.

## The new model

1. **Authorization = role, not project.** An actor may approve/reject any task if they are assigned
   as PM or Team Lead on **any** project, or are an admin (Maintainer+). Self-approval remains
   forbidden for everyone — the employee whose timesheet it is can never approve their own task.
2. **Per-project PM/TL becomes notification routing only.** The `ProjectApprovers` mixin still
   records each project's PM and Team Lead, and the per-task `approvers` list is still stamped at
   submit time — but it now answers "who should be **told**", never "who may **act**".
3. **Attribution is the point.** Every approval records `approvedBy` and `approvedOn`, stamped
   authoritatively by the server, never accepted from a client.
4. **Assignment UI.** PM and Team Lead are assigned per project as two explicit person fields in
   project settings, presented like the existing Owners / Members selectors.

### Visibility — approved hours are restricted

**Normal employees must not see approved hours, including their own.** The figure is for the
PM-report audience; discrepancies get discussed with the employee at the weekly meeting instead.

| Field | Lives in | Visible to |
|---|---|---|
| issue, submitted hours, status, reject reason | shared Timesheets space | the employee (their own), approvers, admins |
| **`approvedHours`, `approvedBy`, `approvedOn`** | **restricted approvals space** | **PM / TL / admin only** |

So the employee sees *that* a task was approved, and any rejection reason, but not the hours figure.

## Why this resolves the security blocker

Three adversarial review rounds each found a new bypass of the compensating-revert trigger
(poisoning `approvers`; forging `approvedBy`; rewriting `approvedHours`, including via `$inc`;
forged already-approved creates; status downgrades). Every one shared a root cause: **authorization
consulted data that any workspace member could write**, and the trigger tried to enumerate every
dangerous field and operator — allow-by-default over an open-ended list.

Under Revision 2 that class disappears:

- Authorization is a **role check**. There is no per-task data left to poison.
- `approvedHours` and the stamps live in a **restricted space**, so a non-member's write is refused
  by the server outright — deny-by-default, structural, not an enumeration the next new field can
  slip past. This is the "restructure, don't keep hardening" conclusion the review reached, and the
  visibility requirement demands it independently.

The trigger stays as defence-in-depth: enforce the role, forbid self-approval, stamp attribution.

## Open risk to close before this is sound

The role check is only as strong as **who may assign a project's PM/TL**. If any member can set
themselves as a project's PM, they can promote themselves into the approver role and the model is
defeated. Assignment must be restricted to admins/project owners, and this must be **verified, not
assumed** — it was not confirmed at the time of writing.

## Rework required to already-built tasks

- **Task 1** — the two "defect-pinning" tests assert the OPPOSITE of the intended rule and must be
  inverted: cross-project approval is now allowed. `canApproveTask` changes from "actor ∈ this
  task's approvers" to "actor holds an approver role ∧ actor ≠ employee". `buildTaskUnits` keeps
  stamping per-project approvers, now documented as notification routing.
- **Task 3** — unchanged in shape; the stamped `approvers` list keeps its meaning as routing.
- **Task 5** — substantially simplified: role check + self-approval bar + authoritative stamps.
  The field-enumeration guards become unnecessary once the approval fields move spaces.
- **New task** — provision the restricted approvals space, move the approval fields into it, and
  add the project-settings PM/TL assignment UI.

---

# ⚠️ KNOWN SECURITY GAP — accepted for BETA ONLY (user decision 2026-07-23)

**Status: OPEN. Must be fixed before this feature is used with real payroll data.**

## The gap

A determined workspace member with direct API access can **forge or inflate approval records**:

```
createDoc(ygTimesheet.class.TimesheetApproval, ygTimesheet.space.Approvals,
          { task: <anyTask>, approvedHours: 999, approvedBy: <anyone> })
```

They do not need a PM/TL role, and they do not need to join the private space.

## Why the current design does not stop it

Revision 2 assumed that putting the payroll fields in a **private space** made writes
structurally safe. **That assumption is false**, verified against this codebase:
`foundations/server/packages/middleware/src/spaceSecurity.ts` contains **zero `throw`
statements** — `processTx` only maintains read filters and domain-space indexes. It never rejects
a transaction.

> **Private means READ-blocked, not WRITE-blocked.**

Non-members cannot *read* `TimesheetApproval` rows (so the "employees must not see approved hours"
requirement DOES hold), but anyone can *write* them.

## What IS enforced today

- Task `status` transitions to Approved/Rejected are role-checked server-side
  (`OnTimesheetTaskUpdate`), self-approval blocked for everyone including admins, unauthorized
  writes reverted and logged.
- Approved hours are **not readable** by ordinary employees.
- So the gap is *forgery of approval records*, not casual misuse or accidental exposure.

## Also open (same root cause / same review round)

- Attribution (`approvedBy`/`approvedOn`) is not written on a FIRST approval: `approveTask` writes
  `status` before creating the row, so the trigger finds no row and only warns. Re-approvals stamp.
- `OnApprovalsMembershipGuard` reconciles `$push`-ed members but a raw `{ owners: [...] }`
  overwrite can install an accomplice, who is then treated as an admin by `deriveApprovalsMembers`.
- `OnProjectApproversMixinGuard` matches only `TxMixin`; a plain
  `updateDoc(Project, { 'ygTimesheet:mixin:ProjectApprovers': { pm: self } })` still self-promotes.
- `OnTimesheetTaskUpdate` handles only `TxUpdateDoc` — a forged already-`Approved` task created via
  `TxCreateDoc`, or deletion of an approved task via `TxRemoveDoc`, is unguarded.

## The agreed fix (NOT YET IMPLEMENTED)

**Clients must never write `TimesheetApproval` at all.**

1. The approver's hours travel on the **task** update, which is already role-guarded and already
   the transaction the trigger authorizes.
2. The **server alone** creates, updates and deletes the `TimesheetApproval` row.
3. Any **client-authored** transaction on `ygTimesheet.class.TimesheetApproval` is reverted
   unconditionally — deny-by-default, no field or operator enumeration to keep current.

This is the first design in five review rounds that does not rest on an unverified premise:
attribution becomes true by construction, and there is nothing on the document left to poison.

## Why it was accepted for now (user decision, 2026-07-23)

The branch is **local + demo only, never deployed** (`yg_beta` is never merged to `yg_develop`,
which CI auto-deploys). The realistic threat is an employee deliberately inflating their own
approved hours through the API — a real payroll risk, but not an outage risk and not reachable by
normal UI use. Accepted to unblock beta demos; **must be closed before real payroll use.**

## Review history (so nobody re-derives this)

Five adversarial review rounds, two architectures, each round finding new bypasses:
- **v1** "trigger enumerates dangerous fields/operators" — 3 rounds (`$inc`, status-downgrade,
  forged creates all slipped past). Open-ended by construction.
- **v2** "private space is structurally write-safe" — 2 rounds. Premise disproven (above).
