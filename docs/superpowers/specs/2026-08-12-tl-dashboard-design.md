# TL dashboard (backlog #10) - design

Date: 2026-08-12
Status: approved (brainstorming), pending implementation plan
Area: yg-timesheet dashboards (yg_beta)

## Problem

The top-level Dashboard app (`DashboardHome.svelte`) routes any approver (a PM or a Team Lead) to
one shared `Dashboard.svelte`, scoped to projects where `pm === me OR teamLead === me`. Team Leads
have no dashboard of their own, and their view is mixed with a PM's. We want a separate TL dashboard,
identical in layout to the PM dashboard but scoped to the projects the user is assigned to as
`teamLead` in the approver config.

## Decisions (from brainstorming)

1. **TL detection: designation primary, approver-config fallback.** A user is a Team Lead when their
   `WorkProfile.designation === 'Team Leader'`. Only when the designation is not a manager value do
   we fall back to the approver config. A user whose designation is `'Project Manager'` is never a TL
   even if configured as a teamLead somewhere.
2. **Routing is designation-driven, one dashboard per user.** Admins -> PM (all projects).
   `'Team Leader'` -> TL. `'Project Manager'` -> PM. Any other designation or unset -> fall back to
   the approver config. Only `'Team Leader'` and `'Project Manager'` designations force a manager
   dashboard; every other designation (Tester, Developer, etc.) falls through to the approver check,
   so a non-approver still lands on the Employee dashboard.
3. **Clean scope split.** PM dashboard = projects where `pm === me` (admins: all). TL dashboard =
   projects where `teamLead === me`. The former `pm OR teamLead` union is dropped; a PM who is also a
   teamLead somewhere sees those projects only on the TL view, and is routed by their own designation.

## Role resolution (pure helper)

Add a pure function (unit-tested, same idiom as `canApproveView` in `utils/task-approval.ts`):

```
resolveDashboardRole({
  designation: WorkDesignation | undefined,
  isAdmin: boolean,
  isPmApprover: boolean,   // pm === me on any project
  isTlApprover: boolean,   // teamLead === me on any project
  isHr: boolean
}): 'pm' | 'teamLead' | 'hr' | 'employee'
```

Order:
1. `isAdmin` -> `'pm'`
2. `designation === 'Team Leader'` -> `'teamLead'`
3. `designation === 'Project Manager'` -> `'pm'`
4. else (unset or non-manager designation):
   - `isPmApprover` -> `'pm'`
   - else `isTlApprover` -> `'teamLead'`
   - else `isHr` -> `'hr'`
   - else `'employee'`

Note the tiebreak in step 4: an unset-designation user who is BOTH a pm and teamLead approver resolves
to PM (pm approver checked first). A designation-`'Team Leader'` user with no teamLead assignments
still routes to the TL dashboard (it will show an empty scope until they are assigned), which is
acceptable.

## Scope (parameterize `Dashboard.svelte`)

Add a prop `scope: 'pm' | 'teamLead'` with default `'pm'` (so any other renderer of `Dashboard` is
unaffected). The ONLY behavioral change is how `myProjectDocs` is computed:

- `scope === 'pm'`: `isAdmin ? allProjects : allProjects.filter(pm === me)`
- `scope === 'teamLead'`: `allProjects.filter(teamLead === me)`

Everything downstream (issue query, logged-time aggregation, "Projects you handle" cards, the
approved-hours column, sorting) already derives from `myProjectDocs` / `myProjectIds`, so it follows
automatically. No other logic in the dashboard changes.

The inner `canView` guard becomes scope-aware (defense in depth; the router already gates rendering):
`scope === 'pm'` allows admin or pm-approver; `scope === 'teamLead'` allows a teamLead-approver or a
designation-`'Team Leader'`.

## Router (`DashboardHome.svelte`)

- Add a live query for the current employee's `WorkProfile` mixin keyed by `{ _id: me }` to read
  `designation`.
- From the existing project query, compute `isPmApprover` and `isTlApprover` separately (currently it
  computes a single `isApprover` via `canApproveView`).
- Read `isHr` (existing HrData-membership query) and `isAdmin` (existing).
- Once all queries resolve (keep the existing "render nothing until ready" guard so the role never
  flashes), call `resolveDashboardRole(...)` and render:
  - `'pm'` -> `<Dashboard scope="pm" />`
  - `'teamLead'` -> `<Dashboard scope="teamLead" />`
  - `'hr'` -> `<HrDashboard />`
  - `'employee'` -> `<EmployeeDashboard />`

## Testing

- Unit-test `resolveDashboardRole` across every branch: admin; designation Team Leader / Project
  Manager / a non-manager value / undefined; each crossed with pm-approver, teamLead-approver, both,
  neither; and the HR/employee fall-through. Assert the step-4 tiebreak (both approvers, unset
  designation -> pm) and that a non-manager designation with no approver role -> employee.

## Out of scope

- No change to the PM dashboard's content/layout beyond the scope filter.
- No PM/TL heading label change (heading stays "Projects you handle").
- No change to HR or Employee dashboards.
- Admin override behavior (admin -> PM/all) is unchanged; designation does not re-route admins.
