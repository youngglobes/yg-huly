# Estimate required before a task starts — design

**Date:** 2026-08-04
**Status:** Design (approved)
**Repo:** youngglobes/yg-huly (branch `yg_beta`)
**Backlog item:** #1 of `2026-08-04-yg-portal-backlog.md`.

## Problem

Today the estimation requirement is enforced only at **timesheet submit** (`Timesheet.svelte`
blocks a submit when any task's issue has `estimation` 0/unset — `issuesMissingEstimation`). So a
person can work on an un-estimated task and only discover the missing estimate at submit time. The
team wants the estimate forced **up front** — before the task is even started.

## Goal

An issue may not move into a **started (active)** status unless it has an estimate. "Started" = the
new status's category is `task.statusCategory.Active` (In Progress, In Testing, In Review, and any
project's active-category statuses). Moving Todo/Backlog → any of these requires `estimation > 0`.
Won/Lost (Done/Cancelled) are unaffected — you don't estimate to close.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Scope | Any move whose NEW status category is `Active` (not just literal "In Progress"). |
| "Has estimate" | `estimation > 0` (0 or unset fails). |
| Enforcement | **Server guard (revert + notify)** + **client pre-check** on the main status dropdown. |
| Backstop | The existing submit-time check stays. |

## Architecture

Status changes flow through 6+ tracker components (StatusEditor, StatusSelector, KanbanView drag,
ControlPanel, SubIssues, IssuePreview) — there is no single client chokepoint. So the hard gate is
server-side; the client pre-check is a UX nicety on the common path.

### 1. Pure helper (testable)
`utils` helper `estimateRequiredToActivate(newCategory, estimation): boolean` = `newCategory ===
task.statusCategory.Active && (estimation ?? 0) <= 0`. Unit-tested; used by both the client
pre-check and (conceptually) the server guard.

### 2. Server guard (hard enforcement)
A new async trigger in `server-plugins/yg-timesheet-resources` (registered in
`models/server-yg-timesheet`), following the existing revert-guard pattern (`OnTimesheetTaskUpdate`
/ `OnProjectApproversChange`):

- Fires on `TxUpdateDoc<tracker.class.Issue>` whose `operations.status` changed.
- Skip System-authored txes (loop safety — the revert below is System-authored).
- Resolve the NEW status's category (`IssueStatus.category`). If it is `Active` and the issue's
  `estimation ?? 0 <= 0`:
  - **Revert** the issue's status to a not-started status (the previous status if recoverable from
    the tx/pre-image; otherwise the project's default `Backlog`/`ToDo` status), attributed to
    `core.account.System`.
  - **Notify** the acting user (a notification like the submit-notify trigger) — "Set an estimate on
    `<identifier>` before moving it to `<status>`."
- Idempotent / loop-safe: the only write is the System-authored status revert, which the
  top-of-loop `modifiedBy === System` guard skips.

### 3. Client pre-check (clean UX on the common path)
In `plugins/tracker-resources/src/components/issues/StatusEditor.svelte` (the inline status
dropdown — the most common path), before `client.update(value, { status: newStatus })`: if the new
status's category is `Active` and the issue's `estimation` is 0/unset, show a message ("Set an
estimate before moving to `<status>`.") and abort the update. Reuse the pure helper. (Other paths —
kanban drag, bulk, API — are covered by the server guard's revert.)

## Data

- `Issue.estimation` (hours), `Issue.status` -> `IssueStatus.category` (`task.statusCategory.*`).
- No new model fields.

## Testing

- Pure helper: jest — Active + no estimate -> true; Active + estimate -> false; non-Active (Todo/
  Done) -> false regardless of estimate.
- Server guard: covered by manual verification (trigger behaviour) — move an un-estimated issue to
  In Progress via the board/API -> it reverts to not-started + a notification arrives; with an
  estimate it stays.
- Manual: dropdown pre-check blocks with a clear message; estimate then allows the move; kanban-drag
  of an un-estimated issue snaps back with a notification.

## Out of scope

- Changing the submit-time check (it stays as the final backstop).
- Estimating sub-issues independently / rollup rules (uses each issue's own `estimation`).
- Bulk-edit UX polish (server guard reverts; no special bulk messaging beyond the notification).

## Deploy

Server trigger + model registration → **model change** → the 4-image build + `upgrade-workspace yg`
cutover (the client StatusEditor change rides the same front image). Local first, then prod
(batchable with the other pending prod work).
