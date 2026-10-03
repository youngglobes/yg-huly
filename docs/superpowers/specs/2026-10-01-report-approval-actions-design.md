# Timesheet Reports: Action column (approve, reject, recall)

Status: draft for review (2026-10-01). Branch: `yg_beta`, then `yg_develop` (prod).
Decided with the user in the 2026-10-01 discussion.

## Why

PMs/TLs sometimes approve a task that is not theirs. Today nothing undoes an approval except the
employee's own Recall, which only works while nothing on the day is approved yet. Approvers also
have to switch to the Approvals page to act on what they see in Reports. The Reports "Status"
column shows the issue's workflow status (Todo / In Progress / Done), which approvers do not need.

## Decisions

1. Reports (`/workbench/yg/yg-timesheet/reports`, `Reports.svelte`) drops the issue **Status
   column** (the Status *filter* above the table stays) and gains an **Action** column, last.
2. Actions are per approval item (a `TimesheetTask`: one employee, one day, one issue). Every
   Reports row (a time entry) of the same task shows the same action and acts on the whole task.
3. Per task state:
   | Task status | Action |
   |---|---|
   | `Submitted` (pending approval) | **Approve** / **Reject** |
   | `Approved` | **Recall** |
   | `Rejected` | **Recall** |
   | `Draft` or no task (never submitted) | muted "Not submitted", no buttons |
4. **Who may act** (approve, reject, recall): approvers of **that task's project** (the project's
   `ProjectApprovers.pm` / `teamLead`), **HR** (members of `ygTimesheet.space.HrData`), and
   **admins** (workspace Maintainer+). Never on one's own timesheet (HR and admins included).
   Users without the right see no buttons on that row.
5. **Approve / Reject** reuse the Approvals page flow exactly: `ApproveTaskPopup` (hours,
   adjustable) then `approveTask`; `RejectTaskPopup` (reason required) then `rejectTask` (which also
   writes the `TimesheetRejectCycle`).
6. **Recall** asks first, with a confirm dialog naming what changes, e.g.:
   > Recall the approval of ABI-466 for Gunaprakash on 29 Sep? It goes back to Pending approval
   > and its approved hours are removed.
   (For a rejection: "Recall the rejection of ... ? It goes back to Pending approval.")
   On confirm:
   - the task: `status = 'Submitted'`, unset `approvedHours`, `approvedBy`, `approvedOn`,
     `rejectReason`;
   - its `TimesheetApproval` row (if any) is removed;
   - recalling a rejection closes the open `TimesheetRejectCycle` for that employee+issue+date by
     setting new fields `recalledOn` and `recalledBy` (it is no longer waiting for the employee).
7. **No notification** to the employee (user decision). The task simply shows as pending again in
   My Timesheet and on the Approvals page.

## Server rules (OnTimesheetTaskUpdate, server-plugins/yg-timesheet-resources)

Today the guard checks only writes that set `status` to `Approved` or `Rejected`, and authorizes
"admin OR a PM/TL of ANY project" (`approverRoleSet`). Changes:

- **Recall is guarded.** A write setting `status: 'Submitted'` on a task whose PREVIOUS status
  (from the tx log, as the existing guards do) was `Approved` or `Rejected` is a recall and must
  pass the same authorization. Unauthorized: the System reverts the task to its previous status
  and fields, and restores the removed `TimesheetApproval` row if one was deleted in the same
  operation (or, if restoration is impractical, re-materializes it from the reverted task's
  approvedHours/approvedBy/approvedOn). The employee's own Recall of a whole day (`recallDay`,
  `Submitted` -> `Draft`) is unaffected: it only touches `Submitted` tasks.
- **Authorization tightened to the task's project** for approve, reject and recall:
  `authorized = owner known AND actor known AND actor != owner AND (isAdmin OR isHrMember OR
  actor in ProjectApprovers(task.project).pm ∪ teamLead)`. The project's approver lists are read
  server-side from the project mixin; the task's own client-writable `approvers` field is never
  trusted. This also closes the gap where any PM/TL could approve any project's task through the
  API (the UI already limited it).
- HR is added (members of `ygTimesheet.space.HrData`, same signal yg-hr's `isHrAuthorized` uses).

The known approval-record forgery gap (clients still write `TimesheetApproval` directly, see the
banner above `OnTimesheetTaskUpdate`) is NOT closed by this change and remains documented.

## Data

`TimesheetRejectCycle` gains `recalledOn?: Timestamp` and `recalledBy?: Ref<Employee>`. Anything
that treats "`resubmittedOn` absent" as "open" must treat `recalledOn` present as closed too
(audit `cyclesToClose`, the Approvals page's reject-history display, and the employee's view).
Model change: `upgrade-workspace` on deploy.

## UI details

- Buttons: compact text buttons ("Approve", "Reject", "Recall") in the Action cell; Recall in a
  neutral/danger style. While a call runs, the row's buttons disable.
- Errors (e.g. the server reverted the change) surface the same way the Approvals page does
  (`setPlatformStatus` / notification).
- CSV export: unchanged except the issue Status column is dropped from it too, so the export
  matches the table. (If the export must keep issue status, say so at review.)

## Not in scope

- Notifications (declined).
- Closing the TimesheetApproval forgery gap.
- Bulk actions (approve/recall many rows at once).

## Testing

- Unit: the per-row action rule (status x role x own-row); the authorization predicate
  (project approver yes, other project's approver no, HR yes, admin yes, own timesheet no for all);
  recall-cycle closing in `cyclesToClose`/history helpers.
- Server: OnTimesheetTaskUpdate tests for an authorized recall (kept), unauthorized recall
  (reverted, approval row restored), approve by another project's PM (reverted now).
- Beta end to end with the seeded demo data: approve -> recall -> approve; reject -> recall; a
  non-approver sees no buttons; a forged REST recall is reverted.
