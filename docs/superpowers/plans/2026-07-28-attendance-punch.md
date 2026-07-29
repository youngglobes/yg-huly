# Attendance (Punch In/Out) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new self-service `Attendance` app to the YG portal where an employee punches in/out multiple times a day, each session tagged Office or WFH with an optional note, and reviews their own session history.

**Architecture:** A new top-level `Attendance` workbench app is registered inside the existing `yg-timesheet` packages (same pattern the HR app already uses — no new plugin). Sessions persist as one `AttendanceSession` doc per punch-in/out in the existing `yg-timesheet` domain, written client-side into the shared `core.space.Workspace`. All non-trivial date/duration/mode math lives in a pure, jest-tested `utils/attendance.ts`; the single `MyAttendance.svelte` page reads sessions with a live query, drives writes with `createDoc`/`updateDoc`, and renders with the existing `.yg-*` design system.

**Tech Stack:** TypeScript, Huly platform model (`@hcengineering/model`), Svelte 3 + `@hcengineering/presentation` live queries, jest (ts-jest), SCSS (`yg-table.scss` tokens).

## Global Constraints

- **Branch:** `yg_beta` only. NEVER merge to `yg_develop` (CI auto-deploys it) — LOCAL/beta demo only.
- **Version pin:** Huly `v0.7.426`. Do not bump any `@hcengineering/*` versions.
- **No em-dashes** anywhere — code, comments, copy, commit messages. Use `-` or `·`.
- **Model change ⇒ full rebuild:** adding a model class (`AttendanceSession`) and an app (`Attendance`) requires a **full 4-image rebuild + `upgrade-workspace`**, not a front-only deploy.
- **Client webpack heap:** builds set `NODE_OPTIONS=--max-old-space-size=6144` (Node default ~2GB OOMs). Baked into `build-beta.sh`.
- **Node:** `nvm use 22` before any build.
- **Docs use `core.space.Workspace`** for these docs (same as `Timesheet`) — no new space, no migration entry (the app doc is purely additive and applied by `createModel` on upgrade; only the HR app needed a migration, and only to *hide* the stock app).
- **Lang parity:** every string key added to `lang/en.json` MUST also exist in `lang/ru.json` — the `Locales are equal` jest test enforces it.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugins/yg-timesheet-resources/src/utils/attendance.ts` | **New.** Pure helpers: duration, daily total, group-by-day, next-mode, find-open-session, local-midnight, format-duration. No queries/UI. |
| `plugins/yg-timesheet-resources/src/utils/__tests__/attendance.test.ts` | **New.** Jest unit tests for the above. |
| `plugins/yg-timesheet/src/index.ts` | **Modify.** Add `AttendanceMode` type + `AttendanceSession` interface, and the class / app / component / string / resolver ids. |
| `plugins/yg-timesheet-assets/lang/en.json` | **Modify.** English strings for the new ids. |
| `plugins/yg-timesheet-assets/lang/ru.json` | **Modify.** Russian strings (same keys). |
| `models/yg-timesheet/src/index.ts` | **Modify.** `TAttendanceSession` model class + register it in `createModel`; register the `Attendance` app with its `My Attendance` special + location resolver. |
| `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte` | **New.** The unified My Attendance page. |
| `plugins/yg-timesheet-resources/src/index.ts` | **Modify.** Register the `MyAttendance` component and the `resolveAttendanceLocation` resolver. |

Task order: **1** (pure lib, independent) → **2** (plugin ids) → **3** (lang) → **4** (model) → **5** (page) → **6** (build + deploy + smoke test). Tasks 2–5 each build on the prior one's ids.

---

## Task 1: Pure attendance helpers (`utils/attendance.ts`)

Pure, dependency-free date/duration/mode math — the testable core, done first via TDD. Works on a minimal structural shape so it needs nothing from the model or plugin ids.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/attendance.ts`
- Test: `plugins/yg-timesheet-resources/src/utils/__tests__/attendance.test.ts`

**Interfaces:**
- Consumes: nothing (plain TS).
- Produces (later tasks import these):
  - `type AttendanceMode = 'office' | 'wfh'`
  - `interface AttendanceLike { punchIn: number; punchOut?: number; mode: AttendanceMode }`
  - `localMidnight(ms: number): number`
  - `sessionDuration(s: AttendanceLike, now: number): number`
  - `findOpenSession<T extends AttendanceLike>(sessions: T[]): T | undefined`
  - `dailyTotal(sessions: AttendanceLike[], now: number): number`
  - `nextMode(todays: AttendanceLike[]): AttendanceMode`
  - `formatDuration(ms: number): string`
  - `groupByDay<T extends { date: number, punchIn: number }>(sessions: T[]): Array<{ date: number, sessions: T[] }>`

- [ ] **Step 1: Write the failing test**

Create `plugins/yg-timesheet-resources/src/utils/__tests__/attendance.test.ts`:

```ts
import {
  localMidnight,
  sessionDuration,
  findOpenSession,
  dailyTotal,
  nextMode,
  formatDuration,
  groupByDay,
  type AttendanceLike
} from '../attendance'

// Fixed clock: 2026-07-28 14:30 local. No Date.now() anywhere — every value is explicit.
const now = new Date(2026, 6, 28, 14, 30, 0).getTime()
const mid = new Date(2026, 6, 28, 0, 0, 0).getTime()
const h = (hour: number, min = 0): number => new Date(2026, 6, 28, hour, min, 0).getTime()

describe('localMidnight', () => {
  test('collapses any instant to that local day 00:00', () => {
    expect(localMidnight(h(14, 30))).toBe(mid)
    expect(localMidnight(h(0, 0))).toBe(mid)
    expect(localMidnight(h(23, 59))).toBe(mid)
  })
})

describe('sessionDuration', () => {
  test('closed session = out - in', () => {
    expect(sessionDuration({ punchIn: h(9), punchOut: h(11), mode: 'office' }, now)).toBe(2 * 3600_000)
  })
  test('open session is measured to now', () => {
    expect(sessionDuration({ punchIn: h(14), mode: 'wfh' }, now)).toBe(30 * 60_000)
  })
  test('never negative', () => {
    expect(sessionDuration({ punchIn: h(15), punchOut: h(14), mode: 'office' }, now)).toBe(0)
  })
})

describe('findOpenSession', () => {
  const closed: AttendanceLike = { punchIn: h(9), punchOut: h(10), mode: 'office' }
  const open: AttendanceLike = { punchIn: h(14), mode: 'wfh' }
  test('returns the session with no punchOut', () => {
    expect(findOpenSession([closed, open])).toBe(open)
  })
  test('undefined when all sessions are closed', () => {
    expect(findOpenSession([closed])).toBeUndefined()
  })
  test('earliest open wins if several are open', () => {
    const early: AttendanceLike = { punchIn: h(12), mode: 'office' }
    expect(findOpenSession([open, early])).toBe(early)
  })
})

describe('dailyTotal', () => {
  test('sums closed durations plus the live open session', () => {
    const sessions: AttendanceLike[] = [
      { punchIn: h(9), punchOut: h(11), mode: 'office' }, // 2h
      { punchIn: h(14), mode: 'wfh' } //                     0.5h live
    ]
    expect(dailyTotal(sessions, now)).toBe(2.5 * 3600_000)
  })
  test('empty day is zero', () => {
    expect(dailyTotal([], now)).toBe(0)
  })
})

describe('nextMode', () => {
  test('office when there are no sessions today', () => {
    expect(nextMode([])).toBe('office')
  })
  test('mirrors the most recent session today', () => {
    const sessions: AttendanceLike[] = [
      { punchIn: h(9), punchOut: h(10), mode: 'office' },
      { punchIn: h(13), punchOut: h(14), mode: 'wfh' }
    ]
    expect(nextMode(sessions)).toBe('wfh')
  })
  test('ignores the order of the input array', () => {
    const sessions: AttendanceLike[] = [
      { punchIn: h(13), mode: 'wfh' },
      { punchIn: h(9), mode: 'office' }
    ]
    expect(nextMode(sessions)).toBe('wfh')
  })
})

describe('formatDuration', () => {
  test('hours with zero-padded minutes', () => {
    expect(formatDuration(2 * 3600_000 + 5 * 60_000)).toBe('2h 05m')
  })
  test('sub-minute rounds down to 0h 00m', () => {
    expect(formatDuration(59_000)).toBe('0h 00m')
  })
})

describe('groupByDay', () => {
  const d28 = new Date(2026, 6, 28).getTime()
  const d27 = new Date(2026, 6, 27).getTime()
  test('groups by date, newest day first, sessions ascending by punchIn', () => {
    const rows = [
      { date: d27, punchIn: h(9), mode: 'office' as const },
      { date: d28, punchIn: h(13), mode: 'wfh' as const },
      { date: d28, punchIn: h(9), mode: 'office' as const }
    ]
    const g = groupByDay(rows)
    expect(g.map((x) => x.date)).toEqual([d28, d27])
    expect(g[0].sessions.map((s) => s.punchIn)).toEqual([h(9), h(13)])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd plugins/yg-timesheet-resources && npx jest attendance.test`
Expected: FAIL — `Cannot find module '../attendance'`.

- [ ] **Step 3: Write the minimal implementation**

Create `plugins/yg-timesheet-resources/src/utils/attendance.ts`:

```ts
//
// YoungGlobes: pure attendance helpers (Attendance module, Phase 1d).
//
// Date / duration / mode math the My Attendance page drives. No queries, no
// client, no Svelte — just plain functions over a minimal session shape, so it
// is fully unit-testable (see __tests__/attendance.test.ts). The real
// AttendanceSession doc is structurally compatible with AttendanceLike.
//
export type AttendanceMode = 'office' | 'wfh'

/** The minimal shape the helpers need from an AttendanceSession doc. */
export interface AttendanceLike {
  punchIn: number
  punchOut?: number
  mode: AttendanceMode
}

/** Local midnight (ms) of the day containing `ms` — the AttendanceSession.date key. */
export function localMidnight (ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Duration of a session in ms. An open session (no punchOut) is measured to `now`. */
export function sessionDuration (s: AttendanceLike, now: number): number {
  const end = s.punchOut ?? now
  return Math.max(0, end - s.punchIn)
}

/**
 * The single open session (no punchOut), or undefined. The UI enforces at most one
 * open session; if several are somehow open the earliest punchIn wins so Punch Out
 * closes the oldest.
 */
export function findOpenSession<T extends AttendanceLike> (sessions: T[]): T | undefined {
  return sessions
    .filter((s) => s.punchOut === undefined)
    .sort((a, b) => a.punchIn - b.punchIn)[0]
}

/** Sum of session durations for a set (typically one day). Open sessions count live to `now`. */
export function dailyTotal (sessions: AttendanceLike[], now: number): number {
  return sessions.reduce((sum, s) => sum + sessionDuration(s, now), 0)
}

/**
 * Mode to pre-select for the next punch-in: the most recent session's mode today,
 * else 'office'. Sticky within the day, resets to office each new day (the caller
 * passes only today's sessions). Order-independent.
 */
export function nextMode (todays: AttendanceLike[]): AttendanceMode {
  if (todays.length === 0) return 'office'
  return [...todays].sort((a, b) => b.punchIn - a.punchIn)[0].mode
}

/** Format an ms duration as "Hh MMm" (e.g. "2h 05m"); under a minute reads "0h 00m". */
export function formatDuration (ms: number): string {
  const totalMin = Math.floor(ms / 60000)
  const hrs = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  return `${hrs}h ${String(mins).padStart(2, '0')}m`
}

/** Group sessions by their `date` (local-midnight) key: newest day first, sessions ascending by punchIn. */
export function groupByDay<T extends { date: number, punchIn: number }> (
  sessions: T[]
): Array<{ date: number, sessions: T[] }> {
  const byDate = new Map<number, T[]>()
  for (const s of sessions) {
    const arr = byDate.get(s.date) ?? []
    arr.push(s)
    byDate.set(s.date, arr)
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([date, rows]) => ({ date, sessions: [...rows].sort((x, y) => x.punchIn - y.punchIn) }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd plugins/yg-timesheet-resources && npx jest attendance.test`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/attendance.ts \
        plugins/yg-timesheet-resources/src/utils/__tests__/attendance.test.ts
git commit -m "yg-timesheet: pure attendance helpers (duration/mode/grouping) + tests"
```

---

## Task 2: Plugin ids & types (`plugins/yg-timesheet/src/index.ts`)

Add the `AttendanceSession` doc type plus the class / app / component / string / resolver ids the model and resources reference. This package has no jest tests; the gate is a clean TypeScript build.

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts`

**Interfaces:**
- Consumes: existing `Doc`, `Ref`, `Timestamp`, `Employee`, `Class`, `Asset`, `IntlString`, `AnyComponent`, `Location`, `ResolvedLocation` imports already at the top of this file.
- Produces (Tasks 3–5 reference these):
  - `ygTimesheet.class.AttendanceSession`, `ygTimesheet.app.Attendance`, `ygTimesheet.component.MyAttendance`
  - `ygTimesheet.resolver.AttendanceLocation`
  - `ygTimesheet.string.{Attendance, MyAttendance, PunchIn, PunchOut, Office, WFH, AddNote, In, Out, Duration, History, TodaysSessions, NoSessionsToday, NoSessionsOnDate}`
  - `AttendanceSession`, `AttendanceMode` exported types

- [ ] **Step 1: Add the type + interface**

In `plugins/yg-timesheet/src/index.ts`, after the `HrTimeEntry` interface (ends at the line before `export const ygTimesheetId`), add:

```ts
/** Office vs work-from-home, set at punch-in and immutable thereafter. */
export type AttendanceMode = 'office' | 'wfh'

/**
 * One attendance session — a punch-in, later closed by a punch-out. Client-written,
 * immutable in the UI (v1): the only writes are create (punch in) and set punchOut/
 * punchOutNote (punch out). Duration is derived (punchOut - punchIn), never stored.
 */
export interface AttendanceSession extends Doc {
  employee: Ref<Employee>
  date: Timestamp // local midnight (ms) of the punch-in day — for day grouping/history
  punchIn: Timestamp // full ms timestamp of punch-in
  punchInNote?: string // optional note captured at punch-in
  mode: AttendanceMode // set at punch-in; immutable
  punchOut?: Timestamp // full ms timestamp of punch-out; absent while the session is open
  punchOutNote?: string // optional note captured at punch-out
}
```

- [ ] **Step 2: Register the class id**

In the `class: { ... }` block of the `plugin(...)` call, add after `HrTimeEntry`:

```ts
    HrTimeEntry: '' as Ref<Class<HrTimeEntry>>,
    AttendanceSession: '' as Ref<Class<AttendanceSession>>
```

(Add the comma after the `HrTimeEntry` line; `AttendanceSession` becomes the last entry.)

- [ ] **Step 3: Register the app + component ids**

In the `app: { ... }` block, add `Attendance`:

```ts
  app: {
    Timesheet: '' as Ref<Doc>,
    HumanResource: '' as Ref<Doc>,
    Attendance: '' as Ref<Doc>
  },
```

In the `component: { ... }` block, add `MyAttendance` after `Dashboard`:

```ts
    Dashboard: '' as AnyComponent,
    MyAttendance: '' as AnyComponent
```

- [ ] **Step 4: Register the string ids**

In the `string: { ... }` block, add these keys after `PriorityWatch`:

```ts
    PriorityWatch: '' as IntlString,
    Attendance: '' as IntlString,
    MyAttendance: '' as IntlString,
    PunchIn: '' as IntlString,
    PunchOut: '' as IntlString,
    Office: '' as IntlString,
    WFH: '' as IntlString,
    AddNote: '' as IntlString,
    In: '' as IntlString,
    Out: '' as IntlString,
    Duration: '' as IntlString,
    History: '' as IntlString,
    TodaysSessions: '' as IntlString,
    NoSessionsToday: '' as IntlString,
    NoSessionsOnDate: '' as IntlString
```

- [ ] **Step 5: Register the location resolver id**

In the `resolver: { ... }` block, add `AttendanceLocation`:

```ts
  resolver: {
    Location: '' as Resource<(loc: Location) => Promise<ResolvedLocation | undefined>>,
    AttendanceLocation: '' as Resource<(loc: Location) => Promise<ResolvedLocation | undefined>>
  }
```

- [ ] **Step 6: Build the plugin package to verify types compile**

Run: `cd plugins/yg-timesheet && npx tsc --noEmit -p tsconfig.json`
Expected: exits 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts
git commit -m "yg-timesheet: AttendanceSession type + Attendance app/class/component/string/resolver ids"
```

---

## Task 3: Lang strings (`lang/en.json` + `lang/ru.json`)

Provide translations for every new string id. Gate: the `Locales are equal` parity test.

**Files:**
- Modify: `plugins/yg-timesheet-assets/lang/en.json`
- Modify: `plugins/yg-timesheet-assets/lang/ru.json`

**Interfaces:**
- Consumes: the string keys defined in Task 2 (must match exactly).
- Produces: runtime text for `<Label label={ygTimesheet.string.*}/>` in Task 5.

- [ ] **Step 1: Write the failing parity test run**

First add the English keys. In `plugins/yg-timesheet-assets/lang/en.json`, change the last existing line `"PriorityWatch": "Priority watch"` to add a trailing comma and append the new keys before the closing `}` of the `"string"` object:

```json
    "PriorityWatch": "Priority watch",
    "Attendance": "Attendance",
    "MyAttendance": "My Attendance",
    "PunchIn": "Punch In",
    "PunchOut": "Punch Out",
    "Office": "Office",
    "WFH": "WFH",
    "AddNote": "Add a note (optional)",
    "In": "In",
    "Out": "Out",
    "Duration": "Duration",
    "History": "History",
    "TodaysSessions": "Today's sessions",
    "NoSessionsToday": "No sessions yet today",
    "NoSessionsOnDate": "No sessions on this day"
```

- [ ] **Step 2: Run the parity test to verify it fails**

Run: `cd plugins/yg-timesheet-assets && npx jest`
Expected: FAIL — `Locales are equal` reports keys present in `en` but missing in `ru`.

- [ ] **Step 3: Add the matching Russian keys**

In `plugins/yg-timesheet-assets/lang/ru.json`, change the last existing line `"PriorityWatch": "Приоритетные задачи"` to add a trailing comma and append:

```json
    "PriorityWatch": "Приоритетные задачи",
    "Attendance": "Посещаемость",
    "MyAttendance": "Моя посещаемость",
    "PunchIn": "Отметка прихода",
    "PunchOut": "Отметка ухода",
    "Office": "Офис",
    "WFH": "Удалённо",
    "AddNote": "Добавить заметку (необязательно)",
    "In": "Приход",
    "Out": "Уход",
    "Duration": "Длительность",
    "History": "История",
    "TodaysSessions": "Сегодняшние сессии",
    "NoSessionsToday": "Сегодня ещё нет сессий",
    "NoSessionsOnDate": "Нет сессий за этот день"
```

- [ ] **Step 4: Run the parity test to verify it passes**

Run: `cd plugins/yg-timesheet-assets && npx jest`
Expected: PASS — `Locales are equal`.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-assets/lang/en.json plugins/yg-timesheet-assets/lang/ru.json
git commit -m "yg-timesheet: en/ru strings for the Attendance app"
```

---

## Task 4: Model class + app registration (`models/yg-timesheet/src/index.ts`)

Define the `AttendanceSession` model class and register the `Attendance` app (one `My Attendance` special + location resolver). No migration entry: the app doc is additive and applied by `createModel` on `upgrade-workspace`, and the docs reuse `core.space.Workspace` (no new space). `models/all` already wires `ygTimesheetModel`, so nothing there changes.

**Files:**
- Modify: `models/yg-timesheet/src/index.ts`

**Interfaces:**
- Consumes: `ygTimesheet.class.AttendanceSession`, `ygTimesheet.app.Attendance`, `ygTimesheet.component.MyAttendance`, `ygTimesheet.resolver.AttendanceLocation`, `ygTimesheet.string.{Attendance,MyAttendance}` (Task 2); `AttendanceSession`, `AttendanceMode` types (Task 2).
- Produces: the persisted model class + app the running workspace exposes.

- [ ] **Step 1: Import the new type**

In the `import ygTimesheet, { ... } from '@hcengineering/yg-timesheet'` block at the top of the file, add `type AttendanceSession` (keep the list alphabetical-ish, matching the existing style):

```ts
import ygTimesheet, {
  ygTimesheetId,
  type AttendanceSession,
  type DayStatus,
  type HrTimeEntry,
  type ProjectApprovers,
  type TaskStatus,
  type Timesheet,
  type TimesheetApproval,
  type TimesheetDay,
  type TimesheetLine,
  type TimesheetTask
} from '@hcengineering/yg-timesheet'
```

- [ ] **Step 2: Define the model class**

After the `THrTimeEntry` class (ends `}` before `export function createModel`), add:

```ts
@Model(ygTimesheet.class.AttendanceSession, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TAttendanceSession extends TDoc implements AttendanceSession {
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) employee!: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) date!: Timestamp
  @Prop(TypeDate(), core.string.Object) punchIn!: Timestamp
  @Prop(TypeString(), core.string.Object) punchInNote?: string
  @Prop(TypeString(), core.string.Object) mode!: AttendanceMode
  @Prop(TypeDate(), core.string.Object) punchOut?: Timestamp
  @Prop(TypeString(), core.string.Object) punchOutNote?: string
}
```

Note: `AttendanceMode` is a string union; persist it with `TypeString()` (same idiom `TTimesheetTask.status: TaskStatus` uses).

- [ ] **Step 3: Register the class in `createModel`**

In `createModel`, extend the `builder.createModel(...)` call to include the new class:

```ts
  builder.createModel(
    TTimesheet, TTimesheetDay, TTimesheetTask, TTimesheetApproval, TProjectApprovers, THrTimeEntry, TAttendanceSession
  )
```

- [ ] **Step 4: Register the Attendance app**

In `createModel`, after the `builder.createDoc(... ygTimesheet.app.HumanResource)` call and before the `builder.mixin(... NotificationRedirect)` calls, add:

```ts
  // New self-service "Attendance" app (Phase 1d). Same native-navigator pattern as the HR app:
  // navigatorModel.specials, no top-level `component`. One special for v1 (My Attendance, the
  // default landing); Leave + attendance-report specials get added here in later phases.
  // No accessLevel — every workspace user punches their own attendance. AttendanceSession docs
  // live in core.space.Workspace (shared, like Timesheet), so no space is provisioned here.
  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: ygTimesheet.string.Attendance,
      icon: ygTimesheet.icon.Timesheet, // reuse existing icon for the beta
      alias: 'yg-attendance',
      hidden: false,
      position: 'top',
      locationResolver: ygTimesheet.resolver.AttendanceLocation,
      navigatorModel: {
        spaces: [],
        specials: [
          {
            id: 'my',
            label: ygTimesheet.string.MyAttendance,
            icon: ygTimesheet.icon.Timesheet,
            component: ygTimesheet.component.MyAttendance,
            position: 'top'
          }
        ]
      }
    },
    ygTimesheet.app.Attendance
  )
```

- [ ] **Step 5: Build the model package to verify it compiles**

Run: `cd models/yg-timesheet && npx tsc --noEmit -p tsconfig.json`
Expected: exits 0, no errors. (If `AttendanceMode` is unused-import-flagged, it is used in the class `mode!` field — no separate import needed since it comes in via the `@hcengineering/yg-timesheet` block in Step 1.)

- [ ] **Step 6: Commit**

```bash
git add models/yg-timesheet/src/index.ts
git commit -m "yg-timesheet model: AttendanceSession class + Attendance app registration"
```

---

## Task 5: My Attendance page (`MyAttendance.svelte` + resources registration)

The unified page: live clock, state-aware Punch In/Out button, Office/WFH segmented toggle, optional note, today's sessions with a live-ticking open session + daily total, and a read-only date-picker history. Native HTML + `.yg-*` classes + `<Label>`, matching the redesigned yg-timesheet views. Gate: `svelte-check` + a clean resources build.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte`
- Modify: `plugins/yg-timesheet-resources/src/index.ts`

**Interfaces:**
- Consumes: `ygTimesheet.class.AttendanceSession`, `ygTimesheet.string.*` (Tasks 2–3); `attendance.ts` helpers (Task 1); `localDayKey` from `../utils/week`.
- Produces: the `MyAttendance` component resource + `resolveAttendanceLocation` resolver registered under `ygTimesheet.component.MyAttendance` / `ygTimesheet.resolver.AttendanceLocation`.

- [ ] **Step 1: Write the component**

Create `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte`:

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
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { getCurrentEmployee } from '@hcengineering/contact'
  import core from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet, { type AttendanceSession, type AttendanceMode } from '@hcengineering/yg-timesheet'
  import { localDayKey } from '../utils/week'
  import {
    localMidnight,
    findOpenSession,
    dailyTotal,
    nextMode,
    formatDuration
  } from '../utils/attendance'

  const me = getCurrentEmployee()
  const client = getClient()

  // Live clock: retick every second so the running timer + total are live (GreetingCard idiom).
  let nowMs = Date.now()
  let timer: ReturnType<typeof setInterval>
  onMount(() => {
    timer = setInterval(() => (nowMs = Date.now()), 1000)
  })
  onDestroy(() => clearInterval(timer))

  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short' })
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

  // All my sessions, newest punch-in first. Beta volume is small; no range filter needed.
  const query = createQuery()
  let sessions: AttendanceSession[] = []
  query.query(
    ygTimesheet.class.AttendanceSession,
    { space: core.space.Workspace, employee: me },
    (res) => {
      sessions = res
    },
    { sort: { punchIn: -1 } }
  )

  // Derived state. `nowMs` feeds the reactive block so timers/totals retick each second.
  $: todayMid = localMidnight(nowMs)
  $: todays = sessions.filter((s) => s.date === todayMid)
  $: openSession = findOpenSession(sessions)
  $: punchedIn = openSession !== undefined
  $: todayTotal = dailyTotal(todays, nowMs)

  // The Office/WFH selection for the NEXT punch-in. Seeded from today's most recent session's
  // mode (else office), sticky within the day. Re-seed only when the day rolls over or a punch
  // closes — not on every tick — so a manual toggle is not clobbered each second.
  let mode: AttendanceMode = 'office'
  let modeSeedKey = ''
  $: {
    const seed = `${todayMid}:${todays.length}:${punchedIn}`
    if (seed !== modeSeedKey) {
      modeSeedKey = seed
      if (!punchedIn) mode = nextMode(todays)
    }
  }

  let note = ''

  async function punchIn (): Promise<void> {
    if (punchedIn) return
    const at = Date.now()
    const trimmed = note.trim()
    await client.createDoc(ygTimesheet.class.AttendanceSession, core.space.Workspace, {
      employee: me,
      date: localMidnight(at),
      punchIn: at,
      mode,
      ...(trimmed !== '' ? { punchInNote: trimmed } : {})
    })
    note = ''
  }

  async function punchOut (): Promise<void> {
    if (openSession === undefined) return
    const at = Date.now()
    const trimmed = note.trim()
    await client.updateDoc(
      ygTimesheet.class.AttendanceSession,
      core.space.Workspace,
      openSession._id,
      { punchOut: at, ...(trimmed !== '' ? { punchOutNote: trimmed } : {}) }
    )
    note = ''
  }

  // Read-only history. `historyKey` is a native <input type="date"> value (yyyy-mm-dd),
  // defaulting to today. Selecting a date filters sessions by that local day.
  let historyKey = localDayKey(Date.now())
  $: historyMid = new Date(`${historyKey}T00:00:00`).getTime()
  $: historyIsToday = historyMid === todayMid
  $: historySessions = sessions
    .filter((s) => s.date === historyMid)
    .sort((a, b) => a.punchIn - b.punchIn)
</script>

<div class="att-wrap">
  <h1 class="att-title"><Label label={ygTimesheet.string.MyAttendance} /></h1>

  <!-- Punch card -->
  <div class="att-card">
    <div class="att-clock">
      <span class="att-clock__date">{dateFmt.format(nowMs)}</span>
      <span class="att-clock__time">{timeFmt.format(nowMs)}</span>
    </div>

    {#if punchedIn && openSession !== undefined}
      <div class="att-running">
        <span class="att-running__label"><Label label={ygTimesheet.string.In} /></span>
        <span class="att-running__at">{timeFmt.format(openSession.punchIn)}</span>
        <span class="att-running__elapsed">{formatDuration(nowMs - openSession.punchIn)}</span>
        <span class="yg-pill" class:yg-pill--approved={openSession.mode === 'wfh'}>
          <Label label={openSession.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} />
        </span>
      </div>
    {:else}
      <div class="yg-seg att-mode">
        <button class="yg-seg__opt" class:yg-seg__opt--on={mode === 'office'} on:click={() => (mode = 'office')}>
          <Label label={ygTimesheet.string.Office} />
        </button>
        <button class="yg-seg__opt" class:yg-seg__opt--on={mode === 'wfh'} on:click={() => (mode = 'wfh')}>
          <Label label={ygTimesheet.string.WFH} />
        </button>
      </div>
    {/if}

    <textarea class="att-note" rows="2" bind:value={note} placeholder="" aria-label="attendance note" />

    {#if punchedIn}
      <button class="yg-btn yg-btn--danger att-action" on:click={punchOut}>
        <Label label={ygTimesheet.string.PunchOut} />
      </button>
    {:else}
      <button class="yg-btn yg-btn--primary att-action" on:click={punchIn}>
        <Label label={ygTimesheet.string.PunchIn} />
      </button>
    {/if}
  </div>

  <!-- Today's sessions -->
  <div class="att-section">
    <div class="att-section__head">
      <span class="att-section__title"><Label label={ygTimesheet.string.TodaysSessions} /></span>
      <span class="att-section__total">{formatDuration(todayTotal)}</span>
    </div>
    {#if todays.length === 0}
      <div class="att-empty"><Label label={ygTimesheet.string.NoSessionsToday} /></div>
    {:else}
      <div class="att-rows">
        {#each [...todays].sort((a, b) => a.punchIn - b.punchIn) as s (s._id)}
          <div class="att-row">
            <span class="att-row__in">{timeFmt.format(s.punchIn)}{#if s.punchInNote}<span class="att-row__note"> · {s.punchInNote}</span>{/if}</span>
            <span class="att-row__out">
              {#if s.punchOut}{timeFmt.format(s.punchOut)}{#if s.punchOutNote}<span class="att-row__note"> · {s.punchOutNote}</span>{/if}{:else}—{/if}
            </span>
            <span class="yg-pill" class:yg-pill--approved={s.mode === 'wfh'}>
              <Label label={s.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} />
            </span>
            <span class="att-row__dur">{formatDuration((s.punchOut ?? nowMs) - s.punchIn)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- History (read-only) -->
  <div class="att-section">
    <div class="att-section__head">
      <span class="att-section__title"><Label label={ygTimesheet.string.History} /></span>
      <input class="yg-input att-date" type="date" bind:value={historyKey} />
    </div>
    {#if historyIsToday}
      <div class="att-empty"><Label label={ygTimesheet.string.TodaysSessions} /> ↑</div>
    {:else if historySessions.length === 0}
      <div class="att-empty"><Label label={ygTimesheet.string.NoSessionsOnDate} /></div>
    {:else}
      <div class="att-rows">
        {#each historySessions as s (s._id)}
          <div class="att-row">
            <span class="att-row__in">{timeFmt.format(s.punchIn)}{#if s.punchInNote}<span class="att-row__note"> · {s.punchInNote}</span>{/if}</span>
            <span class="att-row__out">{#if s.punchOut}{timeFmt.format(s.punchOut)}{#if s.punchOutNote}<span class="att-row__note"> · {s.punchOutNote}</span>{/if}{:else}—{/if}</span>
            <span class="yg-pill" class:yg-pill--approved={s.mode === 'wfh'}>
              <Label label={s.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} />
            </span>
            <span class="att-row__dur">{s.punchOut ? formatDuration(s.punchOut - s.punchIn) : '—'}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;

  .att-wrap { padding: 1rem 1.25rem; max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  .att-title { font-size: 1.375rem; font-weight: 680; letter-spacing: -0.01em; margin: 6px 0 4px; color: var(--yg-text); }

  .att-card {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .att-clock { display: flex; align-items: baseline; gap: 12px; }
  .att-clock__date { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--yg-text-faint); font-weight: 600; }
  .att-clock__time { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--yg-text); }

  .att-running { display: flex; align-items: center; gap: 12px; }
  .att-running__label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--yg-text-faint); font-weight: 600; }
  .att-running__at { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--yg-text-dim); }
  .att-running__elapsed { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--yg-ink); }

  .att-mode { align-self: flex-start; }

  .att-note {
    width: 100%;
    resize: vertical;
    border: 1px solid var(--yg-border);
    border-radius: 9px;
    background: var(--yg-panel-soft);
    color: var(--yg-text);
    padding: 8px 10px;
    font: inherit;
  }
  .att-note:focus { outline: none; border-color: var(--yg-border-strong); }

  .att-action { align-self: flex-start; min-width: 140px; justify-content: center; }

  .att-section {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    overflow: hidden;
  }
  .att-section__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--yg-border);
  }
  .att-section__title { font-size: 13px; font-weight: 660; color: var(--yg-text); }
  .att-section__total { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--yg-ink); }
  .att-date { max-width: 170px; }

  .att-empty { padding: 16px; color: var(--yg-text-faint); font-size: 13px; }

  .att-rows { display: flex; flex-direction: column; }
  .att-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto auto;
    align-items: center;
    gap: 14px;
    padding: 11px 16px;
  }
  .att-row + .att-row { border-top: 1px solid var(--yg-border); }
  .att-row__in, .att-row__out { font-variant-numeric: tabular-nums; color: var(--yg-text); }
  .att-row__note { color: var(--yg-text-faint); font-weight: 400; }
  .att-row__dur { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--yg-text-dim); min-width: 64px; text-align: right; }
</style>
```

- [ ] **Step 2: Register the component + resolver in resources**

In `plugins/yg-timesheet-resources/src/index.ts`:

Add the import after the `Dashboard` import (line 20):

```ts
import Dashboard from './components/Dashboard.svelte'
import MyAttendance from './components/MyAttendance.svelte'
```

Add the resolver function after `resolveLocation` (after its closing `}`):

```ts
// The Attendance app root (loc.path[3] == null) has one special — default it to My Attendance so a
// first visit does not land on the blank Application shell (same reason as resolveLocation above).
export async function resolveAttendanceLocation (loc: Location): Promise<ResolvedLocation | undefined> {
  if (loc.path[2] !== 'yg-attendance' || loc.path[3] != null) {
    return undefined
  }
  const resolved = { ...loc, path: [loc.path[0], loc.path[1], 'yg-attendance', 'my'] }
  return { loc: resolved, defaultLocation: resolved }
}
```

Add `MyAttendance` to the `component` map and `AttendanceLocation` to the `resolver` map in the default export:

```ts
  component: {
    Timesheet,
    ProjectApproversEditor: ProjectApproversList,
    Approvals,
    Reports,
    HrTimesheet,
    HrRoster,
    HrOverview,
    HrExportDialog,
    ApproveTaskPopup,
    RejectTaskPopup,
    NotificationRedirect,
    Dashboard,
    MyAttendance
  },
  function: { CanApprove },
  resolver: { Location: resolveLocation, AttendanceLocation: resolveAttendanceLocation }
```

- [ ] **Step 3: Run svelte-check to verify the component type-checks**

Run: `cd plugins/yg-timesheet-resources && npm run svelte-check`
Expected: 0 errors. (Warnings about existing files are pre-existing; the new file must add none.)

- [ ] **Step 4: Build the resources package**

Run: `cd plugins/yg-timesheet-resources && npm run build`
Expected: exits 0.

- [ ] **Step 5: Run the package test suite (guards the helpers still pass in-package)**

Run: `cd plugins/yg-timesheet-resources && npx jest`
Expected: PASS — including `attendance.test`.

- [ ] **Step 6: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/MyAttendance.svelte \
        plugins/yg-timesheet-resources/src/index.ts
git commit -m "yg-timesheet: My Attendance page + component/resolver registration"
```

---

## Task 6: Build images, upgrade workspace, smoke test

A new model class + app means a full 4-image rebuild and a workspace upgrade before the app appears. This task is manual/environment-driven; the gate is the on-stack smoke-test checklist.

**Files:** none (build + deploy + verify).

**Interfaces:**
- Consumes: everything from Tasks 1–5, committed on `yg_beta`.
- Produces: the running Attendance app on the local beta stack.

**Preconditions**
- Free RAM first: stop the running huly stack and any outline/docketpress containers (builds are heap-heavy).
- `nvm use 22`.

- [ ] **Step 1: Rebuild all four beta images**

Run the reconstructed build script (rebuilds `yg-local/{front,workspace,transactor,tool}:beta` from `yg_beta`, with the `--max-old-space-size=6144` heap fix baked in):

```bash
bash /tmp/claude-1002/-home-karthi-0008-dev-client-projects-huly-migration/06e3e167-b636-4177-829e-55bdc08b3d8b/scratchpad/build-beta.sh
```

If that scratchpad path is gone, recreate the script from its contents (rush build → `dev/prod` package → bundle+package+`docker build` each of `pods/front`, `pods/workspace`, `pods/server`, `dev/tool` tagged `yg-local/*:beta`).
Expected: ends with `===== BUILD DONE =====` and `docker images | grep yg-local` shows fresh timestamps on all four `:beta` tags.

- [ ] **Step 2: Deploy the stack, redpanda-first**

From the huly-selfhost deploy dir, bring redpanda up first, then the rest (recreate front/workspace/transactor/tool so the new images load):

```bash
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d redpanda
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d
```

Expected: all services healthy (`docker compose -p huly_v7 ps`). Reminder from the ops rules: restart nginx after recreating anything it proxies (front/transactor/account) so it re-resolves container IPs.

- [ ] **Step 3: Upgrade the workspace model**

Run `upgrade-workspace` against the local beta workspace using the freshly built `:beta` tool image (the model change — new class + new app — is applied here). Use the same tool invocation the beta stack uses for `upgrade-workspace`; confirm the exact workspace name from the prior session ledger / `notes/` (the local beta workspace, not necessarily `yg`).

Expected: upgrade completes without error; the log shows the yg-timesheet model migrations as up-to-date (no new `tryUpgrade` state is required for this change — the app doc is additive).

- [ ] **Step 4: Smoke test in the browser**

Log in to the local beta portal as an ordinary employee and verify:
- [ ] The **Attendance** icon appears in the left rail; clicking it lands on **My Attendance** (not a blank shell).
- [ ] The clock shows today's date + a ticking time.
- [ ] With no open session: **Office/WFH** toggle is visible, button reads **Punch In** (primary). Toggle WFH, add a note, click Punch In.
- [ ] A row appears under **Today's sessions** with the in-time, the note, a WFH pill, and a **live-ticking** duration; button now reads **Punch Out**; the toggle is replaced by the running in-time + elapsed timer.
- [ ] Click **Punch Out** with a note → the row shows the out-time + note + final duration; the daily **total** updates; button returns to **Punch In**, defaulting the toggle back to **WFH** (sticky within the day).
- [ ] Reload the page → today's sessions persist (backed by the query, not local state).
- [ ] Pick a **past date** in History → shows that day's sessions read-only (or the empty message); picking today shows the "see above" hint.
- [ ] A second punch the same day pre-selects the last session's mode; confirm a brand-new day would reset to Office (spot-check by reasoning / changing the note, since you cannot fast-forward the clock).

- [ ] **Step 5: Final commit (if any doc updates)**

If you captured the exact `upgrade-workspace` command or workspace name, record it in the session ledger / relevant note. No code changes expected in this step.

```bash
git status   # expect clean; Tasks 1-5 already committed
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- Goal / v1 punch-capture self-service → Tasks 4 (model) + 5 (page).
- New top-level `Attendance` app, alias `yg-attendance`, label `ygTimesheet.string.Attendance`, one `My Attendance` special (default landing) → Task 2 (ids) + Task 4 (app registration) + Task 5 (resolver default landing).
- Timesheet app unchanged → confirmed: no edits to the existing Timesheet app doc.
- Data model `AttendanceSession` (employee/date/punchIn/punchInNote/mode/punchOut/punchOutNote), `DOMAIN_YG_TIMESHEET`, derived duration, `core.space.Workspace` → Task 2 (interface) + Task 4 (model class) + Task 1 (`sessionDuration` derived, never stored).
- Punch card: live clock, state-aware Punch In/Out, Present/WFH toggle (init to today's last mode else office, sticky within day, hidden while in), optional note applied to current action → Task 5 (`nextMode` seed logic, `.yg-seg` toggle hidden when `punchedIn`, note cleared after each action).
- Today's sessions: row per session (In/Out/note/mode chip/duration), open session live duration + no out time, daily total → Task 5.
- History: date picker, past date read-only, defaults today → Task 5.
- Styling: YG design system tokens, WFH distinct accent chip → Task 5 (`@use './yg-table'`, `yg-pill--approved` accent for WFH).
- Rules: immutable (create + close only), at most one open session, notes optional, multiple/day, local day boundary, client-written no trigger → Task 1 (`findOpenSession`, `localMidnight`) + Task 5 (button disabled path: Punch In guarded by `punchedIn`; only create + set-punchOut writes).
- Non-goals (no edit/delete/report/leave/approval/server-immutability/cross-employee/export) → nothing in any task implements these; the shared-space read/write exposure is the spec's explicitly accepted beta posture.
- Testing: pure jest-tested `utils/attendance.ts` (duration, daily total, group-by-day, next-mode, find-open-session) → Task 1. svelte-check + tsc clean → Task 5. Full 4-image rebuild + `upgrade-workspace`, heap flag, redpanda-first → Task 6.
- LOCAL/beta only, no `yg_develop` merge → Global Constraints.

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to Task N"; every code step carries full code. The one deliberately environment-specific item — the exact `upgrade-workspace` command/workspace name in Task 6 Step 3 — is flagged to confirm from the session ledger rather than invented, because it is host state not derivable from the repo.

**Type consistency:** `AttendanceMode`/`AttendanceLike` defined in Task 1 and reused unchanged in Tasks 2/4/5; `AttendanceSession` fields identical across the plugin interface (Task 2) and model class (Task 4); string ids added in Task 2 match the lang keys in Task 3 and the `<Label>` references in Task 5; `alias 'yg-attendance'` matches between the app registration (Task 4) and the resolver guard (Task 5).
