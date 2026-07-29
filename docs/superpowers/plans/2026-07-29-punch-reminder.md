# Punch Reminder (in-app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the Huly portal tab is open, detect (via the Idle Detection API) that an employee is actively working but not correctly punched, and nudge them with an in-app banner + an actionable OS notification — reminder only, never auto-punch.

**Architecture:** A pure jest-tested rule engine (`utils/reminder.ts`) decides `none | punch-in | punch-out` from a snapshot. A global controller component (mounted on every page via `workbench.extensions.WorkbenchExtensions`) feeds it real signals (IdleDetector, punch state, timers) and delivers the result (fixed banner + a notification shown through a Service Worker with action buttons). An org config singleton doc holds the window + intervals; per-user opt-in + snooze live in localStorage.

**Tech Stack:** TypeScript, Svelte 4, `@hcengineering/presentation` live queries, Web `IdleDetector` + `Notification` APIs, a Service Worker (webpack entry, like Huly's existing push SW), jest (ts-jest).

## Global Constraints

- **Branch:** `yg_beta` only. NEVER merge to `yg_develop`. LOCAL/beta demo only.
- **Version pin:** Huly `v0.7.426`. Do not bump `@hcengineering/*` versions (adding a *workspace* dep at `^0.7.426` is allowed).
- **No em-dashes** anywhere (code, comments, copy, commits). Use `-` or `·`.
- **Reminder only - never auto-punch.** Attendance is written only by an explicit user Punch action.
- **Chrome / Chromium** target; degrade gracefully (banner-only) if `IdleDetector`/Notifications are unavailable.
- **Model change ⇒ full rebuild:** the config class + the WorkbenchExtensions mount are model changes ⇒ **full 4-image rebuild + `upgrade-workspace`**. Client webpack heap `--max-old-space-size=6144`; `nvm use 22`; deploy redpanda-first; restart nginx after recreating front.
- **Defaults:** window 09:00-18:00 Mon-Fri, punch-in delay 5 min, repeat 5 min, punch-out idle 15 min.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugins/yg-timesheet-resources/src/utils/reminder.ts` | **New.** Pure rule engine `evaluateReminder` + `ReminderConfig`/`ReminderInput`/`DEFAULT_REMINDER_CONFIG`. |
| `plugins/yg-timesheet-resources/src/utils/__tests__/reminder.test.ts` | **New.** Jest tests (fixed clock). |
| `plugins/yg-timesheet-resources/src/utils/attendance-write.ts` | **New.** Shared `createPunchIn` / `closePunchOut`. |
| `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte` | **Modify.** Use `attendance-write`; add the "Turn on reminders" opt-in control. |
| `plugins/yg-timesheet/src/index.ts` | **Modify.** ids: `class.AttendanceReminderSettings`, `component.AttendanceReminder`, `component.AttendanceReminderSettings`; strings. |
| `plugins/yg-timesheet-assets/lang/{en,ru}.json` | **Modify.** New strings. |
| `models/yg-timesheet/src/index.ts` | **Modify.** `TAttendanceReminderSettings` class; the `ComponentPointExtension` global mount; the settings special. |
| `models/yg-timesheet/package.json` | **Modify.** Add `@hcengineering/model-presentation` dep. |
| `plugins/yg-timesheet-resources/src/components/AttendanceReminderSettings.svelte` | **New.** Admin config form. |
| `plugins/yg-timesheet-resources/src/attendance-reminder-sw.ts` | **New.** Service Worker (notificationclick relay). |
| `dev/prod/webpack.config.js` | **Modify.** Add the SW webpack entry. |
| `plugins/yg-timesheet-resources/src/components/AttendanceReminder.svelte` | **New.** Global controller (IdleDetector + tick + banner + notification + punch). |
| `plugins/yg-timesheet-resources/src/index.ts` | **Modify.** Register the two components. |

Task order: **1** engine → **2** write-extract → **3** config model+ids+lang → **4** settings editor → **5** service worker → **6** controller + opt-in + register → **7** global mount (dep + rush update + extension) → **8** build/deploy/smoke.

---

## Task 1: Pure rule engine (`utils/reminder.ts`)

The decision logic, TDD, no browser deps.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/reminder.ts`
- Test: `plugins/yg-timesheet-resources/src/utils/__tests__/reminder.test.ts`

**Interfaces:**
- Produces: `type ReminderKind = 'none'|'punch-in'|'punch-out'`; `interface ReminderConfig`; `interface ReminderInput`; `const DEFAULT_REMINDER_CONFIG: ReminderConfig`; `evaluateReminder(i: ReminderInput): ReminderKind`.

- [ ] **Step 1: Write the failing test**

Create `plugins/yg-timesheet-resources/src/utils/__tests__/reminder.test.ts`:

```ts
import { evaluateReminder, DEFAULT_REMINDER_CONFIG, type ReminderInput } from '../reminder'

// Fixed clock helpers. 2026-07-29 is a Wednesday (getDay() === 3).
const at = (h: number, m = 0): number => new Date(2026, 6, 29, h, m, 0).getTime()
const cfg = { ...DEFAULT_REMINDER_CONFIG } // 09:00-18:00 Mon-Fri, in 5 / repeat 5 / out-idle 15
const base: ReminderInput = { now: at(10), userActive: true, punchedIn: false, config: cfg }

describe('evaluateReminder - punch-in', () => {
  test('active, unpunched, in window, streak >= delay -> punch-in', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 54) })).toBe('punch-in') // 6 min
  })
  test('streak shorter than delay -> none', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 58) })).toBe('none') // 2 min
  })
  test('idle (not active) -> none', () => {
    expect(evaluateReminder({ ...base, userActive: false, activeUnpunchedSince: at(9, 50) })).toBe('none')
  })
  test('before the work window -> none', () => {
    expect(evaluateReminder({ ...base, now: at(8), activeUnpunchedSince: at(7, 50) })).toBe('none')
  })
  test('weekend day not in config.days -> none', () => {
    const sun = new Date(2026, 6, 26, 10, 0, 0).getTime() // Sunday
    expect(evaluateReminder({ ...base, now: sun, activeUnpunchedSince: sun - 20 * 60000 })).toBe('none')
  })
  test('snoozed -> none until snooze passes', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 50), snoozedUntil: at(10, 5) })).toBe('none')
  })
  test('within repeat interval of last reminder -> none', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 50), lastRemindedAt: at(9, 58) })).toBe('none')
  })
  test('repeat interval elapsed -> punch-in again', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 50), lastRemindedAt: at(9, 54) })).toBe('punch-in')
  })
  test('enabled=false -> none', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 50), config: { ...cfg, enabled: false } })).toBe('none')
  })
})

describe('evaluateReminder - punch-out', () => {
  const inbase: ReminderInput = { now: at(19), userActive: false, punchedIn: true, config: cfg }
  test('past window end while still punched in -> punch-out', () => {
    expect(evaluateReminder({ ...inbase, now: at(18, 30), userActive: true })).toBe('punch-out')
  })
  test('idle >= punchOutIdle while punched in (even off-window) -> punch-out', () => {
    expect(evaluateReminder({ ...inbase, now: at(21), idleSince: at(20, 40) })).toBe('punch-out') // 20 min idle
  })
  test('idle shorter than threshold, inside window -> none', () => {
    expect(evaluateReminder({ ...inbase, now: at(14), idleSince: at(13, 55) })).toBe('none') // 5 min
  })
  test('active, punched in, inside window -> none', () => {
    expect(evaluateReminder({ ...inbase, now: at(14), userActive: true })).toBe('none')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd plugins/yg-timesheet-resources && npx jest reminder.test`
Expected: FAIL — `Cannot find module '../reminder'`.

- [ ] **Step 3: Write the implementation**

Create `plugins/yg-timesheet-resources/src/utils/reminder.ts`:

```ts
//
// YoungGlobes: pure punch-reminder rule engine (Phase 1e). No browser/Svelte deps - the controller
// feeds it a snapshot and delivers the result. Unit-tested in __tests__/reminder.test.ts.
//
export type ReminderKind = 'none' | 'punch-in' | 'punch-out'

export interface ReminderConfig {
  enabled: boolean
  windowStartMin: number // minutes from local midnight, e.g. 540 = 09:00
  windowEndMin: number // e.g. 1080 = 18:00
  days: number[] // allowed local weekdays, 0=Sun..6=Sat
  punchInDelayMin: number // sustained active-without-punch before the first punch-in reminder
  repeatMin: number // re-remind interval
  punchOutIdleMin: number // idle-while-punched-in before a punch-out reminder
}

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  windowStartMin: 9 * 60,
  windowEndMin: 18 * 60,
  days: [1, 2, 3, 4, 5],
  punchInDelayMin: 5,
  repeatMin: 5,
  punchOutIdleMin: 15
}

export interface ReminderInput {
  now: number
  userActive: boolean // IdleDetector userState === 'active' && screen unlocked
  punchedIn: boolean
  activeUnpunchedSince?: number // when the active+unpunched+in-window streak began (controller-tracked)
  idleSince?: number // when the user went idle; undefined while active
  snoozedUntil?: number
  lastRemindedAt?: number
  config: ReminderConfig
}

const MIN = 60_000

function minutesSinceMidnight (now: number): number {
  const d = new Date(now)
  return d.getHours() * 60 + d.getMinutes()
}
function isWorkDay (now: number, c: ReminderConfig): boolean {
  return c.days.includes(new Date(now).getDay())
}
function inWorkWindow (now: number, c: ReminderConfig): boolean {
  const mins = minutesSinceMidnight(now)
  return isWorkDay(now, c) && mins >= c.windowStartMin && mins < c.windowEndMin
}

export function evaluateReminder (i: ReminderInput): ReminderKind {
  const c = i.config
  if (!c.enabled) return 'none'

  // Snooze + repeat gate: not snoozed, and at least repeatMin since the last reminder.
  const gateOpen =
    i.now >= (i.snoozedUntil ?? 0) &&
    (i.lastRemindedAt === undefined || i.now - i.lastRemindedAt >= c.repeatMin * MIN)
  if (!gateOpen) return 'none'

  if (i.punchedIn) {
    const idleLong = i.idleSince !== undefined && i.now - i.idleSince >= c.punchOutIdleMin * MIN
    const pastEnd = isWorkDay(i.now, c) && minutesSinceMidnight(i.now) >= c.windowEndMin
    return idleLong || pastEnd ? 'punch-out' : 'none'
  }

  if (!inWorkWindow(i.now, c)) return 'none'
  if (!i.userActive) return 'none'
  if (i.activeUnpunchedSince === undefined) return 'none'
  return i.now - i.activeUnpunchedSince >= c.punchInDelayMin * MIN ? 'punch-in' : 'none'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd plugins/yg-timesheet-resources && npx jest reminder.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/reminder.ts \
        plugins/yg-timesheet-resources/src/utils/__tests__/reminder.test.ts
git commit -m "yg-timesheet: pure punch-reminder rule engine + tests"
```

---

## Task 2: Shared punch-write helpers (`utils/attendance-write.ts`)

Extract the create/close writes so the page and the reminder controller punch through one place.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/attendance-write.ts`
- Modify: `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte`

**Interfaces:**
- Consumes: `localMidnight` from `./attendance`.
- Produces: `createPunchIn(client, employee, mode, note?)`, `closePunchOut(client, sessionId, note?)`.

- [ ] **Step 1: Write the helper**

Create `plugins/yg-timesheet-resources/src/utils/attendance-write.ts`:

```ts
//
// YoungGlobes: the only two attendance writes - punch in (create) and punch out (close). Shared by
// the My Attendance page and the reminder controller so both go through identical logic.
//
import core, { type Ref, type TxOperations } from '@hcengineering/core'
import { type Employee } from '@hcengineering/contact'
import ygTimesheet, { type AttendanceMode, type AttendanceSession } from '@hcengineering/yg-timesheet'
import { localMidnight } from './attendance'

export async function createPunchIn (
  client: TxOperations, employee: Ref<Employee>, mode: AttendanceMode, note?: string
): Promise<void> {
  const at = Date.now()
  const trimmed = (note ?? '').trim()
  await client.createDoc(ygTimesheet.class.AttendanceSession, core.space.Workspace, {
    employee,
    date: localMidnight(at),
    punchIn: at,
    mode,
    ...(trimmed !== '' ? { punchInNote: trimmed } : {})
  })
}

export async function closePunchOut (
  client: TxOperations, sessionId: Ref<AttendanceSession>, note?: string
): Promise<void> {
  const at = Date.now()
  const trimmed = (note ?? '').trim()
  await client.updateDoc(ygTimesheet.class.AttendanceSession, core.space.Workspace, sessionId, {
    punchOut: at,
    ...(trimmed !== '' ? { punchOutNote: trimmed } : {})
  })
}
```

- [ ] **Step 2: Refactor MyAttendance.svelte to use them**

In `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte`, add the import (after the `../utils/attendance` import):

```ts
  import { createPunchIn, closePunchOut } from '../utils/attendance-write'
```

Replace the body of the existing `punchIn` function's `try` block (the `const at = Date.now()` ... `client.createDoc(...)` lines) so the whole function reads:

```ts
  async function punchIn (): Promise<void> {
    if (punchedIn || busy) return
    busy = true
    try {
      await createPunchIn(client, me, mode, note)
      note = ''
    } finally {
      busy = false
    }
  }
```

Replace `punchOut` likewise:

```ts
  async function punchOut (): Promise<void> {
    if (openSession === undefined || busy) return
    busy = true
    try {
      await closePunchOut(client, openSession._id, note)
      note = ''
    } finally {
      busy = false
    }
  }
```

(The `localMidnight` import in MyAttendance may now be unused only if nothing else uses it - it is still used by `todayMid`, so leave it.)

- [ ] **Step 3: Verify build + tests**

Run: `cd plugins/yg-timesheet-resources && npm run svelte-check 2>&1 | grep -iE 'attendance-write|MyAttendance' | grep -i error || echo "no new errors"` then `npx jest`
Expected: `no new errors`; jest still passes.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/attendance-write.ts \
        plugins/yg-timesheet-resources/src/components/MyAttendance.svelte
git commit -m "yg-timesheet: extract shared punch-in/out writes (attendance-write.ts)"
```

---

## Task 3: Config model + plugin ids + strings

The org settings singleton class, the component/string ids the later tasks reference, and the lang strings.

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts`, `models/yg-timesheet/src/index.ts`, `plugins/yg-timesheet-assets/lang/en.json`, `plugins/yg-timesheet-assets/lang/ru.json`

**Interfaces:**
- Produces: `AttendanceReminderSettings` type + `ygTimesheet.class.AttendanceReminderSettings`; `ygTimesheet.component.{AttendanceReminder, AttendanceReminderSettings}`; strings `ReminderSettings, PunchReminders, EnableReminders, DisableReminders, RemindersOn, RemindersOff, ReminderPunchInTitle, ReminderPunchInBody, ReminderPunchOutTitle, ReminderPunchOutBody, PunchIn (exists), PunchOut (exists), Snooze, WorkWindow, WorkDays, PunchInDelay, RepeatEvery, PunchOutIdle, Minutes, Enabled`.

- [ ] **Step 1: Add the interface (plugin)**

In `plugins/yg-timesheet/src/index.ts`, after the `AttendanceSession` interface, add:

```ts
/** Org-wide punch-reminder settings. Singleton (zero or one doc); code falls back to defaults when absent. */
export interface AttendanceReminderSettings extends Doc {
  enabled: boolean
  windowStartMin: number
  windowEndMin: number
  days: number[]
  punchInDelayMin: number
  repeatMin: number
  punchOutIdleMin: number
}
```

- [ ] **Step 2: Register class + component + string ids (plugin)**

In the `class` map add: `AttendanceReminderSettings: '' as Ref<Class<AttendanceReminderSettings>>` (after `AttendanceSession`).

In the `component` map add (after `HrAttendance`):

```ts
    HrAttendance: '' as AnyComponent,
    AttendanceReminder: '' as AnyComponent,
    AttendanceReminderSettings: '' as AnyComponent
```

In the `string` map add (after `Type`):

```ts
    ReminderSettings: '' as IntlString,
    PunchReminders: '' as IntlString,
    EnableReminders: '' as IntlString,
    DisableReminders: '' as IntlString,
    RemindersOn: '' as IntlString,
    RemindersOff: '' as IntlString,
    ReminderPunchInTitle: '' as IntlString,
    ReminderPunchInBody: '' as IntlString,
    ReminderPunchOutTitle: '' as IntlString,
    ReminderPunchOutBody: '' as IntlString,
    Snooze: '' as IntlString,
    WorkWindow: '' as IntlString,
    WorkDays: '' as IntlString,
    PunchInDelay: '' as IntlString,
    RepeatEvery: '' as IntlString,
    PunchOutIdle: '' as IntlString,
    Minutes: '' as IntlString,
    Enabled: '' as IntlString
```

- [ ] **Step 3: Regenerate plugin types AND rebuild the plugin lib**

Run: `cd plugins/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:validate`
Expected: `Validate time: ...`, no TS errors.

Then rebuild, from the repo root: `node common/scripts/install-run-rush.js build`

**This second command is mandatory, not optional.** `_phase:validate` (`compile validate`) emits
only the type declarations in `types/`. The runtime id *values* live in `lib/index.js`, emitted by
`_phase:build`. Consumers resolve this package through its `main` field (`lib/index.js`), so if the
lib is stale: the model's `@Model`/`createDoc` decorators register against `undefined` ids (the new
class and the ComponentPointExtension never reach `model.json`) and the front bundle embeds stale
ids. Everything typechecks and every build exits 0 - it fails silently at runtime. Rebuild the
dependents too (resources, model, models/all), which the root `rush build` handles.

- [ ] **Step 4: Add the model class**

In `models/yg-timesheet/src/index.ts`, extend the `@hcengineering/yg-timesheet` import to include `type AttendanceReminderSettings`. After `TAttendanceSession`, add:

```ts
@Model(ygTimesheet.class.AttendanceReminderSettings, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TAttendanceReminderSettings extends TDoc implements AttendanceReminderSettings {
  @Prop(TypeBoolean(), core.string.Object) enabled!: boolean
  @Prop(TypeNumber(), core.string.Object) windowStartMin!: number
  @Prop(TypeNumber(), core.string.Object) windowEndMin!: number
  @Prop(ArrOf(TypeNumber()), core.string.Object) days!: number[]
  @Prop(TypeNumber(), core.string.Object) punchInDelayMin!: number
  @Prop(TypeNumber(), core.string.Object) repeatMin!: number
  @Prop(TypeNumber(), core.string.Object) punchOutIdleMin!: number
}
```

Add `TypeBoolean` to the `@hcengineering/model` import (alongside `TypeNumber`). Add `TAttendanceReminderSettings` to the `builder.createModel(...)` call.

- [ ] **Step 5: Build the model package**

Run: `cd models/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build`
Expected: `Transpile time: ...`, exit 0.

- [ ] **Step 6: Lang strings (en then ru; parity test gates)**

In `lang/en.json`, after the last string, append (mind the trailing comma on the prior line):

```json
    "ReminderSettings": "Punch reminders",
    "PunchReminders": "Punch reminders",
    "EnableReminders": "Turn on punch reminders",
    "DisableReminders": "Turn off punch reminders",
    "RemindersOn": "Reminders are on",
    "RemindersOff": "Reminders are off",
    "ReminderPunchInTitle": "You're not punched in",
    "ReminderPunchInBody": "You've been active without punching in. Punch in to track this time.",
    "ReminderPunchOutTitle": "Still on the clock",
    "ReminderPunchOutBody": "You're still punched in. Punch out if you've stopped working.",
    "Snooze": "Snooze",
    "WorkWindow": "Work hours",
    "WorkDays": "Work days",
    "PunchInDelay": "Remind after (min active)",
    "RepeatEvery": "Repeat every (min)",
    "PunchOutIdle": "Punch-out after idle (min)",
    "Minutes": "min",
    "Enabled": "Enabled"
```

Run `cd plugins/yg-timesheet-assets && npx jest` → FAIL (ru missing keys). Then append to `lang/ru.json`:

```json
    "ReminderSettings": "Напоминания об отметках",
    "PunchReminders": "Напоминания об отметках",
    "EnableReminders": "Включить напоминания об отметках",
    "DisableReminders": "Выключить напоминания об отметках",
    "RemindersOn": "Напоминания включены",
    "RemindersOff": "Напоминания выключены",
    "ReminderPunchInTitle": "Вы не отметили приход",
    "ReminderPunchInBody": "Вы активны, но не отметили приход. Отметьте приход, чтобы учесть это время.",
    "ReminderPunchOutTitle": "Вы всё ещё на смене",
    "ReminderPunchOutBody": "Вы всё ещё отмечены как на смене. Отметьте уход, если закончили работу.",
    "Snooze": "Отложить",
    "WorkWindow": "Рабочие часы",
    "WorkDays": "Рабочие дни",
    "PunchInDelay": "Напомнить после (мин активности)",
    "RepeatEvery": "Повторять каждые (мин)",
    "PunchOutIdle": "Напомнить об уходе после простоя (мин)",
    "Minutes": "мин",
    "Enabled": "Включено"
```

Run `cd plugins/yg-timesheet-assets && npx jest` → PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts models/yg-timesheet/src/index.ts \
        plugins/yg-timesheet-assets/lang/en.json plugins/yg-timesheet-assets/lang/ru.json
git commit -m "yg-timesheet: AttendanceReminderSettings class + reminder ids/strings"
```

---

## Task 4: Settings editor (`AttendanceReminderSettings.svelte`)

Admin form to edit the org config singleton; registered as a special in the Timesheet **Configuration** area.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/AttendanceReminderSettings.svelte`
- Modify: `plugins/yg-timesheet-resources/src/index.ts` (register component); `models/yg-timesheet/src/index.ts` (add a `reminders` special to the Timesheet app, `accessLevel: Maintainer`, position bottom).

**Interfaces:**
- Consumes: `ygTimesheet.class.AttendanceReminderSettings`; `DEFAULT_REMINDER_CONFIG` from `../utils/reminder`.
- Produces: the `AttendanceReminderSettings` component resource.

- [ ] **Step 1: Write the component**

Create `plugins/yg-timesheet-resources/src/components/AttendanceReminderSettings.svelte`:

```svelte
<script lang="ts">
  import core from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import ui, { Label } from '@hcengineering/ui'
  import ygTimesheet, { type AttendanceReminderSettings } from '@hcengineering/yg-timesheet'
  import { DEFAULT_REMINDER_CONFIG } from '../utils/reminder'

  const client = getClient()
  const query = createQuery()
  let doc: AttendanceReminderSettings | undefined
  let form = { ...DEFAULT_REMINDER_CONFIG }
  query.query(ygTimesheet.class.AttendanceReminderSettings, {}, (res) => {
    doc = res[0]
    if (doc !== undefined) {
      form = {
        enabled: doc.enabled,
        windowStartMin: doc.windowStartMin,
        windowEndMin: doc.windowEndMin,
        days: [...doc.days],
        punchInDelayMin: doc.punchInDelayMin,
        repeatMin: doc.repeatMin,
        punchOutIdleMin: doc.punchOutIdleMin
      }
    }
  })

  const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  const toMin = (v: string): number => {
    const [h, m] = v.split(':').map((n) => parseInt(n, 10))
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)
  }
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  function toggleDay (d: number): void {
    form.days = form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d].sort((a, b) => a - b)
  }

  let saving = false
  async function save (): Promise<void> {
    saving = true
    try {
      if (doc !== undefined) {
        await client.updateDoc(ygTimesheet.class.AttendanceReminderSettings, core.space.Workspace, doc._id, { ...form })
      } else {
        await client.createDoc(ygTimesheet.class.AttendanceReminderSettings, core.space.Workspace, { ...form })
      }
    } finally {
      saving = false
    }
  }
</script>

<div class="yg-page">
  <div class="yg-head"><h1 class="yg-title"><Label label={ygTimesheet.string.ReminderSettings} /></h1></div>
  <div class="rs-form">
    <label class="rs-row"><span><Label label={ygTimesheet.string.Enabled} /></span>
      <input type="checkbox" bind:checked={form.enabled} /></label>
    <label class="rs-row"><span><Label label={ygTimesheet.string.WorkWindow} /></span>
      <span><input class="yg-input" type="time" value={hhmm(form.windowStartMin)} on:change={(e) => (form.windowStartMin = toMin(e.currentTarget.value))} />
        -
        <input class="yg-input" type="time" value={hhmm(form.windowEndMin)} on:change={(e) => (form.windowEndMin = toMin(e.currentTarget.value))} /></span></label>
    <div class="rs-row"><span><Label label={ygTimesheet.string.WorkDays} /></span>
      <span class="rs-days">{#each DOW as name, d}
        <button class="rs-day" class:on={form.days.includes(d)} on:click={() => toggleDay(d)}>{name}</button>
      {/each}</span></div>
    <label class="rs-row"><span><Label label={ygTimesheet.string.PunchInDelay} /></span>
      <input class="yg-input rs-num" type="number" min="1" bind:value={form.punchInDelayMin} /></label>
    <label class="rs-row"><span><Label label={ygTimesheet.string.RepeatEvery} /></span>
      <input class="yg-input rs-num" type="number" min="1" bind:value={form.repeatMin} /></label>
    <label class="rs-row"><span><Label label={ygTimesheet.string.PunchOutIdle} /></span>
      <input class="yg-input rs-num" type="number" min="1" bind:value={form.punchOutIdleMin} /></label>
    <div class="rs-actions">
      <button class="yg-btn yg-btn--primary" disabled={saving} on:click={save}><Label label={ui.string.Save} /></button>
    </div>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;
  .rs-form { display: flex; flex-direction: column; gap: 14px; max-width: 520px; padding: 1rem 1.25rem; }
  .rs-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .rs-row > span:first-child { color: var(--yg-text-dim); font-size: 13px; }
  .rs-num { width: 80px; }
  .rs-days { display: inline-flex; gap: 4px; }
  .rs-day { appearance: none; border: 1px solid var(--yg-border); background: var(--yg-panel-soft); color: var(--yg-text-dim); border-radius: 7px; padding: 5px 9px; font: inherit; font-size: 12px; cursor: pointer; }
  .rs-day.on { background: var(--yg-ink); color: var(--yg-ink-fg); border-color: transparent; }
  .rs-actions { margin-top: 6px; }
</style>
```

- [ ] **Step 2: Register the component**

In `plugins/yg-timesheet-resources/src/index.ts` add the import and the map entry:

```ts
import AttendanceReminderSettings from './components/AttendanceReminderSettings.svelte'
```
and in the `component` map (after `HrAttendance`): `HrAttendance,\n    AttendanceReminderSettings,`

- [ ] **Step 3: Add the settings special to the Timesheet app**

In `models/yg-timesheet/src/index.ts`, in the **Timesheet** app `createDoc` (`ygTimesheet.app.Timesheet`), add a special after `projects` (the Configuration one), `position: 'bottom'`:

```ts
          {
            id: 'reminders',
            label: ygTimesheet.string.ReminderSettings,
            icon: setting.icon.Setting,
            component: ygTimesheet.component.AttendanceReminderSettings,
            accessLevel: AccountRole.Maintainer,
            position: 'bottom'
          }
```

(`setting` and `AccountRole` are already imported in this file.)

- [ ] **Step 4: Verify**

Run: `cd plugins/yg-timesheet-resources && npm run svelte-check 2>&1 | grep -i 'AttendanceReminderSettings' | grep -i error || echo "clean"` ; `cd ../../models/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build 2>&1 | tail -1`
Expected: `clean`; model transpiles.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/AttendanceReminderSettings.svelte \
        plugins/yg-timesheet-resources/src/index.ts models/yg-timesheet/src/index.ts
git commit -m "yg-timesheet: admin punch-reminder settings editor + special"
```

---

## Task 5: Service Worker (`attendance-reminder-sw.ts` + webpack entry)

A minimal worker whose only job is to make the notification actionable: on click, focus the portal and relay the chosen action to the page.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/attendance-reminder-sw.ts`
- Modify: `dev/prod/webpack.config.js`

**Interfaces:**
- Produces: `/attendance-reminder-sw.js` served at origin root. Posts `{ type: 'yg-punch-reminder-action', action }` to page clients on notification click.

- [ ] **Step 1: Write the service worker**

Create `plugins/yg-timesheet-resources/src/attendance-reminder-sw.ts`:

```ts
//
// YoungGlobes: punch-reminder service worker. The page (AttendanceReminder.svelte) shows the
// notification via registration.showNotification with action buttons; this worker handles the click:
// focus/open the portal and relay the chosen action to the page, which performs the punch/snooze.
// No push, no DOM, no app imports - worker context only.
//
declare const self: ServiceWorkerGlobalScope

self.addEventListener('install', () => {
  void self.skipWaiting()
})
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  // 'punch' when a button is clicked; '' (body click) is treated as focus + punch too. 'snooze' snoozes.
  const action = event.action === 'snooze' ? 'snooze' : 'punch'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const client = all.find((c) => c.url.includes('/workbench/')) ?? all[0]
      if (client !== undefined) {
        await client.focus()
        client.postMessage({ type: 'yg-punch-reminder-action', action })
      } else if (self.clients.openWindow !== undefined) {
        await self.clients.openWindow('/')
      }
    })()
  )
})
```

- [ ] **Step 2: Add the webpack entry**

In `dev/prod/webpack.config.js`, find the dedicated service-worker config block whose `entry` is `{ serviceWorker: '@hcengineering/notification/src/serviceWorker.ts' }` and add a second key so it reads:

```js
    entry: {
      serviceWorker: '@hcengineering/notification/src/serviceWorker.ts',
      'attendance-reminder-sw': '@hcengineering/yg-timesheet-resources/src/attendance-reminder-sw.ts'
    },
```

(Output already uses `filename: '[name].js'` + `publicPath: '/'`, so this emits `dist/attendance-reminder-sw.js` served at `/attendance-reminder-sw.js`. `@hcengineering/yg-timesheet-resources` is already a `dev/prod` dependency.)

- [ ] **Step 3: Verify it emits (after a front build, in Task 8) + compile-check the TS now**

Run: `cd plugins/yg-timesheet-resources && npx tsc --noEmit -p tsconfig.json 2>&1 | grep attendance-reminder-sw || echo "sw ts compiles (or only lib-dom worker warnings)"`
Note: the worker references `ServiceWorkerGlobalScope`/`ExtendableEvent`/`NotificationEvent` (WebWorker lib types). If tsc complains about missing worker types, that is expected under the DOM tsconfig - the real compile is esbuild-loader at webpack time (Task 8), which targets the worker fine. Do not add `lib: webworker` to the shared tsconfig.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/attendance-reminder-sw.ts dev/prod/webpack.config.js
git commit -m "yg-timesheet: punch-reminder service worker + webpack entry"
```

---

## Task 6: Reminder controller + opt-in (`AttendanceReminder.svelte`)

The engine's driver: IdleDetector, the tick, the banner, the OS notification, and the punch actions; plus the one-time opt-in on My Attendance.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/AttendanceReminder.svelte`
- Modify: `plugins/yg-timesheet-resources/src/index.ts` (register); `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte` (opt-in control).

**Interfaces:**
- Consumes: `evaluateReminder`, `DEFAULT_REMINDER_CONFIG` (`../utils/reminder`); `createPunchIn`, `closePunchOut` (`../utils/attendance-write`); `findOpenSession`, `nextMode`, `localMidnight` (`../utils/attendance`); `ygTimesheet.class.{AttendanceSession, AttendanceReminderSettings}`.
- Produces: the `AttendanceReminder` component (mounted globally in Task 7). localStorage keys: `yg-punch-reminders-optin` ('on'/'off'), and in-memory snooze/lastReminded.

- [ ] **Step 1: Write the controller**

Create `plugins/yg-timesheet-resources/src/components/AttendanceReminder.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { getCurrentEmployee } from '@hcengineering/contact'
  import core from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label, translate } from '@hcengineering/ui'
  import { themeStore } from '@hcengineering/ui'
  import ygTimesheet, { type AttendanceSession, type AttendanceReminderSettings } from '@hcengineering/yg-timesheet'
  import { evaluateReminder, DEFAULT_REMINDER_CONFIG, type ReminderConfig, type ReminderKind } from '../utils/reminder'
  import { createPunchIn, closePunchOut } from '../utils/attendance-write'
  import { findOpenSession, nextMode, localMidnight } from '../utils/attendance'

  const OPT_IN_KEY = 'yg-punch-reminders-optin'
  const optedIn = (): boolean => (typeof localStorage !== 'undefined' && localStorage.getItem(OPT_IN_KEY) === 'on')

  const me = getCurrentEmployee()
  const client = getClient()

  // Org config (singleton; defaults when absent).
  const cfgQuery = createQuery()
  let config: ReminderConfig = { ...DEFAULT_REMINDER_CONFIG }
  cfgQuery.query(ygTimesheet.class.AttendanceReminderSettings, {}, (res: AttendanceReminderSettings[]) => {
    const d = res[0]
    if (d !== undefined) {
      config = {
        enabled: d.enabled, windowStartMin: d.windowStartMin, windowEndMin: d.windowEndMin,
        days: d.days, punchInDelayMin: d.punchInDelayMin, repeatMin: d.repeatMin, punchOutIdleMin: d.punchOutIdleMin
      }
    }
  })

  // My sessions -> punch state (reuse findOpenSession).
  const sessQuery = createQuery()
  let mySessions: AttendanceSession[] = []
  sessQuery.query(ygTimesheet.class.AttendanceSession, { space: core.space.Workspace, employee: me }, (res) => {
    mySessions = res
  })
  $: openSession = findOpenSession(mySessions)
  $: punchedIn = openSession !== undefined

  // Idle + streak tracking (controller-owned; the pure engine consumes these).
  let userActive = true
  let idleSince: number | undefined
  let activeUnpunchedSince: number | undefined
  let snoozedUntil: number | undefined
  let lastRemindedAt: number | undefined

  let idleDetector: any
  let tick: ReturnType<typeof setInterval> | undefined
  let bannerKind: ReminderKind = 'none'
  let notifTitle = ''
  let notifBody = ''

  async function loadStrings (): Promise<void> {
    // Prefetch the notification copy (translate returns a promise; cache both kinds).
    inTitle = await translate(ygTimesheet.string.ReminderPunchInTitle, {}, $themeStore.language)
    inBody = await translate(ygTimesheet.string.ReminderPunchInBody, {}, $themeStore.language)
    outTitle = await translate(ygTimesheet.string.ReminderPunchOutTitle, {}, $themeStore.language)
    outBody = await translate(ygTimesheet.string.ReminderPunchOutBody, {}, $themeStore.language)
  }
  let inTitle = ''; let inBody = ''; let outTitle = ''; let outBody = ''

  function refreshStreak (): void {
    // A "streak" is active + unpunched + inside the work window. Reset when any breaks.
    const now = Date.now()
    const inWindow = config.days.includes(new Date(now).getDay()) &&
      (() => { const m = new Date(now).getHours() * 60 + new Date(now).getMinutes(); return m >= config.windowStartMin && m < config.windowEndMin })()
    if (userActive && !punchedIn && inWindow) {
      if (activeUnpunchedSince === undefined) activeUnpunchedSince = now
    } else {
      activeUnpunchedSince = undefined
    }
  }

  async function showOsNotification (kind: ReminderKind): Promise<void> {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.ready
    const title = kind === 'punch-in' ? inTitle : outTitle
    const body = kind === 'punch-in' ? inBody : outBody
    await reg.showNotification(title, {
      body,
      tag: 'yg-punch-reminder',
      renotify: true,
      requireInteraction: false,
      actions: [
        { action: 'punch', title: kind === 'punch-in' ? 'Punch in' : 'Punch out' },
        { action: 'snooze', title: 'Snooze' }
      ]
    } as NotificationOptions)
  }

  async function doPunch (): Promise<void> {
    const todayMid = localMidnight(Date.now())
    const todays = mySessions.filter((s) => s.date === todayMid)
    if (punchedIn && openSession !== undefined) await closePunchOut(client, openSession._id)
    else if (!punchedIn) await createPunchIn(client, me, nextMode(todays))
    bannerKind = 'none'
  }
  function snooze (): void {
    snoozedUntil = Date.now() + config.repeatMin * 60_000
    bannerKind = 'none'
  }

  function evaluate (): void {
    if (!optedIn()) { bannerKind = 'none'; return }
    refreshStreak()
    const kind = evaluateReminder({
      now: Date.now(), userActive, punchedIn, activeUnpunchedSince, idleSince, snoozedUntil, lastRemindedAt, config
    })
    if (kind !== 'none') {
      bannerKind = kind
      lastRemindedAt = Date.now()
      void showOsNotification(kind)
    }
  }

  function onSwMessage (e: MessageEvent): void {
    if (e.data?.type !== 'yg-punch-reminder-action') return
    if (e.data.action === 'snooze') snooze()
    else void doPunch()
  }

  onMount(() => {
    if (!optedIn()) return
    void loadStrings()
    // Idle detection (whole-machine). Falls back to always-active if unsupported/denied.
    const IdleDetectorCtor = (window as any).IdleDetector
    if (IdleDetectorCtor !== undefined) {
      try {
        idleDetector = new IdleDetectorCtor()
        idleDetector.addEventListener('change', () => {
          const active = idleDetector.userState === 'active' && idleDetector.screenState === 'unlocked'
          if (active) { userActive = true; idleSince = undefined } else { userActive = false; if (idleSince === undefined) idleSince = Date.now() }
        })
        void idleDetector.start({ threshold: 60_000 })
      } catch (e) { userActive = true }
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onSwMessage)
    tick = setInterval(evaluate, 30_000)
    evaluate()
  })
  onDestroy(() => {
    if (tick !== undefined) clearInterval(tick)
    if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onSwMessage)
    try { idleDetector?.stop?.() } catch (e) { /* ignore */ }
  })
</script>

{#if bannerKind !== 'none'}
  <div class="yg-punch-banner" role="alert">
    <span class="yg-punch-banner__msg">
      <Label label={bannerKind === 'punch-in' ? ygTimesheet.string.ReminderPunchInTitle : ygTimesheet.string.ReminderPunchOutTitle} />
    </span>
    <button class="yg-btn yg-btn--primary" on:click={() => void doPunch()}>
      <Label label={bannerKind === 'punch-in' ? ygTimesheet.string.PunchIn : ygTimesheet.string.PunchOut} />
    </button>
    <button class="yg-btn yg-btn--ghost" on:click={snooze}><Label label={ygTimesheet.string.Snooze} /></button>
  </div>
{/if}

<style lang="scss">
  @use './components/yg-table' as *;
  .yg-punch-banner {
    position: fixed; z-index: 1000; right: 20px; bottom: 20px;
    display: flex; align-items: center; gap: 12px;
    background: var(--yg-panel); border: 1px solid var(--yg-border-strong);
    border-radius: 12px; box-shadow: 0 12px 40px rgba(10, 12, 25, 0.28); padding: 12px 16px;
  }
  .yg-punch-banner__msg { font-weight: 640; color: var(--yg-text); }
</style>
```

Note on the `@use` path: `AttendanceReminder.svelte` sits in `components/`, so the partial is `'./yg-table'` (like the other components). Fix the `@use` to `@use './yg-table' as *;` (the `./components/yg-table` above is wrong - correct it when creating the file).

- [ ] **Step 2: Add the opt-in control to My Attendance**

In `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte`, add near the top of `<script>`:

```ts
  const REMINDER_OPT_IN_KEY = 'yg-punch-reminders-optin'
  let remindersOn = typeof localStorage !== 'undefined' && localStorage.getItem(REMINDER_OPT_IN_KEY) === 'on'
  async function enableReminders (): Promise<void> {
    let ok = false
    try {
      const perm = typeof Notification !== 'undefined' ? await Notification.requestPermission() : 'denied'
      let idleOk = true
      const IdleDetectorCtor = (window as any).IdleDetector
      if (IdleDetectorCtor?.requestPermission !== undefined) {
        idleOk = (await IdleDetectorCtor.requestPermission()) === 'granted'
      }
      if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/attendance-reminder-sw.js', { scope: '/' })
      ok = perm === 'granted' && idleOk
    } catch (e) { ok = false }
    localStorage.setItem(REMINDER_OPT_IN_KEY, ok ? 'on' : 'off')
    remindersOn = ok
    if (ok) location.reload() // let the global controller pick up the opt-in
  }
  function disableReminders (): void {
    localStorage.setItem(REMINDER_OPT_IN_KEY, 'off')
    remindersOn = false
  }
```

And in the markup, inside the punch card (after the `att-cta` button), add:

```svelte
    {#if remindersOn}
      <button class="att-reminder-toggle" on:click={disableReminders}><Label label={ygTimesheet.string.DisableReminders} /></button>
    {:else}
      <button class="att-reminder-toggle" on:click={() => void enableReminders()}><Label label={ygTimesheet.string.EnableReminders} /></button>
    {/if}
```

Add a small style: `.att-reminder-toggle { align-self: flex-start; background: none; border: 0; color: var(--yg-text-dim); font: inherit; font-size: 12px; text-decoration: underline; cursor: pointer; padding: 0; }`

- [ ] **Step 3: Register the controller component**

In `plugins/yg-timesheet-resources/src/index.ts`: `import AttendanceReminder from './components/AttendanceReminder.svelte'` and add `AttendanceReminder,` to the `component` map.

- [ ] **Step 4: Verify**

Run: `cd plugins/yg-timesheet-resources && npm run svelte-check 2>&1 | grep -iE 'AttendanceReminder|MyAttendance' | grep -i error || echo "clean"` ; `npm run build`
Expected: `clean`; build exits 0. (Casts to `any` for `IdleDetector`/`idleDetector` are deliberate - the API has no TS lib types yet.)

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/AttendanceReminder.svelte \
        plugins/yg-timesheet-resources/src/components/MyAttendance.svelte \
        plugins/yg-timesheet-resources/src/index.ts
git commit -m "yg-timesheet: punch-reminder controller + opt-in"
```

---

## Task 7: Global mount (WorkbenchExtensions)

Mount the controller on every page via the native extension slot.

**Files:**
- Modify: `models/yg-timesheet/package.json` (add dep); `models/yg-timesheet/src/index.ts` (register the extension).

**Interfaces:**
- Consumes: `ygTimesheet.component.AttendanceReminder`; `workbench.extensions.WorkbenchExtensions`; `presentation.class.ComponentPointExtension`.

- [ ] **Step 1: Add the dependency**

In `models/yg-timesheet/package.json`, add to `dependencies` (keep alphabetical-ish; match the existing `workspace:^0.7.426` style):

```json
    "@hcengineering/model-presentation": "workspace:^0.7.426",
```

- [ ] **Step 2: Install the new dependency**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly && node common/scripts/install-run-rush.js update`
Expected: rush updates the lockfile + links `@hcengineering/model-presentation` into `models/yg-timesheet`. (Takes a few minutes.)

- [ ] **Step 3: Register the extension**

In `models/yg-timesheet/src/index.ts`, add the import `import presentation from '@hcengineering/model-presentation'` (near the other model imports). In `createModel`, after the mixins, add:

```ts
  // Mount the punch-reminder controller on every workbench page (native global slot; renders only a
  // fixed-position banner + fires notifications, so the hidden extension host is fine). presence/love
  // use this exact pattern.
  builder.createDoc(presentation.class.ComponentPointExtension, core.space.Model, {
    extension: workbench.extensions.WorkbenchExtensions,
    component: ygTimesheet.component.AttendanceReminder
  })
```

(`workbench` is already imported as `@hcengineering/model-workbench`; confirm `workbench.extensions.WorkbenchExtensions` resolves - it is defined in `plugins/workbench/src/plugin.ts`.)

- [ ] **Step 4: Verify the model builds with the new dep**

Run: `cd models/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build`
Expected: `Transpile time: ...`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add models/yg-timesheet/package.json models/yg-timesheet/src/index.ts \
        common/config/rush/pnpm-lock.yaml
git commit -m "yg-timesheet: mount punch-reminder controller via WorkbenchExtensions"
```

---

## Task 8: Build images, upgrade workspace, smoke test

**Files:** none (build + deploy + verify).

**Preconditions:** free RAM (stop the running stack + heavy dev containers); `nvm use 22`.

- [ ] **Step 1: Rebuild all four beta images**

Run the beta build script (rebuilds `yg-local/{front,workspace,transactor,tool}:beta`, `--max-old-space-size=6144` baked in). If the scratchpad script is gone, recreate it: `rush build` -> `dev/prod` `rushx package` -> bundle+`docker build` each of `pods/front`, `pods/workspace`, `pods/server`, `dev/tool` tagged `yg-local/*:beta`.
Expected: `docker images | grep yg-local` shows fresh timestamps; the front `dist` contains `attendance-reminder-sw.js` (verify: `docker run --rm yg-local/front:beta sh -c 'ls /app/dist/attendance-reminder-sw.js'`).

**Also verify the generated model actually picked up the new ids** (catches the stale-plugin-lib
trap in Task 3 Step 3, which otherwise deploys a healthy-looking stack with the whole feature
inert):

```bash
grep -o "yg-timesheet:class:AttendanceReminderSettings" pods/server/bundle/model.json
grep -o "yg-timesheet:component:AttendanceReminder\"" pods/server/bundle/model.json
grep -o "presentation:class:ComponentPointExtension" pods/server/bundle/model.json
```

All three must print a match. (Strings used only by front components, e.g. `Snooze`, correctly do
NOT appear in `model.json` - check `yg-timesheet:string:ReminderSettings`, which the settings
special's label references.)

- [ ] **Step 2: Deploy + upgrade + nginx restart**

```bash
cd <deploy-dir>
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d redpanda
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d --force-recreate front workspace transactor
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d
./run-tool-beta.sh upgrade-workspace testws
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
```
Expected: `upgrade-workspace done`; front HTTP 200.

- [ ] **Step 3: Smoke test in the browser (Chrome)**

- [ ] On My Attendance, **Turn on punch reminders** -> Chrome prompts for Notification + Idle Detection; accept both. The label flips to "Turn off".
- [ ] In **Configuration -> Punch reminders** (as admin), set the window to include now and set the punch-in delay to 1 min (for testing); Save.
- [ ] With **no open session**, stay active for > the delay -> the **banner** appears (bottom-right) on any page (open tracker/chat to confirm it is global), and an **OS notification** with **Punch in / Snooze** fires. Click **Punch in** (banner or notification) -> a session opens; banner clears.
- [ ] **Punch-out:** while punched in, set the punch-out idle to 1 min and go idle (don't touch mouse/keyboard) -> after ~1 min, "Still on the clock" banner + notification; Punch out works.
- [ ] **Snooze** hides the banner for the repeat interval. Reminders do not fire outside the window / on non-work days.
- [ ] Reload the page -> reminders still work (opt-in persisted). No console errors from the controller/SW.

- [ ] **Step 4: Confirm clean tree**

```bash
git status   # expect clean; Tasks 1-7 already committed
```

---

## Self-Review

**Spec coverage:** in-app engine (T1) ✓; whole-machine idle via IdleDetector + tick (T6) ✓; banner + SW OS notification with actions (T5, T6) ✓; punch-in rule 5-min/repeat/snooze + punch-out idle/past-end (T1) ✓; org config window/intervals + admin editor (T3, T4) ✓; opt-in + permissions (T6) ✓; global mount (T7) ✓; never auto-punch - only user Punch actions write (T2, T6) ✓; graceful degradation banner-only (T6 fallbacks) ✓; delivery = 4-image rebuild + upgrade + SW in front (T8) ✓; jest-tested engine (T1) ✓.

**Placeholder scan:** no TBD/TODO; full code throughout. Two honest env notes carried, not placeholders: the SW `@use`/tsconfig worker-types caveat (T5 Step 3, T6 Step 1 note) and the `rush update` step (T7 Step 2).

**Type consistency:** `ReminderConfig`/`ReminderInput`/`ReminderKind`/`DEFAULT_REMINDER_CONFIG` defined in T1 are consumed unchanged in T4/T6; `createPunchIn`/`closePunchOut` signatures match between T2 and T6; `AttendanceReminderSettings` fields identical across the plugin interface (T3), model class (T3), editor (T4), and controller (T6); component ids `AttendanceReminder`/`AttendanceReminderSettings` and the strings added in T3 match their `<Label>`/registration/lang uses in T4/T6/T7; the localStorage opt-in key `yg-punch-reminders-optin` is identical in the controller (T6) and MyAttendance (T6).
