# HR Employee Attendance Report — Design

**Date:** 2026-07-29 · **Branch:** `yg_beta` (LOCAL/beta only) · **Status:** design approved, spec for review

## Goal

Give HR a read-only attendance report inside the existing Human Resource app, covering three views on
one page: a live **Today** board (who is in), an **All employees** summary over a date range, and an
**Individual** session-level log. Each view is exportable to Excel with the same design as the timesheet
reports. Read-only reporting only — no editing of attendance, no approval.

## Placement

A new **`Attendance`** special in the `Human Resource` app (`ygTimesheet.app.HumanResource`), inserted as
the 4th navigator item: Timesheets · Overview · **Attendance** · Roster.

- `id: 'attendance'`, label `ygTimesheet.string.HrAttendance` ("Attendance"), component
  `ygTimesheet.component.HrAttendance`, `accessLevel: AccountRole.DocGuest`, `position: 'top'` — same
  registration shape as the `timesheets` / `overview` specials (`models/yg-timesheet/src/index.ts`).
- The page calls `ensureHrMembership()` on mount (Owner self-add), mirroring HrOverview/HrTimesheet. No
  in-component render gate (consistent with the other HR reports).

## Data approach

Read `AttendanceSession` **directly** from `core.space.Workspace` — the docs are world-readable and there
is **no server projection** for attendance (confirmed: `grep AttendanceSession server-plugins/` is empty),
unlike the timesheet HR report which needs the private `HrTimeEntry` projection. Aggregation is pure,
client-side, over the queried sessions.

- **Accepted limitation (beta):** because `AttendanceSession` lives in the shared world-readable space,
  the HR-app placement (`accessLevel: DocGuest` + `ensureHrMembership`) controls **menu visibility only**,
  not data access — any workspace user could technically query attendance. This matches the current
  self-service beta posture. Making attendance HR-private (private space + server projection, like
  `HrTimeEntry`) is a deliberate future option, out of scope for v1.

## The three modes (one page, segmented switch)

A single `HrAttendance.svelte` page with a segmented mode switch and mode-appropriate controls, styled with
the `yg-table.scss` design system (`.yg-table`, `.yg-seg`, `.yg-btn--primary`, `.yg-num`, `.yg-totals`).

### Mode: Today (live board)

Auto-updating (live query, no date control). One row per **active** employee who has at least one session
today. Columns:

| Employee | Status | First in | Last out | Sessions | Total hours | Type |
|---|---|---|---|---|---|---|
| name | `In now` / `Out` | first punch-in | last punch-out (or `-` while open) | count | live total | current/last Office/WFH chip |

- `Total hours` counts an open session live to `now`; `Status = In now` when an open session exists.
- Sorted by name. Empty state: `ygTimesheet.string.NoData`.

### Mode: All employees (date range)

One row per **active** employee, aggregated over the selected range. Columns:

| Employee | Days present | Total hours | Office hrs | WFH hrs |
|---|---|---|---|---|

- `Days present` = distinct local days in range with ≥1 session. `Office hrs + WFH hrs = Total hours`
  (split by each session's `mode`; an open session — only possible for today — counts live to `now`).
- Totals footer summing the numeric columns. Sorted by name. Employees with zero sessions in range are
  shown with zeros (so absences are visible).

### Mode: Individual (one employee + date range, or a single day)

Full session-level detail for one selected employee. A period summary strip on top
(`Days present · Total hours · Office hrs · WFH hrs`), then a table grouped by day, newest day first:

| Date | In | Out | Type | Duration |
|---|---|---|---|---|

- Every session is a row (In/Out times + optional notes shown as muted subtext), with a per-day subtotal
  row. A single-day selection (from = to) shows just that day's sessions.
- Empty state when the employee has no sessions in range.

### Controls

- **Mode switch:** a `.yg-seg` segmented control (Today / All employees / Individual).
- **Date range** (All employees + Individual): the Timesheet **Reports** preset pattern — a preset dropdown
  (This week / Last week / This month / Custom) resolving to a `[from, to)` window; "Custom" reveals two
  native `<input type="date">` fields. Not shown in Today mode.
- **Employee picker** (Individual only): `EmployeeBox` from `@hcengineering/contact-resources`.
- **Export** button (`.yg-btn--primary` with a download glyph): exports the current mode's full dataset.

## Aggregation library (pure, jest-tested)

New `plugins/yg-timesheet-resources/src/utils/hr-attendance.ts` — pure functions over the minimal
`AttendanceLike`-style shape (reuse `sessionDuration`, `dailyTotal`, `localMidnight` from `utils/attendance.ts`;
`localDayKey` from `utils/week.ts`). No platform/Svelte deps.

```ts
export interface EmpRef { ref: Ref<Employee>; name: string }

// One row for the Today board.
export interface TodayRow {
  employee: Ref<Employee>
  name: string
  status: 'in' | 'out'
  firstIn?: number
  lastOut?: number       // undefined while a session is open, or none closed
  sessions: number
  totalMs: number        // open session counts live to `now`
  mode?: AttendanceMode  // current (if in) or most-recent session's mode
}
export function todayBoard (sessions: SessionLike[], employees: EmpRef[], dayMidnight: number, now: number): TodayRow[]

// One row for the All-employees summary. officeMs + wfhMs === totalMs.
export interface SummaryRow {
  employee: Ref<Employee>
  name: string
  daysPresent: number
  totalMs: number
  officeMs: number
  wfhMs: number
}
export function attendanceSummary (sessions: SessionLike[], employees: EmpRef[], from: number, to: number, now: number): SummaryRow[]

// Individual session-level log, grouped by day (newest first) + a period summary.
export interface DayGroup { date: number; sessions: SessionLike[]; subtotalMs: number }
export interface IndividualLog {
  days: DayGroup[]
  summary: { daysPresent: number; totalMs: number; officeMs: number; wfhMs: number }
}
export function individualLog (sessions: SessionLike[], employee: Ref<Employee>, from: number, to: number, now: number): IndividualLog
```

Where `SessionLike = { employee: Ref<Employee>; date: number; punchIn: number; punchOut?: number; mode: AttendanceMode }`
(structurally the real `AttendanceSession`). All range filters are `[from, to)` on the session's `date`
(local-midnight) key. `officeMs`/`wfhMs` derive from each session's `mode`.

`HrAttendance.svelte` supplies the data: a `createQuery` over
`AttendanceSession { space: core.space.Workspace }` (date-range filtered for period modes; `date === today`
for the live board) and a `contact.mixin.Employee { active: true }` query for the `EmpRef[]` name map.

## Excel export

New `plugins/yg-timesheet-resources/src/utils/hr-attendance-xlsx.ts` using `write-excel-file` (same library
as the timesheet reports), one function per mode:

```ts
export async function exportTodayXlsx (rows: TodayRow[]): Promise<void>
export async function exportSummaryXlsx (rows: SummaryRow[], from: number, to: number): Promise<void>
export async function exportIndividualXlsx (log: IndividualLog, employeeName: string, from: number, to: number): Promise<void>
```

- Hours are written as Excel **TIME** cells (`{ value: ms / 86_400_000, type: Number, format: '[h]:mm' }`,
  i.e. a fraction of a day) so they display `1:30` and sum in-sheet — the exact `hoursCell` idiom from
  `hr-xlsx.ts`.
- Times (First in / Last out / In / Out) export as `String` (formatted `HH:MM`) or Date-time cells; dates as
  `Date` cells (`dd-mm-yyyy`). `fileName` triggers the browser download directly (no Blob/anchor code).
- Filenames: `hr-attendance-today-YYYY-MM-DD.xlsx`, `hr-attendance-summary-<from>_<to>.xlsx`,
  `hr-attendance-<employee>-<from>_<to>.xlsx`.

## Non-goals (v1)

No editing/correcting attendance, no approval/lock, no server projection or private-space privacy, no
leave/holiday overlay, no expected-vs-actual/shortfall target (attendance has no 8h target like timesheets),
no per-department grouping, no charts, no CSV (Excel only, matching the ask).

## Testing & delivery

- Pure `hr-attendance.ts` fully jest-tested with **fixed-clock** fixtures (no `Date.now()`), mirroring
  `utils/__tests__/attendance.test.ts`: today board (in/out status, live totals, first/last), summary
  (days present, office/wfh split summing to total, zero-session employees, range boundaries), individual
  (day grouping, subtotals, single-day, out-of-range excluded).
- `svelte-check` + `tsc` clean on the resources package; en/ru locale parity for new strings.
- **Delivery = full 4-image rebuild + `upgrade-workspace`** — adding a special to the HR app's
  `navigatorModel` is a model change (plus new `component`/`string` ids), so it is not front-only. Client
  webpack needs `NODE_OPTIONS=--max-old-space-size=6144`; deploy redpanda-first; restart nginx after
  recreating front.
- LOCAL/beta only; no `yg_develop` merge.
