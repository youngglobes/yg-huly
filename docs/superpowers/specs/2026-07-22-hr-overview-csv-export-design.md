# HR Overview CSV Export — Design Spec

**Date:** 2026-07-22
**Branch:** `yg_beta` (LOCAL only — never push, never merge to `yg_develop`)
**Status:** approved in brainstorming, pending implementation plan

## Goal

Let HR export the **Overview** grid (all employees × days) as a CSV, for either a **chosen week**
or a **chosen month**. The exported file is *wide* — one column per day — matching how the grid
reads on screen.

## Non-goals

- No change to the on-screen Overview grid, which stays **weekly**. Monthly is an export-only
  concern: 34 employees × 31 columns is not reviewable at a glance, and building a wide on-screen
  grid would make the UI worse for the case HR actually uses daily.
- No arbitrary From/To date range. Two discrete periods only (week, month). This deliberately
  avoids partial-week edges, week-start alignment, and 90+ column quarters.
- No per-employee *detail* bulk export (every employee's issue rows stacked). Deferred until asked
  for — it is the one variant that gets heavy over a long range.
- No public-holiday or leave awareness (see Shortfall semantics).
- No XLSX/PDF. CSV only, consistent with the existing PM report export.

## Background — what exists today

| Piece | Location | Notes |
|---|---|---|
| Overview grid builder | `plugins/yg-timesheet-resources/src/utils/hr-report.ts:80` `buildOverviewGrid()` | Returns `OverviewRow[]`; **hard-codes a 7-slot day array** |
| Overview UI | `plugins/yg-timesheet-resources/src/components/HrOverview.svelte` | Queries `HrTimeEntry` in `HrData` by `date: { $gte: week.start, $lt: week.end }` |
| PM report CSV | `plugins/yg-timesheet-resources/src/utils/reports.ts:61` `toCSV()` | Flat/long shape; has the formula-injection guard |
| Injection guard | `reports.ts` `escText()` / `RISKY_PREFIX = /^[=+\-@\t\r]/` | Apostrophe-prefixes risky cells before quoting |
| Download plumbing | `components/Reports.svelte:207` | `Blob` with `﻿` BOM, `text/csv;charset=utf-8`, anchor `download` |

`OverviewRow` is `{ employee, name, days[], weekTotal, complete, shortfall }`.

## UX flow

On the **Overview** tab, next to the existing week navigator, add an **Export** button.

Clicking it opens a small dialog:

1. **Period:** `Weekly` (default) or `Monthly`.
2. **Selector**, which swaps with the period:
   - Weekly → a date input **pre-filled with the week currently on screen**; any date picked
     snaps to its containing Mon–Sun week, and the resolved range is shown as a label
     (e.g. "Mon, Jul 20 – Sun, Jul 26") so the user sees what they will get.
   - Monthly → month + year selectors, defaulting to the month containing the current week.
3. **Export** confirms; **Cancel** dismisses.

The common case (export the week I'm looking at) is therefore two clicks.

## Output format

Wide, one column per day in the period:

```
Employee, <day 1>, <day 2>, … <day N>, Total
```

- Day headers are `Dow DD` — e.g. `Mon 20`. The month is deliberately omitted: it is already in the
  filename (`yg-overview-monthly-2026-07.csv`), and repeating it across 31 headers is noise.
  (Revised 2026-07-22 from the original `YYYY-MM-DD`, at the user's request.)
- Hours are `h:mm` — e.g. `1:30` — so the file reads the same way as the on-screen grid.
  **Deliberately NOT `hh.mm`:** `1.30` is read by a spreadsheet as the number 1.3, so a column of
  such values sums to a silently wrong total — unacceptable in a file emailed on for
  reconciliation. `h:mm` stays readable AND sums correctly when the column is formatted `[h]:mm`.
  Emitted unquoted so spreadsheets parse it as a time value. Day cells and totals are computed from
  the raw hours and formatted only at emit time, so rounding never accumulates.
- One row per **active** employee, including employees with zero hours — consistent with the
  on-screen grid, whose whole purpose is surfacing under-logging.
- A trailing **Totals** row: per-day org totals and a grand total, matching `dailyTotals` /
  `grandTotal` already computed in `HrOverview.svelte`.
- **Known limitation: hours from deactivated employees are silently omitted, including from the
  Totals row.** The employee row set comes from `contact.mixin.Employee` filtered to
  `{ active: true }`, and `buildOverviewGrid` skips entries whose employee is not in that set. So
  hours logged by someone who has since been deactivated are dropped from the file AND from the
  org `Total` row, with nothing indicating the omission. Over a month-long window this is routine
  rather than theoretical (a leaver mid-month), and the file is emailed onward for reconciliation.
  A future increment could emit unmatched hours as a trailing "(inactive)" row.
- Employee names pass through the **same** `escText()` guard as the PM report. Numeric cells are
  emitted unquoted.

### Filename

- Weekly: `yg-overview-weekly-<YYYY-MM-DD of Mon>.csv`
- Monthly: `yg-overview-monthly-<YYYY-MM>.csv`

The period is encoded deliberately: these files get emailed, and a weekly and a monthly report
both named `overview.csv` is how the wrong one reaches a client.

### Shortfall — REMOVED from the export (2026-07-22)

The `Shortfall (vs 8h × weekdays)` column was **dropped at the user's request** after the first
build. The section below is retained as the record of why it was built and why it was risky; the
on-screen grid still shows its "under Xh" status, which is unaffected.

Removing it also retires the two limitations logged against it — hire-date unawareness and
holiday/leave unawareness — as export concerns. The **deactivated-employee** limitation recorded
under "Output format" still applies, since it affects the day columns and the Totals row.

**Superseding direction (not yet designed):** the user's actual need is the opposite measure —
*overtime*, not shortfall: who worked weekends, public holidays, past 8h/day, or at night, for
appraisal discussions. Feasibility from today's data: weekend work and >8h days are computable now
from `HrTimeEntry` (date + hours). Holiday work needs the HR calendar wired in, which it is not.
Night/midnight work is **not** computable at all — `HrTimeEntry` records the date the time is
logged against, never the clock time it was worked, so it would need a punch-in/punch-out module.
Likely a separate "employee performance" module rather than an extension of this export.

### Shortfall semantics (historical — column no longer exported)

`Shortfall = Σ over each **weekday** in the period of `max(0, 8h − hours logged that day)`.

This is the **existing** weekly semantics (`hr-report.ts`, verified against
`utils/__tests__/hr-report.test.ts`: 6h Mon + 5h Tue → `29` = `(8-6)+(8-5)+8+8+8`), generalised
from "the 5 weekdays of the week" to "every weekday in the period". It is deliberately **not**
`max(0, 8h × weekdays − total)`: the two agree only while nobody logs more than 8h in a day, and
they diverge exactly where it matters — 16h on Monday and nothing else is a 32h shortfall
(four un-logged days), not 24h. Overtime on one day must not silently cancel an absent day.

**It is holiday- and leave-unaware.** Huly's stock HR module holidays are not wired into
`HrTimeEntry`, so a month containing public holidays will show a shortfall that is not real
under-logging. This is why the column is labelled `Shortfall (vs 8h × weekdays)` rather than
`Shortfall` — the header states the basis so the number cannot be misread as absence.
Accepted by the user (2026-07-22), to be revisited if it misleads in practice.

**It is also hire-date-unaware.** Shortfall is computed against every weekday in the period,
with no knowledge of an employee's start date — `contact.mixin.Employee` carries no start date,
so there is no cheap code fix. An employee who joins on the 20th of a month will show a large
shortfall (~13 weekdays × 8h) for days before they were employed. This was a rare edge case for
a weekly report but hits every new hire on every monthly export. Recorded here so HR is told
before the first monthly export is circulated.

## Architecture

Three units, each independently testable.

### 1. Period → day list (pure)

New in `utils/period.ts`:

```ts
export type PeriodKind = 'week' | 'month'
export interface Period { kind: PeriodKind, start: number, end: number, days: DayKey[] }
export function weekPeriod (dateMs: number): Period
export function monthPeriod (year: number, month0: number): Period
export function weekdayCount (p: Period): number
```

`days` is built with `localDayKey` so it is DST-safe, matching the existing `buildWeekGrid` /
`buildOverviewGrid` convention. `end` is exclusive, matching the existing query.

### 2. Generalise the grid builder

`buildOverviewGrid()` moves from a fixed 7-slot array to **N slots driven by the day list**:

```ts
export function buildOverviewGrid (
  entries: HrTimeEntry[],
  employees: Array<{ ref: Ref<Person>, name: string }>,
  period: { start: number, days: DayKey[] },
  target = 8
): OverviewRow[]
```

`OverviewRow.days` becomes length N; `weekTotal` is renamed `total` (it is no longer necessarily a
week). The weekly on-screen view keeps working by passing a 7-day period — this is **additive**,
not a rewrite. `shortfall` is computed from `weekdayCount(period)`, not a hard-coded 5.

### 3. CSV serialiser (pure)

New in `utils/hr-csv.ts`:

```ts
export function overviewToCSV (rows: OverviewRow[], period: Period): string
```

Reuses the injection guard. `escText`/`RISKY_PREFIX` are **extracted from `reports.ts` into
`utils/csv.ts`** and imported by both, so there is one guard, not two copies that can drift.
This is the one piece of refactoring in scope, and it is justified: duplicating a security control
is how one copy quietly stops matching the other.

### Data flow

```
HrOverview.svelte
  ├─ Export clicked → dialog → Period
  ├─ query HrTimeEntry where date ∈ [period.start, period.end)   ← same query, wider bounds
  ├─ buildOverviewGrid(entries, employees, period, 8) → OverviewRow[]
  ├─ overviewToCSV(rows, period) → string
  └─ Blob + BOM + anchor download   (same as Reports.svelte:207)
```

For a **monthly** export the component issues a **separate one-shot query** over the month bounds
rather than reusing the live weekly subscription — the on-screen grid must keep showing the week.

## Error handling

- **No employees / no entries** → still emit a valid CSV: header row plus employee rows with zeros.
  An empty file looks like a failure; a zeroed file is a true answer. (The PM report's `toCSV`
  already returns a bare header for zero rows; same principle.)
- **Query failure** → surface the platform error, do not download a partial file.
- **Month with no data** → same as above, zeros.

## Testing (TDD — tests first)

Pure libs, so this is all jest, no UI harness. New/extended:
`src/__tests__/period.test.ts`, `src/utils/__tests__/hr-report.test.ts` (extend),
`src/__tests__/hr-csv.test.ts`.

- `weekPeriod` — returns 7 days, Monday start, correct exclusive `end`.
- `monthPeriod` — 28/29/30/31-day months; **February in a leap year**; December→January rollover.
- `weekdayCount` — a normal week = 5; a full month = correct weekday count.
- **DST** — a period spanning a DST boundary still yields the right day count and no duplicate or
  missing `DayKey` (the existing `localDayKey` regression is the precedent for caring about this).
- `buildOverviewGrid` with N=31 — hours land in the right day slot; employees with no entries
  yield an all-zero row; entries outside the period are ignored.
- `overviewToCSV` — column count = N + 3; totals row correct; **formula-injection**: an employee
  named `=cmd()` is emitted apostrophe-prefixed; a name containing a comma and a name containing a
  double-quote are both correctly quoted/escaped.
- Existing weekly `buildOverviewGrid` tests must still assert the **same weekly behaviour** after
  being mechanically updated for the `weekTotal` → `total` rename. The assertions do not change;
  only the field name does. That is what proves the generalisation is additive rather than a
  behaviour change.

`buildWeekGrid()` (the per-employee Timesheets grid) is **not** touched by this work — the export
lives on the Overview tab only, so its 7-day assumption is left alone.

## Files

**Create**
- `plugins/yg-timesheet-resources/src/utils/period.ts`
- `plugins/yg-timesheet-resources/src/utils/csv.ts` (extracted shared guard)
- `plugins/yg-timesheet-resources/src/utils/hr-csv.ts`
- `plugins/yg-timesheet-resources/src/components/HrExportDialog.svelte`
- tests as listed above

**Modify**
- `utils/hr-report.ts` — N-day `buildOverviewGrid`, `weekTotal` → `total`
- `utils/reports.ts` — import the guard from `utils/csv.ts` instead of defining it
- `components/HrOverview.svelte` — Export button, dialog, month query, download
- `plugins/yg-timesheet-assets/lang/en.json` + `ru.json` — new strings
- `plugins/yg-timesheet/src/index.ts` — string ids, dialog component id
- `plugins/yg-timesheet-resources/src/index.ts` — register the dialog component

## Risks

- **`weekTotal` → `total` rename** touches `HrOverview.svelte` and existing tests. Contained, but it
  is the change most likely to produce a compile error in an unexpected place; `svelte-check` must
  be run, not just `rushx test` (the `.svelte` files are invisible to jest).
- **Front-only change.** No model, migration, or server-trigger changes, so this needs only the
  `front` image rebuilt for local verification — not the 4-image full rebuild the HR feature needed.
- **Wide files in Excel** — 31 day columns is fine; noted only because the same design at quarter
  scale would not be.
