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
