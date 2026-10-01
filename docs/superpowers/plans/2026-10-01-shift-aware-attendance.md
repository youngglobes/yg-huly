# Shift-Aware Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attendance sessions are filed under the employee's **work day** (decided by their shift type's "day starts at" time) instead of the calendar day, with HR-configurable shift types (Day, UK, US, Aus, plus any new ones) and late punch-in measured against the work day.

**Architecture:** Pure IST helpers in `plugins/yg-timesheet` decide the work day and lateness; the server trigger `OnAttendancePunch` (already the authority that stamps `date` and creates `LatePermission`) uses them. A new `ShiftType` class is seeded by migration, assigned per employee in the HR Job tab (mirrored to `WorkProfile` by the existing yg-hr sync trigger), edited on a new Timesheet settings page. Client views mirror the rule for "today" and show a "+1 day" marker. A dry-run-first script recomputes existing records.

**Tech Stack:** TypeScript, Svelte 4, Huly model builder + migrations, Jest (per package `npx jest`), Node built-in test runner for scripts, rush monorepo worktree `yg-huly-beta` (branch `yg_beta`).

**Spec:** `docs/superpowers/specs/2026-10-01-shift-aware-attendance-design.md` (same repo).

## Global Constraints

- Repo `/home/karthi_0008/dev/client-projects/yg-huly-beta`, branch `yg_beta`. **Never run `git add`, `git commit`, `git stash`, `git reset` or `git checkout`** there: the user commits. Tasks end by listing changed files. Task 8 lives in `/home/karthi_0008/dev/client-projects/huly-migration`: same rule.
- No em dash, en dash or other long dash in anything written. Use `-`, `,`, `:` or parentheses.
- Say "YG Portal" in anything user-facing we author.
- Package folders (verified against `rush.json`): `plugins/yg-timesheet`, `models/yg-timesheet`, `plugins/yg-timesheet-resources`, `plugins/yg-timesheet-assets`, `server-plugins/yg-timesheet-resources`, `plugins/yg-hr`, `models/yg-hr`, `plugins/yg-hr-resources`, `plugins/yg-hr-assets`, `server-plugins/yg-hr-resources`.
- Do not add package dependencies (no `rush update`, no lockfile change). `plugins/yg-hr` does not depend on `@hcengineering/yg-timesheet`; type its new field as `Ref<Doc>` there. `models/yg-hr` and `server-plugins/yg-hr-resources` already depend on it.
- Times: IST (fixed UTC+5:30). Minutes since IST midnight, 0-1439. `DAY_MS = 86400000`.
- Default shift types (name, dayStartMin, hoursFromMin, hoursToMin): Day 360, 540, 1200; UK 360, 810, 60; US 360, 1110, 270; Aus 0, 240, 960.
- An employee with no shift type, or whose shift type document is missing, uses dayStartMin 0 (today's behaviour).
- **Spec amendments (planning, 2026-10-01):** (1) the authoritative work day and late decision are made by the server trigger `OnAttendancePunch` (it already overwrites the client's `date` and `punchIn`), not `attendance-write.ts`, whose `date` is a placeholder and stays as is; (2) the shift type is assigned in the HR Job tab only: `WorkProfileEditor.svelte` is no longer mounted (WorkProfile is server-maintained, mirrored from yg-hr `EmployeeJob` by `server-plugins/yg-hr-resources`).

## Review Focus

1. **A punch exactly at the day start** (06:00:00.000 IST) belongs to the new day; 05:59:59.999 to the previous. Test in Task 1.
2. **Employee whose shift type was deleted or is unknown to the client** must fall back to the calendar day, never throw. Test in Task 1 (`dayStartFor`).
3. **Personal start after midnight but before the day start** (e.g. US worker, start 00:30, day start 06:00): lateness is measured on the next calendar date within the same work day, not as "16 hours early". Test in Task 1.
4. **Usual hours that cross midnight** (UK 13:30-01:00) in the config warning: a day start of 00:30 is inside, 06:00 is not. Test in Task 1.
5. **Recompute run twice** must change nothing the second time, and must never move a session whose employee has no shift type or a day start of 0. Test in Task 8.

---

### Task 1: Shared work-day helpers, `ShiftType` type and plugin ids

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts` (interfaces near `WorkProfile` ~line 122-130; helpers after `istMinutesOfDay` ~line 165; ids in the `plugin(...)` object: `class` ~247, `component` ~275, `string` ~470)
- Test: `plugins/yg-timesheet-resources/src/__tests__/work-day.test.ts` (new; the existing `ist.test.ts` there already imports IST helpers from `@hcengineering/yg-timesheet`)

**Interfaces:**
- Produces (exported from `@hcengineering/yg-timesheet`):
  - `interface ShiftType extends Doc { name: string, description: string, dayStartMin: number, hoursFromMin?: number, hoursToMin?: number, archived?: boolean }`
  - `WorkProfile.shiftType?: Ref<ShiftType>`
  - `ygTimesheet.class.ShiftType: Ref<Class<ShiftType>>`, `ygTimesheet.component.ShiftTypesSettings: AnyComponent`
  - strings: `Shifts, ShiftType, ShiftName, ShiftDescription, DayStartsAt, UsualHours, AssignedEmployees, Archived, AddShiftType, Save, ShiftHelp, ShiftHelpExample, DayStartInsideHours, DayStartAppliesToNew, ShiftArchivedHasEmployees, NextDay`
  - `istWorkDayStart (ms: number, dayStartMin: number): number`
  - `minutesLateInWorkDay (punchInMs: number, workDayMs: number, shiftStartMin: number, dayStartMin: number): number` (negative when early)
  - `isAfterWorkDayDate (ms: number, workDayMs: number): boolean`
  - `dayStartInsideHours (dayStartMin: number, fromMin?: number, toMin?: number): boolean`
  - `dayStartFor (shiftType: Ref<ShiftType> | undefined, types: Array<Pick<ShiftType, '_id' | 'dayStartMin'>>): number`

- [ ] **Step 1: Write the failing tests**

Create `plugins/yg-timesheet-resources/src/__tests__/work-day.test.ts`:

```ts
import type { Ref } from '@hcengineering/core'
import {
  dayStartFor,
  dayStartInsideHours,
  isAfterWorkDayDate,
  istDayStart,
  istWorkDayStart,
  minutesLateInWorkDay,
  type ShiftType
} from '@hcengineering/yg-timesheet'

// IST is UTC+5:30, so IST hh:mm on a date == UTC (hh:mm - 5:30).
const ist = (y: number, mo: number, d: number, h: number, mi: number, s = 0, ms = 0): number =>
  Date.UTC(y, mo - 1, d, h, mi, s, ms) - 330 * 60000
const SEP30 = istDayStart(ist(2026, 9, 30, 12, 0))
const OCT1 = istDayStart(ist(2026, 10, 1, 12, 0))

describe('istWorkDayStart', () => {
  it('day start 0 is the IST calendar day', () => {
    expect(istWorkDayStart(ist(2026, 10, 1, 0, 10), 0)).toBe(OCT1)
  })
  it('UK 00:10 with day start 06:00 belongs to the previous day', () => {
    expect(istWorkDayStart(ist(2026, 10, 1, 0, 10), 360)).toBe(SEP30)
  })
  it('exactly at the day start belongs to the new day', () => {
    expect(istWorkDayStart(ist(2026, 10, 1, 6, 0, 0, 0), 360)).toBe(OCT1)
  })
  it('one millisecond before the day start belongs to the previous day', () => {
    expect(istWorkDayStart(ist(2026, 10, 1, 5, 59, 59, 999), 360)).toBe(SEP30)
  })
  it('an afternoon punch is the same day for any day start up to then', () => {
    expect(istWorkDayStart(ist(2026, 9, 30, 15, 0), 360)).toBe(SEP30)
  })
})

describe('minutesLateInWorkDay', () => {
  it('Day shift start 09:00, punch 09:20: 20 late', () => {
    expect(minutesLateInWorkDay(ist(2026, 9, 30, 9, 20), SEP30, 540, 360)).toBe(20)
  })
  it('on time is 0 and early is negative', () => {
    expect(minutesLateInWorkDay(ist(2026, 9, 30, 9, 0), SEP30, 540, 360)).toBe(0)
    expect(minutesLateInWorkDay(ist(2026, 9, 30, 8, 50), SEP30, 540, 360)).toBe(-10)
  })
  it('UK start 15:00, return from break 00:10 next date is not late', () => {
    expect(minutesLateInWorkDay(ist(2026, 10, 1, 0, 10), SEP30, 900, 360)).toBeLessThan(0)
  })
  it('start after midnight but before day start is anchored to the next calendar date', () => {
    // US worker, personal start 00:30, day start 06:00: punch 00:45 on Oct 1 is 15 late for the Sep 30 work day
    expect(minutesLateInWorkDay(ist(2026, 10, 1, 0, 45), SEP30, 30, 360)).toBe(15)
  })
})

describe('isAfterWorkDayDate', () => {
  it('true for a punch on a later IST date than its work day', () => {
    expect(isAfterWorkDayDate(ist(2026, 10, 1, 0, 10), SEP30)).toBe(true)
  })
  it('false on the same IST date', () => {
    expect(isAfterWorkDayDate(ist(2026, 9, 30, 23, 50), SEP30)).toBe(false)
  })
})

describe('dayStartInsideHours', () => {
  it('normal range', () => {
    expect(dayStartInsideHours(720, 240, 960)).toBe(true) // Aus 12:00 inside 04:00-16:00
    expect(dayStartInsideHours(0, 240, 960)).toBe(false)
  })
  it('range crossing midnight', () => {
    expect(dayStartInsideHours(30, 810, 60)).toBe(true) // 00:30 inside 13:30-01:00
    expect(dayStartInsideHours(360, 810, 60)).toBe(false) // 06:00 outside
  })
  it('boundaries are not inside, missing hours never warn', () => {
    expect(dayStartInsideHours(240, 240, 960)).toBe(false)
    expect(dayStartInsideHours(960, 240, 960)).toBe(false)
    expect(dayStartInsideHours(300, undefined, 960)).toBe(false)
  })
})

describe('dayStartFor', () => {
  const types = [{ _id: 'uk' as Ref<ShiftType>, dayStartMin: 360 }]
  it('uses the assigned type', () => {
    expect(dayStartFor('uk' as Ref<ShiftType>, types)).toBe(360)
  })
  it('falls back to 0 when unassigned or the type is unknown', () => {
    expect(dayStartFor(undefined, types)).toBe(0)
    expect(dayStartFor('gone' as Ref<ShiftType>, types)).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd plugins/yg-timesheet-resources && npx jest src/__tests__/work-day.test.ts`
Expected: FAIL (the new exports do not exist).

- [ ] **Step 3: Implement in `plugins/yg-timesheet/src/index.ts`**

Next to `WorkProfile`, add the field and the new interface:

```ts
  // Shift type (Day / UK / US / Aus ...). Decides which work day a punch belongs to; mirrored from
  // the yg-hr EmployeeJob by the server sync, like shiftStart.
  shiftType?: Ref<ShiftType>
```

```ts
/**
 * A shift HR can configure. `dayStartMin` is when one work day ends and the next begins (IST
 * minutes since midnight): a punch-in between it today and it tomorrow counts on today. The usual
 * hours are informational; the settings page warns when the day start falls inside them.
 */
export interface ShiftType extends Doc {
  name: string
  description: string
  dayStartMin: number
  hoursFromMin?: number
  hoursToMin?: number
  archived?: boolean
}
```

After `istMinutesOfDay`:

```ts
/** UTC-ms of IST 00:00 of the WORK day containing `ms`, for a shift whose day starts at dayStartMin IST. */
export function istWorkDayStart (ms: number, dayStartMin: number): number {
  return istDayStart(ms - dayStartMin * 60000)
}

/**
 * Minutes between the expected start and a punch-in, on the work day starting at workDayMs (IST
 * midnight). A personal start earlier than the day start falls on the next calendar date of that
 * work day. Negative = early.
 */
export function minutesLateInWorkDay (punchInMs: number, workDayMs: number, shiftStartMin: number, dayStartMin: number): number {
  const startMs = workDayMs + (shiftStartMin < dayStartMin ? DAY_MS : 0) + shiftStartMin * 60000
  return Math.floor((punchInMs - startMs) / 60000)
}

/** True when `ms` is on a later IST calendar date than its work day (shown as "+1 day"). */
export function isAfterWorkDayDate (ms: number, workDayMs: number): boolean {
  return istDayStart(ms) > workDayMs
}

/** True when the day start falls strictly inside the usual hours (which may cross midnight). */
export function dayStartInsideHours (dayStartMin: number, fromMin?: number, toMin?: number): boolean {
  if (fromMin === undefined || toMin === undefined || fromMin === toMin) return false
  return fromMin < toMin
    ? dayStartMin > fromMin && dayStartMin < toMin
    : dayStartMin > fromMin || dayStartMin < toMin
}

/** An employee's day start: their shift type's, or 0 (calendar day) when unassigned or unknown. */
export function dayStartFor (
  shiftType: Ref<ShiftType> | undefined,
  types: Array<Pick<ShiftType, '_id' | 'dayStartMin'>>
): number {
  if (shiftType === undefined) return 0
  return types.find((t) => t._id === shiftType)?.dayStartMin ?? 0
}
```

In the `plugin(...)` ids: `class.ShiftType: '' as Ref<Class<ShiftType>>`, `component.ShiftTypesSettings: '' as AnyComponent`, and in `string` add each name listed under Produces as `'' as IntlString` (skip any that already exist; `Save` may already exist, reuse it).

- [ ] **Step 4: Run tests, build the plugin**

Run: `cd plugins/yg-timesheet && npm run build && cd ../yg-timesheet-resources && npx jest src/__tests__/work-day.test.ts src/__tests__/ist.test.ts`
Expected: build exit 0; all tests PASS (19 new).

- [ ] **Step 5: Record changed files (no commit)**

`plugins/yg-timesheet/src/index.ts`, `plugins/yg-timesheet-resources/src/__tests__/work-day.test.ts`

---

### Task 2: Model, seed migration, strings, yg-hr field and sync

**Files:**
- Modify: `models/yg-timesheet/src/index.ts` (`TWorkProfile` ~145; new `TShiftType` near `TAttendanceReminderSettings` ~187; `builder.createModel(...)` ~219; settings nav ~270-292)
- Modify: `models/yg-timesheet/src/migration.ts` (new seed function + entry in the `tryUpgrade` list ~364-430)
- Modify: `plugins/yg-timesheet-assets/lang/en.json`, `plugins/yg-timesheet-assets/lang/ru.json`
- Modify: `plugins/yg-hr/src/index.ts` (`EmployeeJob` ~148-150, string ids), `models/yg-hr/src/index.ts` (~152), `plugins/yg-hr-assets/lang/en.json`
- Modify: `server-plugins/yg-hr-resources/src/index.ts` (sync ~742-746)

**Interfaces:**
- Consumes: Task 1 ids and `ShiftType`.
- Produces: `ShiftType` docs (4 seeded by name); `EmployeeJob.shiftType?: Ref<Doc>` (yg-hr), mirrored to `WorkProfile.shiftType`; string `ygHr.string.ShiftType`.

- [ ] **Step 1: Model class and WorkProfile prop** (`models/yg-timesheet/src/index.ts`)

In `TWorkProfile`: `@Prop(TypeRef(ygTimesheet.class.ShiftType), ygTimesheet.string.ShiftType) shiftType?: Ref<ShiftType>`

New class (import `type ShiftType` from `@hcengineering/yg-timesheet`):

```ts
@Model(ygTimesheet.class.ShiftType, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TShiftType extends TDoc implements ShiftType {
  @Prop(TypeString(), ygTimesheet.string.ShiftName) name!: string
  @Prop(TypeString(), ygTimesheet.string.ShiftDescription) description!: string
  @Prop(TypeNumber(), ygTimesheet.string.DayStartsAt) dayStartMin!: number
  @Prop(TypeNumber(), ygTimesheet.string.UsualHours) hoursFromMin?: number
  @Prop(TypeNumber(), ygTimesheet.string.UsualHours) hoursToMin?: number
  @Prop(TypeBoolean(), ygTimesheet.string.Archived) archived?: boolean
}
```

Add `TShiftType` to `builder.createModel(...)`. In the settings navigator list, after the `reminders` entry:

```ts
          {
            id: 'shifts',
            label: ygTimesheet.string.Shifts,
            icon: setting.icon.Setting,
            component: ygTimesheet.component.ShiftTypesSettings,
            accessLevel: AccountRole.Maintainer,
            position: 'bottom'
          }
```

- [ ] **Step 2: Seed migration** (`models/yg-timesheet/src/migration.ts`)

```ts
// Default shift types (IST). Seeded by name, so renaming or archiving one never brings it back.
const DEFAULT_SHIFT_TYPES = [
  { name: 'Day', dayStartMin: 360, hoursFromMin: 540, hoursToMin: 1200, description: 'Indian day shift. The work day runs 06:00 to 06:00, so late evening work stays on the day it started.' },
  { name: 'UK', dayStartMin: 360, hoursFromMin: 810, hoursToMin: 60, description: 'UK hours worked from India. Sessions after midnight (until 06:00) count on the day the shift started.' },
  { name: 'US', dayStartMin: 360, hoursFromMin: 1110, hoursToMin: 270, description: 'US East-coast hours worked from India. Sessions after midnight (until 06:00) count on the day the shift started.' },
  { name: 'Aus', dayStartMin: 0, hoursFromMin: 240, hoursToMin: 960, description: 'Australian hours worked from India (early morning start, evening support until 22:00). The work day is the calendar day.' }
]

async function seedShiftTypes (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  const have = new Set((await ops.findAll(ygTimesheet.class.ShiftType, {})).map((t) => t.name.trim().toLowerCase()))
  for (const t of DEFAULT_SHIFT_TYPES) {
    if (have.has(t.name.toLowerCase())) continue // idempotent
    await ops.createDoc(ygTimesheet.class.ShiftType, core.space.Workspace, t)
  }
}
```

Add to the `tryUpgrade` list (last entry): `{ state: 'shift-types-seed-0001', func: seedShiftTypes }`.

- [ ] **Step 3: Strings**

`plugins/yg-timesheet-assets/lang/en.json` and `ru.json` (same English text in both, keys under `"string"`, insert without reformatting the files):

```json
"Shifts": "Shifts",
"ShiftType": "Shift type",
"ShiftName": "Name",
"ShiftDescription": "Description",
"DayStartsAt": "Day starts at",
"UsualHours": "Usual hours",
"AssignedEmployees": "Employees",
"Archived": "Archived",
"AddShiftType": "Add shift type",
"ShiftHelp": "Day starts at is when one work day ends and the next begins. Everything an employee punches between that time today and the same time tomorrow counts on today. Set it to a time when nobody on this shift is working.",
"ShiftHelpExample": "Example: UK shift, day starts at 06:00. Punch in 15:00, out 23:50, in again 00:10, out 01:00: the whole shift counts on the day it started.",
"DayStartInsideHours": "Day start is inside this shift's usual hours: shifts will be split over two days.",
"DayStartAppliesToNew": "Applies to new punch-ins. Existing records move only when the recompute tool is run.",
"ShiftArchivedHasEmployees": "Archived, but still assigned to:",
"NextDay": "+1 day"
```

(Skip keys that already exist in the file, e.g. `Save`.) `plugins/yg-hr/src/index.ts` string ids gain `ShiftType`, and `plugins/yg-hr-assets/lang/en.json` gains `"ShiftType": "Shift type"`.

- [ ] **Step 4: yg-hr field**

`plugins/yg-hr/src/index.ts`, in `EmployeeJob` next to `shiftStart`:

```ts
  // Ref to a yg-timesheet ShiftType (typed Ref<Doc> here: this plugin does not depend on
  // yg-timesheet). Mirrored to WorkProfile.shiftType by the server sync, like shiftStart.
  shiftType?: Ref<Doc>
```

`models/yg-hr/src/index.ts`, next to the `shiftStart` prop: `@Prop(TypeRef(ygTimesheet.class.ShiftType), ygHr.string.ShiftType) shiftType?: Ref<Doc>` (import `ygTimesheet` from `@hcengineering/yg-timesheet` if not already imported there).

- [ ] **Step 5: Sync** (`server-plugins/yg-hr-resources/src/index.ts`, next to the `shiftStart` line ~745)

```ts
    if (wp?.shiftType !== job.shiftType) wpUpdate.shiftType = job.shiftType as Ref<ShiftType> | undefined
```

(import `type ShiftType` from `@hcengineering/yg-timesheet`). Update the block comment above the trigger to mention shiftType alongside shiftStart.

- [ ] **Step 6: Build and validate**

Run, in order: `cd plugins/yg-hr && npm run build`, `cd ../../models/yg-timesheet && npm run _phase:validate`, `cd ../yg-hr && npm run _phase:validate`, `cd ../../server-plugins/yg-hr-resources && npm run _phase:validate`, and for each lang file `python3 -c "import json;json.load(open('<file>'))"`.
Expected: all exit 0.

- [ ] **Step 7: Record changed files (no commit)**

---

### Task 3: Server decides the work day and lateness

**Files:**
- Modify: `server-plugins/yg-timesheet-resources/src/index.ts` (`OnAttendancePunch`, the punch-in branch ~666-720, and its header comment ~618-627)

**Interfaces:**
- Consumes: `istWorkDayStart`, `minutesLateInWorkDay`, `dayStartFor`, `ygTimesheet.class.ShiftType`, `WorkProfile.shiftType` (Tasks 1-2).
- Produces: `AttendanceSession.date` and `LatePermission.date` = work day; `LatePermission.minutesLate` anchored to it.

- [ ] **Step 1: Replace the punch-in branch's day and late math**

Imports: add `istWorkDayStart, minutesLateInWorkDay, dayStartFor` to the existing `@hcengineering/yg-timesheet` import (keep `istDayStart` only if still used elsewhere in the file; `istMinutesOfDay` likewise).

In the punch-in branch, replace

```ts
    const now = Date.now()
    const date = istDayStart(now)
    const employee = ctx.attributes.employee
```

with

```ts
    const now = Date.now()
    const employee = ctx.attributes.employee
    // The work day comes from the employee's shift type: a punch before its day start belongs to the
    // previous work day (UK 00:10 return from a break stays on the shift's day). No type = calendar day.
    const profile = (
      await control.findAll(control.ctx, ygTimesheet.mixin.WorkProfile, { _id: employee }, { limit: 1 })
    )[0]
    const types = profile?.shiftType === undefined
      ? []
      : await control.findAll(control.ctx, ygTimesheet.class.ShiftType, { _id: profile.shiftType }, { limit: 1 })
    const dayStartMin = dayStartFor(profile?.shiftType, types)
    const date = istWorkDayStart(now, dayStartMin)
```

Further down, delete the second `const profile = (...)` lookup (now fetched above) and replace

```ts
    const minutesLate = istMinutesOfDay(now) - shiftStart
```

with

```ts
    const minutesLate = minutesLateInWorkDay(now, date, shiftStart, dayStartMin)
```

Update the comments that say "IST day" to "IST work day" in this branch and in the header comment ("keys the day + late math off the employee's work day via istWorkDayStart").

- [ ] **Step 2: Validate and run the package tests**

Run: `cd server-plugins/yg-timesheet-resources && npx jest && npm run _phase:validate`
Expected: existing tests PASS; validate exit 0. (The day and late math themselves are covered by Task 1's tests; the end-to-end check is Task 9.)

- [ ] **Step 3: Record changed files (no commit)**

---

### Task 4: The employee's "today" and the late popup follow the work day

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte` (~47-49 profile query; ~92 `todayMid`; ~154-162 late check)
- Modify: `plugins/yg-timesheet-resources/src/components/EmployeeDashboard.svelte` (~114 `today`, and where it renders `MyAttendanceCard`)
- Modify: `plugins/yg-timesheet-resources/src/components/dashboard/MyAttendanceCard.svelte` (~30-39)

**Interfaces:**
- Consumes: `istWorkDayStart`, `minutesLateInWorkDay`, `dayStartFor`, `ShiftType` (Task 1).
- Produces: `MyAttendanceCard` prop `dayStartMin: number` (default 0).

- [ ] **Step 1: MyAttendance**

Imports: add `istWorkDayStart, minutesLateInWorkDay, dayStartFor, type ShiftType` from `@hcengineering/yg-timesheet`, and `type Ref` from `@hcengineering/core` if missing. Replace the profile query line and add the shift types query:

```ts
  let shiftStart: number | undefined = undefined
  let shiftType: Ref<ShiftType> | undefined = undefined
  $: profQuery.query(ygTimesheet.mixin.WorkProfile, { _id: me }, (res) => {
    shiftStart = res[0]?.shiftStart
    shiftType = res[0]?.shiftType
  })
  const shiftTypesQuery = createQuery()
  let shiftTypes: ShiftType[] = []
  shiftTypesQuery.query(ygTimesheet.class.ShiftType, {}, (res) => { shiftTypes = res })
  $: dayStartMin = dayStartFor(shiftType, shiftTypes)
```

Replace `$: todayMid = localMidnight(nowMs)` with `$: todayMid = istWorkDayStart(nowMs, dayStartMin)`.

Replace the late check block's condition and queries:

```ts
    // Late check only on the FIRST punch of the work day, and only when a shiftStart is set. The
    // server makes the authoritative decision (OnAttendancePunch); this only asks for the reason.
    let lateReason: string | undefined
    const workDay = istWorkDayStart(at, dayStartMin)
    const lateBy = shiftStart === undefined ? 0 : minutesLateInWorkDay(at, workDay, shiftStart, dayStartMin)
    if (lateBy > 0) {
      const priorToday = await client.findAll(
        ygTimesheet.class.AttendanceSession, { employee: me, date: workDay }, { limit: 1 }
      )
      if (priorToday.length === 0) {
        const res = await new Promise<{ reason: string } | null | undefined>((resolve) => {
          showPopup(LateReasonPopup, { minutesLate: lateBy }, undefined, resolve)
```

(keep the rest of the block unchanged). Remove the now-unused imports `isLate`, `minutesLateOf`, `localMidnight` only if nothing else in the file uses them.

- [ ] **Step 2: EmployeeDashboard and MyAttendanceCard**

In `EmployeeDashboard.svelte`, add the same `shiftType`/`shiftTypes`/`dayStartMin` lookup as Step 1 (it already knows the current employee; reuse its existing WorkProfile query if it has one, else add `createQuery` for `ygTimesheet.mixin.WorkProfile` `{ _id: <current employee> }`). Replace `$: today = localMidnight(now)` with `$: today = istWorkDayStart(now, dayStartMin)` and pass `dayStartMin={dayStartMin}` to `<MyAttendanceCard ...>`.

In `MyAttendanceCard.svelte`: `export let dayStartMin: number = 0` and replace `localMidnight(now)` in the `buildDayTimeline(...)` call with `istWorkDayStart(now, dayStartMin)` (import from `@hcengineering/yg-timesheet`).

- [ ] **Step 3: Type-check**

Run: `cd plugins/yg-timesheet-resources && npm run _phase:validate && npx jest`
Expected: exit 0; all tests PASS. If the package has a `svelte-check` script, run it and confirm no new errors (record before/after counts).

- [ ] **Step 4: Record changed files (no commit)**

---

### Task 5: Reports read the stored work day; "+1 day" marker

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/performance.ts` (`PerfAtt` line 9; loop ~68-70)
- Modify: `plugins/yg-timesheet-resources/src/components/Performance.svelte` (~83)
- Modify: `plugins/yg-timesheet-resources/src/components/AttendanceSessionRow.svelte`
- Test: `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts` (append)

**Interfaces:**
- Consumes: `isAfterWorkDayDate` (Task 1), string `NextDay` (Tasks 1-2).
- Produces: `PerfAtt.date?: number` (work-day key; falls back to the punch-in's local midnight when absent).

- [ ] **Step 1: Failing test** (append to `performance.test.ts`; it already defines `D(y, m0, d, h)` local-time helper and an `emps: PerfEmp[]` fixture whose first entry is a tracked employee)

```ts
describe('performanceRows uses the stored work day', () => {
  it('a UK shift with an after-midnight session is one 9.67h day, nothing on the next date', () => {
    const day1 = new Date(2026, 8, 30).getTime() // Wed 30 Sep (a working day)
    const in1 = new Date(2026, 8, 30, 15, 0).getTime()
    const out1 = new Date(2026, 8, 30, 23, 50).getTime()
    const in2 = new Date(2026, 9, 1, 0, 10).getTime()
    const out2 = new Date(2026, 9, 1, 1, 0).getTime()
    const rows = performanceRows(
      [emps[0]],
      [],
      [
        { employee: emps[0].id, punchIn: in1, punchOut: out1, date: day1 },
        { employee: emps[0].id, punchIn: in2, punchOut: out2, date: day1 }
      ],
      new Date(2026, 9, 5, 12).getTime()
    )
    const days = rows[0].days
    const sep30 = days.find((d) => d.date === day1)
    expect(sep30?.workedHours).toBeCloseTo(9.67, 1) // flagged as overtime (> 8h)
    expect(days.some((d) => d.date === new Date(2026, 9, 1).getTime())).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**, then implement:

`PerfAtt`: `export interface PerfAtt { employee: string; punchIn: number; punchOut?: number; date?: number }` and in the loop `const day = a.date ?? localMidnight(a.punchIn)`. `Performance.svelte`: `({ employee: d.employee, punchIn: d.punchIn, punchOut: d.punchOut, date: d.date })`.

- [ ] **Step 3: "+1 day" marker** (`AttendanceSessionRow.svelte`)

Script: `import ygTimesheet, { isAfterWorkDayDate } from '@hcengineering/yg-timesheet'` (merge with the existing import) and

```ts
  $: inNextDay = isAfterWorkDayDate(session.punchIn, session.date)
  $: outNextDay = session.punchOut !== undefined && isAfterWorkDayDate(session.punchOut, session.date)
```

After `{timeFmt.format(session.punchIn)}` and after `{timeFmt.format(session.punchOut)}` respectively:

```svelte
    {#if inNextDay}<span class="att-td__nextday"><Label label={ygTimesheet.string.NextDay} /></span>{/if}
```

```svelte
      {#if outNextDay}<span class="att-td__nextday"><Label label={ygTimesheet.string.NextDay} /></span>{/if}
```

Style: `.att-td__nextday { margin-left: 0.375rem; font-size: 0.6875rem; color: var(--theme-dark-color); }`

- [ ] **Step 4: Run tests and validate**

Run: `cd plugins/yg-timesheet-resources && npx jest && npm run _phase:validate`
Expected: all PASS, exit 0.

- [ ] **Step 5: Record changed files (no commit)**

---

### Task 6: Shifts settings page

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/ShiftTypesSettings.svelte`
- Modify: `plugins/yg-timesheet-resources/src/index.ts` (import + component map, next to `AttendanceReminderSettings` ~line 28 and ~147)

**Interfaces:**
- Consumes: `ShiftType`, `dayStartInsideHours`, strings, `ygTimesheet.component.ShiftTypesSettings` (Tasks 1-2). Registered in the settings nav by Task 2.

- [ ] **Step 1: Create the component**

Read `AttendanceReminderSettings.svelte` first and match its page chrome (header, padding classes, `ui` imports). Logic and markup:

```svelte
<!--
// YG Portal: HR-configurable shift types. "Day starts at" decides which work day a punch-in counts on.
-->
<script lang="ts">
  import core, { type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet, { dayStartInsideHours, type ShiftType, type WorkProfile } from '@hcengineering/yg-timesheet'

  const client = getClient()
  let types: ShiftType[] = []
  let profiles: WorkProfile[] = []
  createQuery().query(ygTimesheet.class.ShiftType, {}, (res) => { types = res }, { sort: { name: 1 } })
  createQuery().query(ygTimesheet.mixin.WorkProfile, {}, (res) => { profiles = res })

  $: assigned = (id: Ref<ShiftType>): WorkProfile[] => profiles.filter((p) => p.shiftType === id)

  const toTime = (m: number | undefined): string =>
    m === undefined ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const toMin = (s: string): number | undefined => {
    const m = /^(\d{2}):(\d{2})$/.exec(s)
    return m === null ? undefined : Number(m[1]) * 60 + Number(m[2])
  }

  async function save (t: ShiftType, patch: Partial<ShiftType>): Promise<void> {
    await client.updateDoc(ygTimesheet.class.ShiftType, core.space.Workspace, t._id, patch)
  }

  // Names are unique (case-insensitive): a rename to an existing name is refused and the field reset.
  async function rename (t: ShiftType, input: HTMLInputElement): Promise<void> {
    const name = input.value.trim()
    const clash = types.some((o) => o._id !== t._id && o.name.trim().toLowerCase() === name.toLowerCase())
    if (name === '' || clash) { input.value = t.name; return }
    await save(t, { name })
  }

  // New-type form. Placeholders show a worked example (US West).
  let nName = ''
  let nDescription = ''
  let nDayStart = ''
  let nFrom = ''
  let nTo = ''
  $: nameTaken = types.some((t) => t.name.trim().toLowerCase() === nName.trim().toLowerCase())
  $: canAdd = nName.trim() !== '' && !nameTaken && toMin(nDayStart) !== undefined
  async function add (): Promise<void> {
    if (!canAdd) return
    await client.createDoc(ygTimesheet.class.ShiftType, core.space.Workspace, {
      name: nName.trim(),
      description: nDescription.trim(),
      dayStartMin: toMin(nDayStart) as number,
      hoursFromMin: toMin(nFrom),
      hoursToMin: toMin(nTo)
    })
    nName = nDescription = nDayStart = nFrom = nTo = ''
  }
</script>

<div class="yg-shifts">
  <div class="yg-shifts__help">
    <p><Label label={ygTimesheet.string.ShiftHelp} /></p>
    <p><Label label={ygTimesheet.string.ShiftHelpExample} /></p>
    <p class="yg-shifts__muted"><Label label={ygTimesheet.string.DayStartAppliesToNew} /></p>
  </div>

  <table class="yg-shifts__table">
    <thead>
      <tr>
        <th><Label label={ygTimesheet.string.ShiftName} /></th>
        <th><Label label={ygTimesheet.string.ShiftDescription} /></th>
        <th><Label label={ygTimesheet.string.DayStartsAt} /></th>
        <th><Label label={ygTimesheet.string.UsualHours} /></th>
        <th><Label label={ygTimesheet.string.AssignedEmployees} /></th>
        <th><Label label={ygTimesheet.string.Archived} /></th>
      </tr>
    </thead>
    <tbody>
      {#each types as t (t._id)}
        <tr class:yg-shifts__archived={t.archived === true}>
          <td><input class="yg-input" value={t.name} on:change={(e) => rename(t, e.currentTarget)} /></td>
          <td><textarea class="yg-input" rows="2" value={t.description} on:change={(e) => save(t, { description: e.currentTarget.value.trim() })} /></td>
          <td>
            <input class="yg-input" type="time" value={toTime(t.dayStartMin)}
              on:change={(e) => { const m = toMin(e.currentTarget.value); if (m !== undefined) void save(t, { dayStartMin: m }) }} />
            {#if dayStartInsideHours(t.dayStartMin, t.hoursFromMin, t.hoursToMin)}
              <div class="yg-shifts__warn"><Label label={ygTimesheet.string.DayStartInsideHours} /></div>
            {/if}
          </td>
          <td>
            <input class="yg-input" type="time" value={toTime(t.hoursFromMin)} on:change={(e) => save(t, { hoursFromMin: toMin(e.currentTarget.value) })} />
            <input class="yg-input" type="time" value={toTime(t.hoursToMin)} on:change={(e) => save(t, { hoursToMin: toMin(e.currentTarget.value) })} />
          </td>
          <td>{assigned(t._id).length}</td>
          <td>
            <input type="checkbox" checked={t.archived === true} on:change={(e) => save(t, { archived: e.currentTarget.checked })} />
            {#if t.archived === true && assigned(t._id).length > 0}
              <div class="yg-shifts__warn">
                <Label label={ygTimesheet.string.ShiftArchivedHasEmployees} />
                {assigned(t._id).map((p) => p.name).join(', ')}
              </div>
            {/if}
          </td>
        </tr>
      {/each}
      <tr class="yg-shifts__new">
        <td><input class="yg-input" placeholder="US West" bind:value={nName} /></td>
        <td><textarea class="yg-input" rows="2" placeholder="US Pacific hours worked from India. Sessions after midnight (until 10:00) count on the day the shift started." bind:value={nDescription} /></td>
        <td><input class="yg-input" type="time" bind:value={nDayStart} placeholder="10:00" /></td>
        <td><input class="yg-input" type="time" bind:value={nFrom} /><input class="yg-input" type="time" bind:value={nTo} /></td>
        <td />
        <td><button class="yg-btn" disabled={!canAdd} on:click={add}><Label label={ygTimesheet.string.AddShiftType} /></button></td>
      </tr>
    </tbody>
  </table>
</div>

<style lang="scss">
  .yg-shifts { padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
  .yg-shifts__help { padding: 0.75rem 1rem; border-radius: 0.5rem; background: var(--theme-bg-accent-color); }
  .yg-shifts__help p { margin: 0 0 0.5rem; }
  .yg-shifts__muted { color: var(--theme-dark-color); }
  .yg-shifts__table { width: 100%; border-collapse: collapse; }
  .yg-shifts__table th, .yg-shifts__table td { padding: 0.5rem; text-align: left; vertical-align: top; border-bottom: 1px solid var(--theme-divider-color); }
  .yg-shifts__archived { opacity: 0.6; }
  .yg-shifts__warn { margin-top: 0.25rem; font-size: 0.75rem; color: var(--theme-warning-color, #b45309); }
</style>
```

If `yg-input`/`yg-btn` classes do not exist in this package (grep `yg-input` under `plugins/yg-timesheet-resources/src`), use the classes `AttendanceReminderSettings.svelte` uses for its inputs and button instead. Check that every CSS variable used exists in `packages/theme/styles/_colors.scss`; replace any that do not with ones that do.

- [ ] **Step 2: Register** in `plugins/yg-timesheet-resources/src/index.ts`: `import ShiftTypesSettings from './components/ShiftTypesSettings.svelte'` and add `ShiftTypesSettings` to the `component` map next to `AttendanceReminderSettings`.

- [ ] **Step 3: Type-check**

Run: `cd plugins/yg-timesheet-resources && npm run _phase:validate` (and `svelte-check` if available, comparing counts before/after).
Expected: exit 0, no new errors.

- [ ] **Step 4: Record changed files (no commit)**

---

### Task 7: Shift type picker in the HR Job tab

**Files:**
- Modify: `plugins/yg-hr-resources/src/components/tabs/JobTab.svelte` (form vars ~79-92, `saveRole` ~95-104, edit form ~181-184, read-only rows ~196)

**Interfaces:**
- Consumes: `EmployeeJob.shiftType` and `ygHr.string.ShiftType` (Task 2); `ygTimesheet.class.ShiftType` (Task 1). `plugins/yg-hr-resources` already depends on `@hcengineering/yg-timesheet`.

- [ ] **Step 1: Query, form state, save**

Script additions:

```ts
  import { createQuery } from '@hcengineering/presentation'
  import ygTimesheet, { type ShiftType } from '@hcengineering/yg-timesheet'
  import type { Doc } from '@hcengineering/core'

  let shiftTypes: ShiftType[] = []
  createQuery().query(ygTimesheet.class.ShiftType, {}, (res) => { shiftTypes = res }, { sort: { name: 1 } })
  $: shiftTypeDoc = shiftTypes.find((t) => t._id === job?.shiftType)
  // Archived types are not offered for new assignment, but the current one stays selectable.
  $: pickable = shiftTypes.filter((t) => t.archived !== true || t._id === job?.shiftType)
  $: pickedDescription = shiftTypes.find((t) => t._id === fShiftType)?.description
  let fShiftType = ''
```

(merge `createQuery` into the existing `@hcengineering/presentation` import and `Doc` into the existing core import). In the function that fills form fields (where `fShiftStart = ...` is set): `fShiftType = (job?.shiftType as string | undefined) ?? ''`. In `saveRole`'s `upd`: `shiftType: fShiftType === '' ? undefined : (fShiftType as Ref<Doc>),`.

- [ ] **Step 2: Edit form** (right after the Shift start `<label>`)

```svelte
        <label class="yg-input-f">
          <span><Label label={ygHr.string.ShiftType} /></span>
          <select class="yg-input" bind:value={fShiftType} on:change={saveRole}>
            <option value="">-</option>
            {#each pickable as t (t._id)}<option value={t._id}>{t.name}</option>{/each}
          </select>
          {#if pickedDescription}<small class="yg-hint">{pickedDescription}</small>{/if}
        </label>
```

- [ ] **Step 3: Read-only row** (after the Shift start `FieldRow`): `<FieldRow label={ygHr.string.ShiftType} value={shiftTypeDoc?.name} />`

If `yg-hint` is not an existing class in this package, add `.yg-hint { display: block; margin-top: 0.25rem; font-size: 0.75rem; color: var(--theme-dark-color); }` to the component's style block.

- [ ] **Step 4: Type-check**

Run: `cd plugins/yg-hr-resources && npm run _phase:validate` (and `svelte-check` if available, before/after counts).
Expected: exit 0, no new errors.

- [ ] **Step 5: Record changed files (no commit)**

---

### Task 8: Recompute tool for existing records (huly-migration repo)

**Files:**
- Create: `/home/karthi_0008/dev/client-projects/huly-migration/scripts/attendance/recompute-workday.js`
- Test: `/home/karthi_0008/dev/client-projects/huly-migration/scripts/attendance/test/recompute-workday.test.js`
- Modify: `/home/karthi_0008/dev/client-projects/huly-migration/docs/transactor-wedge-runbook.md` is NOT touched; instead add a short usage block at the top of the script.

**Interfaces:**
- Consumes: data shapes from Tasks 1-2 (`ShiftType.dayStartMin`, `WorkProfile.shiftType`); REST `POST <base>/api/v1/{find-all|tx}/<workspace>` exactly as `scripts/attendance-guard-probe.js` does.
- Produces: `planMoves(sessions, lates, profiles, types) -> Array<{ kind: 'session' | 'late', id, employee, from, to }>`.

- [ ] **Step 1: Failing test** (`node:test`, same style as `scripts/timesheet/test/*.test.js`)

```js
const test = require('node:test')
const assert = require('node:assert')
const { planMoves, istWorkDayStart, istDayStart } = require('../recompute-workday.js')

const ist = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000
const SEP30 = istDayStart(ist(2026, 9, 30, 12, 0))
const OCT1 = istDayStart(ist(2026, 10, 1, 12, 0))
const types = [{ _id: 'uk', dayStartMin: 360 }, { _id: 'aus', dayStartMin: 0 }]

test('moves a UK 00:10 session filed on the calendar day to the previous work day', () => {
  const sessions = [{ _id: 's1', employee: 'e1', punchIn: ist(2026, 10, 1, 0, 10), date: OCT1 }]
  const moves = planMoves(sessions, [], [{ _id: 'e1', shiftType: 'uk' }], types)
  assert.deepStrictEqual(moves, [{ kind: 'session', id: 's1', employee: 'e1', from: OCT1, to: SEP30 }])
})

test('leaves sessions already on their work day, and employees without a type or with day start 0', () => {
  const sessions = [
    { _id: 's1', employee: 'e1', punchIn: ist(2026, 9, 30, 15, 0), date: SEP30 },
    { _id: 's2', employee: 'e2', punchIn: ist(2026, 10, 1, 0, 10), date: OCT1 },
    { _id: 's3', employee: 'e3', punchIn: ist(2026, 10, 1, 0, 10), date: OCT1 }
  ]
  const profiles = [{ _id: 'e1', shiftType: 'uk' }, { _id: 'e2' }, { _id: 'e3', shiftType: 'aus' }]
  assert.deepStrictEqual(planMoves(sessions, [], profiles, types), [])
})

test('moves the matching late permission too', () => {
  const lates = [{ _id: 'l1', employee: 'e1', punchIn: ist(2026, 10, 1, 0, 10), date: OCT1 }]
  const moves = planMoves([], lates, [{ _id: 'e1', shiftType: 'uk' }], types)
  assert.deepStrictEqual(moves, [{ kind: 'late', id: 'l1', employee: 'e1', from: OCT1, to: SEP30 }])
})

test('is idempotent: applying the plan and planning again yields nothing', () => {
  const sessions = [{ _id: 's1', employee: 'e1', punchIn: ist(2026, 10, 1, 0, 10), date: OCT1 }]
  const profiles = [{ _id: 'e1', shiftType: 'uk' }]
  for (const m of planMoves(sessions, [], profiles, types)) sessions.find((s) => s._id === m.id).date = m.to
  assert.deepStrictEqual(planMoves(sessions, [], profiles, types), [])
})

test('istWorkDayStart matches the platform helper on the boundary', () => {
  assert.strictEqual(istWorkDayStart(ist(2026, 10, 1, 6, 0), 360), OCT1)
  assert.strictEqual(istWorkDayStart(ist(2026, 10, 1, 5, 59), 360), SEP30)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/karthi_0008/dev/client-projects/huly-migration && node --test scripts/attendance/test/recompute-workday.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement `recompute-workday.js`**

```js
// Recompute AttendanceSession.date and LatePermission.date with the shift-aware work-day rule
// (yg-huly plugins/yg-timesheet istWorkDayStart). Dry run by default; --apply writes.
// Run where the transactor is reachable, with a tool token and the caller's social id:
//   TOK=<token> SOCIAL=<caller social id> BASE=http://transactor:3333/api/v1 node recompute-workday.js [--apply]
// Beta from the host: BASE=http://localhost:8087/_transactor/api/v1
// Mirrors (no deps): istDayStart / istWorkDayStart from plugins/yg-timesheet/src/index.ts.
const IST_OFFSET_MS = 330 * 60 * 1000
const DAY_MS = 86400000
const istDayStart = (ms) => Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS
const istWorkDayStart = (ms, dayStartMin) => istDayStart(ms - dayStartMin * 60000)

const SESSION = 'yg-timesheet:class:AttendanceSession'
const LATE = 'yg-timesheet:class:LatePermission'
const SHIFT = 'yg-timesheet:class:ShiftType'
const PROFILE = 'yg-timesheet:mixin:WorkProfile'

function planMoves (sessions, lates, profiles, types) {
  const dayStart = new Map(types.map((t) => [t._id, t.dayStartMin]))
  const byEmp = new Map(profiles.map((p) => [p._id, p.shiftType === undefined ? 0 : (dayStart.get(p.shiftType) ?? 0)]))
  const moves = []
  const consider = (kind, doc) => {
    const ds = byEmp.get(doc.employee) ?? 0
    if (ds === 0) return
    const to = istWorkDayStart(doc.punchIn, ds)
    if (to !== doc.date) moves.push({ kind, id: doc._id, employee: doc.employee, from: doc.date, to })
  }
  for (const s of sessions) consider('session', s)
  for (const l of lates) consider('late', l)
  return moves
}

async function main () {
  const TOK = process.env.TOK
  const SOCIAL = process.env.SOCIAL
  const BASE = process.env.BASE ?? 'http://transactor:3333/api/v1'
  const apply = process.argv.includes('--apply')
  if (!TOK || !SOCIAL) throw new Error('set TOK and SOCIAL')
  const WS = JSON.parse(Buffer.from(TOK.split('.')[1], 'base64url').toString()).workspace
  const post = async (path, body) => {
    const r = await fetch(`${BASE}/${path}/${WS}`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const j = await r.json()
    return Array.isArray(j) ? j : (j.value ?? [])
  }
  const find = (_class) => post('find-all', { _class, query: {}, options: {} })
  const [sessions, lates, profiles, types] = await Promise.all([find(SESSION), find(LATE), find(PROFILE), find(SHIFT)])
  const moves = planMoves(sessions, lates, profiles, types)
  const d = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)
  for (const m of moves) console.log(`${apply ? 'MOVE' : 'would move'} ${m.kind} ${m.id} employee ${m.employee}: ${d(m.from)} -> ${d(m.to)}`)
  console.log(`${moves.length} record(s) ${apply ? 'moved' : 'would move'}${apply ? '' : ' (dry run; add --apply to write)'}`)
  if (!apply) return
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('')
  for (const m of moves) {
    await post('tx', {
      _id: hex(12), _class: 'core:class:TxUpdateDoc', space: 'core:space:Tx', modifiedBy: SOCIAL, modifiedOn: Date.now(),
      objectId: m.id, objectClass: m.kind === 'session' ? SESSION : LATE, objectSpace: 'core:space:Workspace',
      operations: { date: m.to }
    })
  }
}

if (require.main === module) main().catch((e) => { console.error(`recompute-workday: ${e.message}`); process.exit(2) })
module.exports = { planMoves, istWorkDayStart, istDayStart }
```

- [ ] **Step 4: Run tests**

Run: `node --test scripts/attendance/test/recompute-workday.test.js`
Expected: 5 PASS.

- [ ] **Step 5: Record changed files (no commit)**

---

### Task 9: Beta build, upgrade and end-to-end verification

**Files:** none new. Uses `huly-migration/huly-selfhost/build-beta.sh`, `run-tool-beta.sh`, compose project `huly_v7` with `compose.yml` + `compose.override.beta.yml`.

- [ ] **Step 1: Full build from the beta worktree**

Run: `cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost && YG_HULY_REPO=/home/karthi_0008/dev/client-projects/yg-huly-beta ./build-beta.sh 2>&1 | tail -20`
Expected: prints `branch: yg_beta`, all 5 images built. Run the printed recreate and nginx restart commands, **and** `./run-tool-beta.sh upgrade-workspace yg` (model change: seeds the shift types).

- [ ] **Step 2: Seed check**

With a beta token (`./run-tool-beta.sh generate-token admin@local yg`), `find-all` `yg-timesheet:class:ShiftType` over `http://localhost:8087/_transactor/api/v1`. Expected: 4 docs Day/UK/US/Aus with the Global Constraints values. Re-run `upgrade-workspace yg`: still exactly 4.

- [ ] **Step 3: Work day end to end (simulated day start)**

The server uses the real clock, so simulate a pre-day-start punch: create a temporary shift type "E2E Test" with `dayStartMin` = current IST minute + 60 (wrap at 1440), assign it to a test employee via `EmployeeJob.shiftType` (Job tab, or REST update of the `yg-hr` EmployeeJob mixin), wait for the sync to set `WorkProfile.shiftType`, then punch that employee in (UI, or REST create of an AttendanceSession as the probe script does). Expected: the session's `date` equals the PREVIOUS IST day's midnight (the punch is before today's day start). Punch out. Then set the type's `dayStartMin` to 0 and punch in again: `date` = today. Archive the test type and unassign the employee afterwards; remove the test sessions.

- [ ] **Step 4: Recompute dry run**

Run the Task 8 script against beta in dry-run mode with `BASE=http://localhost:8087/_transactor/api/v1`. Expected: it lists only sessions of employees with a non-zero day start punched in before that day start, then `N record(s) would move (dry run...)`. Do NOT run `--apply` on beta data unless the listed moves are all expected; if run, a second dry run must print `0 record(s)`.

- [ ] **Step 5: Hand off the UI checks to the user**

List for the user (needs a browser): Timesheet settings > Shifts shows the help panel and four types; the Aus row shows no warning, and setting its day start to 12:00 shows the inside-hours warning; adding "US West" (day start 10:00) works and it appears in the HR Job tab picker with its description; archiving a type with employees shows their names; My Attendance shows "+1 day" next to an after-midnight time of a session filed on the previous work day.

- [ ] **Step 6: Report**

Write results per step (commands, relevant output lines, pass/fail) to the SDD workspace report file named in the dispatch.
