# Organization Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give workspace Owners an Organization dashboard: a tabbed view with all active project data (Projects tab) and the HR dashboard (HR tab).

**Architecture:** `resolveDashboardRole` gains an `'org'` output on the admin check. `Dashboard.svelte` gains an `'org'` scope (all non-archived projects). A thin `OrgDashboard.svelte` tab shell renders `<Dashboard scope="org">` and `<HrDashboard>`. `DashboardHome` routes role `'org'` to it. Client-only.

**Tech Stack:** Huly platform (TypeScript, Svelte), yg-timesheet plugin, jest.

## Global Constraints

- **No em-dashes** anywhere (code, comments, commits, UI copy). Use hyphens or commas.
- **No semicolons** in TypeScript; 2-space indent; match existing file style.
- **Routing:** admin -> `'org'` (was `'pm'`); non-admins unchanged (designation Team Leader -> teamLead, Project Manager -> pm, else approver fallback, else hr/employee).
- **Org scope:** all projects with `archived !== true`, no approver filter. Org "Team this week" excludes inactive employees only (NOT the project PMs).
- **`OrgDashboard` is a direct Svelte import in `DashboardHome`** (like `Dashboard`/`HrDashboard`/`EmployeeDashboard`); it needs NO component ref and NO resources-map registration.
- **Client-only change:** deploy is `./build-beta.sh --front-only` (no model/server change).

## File Structure

- `plugins/yg-timesheet-resources/src/utils/dashboard.ts` - add `'org'` to `DashboardRole`; admin -> `'org'`.
- `plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts` - update the admin test (expect `'org'`), add an org assertion.
- `plugins/yg-timesheet-resources/src/components/Dashboard.svelte` - add `'org'` to the `scope` prop; org branch in `myProjectDocs` (all non-archived); org branch in `excludeFromTeam` (inactive only).
- `plugins/yg-timesheet-resources/src/components/OrgDashboard.svelte` (new) - the Projects | HR tab shell.
- `plugins/yg-timesheet-resources/src/components/DashboardHome.svelte` - route role `'org'` to `<OrgDashboard>`.

---

### Task 1: `resolveDashboardRole` returns `'org'` for admins

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/dashboard.ts:178,193`
- Test: `plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts:183-184`

**Interfaces:**
- Produces: `DashboardRole` becomes `'org' | 'pm' | 'teamLead' | 'hr' | 'employee'`; `resolveDashboardRole` returns `'org'` when `isAdmin`.

- [ ] **Step 1: Update the failing test**

In `dashboard.test.ts`, the admin test currently asserts `'pm'`. Change it (lines ~183-184) to:

```ts
  it('admin is always org (all projects + HR), even with a manager designation', () => {
    expect(resolveDashboardRole({ ...base, isAdmin: true })).toBe('org')
    expect(resolveDashboardRole({ ...base, isAdmin: true, designation: 'Team Leader' })).toBe('org')
    expect(resolveDashboardRole({ ...base, isAdmin: true, designation: 'Project Manager' })).toBe('org')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/yg-timesheet-resources && npx --no-install jest dashboard.test -c jest.config.js -t "resolveDashboardRole"`
Expected: FAIL - admin currently resolves to `'pm'`, test now expects `'org'`.

- [ ] **Step 3: Implement**

In `plugins/yg-timesheet-resources/src/utils/dashboard.ts`:

- Line 178: `export type DashboardRole = 'org' | 'pm' | 'teamLead' | 'hr' | 'employee'`
- Line 193: change `if (input.isAdmin) return 'pm'` to `if (input.isAdmin) return 'org'`

Leave the rest of `resolveDashboardRole` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugins/yg-timesheet-resources && npx --no-install jest dashboard.test -c jest.config.js`
Expected: PASS (all dashboard tests, including the updated admin test and the untouched non-admin PM/TL tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/dashboard.ts plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts
git commit -m "feat(yg-timesheet): resolveDashboardRole returns org for admins (#11)"
```

---

### Task 2: `'org'` scope on `Dashboard.svelte`

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Dashboard.svelte:57,79-85,222`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Dashboard` accepts `scope: 'pm' | 'teamLead' | 'org'`.

- [ ] **Step 1: Widen the scope prop**

Line 57: change

```svelte
  export let scope: 'pm' | 'teamLead' = 'pm'
```

to

```svelte
  export let scope: 'pm' | 'teamLead' | 'org' = 'pm'
```

- [ ] **Step 2: Org branch in `myProjectDocs`**

Replace the current `myProjectDocs` reactive (lines ~79-85):

```svelte
  $: myProjectDocs = scope === 'pm' && isAdmin
    ? allProjects
    : allProjects.filter((p) => {
      if (!h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers)) return false
      const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers
      return scope === 'teamLead' ? a.teamLead === me : a.pm === me
    })
```

with:

```svelte
  $: myProjectDocs = scope === 'org'
    ? allProjects.filter((p) => p.archived !== true)
    : scope === 'pm' && isAdmin
      ? allProjects
      : allProjects.filter((p) => {
        if (!h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers)) return false
        const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers
        return scope === 'teamLead' ? a.teamLead === me : a.pm === me
      })
```

(`Project` extends `Space`, which has `archived: boolean`, so `p.archived` is available on the `Project[]` from the query.)

- [ ] **Step 3: Org branch in `excludeFromTeam`**

The `pmSet` reactive is unchanged (it stays cheap and harmless). Change the `excludeFromTeam` line (~222) from:

```svelte
  $: excludeFromTeam = new Set([...pmSet, ...inactiveEmps])
```

to:

```svelte
  // Org view keeps PMs visible (owner wants full workload visibility); scoped PM/TL views drop the PM.
  $: excludeFromTeam = scope === 'org' ? inactiveEmps : new Set([...pmSet, ...inactiveEmps])
```

- [ ] **Step 4: Verify**

No unit test (UI). Run `cd plugins/yg-timesheet-resources && npx --no-install eslint src/components/Dashboard.svelte` (no NEW errors vs baseline - use `git stash` and compare the `:LINE:COL error` lines if unsure) and `npx --no-install jest dashboard.test -c jest.config.js` (still passes).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/Dashboard.svelte
git commit -m "feat(yg-timesheet): org scope on Dashboard (all active projects, PMs kept in team)"
```

---

### Task 3: `OrgDashboard.svelte` tab shell + route it

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/OrgDashboard.svelte`
- Modify: `plugins/yg-timesheet-resources/src/components/DashboardHome.svelte`

**Interfaces:**
- Consumes: `Dashboard` `scope="org"` (Task 2), `resolveDashboardRole` `'org'` (Task 1).

- [ ] **Step 1: Create the tab shell**

Create `plugins/yg-timesheet-resources/src/components/OrgDashboard.svelte`. Model the segmented control on `MyAttendance.svelte`'s `att-seg` classes (see its `<style>` at lines ~430-437). Default tab is Projects.

```svelte
<script lang="ts">
  // Organization dashboard for Owners: a tab shell over the all-active-projects view (Dashboard
  // scope="org") and the HR dashboard. No data logic here - each tab reuses its dashboard.
  import Dashboard from './Dashboard.svelte'
  import HrDashboard from './HrDashboard.svelte'

  let tab: 'projects' | 'hr' = 'projects'
</script>

<div class="org">
  <div class="org__seg" role="group">
    <button class="org__opt" class:is-on={tab === 'projects'} on:click={() => (tab = 'projects')}>Projects</button>
    <button class="org__opt" class:is-on={tab === 'hr'} on:click={() => (tab = 'hr')}>HR</button>
  </div>
  {#if tab === 'projects'}
    <Dashboard scope="org" />
  {:else}
    <HrDashboard />
  {/if}
</div>

<style lang="scss">
  @use './yg-table' as *;
  .org { display: flex; flex-direction: column; }
  .org__seg { display: inline-flex; padding: 3px; gap: 3px; margin: 12px 16px 0; background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 10px; align-self: flex-start; }
  .org__opt { border: none; background: transparent; padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 640; color: var(--yg-text-dim); cursor: pointer; }
  .org__opt:hover { color: var(--yg-text); }
  .org__opt.is-on { background: var(--yg-ink); color: var(--yg-ink-fg); box-shadow: var(--yg-shadow); }
</style>
```

If the `@use './yg-table'` import or a CSS var is not needed/available, drop it - the only hard requirement is the two-button segmented control that toggles `tab` and matches the plugin's visual style. Check `MyAttendance.svelte` for the exact var names it uses (e.g. `--yg-panel-soft`, `--yg-ink`, `--yg-ink-fg`, `--yg-border`, `--yg-shadow`, `--yg-text-dim`) and reuse those.

- [ ] **Step 2: Route role `'org'` in DashboardHome**

In `DashboardHome.svelte`:
- Add the import: `import OrgDashboard from './OrgDashboard.svelte'` (next to the other dashboard imports).
- Add an `'org'` branch as the FIRST role branch in the template (right after `{#if !ready}`):

```svelte
{#if !ready}
  <!-- queries still resolving; render nothing to avoid a role flash -->
{:else if role === 'org'}
  <OrgDashboard />
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

- [ ] **Step 3: Verify**

No unit test (UI). Run `cd plugins/yg-timesheet-resources && npx --no-install eslint src/components/OrgDashboard.svelte src/components/DashboardHome.svelte` (no NEW errors vs baseline) and `npx --no-install jest dashboard.test -c jest.config.js` (still passes). Confirm `DashboardHome` still renders nothing until `ready`, and that the five role branches (`org`/`pm`/`teamLead`/`hr`/`employee`) are all present.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/OrgDashboard.svelte plugins/yg-timesheet-resources/src/components/DashboardHome.svelte
git commit -m "feat(yg-timesheet): OrgDashboard tab shell (Projects | HR) routed for admins"
```

---

## Deployment and manual verification

Client-only change, so a front-only build. From `huly-migration/huly-selfhost`:

```bash
./build-beta.sh --front-only
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d front
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
```

Then at `http://localhost:8087` (HTTP 200 check first), open the Dashboard app as:

1. A workspace **Owner** (e.g. restore K2 to OWNER, or use another owner) -> lands on the **Organization** dashboard with two tabs. Projects tab shows all active (non-archived) projects; HR tab shows the HR dashboard. An Owner who is also a PM still gets this (not the scoped PM view).
2. A non-owner **`Project Manager`** (stanly) -> still the scoped PM dashboard (his pm projects only).
3. A non-owner **`Team Leader`** (K2 as USER) -> still the scoped TL dashboard.
4. On the org Projects tab, "Team this week" still hides deactivated employees but now KEEPS PMs.
5. Archived projects do not appear on the org Projects tab.

Local OTP for test logins: read from the DB (no mail service) - `global_account.otp` joined to `social_id`.

## Notes

- `OrgDashboard` needs no component ref / resources registration - it is a direct Svelte import in `DashboardHome`, exactly like `Dashboard`/`HrDashboard`/`EmployeeDashboard`.
- The Projects tab loads all issues/time across active projects; this is the same cost the current admin PM view already pays (admins already saw all projects).
