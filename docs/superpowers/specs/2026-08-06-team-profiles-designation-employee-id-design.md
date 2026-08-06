# Team Profiles: Designation + Employee ID (design)

**Date:** 2026-08-06
**Branch:** `yg_beta`
**Backlog:** YG Portal backlog item #8 (team-profiles columns)
**Status:** approved, ready for implementation plan

## Goal

Extend the HR **Team profiles** page (`workbench/yg/yg-hr/team-profiles`):

1. Replace the coarse **Category** field (5 buckets) with a fine-grained **Designation** field (24 fixed job titles).
2. Add an **Employee ID** free-text field (format like `YGS0024`).

Both live on the employee entity so they are available to reports.

## Context / current state

- `WorkProfile` is a **mixin on `contact.mixin.Employee`** (`models/yg-timesheet/src/index.ts`).
  Today it carries `category: WorkProfileCategory` and `shiftStart?: number`.
- `WorkProfileCategory = 'junior-dev' | 'senior-dev' | 'sales' | 'salesforce' | 'other'`
  (`plugins/yg-timesheet/src/index.ts`).
- **`category` is load-bearing, not just a label.** `work-profile.ts` exports
  `TRACKED_CATEGORIES = {junior-dev, senior-dev}` and `isTracked(cat)`. The **Performance report**
  (Pravin's hike-review report) and its xlsx export include **only tracked employees**. A blind
  rename would make `isTracked` match nothing and the report would go empty.
- `category` is consumed by exactly: `WorkProfileEditor.svelte` (the team-profiles editor),
  `utils/work-profile.ts`, `utils/performance.ts`, `utils/performance-xlsx.ts`,
  `components/Performance.svelte`, `__tests__/performance.test.ts`, the plugin/model TS, and the
  `en.json`/`ru.json` lang files. The `toCat(...)` in `Dashboard.svelte` / `EmployeeDashboard.svelte`
  is the **task status** category (`task.statusCategory`), NOT WorkProfile — out of scope.

## Design

### Data model (`WorkProfile` mixin)

Replace `category` with `designation`, add `employeeId`; `shiftStart` unchanged:

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
  employeeId?: string        // free text, e.g. "YGS0024"
  shiftStart?: number        // unchanged
}
```

**Why store the literal title (not a slug + IntlString):** these are stable, company-specific
titles unlikely to need translation. Storing the string directly is DRY (one `DESIGNATIONS` array
is the single source of truth), avoids 24×2 = 48 lang entries, and lets the report/xlsx print the
value directly. Both new fields are **optional** — an unset employee renders `-`, and the fresh-mixin
required-field dance in the current editor goes away.

Model `@Prop`s (`models/yg-timesheet/src/index.ts`), replacing the `category` prop:

```ts
@Prop(TypeString(), ygTimesheet.string.Designation) designation?: WorkDesignation
@Prop(TypeString(), ygTimesheet.string.EmployeeId) employeeId?: string
@Prop(TypeNumber(), ygTimesheet.string.ShiftStart) shiftStart?: number
```

### Shared constants (`utils/work-profile.ts`)

`CATEGORY_ORDER` / `TRACKED_CATEGORIES` / `isTracked(cat)` are replaced by:

```ts
export const DESIGNATIONS: WorkDesignation[] = [ /* all 24, in the order listed in Goal */ ]

// 11 tracked titles shown in the Performance report:
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

The remaining 13 (Project Manager, SEO Analyst Trainee/SEO Analyst/Senior SEO Analyst, Business
Development Executive/Senior BDE/BD Manager, Lead Generation Executive, CEO, CTO, COO, HR Executive,
Intern) are untracked. Project Manager is untracked here **and** PMs continue to be auto-detected and
excluded via `ProjectApprovers.pm` (orthogonal to designation), so the existing "PMs are detected
automatically" note stays.

`minutesToHHMM` / `hhmmToMinutes` are unchanged.

### Team-profiles editor (`WorkProfileEditor.svelte`)

Columns: **Employee · Employee ID · Designation · Shift start**.

- **Employee ID**: `<input class="yg-input" type="text" placeholder="YGS0024">`; on change, save
  `employeeId` = trimmed value (empty string → `undefined`).
- **Designation**: `<select class="yg-input">` with a blank `-` option plus one `<option>` per
  `DESIGNATIONS` entry, `value === label` (no `translate()` / `catLabels` machinery needed since the
  option text is the value itself). On change, save `designation`.
- The `CAT_STRING` map, `loadCatLabels`, and `$themeStore.language` re-resolution are removed.
- `save()` keeps `createMixin`/`updateMixin`, now with all-optional fields, so the "fresh mixin
  requires category" comment/branch is simplified (no required field remains).

### Performance report (`Performance.svelte`, `utils/performance.ts`, `utils/performance-xlsx.ts`)

- `PerfEmp.category` / `PerfRow.category` become `designation?: WorkDesignation`.
- `performanceRows` filters with `isTracked(e.designation)`; each row carries `designation` through.
- `Performance.svelte`: `emps` maps the mixin's `designation`; the report's second column header
  becomes **Designation** (`ygTimesheet.string.Designation`) and the cell prints
  `{r.designation ?? '-'}` as plain text (drop `CAT_STRING` + `<Label>`).
- `performance-xlsx.ts`: drop the `CATEGORY_LABEL` map; header label "Category" → "Designation";
  cell value = `r.designation ?? ''`.
- Employee ID is **not** added to the report or xlsx (visibility scoped to the team-profiles page).

### Strings (`plugins/yg-timesheet/src/index.ts` + lang files)

- Add string ids: `Designation`, `EmployeeId`.
- Remove string ids: `WorkProfileCategoryLabel`, `CatJuniorDev`, `CatSeniorDev`, `CatSales`,
  `CatSalesforce`, `CatOther` (no longer referenced).
- `en.json` / `ru.json`: add `"Designation"` / `"EmployeeId"`, remove the six category entries.

### Migration (`models/yg-timesheet/src/migration.ts`)

Add a step to `ygTimesheetOperation` that, for every `contact.mixin.Employee` doc carrying the
`WorkProfile` mixin with an old `category` and no `designation` yet, sets `designation` from:

| old `category` | new `designation`               | tracked? |
|----------------|----------------------------------|----------|
| `junior-dev`   | Associate Software Engineer      | yes      |
| `senior-dev`   | Senior Software Engineer         | yes      |
| `salesforce`   | Salesforce Developer             | yes      |
| `sales`        | Business Development Executive   | no       |
| `other`        | (leave unset)                    | n/a      |

This preserves Performance-report continuity on deploy (HR then fine-tunes exact titles). The step is
idempotent (skips docs that already have `designation`) and follows the existing migration helpers'
mixin-write pattern. `employeeId` has no migration (starts blank). The stale `category` value may be
left in place (ignored by the new interface) — no need to unset it.

## Testing

- `utils/work-profile` unit test: `isTracked` true for a tracked title, false for an untracked title
  and for `undefined`; `DESIGNATIONS` has 24 entries.
- `__tests__/performance.test.ts`: fixtures switch `category` → `designation`; keep the
  included/excluded assertions (one tracked, one untracked, one `undefined`).
- `performance-xlsx`: existing test (if any) updated for the Designation column.
- Type-check via `rushx _phase:validate` in `yg-timesheet` (svelte-check picks up the mixin change).

## Out of scope

- Employee ID on the person profile card / Contacts (chosen: team-profiles page only).
- Employee ID validation beyond trimming (free text; placeholder shows the `YGS0024` format).
- Department / additional profile columns (future backlog).
- The `toCat` status-category dashboards (unrelated).

## Deploy note

Model change (mixin field + migration) → prod cutover is the standard 4-image build +
`./run-tool-beta.sh upgrade-workspace yg`. Batched with the rest of the pending `yg_beta` prod
cutover; local build/verify first.
