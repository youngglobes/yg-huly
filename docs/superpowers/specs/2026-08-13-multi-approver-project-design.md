# Multiple PM / Team Lead per project (ProjectApprovers) - design

Date: 2026-08-13
Status: approved (brainstorming), pending implementation plan
Area: yg-timesheet approvers + dashboards + server guard (yg_beta)

## Problem

Some projects are run by two Project Managers, or covered by two Team Leads. The
`ProjectApprovers` mixin today stores exactly one `pm` and one `teamLead` (single
`Ref<Employee>`), so only one person of each kind can be configured. We need the config to
accept multiple PMs and multiple Team Leads per project, and every existing feature that reads
those fields must keep working.

## Decisions (from brainstorming)

1. **Data shape: arrays.** `pm` and `teamLead` become `Ref<Employee>[]` (was single `Ref<Employee>`).
2. **Approval rule: any one is enough.** With two PMs on a project, either PM (or either TL) can
   approve a timesheet on their own. This is exactly today's behavior - the approver *set* just
   gets bigger. No per-approver tracking, no dual sign-off, so the reject/drift logic we already
   fixed is untouched.
3. **Standing: fully equal, flat list.** All PMs have equal standing; all TLs have equal standing.
   Each listed person sees the project on their dashboard and can approve. No "primary" concept, no
   ordering semantics.
4. **Existing projects migrate.** A model migration converts every existing scalar `pm`/`teamLead`
   to a single-element array (`x` -> `[x]`, absent/null -> `[]`). Runs on `upgrade-workspace`.

## Explicitly OUT of scope

- **HR `Department.teamLead`** (`plugins/hr/src/index.ts`, `plugins/hr-resources/src/components/*`,
  `models/hr/src/migration.ts`) is a *different* model - the lead of an HR Department, single-lead by
  design. It is NOT the project approver and must NOT be changed. (It surfaced in the sweep only
  because it shares the field name `teamLead`.)
- No new approval-state machinery (no dual sign-off, no per-approver approval records).
- No change to the dashboard routing rules themselves (org/pm/teamLead/hr/employee) - only the
  approver *membership* checks that feed them generalize from equality to array membership.

## Data model

`plugins/yg-timesheet/src/index.ts` (interface):
```
export interface ProjectApprovers extends Project {
  pm?: Ref<Employee>[]        // was Ref<Employee>
  teamLead?: Ref<Employee>[]  // was Ref<Employee>
}
```

`models/yg-timesheet/src/index.ts` (mixin props):
```
@Prop(ArrOf(TypeRef(contact.mixin.Employee)), ygTimesheet.string.PM)
  pm?: Ref<Employee>[]
@Prop(ArrOf(TypeRef(contact.mixin.Employee)), ygTimesheet.string.TeamLead)
  teamLead?: Ref<Employee>[]
```
(`ArrOf` imported from `@hcengineering/model`.)

## Migration

A model migration (registered the same way as existing yg-timesheet migrations - the plan will
confirm the exact file/registration point) that, for every `Project` carrying the
`ProjectApprovers` mixin:

- reads the raw stored `pm` / `teamLead`,
- if the value is a scalar (string) or null/undefined, rewrites it as `[]` when empty or `[value]`
  when a single ref,
- if the value is already an array, leaves it (idempotent - safe to re-run).

This keeps the ~34 existing projects' single approvers working as one-element arrays.

## Defensive normalizer (shared)

Add one small pure helper so no read site hand-rolls null/scalar handling and every site behaves
identically even if a doc slips through un-migrated:

```
// normalize a possibly-scalar, possibly-undefined approver field to a clean Ref<Employee>[]
export function asRefArray (v: Ref<Employee> | Ref<Employee>[] | null | undefined): Ref<Employee>[]
```

- `undefined` / `null` / `''` -> `[]`
- a single ref (legacy) -> `[ref]`
- an array -> the array with empties filtered out

Unit-tested in isolation. Every read site funnels the mixin's `pm`/`teamLead` through this.

## Read-site changes (all in scope, all mechanical)

Two shapes of change:

**A. Membership** (`x === me` -> `asRefArray(x).includes(me)`):
- `plugins/yg-timesheet-resources/src/index.ts:74` (approver check in canApproveView path)
- `plugins/yg-timesheet-resources/src/components/Approvals.svelte:43`
- `plugins/yg-timesheet-resources/src/components/Reports.svelte:52`
- `plugins/yg-timesheet-resources/src/components/Dashboard.svelte:86` (scope filter:
  `scope === 'teamLead' ? tl.includes(me) : pm.includes(me)`)
- `plugins/yg-timesheet-resources/src/components/DashboardHome.svelte:54-55`
  (`isPmApprover = pairs.some(a => a.pm.includes(me))`, same for `isTlApprover`)
- `plugins/yg-timesheet-resources/src/utils/task-approval.ts:119` (canApproveView)

**B. Set-union** (`set.add(x)` -> `for (const id of asRefArray(x)) set.add(id)`):
- `plugins/yg-timesheet-resources/src/utils/task-approval.ts:48-49`
- `plugins/yg-timesheet-resources/src/utils/workflow.ts:32-33`
- `plugins/yg-timesheet-resources/src/components/Dashboard.svelte:219` (pmSet build for the
  scoped-view team exclusion)
- `plugins/yg-timesheet-resources/src/components/HrDashboard.svelte:74`
  (`[...asRefArray(a.pm), ...asRefArray(a.teamLead)]`)
- `server-plugins/yg-timesheet-resources/src/index.ts:348-349` (`approverRoleSet` union)

**Pass-through shapes** (return the arrays instead of scalars; update the `ProjectApproverLike`
type + callers):
- `plugins/yg-timesheet-resources/src/index.ts:44` (returns `{ pm, teamLead }`)
- `plugins/yg-timesheet-resources/src/components/DashboardHome.svelte:53` (maps to `{ pm, teamLead }`)
- `plugins/yg-timesheet-resources/src/utils/day.ts:262,264` (`out.set(id, { pm, teamLead })` ->
  arrays, empty default `{ pm: [], teamLead: [] }`)
- `plugins/yg-timesheet-resources/src/utils/task-approval.ts` (`ProjectApproverLike` type ->
  array fields; `canApproveView` membership over arrays)
- `plugins/yg-timesheet-resources/src/utils/workflow.ts` (`resolveApprovers` map value -> arrays)

## Editor UI

`plugins/yg-timesheet-resources/src/components/ProjectApprovers.svelte`: replace each single-select
`EmployeeBox` with the multi-select employee list editor (Huly's `UserBoxList` from
`@hcengineering/contact-resources`, constrained to `contact.mixin.Employee`; the plan will confirm
the exact component/props by checking how other multi-employee pickers in the codebase are wired).
`on:change` writes the full array via the existing `set({ pm })` / `set({ teamLead })` path.

## Server security guard (in scope, security-sensitive)

`OnProjectApproversMixinGuard` (`server-plugins/yg-timesheet-resources/src/index.ts` ~734-800)
reverts any non-admin `TxMixin` on `ProjectApprovers` *wholesale* (it restores the pre-tx state or
clears the fields). It does not inspect which field changed, so the array change does not open a new
escalation path - adding yourself to the `pm` array is still a full-mixin write by a non-admin and
is still reverted. Only the shape of the restore/clear values changes:

- `revertAttrs`: `{ pm: prevMixin.pm ?? null, teamLead: prevMixin.teamLead ?? null }` ->
  `{ pm: asRefArray(prevMixin?.pm), teamLead: asRefArray(prevMixin?.teamLead) }` (clear = `[]`).

`approverRoleSet` in the same file unions arrays (listed under set-union above). No change to the
trigger's `txMatch` registration in `models/server-yg-timesheet/src/index.ts` (it matches on
`_class: TxMixin, mixin: ProjectApprovers`, which is field-agnostic - verify only).

## Testing

- **Unit (pure):** `asRefArray` (empty/scalar/array/dirty cases). Update the existing pure-helper
  tests to array shape: `utils/__tests__/task-approval.test.ts` (`ProjectApproverLike`,
  `canApproveView`, approver-set build) and `__tests__/workflow.test.ts` (`resolveApprovers`) - add
  a multi-PM case to each (two PMs -> both approvers; either can approve).
- `resolveDashboardRole` tests are unchanged (they take booleans, not the mixin).
- **Migration:** verified on beta after `upgrade-workspace` with a CockroachDB spot-check that a
  known project's `pm`/`teamLead` are now arrays and a two-PM project resolves both as approvers.
- **Manual on beta:** configure a project with two PMs and two TLs; confirm both PMs land on the PM
  dashboard scoped to that project, both can approve a timesheet, the org/HR views still tally, and
  a non-admin attempt to add self as PM is still reverted by the guard.

## Deploy

MODEL change (mixin prop type + migration), so the full path from `huly-migration/huly-selfhost`:
`./build-beta.sh` (full) -> recreate `transactor account front` -> `./run-tool-beta.sh
upgrade-workspace yg` -> front `HTTP 200` at `localhost:8087`. Same shape as the late-punch-in
release. yg_beta only; prod follows when the batch merges to `yg_develop`.
