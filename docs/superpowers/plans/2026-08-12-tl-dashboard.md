# TL Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split a Team Lead dashboard out of the shared PM dashboard: same layout, scoped to the user's teamLead-approver projects, routed by designation (primary) with approver-config fallback.

**Architecture:** A pure `resolveDashboardRole` helper decides pm/teamLead/hr/employee. `Dashboard.svelte` gains a `scope: 'pm' | 'teamLead'` prop that changes only its project filter. `DashboardHome.svelte` (the sole renderer of `Dashboard`) reads the current employee's designation + splits the approver roles, resolves the role, and renders `<Dashboard scope=...>`. No model or server changes - client only.

**Tech Stack:** Huly platform (TypeScript, Svelte), yg-timesheet plugin, jest.

## Global Constraints

- **No em-dashes** anywhere (code, comments, commits, UI copy). Use hyphens or commas.
- **No semicolons** in TypeScript; 2-space indent; match existing file style.
- **Designation values** are the `WorkDesignation` union in `@hcengineering/yg-timesheet`; the two manager values are the exact strings `'Team Leader'` and `'Project Manager'`.
- **Role resolution order** is fixed: admin -> pm; designation Team Leader -> teamLead; designation Project Manager -> pm; else pm-approver -> pm; else teamLead-approver -> teamLead; else hr -> hr; else employee.
- **Scope split:** pm = projects where `pm === me` (admin: all); teamLead = projects where `teamLead === me`.
- **Client-only change:** deploy is `./build-beta.sh --front-only` (no model/server change, no upgrade-workspace).

## File Structure

- `plugins/yg-timesheet-resources/src/utils/dashboard.ts` - add the pure `resolveDashboardRole` + its input type (this file already holds the dashboard's pure helpers).
- `plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts` - add `resolveDashboardRole` tests (this file already exists).
- `plugins/yg-timesheet-resources/src/components/Dashboard.svelte` - add the `scope` prop; make `myProjectDocs` scope-aware; remove the now-redundant `canView` gate.
- `plugins/yg-timesheet-resources/src/components/DashboardHome.svelte` - read designation, split approver roles, resolve the role, render the scoped dashboard.

---

### Task 1: Pure `resolveDashboardRole` helper + tests

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/dashboard.ts`
- Test: `plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts`

**Interfaces:**
- Consumes: `WorkDesignation` from `@hcengineering/yg-timesheet`.
- Produces:
  - `type DashboardRole = 'pm' | 'teamLead' | 'hr' | 'employee'`
  - `interface DashboardRoleInput { designation: WorkDesignation | undefined, isAdmin: boolean, isPmApprover: boolean, isTlApprover: boolean, isHr: boolean }`
  - `resolveDashboardRole(input: DashboardRoleInput): DashboardRole`

- [ ] **Step 1: Write the failing test**

Add to `plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts` (keep existing imports; add `resolveDashboardRole` to the import from `../utils/dashboard`):

```ts
describe('resolveDashboardRole', () => {
  const base = { designation: undefined, isAdmin: false, isPmApprover: false, isTlApprover: false, isHr: false }

  it('admin is always pm (all projects), even with a TL designation', () => {
    expect(resolveDashboardRole({ ...base, isAdmin: true })).toBe('pm')
    expect(resolveDashboardRole({ ...base, isAdmin: true, designation: 'Team Leader' })).toBe('pm')
  })

  it('designation Team Leader -> teamLead, even without a teamLead assignment', () => {
    expect(resolveDashboardRole({ ...base, designation: 'Team Leader' })).toBe('teamLead')
    expect(resolveDashboardRole({ ...base, designation: 'Team Leader', isPmApprover: true })).toBe('teamLead')
  })

  it('designation Project Manager -> pm, even when configured as a teamLead', () => {
    expect(resolveDashboardRole({ ...base, designation: 'Project Manager' })).toBe('pm')
    expect(resolveDashboardRole({ ...base, designation: 'Project Manager', isTlApprover: true })).toBe('pm')
  })

  it('non-manager designation falls through to the approver check', () => {
    expect(resolveDashboardRole({ ...base, designation: 'Software Test Engineer', isTlApprover: true })).toBe('teamLead')
    expect(resolveDashboardRole({ ...base, designation: 'Software Test Engineer' })).toBe('employee')
  })

  it('fallback: pm-approver -> pm; teamLead-approver -> teamLead; both -> pm (pm wins)', () => {
    expect(resolveDashboardRole({ ...base, isPmApprover: true })).toBe('pm')
    expect(resolveDashboardRole({ ...base, isTlApprover: true })).toBe('teamLead')
    expect(resolveDashboardRole({ ...base, isPmApprover: true, isTlApprover: true })).toBe('pm')
  })

  it('no manager role: hr -> hr, otherwise employee', () => {
    expect(resolveDashboardRole({ ...base, isHr: true })).toBe('hr')
    expect(resolveDashboardRole({ ...base })).toBe('employee')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/yg-timesheet-resources && npx --no-install jest dashboard.test -c jest.config.js`
Expected: FAIL - `resolveDashboardRole` is not exported.

- [ ] **Step 3: Implement**

Add to `plugins/yg-timesheet-resources/src/utils/dashboard.ts` (add `import type { WorkDesignation } from '@hcengineering/yg-timesheet'` if the file does not already import it):

```ts
export type DashboardRole = 'pm' | 'teamLead' | 'hr' | 'employee'

export interface DashboardRoleInput {
  designation: WorkDesignation | undefined
  isAdmin: boolean
  isPmApprover: boolean
  isTlApprover: boolean
  isHr: boolean
}

// Which dashboard a user lands on. Designation is the primary signal (a single value on the user's
// WorkProfile); only the two manager designations force a manager dashboard. Everything else falls
// back to the approver config, then HR, then the plain employee view. Admins always see the PM
// dashboard (all projects). Pure so the router stays a thin shell - same idiom as canApproveView.
export function resolveDashboardRole (input: DashboardRoleInput): DashboardRole {
  if (input.isAdmin) return 'pm'
  if (input.designation === 'Team Leader') return 'teamLead'
  if (input.designation === 'Project Manager') return 'pm'
  if (input.isPmApprover) return 'pm'
  if (input.isTlApprover) return 'teamLead'
  if (input.isHr) return 'hr'
  return 'employee'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugins/yg-timesheet-resources && npx --no-install jest dashboard.test -c jest.config.js`
Expected: PASS (all existing dashboard tests plus the new describe block).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/dashboard.ts plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts
git commit -m "feat(yg-timesheet): resolveDashboardRole helper + tests (TL dashboard #10)"
```

---

### Task 2: Parameterize `Dashboard.svelte` with a `scope` prop

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Dashboard.svelte`

**Interfaces:**
- Produces: `Dashboard` now accepts `scope: 'pm' | 'teamLead'` (default `'pm'`).

- [ ] **Step 1: Add the prop**

In the `<script lang="ts">` block, near the top (after the imports, before or right after `const me = getCurrentEmployee()`), add:

```svelte
  // Which project set this dashboard shows. 'pm' = projects where pm === me (admins: all);
  // 'teamLead' = projects where teamLead === me. Default 'pm' keeps existing behavior.
  export let scope: 'pm' | 'teamLead' = 'pm'
```

- [ ] **Step 2: Make `myProjectDocs` scope-aware**

Replace the current block (Dashboard.svelte around lines 87-94):

```svelte
  $: canView = isAdmin || isApprover
  $: myProjectDocs = isAdmin
    ? allProjects
    : allProjects.filter((p) => {
      if (!h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers)) return false
      const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers
      return a.pm === me || a.teamLead === me
    })
```

with (this both scopes correctly and drops the now-redundant `canView` - see Step 3):

```svelte
  $: myProjectDocs = scope === 'pm' && isAdmin
    ? allProjects
    : allProjects.filter((p) => {
      if (!h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers)) return false
      const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers
      return scope === 'teamLead' ? a.teamLead === me : a.pm === me
    })
```

- [ ] **Step 3: Remove the redundant `canView` gate**

`Dashboard.svelte` is rendered only by `DashboardHome.svelte`, which now authorizes the user before rendering it (and correctly sends a designation-manager with no approver assignment to their empty-but-valid dashboard). The inner `canView`/"Restricted" gate is therefore dead, and would wrongly show "Restricted" to such a user. Remove it:

- Delete the `isApprover` state and the `isApprover = canApproveView(false, pairs, me)` line inside the project query callback (keep the `allProjects = res` assignment; the query is still needed for scoping). If `pairs` becomes unused after removing that line, delete the `pairs` computation too.
- Remove the now-unused `canApproveView` import.
- In the template, replace:

```svelte
{#if !canView}
  <div class="yg-empty">Restricted to approvers.</div>
{:else}
  ... (dashboard body) ...
{/if}
```

with just the dashboard body (drop the `{#if !canView}...{:else}` wrapper and its `{/if}`), so the body always renders.

- [ ] **Step 4: Verify**

No unit test (UI). Run `cd plugins/yg-timesheet-resources && npx --no-install eslint src/components/Dashboard.svelte` and confirm no NEW errors beyond any pre-existing ones (check with `git stash` if unsure). Confirm there is no remaining reference to `canView`, `isApprover`, or `canApproveView` in the file (`grep -n "canView\|isApprover\|canApproveView" src/components/Dashboard.svelte` should be empty). Run `npx --no-install jest dashboard.test -c jest.config.js` to confirm the package still resolves.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/Dashboard.svelte
git commit -m "feat(yg-timesheet): scope prop on Dashboard (pm vs teamLead projects)"
```

---

### Task 3: Route by role in `DashboardHome.svelte`

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/DashboardHome.svelte`

**Interfaces:**
- Consumes: `resolveDashboardRole` (Task 1), `Dashboard`'s `scope` prop (Task 2).

- [ ] **Step 1: Read designation and split the approver roles**

In `DashboardHome.svelte`'s script:

- Add imports: `resolveDashboardRole` from `../utils/dashboard`, and `type WorkDesignation` to the existing `@hcengineering/yg-timesheet` import. Remove the `canApproveView` import (no longer used here).
- Add a designation query (mixin keyed by `me`):

```svelte
  let designation: WorkDesignation | undefined
  let desigReady = false
  const profQuery = createQuery()
  profQuery.query(ygTimesheet.mixin.WorkProfile, { _id: me }, (res) => { designation = res[0]?.designation; desigReady = true })
```

- Replace the single `isApprover`/`canApproveView` computation in the project query with a pm/teamLead split. `DashboardHome` already declares `let projReady = false` and sets it in the callback - keep that line as-is; do NOT redeclare `projReady`. Add the two new state vars and rewrite the callback body:

```svelte
  // (projReady is already declared above - do not redeclare it)
  let isPmApprover = false
  let isTlApprover = false
  projectQuery.query(tracker.class.Project, {}, (res: Project[]) => {
    const pairs = res
      .filter((p) => h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers))
      .map((p) => { const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers; return { pm: a.pm, teamLead: a.teamLead } })
    isPmApprover = pairs.some((a) => a.pm === me)
    isTlApprover = pairs.some((a) => a.teamLead === me)
    projReady = true
  })
```

Remove the old `let isApprover = false` declaration and the `$: isPM = isAdmin || isApprover` line.

- [ ] **Step 2: Resolve the role and gate on all queries**

- Keep the existing HR-membership query (`isHR`, `hrReady`).
- Update the readiness gate to include the designation query:

```svelte
  $: ready = projReady && hrReady && desigReady
  $: role = resolveDashboardRole({ designation, isAdmin, isPmApprover, isTlApprover, isHr: isHR })
```

- [ ] **Step 3: Render by role**

Replace the template branch with:

```svelte
{#if !ready}
  <!-- queries still resolving; render nothing to avoid a role flash -->
{:else if role === 'pm'}
  <Dashboard scope="pm" />
{:else if role === 'teamLead'}
  <Dashboard scope="teamLead" />
{:else if role === 'hr'}
  <HrDashboard />
{:else}
  <EmployeeDashboard />
{/if}
```

- [ ] **Step 4: Verify**

No unit test (UI). Run `cd plugins/yg-timesheet-resources && npx --no-install eslint src/components/DashboardHome.svelte` (no new errors; confirm no leftover reference to `isApprover`, `isPM`, or `canApproveView`). Run `npx --no-install jest dashboard.test -c jest.config.js` (still passes). Confirm the four render branches cover pm/teamLead/hr/employee.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/DashboardHome.svelte
git commit -m "feat(yg-timesheet): route PM vs TL dashboard by designation + approver role"
```

---

## Deployment and manual verification

Client-only change (Svelte + a pure util, no model/server change), so a front-only build. From `huly-migration/huly-selfhost`:

```bash
./build-beta.sh --front-only
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d front
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
```

Then at `http://localhost:8087` (HTTP 200 check first), open the Dashboard app as:

1. An employee with designation `'Team Leader'` who is a teamLead on project X -> sees the dashboard scoped to X (and any other teamLead project), NOT their pm projects.
2. An employee with designation `'Project Manager'` who is a pm on project Y -> sees only pm projects (a project where they are only a teamLead no longer appears).
3. An admin -> sees all projects (PM dashboard), regardless of designation.
4. A regular employee (non-manager designation, not an approver) -> still sees the Employee dashboard.
5. A designation `'Team Leader'` with no teamLead assignments -> sees an empty TL dashboard (not "Restricted").

Local OTP for test logins: read from the DB (no mail service) - `global_account.otp` joined to `social_id`. Set designations in HR -> Team Profiles.

## Notes

- The `scope` prop defaults to `'pm'`, so the change is backward-compatible for any future renderer of `Dashboard`.
- No change to `HrDashboard` or `EmployeeDashboard`. The PM dashboard's content is unchanged apart from the scope filter.
