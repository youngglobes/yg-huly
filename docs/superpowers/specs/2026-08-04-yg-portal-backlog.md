# YG Portal — change backlog (team review 2026-08-04)

Umbrella list of changes discussed with the team. Built **one at a time**; each gets its own
spec → plan → implement cycle. Order below is the discussion order, not necessarily build order.

## Status (updated 2026-08-10, reconciled against yg_beta git history)

- **Done:** #1, #2, #3, #4, #5, #6, #7, #8, #12, #13, #14, #15, #16, #17, #18.
- **Pending:** #9 (HR notes for permissions/leaves), #10 (TL dashboard), #11 (Org dashboard).
- **Partial:** #19 (overtime / extra hours / holiday working-hours) — holidays already count as
  off-days and worked-hours derive from punch sessions; the overtime/extra-hours refinement on top
  of #18 is the remaining piece.
- **Approved-hours drift (below): RESOLVED** 2026-08-07 via server-side auto-reopen.

| # | Change | Notes / area |
|---|---|---|
| 1 | **Estimate required before a task enters a started status** | Block Todo/Backlog → any active status (In Progress/In Testing/In Review) unless `estimation > 0`. Server guard (revert+notify) + client pre-check on the status dropdown; submit-check stays as backstop. **← BUILT 2026-08-05.** |
| 2 | Rejection reason maintained/shown on the approval screen | Approvals UI — surface `rejectReason` on the approval/task view. **← BUILT + verified locally 2026-08-06.** |
| 3 | Button text → **Resubmit** / **Reapprove** | Timesheet + approval buttons: relabel on the re-cycle. **← BUILT + verified locally 2026-08-06.** |
| 4 | Employee can add a **note when resubmitting** | Timesheet resubmit flow — capture a note. **← BUILT + verified locally 2026-08-06.** |
| 5 | Force **Office/WFH choice on every punch-in** | Attendance punch UI — no sticky default; must pick each time. |
| 6 | Punch-in from the **notification must not auto punch-in** | Punch-reminder notification action should open the app, not punch. |
| 7 | **Swap** Timesheet-compliance and Office-vs-WFH blocks | HR dashboard attention-band ordering. |
| 8 | Team-profiles columns: **Employee ID, Name, Designation, Department, Shift start** | Extend WorkProfile editor (+ likely WorkProfile fields designation/department/empId). |
| 9 | **Notes feature for HR** for permissions and leaves | HR can record permission/leave notes per employee. |
| 10 | Build a **TL dashboard** | New role dashboard (Team Lead) in the Dashboard app router. |
| 11 | Build an **Organization dashboard** | Org-wide dashboard. |
| 12 | **Restrict project creation** to certain people | Permission on create-project. |
| 13 | Project visibility — **Private ON by default** | Create-project default. |
| 14 | **Admins/Owners are members of all projects** by default | Auto-membership. |
| 15 | PM dashboard "Projects you handle" — **add Approved hours** column | Dashboard/ProjectCards. |
| 16 | "Projects you handle" — **sort descending by Logged hours** | ProjectCards default sort. |
| 17 | Reports section — **Approved hours + Approved by not appearing** | Bug in Reports.svelte. |
| 18 | **Holiday list** | The deferred holiday-list editor (feeds `isWorkingDay` / performance report). |
| 19 | **Overtime, extra hours, working hours during holidays** | Performance-report extensions (partly covered by the Performance report; refine holiday handling once #18 lands). |

## Found during testing — RESOLVED 2026-08-07

**Approved-hours drift (2 bugs, found 2026-08-06, PRE-EXISTING). FIXED.** The employee timesheet
rendered the LIVE spent-time sum (`utils/week.ts` `issue.hours += r.value`) under the task's approval
status label, never comparing against what was actually approved.

- **Editing hours after approval:** submit 1h, approver approves 1h, employee edits spent time to 4h.
  The timesheet showed **4h tagged Approved** while Reports said 1h; the approver was unaware.
- **Adding hours after approval:** new spent time on an already-approved task/day summed into the same
  Approved row and could NEVER reach an approver.

**Fix (chosen option: auto-reopen for re-approval).** A server trigger `OnTimeSpendReportChange`
(`server-plugins/yg-timesheet-resources`, bound in `models/server-yg-timesheet` with
`txMatch: { objectClass: TimeSpendReport }`) fires on every spent-time create/update/remove. On
create/update it runs `reopenDriftedApprovedTask`: it finds the Approved `TimesheetTask` for that
(employee, issue, day), sums the live logged hours in the absolute day-window, and compares against
the `submittedHours` the approver reviewed. If they differ it reverts the task to `Submitted`
(updating `submittedHours`, clearing `approvedHours/approvedBy/approvedOn`), so it must be re-approved.
Both cases are covered (edit = TxUpdateDoc, add = TxCreateDoc). System-authored write, so it cannot
loop. Helpers + 28 unit tests in `approval-drift.ts` / `approval-drift.test.ts`. Commits 2026-08-07:
`f273addc` + the two drift baseline/day-window follow-ups.

The old client-side surfacing helpers (`driftHours()`, `ygTimesheet.string.Drift`) were superseded by
this server auto-reopen and removed as dead code (2026-08-10).

**Cross-refs:** the Work Profile foundation + Performance Report are already built (specs
`2026-08-04-work-profile-*`, `2026-08-04-performance-report-design.md`); several items above extend
them (#8, #15-19). Item #18 (holiday list) is the roadmap's deferred follow-on.
