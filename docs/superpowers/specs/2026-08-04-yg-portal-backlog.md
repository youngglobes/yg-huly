# YG Portal — change backlog (team review 2026-08-04)

Umbrella list of changes discussed with the team. Built **one at a time**; each gets its own
spec → plan → implement cycle. Order below is the discussion order, not necessarily build order.

| # | Change | Notes / area |
|---|---|---|
| 1 | **Estimate required before a task enters a started status** | Block Todo/Backlog → any active status (In Progress/In Testing/In Review) unless `estimation > 0`. Server guard (revert+notify) + client pre-check on the status dropdown; submit-check stays as backstop. **← in progress, spec written.** |
| 2 | Rejection reason maintained/shown on the approval screen | Approvals UI — surface `rejectReason` on the approval/task view. |
| 3 | Button text → **Resubmit** / **Reapprove** | Timesheet + approval buttons: relabel on the re-cycle. |
| 4 | Employee can add a **note when resubmitting** | Timesheet resubmit flow — capture a note. |
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

**Cross-refs:** the Work Profile foundation + Performance Report are already built (specs
`2026-08-04-work-profile-*`, `2026-08-04-performance-report-design.md`); several items above extend
them (#8, #15-19). Item #18 (holiday list) is the roadmap's deferred follow-on.
