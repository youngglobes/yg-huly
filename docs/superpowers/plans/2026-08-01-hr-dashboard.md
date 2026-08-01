# HR Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an HR branch to the Dashboard app's role router — an org-wide HR overview (KPIs + presence/hours/compliance widgets) for HR-roster members.

**Architecture:** `DashboardHome.svelte` gains a third branch (PM > HR > Employee). A new `HrDashboard.svelte` owns all queries, maps live docs to plain shapes, and feeds a pure, unit-tested aggregation lib (`utils/hr-dashboard.ts`) into presentational cards that reuse the existing dashboard design system (`KpiStrip`, `Donut`, `.dash-attention` grid, `yg-table` tokens).

**Tech Stack:** Svelte 4, `@hcengineering/presentation` (`createQuery`/`getClient`), TypeScript, jest.

## Global Constraints

- Branch: `yg_beta` (yg-huly). NEVER merge to `yg_develop`.
- **Front-only** change: no new Application/special/model doc, no `upgrade-workspace`. Deploy = rebuild `yg-local/front:beta` + `up -d front` + restart nginx.
- Routing priority: `isPM` (admin OR approver) → `Dashboard`; else `isHR` (member of `ygTimesheet.space.HrData`) → `HrDashboard`; else `EmployeeDashboard`.
- All aggregation math lives in `utils/hr-dashboard.ts` (pure, no platform deps) and is unit-tested. Svelte components receive plain data only, never live Huly docs.
- No em-dashes in UI copy or commit messages (user preference).
- Reuse existing components: `dashboard/KpiStrip.svelte` (`{ label, value, tone?, hint? }[]`), `dashboard/Donut.svelte` (`{ name, count, color }[]`), `yg-table` shell/tokens. Match `EmployeeDashboard.svelte` structure.
- Attendance/timesheet data is sparse now (new features); every widget MUST render a clean empty state.

---

### Task 1: HR aggregation lib + tests

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/hr-dashboard.ts`
- Test: `plugins/yg-timesheet-resources/src/__tests__/hr-dashboard.test.ts`

**Interfaces:**
- Produces (all consumed by Task 5 `HrDashboard.svelte`):
  - Types: `HrEmp { id: string; name: string; active: boolean }`, `HrAtt { employee: string; mode: 'office'|'wfh'; open: boolean; punchIn: number }`, `HrHours { employee: string; hours: number; date: number }`, `HrSub { employee: string; submitted: boolean }`, `AttToday { employee: string; name: string; mode: 'office'|'wfh'; open: boolean }`, `PersonHours { employee: string; name: string; hours: number; days: number; lastActive: number }`
  - `headcount(emps: HrEmp[]): number`
  - `attendanceToday(att: HrAtt[], emps: HrEmp[]): AttToday[]`
  - `wfhOfficeSplit(att: HrAtt[], emps: HrEmp[]): { office: number; wfh: number }`
  - `notPunchedToday(att: HrAtt[], emps: HrEmp[]): HrEmp[]`
  - `orgHoursTotal(hours: HrHours[]): number`
  - `hoursByPerson(hours: HrHours[], emps: HrEmp[]): PersonHours[]`
  - `notLoggedThisWeek(hours: HrHours[], emps: HrEmp[]): HrEmp[]`
  - `submissionCompliance(subs: HrSub[], emps: HrEmp[]): { submitted: number; expected: number; missing: HrEmp[] }`

- [ ] **Step 1: Write the failing test**

```ts
// plugins/yg-timesheet-resources/src/__tests__/hr-dashboard.test.ts
import {
  headcount, attendanceToday, wfhOfficeSplit, notPunchedToday, orgHoursTotal,
  hoursByPerson, notLoggedThisWeek, submissionCompliance,
  type HrEmp, type HrAtt, type HrHours, type HrSub
} from '../utils/hr-dashboard'

const emps: HrEmp[] = [
  { id: 'e1', name: 'Alice A', active: true },
  { id: 'e2', name: 'Bob B', active: true },
  { id: 'e3', name: 'Cara C', active: true },
  { id: 'e4', name: 'Dan D', active: false } // inactive -> excluded from counts
]

describe('headcount', () => {
  it('counts active employees only', () => {
    expect(headcount(emps)).toBe(3)
  })
})

describe('attendanceToday / wfhOfficeSplit / notPunchedToday', () => {
  // e1: two sessions today, latest is wfh + open; e2: one office session, closed; e3: no session
  const att: HrAtt[] = [
    { employee: 'e1', mode: 'office', open: false, punchIn: 100 },
    { employee: 'e1', mode: 'wfh', open: true, punchIn: 200 },
    { employee: 'e2', mode: 'office', open: false, punchIn: 150 }
  ]
  it('attendanceToday: one row per present employee, using the latest session', () => {
    expect(attendanceToday(att, emps)).toEqual([
      { employee: 'e1', name: 'Alice A', mode: 'wfh', open: true },
      { employee: 'e2', name: 'Bob B', mode: 'office', open: false }
    ])
  })
  it('wfhOfficeSplit: distinct present employees by latest mode', () => {
    expect(wfhOfficeSplit(att, emps)).toEqual({ office: 1, wfh: 1 })
  })
  it('notPunchedToday: active employees with no session today', () => {
    expect(notPunchedToday(att, emps).map((e) => e.id)).toEqual(['e3'])
  })
})

describe('hours', () => {
  const hours: HrHours[] = [
    { employee: 'e1', hours: 3, date: 10 },
    { employee: 'e1', hours: 2, date: 20 },
    { employee: 'e2', hours: 4, date: 10 }
    // e3 logged nothing
  ]
  it('orgHoursTotal sums all', () => {
    expect(orgHoursTotal(hours)).toBe(9)
  })
  it('hoursByPerson: grouped, distinct days, lastActive, sorted desc', () => {
    expect(hoursByPerson(hours, emps)).toEqual([
      { employee: 'e1', name: 'Alice A', hours: 5, days: 2, lastActive: 20 },
      { employee: 'e2', name: 'Bob B', hours: 4, days: 1, lastActive: 10 }
    ])
  })
  it('notLoggedThisWeek: active employees with zero logged hours', () => {
    expect(notLoggedThisWeek(hours, emps).map((e) => e.id)).toEqual(['e3'])
  })
})

describe('submissionCompliance', () => {
  const subs: HrSub[] = [
    { employee: 'e1', submitted: true },
    { employee: 'e2', submitted: false }
  ]
  it('counts submitted vs expected(active headcount) and lists the missing', () => {
    const r = submissionCompliance(subs, emps)
    expect(r.submitted).toBe(1)
    expect(r.expected).toBe(3)
    expect(r.missing.map((e) => e.id).sort()).toEqual(['e2', 'e3']) // e2 not submitted, e3 no record
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/yg-timesheet-resources && node_modules/.bin/jest hr-dashboard --silent`
Expected: FAIL (module not found / functions undefined).

- [ ] **Step 3: Write minimal implementation**

```ts
// plugins/yg-timesheet-resources/src/utils/hr-dashboard.ts
// Pure aggregation for the HR dashboard. No platform deps -> unit-testable. HrDashboard.svelte maps
// live query results (AttendanceSession / HrTimeEntry / Timesheet / Employee) to these plain shapes
// and feeds them in, so all math is tested in isolation from queries/rendering.
export interface HrEmp { id: string; name: string; active: boolean }
export interface HrAtt { employee: string; mode: 'office' | 'wfh'; open: boolean; punchIn: number }
export interface HrHours { employee: string; hours: number; date: number }
export interface HrSub { employee: string; submitted: boolean }
export interface AttToday { employee: string; name: string; mode: 'office' | 'wfh'; open: boolean }
export interface PersonHours { employee: string; name: string; hours: number; days: number; lastActive: number }

const nameOf = (emps: HrEmp[], id: string): string => emps.find((e) => e.id === id)?.name ?? id
const activeIds = (emps: HrEmp[]): Set<string> => new Set(emps.filter((e) => e.active).map((e) => e.id))

export function headcount (emps: HrEmp[]): number {
  return emps.filter((e) => e.active).length
}

// One row per present employee, carrying the mode/open of their LATEST punch-in today (an employee
// may punch office then wfh; the most recent session wins). Ordered by employee name.
export function attendanceToday (att: HrAtt[], emps: HrEmp[]): AttToday[] {
  const latest = new Map<string, HrAtt>()
  for (const a of att) {
    const cur = latest.get(a.employee)
    if (cur === undefined || a.punchIn > cur.punchIn) latest.set(a.employee, a)
  }
  return [...latest.values()]
    .map((a) => ({ employee: a.employee, name: nameOf(emps, a.employee), mode: a.mode, open: a.open }))
    .sort((x, y) => x.name.localeCompare(y.name))
}

export function wfhOfficeSplit (att: HrAtt[], emps: HrEmp[]): { office: number, wfh: number } {
  const today = attendanceToday(att, emps)
  return {
    office: today.filter((t) => t.mode === 'office').length,
    wfh: today.filter((t) => t.mode === 'wfh').length
  }
}

export function notPunchedToday (att: HrAtt[], emps: HrEmp[]): HrEmp[] {
  const present = new Set(att.map((a) => a.employee))
  return emps.filter((e) => e.active && !present.has(e.id))
}

export function orgHoursTotal (hours: HrHours[]): number {
  return round2(hours.reduce((s, h) => s + h.hours, 0))
}

// Per-employee rollup: summed hours, distinct days logged, latest date. Sorted most hours first,
// then name. Only employees who logged something appear.
export function hoursByPerson (hours: HrHours[], emps: HrEmp[]): PersonHours[] {
  const sum = new Map<string, number>()
  const days = new Map<string, Set<number>>()
  const last = new Map<string, number>()
  for (const h of hours) {
    sum.set(h.employee, (sum.get(h.employee) ?? 0) + h.hours)
    if (!days.has(h.employee)) days.set(h.employee, new Set())
    days.get(h.employee)?.add(h.date)
    last.set(h.employee, Math.max(last.get(h.employee) ?? 0, h.date))
  }
  return [...sum.keys()]
    .map((id) => ({ employee: id, name: nameOf(emps, id), hours: round2(sum.get(id) ?? 0), days: days.get(id)?.size ?? 0, lastActive: last.get(id) ?? 0 }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))
}

export function notLoggedThisWeek (hours: HrHours[], emps: HrEmp[]): HrEmp[] {
  const logged = new Set(hours.map((h) => h.employee))
  return emps.filter((e) => e.active && !logged.has(e.id))
}

// submitted = distinct employees with a submitted record; expected = active headcount; missing =
// active employees who did NOT submit (no record, or record with submitted=false).
export function submissionCompliance (subs: HrSub[], emps: HrEmp[]): { submitted: number, expected: number, missing: HrEmp[] } {
  const done = new Set(subs.filter((s) => s.submitted).map((s) => s.employee))
  const active = activeIds(emps)
  return {
    submitted: [...done].filter((id) => active.has(id)).length,
    expected: active.size,
    missing: emps.filter((e) => e.active && !done.has(e.id))
  }
}

function round2 (n: number): number {
  return Math.round(n * 100) / 100
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd plugins/yg-timesheet-resources && node_modules/.bin/jest hr-dashboard --silent`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/hr-dashboard.ts plugins/yg-timesheet-resources/src/__tests__/hr-dashboard.test.ts
git commit -m "feat(hr-dashboard): pure aggregation lib + tests"
```

---

### Task 2: i18n strings

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts` (the `string:` id block for `@hcengineering/yg-timesheet`)
- Modify: `plugins/yg-timesheet-assets/lang/en.json`
- Modify: `plugins/yg-timesheet-assets/lang/ru.json`

**Interfaces:**
- Produces (consumed by Tasks 3-5 as `ygTimesheet.string.X`): `HrDashboard`, `Headcount`, `PresentToday`, `WfhOffice`, `HoursThisWeek` (reuse if it already exists; otherwise add), `NotLoggedThisWeek`, `TimesheetSubmissions`, `AttendanceToday`, `NotPunchedIn`, `TimesheetCompliance`, `OfficeVsWfh`, `HoursByPerson`, `Submitted`, `NotSubmitted`, `LastActive`, `DaysLogged`.

- [ ] **Step 1: Add the string ids**

In `plugins/yg-timesheet/src/index.ts`, locate the existing `string: { ... }` map for the plugin (where `MyAttendanceToday`, `MyTasks`, etc. live) and add, following the exact same `'' as IntlString` pattern:

```ts
    HrDashboard: '' as IntlString,
    Headcount: '' as IntlString,
    PresentToday: '' as IntlString,
    WfhOffice: '' as IntlString,
    NotLoggedThisWeek: '' as IntlString,
    TimesheetSubmissions: '' as IntlString,
    AttendanceToday: '' as IntlString,
    NotPunchedIn: '' as IntlString,
    TimesheetCompliance: '' as IntlString,
    OfficeVsWfh: '' as IntlString,
    HoursByPerson: '' as IntlString,
    Submitted: '' as IntlString,
    NotSubmitted: '' as IntlString,
    LastActive: '' as IntlString,
    DaysLogged: '' as IntlString
```

(If `HoursThisWeek` is not already present in the map, add it too: `HoursThisWeek: '' as IntlString`.)

- [ ] **Step 2: Add English translations**

In `plugins/yg-timesheet-assets/lang/en.json`, under the string section, add:

```json
    "HrDashboard": "HR dashboard",
    "Headcount": "Headcount",
    "PresentToday": "Present today",
    "WfhOffice": "WFH / Office",
    "NotLoggedThisWeek": "Not logged this week",
    "TimesheetSubmissions": "Timesheet submissions",
    "AttendanceToday": "Attendance today",
    "NotPunchedIn": "Not punched in",
    "TimesheetCompliance": "Timesheet compliance",
    "OfficeVsWfh": "Office vs WFH",
    "HoursByPerson": "Hours this week by person",
    "Submitted": "Submitted",
    "NotSubmitted": "Not submitted",
    "LastActive": "Last active",
    "DaysLogged": "Days"
```

- [ ] **Step 3: Add Russian keys (English fallback values are acceptable here)**

In `plugins/yg-timesheet-assets/lang/ru.json`, add the SAME keys with the same English values (the repo already ships several untranslated ru fallbacks; keep keys present so nothing is missing at runtime).

- [ ] **Step 4: Typecheck**

Run: `cd plugins/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build`
Expected: builds clean (no missing-id TS errors).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts plugins/yg-timesheet-assets/lang/en.json plugins/yg-timesheet-assets/lang/ru.json
git commit -m "feat(hr-dashboard): i18n strings"
```

---

### Task 3: Attendance-today + Not-logged cards

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/dashboard/HrAttendanceTodayCard.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/dashboard/HrNotLoggedCard.svelte`

**Interfaces:**
- Consumes: `AttToday`, `HrEmp` (Task 1); `ygTimesheet.string.*` (Task 2).
- Produces: `<HrAttendanceTodayCard present={AttToday[]} notPunched={HrEmp[]} />`, `<HrNotLoggedCard emps={HrEmp[]} />`.

Follow the structure of `plugins/yg-timesheet-resources/src/components/dashboard/MyTasksCard.svelte` (card chrome: `.card` panel with `--yg-*` tokens, a title via `<Label>`, a capped list ~6 rows, and a clean empty state). Read that file first for the exact class names and empty-state pattern.

- [ ] **Step 1: HrAttendanceTodayCard.svelte**

A card titled `AttendanceToday`. Body: for each `present` row show the name, a small mode pill (`Office`/`WFH`), and an "In now" marker when `open`. Below (or as a muted subsection) list up to a few `notPunched` names under a `NotPunchedIn` label with the count. Empty state (no present rows): show "No punches yet today." Cap lists at ~6 with a "+N more" tail. Use `--yg-green` for the "In now" dot, `--yg-text-dim` for pills.

- [ ] **Step 2: HrNotLoggedCard.svelte**

A card titled `NotLoggedThisWeek`. Body: list up to ~6 employee names from `emps` (active employees with zero logged hours this week), with the total count in the header. Empty state (empty `emps`): "Everyone has logged time this week." (green/positive tone).

- [ ] **Step 3: Typecheck (svelte-check)**

Run: `cd plugins/yg-timesheet-resources && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "HrAttendanceTodayCard|HrNotLoggedCard"`
Expected: no output (no errors/warnings for these two files). Pre-existing `$lookup` errors elsewhere are unrelated.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/dashboard/HrAttendanceTodayCard.svelte plugins/yg-timesheet-resources/src/components/dashboard/HrNotLoggedCard.svelte
git commit -m "feat(hr-dashboard): attendance-today and not-logged cards"
```

---

### Task 4: Compliance + Hours-by-person cards

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/dashboard/HrComplianceCard.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/dashboard/HrHoursByPersonCard.svelte`

**Interfaces:**
- Consumes: `PersonHours`, `HrEmp` (Task 1); `ygTimesheet.string.*` (Task 2); `formatHours` from `../../utils/week`.
- Produces: `<HrComplianceCard submitted={number} expected={number} missing={HrEmp[]} />`, `<HrHoursByPersonCard rows={PersonHours[]} />`.

- [ ] **Step 1: HrComplianceCard.svelte**

A card titled `TimesheetCompliance`. Show a progress bar: submitted / expected (e.g. `12 / 34`), the bar filled `submitted/expected` in `--yg-green`, remainder in `--yg-border`. Below, `NotSubmitted` count and up to ~5 missing names. Guard divide-by-zero (expected === 0 -> empty state "No timesheet activity yet."). Percentage rounded to a whole number.

- [ ] **Step 2: HrHoursByPersonCard.svelte**

A full-width card titled `HoursByPerson` using the `yg-table` shell (read `plugins/yg-timesheet-resources/src/components/dashboard/ProjectCards.svelte` for the exact `.yg-table`/`.yg-num` table pattern and the fixed-height + scroll wrapper). Columns: Member · Hours (`formatHours(row.hours)`) · Days (`row.days`) · `LastActive` (format `row.lastActive` ms as a short date, or "-" when 0). Fixed max-height with vertical scroll. Empty state row spanning all columns: "No time logged this week."

- [ ] **Step 3: Typecheck (svelte-check)**

Run: `cd plugins/yg-timesheet-resources && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "HrComplianceCard|HrHoursByPersonCard"`
Expected: no output for these two files.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/dashboard/HrComplianceCard.svelte plugins/yg-timesheet-resources/src/components/dashboard/HrHoursByPersonCard.svelte
git commit -m "feat(hr-dashboard): compliance and hours-by-person cards"
```

---

### Task 5: HrDashboard.svelte (queries + layout)

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/HrDashboard.svelte`

**Interfaces:**
- Consumes: all of Task 1's lib, Task 3 + Task 4 cards, `KpiStrip` (+ `type Kpi`), `Donut`, `GreetingCard`, `ensureHrMembership`, `ygTimesheet.string.*`.
- Produces: `<HrDashboard />` (consumed by Task 6 router).

Model on `plugins/yg-timesheet-resources/src/components/EmployeeDashboard.svelte` (root `<div class="dash yg-page">` with the `.dash flex:1;min-width:0` rule, `.yg-scroll`, `GreetingCard`, `KpiStrip`, `.dash-attention` 2x2 grid, full-width detail).

- [ ] **Step 1: Queries + mapping**

Read that this component runs for HR-roster viewers. On mount call `ensureHrMembership()` (owner self-add, no-op otherwise). Queries:
  - Employees: `client`/`createQuery` on `contact.mixin.Employee` -> map to `HrEmp[]` (`id`, `formatName(name)`, `active: e.active !== false`).
  - Attendance today: `createQuery(ygTimesheet.class.AttendanceSession, { date: localMidnight(Date.now()) })` -> `HrAtt[]` (`employee`, `mode`, `open: punchOut == null`, `punchIn`). Use `localMidnight` from `../utils/attendance`.
  - Hours this week: `createQuery(ygTimesheet.class.HrTimeEntry, { date: { $gte: week.start, $lt: week.end } })` (week via `weekRange(Date.now())` from `../utils/week`) -> `HrHours[]` (`employee`, `hours`, `date`).
  - Timesheet submissions this week: `createQuery(ygTimesheet.class.Timesheet, { weekStart: week.start })` and its `TimesheetDay`s (status `Submitted`/`Approved` counts as submitted) -> `HrSub[]` (`employee`, `submitted`). This query may return nothing if HR lacks read access to Timesheet docs; that is acceptable and yields an empty-state compliance card. Do NOT block the dashboard on it.

- [ ] **Step 2: Derived (pure lib) + KPI strip**

```ts
$: emps = /* mapped HrEmp[] */
$: att = /* mapped HrAtt[] */
$: hours = /* mapped HrHours[] */
$: subs = /* mapped HrSub[] */
$: present = attendanceToday(att, emps)
$: split = wfhOfficeSplit(att, emps)
$: notPunched = notPunchedToday(att, emps)
$: byPerson = hoursByPerson(hours, emps)
$: notLogged = notLoggedThisWeek(hours, emps)
$: comp = submissionCompliance(subs, emps)
$: kpis = [
  { label: 'Headcount', value: headcount(emps), tone: 'neutral' },
  { label: 'Present today', value: present.length, tone: 'neutral' },
  { label: 'WFH / Office', value: `${split.wfh} / ${split.office}`, tone: 'neutral' },
  { label: 'Hours this week', value: formatHours(orgHoursTotal(hours)), tone: 'neutral' },
  { label: 'Not logged this week', value: notLogged.length, tone: 'amber' },
  { label: 'Timesheet submissions', value: `${comp.submitted} / ${comp.expected}`, tone: comp.expected > 0 && comp.submitted < comp.expected ? 'amber' : 'neutral' }
] as Kpi[]
```
(Labels shown as literals for clarity; wire through `ygTimesheet.string.*` where the card components take label props, matching how `EmployeeDashboard` handles its KpiStrip labels.)

- [ ] **Step 3: Layout**

```
<div class="dash yg-page"><div class="yg-scroll">
  <GreetingCard name={...} />
  <KpiStrip tiles={kpis} />
  <div class="dash-attention">
    <HrAttendanceTodayCard present={present} notPunched={notPunched} />
    <HrNotLoggedCard emps={notLogged} />
    <HrComplianceCard submitted={comp.submitted} expected={comp.expected} missing={comp.missing} />
    <Donut segments={[
      { name: 'Office', count: split.office, color: '#6366f1' },
      { name: 'WFH', count: split.wfh, color: '#14b8a6' }
    ]} />
  </div>
  <div class="dash-detail"><HrHoursByPersonCard rows={byPerson} /></div>
</div></div>
```
Reuse the `.dash`, `.dash-attention`, `.dash-detail` styles verbatim from `EmployeeDashboard.svelte` (copy the `<style>` block; drop the `.dash-detail` two-column rule -> single full-width child here).

- [ ] **Step 4: Typecheck**

Run: `cd plugins/yg-timesheet-resources && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "HrDashboard"`
Expected: no output for `HrDashboard.svelte`.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/HrDashboard.svelte
git commit -m "feat(hr-dashboard): HrDashboard queries + layout"
```

---

### Task 6: DashboardHome router branch

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/DashboardHome.svelte`

**Interfaces:**
- Consumes: `HrDashboard` (Task 5), `ygTimesheet.space.HrData`.

- [ ] **Step 1: Add HR membership detection**

In the `<script>`, add an HrData-membership query alongside the existing project/approver query:

```ts
import core, { getCurrentAccount } from '@hcengineering/core'
// ...
let isHR = false
let hrReady = false
const hrQuery = createQuery()
hrQuery.query(core.class.Space, { _id: ygTimesheet.space.HrData }, (res) => {
  const space = res[0]
  isHR = space !== undefined && space.members.includes(getCurrentAccount().uuid)
  hrReady = true
})
```

Update the readiness gate so BOTH queries have resolved before branching: `$: ready = projReady && hrReady` (rename the existing `ready` set inside the projects callback to `projReady`).

- [ ] **Step 2: Add the branch**

```svelte
{#if !ready}
  <!-- resolving; render nothing to avoid a flash -->
{:else if isPM}
  <Dashboard />
{:else if isHR}
  <HrDashboard />
{:else}
  <EmployeeDashboard />
{/if}
```
Add `import HrDashboard from './HrDashboard.svelte'`.

- [ ] **Step 3: Typecheck**

Run: `cd plugins/yg-timesheet-resources && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "DashboardHome"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/DashboardHome.svelte
git commit -m "feat(hr-dashboard): route HR-roster members to HrDashboard (PM > HR > Employee)"
```

---

### Task 7: Build, deploy (front-only), verify

**Files:** none (build/deploy). **GATE: pause for explicit user go-ahead before building.**

- [ ] **Step 1: Front-only build** — rebuild `yg-local/front:beta` (rush build -> dev/prod webpack -> pods/front bundle+package+docker). No workspace/transactor/tool, no `upgrade-workspace` (front-only change).

- [ ] **Step 2: Deploy** (from `huly-selfhost/`):
```bash
C="docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml"
$C up -d --force-recreate front
$C restart nginx
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8087/   # expect 200
```

- [ ] **Step 3: Manual verify.**
  - Log in as **sreya** (HR roster, non-PM) -> Dashboard app opens the **HR dashboard**: KPI strip + Hours-by-person populate from real data; attendance / compliance / WFH-office show clean empty states.
  - Log in as **pravin** (admin) -> still the **PM** dashboard.
  - Log in as a plain non-roster employee -> still the **Employee** dashboard.

---

## Self-Review

- **Spec coverage:** routing PM>HR>Employee (T6) · role detection via HrData (T6) · KPI strip 6 tiles (T5) · attendance-today (T3) · not-logged (T3) · compliance (T4) · office-vs-wfh donut (T5) · hours-by-person (T4) · pure aggregation + tests (T1) · i18n (T2) · front-only deploy (T7). Approvals/departments/PTO excluded per spec. All spec sections map to a task.
- **Placeholder scan:** none. Card visuals are described with concrete titles/props/empty-states and a named reference component to copy chrome from; the aggregation lib and tests are full code.
- **Type consistency:** `HrEmp/HrAtt/HrHours/HrSub/AttToday/PersonHours` defined in T1 used unchanged in T3-T5; `submissionCompliance` returns `{submitted, expected, missing}` used verbatim in T5's KPI + T4's card; `attendanceToday`/`wfhOfficeSplit`/`notPunchedToday`/`hoursByPerson`/`notLoggedThisWeek` names consistent across T1/T5.
- **Open item (from spec):** HR read access to `Timesheet` docs for the compliance widget is unverified; T5 Step 1 handles it defensively (empty-state on no data/access), so it never blocks the dashboard.
