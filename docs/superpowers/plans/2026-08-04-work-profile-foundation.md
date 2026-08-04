# Work Profile Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-employee Work Profile (category + shift start) with an HR/owner editor — the foundation the Performance report and every late-punch feature depend on.

**Architecture:** A `WorkProfile` mixin on `contact.mixin.Employee` (`category` + `shiftStart`), a pure lib for category/time helpers, an editor page listing active employees with a category dropdown + start-time input (writes the mixin via `createMixin`/`updateMixin`), surfaced as a new Owner-only "Team profiles" special in the HR app.

**Tech Stack:** Huly model (`@Mixin`/`@Prop`), Svelte 4, `@hcengineering/presentation` (`getClient`), jest.

## Global Constraints

- Branch: `yg_beta` (yg-huly), already at the deployed prod state. NEVER auto-merge to `yg_develop`.
- **Model change** (mixin + new special) → deploy is the full 4-image build + `upgrade-workspace yg`, per the established cutover path. Gated (Task 5).
- Categories: `'junior-dev' | 'senior-dev' | 'sales' | 'salesforce' | 'other'`. `shiftStart` = minutes since local midnight (e.g. 540 = 09:00), optional (undefined until set).
- Editor is **Owner-only** (accessLevel `AccountRole.Owner`), consistent with the HR Roster special.
- No em-dashes in UI copy/commits (user preference).
- Reuse patterns: mixin like `ygTimesheet.mixin.ProjectApprovers` (plugin interface + `@Mixin` TMixin); editor writes like `ProjectApprovers.svelte` (`getClient().createMixin/updateMixin`); Employee query + design tokens like `HrRoster.svelte` / the dashboard cards (`--yg-*`, `yg-table`).
- This foundation stores/edits data only; it does NOT itself compute the report (that's the next phase).

---

### Task 1: Define the WorkProfile mixin (plugin ids + interface + strings + model)

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts` (interface, `mixin.WorkProfile`, `component.WorkProfileEditor`, `app`/`space` unchanged, strings)
- Modify: `models/yg-timesheet/src/index.ts` (`TWorkProfile` `@Mixin`, add to `createModel`)
- Modify: `plugins/yg-timesheet-assets/lang/en.json`, `.../ru.json`

**Interfaces:**
- Produces: `WorkProfileCategory` type; `WorkProfile` interface (`{ category: WorkProfileCategory; shiftStart?: number }` extending `Employee`); `ygTimesheet.mixin.WorkProfile`; `ygTimesheet.component.WorkProfileEditor`; strings `TeamProfiles`, `WorkProfileCategoryLabel`, `ShiftStart`, `CatJuniorDev`, `CatSeniorDev`, `CatSales`, `CatSalesforce`, `CatOther`.

- [ ] **Step 1: Plugin interface + ids.** In `plugins/yg-timesheet/src/index.ts`:
```ts
// near the other exported types
export type WorkProfileCategory = 'junior-dev' | 'senior-dev' | 'sales' | 'salesforce' | 'other'
export interface WorkProfile extends Employee {
  category: WorkProfileCategory
  // Local time-of-day the employee is expected to start, in minutes since midnight (540 = 09:00).
  shiftStart?: number
}
```
Add to the `mixin: { ... }` map: `WorkProfile: '' as Ref<Mixin<WorkProfile>>` (import `Mixin` from `@hcengineering/core` if not already; `Employee` from `@hcengineering/contact` is already imported). Add to the `component: { ... }` map: `WorkProfileEditor: '' as AnyComponent`. Add to `string: { ... }`: `TeamProfiles`, `WorkProfileCategoryLabel`, `ShiftStart`, `CatJuniorDev`, `CatSeniorDev`, `CatSales`, `CatSalesforce`, `CatOther` (each `'' as IntlString`).

- [ ] **Step 2: Model TMixin.** In `models/yg-timesheet/src/index.ts`, import `type WorkProfile` (add to the existing `@hcengineering/yg-timesheet` type import) and add the mixin class (mirror `TProjectApprovers`):
```ts
@Mixin(ygTimesheet.mixin.WorkProfile, contact.mixin.Employee)
export class TWorkProfile extends TEmployee implements WorkProfile {
  @Prop(TypeString(), ygTimesheet.string.WorkProfileCategoryLabel) category!: WorkProfileCategory
  @Prop(TypeNumber(), ygTimesheet.string.ShiftStart) shiftStart?: number
}
```
Import `TEmployee` from `@hcengineering/model-contact` and ensure `TypeString`/`TypeNumber` are imported from `@hcengineering/model` (check existing imports; `TProjectApprovers` file already imports what it needs). Add `TWorkProfile` to the `builder.createModel(...)` list.

- [ ] **Step 3: i18n.** Add to `en.json`: `"TeamProfiles": "Team profiles"`, `"WorkProfileCategoryLabel": "Category"`, `"ShiftStart": "Shift start"`, `"CatJuniorDev": "Junior developer"`, `"CatSeniorDev": "Senior developer"`, `"CatSales": "Sales"`, `"CatSalesforce": "Salesforce"`, `"CatOther": "Other"`. Add the same keys to `ru.json` with the same values (repo ships untranslated ru fallbacks).

- [ ] **Step 4: Typecheck.** Run: `cd models/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build` and `cd plugins/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build`. Expected: both build clean. (If a downstream `.d.ts` is stale, rebuild `plugins/yg-timesheet` `_phase:build`.)

- [ ] **Step 5: Commit.** `git add` the 4 files; `git commit -m "feat(work-profile): WorkProfile mixin (category + shiftStart) + i18n"`.

---

### Task 2: Pure work-profile lib + tests

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/work-profile.ts`
- Test: `plugins/yg-timesheet-resources/src/__tests__/work-profile.test.ts`

**Interfaces:**
- Consumes: `WorkProfileCategory` (Task 1, import type from `@hcengineering/yg-timesheet`).
- Produces: `CATEGORY_ORDER: WorkProfileCategory[]`; `TRACKED_CATEGORIES: Set<WorkProfileCategory>` (`junior-dev`,`senior-dev`); `isTracked(cat): boolean`; `minutesToHHMM(min: number): string`; `hhmmToMinutes(hhmm: string): number | undefined`.

- [ ] **Step 1: Write the failing test**
```ts
import { CATEGORY_ORDER, isTracked, minutesToHHMM, hhmmToMinutes } from '../utils/work-profile'
describe('isTracked', () => {
  it('only dev + senior-dev are tracked for the performance report', () => {
    expect(isTracked('junior-dev')).toBe(true)
    expect(isTracked('senior-dev')).toBe(true)
    expect(isTracked('sales')).toBe(false)
    expect(isTracked('salesforce')).toBe(false)
    expect(isTracked('other')).toBe(false)
  })
})
describe('shift-time conversion', () => {
  it('minutesToHHMM zero-pads', () => {
    expect(minutesToHHMM(540)).toBe('09:00')
    expect(minutesToHHMM(0)).toBe('00:00')
    expect(minutesToHHMM(23 * 60 + 5)).toBe('23:05')
  })
  it('hhmmToMinutes parses valid, rejects junk', () => {
    expect(hhmmToMinutes('09:00')).toBe(540)
    expect(hhmmToMinutes('23:05')).toBe(23 * 60 + 5)
    expect(hhmmToMinutes('')).toBeUndefined()
    expect(hhmmToMinutes('9')).toBeUndefined()
    expect(hhmmToMinutes('99:99')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd plugins/yg-timesheet-resources && node_modules/.bin/jest work-profile --silent`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**
```ts
import { type WorkProfileCategory } from '@hcengineering/yg-timesheet'
export const CATEGORY_ORDER: WorkProfileCategory[] = ['junior-dev', 'senior-dev', 'sales', 'salesforce', 'other']
export const TRACKED_CATEGORIES = new Set<WorkProfileCategory>(['junior-dev', 'senior-dev'])
export function isTracked (cat: WorkProfileCategory | undefined): boolean {
  return cat !== undefined && TRACKED_CATEGORIES.has(cat)
}
export function minutesToHHMM (min: number): string {
  const h = Math.floor(min / 60); const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
export function hhmmToMinutes (hhmm: string): number | undefined {
  const mt = /^([0-9]{2}):([0-9]{2})$/.exec(hhmm)
  if (mt == null) return undefined
  const h = Number(mt[1]); const m = Number(mt[2])
  if (h > 23 || m > 59) return undefined
  return h * 60 + m
}
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `cd plugins/yg-timesheet-resources && node_modules/.bin/jest work-profile --silent` → PASS.

- [ ] **Step 5: Commit.** `git add` lib + test; `git commit -m "feat(work-profile): category + shift-time helpers + tests"`.

---

### Task 3: WorkProfileEditor.svelte (employee table editor)

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/WorkProfileEditor.svelte`

**Interfaces:**
- Consumes: `ygTimesheet.mixin.WorkProfile` + `WorkProfileCategory`/`WorkProfile` types (Task 1); `CATEGORY_ORDER`, `minutesToHHMM`, `hhmmToMinutes` (Task 2); `ensureHrMembership` (owner bootstrap, same as other HR pages).
- Produces: default-export component registered as `WorkProfileEditor` in Task 4.

Read `plugins/yg-timesheet-resources/src/components/ProjectApprovers.svelte` (mixin create/update via `getClient()`) and `HrRoster.svelte` + the dashboard cards (query employees; `--yg-*` tokens; `yg-table` shell) before writing.

- [ ] **Step 1: Build the editor**
- On mount call `ensureHrMembership()` (owner self-add, no-op otherwise), matching the other HR specials.
- Query active employees: `createQuery(contact.mixin.Employee, { active: true })` (import `contact`, `type Employee`, `formatName`). Sort by `formatName(name)`.
- Root `<div class="dash yg-page">` + `.yg-scroll` (reuse the `.dash { flex:1; min-width:0 }` fill rule) with a `yg-table`: columns **Employee** | **Category** | **Shift start**.
- Per row:
  - Category: a `<select>` (or `DropdownLabels`) over `CATEGORY_ORDER`, labelled via `ygTimesheet.string.Cat*`; value = current mixin `category` (or blank). On change -> `save(emp, { category })`.
  - Shift start: `<input type="time">` bound to `minutesToHHMM(mixin.shiftStart)`; on change -> `save(emp, { shiftStart: hhmmToMinutes(value) })` (undefined clears it).
- `save(emp, upd)`: mirror `ProjectApprovers.svelte` -> if `h.hasMixin(emp, ygTimesheet.mixin.WorkProfile)` `client.updateMixin(emp._id, contact.mixin.Employee, emp.space, ygTimesheet.mixin.WorkProfile, upd)` else `client.createMixin(...)`.
- Read the current mixin per employee via `h.hasMixin(emp, ...) ? h.as(emp, ygTimesheet.mixin.WorkProfile) : undefined`.
- Header note (plain text ok): "PMs are detected automatically and do not need a category."
- Style with `--yg-*` tokens; no ad-hoc colors. No em-dashes.

- [ ] **Step 2: Typecheck (svelte-check)**
Run: `cd plugins/yg-timesheet-resources && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "WorkProfileEditor"` -> expect NO output (ignore unrelated pre-existing `$lookup` errors). If a missing-string-id error appears for Task-1 ids, rebuild `plugins/yg-timesheet` `_phase:build` then re-check.

- [ ] **Step 3: Commit.** `git add` the file; `git commit -m "feat(work-profile): Team-profiles editor (category + shift start per employee)"`.

---

### Task 4: Register component + HR "Team profiles" special

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/index.ts` (register `WorkProfileEditor`)
- Modify: `models/yg-timesheet/src/index.ts` (add the special to the HR app `navigatorModel.specials`)

**Interfaces:**
- Consumes: `WorkProfileEditor` component (Task 3); `ygTimesheet.component.WorkProfileEditor`, `ygTimesheet.string.TeamProfiles` (Task 1).

- [ ] **Step 1: Register the component.** In `plugins/yg-timesheet-resources/src/index.ts`, add `WorkProfileEditor: () => import('./components/WorkProfileEditor.svelte')` to the resources map (match how `HrRoster`/`ProjectApproversEditor` are registered).

- [ ] **Step 2: Add the HR special.** In `models/yg-timesheet/src/index.ts`, in the Human Resource app's `navigatorModel.specials` (where `roster` is), add a special AFTER `roster` (bottom group):
```ts
{
  id: 'team-profiles',
  label: ygTimesheet.string.TeamProfiles,
  icon: contact.icon.Person,
  component: ygTimesheet.component.WorkProfileEditor,
  accessLevel: AccountRole.Owner,
  position: 'bottom'
}
```

- [ ] **Step 3: Typecheck.** `cd plugins/yg-timesheet-resources && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "index.ts"` (no new errors) and `cd models/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build` (clean).

- [ ] **Step 4: Commit.** `git add` both files; `git commit -m "feat(work-profile): register Team-profiles special (Owner-only) in HR app"`.

---

### Task 5: Build, deploy, verify — GATE for explicit user go-ahead

**Files:** none (build/deploy). Model change → full 4-image build + `upgrade-workspace`. **Do not start without the user's go-ahead.**

- [ ] **Step 1:** Full 4-image build (`yg-local/*:beta`) from `yg_beta`, per the established flow.
- [ ] **Step 2:** Deploy locally: recreate front/workspace/transactor on `:beta`, `./run-tool-beta.sh upgrade-workspace yg`, restart nginx; front 200.
- [ ] **Step 3: Verify.** Log in as an Owner → HR app shows a **Team profiles** special (below Roster); it lists active employees; setting a **Category** and **Shift start** persists (reload shows the saved values). A non-owner does NOT see the special. (Prod cutover is a separate, later step via the runbook — not part of this task.)

---

## Self-Review

- **Spec coverage:** WorkProfile mixin `category` + `shiftStart` (T1) · pure helpers incl. `isTracked` for the later report + time conversion (T2) · HR/owner editor writing the mixin (T3) · Owner-only "Team profiles" special + component registration (T4) · model-change deploy (T5). PM auto-exclusion is a *report-phase* concern (uses ProjectApprovers), not needed in this foundation — correctly out of scope. Matches the roadmap's Foundation section.
- **Placeholder scan:** none — mixin/lib/tests are full code; the editor task names the exact write calls, columns, and reference components. No "TBD".
- **Type consistency:** `WorkProfile { category, shiftStart? }` and `WorkProfileCategory` (T1) used unchanged in T2/T3; `ygTimesheet.mixin.WorkProfile` / `component.WorkProfileEditor` / `string.TeamProfiles` (T1) used in T3/T4; `createMixin`/`updateMixin` signature mirrors `ProjectApprovers.svelte`.
- **Open item:** `shiftStart` stored as minutes-since-midnight (matches `hhmmToMinutes`); the editor's `<input type="time">` round-trips via the T2 helpers.
