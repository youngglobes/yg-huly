# Organization dashboard (backlog #11) - design

Date: 2026-08-13
Status: approved (brainstorming), pending implementation plan
Area: yg-timesheet dashboards (yg_beta)

## Problem

Workspace Owners (the CEO/CTO/COO level: Pravin, Sevvel, Raj, Arun) need an org-wide view: all
active project data regardless of approver mapping, plus what HR sees (attendance, timesheet
compliance, per-person hours). Today an Owner lands on the PM dashboard scoped to all projects but
with no HR view, and the routing conflates "Owner" with "PM". Some Owners are also PMs (Pravin,
Sevvel) and must still get the org view.

## Decisions (from brainstorming)

1. **Routing: Owner/admin -> Organization dashboard, regardless of designation.** `resolveDashboardRole`
   returns a new `'org'` on the `isAdmin` check (where it currently returns `'pm'`). So every
   Owner/admin gets the Org dashboard, including Owners who are also PMs. Non-owners are unchanged:
   designation `'Team Leader'` -> teamLead, `'Project Manager'` -> pm, else approver fallback, else
   hr/employee. This also retires the parked admin-vs-designation question - K2 was only made an Owner
   for testing; real TLs are not Owners.
2. **Layout: one Organization dashboard with two tabs, default Projects.** Projects tab = all active
   projects (the PM-style widgets over every non-archived project). HR tab = exactly the existing HR
   dashboard.
3. **Active only:** the Projects tab excludes archived projects (`archived === true`).
4. **"Team this week" on the org Projects tab excludes only inactive employees (keeps PMs visible)** -
   the owner wants full org visibility of workload; PMs are not filtered out on the org view (they are
   still filtered on the scoped PM/TL views).

## Role resolution change

`resolveDashboardRole` (`utils/dashboard.ts`) gains an `'org'` output; only the first line changes:

```
if (isAdmin) return 'org'      // was 'pm'
if (designation === 'Team Leader') return 'teamLead'
if (designation === 'Project Manager') return 'pm'
if (isPmApprover) return 'pm'
if (isTlApprover) return 'teamLead'
if (isHr) return 'hr'
return 'employee'
```

`DashboardRole` becomes `'org' | 'pm' | 'teamLead' | 'hr' | 'employee'`.

## OrgDashboard component

New `OrgDashboard.svelte`: a thin tabbed shell, no data logic of its own.

- Two tabs: `Projects` (default) and `HR`, using the plugin's existing tab/segmented styling.
- Projects tab renders `<Dashboard scope="org" />`.
- HR tab renders `<HrDashboard />` (unchanged; it self-bootstraps HrData membership for Owners via
  `ensureHrMembership`, so Owners can read HR data).
- Registered as `ygTimesheet.component.OrgDashboard` and rendered by `DashboardHome` for role `'org'`.

## Scope `'org'` on Dashboard.svelte

Add `'org'` to the `scope` prop union (`'pm' | 'teamLead' | 'org'`). Only two things change:

- `myProjectDocs`: for `'org'`, all projects with `archived !== true` (no approver filter). For `'pm'`
  (admin) / `'teamLead'` the existing behavior is unchanged.
- The "Team this week" exclusion set: for `'org'`, exclude inactive employees only (do NOT add the
  project PMs to the exclude set). For `'pm'`/`'teamLead'`, keep excluding PMs + inactive as today.

Everything else in Dashboard.svelte (issues, logged time, KPIs, project cards, approvals queue,
status donut) already derives from `myProjectDocs` and follows automatically. Loading all issues for
the org view is the same cost the admin PM view already paid.

## Router (DashboardHome.svelte)

Add an `'org'` branch: `role === 'org'` -> `<OrgDashboard />`. The existing designation + approver +
HR + ready-gate logic is unchanged; `role` now simply resolves to `'org'` for admins.

## Testing

- Unit-test `resolveDashboardRole`: admin -> `'org'` (including admin + a PM/TL designation still ->
  `'org'`); a non-admin PM designation -> `'pm'`; non-admin TL -> `'teamLead'`; the fallbacks
  unchanged. Update the existing admin test (which currently expects `'pm'`).
- The archived-project filter and the org-scope Team-this-week exclusion are exercised by the scope
  branch; the pure `resolveDashboardRole` is the main unit-tested unit.

## Out of scope

- No change to the HR dashboard content (reused as-is on the HR tab).
- No change to the PM/TL dashboards beyond adding the `'org'` scope branch alongside them.
- No new per-project drill-down; the org Projects tab is the existing dashboard widgets over all
  active projects.
- Landing-app behavior (which app opens on login) is separate and not addressed here.
