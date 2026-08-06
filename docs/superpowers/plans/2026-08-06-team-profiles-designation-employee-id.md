# Team Profiles: Designation + Employee ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the team-profiles **Category** field with a 24-title **Designation** field and add an **Employee ID** text field, both on the `WorkProfile` employee mixin, keeping the Performance report working via a curated tracked-designation set.

**Architecture:** `WorkProfile` mixin (on `contact.mixin.Employee`) swaps `category: WorkProfileCategory` for `designation?: WorkDesignation` (literal-title union) and gains `employeeId?: string`. The Performance report's `isTracked` moves from `TRACKED_CATEGORIES` to `TRACKED_DESIGNATIONS`. A one-shot migration maps each retired category to a default designation so the report stays populated on deploy.

**Tech Stack:** Huly platform (TypeScript, Svelte, rush + pnpm), `@hcengineering/yg-timesheet` plugin/model/resources, jest, svelte-check.

## Global Constraints

- Branch is `yg_beta`. NEVER merge to `yg_develop` (it auto-deploys to prod). All work stays on `yg_beta`.
- No em-dashes in code, comments, commit messages, or UI copy (they read as an AI tell).
- Designation is stored as the **literal title string**, typed by the `WorkDesignation` union. `DESIGNATIONS` in `utils/work-profile.ts` is the single source of truth for the list and its order. No slug/i18n indirection.
- The 24 designations, in dropdown order: `Software Engineer Trainee`, `Associate Software Engineer`, `Senior Software Engineer`, `Team Leader`, `Project Manager`, `Software Test Engineer`, `Senior Software Tester`, `Web Designer`, `Front End Developer`, `Senior Front End Developer`, `SEO Analyst Trainee`, `SEO Analyst`, `Senior SEO Analyst`, `Business Development Executive`, `Senior Business Development Executive`, `Business Development Manager`, `Salesforce Developer`, `Senior Salesforce Developer`, `Lead Generation Executive`, `CEO`, `CTO`, `COO`, `HR Executive`, `Intern`.
- The 11 **tracked** designations (appear in the Performance report): `Software Engineer Trainee`, `Associate Software Engineer`, `Senior Software Engineer`, `Team Leader`, `Software Test Engineer`, `Senior Software Tester`, `Web Designer`, `Front End Developer`, `Senior Front End Developer`, `Salesforce Developer`, `Senior Salesforce Developer`. The other 13 are untracked.
- Employee ID is free text (placeholder `YGS0024`), trimmed on save, no enforced regex. Employee ID does NOT appear in the Performance report or xlsx (team-profiles page only).
- **Build note on task ordering:** this is one atomic type rename spread across packages. Task 1 is gated by jest (its files compile in isolation under ts-jest). Full-package `rushx _phase:validate` only goes green from Task 2 onward, once every Svelte/model consumer is updated. Intermediate cross-file type errors between Task 1 and Task 2 are expected and not a defect.
- Commands (run from repo root unless noted):
  - jest: `cd plugins/yg-timesheet-resources && rushx test`
  - validate (resources): `cd plugins/yg-timesheet-resources && rushx _phase:validate`
  - validate (model + plugin): `cd models/yg-timesheet && rushx _phase:validate`

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `plugins/yg-timesheet/src/index.ts` | `WorkDesignation` type, `WorkProfile` interface, string ids | 1 |
| `plugins/yg-timesheet-resources/src/utils/work-profile.ts` | `DESIGNATIONS`, `TRACKED_DESIGNATIONS`, `isTracked`, time helpers | 1 |
| `plugins/yg-timesheet-resources/src/utils/performance.ts` | `PerfEmp`/`PerfRow` designation, tracked filter | 1 |
| `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts` | perf logic fixtures (designation) | 1 |
| `plugins/yg-timesheet-resources/src/__tests__/work-profile.test.ts` | new: designation list + isTracked | 1 |
| `models/yg-timesheet/src/index.ts` | `TWorkProfile` `@Prop`s | 2 |
| `plugins/yg-timesheet-assets/lang/en.json`, `.../ru.json` | string values | 2 |
| `plugins/yg-timesheet-resources/src/components/WorkProfileEditor.svelte` | team-profiles editor (Employee ID + Designation) | 2 |
| `plugins/yg-timesheet-resources/src/components/Performance.svelte` | report Designation column | 2 |
| `plugins/yg-timesheet-resources/src/utils/performance-xlsx.ts` | xlsx Designation column | 2 |
| `models/yg-timesheet/src/migration.ts` | category to designation backfill | 3 |

---

## Task 1: Types, tracked constants, and Performance logic (jest-gated)

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts` (lines 109-114 interface/type; lines 383-388 string ids)
- Modify: `plugins/yg-timesheet-resources/src/utils/work-profile.ts` (lines 1-9)
- Modify: `plugins/yg-timesheet-resources/src/utils/performance.ts` (lines 1, 6, 22, 45, 115)
- Modify: `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts` (lines 8-16, test title line 18)
- Create: `plugins/yg-timesheet-resources/src/__tests__/work-profile.test.ts`

**Interfaces:**
- Produces: `WorkDesignation` (union of the 24 titles) and `WorkProfile { designation?: WorkDesignation; employeeId?: string; shiftStart?: number }` from `@hcengineering/yg-timesheet`; `DESIGNATIONS: WorkDesignation[]`, `TRACKED_DESIGNATIONS: Set<WorkDesignation>`, `isTracked(d: WorkDesignation | undefined): boolean` from `utils/work-profile`; `PerfEmp { id; name; designation? }` and `PerfRow { ...; designation?: WorkDesignation }` from `utils/performance`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Update the plugin type + interface**

In `plugins/yg-timesheet/src/index.ts`, replace lines 109-114:

```ts
export type WorkDesignation =
  | 'Software Engineer Trainee' | 'Associate Software Engineer' | 'Senior Software Engineer'
  | 'Team Leader' | 'Project Manager' | 'Software Test Engineer' | 'Senior Software Tester'
  | 'Web Designer' | 'Front End Developer' | 'Senior Front End Developer'
  | 'SEO Analyst Trainee' | 'SEO Analyst' | 'Senior SEO Analyst'
  | 'Business Development Executive' | 'Senior Business Development Executive'
  | 'Business Development Manager' | 'Salesforce Developer' | 'Senior Salesforce Developer'
  | 'Lead Generation Executive' | 'CEO' | 'CTO' | 'COO' | 'HR Executive' | 'Intern'
export interface WorkProfile extends Employee {
  designation?: WorkDesignation
  // Free text, e.g. "YGS0024".
  employeeId?: string
  // Local time-of-day the employee is expected to start, in minutes since midnight (540 = 09:00).
  shiftStart?: number
}
```

- [ ] **Step 2: Update the string ids**

In the same file, in the `string` id block (around lines 383-388), remove these six lines:

```ts
    WorkProfileCategoryLabel: '' as IntlString,
    CatJuniorDev: '' as IntlString,
    CatSeniorDev: '' as IntlString,
    CatSales: '' as IntlString,
    CatSalesforce: '' as IntlString,
    CatOther: '' as IntlString,
```

and add (keep `ShiftStart` as-is):

```ts
    Designation: '' as IntlString,
    EmployeeId: '' as IntlString,
```

- [ ] **Step 3: Rewrite `utils/work-profile.ts` constants**

Replace lines 1-9 of `plugins/yg-timesheet-resources/src/utils/work-profile.ts` (leave `minutesToHHMM` / `hhmmToMinutes` below untouched):

```ts
import { type WorkDesignation } from '@hcengineering/yg-timesheet'

export const DESIGNATIONS: WorkDesignation[] = [
  'Software Engineer Trainee', 'Associate Software Engineer', 'Senior Software Engineer',
  'Team Leader', 'Project Manager', 'Software Test Engineer', 'Senior Software Tester',
  'Web Designer', 'Front End Developer', 'Senior Front End Developer',
  'SEO Analyst Trainee', 'SEO Analyst', 'Senior SEO Analyst',
  'Business Development Executive', 'Senior Business Development Executive',
  'Business Development Manager', 'Salesforce Developer', 'Senior Salesforce Developer',
  'Lead Generation Executive', 'CEO', 'CTO', 'COO', 'HR Executive', 'Intern'
]

// Titles that appear in the Performance report (dev/tester roles). All others are excluded.
export const TRACKED_DESIGNATIONS = new Set<WorkDesignation>([
  'Software Engineer Trainee', 'Associate Software Engineer', 'Senior Software Engineer',
  'Team Leader', 'Software Test Engineer', 'Senior Software Tester', 'Web Designer',
  'Front End Developer', 'Senior Front End Developer', 'Salesforce Developer',
  'Senior Salesforce Developer'
])

export function isTracked (d: WorkDesignation | undefined): boolean {
  return d !== undefined && TRACKED_DESIGNATIONS.has(d)
}
```

- [ ] **Step 4: Update `utils/performance.ts`**

Make these edits:
- Line 1: `import { type WorkProfileCategory } from '@hcengineering/yg-timesheet'` becomes `import { type WorkDesignation } from '@hcengineering/yg-timesheet'`.
- Line 6: `export interface PerfEmp { id: string; name: string; category?: WorkProfileCategory }` becomes `export interface PerfEmp { id: string; name: string; designation?: WorkDesignation }`.
- Line 22 (inside `PerfRow`): `employee: string; name: string; category: WorkProfileCategory` becomes `employee: string; name: string; designation?: WorkDesignation`.
- Line 45: `const included = emps.filter((e) => isTracked(e.category))` becomes `const included = emps.filter((e) => isTracked(e.designation))`.
- Line 115: `employee: e.id, name: e.name, category: e.category as WorkProfileCategory,` becomes `employee: e.id, name: e.name, designation: e.designation,`.

- [ ] **Step 5: Update the Performance test fixtures**

In `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts`, replace the `emps` array (lines 8-13) with:

```ts
const emps: PerfEmp[] = [
  { id: 'e1', name: 'Alice A', designation: 'Associate Software Engineer' }, // tracked
  { id: 'e2', name: 'Bob B', designation: 'Senior Software Engineer' },       // tracked
  { id: 'sx', name: 'Sam Sales', designation: 'Business Development Executive' }, // excluded
  { id: 'ut', name: 'Un Tagged', designation: undefined }                     // excluded
]
```

and change the first test's title (line 18) from `'includes only dev/senior-dev, excludes sales + untagged'` to `'includes only tracked designations, excludes untracked + untagged'`. Leave every assertion unchanged (e1/e2 remain tracked; sx/ut remain excluded).

- [ ] **Step 6: Create `work-profile.test.ts`**

Create `plugins/yg-timesheet-resources/src/__tests__/work-profile.test.ts`:

```ts
import { DESIGNATIONS, TRACKED_DESIGNATIONS, isTracked } from '../utils/work-profile'

describe('work-profile designations', () => {
  it('lists all 24 designations', () => {
    expect(DESIGNATIONS).toHaveLength(24)
    expect(new Set(DESIGNATIONS).size).toBe(24) // no duplicates
  })

  it('tracks 11 dev/tester titles', () => {
    expect(TRACKED_DESIGNATIONS.size).toBe(11)
    expect(isTracked('Senior Software Engineer')).toBe(true)
    expect(isTracked('Software Test Engineer')).toBe(true)
    expect(isTracked('Team Leader')).toBe(true)
  })

  it('does not track SEO/BD/exec titles or undefined', () => {
    expect(isTracked('SEO Analyst')).toBe(false)
    expect(isTracked('Business Development Executive')).toBe(false)
    expect(isTracked('CEO')).toBe(false)
    expect(isTracked(undefined)).toBe(false)
  })

  it('every tracked title is a known designation', () => {
    for (const d of TRACKED_DESIGNATIONS) expect(DESIGNATIONS).toContain(d)
  })
})
```

- [ ] **Step 7: Rebuild the plugin package, then run the tests**

Dependents (this resources package, its jest, and later svelte-check) resolve `@hcengineering/yg-timesheet` through its built output, so the edits to the plugin `index.ts` (new `WorkDesignation` type + `Designation`/`EmployeeId` string ids) are invisible until the plugin is rebuilt. This is the recurring stale-`.d.ts` gotcha.

Run: `cd plugins/yg-timesheet && rushx _phase:validate`
Expected: PASS (rebuilds the plugin's types).
Run: `cd plugins/yg-timesheet-resources && rushx test`
Expected: PASS (both `performance.test.ts` and `work-profile.test.ts` green). If jest reports `WorkDesignation` or the new string ids as missing, the plugin rebuild above did not take; re-run it before retrying.

- [ ] **Step 8: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts plugins/yg-timesheet-resources/src/utils/work-profile.ts plugins/yg-timesheet-resources/src/utils/performance.ts plugins/yg-timesheet-resources/src/__tests__/performance.test.ts plugins/yg-timesheet-resources/src/__tests__/work-profile.test.ts
git commit -m "feat(yg-timesheet): designation type + tracked set + perf logic (#8)"
```

---

## Task 2: Model props, strings, editor, and report UI (validate-gated)

**Files:**
- Modify: `models/yg-timesheet/src/index.ts` (imports line 45-46; `TWorkProfile` lines 138-142)
- Modify: `plugins/yg-timesheet-assets/lang/en.json` (lines 168-174)
- Modify: `plugins/yg-timesheet-assets/lang/ru.json` (lines 168-174)
- Modify: `plugins/yg-timesheet-resources/src/components/WorkProfileEditor.svelte`
- Modify: `plugins/yg-timesheet-resources/src/components/Performance.svelte` (imports line 24, 28; CAT_STRING block 47-54; emps map 57-65; header line 144; cell line 157)
- Modify: `plugins/yg-timesheet-resources/src/utils/performance-xlsx.ts` (lines 33-41 map; header line 46; cell line 56)

**Interfaces:**
- Consumes: `WorkDesignation`, `WorkProfile`, `ygTimesheet.string.Designation`, `ygTimesheet.string.EmployeeId` (Task 1); `DESIGNATIONS` (Task 1); `PerfEmp.designation`, `PerfRow.designation` (Task 1).
- Produces: the visible team-profiles editor and the report Designation column.

- [ ] **Step 1: Update the model mixin props**

In `models/yg-timesheet/src/index.ts`, change the import (lines 45-46) from `type WorkProfile, type WorkProfileCategory` to `type WorkProfile, type WorkDesignation`. Then replace the `TWorkProfile` body (lines 138-142):

```ts
@Mixin(ygTimesheet.mixin.WorkProfile, contact.mixin.Employee)
export class TWorkProfile extends TEmployee implements WorkProfile {
  @Prop(TypeString(), ygTimesheet.string.Designation) designation?: WorkDesignation
  @Prop(TypeString(), ygTimesheet.string.EmployeeId) employeeId?: string
  @Prop(TypeNumber(), ygTimesheet.string.ShiftStart) shiftStart?: number
}
```

(`TypeString` and `TypeNumber` are already imported in this file.)

- [ ] **Step 2: Update lang files**

In `plugins/yg-timesheet-assets/lang/en.json`, replace lines 168-174 (the `WorkProfileCategoryLabel` + five `Cat*` entries, keeping `ShiftStart`) so the block reads:

```json
    "TeamProfiles": "Team profiles",
    "Designation": "Designation",
    "EmployeeId": "Employee ID",
    "ShiftStart": "Shift start",
```

Apply the identical replacement in `plugins/yg-timesheet-assets/lang/ru.json` (it currently mirrors the English strings; keep the same English values there as the file already does).

- [ ] **Step 3: Rewrite the team-profiles editor script**

In `plugins/yg-timesheet-resources/src/components/WorkProfileEditor.svelte`:

Replace the imports block (lines 22-31) with:

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import { type MixinData } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet, { type WorkProfile, type WorkDesignation } from '@hcengineering/yg-timesheet'
  import { ensureHrMembership } from '../utils/hrMembership'
  import { DESIGNATIONS, hhmmToMinutes, minutesToHHMM } from '../utils/work-profile'
```

Delete the `CAT_STRING` map, `catLabels`, `loadCatLabels`, and the `$: void loadCatLabels($themeStore.language)` line (lines 46-62).

Replace the `save` signature and change handlers (lines 64-89) with:

```ts
  async function save (emp: Employee, upd: Partial<Pick<WorkProfile, 'designation' | 'employeeId' | 'shiftStart'>>): Promise<void> {
    if (h.hasMixin(emp, ygTimesheet.mixin.WorkProfile)) {
      await client.updateMixin(emp._id, contact.mixin.Employee, emp.space, ygTimesheet.mixin.WorkProfile, upd)
    } else {
      // All WorkProfile fields are optional, so a partial payload is a valid fresh mixin.
      await client.createMixin(
        emp._id,
        contact.mixin.Employee,
        emp.space,
        ygTimesheet.mixin.WorkProfile,
        upd as MixinData<Employee, WorkProfile>
      )
    }
  }

  function onDesignationChange (emp: Employee, value: string): void {
    if (value === '') return
    void save(emp, { designation: value as WorkDesignation })
  }

  function onEmployeeIdChange (emp: Employee, value: string): void {
    void save(emp, { employeeId: value.trim() })
  }

  function onShiftStartChange (emp: Employee, value: string): void {
    void save(emp, { shiftStart: value === '' ? undefined : hhmmToMinutes(value) })
  }
```

- [ ] **Step 4: Rewrite the team-profiles editor table**

Replace the header note (line 95) `PMs are detected automatically and do not need a category.` with `PMs are detected automatically and do not need a designation.`

Replace the `<thead>` row (lines 100-104) with:

```svelte
        <tr>
          <th class="left"><Label label={contact.string.Employee} /></th>
          <th class="left"><Label label={ygTimesheet.string.EmployeeId} /></th>
          <th class="left"><Label label={ygTimesheet.string.Designation} /></th>
          <th class="left"><Label label={ygTimesheet.string.ShiftStart} /></th>
        </tr>
```

Replace the body row (lines 109-131) with:

```svelte
          <tr>
            <td class="left bold">{formatName(emp.name)}</td>
            <td class="left">
              <input
                class="yg-input"
                type="text"
                placeholder="YGS0024"
                value={mixin?.employeeId ?? ''}
                on:change={(e) => onEmployeeIdChange(emp, e.currentTarget.value)}
              />
            </td>
            <td class="left">
              <select
                class="yg-input"
                value={mixin?.designation ?? ''}
                on:change={(e) => onDesignationChange(emp, e.currentTarget.value)}
              >
                <option value="">-</option>
                {#each DESIGNATIONS as d (d)}
                  <option value={d}>{d}</option>
                {/each}
              </select>
            </td>
            <td class="left">
              <input
                class="yg-input"
                type="time"
                value={mixin?.shiftStart != null ? minutesToHHMM(mixin.shiftStart) : ''}
                on:change={(e) => onShiftStartChange(emp, e.currentTarget.value)}
              />
            </td>
          </tr>
```

Also update the empty-row `colspan` (line 133) from `colspan={3}` to `colspan={4}`.

- [ ] **Step 5: Update `Performance.svelte`**

In `plugins/yg-timesheet-resources/src/components/Performance.svelte`:
- Line 24: drop the now-unused `type IntlString` from the platform import so it reads `import { setPlatformStatus, unknownError } from '@hcengineering/platform'`.
- Line 28: in the `@hcengineering/yg-timesheet` import, replace `type WorkProfileCategory` with `type WorkDesignation`.
- Delete the `CAT_STRING` block (lines 47-54).
- In the `emps` map (lines 57-65), replace the `category:` property so the object reads:

```ts
  $: emps = empDocs.map((e): PerfEmp => ({
    id: e._id,
    name: formatName(e.name),
    designation: h.hasMixin(e, ygTimesheet.mixin.WorkProfile)
      ? (h.as(e, ygTimesheet.mixin.WorkProfile) as WorkProfile).designation
      : undefined
  }))
```

- Header (line 144): replace `<th class="left"><Label label={ygTimesheet.string.WorkProfileCategoryLabel} /></th>` with `<th class="left"><Label label={ygTimesheet.string.Designation} /></th>`.
- Cell (line 157): replace `<td class="left"><Label label={CAT_STRING[r.category]} /></td>` with `<td class="left">{r.designation ?? '-'}</td>`.

- [ ] **Step 6: Update `performance-xlsx.ts`**

In `plugins/yg-timesheet-resources/src/utils/performance-xlsx.ts`:
- Delete the `CATEGORY_LABEL` map and its comment (lines 33-41).
- Header (line 46): change `{ value: 'Category', type: String, fontWeight: 'bold' },` to `{ value: 'Designation', type: String, fontWeight: 'bold' },`.
- Cell (line 56): change `{ value: CATEGORY_LABEL[r.category] ?? r.category, type: String },` to `{ value: r.designation ?? '', type: String },`.

- [ ] **Step 7: Validate the packages**

Run: `cd plugins/yg-timesheet-resources && rushx _phase:validate`
Expected: PASS (no type/svelte-check errors).
Run: `cd models/yg-timesheet && rushx _phase:validate`
Expected: PASS.
Run: `cd plugins/yg-timesheet-resources && rushx test`
Expected: PASS (unchanged from Task 1).

- [ ] **Step 8: Commit**

```bash
git add models/yg-timesheet/src/index.ts plugins/yg-timesheet-assets/lang/en.json plugins/yg-timesheet-assets/lang/ru.json plugins/yg-timesheet-resources/src/components/WorkProfileEditor.svelte plugins/yg-timesheet-resources/src/components/Performance.svelte plugins/yg-timesheet-resources/src/utils/performance-xlsx.ts
git commit -m "feat(yg-timesheet): team-profiles Designation + Employee ID columns, report + xlsx (#8)"
```

---

## Task 3: Migrate existing category to designation

**Files:**
- Modify: `models/yg-timesheet/src/migration.ts` (imports; new helper; new `upgrade` state)

**Interfaces:**
- Consumes: `WorkDesignation` and `ygTimesheet.mixin.WorkProfile` (Task 1); `contact.mixin.Employee`.
- Produces: `workprofile-designation-0001` upgrade state that backfills `designation`.

- [ ] **Step 1: Add the imports**

In `models/yg-timesheet/src/migration.ts`, add a value import for `contact` (the file currently imports only `import type { Employee } from '@hcengineering/contact'`). Change it to:

```ts
import contact, { type Employee } from '@hcengineering/contact'
```

and add `type WorkDesignation` to the yg-timesheet import so it reads:

```ts
import ygTimesheet, { ygTimesheetId, type TimesheetDay, type WorkDesignation } from '@hcengineering/yg-timesheet'
```

- [ ] **Step 2: Add the migration helper**

Add this function near the other `upgrade`-phase helpers (e.g. just above `export const ygTimesheetOperation`):

```ts
// Map the retired WorkProfile.category to the new designation so the Performance report keeps its
// tracked roster after the Category -> Designation change. HR fine-tunes exact titles afterward.
// junior-dev/senior-dev/salesforce map to tracked titles; sales maps to an untracked title; 'other'
// (and any unknown) is left unset. Idempotent: skips any profile that already has a designation.
const CATEGORY_TO_DESIGNATION: Record<string, WorkDesignation> = {
  'junior-dev': 'Associate Software Engineer',
  'senior-dev': 'Senior Software Engineer',
  salesforce: 'Salesforce Developer',
  sales: 'Business Development Executive'
}

async function migrateWorkProfileDesignation (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  const profiles = await ops.findAll(ygTimesheet.mixin.WorkProfile, {})
  for (const p of profiles) {
    if (p.designation !== undefined) continue // idempotent
    const oldCat = (p as unknown as { category?: string }).category
    if (oldCat === undefined) continue
    const designation = CATEGORY_TO_DESIGNATION[oldCat]
    if (designation === undefined) continue // 'other' / unknown -> leave unset
    await ops.updateMixin(p._id, contact.mixin.Employee, p.space, ygTimesheet.mixin.WorkProfile, { designation })
  }
}
```

- [ ] **Step 3: Register the upgrade state**

Inside `ygTimesheetOperation.upgrade`'s `tryUpgrade([...])` array, add a new entry (append after the last existing state):

```ts
      {
        // Backfill WorkProfile.designation from the retired category so the Performance report stays
        // populated after the Category -> Designation change. Idempotent (skips set designations).
        state: 'workprofile-designation-0001',
        func: migrateWorkProfileDesignation
      },
```

- [ ] **Step 4: Validate**

Run: `cd models/yg-timesheet && rushx _phase:validate`
Expected: PASS (migration compiles; `updateMixin` and `findAll(mixin, {})` type-check).

- [ ] **Step 5: Commit**

```bash
git add models/yg-timesheet/src/migration.ts
git commit -m "feat(yg-timesheet): migrate WorkProfile category to designation (#8)"
```

---

## Notes for the executor

- Do NOT deploy per task. Build/deploy happens once after the whole branch is reviewed (4-image `build-beta.sh` + `./run-tool-beta.sh upgrade-workspace yg`, since this is a model change with a migration). Prod cutover is batched with the rest of the pending `yg_beta` work.
- After all three tasks, the final whole-branch review should confirm: no remaining references to `WorkProfileCategory`, `CATEGORY_ORDER`, `TRACKED_CATEGORIES`, `CAT_STRING`, `CATEGORY_LABEL`, or the removed `Cat*`/`WorkProfileCategoryLabel` string ids anywhere in the tree (`grep -rn` clean).
