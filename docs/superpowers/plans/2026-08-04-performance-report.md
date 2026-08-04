# Performance Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-employee "Performance" report (off-day work, overtime, late-night) for dev/senior-dev staff over a date range, with Excel export, in the HR app.

**Architecture:** A new HR-app special renders `Performance.svelte`, which queries `HrTimeEntry` + `AttendanceSession` + employees' WorkProfile category in the range, maps to plain shapes, and feeds a pure, jest-tested `utils/performance.ts` that produces the ranked rows. Excel export via `write-excel-file`.

**Tech Stack:** Svelte 4, `@hcengineering/presentation` (`createQuery`/`getClient`), `write-excel-file`, jest.

## Global Constraints

- Branch `yg_beta` (at deployed-prod state). NEVER auto-merge to `yg_develop`.
- **Model change** (new HR special) → deploy = full 4-image build + `upgrade-workspace yg`. Gated (last task).
- Thresholds: standard day = **8h** (overtime = daily logged hours beyond 8h, working days only); late-night = a session running past **21:00 local**. Non-working day via `isWorkingDay` (`utils/week.ts`): Sundays + even Saturdays off; Mon-Fri + odd Saturdays work. Weekends-only (no public-holiday modelling yet).
- Included employees: only WorkProfile `category` ∈ {`junior-dev`,`senior-dev`} (`isTracked` from `utils/work-profile.ts`). Untagged (category undefined) and sales/salesforce/other excluded.
- All aggregation in `utils/performance.ts` (pure; may import the deterministic `isWorkingDay`/`localMidnight` helpers). Component only queries + renders + exports.
- Reuse: date filter + Excel-export idiom from `HrAttendance.svelte` + `utils/hr-attendance-xlsx.ts`; `yg-table`/`--yg-*` design system; WorkProfile read via `getHierarchy().as(...)`.
- No em-dashes in UI copy/commits.

---

### Task 1: Pure performance lib + tests

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/performance.ts`
- Test: `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts`

**Interfaces:**
- Consumes: `isTracked` (`./work-profile`), `isWorkingDay` (`./week`), `localMidnight` (`./attendance`), `WorkProfileCategory` (type from `@hcengineering/yg-timesheet`).
- Produces: types `PerfEmp { id; name; category?: WorkProfileCategory }`, `PerfHours { employee; hours; date }` (date = raw ms), `PerfAtt { employee; punchIn; punchOut? }`, `PerfRow { employee; name; category; offDayDays; offDayHours; overtimeHours; overtimeDays; lateNightDays; totalExtraHours }`; `performanceRows(emps, hours, atts, now): PerfRow[]`.

- [ ] **Step 1: Write the failing test**
```ts
import { performanceRows, type PerfEmp, type PerfHours, type PerfAtt } from '../utils/performance'
// Aug 2026: Aug 1 = Sat (1st, odd -> WORKING), Aug 2 = Sun (off), Aug 3 = Mon (working),
// Aug 8 = Sat (2nd, even -> OFF).
const D = (y: number, m: number, d: number, h = 10): number => new Date(y, m, d, h).getTime()
const NOW = D(2026, 7, 4, 12)
const emps: PerfEmp[] = [
  { id: 'e1', name: 'Alice A', category: 'junior-dev' },
  { id: 'e2', name: 'Bob B', category: 'senior-dev' },
  { id: 'sx', name: 'Sam Sales', category: 'sales' },   // excluded
  { id: 'ut', name: 'Un Tagged', category: undefined }  // excluded
]
describe('performanceRows', () => {
  it('includes only dev/senior-dev, excludes sales + untagged', () => {
    expect(performanceRows(emps, [], [], NOW).map((r) => r.employee)).toEqual(['e1', 'e2'])
  })
  it('off-day work = hours on non-working days (Sun/even-Sat)', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 5, date: D(2026, 7, 2) },  // Sun -> off-day
      { employee: 'e1', hours: 3, date: D(2026, 7, 8) },  // 2nd Sat -> off-day
      { employee: 'e1', hours: 6, date: D(2026, 7, 3) }   // Mon -> working, <=8, no OT
    ]
    const r = performanceRows(emps, hours, [], NOW).find((x) => x.employee === 'e1')!
    expect(r.offDayDays).toBe(2)
    expect(r.offDayHours).toBe(8)
    expect(r.overtimeHours).toBe(0)
    expect(r.totalExtraHours).toBe(8)
  })
  it('overtime = working-day hours beyond 8 (off-day hours NOT counted as OT)', () => {
    const hours: PerfHours[] = [
      { employee: 'e2', hours: 11, date: D(2026, 7, 3) },  // Mon -> 3h OT
      { employee: 'e2', hours: 9, date: D(2026, 7, 1) },   // odd Sat (working) -> 1h OT
      { employee: 'e2', hours: 12, date: D(2026, 7, 2) }   // Sun -> off-day (12h), NOT OT
    ]
    const r = performanceRows(emps, hours, [], NOW).find((x) => x.employee === 'e2')!
    expect(r.overtimeHours).toBe(4)   // 3 + 1
    expect(r.overtimeDays).toBe(2)
    expect(r.offDayDays).toBe(1)
    expect(r.offDayHours).toBe(12)
    expect(r.totalExtraHours).toBe(16) // 12 off-day + 4 OT
  })
  it('late-night = distinct days with a session past 21:00 (incl. cross-midnight + open)', () => {
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 14), punchOut: D(2026, 7, 3, 22) },      // past 21:00
      { employee: 'e1', punchIn: D(2026, 7, 3, 9), punchOut: D(2026, 7, 3, 17) },        // same day, not late -> still 1 day
      { employee: 'e1', punchIn: D(2026, 7, 1, 20), punchOut: D(2026, 7, 2, 1) },        // 8pm -> 1am cross-midnight -> late on Aug 1
      { employee: 'e1', punchIn: D(2026, 7, 4, 19) }                                     // open, now=12:00 same day -> NOT past 21:00
    ]
    const r = performanceRows(emps, [], atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.lateNightDays).toBe(2) // Aug 3 + Aug 1
  })
  it('sorts by totalExtraHours desc then name', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 10, date: D(2026, 7, 3) }, // 2h OT
      { employee: 'e2', hours: 13, date: D(2026, 7, 3) }  // 5h OT
    ]
    expect(performanceRows(emps, hours, [], NOW).map((r) => r.employee)).toEqual(['e2', 'e1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `cd plugins/yg-timesheet-resources && node_modules/.bin/jest performance --silent` → FAIL (module not found).

- [ ] **Step 3: Implement**
```ts
import { type WorkProfileCategory } from '@hcengineering/yg-timesheet'
import { isTracked } from './work-profile'
import { isWorkingDay } from './week'
import { localMidnight } from './attendance'

export interface PerfEmp { id: string; name: string; category?: WorkProfileCategory }
export interface PerfHours { employee: string; hours: number; date: number }
export interface PerfAtt { employee: string; punchIn: number; punchOut?: number }
export interface PerfRow {
  employee: string; name: string; category: WorkProfileCategory
  offDayDays: number; offDayHours: number
  overtimeHours: number; overtimeDays: number
  lateNightDays: number; totalExtraHours: number
}

const STD_HOURS = 8
const LATE_NIGHT_HOUR = 21
const HOUR_MS = 3_600_000

export function performanceRows (emps: PerfEmp[], hours: PerfHours[], atts: PerfAtt[], now: number): PerfRow[] {
  const included = emps.filter((e) => isTracked(e.category))
  const ids = new Set(included.map((e) => e.id))

  const dayHours = new Map<string, Map<number, number>>()
  for (const h of hours) {
    if (!ids.has(h.employee)) continue
    const day = localMidnight(h.date)
    let m = dayHours.get(h.employee)
    if (m === undefined) { m = new Map(); dayHours.set(h.employee, m) }
    m.set(day, round2((m.get(day) ?? 0) + h.hours))
  }

  const lateDays = new Map<string, Set<number>>()
  for (const a of atts) {
    if (!ids.has(a.employee)) continue
    const day = localMidnight(a.punchIn)
    const end = a.punchOut ?? now
    if (end > day + LATE_NIGHT_HOUR * HOUR_MS) {
      let s = lateDays.get(a.employee)
      if (s === undefined) { s = new Set(); lateDays.set(a.employee, s) }
      s.add(day)
    }
  }

  const rows = included.map((e): PerfRow => {
    const days = dayHours.get(e.id) ?? new Map<number, number>()
    let offDayDays = 0; let offDayHours = 0; let overtimeHours = 0; let overtimeDays = 0
    for (const [day, hrs] of days) {
      if (!isWorkingDay(day)) {
        if (hrs > 0) { offDayDays++; offDayHours = round2(offDayHours + hrs) }
      } else if (hrs > STD_HOURS) {
        overtimeHours = round2(overtimeHours + (hrs - STD_HOURS)); overtimeDays++
      }
    }
    return {
      employee: e.id, name: e.name, category: e.category as WorkProfileCategory,
      offDayDays, offDayHours, overtimeHours, overtimeDays,
      lateNightDays: lateDays.get(e.id)?.size ?? 0,
      totalExtraHours: round2(offDayHours + overtimeHours)
    }
  })
  return rows.sort((a, b) => b.totalExtraHours - a.totalExtraHours || a.name.localeCompare(b.name))
}

function round2 (n: number): number { return Math.round(n * 100) / 100 }
```

- [ ] **Step 4: Run tests → PASS** — `cd plugins/yg-timesheet-resources && node_modules/.bin/jest performance --silent`.
- [ ] **Step 5: Commit** — `git add` lib + test; `git commit -m "feat(performance): pure performance-rows lib + tests"`.

---

### Task 2: i18n strings

**Files:** Modify `plugins/yg-timesheet/src/index.ts` (string ids), `plugins/yg-timesheet-assets/lang/en.json`, `.../ru.json`.

**Interfaces:** Produces `ygTimesheet.string.{Performance, OffDayWork, OvertimeCol, LateNightCol, TotalExtraHours, Days, Hours}` — reuse any that already exist (`Days`/`Hours` may exist; check and don't duplicate).

- [ ] **Step 1:** Add missing ids to the plugin `string:` map (each `'' as IntlString`): `Performance`, `OffDayWork`, `OvertimeCol`, `LateNightCol`, `TotalExtraHours`. Reuse existing `Days`, `Hours`, `Employee`, `Category` (`WorkProfileCategoryLabel`) if present; only add what's missing (grep first).
- [ ] **Step 2:** en.json: `"Performance": "Performance"`, `"OffDayWork": "Off-day work"`, `"OvertimeCol": "Overtime"`, `"LateNightCol": "Late night"`, `"TotalExtraHours": "Total extra hours"` (+ any missing reused ones). ru.json: same keys, same values.
- [ ] **Step 3:** Typecheck: `cd plugins/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build` clean; JSON parses.
- [ ] **Step 4:** Commit — `git commit -m "feat(performance): i18n strings"`.

---

### Task 3: Performance.svelte report page

**Files:** Create `plugins/yg-timesheet-resources/src/components/Performance.svelte`.

**Interfaces:**
- Consumes: `performanceRows` + types (Task 1); `ygTimesheet.string.*` (Task 2); `ygTimesheet.mixin.WorkProfile` + `type WorkProfile`; `isWorkingDay`/`localDayKey`/`weekRange` from `../utils/week`, `formatHours`.
- Produces: default-export component registered in Task 5.

Read `HrAttendance.svelte` (date-range `fromKey`/`toKey`/`fromMid`/`toExcl` state + native `att-date` inputs + `att-preset` buttons + Export button) and `HrDashboard.svelte` / `HrHoursByPersonCard.svelte` (`HrTimeEntry`/`AttendanceSession` queries, `contact.mixin.Employee` query, `yg-table` shell, `--yg-*` tokens, `.dash{flex:1;min-width:0}` fill) before writing.

- [ ] **Step 1: Build the page**
- `ensureHrMembership()` on mount.
- Date range: default `fromKey = localDayKey(now - ~365d)`, `toKey = localDayKey(now)`; `fromMid`/`toExcl` = ms bounds (inclusive-to, exclusive query bound), same idiom as HrAttendance. Native `type="date"` inputs.
- Queries (all scoped to `[fromMid, toExcl)`):
  - Employees: `createQuery(contact.mixin.Employee, { active: true })`; per employee read category = `h.hasMixin(e, ygTimesheet.mixin.WorkProfile) ? (h.as(e, ygTimesheet.mixin.WorkProfile) as WorkProfile).category : undefined`; map to `PerfEmp { id: e._id, name: formatName(e.name), category }`.
  - Hours: `createQuery(ygTimesheet.class.HrTimeEntry, { date: { $gte: fromMid, $lt: toExcl } })` -> `PerfHours { employee, hours, date }`.
  - Attendance: `createQuery(ygTimesheet.class.AttendanceSession, { date: { $gte: fromMid, $lt: toExcl } })` -> `PerfAtt { employee, punchIn, punchOut }` (note: filter on the day-bucket `date` field, matching how HrDashboard queries attendance).
- `$: now = Date.now()`; `$: rows = performanceRows(emps, hours, atts, now)`.
- Layout: `.dash yg-page` + `.yg-head` (title `Performance` + the date inputs + an Export button `.yg-btn--primary`) + `.yg-scroll` with a `yg-table`: Employee | Category | Off-day (days / hrs) | Overtime (hrs / days) | Late night (days) | Total extra hrs. Use `formatHours` for hour cells; category shown via the `Cat*` string for that row's category. Empty state row when no included employees.
- Export button calls `exportPerformanceXlsx(rows, fromMid, toExcl)` (Task 4) inside a `doExport` guard (`exporting` flag), same as HrAttendance.

- [ ] **Step 2: Typecheck** — `cd plugins/yg-timesheet-resources && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "Performance.svelte"` -> no output (ignore pre-existing unrelated errors; rebuild `plugins/yg-timesheet` d.ts if a known Task-2 id errors).
- [ ] **Step 3: Commit** — `git commit -m "feat(performance): Performance report page (queries + date range + table)"`.

---

### Task 4: Excel export

**Files:** Create `plugins/yg-timesheet-resources/src/utils/performance-xlsx.ts`. Modify `Performance.svelte` to import + call it.

**Interfaces:** Produces `exportPerformanceXlsx(rows: PerfRow[], from: number, to: number): Promise<void>`.

- [ ] **Step 1:** Model on `utils/hr-attendance-xlsx.ts` (`import writeXlsxFile, { type SheetData } from 'write-excel-file'`; a header row + one row per `PerfRow`: Employee, Category, Off-day days, Off-day hours, Overtime hours, Overtime days, Late-night days, Total extra hours; numbers as typed number cells, hours to 2dp). `fileName: \`performance-${ymd(from)}_${ymd(lastDay)}.xlsx\`` where `lastDay = to - 1` (exclusive->inclusive), `stickyRowsCount: 1`. Read hr-attendance-xlsx for the exact `ymd`/`SheetData` idiom.
- [ ] **Step 2:** Wire `Performance.svelte`'s Export button to `exportPerformanceXlsx(rows, fromMid, toExcl)`.
- [ ] **Step 3:** Typecheck: `svelte-check` grep `Performance` -> clean.
- [ ] **Step 4:** Commit — `git commit -m "feat(performance): Excel export"`.

---

### Task 5: Register component + HR "Performance" special

**Files:** Modify `plugins/yg-timesheet-resources/src/index.ts` (register `Performance`), `models/yg-timesheet/src/index.ts` (add the special).

**Interfaces:** Consumes `Performance` component (Task 3), `ygTimesheet.component.Performance` + `ygTimesheet.string.Performance` — add these ids in Task 2/here (add `component.Performance: '' as AnyComponent` to the plugin `component:` map if not already added).

- [ ] **Step 1:** Add `component.Performance: '' as AnyComponent` to `plugins/yg-timesheet/src/index.ts` (if missing). Register `Performance` in the resources `component` map (`plugins/yg-timesheet-resources/src/index.ts`), matching the file's eager-import idiom (as Task 4 of the Work Profile plan did).
- [ ] **Step 2:** In `models/yg-timesheet/src/index.ts`, in the HR app `navigatorModel.specials`, add after `attendance` (top group):
```ts
{
  id: 'performance',
  label: ygTimesheet.string.Performance,
  icon: ygTimesheet.icon.Timesheet,
  component: ygTimesheet.component.Performance,
  accessLevel: AccountRole.DocGuest,
  position: 'top'
}
```
- [ ] **Step 3:** Typecheck: `svelte-check` grep `index.ts` clean; `cd models/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build` clean.
- [ ] **Step 4:** Commit — `git commit -m "feat(performance): register Performance special in HR app"`.

---

### Task 6: Build, deploy (local), verify — GATE for explicit user go-ahead

**Files:** none. Model change → full 4-image build + `upgrade-workspace`. **Do not start without the user's go-ahead.**

- [ ] **Step 1:** Full 4-image build from `yg_beta`.
- [ ] **Step 2:** Deploy locally (recreate front/workspace/transactor, `./run-tool-beta.sh upgrade-workspace yg`, restart nginx; front 200).
- [ ] **Step 3: Verify.** Log in as HR/owner → HR app shows **Performance**; only dev/senior-dev (tagged) employees appear; off-day/overtime numbers reconcile against a known person's logged hours; date range + Excel export work; sales/untagged excluded. (Prod cutover is a later, separate step — best batched with Work Profile.)

---

## Self-Review

- **Spec coverage:** inclusion via `isTracked` (T1) · off-day/overtime(>8h, working-day)/late-night(21:00) signals + total + sort (T1) · i18n (T2) · report page + date range + queries (T3) · Excel export (T4) · HR special (DocGuest) + registration (T5) · model-change deploy (T6). Weekends-only holidays + no tardiness = correctly out of scope. Matches the spec.
- **Placeholder scan:** none — lib + tests are full code; page/export tasks name exact queries, columns, reference files, and thresholds.
- **Type consistency:** `PerfEmp/PerfHours/PerfAtt/PerfRow` (T1) used unchanged in T3/T4; `performanceRows(emps,hours,atts,now)` signature consistent; `exportPerformanceXlsx(rows,from,to)` (T4) matches its T3 caller; `ygTimesheet.component.Performance`/`string.Performance` declared (T2/T5) and used (T5). `HrTimeEntry.date` bucketed to day inside the lib (matches the HR-dashboard day-count fix).
