# HR Employee Attendance Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only HR attendance report (Today live board / All-employees summary / Individual session log, each Excel-exportable) as a new `Attendance` special in the Human Resource app.

**Architecture:** A single `HrAttendance.svelte` page reads `AttendanceSession` directly from the shared `core.space.Workspace` (world-readable, no server projection) and renders one of three modes via a segmented switch. All aggregation is a pure, jest-tested `utils/hr-attendance.ts`. Excel export mirrors the timesheet reports (`write-excel-file`, hours as TIME cells). The special is registered on the existing HR app's `navigatorModel`.

**Tech Stack:** TypeScript, Huly platform model, Svelte 4 + `@hcengineering/presentation` live queries, `write-excel-file`, jest (ts-jest), SCSS (`yg-table.scss`).

## Global Constraints

- **Branch:** `yg_beta` only. NEVER merge to `yg_develop`. LOCAL/beta demo only.
- **Version pin:** Huly `v0.7.426`. Do not bump any `@hcengineering/*` versions.
- **No em-dashes** anywhere (code, comments, copy, commit messages). Use `-` or `·`.
- **Model change ⇒ full rebuild:** adding a special to the HR app's `navigatorModel` is a model change, so delivery is a **full 4-image rebuild + `upgrade-workspace`**, not front-only.
- **Client webpack heap:** `NODE_OPTIONS=--max-old-space-size=6144`. Node: `nvm use 22`. Deploy redpanda-first; restart nginx after recreating front/transactor.
- **Read-only:** the report never writes `AttendanceSession`. Query the shared `core.space.Workspace`.
- **Lang parity:** every en.json key must exist in ru.json (the `Locales are equal` jest test enforces it).
- **Hours in Excel** are TIME cells: `{ value: ms / 86_400_000, type: Number, format: '[h]:mm' }` (fraction of a day, so they display `1:30` and sum). This is the `hoursCell` idiom from `utils/hr-xlsx.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugins/yg-timesheet-resources/src/utils/hr-attendance.ts` | **New.** Pure aggregation: `todayBoard`, `attendanceSummary`, `individualLog` + their result types. |
| `plugins/yg-timesheet-resources/src/utils/__tests__/hr-attendance.test.ts` | **New.** Jest tests (fixed-clock fixtures). |
| `plugins/yg-timesheet-resources/src/utils/hr-attendance-xlsx.ts` | **New.** `exportTodayXlsx` / `exportSummaryXlsx` / `exportIndividualXlsx` via `write-excel-file`. |
| `plugins/yg-timesheet/src/index.ts` | **Modify.** Add `component.HrAttendance` + 7 `string` ids. |
| `plugins/yg-timesheet-assets/lang/en.json` + `ru.json` | **Modify.** The 7 new strings. |
| `models/yg-timesheet/src/index.ts` | **Modify.** Add the `attendance` special to the HR app `navigatorModel.specials`. |
| `plugins/yg-timesheet-resources/src/components/HrAttendance.svelte` | **New.** The report page (three modes). |
| `plugins/yg-timesheet-resources/src/index.ts` | **Modify.** Register the `HrAttendance` component. |

Task order: **1** (pure lib TDD) → **2** (xlsx) → **3** (plugin ids/strings) → **4** (lang) → **5** (model special) → **6** (page + register) → **7** (build + deploy + smoke).

---

## Task 1: Pure aggregation lib (`utils/hr-attendance.ts`)

Pure functions over a minimal session shape, reusing `sessionDuration` from `utils/attendance.ts`. The tested core; done first via TDD.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/hr-attendance.ts`
- Test: `plugins/yg-timesheet-resources/src/utils/__tests__/hr-attendance.test.ts`

**Interfaces:**
- Consumes: `sessionDuration(s, now)` and `type AttendanceMode` from `./attendance` (Phase 1d, already present).
- Produces (Tasks 2 + 6 import these):
  - `interface SessionLike { employee: Ref<Employee>; date: number; punchIn: number; punchOut?: number; mode: AttendanceMode; punchInNote?: string; punchOutNote?: string }`
  - `interface EmpRef { ref: Ref<Employee>; name: string }`
  - `interface TodayRow { employee: Ref<Employee>; name: string; status: 'in' | 'out'; firstIn?: number; lastOut?: number; sessions: number; totalMs: number; mode?: AttendanceMode }`
  - `interface SummaryRow { employee: Ref<Employee>; name: string; daysPresent: number; totalMs: number; officeMs: number; wfhMs: number }`
  - `interface DayGroup { date: number; sessions: SessionLike[]; subtotalMs: number }`
  - `interface IndividualLog { days: DayGroup[]; summary: { daysPresent: number; totalMs: number; officeMs: number; wfhMs: number } }`
  - `todayBoard(sessions, employees, dayMidnight, now): TodayRow[]`
  - `attendanceSummary(sessions, employees, from, to, now): SummaryRow[]`
  - `individualLog(sessions, employee, from, to, now): IndividualLog`

- [ ] **Step 1: Write the failing test**

Create `plugins/yg-timesheet-resources/src/utils/__tests__/hr-attendance.test.ts`:

```ts
import {
  todayBoard,
  attendanceSummary,
  individualLog,
  type SessionLike,
  type EmpRef
} from '../hr-attendance'

// Fixed clock: 2026-07-29 14:30 local. No Date.now() anywhere.
const now = new Date(2026, 6, 29, 14, 30, 0).getTime()
const mid = (d: number): number => new Date(2026, 6, d, 0, 0, 0).getTime()
const at = (d: number, hour: number, min = 0): number => new Date(2026, 6, d, hour, min, 0).getTime()

const alice = 'emp-alice' as any
const bob = 'emp-bob' as any
const employees: EmpRef[] = [
  { ref: bob, name: 'Bob' },
  { ref: alice, name: 'Alice' }
]

// A closed session for `emp` on day `d`.
const s = (emp: any, d: number, inH: number, outH: number, mode: 'office' | 'wfh' = 'office'): SessionLike => ({
  employee: emp, date: mid(d), punchIn: at(d, inH), punchOut: at(d, outH), mode
})
// An open session (no punchOut).
const open = (emp: any, d: number, inH: number, mode: 'office' | 'wfh' = 'office'): SessionLike => ({
  employee: emp, date: mid(d), punchIn: at(d, inH), mode
})

const HOUR = 3600_000

describe('todayBoard', () => {
  test('only today; per-employee first/last/sessions/total; sorted by name', () => {
    const sessions = [
      s(alice, 29, 9, 11, 'office'), // 2h
      s(alice, 29, 13, 14, 'wfh'), //  1h
      s(bob, 29, 10, 12, 'office'), // 2h
      s(alice, 28, 9, 17) //           yesterday - excluded
    ]
    const rows = todayBoard(sessions, employees, mid(29), now)
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Bob'])
    const a = rows[0]
    expect(a.status).toBe('out')
    expect(a.firstIn).toBe(at(29, 9))
    expect(a.lastOut).toBe(at(29, 14))
    expect(a.sessions).toBe(2)
    expect(a.totalMs).toBe(3 * HOUR)
    expect(a.mode).toBe('wfh') // most recent session's mode
  })
  test('an open session -> status in, lastOut undefined, total counts live to now', () => {
    const rows = todayBoard([open(bob, 29, 14, 'wfh')], employees, mid(29), now)
    const b = rows.find((r) => r.name === 'Bob')!
    expect(b.status).toBe('in')
    expect(b.lastOut).toBeUndefined()
    expect(b.totalMs).toBe(30 * 60_000) // 14:00 -> 14:30
  })
  test('employees with no session today are omitted', () => {
    const rows = todayBoard([s(alice, 29, 9, 10)], employees, mid(29), now)
    expect(rows.map((r) => r.name)).toEqual(['Alice'])
  })
})

describe('attendanceSummary', () => {
  test('every employee is a row (zeros for absent); office+wfh = total; days present', () => {
    const sessions = [
      s(alice, 27, 9, 11, 'office'), // 2h office
      s(alice, 27, 13, 14, 'wfh'), //  1h wfh (same day)
      s(alice, 28, 9, 12, 'office') // 3h office (2nd day)
    ]
    const rows = attendanceSummary(sessions, employees, mid(27), mid(30), now)
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Bob'])
    const a = rows[0]
    expect(a.daysPresent).toBe(2)
    expect(a.officeMs).toBe(5 * HOUR)
    expect(a.wfhMs).toBe(1 * HOUR)
    expect(a.totalMs).toBe(6 * HOUR)
    const b = rows[1]
    expect(b.daysPresent).toBe(0)
    expect(b.totalMs).toBe(0)
  })
  test('range is [from, to): sessions on `to` day are excluded', () => {
    const sessions = [s(alice, 30, 9, 17)]
    const rows = attendanceSummary(sessions, employees, mid(27), mid(30), now)
    expect(rows.find((r) => r.name === 'Alice')!.daysPresent).toBe(0)
  })
})

describe('individualLog', () => {
  test('only the employee, grouped by day newest-first, subtotals + summary', () => {
    const sessions = [
      s(alice, 27, 9, 11, 'office'), // 2h
      s(alice, 28, 13, 14, 'wfh'), //  1h
      s(bob, 27, 9, 17) //             other employee - excluded
    ]
    const log = individualLog(sessions, alice, mid(27), mid(30), now)
    expect(log.days.map((d) => d.date)).toEqual([mid(28), mid(27)]) // newest first
    expect(log.days[0].sessions).toHaveLength(1)
    expect(log.days[1].subtotalMs).toBe(2 * HOUR)
    expect(log.summary.daysPresent).toBe(2)
    expect(log.summary.totalMs).toBe(3 * HOUR)
    expect(log.summary.officeMs).toBe(2 * HOUR)
    expect(log.summary.wfhMs).toBe(1 * HOUR)
  })
  test('sessions within a day are ascending by punchIn', () => {
    const log = individualLog(
      [s(alice, 27, 13, 14), s(alice, 27, 9, 10)], alice, mid(27), mid(30), now
    )
    expect(log.days[0].sessions.map((x) => x.punchIn)).toEqual([at(27, 9), at(27, 13)])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd plugins/yg-timesheet-resources && npx jest hr-attendance.test`
Expected: FAIL — `Cannot find module '../hr-attendance'`.

- [ ] **Step 3: Write the implementation**

Create `plugins/yg-timesheet-resources/src/utils/hr-attendance.ts`:

```ts
//
// YoungGlobes: pure aggregation for the HR attendance report (today board, all-employees summary,
// individual session log). No queries, no client, no Svelte - plain functions over a minimal
// session shape (structurally the real AttendanceSession). Unit-tested in __tests__/hr-attendance.test.ts.
//
import type { Ref } from '@hcengineering/core'
import type { Employee } from '@hcengineering/contact'
import { sessionDuration, type AttendanceMode } from './attendance'

/** Minimal shape the aggregators need from an AttendanceSession doc. Notes are carried (unused by
 *  the math) so the Individual log can render them. */
export interface SessionLike {
  employee: Ref<Employee>
  date: number // local midnight of the punch-in day
  punchIn: number
  punchOut?: number
  mode: AttendanceMode
  punchInNote?: string
  punchOutNote?: string
}

/** An employee row source (ref + display name). */
export interface EmpRef {
  ref: Ref<Employee>
  name: string
}

export interface TodayRow {
  employee: Ref<Employee>
  name: string
  status: 'in' | 'out'
  firstIn?: number
  lastOut?: number // undefined while a session is open, or none closed
  sessions: number
  totalMs: number // open session counts live to `now`
  mode?: AttendanceMode // most-recent session's mode
}

export interface SummaryRow {
  employee: Ref<Employee>
  name: string
  daysPresent: number
  totalMs: number
  officeMs: number
  wfhMs: number
}

export interface DayGroup {
  date: number
  sessions: SessionLike[]
  subtotalMs: number
}

export interface IndividualLog {
  days: DayGroup[]
  summary: { daysPresent: number, totalMs: number, officeMs: number, wfhMs: number }
}

function splitByMode (sessions: SessionLike[], now: number): { officeMs: number, wfhMs: number } {
  let officeMs = 0
  let wfhMs = 0
  for (const s of sessions) {
    const d = sessionDuration(s, now)
    if (s.mode === 'wfh') wfhMs += d
    else officeMs += d
  }
  return { officeMs, wfhMs }
}

/** Live board of who punched today. One row per employee WITH a session today, sorted by name. */
export function todayBoard (
  sessions: SessionLike[], employees: EmpRef[], dayMidnight: number, now: number
): TodayRow[] {
  const nameOf = new Map(employees.map((e) => [e.ref, e.name]))
  const byEmp = new Map<Ref<Employee>, SessionLike[]>()
  for (const s of sessions) {
    if (s.date !== dayMidnight) continue
    const arr = byEmp.get(s.employee) ?? []
    arr.push(s)
    byEmp.set(s.employee, arr)
  }
  const rows: TodayRow[] = []
  for (const [emp, ss] of byEmp) {
    const openExists = ss.some((s) => s.punchOut === undefined)
    const outs = ss.filter((s) => s.punchOut !== undefined).map((s) => s.punchOut as number)
    const latest = [...ss].sort((a, b) => b.punchIn - a.punchIn)[0]
    rows.push({
      employee: emp,
      name: nameOf.get(emp) ?? '',
      status: openExists ? 'in' : 'out',
      firstIn: Math.min(...ss.map((s) => s.punchIn)),
      lastOut: openExists || outs.length === 0 ? undefined : Math.max(...outs),
      sessions: ss.length,
      totalMs: ss.reduce((sum, s) => sum + sessionDuration(s, now), 0),
      mode: latest.mode
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/** All-employees summary over [from, to). EVERY employee is a row (zeros for absentees), sorted by name. */
export function attendanceSummary (
  sessions: SessionLike[], employees: EmpRef[], from: number, to: number, now: number
): SummaryRow[] {
  const inRange = sessions.filter((s) => s.date >= from && s.date < to)
  const byEmp = new Map<Ref<Employee>, SessionLike[]>()
  for (const s of inRange) {
    const arr = byEmp.get(s.employee) ?? []
    arr.push(s)
    byEmp.set(s.employee, arr)
  }
  return employees
    .map((e) => {
      const ss = byEmp.get(e.ref) ?? []
      const { officeMs, wfhMs } = splitByMode(ss, now)
      return {
        employee: e.ref,
        name: e.name,
        daysPresent: new Set(ss.map((s) => s.date)).size,
        totalMs: officeMs + wfhMs,
        officeMs,
        wfhMs
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Session-level log for one employee over [from, to): days newest-first, sessions ascending, + summary. */
export function individualLog (
  sessions: SessionLike[], employee: Ref<Employee>, from: number, to: number, now: number
): IndividualLog {
  const mine = sessions.filter((s) => s.employee === employee && s.date >= from && s.date < to)
  const byDate = new Map<number, SessionLike[]>()
  for (const s of mine) {
    const arr = byDate.get(s.date) ?? []
    arr.push(s)
    byDate.set(s.date, arr)
  }
  const days: DayGroup[] = [...byDate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([date, ss]) => ({
      date,
      sessions: [...ss].sort((a, b) => a.punchIn - b.punchIn),
      subtotalMs: ss.reduce((sum, s) => sum + sessionDuration(s, now), 0)
    }))
  const { officeMs, wfhMs } = splitByMode(mine, now)
  return {
    days,
    summary: { daysPresent: byDate.size, totalMs: officeMs + wfhMs, officeMs, wfhMs }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd plugins/yg-timesheet-resources && npx jest hr-attendance.test`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/hr-attendance.ts \
        plugins/yg-timesheet-resources/src/utils/__tests__/hr-attendance.test.ts
git commit -m "yg-timesheet: pure HR attendance aggregation (today/summary/individual) + tests"
```

---

## Task 2: Excel export (`utils/hr-attendance-xlsx.ts`)

One export function per mode via `write-excel-file`, matching `utils/hr-xlsx.ts`. Not unit-tested (matches `hr-xlsx.ts`); gate is a clean compile.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/hr-attendance-xlsx.ts`

**Interfaces:**
- Consumes: `TodayRow`, `SummaryRow`, `IndividualLog` (Task 1); `formatDuration` from `./attendance`.
- Produces: `exportTodayXlsx(rows)`, `exportSummaryXlsx(rows, from, to)`, `exportIndividualXlsx(log, employeeName, from, to)` — all `Promise<void>`.

- [ ] **Step 1: Write the module**

Create `plugins/yg-timesheet-resources/src/utils/hr-attendance-xlsx.ts`:

```ts
//
// Excel (.xlsx) export of the HR attendance report, one function per mode. Hours are written as
// Excel TIME values (a fraction of a 24h day) with an `[h]:mm` format so they display like `1:30`
// and sum - the same idiom as utils/hr-xlsx.ts. Times/dates are typed cells. Client-side via
// write-excel-file; the `fileName` option triggers the browser download.
//
import writeXlsxFile, { type SheetData } from 'write-excel-file'
import type { TodayRow, SummaryRow, IndividualLog } from './hr-attendance'

const HM = '[h]:mm'
function hoursCell (ms: number, bold = false): any {
  return { value: ms / 86_400_000, type: Number, format: HM, ...(bold ? { fontWeight: 'bold' } : {}) }
}
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

// yyyy-mm-dd (local) for filenames.
function ymd (ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function safeName (s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'employee'
}

export async function exportTodayXlsx (rows: TodayRow[]): Promise<void> {
  const header = [
    { value: 'Employee', type: String, fontWeight: 'bold' },
    { value: 'Status', type: String, fontWeight: 'bold' },
    { value: 'First in', type: String, fontWeight: 'bold' },
    { value: 'Last out', type: String, fontWeight: 'bold' },
    { value: 'Sessions', type: String, fontWeight: 'bold' },
    { value: 'Total', type: String, fontWeight: 'bold' },
    { value: 'Type', type: String, fontWeight: 'bold' }
  ]
  const body = rows.map((r) => [
    { value: r.name, type: String },
    { value: r.status === 'in' ? 'In now' : 'Out', type: String },
    { value: r.firstIn !== undefined ? timeFmt.format(r.firstIn) : '-', type: String },
    { value: r.lastOut !== undefined ? timeFmt.format(r.lastOut) : '-', type: String },
    { value: r.sessions, type: Number },
    hoursCell(r.totalMs),
    { value: r.mode === 'wfh' ? 'WFH' : 'Office', type: String }
  ])
  const data = [header, ...body] as unknown as SheetData
  await writeXlsxFile(data, { fileName: `hr-attendance-today-${ymd(Date.now())}.xlsx`, stickyRowsCount: 1 })
}

export async function exportSummaryXlsx (rows: SummaryRow[], from: number, to: number): Promise<void> {
  const totalMs = rows.reduce((s, r) => s + r.totalMs, 0)
  const officeMs = rows.reduce((s, r) => s + r.officeMs, 0)
  const wfhMs = rows.reduce((s, r) => s + r.wfhMs, 0)
  const header = [
    { value: 'Employee', type: String, fontWeight: 'bold' },
    { value: 'Days present', type: String, fontWeight: 'bold' },
    { value: 'Total', type: String, fontWeight: 'bold' },
    { value: 'Office', type: String, fontWeight: 'bold' },
    { value: 'WFH', type: String, fontWeight: 'bold' }
  ]
  const body = rows.map((r) => [
    { value: r.name, type: String },
    { value: r.daysPresent, type: Number },
    hoursCell(r.totalMs),
    hoursCell(r.officeMs),
    hoursCell(r.wfhMs)
  ])
  const totals = [
    { value: 'Total', type: String, fontWeight: 'bold' },
    { value: '', type: String },
    hoursCell(totalMs, true),
    hoursCell(officeMs, true),
    hoursCell(wfhMs, true)
  ]
  const data = [header, ...body, totals] as unknown as SheetData
  // `to` is the exclusive end; label the last included day (to - 1 day).
  const lastDay = to - 86_400_000
  await writeXlsxFile(data, {
    fileName: `hr-attendance-summary-${ymd(from)}_${ymd(lastDay)}.xlsx`,
    stickyRowsCount: 1
  })
}

export async function exportIndividualXlsx (
  log: IndividualLog, employeeName: string, from: number, to: number
): Promise<void> {
  const header = [
    { value: 'Date', type: String, fontWeight: 'bold' },
    { value: 'In', type: String, fontWeight: 'bold' },
    { value: 'Out', type: String, fontWeight: 'bold' },
    { value: 'Type', type: String, fontWeight: 'bold' },
    { value: 'Duration', type: String, fontWeight: 'bold' }
  ]
  const body: any[] = []
  for (const day of log.days) {
    for (const s of day.sessions) {
      body.push([
        { value: ymd(s.date), type: String },
        { value: timeFmt.format(s.punchIn), type: String },
        { value: s.punchOut !== undefined ? timeFmt.format(s.punchOut) : '-', type: String },
        { value: s.mode === 'wfh' ? 'WFH' : 'Office', type: String },
        s.punchOut !== undefined ? hoursCell(s.punchOut - s.punchIn) : { value: '-', type: String }
      ])
    }
  }
  const totals = [
    { value: 'Total', type: String, fontWeight: 'bold' },
    { value: '', type: String },
    { value: '', type: String },
    { value: '', type: String },
    hoursCell(log.summary.totalMs, true)
  ]
  const lastDay = to - 86_400_000
  const data = [header, ...body, totals] as unknown as SheetData
  await writeXlsxFile(data, {
    fileName: `hr-attendance-${safeName(employeeName)}-${ymd(from)}_${ymd(lastDay)}.xlsx`,
    stickyRowsCount: 1
  })
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd plugins/yg-timesheet-resources && npx tsc --noEmit -p tsconfig.json 2>&1 | grep hr-attendance-xlsx || echo "no hr-attendance-xlsx errors"`
Expected: `no hr-attendance-xlsx errors` (pre-existing errors in OTHER files, e.g. `$lookup` in Timesheet/Approvals/HrTimesheet, are unrelated and may still print — only lines mentioning `hr-attendance-xlsx.ts` count).

- [ ] **Step 3: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/hr-attendance-xlsx.ts
git commit -m "yg-timesheet: xlsx export for the HR attendance report (today/summary/individual)"
```

---

## Task 3: Plugin ids + strings (`plugins/yg-timesheet/src/index.ts`)

Add the component id and the 7 new string ids the page references. Gate: the plugin package builds and re-emits its type declarations.

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts`

**Interfaces:**
- Produces: `ygTimesheet.component.HrAttendance`; `ygTimesheet.string.{HrAttendance, AllEmployees, Individual, DaysPresent, OfficeHours, WfhHours, InNow}`.

- [ ] **Step 1: Add the component id**

In the `component: { ... }` block, add `HrAttendance` after `MyAttendance`:

```ts
    MyAttendance: '' as AnyComponent,
    HrAttendance: '' as AnyComponent
```

- [ ] **Step 2: Add the string ids**

In the `string: { ... }` block, add after the last existing key (`Type`):

```ts
    Type: '' as IntlString,
    HrAttendance: '' as IntlString,
    AllEmployees: '' as IntlString,
    Individual: '' as IntlString,
    DaysPresent: '' as IntlString,
    OfficeHours: '' as IntlString,
    WfhHours: '' as IntlString,
    InNow: '' as IntlString
```

- [ ] **Step 3: Regenerate types + verify compile**

Run: `cd plugins/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:validate`
Expected: `Validate time: ...` with no TS errors (this re-emits `types/index.d.ts` so downstream svelte-check sees the new ids).

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts
git commit -m "yg-timesheet: HrAttendance component id + HR attendance report string ids"
```

---

## Task 4: Lang strings (`lang/en.json` + `lang/ru.json`)

Provide the 7 new strings in both locales. Gate: the `Locales are equal` parity test.

**Files:**
- Modify: `plugins/yg-timesheet-assets/lang/en.json`
- Modify: `plugins/yg-timesheet-assets/lang/ru.json`

**Interfaces:**
- Consumes: the string keys from Task 3 (must match exactly).

- [ ] **Step 1: Add the English keys**

In `lang/en.json`, change the last string line `"Type": "Type"` to add a trailing comma and append:

```json
    "Type": "Type",
    "HrAttendance": "Attendance",
    "AllEmployees": "All employees",
    "Individual": "Individual",
    "DaysPresent": "Days present",
    "OfficeHours": "Office hrs",
    "WfhHours": "WFH hrs",
    "InNow": "In now"
```

- [ ] **Step 2: Run the parity test to verify it fails**

Run: `cd plugins/yg-timesheet-assets && npx jest`
Expected: FAIL — `Locales are equal` reports keys present in en missing from ru.

- [ ] **Step 3: Add the Russian keys**

In `lang/ru.json`, change the last string line `"Type": "Тип"` to add a trailing comma and append:

```json
    "Type": "Тип",
    "HrAttendance": "Посещаемость",
    "AllEmployees": "Все сотрудники",
    "Individual": "Сотрудник",
    "DaysPresent": "Дней присутствия",
    "OfficeHours": "Часы в офисе",
    "WfhHours": "Часы удалённо",
    "InNow": "На смене"
```

- [ ] **Step 4: Run the parity test to verify it passes**

Run: `cd plugins/yg-timesheet-assets && npx jest`
Expected: PASS — `Locales are equal`.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-assets/lang/en.json plugins/yg-timesheet-assets/lang/ru.json
git commit -m "yg-timesheet: en/ru strings for the HR attendance report"
```

---

## Task 5: HR app special (`models/yg-timesheet/src/index.ts`)

Register the `attendance` special on the HR app's `navigatorModel.specials`. Gate: the model package builds.

**Files:**
- Modify: `models/yg-timesheet/src/index.ts`

**Interfaces:**
- Consumes: `ygTimesheet.component.HrAttendance`, `ygTimesheet.string.HrAttendance` (Task 3); `ygTimesheet.icon.Timesheet` (existing).

- [ ] **Step 1: Add the special**

In the `Human Resource` app `createDoc` (the one with `label: ygTimesheet.string.HumanResource`), the `specials` array currently holds `timesheets`, `overview`, then `roster` (with `position: 'bottom'`). Insert the `attendance` special **between `overview` and `roster`**:

```ts
          {
            id: 'overview',
            label: ygTimesheet.string.HrOverview,
            icon: hr.icon.Structure,
            component: ygTimesheet.component.HrOverview,
            accessLevel: AccountRole.DocGuest,
            position: 'top'
          },
          {
            id: 'attendance',
            label: ygTimesheet.string.HrAttendance,
            icon: ygTimesheet.icon.Timesheet,
            component: ygTimesheet.component.HrAttendance,
            accessLevel: AccountRole.DocGuest,
            position: 'top'
          },
          {
            id: 'roster',
            label: ygTimesheet.string.HrRoster,
            icon: contact.icon.Person,
            component: ygTimesheet.component.HrRoster,
            accessLevel: AccountRole.Owner,
            position: 'bottom'
          }
```

- [ ] **Step 2: Verify the model package builds**

Run: `cd models/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build`
Expected: `Transpile time: ...`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add models/yg-timesheet/src/index.ts
git commit -m "yg-timesheet model: register the HR Attendance special"
```

---

## Task 6: HR Attendance page (`HrAttendance.svelte` + registration)

The report page: mode switch, date range (period modes), employee picker (Individual), export, and the three tables. Native HTML + `yg-table` classes, mirroring HrOverview. Gate: svelte-check + build.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/HrAttendance.svelte`
- Modify: `plugins/yg-timesheet-resources/src/index.ts`

**Interfaces:**
- Consumes: `todayBoard`/`attendanceSummary`/`individualLog` + types (Task 1); the three export fns (Task 2); `ygTimesheet.class.AttendanceSession` + `AttendanceMode` (existing); `ygTimesheet.string.*` (Tasks 3-4); `formatHours` from `utils/week`, `localMidnight` from `utils/attendance`, `weekRange`/`localDayKey` from `utils/week`.
- Produces: the `HrAttendance` component resource registered under `ygTimesheet.component.HrAttendance`.

- [ ] **Step 1: Write the component**

Create `plugins/yg-timesheet-resources/src/components/HrAttendance.svelte`:

```svelte
<!--
// Copyright © 2026 YoungGlobes
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<!--
  HR attendance report: one page, three modes (Today live board / All-employees summary /
  Individual session log). Reads AttendanceSession directly from the shared core.space.Workspace
  (world-readable; no HR projection). Read-only. Excel export per mode. Mirrors HrOverview chrome.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import contact, { formatName, getCurrentEmployee, type Employee, type Person } from '@hcengineering/contact'
  import { EmployeeBox } from '@hcengineering/contact-resources'
  import core, { type Ref } from '@hcengineering/core'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery } from '@hcengineering/presentation'
  import ui, { Label } from '@hcengineering/ui'
  import ygTimesheet, { type AttendanceSession } from '@hcengineering/yg-timesheet'
  import {
    todayBoard,
    attendanceSummary,
    individualLog,
    type SessionLike,
    type EmpRef
  } from '../utils/hr-attendance'
  import { exportTodayXlsx, exportSummaryXlsx, exportIndividualXlsx } from '../utils/hr-attendance-xlsx'
  import { ensureHrMembership } from '../utils/hrMembership'
  import { localMidnight } from '../utils/attendance'
  import { formatHours, localDayKey, weekRange } from '../utils/week'

  void ensureHrMembership()

  type Mode = 'today' | 'all' | 'individual'
  let mode: Mode = 'today'

  // Live clock so the Today board totals/open sessions tick.
  let nowMs = Date.now()
  let timer: ReturnType<typeof setInterval>
  onMount(() => {
    timer = setInterval(() => (nowMs = Date.now()), 1000)
  })
  onDestroy(() => clearInterval(timer))

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const fmt = (ms?: number): string => (ms !== undefined ? timeFmt.format(ms) : '-')

  // Date range (period modes). Defaults to this week (Monday .. today). yyyy-mm-dd native inputs.
  let fromKey = localDayKey(weekRange(Date.now()).start)
  let toKey = localDayKey(Date.now())
  $: fromMid = new Date(`${fromKey}T00:00:00`).getTime()
  $: toExcl = new Date(`${toKey}T00:00:00`).getTime() + 86_400_000 // inclusive `to`, exclusive query bound
  function thisWeek (): void {
    fromKey = localDayKey(weekRange(Date.now()).start)
    toKey = localDayKey(Date.now())
  }
  function thisMonth (): void {
    const d = new Date()
    fromKey = localDayKey(new Date(d.getFullYear(), d.getMonth(), 1).getTime())
    toKey = localDayKey(Date.now())
  }

  // EmployeeBox binds a Ref<Person>; the aggregation keys on Ref<Employee> (same _id). Keep the
  // bound value as Ref<Person> and cast at the individualLog / nameOf boundary.
  const me = getCurrentEmployee()
  let selectedEmployee: Ref<Person> | undefined = me as Ref<Person>
  $: selectedEmp = selectedEmployee as unknown as Ref<Employee> | undefined

  // Active employees -> EmpRef[] name source.
  const empQuery = createQuery()
  let employees: EmpRef[] = []
  let nameOf: Map<Ref<Employee>, string> = new Map()
  empQuery.query(contact.mixin.Employee, { active: true }, (res: Employee[]) => {
    employees = res.map((e) => ({ ref: e._id, name: formatName(e.name) }))
    nameOf = new Map(employees.map((e) => [e.ref, e.name]))
  })

  // The queried window: today for the board, else the selected range.
  $: todayMid = localMidnight(nowMs)
  $: queryFrom = mode === 'today' ? todayMid : fromMid
  $: queryTo = mode === 'today' ? todayMid + 86_400_000 : toExcl

  // Live sessions in the window (shared, world-readable space).
  const sessQuery = createQuery()
  let sessions: SessionLike[] = []
  $: sessQuery.query(
    ygTimesheet.class.AttendanceSession,
    { space: core.space.Workspace, date: { $gte: queryFrom, $lt: queryTo } },
    (res: AttendanceSession[]) => {
      sessions = res.map((s) => ({
        employee: s.employee,
        date: s.date,
        punchIn: s.punchIn,
        punchOut: s.punchOut,
        mode: s.mode,
        punchInNote: s.punchInNote,
        punchOutNote: s.punchOutNote
      }))
    }
  )

  $: todayRows = todayBoard(sessions, employees, todayMid, nowMs)
  $: summaryRows = attendanceSummary(sessions, employees, fromMid, toExcl, nowMs)
  $: individual = selectedEmp !== undefined
    ? individualLog(sessions, selectedEmp, fromMid, toExcl, nowMs)
    : { days: [], summary: { daysPresent: 0, totalMs: 0, officeMs: 0, wfhMs: 0 } }

  $: summaryTotals = summaryRows.reduce(
    (acc, r) => ({
      totalMs: acc.totalMs + r.totalMs,
      officeMs: acc.officeMs + r.officeMs,
      wfhMs: acc.wfhMs + r.wfhMs
    }),
    { totalMs: 0, officeMs: 0, wfhMs: 0 }
  )

  let exporting = false
  async function doExport (): Promise<void> {
    exporting = true
    try {
      if (mode === 'today') await exportTodayXlsx(todayRows)
      else if (mode === 'all') await exportSummaryXlsx(summaryRows, fromMid, toExcl)
      else await exportIndividualXlsx(individual, (selectedEmp !== undefined ? nameOf.get(selectedEmp) : undefined) ?? 'employee', fromMid, toExcl)
    } catch (err: any) {
      await setPlatformStatus(unknownError(err))
    } finally {
      exporting = false
    }
  }
</script>

<div class="yg-page">
  <div class="yg-head">
    <h1 class="yg-title"><Label label={ygTimesheet.string.HrAttendance} /></h1>
    <div class="yg-weekbar">
      <div class="att-seg" role="group">
        <button class="att-seg__opt" class:is-on={mode === 'today'} on:click={() => (mode = 'today')}>
          <Label label={ygTimesheet.string.Today} />
        </button>
        <button class="att-seg__opt" class:is-on={mode === 'all'} on:click={() => (mode = 'all')}>
          <Label label={ygTimesheet.string.AllEmployees} />
        </button>
        <button class="att-seg__opt" class:is-on={mode === 'individual'} on:click={() => (mode = 'individual')}>
          <Label label={ygTimesheet.string.Individual} />
        </button>
      </div>

      {#if mode !== 'today'}
        <span class="att-range">
          <input class="att-date" type="date" bind:value={fromKey} />
          <span class="att-range__sep">-</span>
          <input class="att-date" type="date" bind:value={toKey} />
          <button class="yg-btn" on:click={thisWeek}><Label label={ui.string.Today} /></button>
          <button class="yg-btn" on:click={thisMonth}><Label label={ygTimesheet.string.Month} /></button>
        </span>
      {/if}

      {#if mode === 'individual'}
        <span class="att-empbox">
          <EmployeeBox
            label={ygTimesheet.string.Employee}
            bind:value={selectedEmployee}
            allowDeselect={false}
            kind="regular"
          />
        </span>
      {/if}

      <span class="yg-weekbar__spacer" />
      <button class="yg-btn yg-btn--primary" disabled={exporting} on:click={doExport}>
        <Label label={ygTimesheet.string.Export} />
      </button>
    </div>
  </div>

  <div class="yg-scroll">
    {#if mode === 'today'}
      <table class="yg-table">
        <thead>
          <tr>
            <th class="left"><Label label={ygTimesheet.string.Employee} /></th>
            <th><Label label={ygTimesheet.string.Status} /></th>
            <th><Label label={ygTimesheet.string.FirstIn} /></th>
            <th><Label label={ygTimesheet.string.LastOut} /></th>
            <th><Label label={ygTimesheet.string.Sessions} /></th>
            <th><Label label={ygTimesheet.string.TotalHours} /></th>
            <th><Label label={ygTimesheet.string.Type} /></th>
          </tr>
        </thead>
        <tbody>
          {#each todayRows as r (r.employee)}
            <tr class="yg-row">
              <td class="left">{r.name}</td>
              <td>
                {#if r.status === 'in'}
                  <span class="att-live"><span class="att-dot" /><Label label={ygTimesheet.string.InNow} /></span>
                {:else}
                  <Label label={ygTimesheet.string.Out} />
                {/if}
              </td>
              <td>{fmt(r.firstIn)}</td>
              <td>{fmt(r.lastOut)}</td>
              <td>{r.sessions}</td>
              <td class="bold">{formatHours(r.totalMs / 3600000)}</td>
              <td><Label label={r.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} /></td>
            </tr>
          {:else}
            <tr><td colspan={7} class="yg-empty"><Label label={ygTimesheet.string.NoData} /></td></tr>
          {/each}
        </tbody>
      </table>

    {:else if mode === 'all'}
      <table class="yg-table">
        <thead>
          <tr>
            <th class="left"><Label label={ygTimesheet.string.Employee} /></th>
            <th><Label label={ygTimesheet.string.DaysPresent} /></th>
            <th><Label label={ygTimesheet.string.TotalHours} /></th>
            <th><Label label={ygTimesheet.string.OfficeHours} /></th>
            <th><Label label={ygTimesheet.string.WfhHours} /></th>
          </tr>
        </thead>
        <tbody>
          {#each summaryRows as r (r.employee)}
            <tr class="yg-row">
              <td class="left">{r.name}</td>
              <td>{r.daysPresent}</td>
              <td class="bold">{formatHours(r.totalMs / 3600000)}</td>
              <td>{formatHours(r.officeMs / 3600000)}</td>
              <td>{formatHours(r.wfhMs / 3600000)}</td>
            </tr>
          {:else}
            <tr><td colspan={5} class="yg-empty"><Label label={ygTimesheet.string.NoData} /></td></tr>
          {/each}
        </tbody>
        <tfoot>
          <tr class="yg-totals">
            <td class="left"><Label label={ygTimesheet.string.Total} /></td>
            <td />
            <td class="bold">{formatHours(summaryTotals.totalMs / 3600000)}</td>
            <td>{formatHours(summaryTotals.officeMs / 3600000)}</td>
            <td>{formatHours(summaryTotals.wfhMs / 3600000)}</td>
          </tr>
        </tfoot>
      </table>

    {:else}
      <div class="att-summary">
        <span class="att-summary__k"><Label label={ygTimesheet.string.DaysPresent} />: <b>{individual.summary.daysPresent}</b></span>
        <span class="att-summary__k"><Label label={ygTimesheet.string.TotalHours} />: <b>{formatHours(individual.summary.totalMs / 3600000)}</b></span>
        <span class="att-summary__k"><Label label={ygTimesheet.string.OfficeHours} />: <b>{formatHours(individual.summary.officeMs / 3600000)}</b></span>
        <span class="att-summary__k"><Label label={ygTimesheet.string.WfhHours} />: <b>{formatHours(individual.summary.wfhMs / 3600000)}</b></span>
      </div>
      <table class="yg-table">
        <thead>
          <tr>
            <th class="left"><Label label={ygTimesheet.string.Date} /></th>
            <th><Label label={ygTimesheet.string.In} /></th>
            <th><Label label={ygTimesheet.string.Out} /></th>
            <th><Label label={ygTimesheet.string.Type} /></th>
            <th><Label label={ygTimesheet.string.Duration} /></th>
          </tr>
        </thead>
        <tbody>
          {#each individual.days as day (day.date)}
            {#each day.sessions as s, i (s.punchIn)}
              <tr class="yg-row">
                <td class="left">{i === 0 ? dateFmt.format(day.date) : ''}</td>
                <td>{timeFmt.format(s.punchIn)}{#if s.punchInNote}<span class="att-note"> · {s.punchInNote}</span>{/if}</td>
                <td>{#if s.punchOut !== undefined}{timeFmt.format(s.punchOut)}{#if s.punchOutNote}<span class="att-note"> · {s.punchOutNote}</span>{/if}{:else}-{/if}</td>
                <td><Label label={s.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} /></td>
                <td>{s.punchOut !== undefined ? formatHours((s.punchOut - s.punchIn) / 3600000) : '-'}</td>
              </tr>
            {/each}
          {:else}
            <tr><td colspan={5} class="yg-empty"><Label label={ygTimesheet.string.NoData} /></td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;

  .att-seg { display: inline-flex; padding: 3px; gap: 3px; background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 9px; }
  .att-seg__opt { appearance: none; border: 0; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 6px; background: transparent; color: var(--yg-text-dim); }
  .att-seg__opt:hover { color: var(--yg-text); }
  .att-seg__opt.is-on { background: var(--yg-ink); color: var(--yg-ink-fg); box-shadow: var(--yg-shadow); }

  .att-range { display: inline-flex; align-items: center; gap: 8px; }
  .att-range__sep { color: var(--yg-text-faint); }
  .att-date { appearance: none; font: inherit; font-size: 13px; color: var(--yg-text); background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 8px; padding: 5px 9px; }
  .att-empbox { display: inline-flex; align-items: center; }

  .att-live { display: inline-flex; align-items: center; gap: 6px; color: var(--yg-green); font-weight: 600; }
  .att-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--yg-green); }
  .att-note { color: var(--yg-text-faint); }

  .att-summary { display: flex; flex-wrap: wrap; gap: 18px; padding: 4px 2px 14px; font-size: 13px; color: var(--yg-text-dim); }
  .att-summary__k b { color: var(--yg-text); font-variant-numeric: tabular-nums; }
</style>
```

Note: `formatHours` takes **hours** (the timesheet code stores hours), so ms values are divided by `3600000` at each call site above. The XLSX layer instead takes ms and does the `/86_400_000` day-fraction conversion itself.

- [ ] **Step 2: Register the component in resources**

In `plugins/yg-timesheet-resources/src/index.ts`, add the import after the `MyAttendance` import:

```ts
import MyAttendance from './components/MyAttendance.svelte'
import HrAttendance from './components/HrAttendance.svelte'
```

Add `HrAttendance` to the `component` map in the default export (after `MyAttendance`):

```ts
    MyAttendance,
    HrAttendance
```

- [ ] **Step 3: Run svelte-check**

Run: `cd plugins/yg-timesheet-resources && npm run svelte-check 2>&1 | grep -i 'HrAttendance' || echo "no HrAttendance errors"`
Expected: `no HrAttendance errors`. (The 7 pre-existing `$lookup`/`attachedTo` errors in Timesheet/Approvals/HrTimesheet are unrelated.)

- [ ] **Step 4: Build the resources package + run jest**

Run: `cd plugins/yg-timesheet-resources && npm run build && npx jest`
Expected: build exits 0; jest passes (incl. `hr-attendance.test`).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/HrAttendance.svelte \
        plugins/yg-timesheet-resources/src/index.ts
git commit -m "yg-timesheet: HR Attendance report page + component registration"
```

---

## Task 7: Build images, upgrade workspace, smoke test

Model change (new HR special) ⇒ full 4-image rebuild + workspace upgrade. Gate: on-stack smoke test.

**Files:** none (build + deploy + verify).

**Preconditions:** free RAM (stop the running stack if needed); `nvm use 22`.

- [ ] **Step 1: Rebuild all four beta images**

```bash
bash /tmp/claude-1002/-home-karthi-0008-dev-client-projects-huly-migration/<session>/scratchpad/build-beta.sh
```

(Or recreate it: `rush build` → `dev/prod` `rushx package` → for each of `pods/front`, `pods/workspace`, `pods/server`, `dev/tool`: `rushx bundle` [+ `rushx package` for front] + `docker build -t yg-local/<name>:beta .`, with `NODE_OPTIONS=--max-old-space-size=6144` and `nvm use 22`.)
Expected: `docker images | grep yg-local` shows fresh timestamps on all four `:beta` tags.

- [ ] **Step 2: Deploy (redpanda-first) + upgrade + nginx restart**

From the huly-selfhost deploy dir:

```bash
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d redpanda
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d --force-recreate front workspace transactor
./run-tool-beta.sh upgrade-workspace testws
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
```

Expected: `upgrade-workspace done`; front HTTP 200 (`curl -s -o /dev/null -w '%{http_code}' http://localhost:8087/`).

- [ ] **Step 3: Smoke test in the browser**

Log in to http://localhost:8087 (workspace `testws`) as an **HR/Owner** user, open the **Human Resource** app, and verify:
- [ ] The **Attendance** special appears between Overview and Roster; clicking it opens the report.
- [ ] **Today** mode: employees who punched today appear with Status (In now / Out), First in, Last out, Sessions, Total, Type; an on-the-clock user shows "In now" and a live-ticking total.
- [ ] **All employees** mode: a date range (This week / This month buttons + From/To), one row per active employee (zeros for absentees), Days present / Total / Office / WFH, totals footer.
- [ ] **Individual** mode: an employee picker; a summary strip; a day-grouped session table; a single-day range shows just that day.
- [ ] **Export** in each mode downloads an `.xlsx` whose hours render as `h:mm` and sum.
- [ ] A non-HR user does not see the Attendance menu item (best-effort, same as the other HR specials).

- [ ] **Step 4: Confirm clean tree**

```bash
git status   # expect clean; Tasks 1-6 already committed
```

---

## Self-Review

**Spec coverage:**
- New `Attendance` HR special (DocGuest, ensureHrMembership) → Task 5 (registration) + Task 6 (`ensureHrMembership()`).
- Read `AttendanceSession` from shared `core.space.Workspace`, no projection → Task 6 (`sessQuery` on `core.space.Workspace`).
- Today live board (status/first/last/sessions/total/type, live) → Task 1 `todayBoard` + Task 6 today table + 1s timer.
- All-employees summary (Days present / Total / Office / WFH, totals footer, zeros for absentees) → Task 1 `attendanceSummary` + Task 6 all table + tfoot.
- Individual session log (grouped by day, summary strip, single-day) → Task 1 `individualLog` + Task 6 individual table + summary strip + EmployeeBox.
- Date range presets (This week / This month / custom From-To) → Task 6 `thisWeek`/`thisMonth` + native inputs. (Implemented as native date inputs + preset buttons rather than a `DropdownLabels` dropdown — functionally the spec's "presets + custom", simpler and robust.)
- Office/WFH split as hours → Task 1 `officeMs`/`wfhMs`; Task 6 columns; Task 2 export.
- Excel export per mode (write-excel-file, hours as TIME cells) → Task 2 + Task 6 `doExport`.
- Pure aggregation jest-tested (fixed clock) → Task 1 tests.
- svelte-check/tsc clean, en/ru parity → Tasks 3, 4, 6 gates.
- Full 4-image rebuild + upgrade-workspace → Task 7.
- LOCAL/beta only → Global Constraints.

**Placeholder scan:** no TBD/TODO; every code step carries full code. The only environment-specific item — the `build-beta.sh` path in Task 7 — carries a recreate-from-steps fallback.

**Type consistency:** `SessionLike`/`EmpRef`/`TodayRow`/`SummaryRow`/`IndividualLog` defined in Task 1 are consumed unchanged in Tasks 2 and 6; export fn names (`exportTodayXlsx`/`exportSummaryXlsx`/`exportIndividualXlsx`) match between Task 2 and Task 6; string ids added in Task 3 match the lang keys in Task 4 and the `<Label>` refs in Task 6; component id `HrAttendance` matches across Tasks 3, 5, 6. `formatHours` takes hours, so ms→hours (`/3600000`) at each Svelte call site; the XLSX layer takes ms and converts to day-fractions (`/86_400_000`) itself — noted to avoid a unit mismatch.
