# HR Overview CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let HR export the Overview grid (all employees × days) to a wide CSV — one column per day — for either a chosen week or a chosen month.

**Architecture:** Three pure, independently-testable libs (`period.ts` builds a day list from a week/month choice; `csv.ts` holds the shared formula-injection guard extracted from `reports.ts`; `hr-csv.ts` serialises rows to CSV), plus a generalisation of `buildOverviewGrid()` from a hard-coded 7-slot day array to an N-slot one driven by that day list. The Svelte layer adds an Export button and a small dialog, and reuses the existing Blob-download pattern from `Reports.svelte`.

**Tech Stack:** Huly platform (Rush monorepo, pnpm, Svelte, TypeScript), `@hcengineering/{core,contact,presentation,ui,yg-timesheet}`, ts-jest. Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`).

## Global Constraints

- **Branch:** all commits on `yg_beta`, **LOCAL only** — never push, never merge to `yg_develop`.
- **Spec:** `docs/superpowers/specs/2026-07-22-hr-overview-csv-export-design.md`.
- **Build commands:** from a package dir, `node ../../common/scripts/install-run-rushx.js <script>`; repo-wide `node common/scripts/install-run-rush.js build --to <pkg>`. Tests `rushx test`. Svelte types `rushx svelte-check`.
- **`svelte-check` is mandatory**, not optional: jest does not see `.svelte` files, and this work renames a field those files read.
- **Front-only change.** No model, migration, or server-trigger edits — only the `front` image needs rebuilding for local verification, not the 4-image HR rebuild.
- **Shortfall semantics:** Σ over each weekday in the period of `max(0, 8 − hours that day)`. NOT `max(0, 8 × weekdays − total)`. Preserve exactly.
- **Hours are decimals** in CSV output; day headers are `YYYY-MM-DD`; `end` bounds are exclusive.
- **Column label** is exactly `Shortfall (vs 8h × weekdays)`.
- **All existing tests must keep passing:** `yg-timesheet-resources` is currently 57/57 green.

---

## File Structure

**Create**
- `plugins/yg-timesheet-resources/src/utils/period.ts` — week/month → `Period` (day list, bounds, weekday count). No platform deps.
- `plugins/yg-timesheet-resources/src/utils/csv.ts` — shared CSV cell escaping + formula-injection guard. No platform deps.
- `plugins/yg-timesheet-resources/src/utils/hr-csv.ts` — `overviewToCSV(rows, period)`. Depends on `period.ts`, `csv.ts`, `hr-report.ts` types.
- `plugins/yg-timesheet-resources/src/components/HrExportDialog.svelte` — period chooser dialog.
- Tests: `src/utils/__tests__/period.test.ts`, `src/utils/__tests__/hr-csv.test.ts`.

**Modify**
- `plugins/yg-timesheet-resources/src/utils/hr-report.ts` — N-day `buildOverviewGrid`, `weekTotal` → `total`.
- `plugins/yg-timesheet-resources/src/utils/reports.ts` — import guard from `csv.ts` instead of defining it.
- `plugins/yg-timesheet-resources/src/utils/__tests__/hr-report.test.ts` — mechanical rename + N-day cases.
- `plugins/yg-timesheet-resources/src/components/HrOverview.svelte` — Export button, dialog wiring, month query, download.
- `plugins/yg-timesheet-resources/src/index.ts` — register `HrExportDialog`.
- `plugins/yg-timesheet/src/index.ts` — component + string ids.
- `plugins/yg-timesheet-assets/lang/en.json`, `ru.json` — new strings.

---

### Task 1: Shared CSV guard — extract from `reports.ts`

Pure refactor, no behaviour change. Doing this first means Task 4 has one guard to import rather than a second copy to write.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/csv.ts`
- Modify: `plugins/yg-timesheet-resources/src/utils/reports.ts` (remove local `esc`/`escText`/`RISKY_PREFIX`, import instead)
- Test: `plugins/yg-timesheet-resources/src/__tests__/reports.test.ts` (existing — must still pass untouched)

**Interfaces:**
- Produces: `esc(v: string): string`, `escText(v: string): string`, `RISKY_PREFIX: RegExp` from `utils/csv.ts`.

- [ ] **Step 1: Create the shared module**

Create `plugins/yg-timesheet-resources/src/utils/csv.ts`:

```ts
//
// Shared CSV cell encoding for every yg-timesheet export. Pure — no platform deps.
//
// Kept in ONE place on purpose: this is a security control (spreadsheet formula injection),
// and two copies are how one quietly stops matching the other.
//

/** Wrap in double quotes, doubling any embedded double quote (RFC 4180). */
export function esc (v: string): string {
  return `"${v.replace(/"/g, '""')}"`
}

// Cells whose first char could be interpreted as a spreadsheet formula (=, +, -, @) or a
// tab/CR (used in some formula-injection payloads) get apostrophe-prefixed before quoting,
// so opening the CSV in Excel/Sheets doesn't execute attacker-controlled text as a formula.
export const RISKY_PREFIX = /^[=+\-@\t\r]/

/** Escape a free-text cell: neutralise formula prefixes, then quote. */
export function escText (v: string): string {
  return esc(RISKY_PREFIX.test(v) ? `'${v}` : v)
}
```

- [ ] **Step 2: Point `reports.ts` at it**

In `plugins/yg-timesheet-resources/src/utils/reports.ts`, delete these four lines:

```ts
function esc (v: string): string { return `"${v.replace(/"/g, '""')}"` }
const RISKY_PREFIX = /^[=+\-@\t\r]/
function escText (v: string): string {
  return esc(RISKY_PREFIX.test(v) ? `'${v}` : v)
}
```

(Keep the explanatory comment block above them — move it into `csv.ts` as already shown, and leave `reports.ts` clean.) Add to the imports at the top of `reports.ts`:

```ts
import { esc, escText } from './csv'
```

- [ ] **Step 3: Run the existing tests — they must pass unchanged**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test
```

Expected: `Tests: 57 passed, 57 total`. If any reports test fails, the extraction changed behaviour — revert and redo. Do NOT edit the tests to match.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/csv.ts plugins/yg-timesheet-resources/src/utils/reports.ts
git commit -m "yg-timesheet: extract shared CSV escaping/injection guard into utils/csv.ts"
```

---

### Task 2: `period.ts` — week/month → day list (TDD)

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/period.ts`
- Test: `plugins/yg-timesheet-resources/src/utils/__tests__/period.test.ts`

**Interfaces:**
- Consumes: `localDayKey(ms: number): DayKey`, `type DayKey` from `./week`.
- Produces:
  - `type PeriodKind = 'week' | 'month'`
  - `interface Period { kind: PeriodKind, start: number, end: number, days: DayKey[], label: string }`
  - `weekPeriod (dateMs: number): Period`
  - `monthPeriod (year: number, month0: number): Period` — `month0` is 0-indexed (0 = January), matching `Date`.
  - `weekdayCount (p: Period): number`
  - `isWeekendKey (k: DayKey): boolean`

`start` inclusive, `end` exclusive — matching the existing `weekRange` and the `HrTimeEntry` query.

- [ ] **Step 1: Write the failing tests**

Create `plugins/yg-timesheet-resources/src/utils/__tests__/period.test.ts`:

```ts
import { weekPeriod, monthPeriod, weekdayCount, isWeekendKey } from '../period'

// 2026-07-22 is a Wednesday; its week is Mon 2026-07-20 .. Sun 2026-07-26.
const wed = new Date(2026, 6, 22, 13, 0, 0).getTime()

test('weekPeriod: 7 days, Monday first, Sunday last', () => {
  const p = weekPeriod(wed)
  expect(p.kind).toBe('week')
  expect(p.days).toHaveLength(7)
  expect(p.days[0]).toBe('2026-07-20')
  expect(p.days[6]).toBe('2026-07-26')
})

test('weekPeriod: end is exclusive (the following Monday)', () => {
  const p = weekPeriod(wed)
  expect(new Date(p.start).getDate()).toBe(20)
  expect(new Date(p.end).getDate()).toBe(27)
})

test('weekPeriod: a Sunday belongs to the week that started the previous Monday', () => {
  const sun = new Date(2026, 6, 26, 9, 0, 0).getTime()
  expect(weekPeriod(sun).days[0]).toBe('2026-07-20')
})

test('monthPeriod: 31-day month', () => {
  const p = monthPeriod(2026, 6) // July
  expect(p.kind).toBe('month')
  expect(p.days).toHaveLength(31)
  expect(p.days[0]).toBe('2026-07-01')
  expect(p.days[30]).toBe('2026-07-31')
})

test('monthPeriod: 30-day month', () => {
  expect(monthPeriod(2026, 8).days).toHaveLength(30) // September
})

test('monthPeriod: February in a non-leap year', () => {
  const p = monthPeriod(2026, 1)
  expect(p.days).toHaveLength(28)
  expect(p.days[27]).toBe('2026-02-28')
})

test('monthPeriod: February in a leap year', () => {
  const p = monthPeriod(2024, 1)
  expect(p.days).toHaveLength(29)
  expect(p.days[28]).toBe('2024-02-29')
})

test('monthPeriod: December rolls over into the next January', () => {
  const p = monthPeriod(2026, 11)
  expect(p.days).toHaveLength(31)
  expect(new Date(p.end).getFullYear()).toBe(2027)
  expect(new Date(p.end).getMonth()).toBe(0)
})

test('monthPeriod: no duplicate or missing day keys (DST-safe)', () => {
  // March 2026 contains a DST transition in many locales.
  const p = monthPeriod(2026, 2)
  expect(new Set(p.days).size).toBe(p.days.length)
  expect(p.days).toHaveLength(31)
})

test('isWeekendKey', () => {
  expect(isWeekendKey('2026-07-25')).toBe(true)  // Saturday
  expect(isWeekendKey('2026-07-26')).toBe(true)  // Sunday
  expect(isWeekendKey('2026-07-24')).toBe(false) // Friday
})

test('weekdayCount: a normal week is 5', () => {
  expect(weekdayCount(weekPeriod(wed))).toBe(5)
})

test('weekdayCount: July 2026 has 23 weekdays', () => {
  expect(weekdayCount(monthPeriod(2026, 6))).toBe(23)
})

test('labels', () => {
  expect(weekPeriod(wed).label).toBe('2026-07-20')
  expect(monthPeriod(2026, 6).label).toBe('2026-07')
})
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- period
```

Expected: FAIL — `Cannot find module '../period'`.

- [ ] **Step 3: Implement `period.ts`**

Create `plugins/yg-timesheet-resources/src/utils/period.ts`:

```ts
//
// Export periods for the HR reports: a week or a calendar month, reduced to a plain list of
// local day keys. Pure — no platform deps → unit-testable.
//
// Day lists are built by incrementing a local Date (never by adding 86400000ms), so a period
// spanning a DST transition still yields exactly one key per calendar day. Same convention as
// weekRange()/buildOverviewGrid() in this package.
//
import { localDayKey, type DayKey } from './week'

export type PeriodKind = 'week' | 'month'

export interface Period {
  kind: PeriodKind
  start: number // inclusive
  end: number // exclusive
  days: DayKey[]
  label: string // 'YYYY-MM-DD' (week, its Monday) | 'YYYY-MM' (month) — used in filenames
}

function daysBetween (startMs: number, count: number): DayKey[] {
  const out: DayKey[] = []
  const d = new Date(startMs)
  for (let i = 0; i < count; i++) {
    const dd = new Date(d)
    dd.setDate(d.getDate() + i)
    out.push(localDayKey(dd.getTime()))
  }
  return out
}

export function weekPeriod (dateMs: number): Period {
  const d = new Date(dateMs)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() // 0 Sun .. 6 Sat
  const backToMonday = dow === 0 ? 6 : dow - 1
  const monday = new Date(d)
  monday.setDate(d.getDate() - backToMonday)
  const end = new Date(monday)
  end.setDate(monday.getDate() + 7)
  return {
    kind: 'week',
    start: monday.getTime(),
    end: end.getTime(),
    days: daysBetween(monday.getTime(), 7),
    label: localDayKey(monday.getTime())
  }
}

export function monthPeriod (year: number, month0: number): Period {
  const first = new Date(year, month0, 1)
  first.setHours(0, 0, 0, 0)
  const end = new Date(year, month0 + 1, 1)
  end.setHours(0, 0, 0, 0)
  // Day count from the calendar, not from arithmetic on ms (DST-safe).
  const count = new Date(year, month0 + 1, 0).getDate()
  const mm = `${month0 + 1}`.padStart(2, '0')
  return {
    kind: 'month',
    start: first.getTime(),
    end: end.getTime(),
    days: daysBetween(first.getTime(), count),
    label: `${year}-${mm}`
  }
}

/** True for Saturday/Sunday. Parses the key directly so it stays timezone-independent. */
export function isWeekendKey (k: DayKey): boolean {
  const [y, m, d] = k.split('-').map((n) => parseInt(n, 10))
  const dow = new Date(y, m - 1, d).getDay()
  return dow === 0 || dow === 6
}

export function weekdayCount (p: Period): number {
  return p.days.filter((k) => !isWeekendKey(k)).length
}
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- period
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/period.ts plugins/yg-timesheet-resources/src/utils/__tests__/period.test.ts
git commit -m "yg-timesheet: pure week/month Period lib for HR exports (TDD)"
```

---

### Task 3: Generalise `buildOverviewGrid` to N days

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/hr-report.ts:71-113` (`OverviewRow`, `buildOverviewGrid`)
- Modify: `plugins/yg-timesheet-resources/src/utils/__tests__/hr-report.test.ts`
- Modify: `plugins/yg-timesheet-resources/src/components/HrOverview.svelte` (rename + call-site only)

**Interfaces:**
- Consumes: `Period`, `isWeekendKey` from `./period`; `localDayKey` from `./week`.
- Produces:
  - `interface OverviewRow { employee: Ref<Person>, name: string, days: number[], total: number, complete: boolean, shortfall: number }` — note `weekTotal` is now **`total`**, and `days` has one entry per day in the period.
  - `buildOverviewGrid (entries: HrTimeEntry[], employees: Array<{ ref: Ref<Person>, name: string }>, period: { days: DayKey[] }, target?: number): OverviewRow[]`

Shortfall stays the **per-weekday sum**; it is now driven by `isWeekendKey` over the actual day list instead of the hard-coded `i < 5`.

- [ ] **Step 1: Update the existing tests for the rename, and add N-day cases**

In `plugins/yg-timesheet-resources/src/utils/__tests__/hr-report.test.ts`, replace every `weekTotal` with `total`. **Do not change any expected value** — the assertions must stay identical, which is what proves this is a generalisation and not a behaviour change.

The existing `wk` fixture must now be a `Period`. Replace its definition with:

```ts
import { weekPeriod, monthPeriod } from '../period'
const wk = weekPeriod(new Date(2026, 6, 15).getTime()) // week of Mon 2026-07-13
```

Then append these new tests:

```ts
test('month period: 31 day slots, hours land on the right day', () => {
  const p = monthPeriod(2026, 6) // July 2026
  const rows = buildOverviewGrid([e('p', '2026-07-01', 3), e('p', '2026-07-31', 4)], [emp('p', 'Praja')], p)
  expect(rows[0].days).toHaveLength(31)
  expect(rows[0].days[0]).toBe(3)
  expect(rows[0].days[30]).toBe(4)
  expect(rows[0].total).toBe(7)
})

test('month period: shortfall is the per-weekday sum, not the aggregate', () => {
  const p = monthPeriod(2026, 6) // 23 weekdays
  // 16h on Wed 2026-07-01 only. Per-weekday: that day is fully covered (8h target, 16 logged
  // → 0), the other 22 weekdays are 8h short each → 176. An aggregate formula would wrongly
  // say 23*8 - 16 = 168.
  const rows = buildOverviewGrid([e('p', '2026-07-01', 16)], [emp('p', 'Praja')], p)
  expect(rows[0].shortfall).toBe(176)
})

test('entries outside the period are ignored', () => {
  const p = monthPeriod(2026, 6)
  const rows = buildOverviewGrid([e('p', '2026-08-03', 8)], [emp('p', 'Praja')], p)
  expect(rows[0].total).toBe(0)
})
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- hr-report
```

Expected: FAIL — `total` is undefined on the returned rows, and the month tests report 7 day slots.

- [ ] **Step 3: Rewrite `buildOverviewGrid`**

In `plugins/yg-timesheet-resources/src/utils/hr-report.ts`, replace the `OverviewRow` interface and the whole `buildOverviewGrid` function with:

```ts
export interface OverviewRow {
  employee: Ref<Person>
  name: string
  days: number[] // one slot per day in the period
  total: number
  complete: boolean
  shortfall: number
}

export function buildOverviewGrid (
  entries: HrTimeEntry[],
  employees: Array<{ ref: Ref<Person>, name: string }>,
  period: { days: DayKey[] },
  target = 8
): OverviewRow[] {
  const n = period.days.length
  const dayKeyIdx = new Map<DayKey, number>(period.days.map((k, i) => [k, i]))
  const weekday = period.days.map((k) => !isWeekendKey(k))
  const byEmp = new Map<string, number[]>()
  for (const emp of employees) byEmp.set(emp.ref as string, new Array(n).fill(0))

  for (const en of entries) {
    const days = byEmp.get(en.employee as string)
    if (days === undefined) continue // only employees in the row set
    const idx = dayKeyIdx.get(localDayKey(en.date))
    if (idx !== undefined) days[idx] += en.hours
  }

  return employees
    .map(({ ref, name }) => {
      const days = byEmp.get(ref as string) ?? new Array(n).fill(0)
      const total = days.reduce((a, b) => a + b, 0)
      // Per-weekday shortfall: overtime on one day must NOT cancel an absent day.
      let shortfall = 0
      for (let i = 0; i < n; i++) {
        if (weekday[i]) shortfall += Math.max(0, target - days[i])
      }
      return { employee: ref, name, days, total, complete: shortfall === 0, shortfall }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
```

Update the imports at the top of `hr-report.ts` to add:

```ts
import { isWeekendKey } from './period'
```

and ensure `DayKey` is imported from `./week` alongside `localDayKey`.

- [ ] **Step 4: Fix the `HrOverview.svelte` call site**

In `plugins/yg-timesheet-resources/src/components/HrOverview.svelte`:

Add to the script imports:

```ts
import { weekPeriod } from '../utils/period'
```

Replace the grid call:

```svelte
$: rows = buildOverviewGrid(entries, employees, week, DAY_TARGET)
```

with:

```svelte
$: viewPeriod = weekPeriod(week.start)
$: rows = buildOverviewGrid(entries, employees, viewPeriod, DAY_TARGET)
```

and replace the grand-total line, which reads the renamed field:

```svelte
$: grandTotal = rows.reduce((sum, r) => sum + r.weekTotal, 0)
```

with:

```svelte
$: grandTotal = rows.reduce((sum, r) => sum + r.total, 0)
```

Then search the rest of the file for any remaining `weekTotal` in the markup (the per-row total cell) and rename it to `total`:

```bash
grep -n "weekTotal" plugins/yg-timesheet-resources/src/components/HrOverview.svelte
```

Expected after edits: no matches.

- [ ] **Step 5: Run tests and svelte-check**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test
node ../../common/scripts/install-run-rushx.js svelte-check
```

Expected: all tests pass (57 existing + 3 new + 13 from Task 2). `svelte-check` must show **no new** errors — the known baseline is 3 pre-existing `$lookup` errors in `Timesheet.svelte`/`Approvals.svelte` plus 21 inherited `text-editor-resources` errors. Any error naming `HrOverview.svelte` or `total`/`weekTotal` is yours to fix.

- [ ] **Step 6: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/hr-report.ts \
        plugins/yg-timesheet-resources/src/utils/__tests__/hr-report.test.ts \
        plugins/yg-timesheet-resources/src/components/HrOverview.svelte
git commit -m "yg-timesheet: buildOverviewGrid takes an N-day period (weekTotal -> total)"
```

---

### Task 4: `hr-csv.ts` — the wide serialiser (TDD)

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/hr-csv.ts`
- Test: `plugins/yg-timesheet-resources/src/utils/__tests__/hr-csv.test.ts`

**Interfaces:**
- Consumes: `OverviewRow` from `./hr-report`; `Period` from `./period`; `esc`, `escText` from `./csv`.
- Produces:
  - `overviewToCSV (rows: OverviewRow[], period: Period): string`
  - `overviewFilename (period: Period): string`

- [ ] **Step 1: Write the failing tests**

Create `plugins/yg-timesheet-resources/src/utils/__tests__/hr-csv.test.ts`:

```ts
import { overviewToCSV, overviewFilename } from '../hr-csv'
import { weekPeriod, monthPeriod } from '../period'
import type { OverviewRow } from '../hr-report'

const wk = weekPeriod(new Date(2026, 6, 22).getTime()) // Mon 2026-07-20 .. Sun 2026-07-26

function row (name: string, days: number[], shortfall = 0): OverviewRow {
  const total = days.reduce((a, b) => a + b, 0)
  return { employee: name as any, name, days, total, complete: shortfall === 0, shortfall }
}

test('header: Employee, one column per day, Total, Shortfall', () => {
  const csv = overviewToCSV([], wk)
  const head = csv.split('\n')[0]
  expect(head).toBe(
    '"Employee","2026-07-20","2026-07-21","2026-07-22","2026-07-23","2026-07-24","2026-07-25","2026-07-26","Total","Shortfall (vs 8h × weekdays)"'
  )
})

test('a row emits hours as decimals and ends with total + shortfall', () => {
  const csv = overviewToCSV([row('Praja', [8, 8, 8, 8, 8, 0, 0], 0)], wk)
  const line = csv.split('\n')[1]
  expect(line).toBe('"Praja",8,8,8,8,8,0,0,40,0')
})

test('zero-hour employees are still emitted (that is the point of the report)', () => {
  const csv = overviewToCSV([row('Zoe', [0, 0, 0, 0, 0, 0, 0], 40)], wk)
  expect(csv.split('\n')[1]).toBe('"Zoe",0,0,0,0,0,0,0,0,40')
})

test('totals row sums each day and the grand total', () => {
  const csv = overviewToCSV([row('A', [8, 0, 0, 0, 0, 0, 0]), row('B', [2, 3, 0, 0, 0, 0, 0])], wk)
  const lines = csv.trim().split('\n')
  expect(lines[lines.length - 1]).toBe('"Total",10,3,0,0,0,0,0,13,')
})

test('empty row set still emits a valid header and totals row', () => {
  const lines = overviewToCSV([], wk).trim().split('\n')
  expect(lines).toHaveLength(2)
  expect(lines[1]).toBe('"Total",0,0,0,0,0,0,0,0,')
})

test('formula injection: a leading = is apostrophe-prefixed', () => {
  const csv = overviewToCSV([row('=cmd|calc', [0, 0, 0, 0, 0, 0, 0])], wk)
  expect(csv.split('\n')[1]).toContain('"\'=cmd|calc"')
})

test('formula injection: leading +, -, @ are all neutralised', () => {
  for (const bad of ['+1', '-1', '@x']) {
    const csv = overviewToCSV([row(bad, [0, 0, 0, 0, 0, 0, 0])], wk)
    expect(csv.split('\n')[1]).toContain(`"'${bad}"`)
  }
})

test('a name containing a comma stays one field', () => {
  const csv = overviewToCSV([row('Doe, Jane', [0, 0, 0, 0, 0, 0, 0])], wk)
  expect(csv.split('\n')[1]).toContain('"Doe, Jane"')
})

test('a name containing a double quote is doubled', () => {
  const csv = overviewToCSV([row('Jane "JJ" Doe', [0, 0, 0, 0, 0, 0, 0])], wk)
  expect(csv.split('\n')[1]).toContain('"Jane ""JJ"" Doe"')
})

test('month period produces 31 day columns', () => {
  const csv = overviewToCSV([], monthPeriod(2026, 6))
  expect(csv.split('\n')[0].split(',')).toHaveLength(31 + 3)
})

test('filenames encode the period', () => {
  expect(overviewFilename(wk)).toBe('yg-overview-weekly-2026-07-20.csv')
  expect(overviewFilename(monthPeriod(2026, 6))).toBe('yg-overview-monthly-2026-07.csv')
})
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- hr-csv
```

Expected: FAIL — `Cannot find module '../hr-csv'`.

- [ ] **Step 3: Implement `hr-csv.ts`**

Create `plugins/yg-timesheet-resources/src/utils/hr-csv.ts`:

```ts
//
// Wide CSV for the HR Overview: one row per employee, one column per day in the period.
// Pure — no platform deps → unit-testable.
//
// Wide (not long) on purpose: this mirrors the grid HR reviews on screen. The long/pivot-friendly
// shape is already served by the PM report export (utils/reports.ts).
//
import { esc, escText } from './csv'
import type { Period } from './period'
import type { OverviewRow } from './hr-report'

const SHORTFALL_HEADER = 'Shortfall (vs 8h × weekdays)'

export function overviewToCSV (rows: OverviewRow[], period: Period): string {
  const header = ['Employee', ...period.days, 'Total', SHORTFALL_HEADER].map(esc).join(',')

  const body = rows.map((r) =>
    [escText(r.name), ...r.days.map((h) => String(h)), String(r.total), String(r.shortfall)].join(',')
  )

  // Org-wide totals. The shortfall column is intentionally blank: summing individual shortfalls
  // across employees is not a meaningful org number, and a figure there invites misreading.
  const dayTotals = period.days.map((_, i) => rows.reduce((sum, r) => sum + (r.days[i] ?? 0), 0))
  const grand = rows.reduce((sum, r) => sum + r.total, 0)
  const totals = [esc('Total'), ...dayTotals.map((n) => String(n)), String(grand), ''].join(',')

  return `${header}\n${[...body, totals].join('\n')}\n`
}

export function overviewFilename (period: Period): string {
  const kind = period.kind === 'week' ? 'weekly' : 'monthly'
  return `yg-overview-${kind}-${period.label}.csv`
}
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- hr-csv
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/hr-csv.ts plugins/yg-timesheet-resources/src/utils/__tests__/hr-csv.test.ts
git commit -m "yg-timesheet: wide Overview CSV serialiser + period filenames (TDD)"
```

---

### Task 5: Strings + ids

Split from Task 6 because ids and lang strings live in three other packages; a reviewer can approve the vocabulary before any UI exists.

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts`
- Modify: `plugins/yg-timesheet-assets/lang/en.json`
- Modify: `plugins/yg-timesheet-assets/lang/ru.json`

**Interfaces:**
- Produces: `ygTimesheet.component.HrExportDialog`, and the string ids `Export`, `ExportPeriod`, `PeriodWeekly`, `PeriodMonthly`, `SelectWeek`, `SelectMonth`.

**Do NOT add a `Cancel` string** — `packages/ui/lang/en.json` already ships one; the dialog uses the
stock `ui.string.Cancel`. A second translation of a stock string is duplication that drifts.

- [ ] **Step 1: Add the component and string ids**

In `plugins/yg-timesheet/src/index.ts`, add to the `component:` block:

```ts
    HrExportDialog: '' as AnyComponent,
```

and to the `string:` block:

```ts
    Export: '' as IntlString,
    ExportPeriod: '' as IntlString,
    PeriodWeekly: '' as IntlString,
    PeriodMonthly: '' as IntlString,
    SelectWeek: '' as IntlString,
    SelectMonth: '' as IntlString,
```

- [ ] **Step 2: Add the English strings**

In `plugins/yg-timesheet-assets/lang/en.json`, inside the existing `"string"` object:

```json
    "Export": "Export",
    "ExportPeriod": "Export period",
    "PeriodWeekly": "Weekly",
    "PeriodMonthly": "Monthly",
    "SelectWeek": "Week",
    "SelectMonth": "Month"
```

- [ ] **Step 3: Add the Russian strings**

In `plugins/yg-timesheet-assets/lang/ru.json`, inside the existing `"string"` object:

```json
    "Export": "Экспорт",
    "ExportPeriod": "Период экспорта",
    "PeriodWeekly": "Неделя",
    "PeriodMonthly": "Месяц",
    "SelectWeek": "Неделя",
    "SelectMonth": "Месяц"
```

- [ ] **Step 4: Build the changed packages**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet --to @hcengineering/yg-timesheet-assets
```

Expected: both succeed. A missing key in one lang file is the usual failure here — en.json and ru.json must have the **same** key set.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts plugins/yg-timesheet-assets/lang/en.json plugins/yg-timesheet-assets/lang/ru.json
git commit -m "yg-timesheet: ids + i18n strings for the HR Overview export dialog"
```

---

### Task 6: `HrExportDialog.svelte` — the period chooser

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/HrExportDialog.svelte`
- Modify: `plugins/yg-timesheet-resources/src/index.ts`

**Interfaces:**
- Consumes: `weekPeriod`, `monthPeriod`, `type Period` from `../utils/period`; `ygTimesheet` string ids from Task 5.
- Produces: a dialog component that dispatches `close` with a `Period`, or with `undefined` on cancel.

- [ ] **Step 1: Write the dialog**

Create `plugins/yg-timesheet-resources/src/components/HrExportDialog.svelte`:

```svelte
<script lang="ts">
  //
  // Period chooser for the HR Overview export. Defaults to the week currently on screen, so the
  // common case (export what I'm looking at) is Export -> Export: two clicks.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Button, Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { weekPeriod, monthPeriod, type Period } from '../utils/period'

  /** The week currently displayed by HrOverview — used to seed both pickers. */
  export let anchorMs: number

  const dispatch = createEventDispatcher()

  let kind: 'week' | 'month' = 'week'

  // Week picker: a date input that snaps to its containing Mon-Sun week.
  let weekDate: string = weekPeriod(anchorMs).days[0]

  // Month picker, seeded from the anchor.
  const anchor = new Date(anchorMs)
  let year: number = anchor.getFullYear()
  let month0: number = anchor.getMonth()

  // Locale-aware month names — NOT a hardcoded English array. Same Intl approach HrOverview.svelte
  // already uses for its weekday/range headers, so the dialog follows the UI language.
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long' })
  const MONTHS = Array.from({ length: 12 }, (_, i) => monthFmt.format(new Date(2000, i, 1)))
  const YEARS = [anchor.getFullYear() - 1, anchor.getFullYear(), anchor.getFullYear() + 1]

  function parseDay (k: string): number {
    const [y, m, d] = k.split('-').map((n) => parseInt(n, 10))
    return new Date(y, m - 1, d).getTime()
  }

  $: selected = kind === 'week' ? weekPeriod(parseDay(weekDate)) : monthPeriod(year, month0)
  $: rangeLabel = `${selected.days[0]} → ${selected.days[selected.days.length - 1]}`

  function confirm (): void {
    dispatch('close', selected as Period)
  }
  function cancel (): void {
    dispatch('close', undefined)
  }
</script>

<div class="hr-export-dialog">
  <div class="title"><Label label={ygTimesheet.string.ExportPeriod} /></div>

  <div class="row">
    <Button
      kind={kind === 'week' ? 'primary' : 'regular'}
      label={ygTimesheet.string.PeriodWeekly}
      on:click={() => { kind = 'week' }}
    />
    <Button
      kind={kind === 'month' ? 'primary' : 'regular'}
      label={ygTimesheet.string.PeriodMonthly}
      on:click={() => { kind = 'month' }}
    />
  </div>

  {#if kind === 'week'}
    <div class="row">
      <span class="lbl"><Label label={ygTimesheet.string.SelectWeek} /></span>
      <input type="date" bind:value={weekDate} />
    </div>
  {:else}
    <div class="row">
      <span class="lbl"><Label label={ygTimesheet.string.SelectMonth} /></span>
      <select bind:value={month0}>
        {#each MONTHS as m, i}<option value={i}>{m}</option>{/each}
      </select>
      <select bind:value={year}>
        {#each YEARS as y}<option value={y}>{y}</option>{/each}
      </select>
    </div>
  {/if}

  <!-- Always show the resolved range: the week picker snaps, and the user must see what they get. -->
  <div class="range">{rangeLabel}</div>

  <div class="row actions">
    <Button label={ui.string.Cancel} on:click={cancel} />
    <Button kind="primary" label={ygTimesheet.string.Export} on:click={confirm} />
  </div>
</div>

<style lang="scss">
  .hr-export-dialog {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    min-width: 22rem;
    background: var(--theme-popup-color);
    border-radius: 0.75rem;
  }
  .title { font-weight: 500; }
  .row { display: flex; align-items: center; gap: 0.75rem; }
  .lbl { min-width: 4rem; color: var(--theme-dark-color); }
  .range { color: var(--theme-dark-color); font-size: 0.8125rem; }
  .actions { justify-content: flex-end; }
</style>
```

- [ ] **Step 2: Register the component**

In `plugins/yg-timesheet-resources/src/index.ts`, import the component and add it to the resource map alongside the existing `HrOverview`/`HrTimesheet` entries:

```ts
import HrExportDialog from './components/HrExportDialog.svelte'
```

and inside the `component:` object of the default export:

```ts
    HrExportDialog,
```

- [ ] **Step 3: Build + svelte-check**

```bash
cd plugins/yg-timesheet-resources
node ../../common/scripts/install-run-rushx.js build
node ../../common/scripts/install-run-rushx.js svelte-check
```

Expected: build succeeds; `svelte-check` shows no error naming `HrExportDialog.svelte`.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/HrExportDialog.svelte plugins/yg-timesheet-resources/src/index.ts
git commit -m "yg-timesheet: HR export period dialog (weekly/monthly)"
```

---

### Task 7: Wire Export into `HrOverview.svelte`

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/HrOverview.svelte`

**Interfaces:**
- Consumes: `overviewToCSV`, `overviewFilename` from `../utils/hr-csv`; `buildOverviewGrid` from `../utils/hr-report`; `type Period` from `../utils/period`; `HrExportDialog`.

The monthly export must **not** disturb the on-screen weekly grid, so it issues a one-shot query over the chosen period rather than re-pointing the live weekly subscription.

- [ ] **Step 1: Add the imports and the export handler**

In the `<script>` of `plugins/yg-timesheet-resources/src/components/HrOverview.svelte`, add:

```ts
  import { showPopup } from '@hcengineering/ui'
  import { getClient } from '@hcengineering/presentation'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import HrExportDialog from './HrExportDialog.svelte'
  import { overviewToCSV, overviewFilename } from '../utils/hr-csv'
  import type { Period } from '../utils/period'

  const client = getClient()

  let exporting = false

  function openExport (): void {
    showPopup(HrExportDialog, { anchorMs: week.start }, undefined, (period?: Period) => {
      if (period !== undefined) void runExport(period)
    })
  }

  async function runExport (period: Period): Promise<void> {
    exporting = true
    try {
      // One-shot fetch over the chosen period. Deliberately NOT the live weekly subscription —
      // the grid on screen must keep showing the week the user is looking at.
      const rows = await client.findAll(ygTimesheet.class.HrTimeEntry, {
        space: ygTimesheet.space.HrData,
        date: { $gte: period.start, $lt: period.end }
      })
      const grid = buildOverviewGrid(rows, employees, period, DAY_TARGET)
      const csv = overviewToCSV(grid, period)
      // Excel needs the BOM to read UTF-8 correctly (same as the PM report export).
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = overviewFilename(period)
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      // Surface the failure rather than letting the promise reject unhandled — and download
      // nothing, so the user never receives a half-built file they might forward on.
      await setPlatformStatus(unknownError(err))
    } finally {
      exporting = false
    }
  }
```

- [ ] **Step 2: Add the Export button next to the week navigator**

In the markup, in the header row that holds the prev/next/Today controls and `weekLabel`, add at the end:

```svelte
      <Button label={ygTimesheet.string.Export} disabled={exporting} on:click={openExport} />
```

Ensure `Button` is imported from `@hcengineering/ui` in this file (add it to the existing `@hcengineering/ui` import if absent).

- [ ] **Step 3: Build + svelte-check + full test run**

```bash
cd plugins/yg-timesheet-resources
node ../../common/scripts/install-run-rushx.js build
node ../../common/scripts/install-run-rushx.js svelte-check
node ../../common/scripts/install-run-rushx.js test
```

Expected: build succeeds; no `svelte-check` error naming `HrOverview.svelte`; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/HrOverview.svelte
git commit -m "yg-timesheet: Export button on HR Overview (weekly/monthly wide CSV)"
```

---

### Task 8: Local end-to-end verification

**Files:** none (integration). Appends a section to `.superpowers/sdd/hr-timesheet-integration.md`.

This is a **front-only** change, so only the `front` image is rebuilt — not the 4-image rebuild the HR feature itself needed.

- [ ] **Step 1: Rebuild and redeploy front**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
source ~/.nvm/nvm.sh && nvm use 22
# Stop the stack first: the webpack build needs ~4GB and this box has ~9GB total.
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -f compose.yml -f compose.override.beta.yml stop

cd /home/karthi_0008/dev/client-projects/yg-huly/dev/prod
NODE_OPTIONS=--max-old-space-size=4096 node ../../common/scripts/install-run-rushx.js package
cd ../../pods/front
node ../../common/scripts/install-run-rushx.js bundle
node ../../common/scripts/install-run-rushx.js package
docker build -t yg-local/front:beta .

cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -f compose.yml -f compose.override.beta.yml up -d
docker compose -f compose.yml -f compose.override.beta.yml rm -sf front
docker compose -f compose.yml -f compose.override.beta.yml up -d front
```

- [ ] **Step 2: Fixture**

Log in as the Owner (`praja@yg.local`) at `http://localhost:8087/`, workspace `testws`. Login is **OTP-only** (no SMTP locally) — read the code from the DB:

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
U=$(grep -E "^CR_DB_URL" huly_v7.conf | cut -d= -f2-)"?sslmode=disable"
docker compose -f compose.yml -f compose.override.beta.yml exec -T cockroach \
  ./cockroach sql --url "$U" -e "SELECT code FROM global_account.otp ORDER BY created_on DESC LIMIT 1;"
```

The code expires in 60s — request it in the UI first, then read it immediately.

Ensure at least two employees have logged time on at least two different days, with **one day over 8h** (this is what distinguishes the per-weekday shortfall from an aggregate one).

- [ ] **Step 3: Verify (the gates)**

- (a) **Weekly export:** Overview → Export → Weekly (pre-selected, showing the on-screen week) → Export. A file `yg-overview-weekly-<Monday>.csv` downloads. Opened in a spreadsheet: `Employee`, 7 dated columns, `Total`, `Shortfall (vs 8h × weekdays)`, and a `Total` row. Values match the grid on screen.
- (b) **Monthly export:** Export → Monthly → pick the current month → Export. `yg-overview-monthly-<YYYY-MM>.csv` downloads with one column per day of that month (28–31), and every active employee present.
- (c) **Screen unchanged:** after both exports the Overview grid still shows the **week**, on the same week it was on before.
- (d) **Shortfall correctness:** for the employee with >8h on one day, confirm the shortfall equals the sum of per-weekday gaps and is NOT reduced by that day's overtime.
- (e) **Zero-hour employees** appear with all-zero days and a full shortfall.
- (f) **Injection guard:** temporarily rename an employee to `=cmd|calc`, export, and confirm the cell opens as literal text in Excel/LibreOffice (not evaluated). Rename back.

- [ ] **Step 4: Record the results**

Append a `## HR Overview CSV export — <date>` section to `.superpowers/sdd/hr-timesheet-integration.md` stating which gates passed, with any findings. Report failures honestly rather than narrowing the gate.

- [ ] **Step 5: Commit**

```bash
git add .superpowers/sdd/hr-timesheet-integration.md
git commit -m "docs: HR Overview CSV export local e2e results"
```

---

## Verification Summary

| Layer | Command | Expected |
|---|---|---|
| Unit | `rushx test` in `yg-timesheet-resources` | 57 existing + 3 (Task 3) + 13 (Task 2) + 11 (Task 4) all pass |
| Types | `rushx svelte-check` | No new errors vs the 3 + 21 known baseline |
| Build | `rush build --to @hcengineering/yg-timesheet-resources` | Succeeds |
| E2E | Task 8 gates (a)–(f) | All pass |
