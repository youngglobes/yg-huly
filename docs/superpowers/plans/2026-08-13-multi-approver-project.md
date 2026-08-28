# Multiple PM / Team Lead per project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project's `ProjectApprovers` config hold multiple PMs and multiple Team Leads, with every existing feature (dashboards, approvals, reports, workflow helpers, server guard) adapting.

**Architecture:** Change the `ProjectApprovers` mixin `pm`/`teamLead` from single `Ref<Employee>` to `Ref<Employee>[]`. A one pure normalizer (`asRefArray`) funnels every read so scalar-vs-array is handled in exactly one place. A migrate-phase migration converts existing scalars to single-element arrays. Approval stays "any one listed approver is enough" (a bigger set, no new state machine).

**Tech Stack:** TypeScript, Svelte, Huly platform (`@hcengineering/model`, `contact-resources`), jest (ts-jest) in `plugins/yg-timesheet-resources`.

**Spec:** `docs/superpowers/specs/2026-08-13-multi-approver-project-design.md`

## Global Constraints

- **No em-dashes** anywhere (code, comments, commit messages, output). Use hyphens or rephrase.
- **No semicolons** in TypeScript; 2-space indent (match surrounding code).
- **Approval semantics unchanged:** any one listed PM or TL can approve; no self-approve ever; the union of all PMs+TLs of a task's project (minus the employee) is the approver set. No dual sign-off, no per-approver tracking.
- **Out of scope, do not touch:** HR `Department.teamLead` (`plugins/hr/src/index.ts`, `plugins/hr-resources/src/components/*`, `models/hr/src/migration.ts`) - a different, single-lead model that only shares the field name.
- **Tests:** run from `plugins/yg-timesheet-resources` with `npx jest <path>` (script: `npm test`).
- **eslint gate:** the repo has pre-existing lint debt. "No new errors" means: `git stash` baseline vs your change produce the same set of `path:LINE:COL error` lines. Never judge by the summary count.
- The shared plugin package `@hcengineering/yg-timesheet` (`plugins/yg-timesheet/src/index.ts`) has NO jest setup, so testable pure code goes in `plugins/yg-timesheet-resources/src/utils/workflow.ts`.

---

### Task 1: `asRefArray` normalizer (pure) + unit tests

The single place scalar/null/array handling lives. Generic so both string-typed pure helpers and `Ref<Employee>`-typed Svelte reads share it.

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/workflow.ts` (add export near top, after the imports/`DayStatus`)
- Test: `plugins/yg-timesheet-resources/src/utils/__tests__/approver-array.test.ts` (create)

**Interfaces:**
- Produces: `asRefArray<T>(v: T | T[] | null | undefined): T[]` from `./workflow`.

- [ ] **Step 1: Write the failing test**

Create `plugins/yg-timesheet-resources/src/utils/__tests__/approver-array.test.ts`:

```ts
import { asRefArray } from '../workflow'

describe('asRefArray', () => {
  it('empties -> []', () => {
    expect(asRefArray(undefined)).toEqual([])
    expect(asRefArray(null)).toEqual([])
    expect(asRefArray('')).toEqual([])
    expect(asRefArray([])).toEqual([])
  })
  it('single legacy scalar -> one-element array', () => {
    expect(asRefArray('emp-1')).toEqual(['emp-1'])
  })
  it('array passes through, dropping empties', () => {
    expect(asRefArray(['a', 'b'])).toEqual(['a', 'b'])
    expect(asRefArray(['a', '', 'b'])).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/yg-timesheet-resources && npx jest src/utils/__tests__/approver-array.test.ts`
Expected: FAIL - `asRefArray` is not exported from `../workflow`.

- [ ] **Step 3: Write minimal implementation**

In `plugins/yg-timesheet-resources/src/utils/workflow.ts`, add (place it above `ProjectApproverLike`):

```ts
// Normalize a possibly-scalar (legacy single value), possibly-null approver field to a clean
// array with empties removed. Generic so the string-typed pure helpers and the Ref<Employee>-typed
// Svelte reads share one implementation. Belt-and-suspenders with the scalar->array migration:
// any doc that slips through un-migrated still reads correctly.
export function asRefArray<T> (v: T | T[] | null | undefined): T[] {
  if (v == null) return []
  const arr = Array.isArray(v) ? v : [v]
  return arr.filter((x): x is T => x != null && (x as unknown) !== '')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugins/yg-timesheet-resources && npx jest src/utils/__tests__/approver-array.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/workflow.ts plugins/yg-timesheet-resources/src/utils/__tests__/approver-array.test.ts
git commit -m "feat(yg-timesheet): asRefArray approver normalizer (pure)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Generalize the pure approver helpers to arrays

`buildTaskUnits`, `resolveApprovers`, `canApproveView` and the `ProjectApproverLike` type move from scalar to array, using `asRefArray`. Keep the input type a `string | string[]` union so legacy scalar rows still typecheck and the normalizer is exercised.

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/workflow.ts` (`ProjectApproverLike`, `resolveApprovers`)
- Modify: `plugins/yg-timesheet-resources/src/utils/task-approval.ts` (`buildTaskUnits`, `canApproveView`)
- Test: `plugins/yg-timesheet-resources/src/__tests__/workflow.test.ts` (update + add multi-PM case)
- Test: `plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts` (update + add multi-PM case)

**Interfaces:**
- Consumes: `asRefArray` from `./workflow` (Task 1).
- Produces: `ProjectApproverLike = { pm?: string | string[] | null, teamLead?: string | string[] | null }`; `resolveApprovers`, `buildTaskUnits`, `canApproveView` signatures otherwise unchanged.

- [ ] **Step 1: Update the tests to array shape and add a multi-PM case (failing)**

In `plugins/yg-timesheet-resources/src/__tests__/workflow.test.ts`, add after the existing `resolveApprovers` assertion (near line 28):

```ts
  it('resolveApprovers unions multiple PMs and TLs, minus the employee', () => {
    const got = resolveApprovers(
      [rep('P1', 'i1', 2)],
      new Map([['P1', { pm: ['A', 'D'], teamLead: ['B'] }]]),
      'A'
    )
    expect(got.sort()).toEqual(['B', 'D']) // A removed (self), D + B remain
  })
```

In `plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts`, add near the existing `canApproveView` cases (line ~112):

```ts
    expect(canApproveView(false, [{ pm: ['other', me] }], me)).toBe(true)
    expect(canApproveView(false, [{ teamLead: ['x', me] }], me)).toBe(true)
    expect(canApproveView(false, [{ pm: ['x'], teamLead: ['y'] }], me)).toBe(false)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd plugins/yg-timesheet-resources && npx jest src/__tests__/workflow.test.ts src/utils/__tests__/task-approval.test.ts`
Expected: FAIL - array inputs are not accepted / not unioned (type error or wrong result).

- [ ] **Step 3: Implement the array generalization**

In `workflow.ts`, change the type:

```ts
export interface ProjectApproverLike { pm?: string | string[] | null, teamLead?: string | string[] | null }
```

and `resolveApprovers`'s loop body (was two `if (pa?.pm != null && pa.pm !== '') set.add(pa.pm)` lines):

```ts
  for (const r of reports) {
    const pa = byProject.get(r.project)
    for (const id of asRefArray(pa?.pm)) set.add(id)
    for (const id of asRefArray(pa?.teamLead)) set.add(id)
  }
```

In `task-approval.ts`, add `asRefArray` to the existing import from `./workflow`:

```ts
import { asRefArray, type DayReportLike, type ProjectApproverLike } from './workflow'
```

Replace `buildTaskUnits`'s approver-set lines (was the two `if (pa?.pm != null ...)` lines):

```ts
      const set = new Set<string>()
      for (const id of asRefArray(pa?.pm)) set.add(id)
      for (const id of asRefArray(pa?.teamLead)) set.add(id)
      set.delete(employee) // no self-approve
```

Replace `canApproveView` (signature type + body):

```ts
export function canApproveView (
  isAdmin: boolean,
  approverPairs: ProjectApproverLike[],
  me: string
): boolean {
  if (isAdmin) return true
  return approverPairs.some((a) => asRefArray(a.pm).includes(me) || asRefArray(a.teamLead).includes(me))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd plugins/yg-timesheet-resources && npx jest src/__tests__/workflow.test.ts src/utils/__tests__/task-approval.test.ts`
Expected: PASS (existing scalar rows still pass via the union type + normalizer; new multi-PM rows pass).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/workflow.ts plugins/yg-timesheet-resources/src/utils/task-approval.ts plugins/yg-timesheet-resources/src/__tests__/workflow.test.ts plugins/yg-timesheet-resources/src/utils/__tests__/task-approval.test.ts
git commit -m "feat(yg-timesheet): union multiple PM/TL in pure approver helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Data model, interface, and scalar->array migration

The mixin becomes arrays and existing projects migrate. No jest here; verification is a clean build (Task 7) plus the beta upgrade spot-check.

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts:107-110` (interface `ProjectApprovers`)
- Modify: `models/yg-timesheet/src/index.ts:135-142` (mixin `@Prop`s)
- Modify: `models/yg-timesheet/src/migration.ts` (add migration fn + register it in the `migrate` phase)

**Interfaces:**
- Produces: `ProjectApprovers.pm?: Ref<Employee>[]`, `ProjectApprovers.teamLead?: Ref<Employee>[]`.

- [ ] **Step 1: Interface -> arrays**

In `plugins/yg-timesheet/src/index.ts`, change the `ProjectApprovers` fields:

```ts
export interface ProjectApprovers extends Project {
  pm?: Ref<Employee>[]
  teamLead?: Ref<Employee>[]
}
```

- [ ] **Step 2: Mixin props -> ArrOf**

In `models/yg-timesheet/src/index.ts` (`TProjectApprovers`, lines ~137-141). `ArrOf` is already imported. Change:

```ts
  @Prop(ArrOf(TypeRef(contact.mixin.Employee)), ygTimesheet.string.PM)
    pm?: Ref<Employee>[]

  @Prop(ArrOf(TypeRef(contact.mixin.Employee)), ygTimesheet.string.TeamLead)
    teamLead?: Ref<Employee>[]
```

- [ ] **Step 3: Add the migration function**

In `models/yg-timesheet/src/migration.ts`, add near the other migrate-phase helpers (tracker projects are Spaces -> `DOMAIN_SPACE`, already imported; `Project` type already imported):

```ts
// Convert the ProjectApprovers mixin's pm/teamLead from the legacy single Ref to Ref[]. Runs in
// the `migrate` phase (raw domain write, like migrateDaysToTasks). Huly stores mixin data NESTED
// under the mixin's key in the doc's `data` JSONB (NOT flat) - so read and write via that key,
// matching models/contact/src/migration.ts. Idempotent: only rewrites a field still scalar/null,
// leaves already-array values untouched. Projects with no approver mixin are skipped.
async function migrateApproversToArrays (client: MigrationClient): Promise<void> {
  const mixinKey = ygTimesheet.mixin.ProjectApprovers
  const projects = await client.find<Project>(DOMAIN_SPACE, { _class: tracker.class.Project })
  for (const p of projects) {
    const m = (p as unknown as Record<string, { pm?: unknown, teamLead?: unknown }>)[mixinKey]
    if (m == null) continue // no approvers mixin on this project
    const upd: Record<string, Ref<Employee>[]> = {}
    for (const key of ['pm', 'teamLead'] as const) {
      const v = m[key]
      if (v === undefined || Array.isArray(v)) continue // absent or already migrated
      upd[key] = v == null || v === '' ? [] : [v as Ref<Employee>]
    }
    if (Object.keys(upd).length > 0) {
      await client.update(DOMAIN_SPACE, { _id: p._id }, { [mixinKey]: { ...m, ...upd } })
    }
  }
}
```

- [ ] **Step 4: Register it in the `migrate` phase**

In the same file, in `ygTimesheetOperation.migrate`, add the call (order does not matter relative to the others; put it last):

```ts
  async migrate (client: MigrationClient, mode): Promise<void> {
    await migrateDaysToTasks(client)
    await openApprovalsSpaceRaw(client)
    await migrateApproversToArrays(client)
  },
```

- [ ] **Step 5: Typecheck the changed packages**

Run: `cd plugins/yg-timesheet && npx tsc --noEmit -p tsconfig.json` and `cd ../../models/yg-timesheet && npx tsc --noEmit -p tsconfig.json`
Expected: no NEW type errors from these files (compare against a `git stash` baseline if the packages already have pre-existing errors).

- [ ] **Step 6: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts models/yg-timesheet/src/index.ts models/yg-timesheet/src/migration.ts
git commit -m "feat(yg-timesheet): ProjectApprovers pm/teamLead -> arrays + migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Editor UI - multi-select PM/TL

Swap the single-select `EmployeeBox` for `UserBoxList`. Verified visually on beta (Task 7).

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/ProjectApprovers.svelte`

**Interfaces:**
- Consumes: `ProjectApprovers.pm/teamLead: Ref<Employee>[]` (Task 3); `UserBoxList` from `@hcengineering/contact-resources` (`items: Ref<Person>[]`, `_class` defaults to `contact.mixin.Employee`, dispatches `on:update` with the array).

- [ ] **Step 1: Swap the import**

Change line 16 from `import { EmployeeBox } from '@hcengineering/contact-resources'` to:

```ts
  import { UserBoxList } from '@hcengineering/contact-resources'
```

- [ ] **Step 2: Replace the PM field**

Replace the PM `<EmployeeBox>` block (lines ~57-65) with:

```svelte
      <UserBoxList
        label={ygTimesheet.string.PM}
        kind="regular"
        size="large"
        items={mixin?.pm ?? []}
        on:update={(e) => set({ pm: e.detail })}
      />
```

- [ ] **Step 3: Replace the Team Lead field**

Replace the Team Lead `<EmployeeBox>` block (lines ~69-77) with:

```svelte
      <UserBoxList
        label={ygTimesheet.string.TeamLead}
        kind="regular"
        size="large"
        items={mixin?.teamLead ?? []}
        on:update={(e) => set({ teamLead: e.detail })}
      />
```

- [ ] **Step 4: Typecheck / svelte-check the component**

Run: `cd plugins/yg-timesheet-resources && npx svelte-check --threshold error 2>&1 | grep -i ProjectApprovers.svelte || echo "no ProjectApprovers.svelte errors"`
Expected: no errors for this file. (If `svelte-check` is not wired, rely on the full build in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/ProjectApprovers.svelte
git commit -m "feat(yg-timesheet): multi-select PM/TL editor (UserBoxList)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Client read sites -> array membership / union

Every Svelte/index read of `.pm`/`.teamLead` goes through `asRefArray`. `me` here is `Ref<Employee>`. Verified by the (already-passing) pure-helper tests plus the full build; behavior confirmed on beta in Task 7.

**Files (all Modify):**
- `plugins/yg-timesheet-resources/src/index.ts:44,74`
- `plugins/yg-timesheet-resources/src/components/Approvals.svelte:43`
- `plugins/yg-timesheet-resources/src/components/Reports.svelte:52`
- `plugins/yg-timesheet-resources/src/components/Dashboard.svelte:86,219`
- `plugins/yg-timesheet-resources/src/components/DashboardHome.svelte:53-55`
- `plugins/yg-timesheet-resources/src/components/HrDashboard.svelte:74`
- `plugins/yg-timesheet-resources/src/utils/day.ts:262,264`

**Interfaces:**
- Consumes: `asRefArray` from `../utils/workflow` (Task 1); `ProjectApprovers` arrays (Task 3).

- [ ] **Step 1: `index.ts`**

Add `asRefArray` to the imports from `./utils/workflow` (create the import if the file imports nothing from there yet). Line 44 `return { pm: a.pm, teamLead: a.teamLead }` -> `return { pm: asRefArray(a.pm), teamLead: asRefArray(a.teamLead) }`. Line 74 `return a.pm === me || a.teamLead === me` -> `return asRefArray(a.pm).includes(me) || asRefArray(a.teamLead).includes(me)`.

- [ ] **Step 2: `Approvals.svelte` and `Reports.svelte`**

Both have `return a.pm === me || a.teamLead === me` (Approvals:43, Reports:52). In each, import `asRefArray` from `../utils/workflow` and change to:

```ts
      return asRefArray(a.pm).includes(me) || asRefArray(a.teamLead).includes(me)
```

- [ ] **Step 3: `Dashboard.svelte`**

Import `asRefArray` from `../utils/workflow`. Line 86 (scope filter) `return scope === 'teamLead' ? a.teamLead === me : a.pm === me` ->

```ts
        return scope === 'teamLead' ? asRefArray(a.teamLead).includes(me) : asRefArray(a.pm).includes(me)
```

Line 219 (pmSet build) `const pm = (h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers).pm` and its following `set.add(pm)` usage ->

```ts
      const pms = asRefArray((h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers).pm)
      for (const id of pms) pmSet.add(id)
```

(Adjust the variable name to the existing `pmSet` accumulator; if the current code guarded `if (pm != null) pmSet.add(pm)`, replace that guard+add with the `for` loop above.)

- [ ] **Step 4: `DashboardHome.svelte`**

Import `asRefArray` from `../utils/workflow`. Lines 53-55:

```ts
      .map((p) => { const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers; return { pm: asRefArray(a.pm), teamLead: asRefArray(a.teamLead) } })
    isPmApprover = pairs.some((a) => a.pm.includes(me))
    isTlApprover = pairs.some((a) => a.teamLead.includes(me))
```

- [ ] **Step 5: `HrDashboard.svelte`**

Import `asRefArray` from `../utils/workflow`. Line 74 `return [a.pm, a.teamLead]` (inside a flatMap building an id list) ->

```ts
        return [...asRefArray(a.pm), ...asRefArray(a.teamLead)]
```

- [ ] **Step 6: `day.ts`**

Import `asRefArray` from `./workflow` (same dir). Line 262 `out.set(project._id, { pm: m.pm ?? null, teamLead: m.teamLead ?? null })` -> `out.set(project._id, { pm: asRefArray(m.pm), teamLead: asRefArray(m.teamLead) })`. Line 264 empty default `out.set(project._id, { pm: null, teamLead: null })` -> `out.set(project._id, { pm: [], teamLead: [] })`.

- [ ] **Step 7: Run the full resources test suite (guards against a broken read wiring)**

Run: `cd plugins/yg-timesheet-resources && npm test`
Expected: PASS (all suites, including dashboard/workflow/task-approval).

- [ ] **Step 8: eslint no-new-errors check**

Run (from repo root): capture your change's errors for the touched files and compare to a `git stash` baseline per the Global Constraints eslint gate.
Expected: no new `path:LINE:COL error` lines.

- [ ] **Step 9: Commit**

```bash
git add plugins/yg-timesheet-resources/src/index.ts plugins/yg-timesheet-resources/src/components/Approvals.svelte plugins/yg-timesheet-resources/src/components/Reports.svelte plugins/yg-timesheet-resources/src/components/Dashboard.svelte plugins/yg-timesheet-resources/src/components/DashboardHome.svelte plugins/yg-timesheet-resources/src/components/HrDashboard.svelte plugins/yg-timesheet-resources/src/utils/day.ts
git commit -m "feat(yg-timesheet): adapt client reads to array PM/TL (asRefArray)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Server guard + approver set -> arrays

Security-sensitive. The guard already reverts any non-admin mixin write wholesale, so arrays add no new escalation path; only the shape of the restore/clear values and the union changes. Server-plugins can't import the client `asRefArray`, so add a tiny local copy.

**Files:**
- Modify: `server-plugins/yg-timesheet-resources/src/index.ts` (add local `asRefArray`; lines ~348-349 union; ~777-778 revertAttrs)

**Interfaces:**
- Consumes: `ProjectApprovers` arrays (Task 3).

- [ ] **Step 1: Add a local normalizer**

Near the top of `server-plugins/yg-timesheet-resources/src/index.ts` (after imports), add:

```ts
// Local copy of the client-side normalizer (server-plugins cannot import client resources).
// Legacy scalar or new array -> clean array; null/undefined/empty -> [].
function asRefArray<T> (v: T | T[] | null | undefined): T[] {
  if (v == null) return []
  const arr = Array.isArray(v) ? v : [v]
  return arr.filter((x): x is T => x != null && (x as unknown) !== '')
}
```

- [ ] **Step 2: Union in `approverRoleSet`**

Replace lines ~348-349 (was `if (pa.pm != null) set.add(pa.pm)` / `if (pa.teamLead != null) set.add(pa.teamLead)`):

```ts
    for (const id of asRefArray(pa.pm)) set.add(id)
    for (const id of asRefArray(pa.teamLead)) set.add(id)
```

- [ ] **Step 3: Array-shaped revert in `OnProjectApproversMixinGuard`**

Replace the `revertAttrs` assignment (was `prevMixin !== undefined ? { pm: prevMixin.pm ?? null, teamLead: prevMixin.teamLead ?? null } : { pm: null, teamLead: null }`):

```ts
    const revertAttrs: Record<string, any> = {
      pm: asRefArray(prevMixin?.pm),
      teamLead: asRefArray(prevMixin?.teamLead)
    }
```

(This preserves the semantics: restore the prior arrays, or clear to `[]` when there is no prior mixin. `asRefArray(undefined)` is `[]`.)

- [ ] **Step 4: Typecheck the server plugin**

Run: `cd server-plugins/yg-timesheet-resources && npx tsc --noEmit -p tsconfig.json`
Expected: no NEW type errors (compare to `git stash` baseline if pre-existing errors exist).

- [ ] **Step 5: Commit**

```bash
git add server-plugins/yg-timesheet-resources/src/index.ts
git commit -m "feat(yg-timesheet): server approver set + guard adapt to array PM/TL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Build, deploy to beta, migrate, and verify end to end

MODEL change (mixin prop type + migration), so the full deploy path. Run from `huly-migration/huly-selfhost`.

**Files:** none (build + ops)

- [ ] **Step 1: Push the branch**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && git push origin yg_beta
```

- [ ] **Step 2: Full beta build**

From `/home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost`:
Run: `./build-beta.sh` (full, not `--front-only`)
Expected: ends with "Done in …"; fresh `yg-local/*:beta` images.

- [ ] **Step 3: Recreate the model/server-carrying services + front, restart nginx**

```bash
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d transactor account front
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
```

- [ ] **Step 4: Run the workspace upgrade (applies the migration)**

Run: `./run-tool-beta.sh upgrade-workspace yg`
Expected: completes; migration state advances (no error). The migrate phase runs `migrateApproversToArrays`.

- [ ] **Step 5: Front HTTP 200**

Run: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8087/`
Expected: `200`.

- [ ] **Step 6: DB spot-check the migration**

From `huly-selfhost`, using the CR_DB_URL pattern, confirm a known approver project now stores arrays. Mixin data is nested under `data->'yg-timesheet:mixin:ProjectApprovers'`, NOT a flat column:

```bash
URL="$(grep -E '^CR_DB_URL=' huly_v7.conf | cut -d= -f2-)?sslmode=require"
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml exec -T cockroach cockroach sql --url "$URL" --format=records -e "
SELECT _id, data->'yg-timesheet:mixin:ProjectApprovers' AS approvers
FROM space
WHERE data ? 'yg-timesheet:mixin:ProjectApprovers' LIMIT 5;"
```

Expected: `pm` / `teamLead` inside the nested object render as JSON arrays (e.g. `{"pm": ["6696..."], "teamLead": ["6696..."]}`), not bare strings. This actively inspects a previously-scalar project's post-migration value - a silent no-op migration would still show bare strings here, so this is the real gate.

- [ ] **Step 7: Manual functional check on beta (report results back)**

- Configure a project with TWO PMs and TWO TLs in the Approvers config; confirm the editor shows multiple chips and persists after refresh.
- Log in as each of the two PMs: both land on the PM dashboard scoped to that project and can approve a timesheet on it.
- Confirm the Org and HR dashboards still tally correctly.
- Confirm a non-admin attempt to add themselves as PM (via API) is still reverted by the guard (approver set unchanged).

- [ ] **Step 8: Final commit (if any doc/state updates) and stop**

No code commit expected here; report the deploy + verification outcome. Prod follows only when the batch merges to `yg_develop`.

---

## Self-Review

**Spec coverage:**
- Data model arrays -> Task 3. Migration -> Task 3. Defensive normalizer -> Task 1. Editor UI -> Task 4. Read sites (membership + union + pass-through) -> Task 5 (client), Task 6 (server), Task 2 (pure helpers). Security guard -> Task 6. Approval semantics unchanged -> preserved in Tasks 2/5/6 (union + no self-approve, no new state). Testing -> Tasks 1,2 (unit) + Task 7 (migration + manual). Deploy -> Task 7. HR out-of-scope -> Global Constraints. All spec sections map to a task.

**Placeholder scan:** every code step shows the actual before/after. The only deliberately deferred item is the exact `svelte-check` invocation (Task 4 Step 4), with the full build in Task 7 as the backstop - not a logic placeholder.

**Type consistency:** `asRefArray<T>` signature identical in Task 1 (client) and Task 6 (server local copy). `ProjectApproverLike` union type (Task 2) accepts both scalar and array, consumed by `resolveApprovers`/`buildTaskUnits`/`canApproveView`. `ProjectApprovers.pm/teamLead: Ref<Employee>[]` (Task 3) consumed by Tasks 4/5/6. `UserBoxList` uses `items` + `on:update` (Task 4), matching the component's real props.
