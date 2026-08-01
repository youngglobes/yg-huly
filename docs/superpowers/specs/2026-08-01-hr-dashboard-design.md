# HR dashboard — role-based HR branch of the Dashboard app (Phase 2)

**Date:** 2026-08-01
**Status:** Design (approved)
**Repo:** youngglobes/yg-huly (branch `yg_beta`)

## Problem

The top-level **Dashboard** app routes by role: PM/approver → PM dashboard, everyone else → Employee
dashboard. HR-roster members (e.g. sreya) currently fall through to the Employee dashboard and get
no org-level HR view. HR's daily concerns — who's present, hours logged across the org, and
timesheet-submission compliance — have no landing place.

## Goal

Add a third **HR** branch to the Dashboard app's role router (`DashboardHome`): a glanceable,
org-wide HR overview with KPIs and a few visual widgets, reusing the existing dashboard design
system so all three dashboards read as one family. Links to the detailed HR app pages
(Overview/Attendance/Timesheets/Roster) for drill-in; this is a summary, not a replacement.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Placement | **HR branch of the Dashboard app** (not the HR-app Overview page, which stays as-is). |
| Routing priority | **PM > HR > Employee.** `isPM` (admin/approver) → PM; else `isHR` (HrData member) → HR; else Employee. |
| Focus | **Balanced HR ops** — presence + hours + submission-compliance, with graceful empty states. |
| Approvals | **Excluded** — approving timesheets is the PM/TL queue, not HR. HR owns *submission*, not *approval*. |
| Departments / PTO | **Excluded** — departments unused (1 exists), `request`/PTO table empty. |
| Build type | **Front-only** — no new Application/special/model doc; DashboardHome already routes. No `upgrade-workspace`. |

## Data reality (yg workspace, checked 2026-08-01)

- **Rich now:** `HrTimeEntry` (9,449 rows, backfilled from tracker time-tracking) → hours by
  employee/period; ~34 employees for headcount.
- **Sparse now, grows in prod:** `AttendanceSession` (punch feature new), timesheet submission
  (`Timesheet`/`TimesheetDay`/`TimesheetTask`, new feature).
- **Not viable:** departments (1), leave/PTO (empty).

Design consequence: attendance and timesheet-compliance widgets ship with tasteful empty states now
and populate as adoption widens; hours/headcount are useful immediately.

## Architecture

### 1. Role detection (router)
`DashboardHome.svelte` gains an HR branch. `isHR` = the current account uuid is in the members of the
private HR space `ygTimesheet.space.HrData` (the same gate that unhides the HR app). Query-driven,
like the existing `isApprover` check. Order: `isPM` → `Dashboard`; else `isHR` → `HrDashboard`; else
`EmployeeDashboard`.

### 2. `HrDashboard.svelte` (new, org-scoped)
Owns all queries, maps live docs to plain shapes, feeds pure aggregation (new `utils/hr-dashboard.ts`,
unit-tested — no platform deps) into presentational cards. HR viewers are HrData members, so they can
read org-wide `HrTimeEntry`; `AttendanceSession` is world-readable.

### 3. KPI strip (reuses `KpiStrip`)
- **Headcount** — active employees (neutral)
- **Present today** — distinct employees with an AttendanceSession today (neutral)
- **WFH / Office** — today's mode split, e.g. `3 / 9` (neutral)
- **Hours this week** — org total from HrTimeEntry (neutral) — *rich now*
- **Not logged this week** — employees with 0 logged hours this week (amber when > 0) — *rich now*
- **Timesheet submissions** — submitted vs expected this week (amber when incomplete) — *prod*

### 4. Widgets / layout (attention-band grid + `Donut` + `yg-table` shell)

*Attention band (2×2):*
1. **Attendance today** — who's in / not punched, WFH vs Office tags *(prod)*
2. **Not logged this week** — employees with 0 hours, so HR can chase *(rich now)*
3. **Timesheet compliance** — submitted / not-submitted this week as progress bars *(prod)*
4. **Office vs WFH today** — `Donut` split *(prod)*

*Detail (full width):*
5. **Hours this week by person** — ranked, scrollable: employee · hours · days logged · last active
   *(rich now)*

All cards degrade to a clean empty state where data is sparse.

### 5. Data sources
| Widget | Source | Access |
|---|---|---|
| Headcount | `contact.mixin.Employee` (active) | world-readable |
| Present / WFH-Office / Attendance today | `AttendanceSession` where `date == localMidnight(now)` | world-readable |
| Hours (week, by person, not-logged) | `HrTimeEntry` where `date` in week | HrData member (HR viewer qualifies) |
| Timesheet submissions/compliance | `Timesheet`/`TimesheetDay` this week by status | HR read access — **verify in plan** |
| Roster | `HrData.members` | — |

## Reuse
`KpiStrip`, `Donut`, the `.dash-attention` 2×2 grid pattern, and `yg-table` tokens — same components
as the PM/Employee dashboards. New: `utils/hr-dashboard.ts` (pure aggregation), `HrDashboard.svelte`,
and per-widget card components. New i18n strings in `plugins/yg-timesheet` + lang json (front-side).

## Testing
- Pure aggregation (`utils/hr-dashboard.ts`): jest, no platform deps — headcount/present/wfh-office
  split, hours-by-person, not-logged, submission-compliance rollups.
- Manual: log in as **sreya** (HR roster, non-PM) → Dashboard opens the **HR** view; KPIs + hours-by-
  person populate from real data; attendance/timesheet cards show empty states; log in as **pravin**
  (admin) → still PM; a plain employee → still Employee.

## Out of scope (later)
- Department breakdowns, leave/PTO, headcount-by-department (no data).
- Attendance-rate trend over weeks, top/under-logger deep views (add once attendance data matures).
- The HR viewer's *own* personal widgets (they use the Attendance/Timesheet apps for that).
- Timesheet **approval** queue (PM concern, deliberately excluded).

## Rollout
Front-only: rebuild `yg-local/front:beta`, `up -d front`, restart nginx. No model change, no
`upgrade-workspace`. Batches with any other pending front changes.
