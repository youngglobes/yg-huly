# Dashboard separation — role-based top-level Dashboard app

**Date:** 2026-07-31
**Status:** Design (approved for Phase 1)
**Repo:** youngglobes/yg-huly (branch `yg_beta`)

## Problem

Today the PM dashboard lives *inside* the Timesheet app as the `dashboard` special, gated to
approvers/admins (`visibleIf CanApprove`). That makes it undiscoverable (buried two levels down) and
gives non-PM employees nothing — a normal employee has no "home" screen. Every portal has a landing
place; Huly here does not.

## Goal

A single **top-level "Dashboard" app** in the left rail whose content adapts to the viewer's role:

- **PM / approver / admin** → the existing PM dashboard (moved in unchanged).
- **Everyone else** → a new Employee dashboard.
- **HR** → deferred to Phase 2 (org attendance, approvals, headcount).

This pairs with the just-shipped default-landing behaviour: the Dashboard app becomes the app users
land on at login, so everyone gets a useful home immediately.

## Decisions (locked)

| Decision | Choice |
|---|---|
| App name | **"Dashboard"** |
| App icon | a dashboard/home glyph, distinct from Timesheet (clock) and HR (people) |
| Visibility | visible to **everyone** (no `accessLevel`); content differs by role |
| Default landing app | **Yes** — set `workbench.metadata.DefaultApplication` to the Dashboard app |
| Old `Timesheet → dashboard` special | **Removed** (the PM dashboard now lives in the Dashboard app; keeping both duplicates it) |
| Phase 1 scope | PM (moved) + Employee (new). HR = Phase 2. |

## Architecture

### 1. New top-level Application (model)
A `workbench.class.Application` (alias e.g. `yg-dashboard`), `position: 'top'`, **no `accessLevel`**,
with a single top-level `component: DashboardHome` (no navigator/specials — it is a single view that
routes internally). Registered in `models/yg-timesheet/src/index.ts` alongside the existing apps.

### 2. `DashboardHome` router (resources)
A thin Svelte component that decides which dashboard to render based on the viewer's role, using the
**same** role detection the current PM dashboard already uses:

```
isPM = isAdmin (hasAccountRole Maintainer) OR isApprover (canApproveView over ProjectApprovers)
```

- `isPM` → render the existing **`Dashboard`** (PM) component, unchanged.
- else → render the new **`EmployeeDashboard`** component.
- (HR branch: a `// TODO Phase 2` placeholder — not built now.)

Role detection is query-driven (async, like `Dashboard.svelte` today); the router shows nothing (or a
tiny spinner) until the projects query resolves, then branches. This keeps the PM path a fast admin
short-circuit exactly as the current dashboard does.

### 3. Employee dashboard (new, "me"-scoped)
Reuses the existing pure helpers (`utils/dashboard.ts`) and, where possible, existing widgets — every
query is scoped to the current employee (`assignee === me` / `employee === me`). Six cards:

1. **My attendance today** — punch state (on the clock / not), today's total + session count. Reuses
   the AttendanceSession data + `utils/attendance.ts` helpers.
2. **My open tasks by status** — my assigned issues across projects, real-status columns (reuses
   `openStatusNames` / per-status breakdown).
3. **My hours this week** — hours I logged this week (TimeSpendReport where `employee === me`,
   `date` in this week).
4. **My inbox** — **reuses `InboxWidget` as-is** (already queries the current user's notifications).
5. **My priority** — my *own* still-open Urgent/High assigned tasks (personal `PriorityWatch`; reuse
   `priorityWatch` filtered to `assignee === me`).
6. **My overdue / due this week** — my *own* overdue + due-soon assigned tasks (personal
   `OverdueList`; reuse `overdueIssues` / `dueSoonIssues` filtered to `assignee === me`).

Layout follows the PM dashboard's system (yg-table tokens, the 2×2 attention grid pattern), so the two
dashboards read as one family.

### 4. Data flow
`EmployeeDashboard.svelte` owns its queries (issues where `assignee === me`, my TimeSpendReports,
my AttendanceSessions, my notifications), maps them to the plain shapes in `utils/dashboard.ts`, and
feeds the card components. All aggregation stays in the pure, unit-tested lib — no new math in Svelte.

## Model changes (require full rebuild)

Unlike the recent front-only changes, this touches the **model**:
- New `workbench.class.Application` doc (+ its plugin ids: app ref, `DashboardHome` component id).
- Remove the `dashboard` special from the Timesheet app's `navigatorModel.specials`.
- A migration to set `workbench.metadata.DefaultApplication` (or set it in the model) to the new app,
  and best-effort hide/cleanup of the old special reference.

Deploy path: **4-image rebuild** (front/workspace/transactor/tool `yg-local/*:beta`) +
`upgrade-workspace yg`, per the established flow.

## Testing

- Pure helpers: extend `utils/dashboard.ts` tests for any new "me"-scoped filters (e.g. an
  `assignedTo` filter helper) — jest, no platform deps.
- Manual: log in as an approver (pravin) → Dashboard app shows the PM dashboard; log in as a non-PM
  employee → shows the Employee dashboard with the six cards populated from their own data; confirm
  the Dashboard app is the default landing app and the old Timesheet→Dashboard special is gone.

## Out of scope (Phase 2+)

- **HR dashboard** (org-wide attendance today / who's in-out, approvals org-wide, headcount, hours).
- Server-side single-open-session guard for attendance (tracked separately).
- Any employee-dashboard personalization/config.

## Rollout

Phase 1 (this spec): top-level Dashboard app + router + PM (moved) + Employee (new) + default-landing
+ remove old special → one model-change release. Phase 2: HR dashboard branch.
