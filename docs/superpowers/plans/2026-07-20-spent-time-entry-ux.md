# Spent-Time Entry UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make logging spent time on a Tracker issue force an explicit date choice and accept hours/minutes instead of decimals, in a large centered modal.

**Architecture:** All value conversion and day arithmetic is extracted into one pure, dependency-free TypeScript module (`timeEntryUtils.ts`) that is unit-tested with the existing jest setup. Two thin Svelte shells consume it: a reusable `DurationInput` widget and the restructured `TimeSpendReportPopup`. Presentation changes (centering, modal size) are one-line argument swaps at five call sites. No server, model, or migration changes.

**Tech Stack:** Svelte 4, TypeScript, Rush monorepo, jest + ts-jest (node environment), Huly `@hcengineering/ui` + `@hcengineering/presentation` component libraries. Node v22 (`.nvmrc`).

## Global Constraints

- **Repo:** `youngglobes/yg-huly`. **Branch:** `yg_ux`, cut from `yg_develop` @ `057c639623`.
- **Spec:** `docs/superpowers/specs/2026-07-20-spent-time-entry-ux-design.md`. Read it before starting.
- **Version pin:** every `package.json` in this monorepo is at `0.7.426`. Do not change versions.
- **Node v22** — run `nvm use` before any build or test command.
- **Storage format is unchanged.** `TimeSpendReport.value` stays decimal man-hours; `TimeSpendReport.date` stays `Timestamp | null` (`plugins/tracker/src/index.ts:304-314`). **No** model, server, or migration changes are permitted in this plan.
- **Do not touch** `packages/ui/**`. Patching shared UI creates merge conflicts every time `HULY_VERSION` is re-pinned against upstream Huly. This is why future dates are rejected on selection rather than disabled in the calendar.
- **Do not touch** anything related to the HR Timesheet feature — that work is parked on branch `yg_beta` and must not be pulled in.
- **Never reuse `getTimeReportDate()`** (`plugins/tracker-resources/src/utils.ts:304-317`) for any date in the new UI. It contains `while (isWeekend(date)) date.setDate(date.getDate() - 1)`, which silently walks backwards off weekends — the exact bug being fixed.
- **Weekend work must remain loggable.** No rule may restrict *which* past day is chosen. The only new date rule is "not in the future".
- Commit after every task. Use `git add <exact paths>`, never `git add -A`.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugins/tracker-resources/src/components/issues/timereport/timeEntryUtils.ts` | **New.** Pure functions: decimal↔h/m conversion, literal day arithmetic, end-of-day boundary. Zero imports. |
| `plugins/tracker-resources/src/components/issues/timereport/timeEntryUtils.test.ts` | **New.** Unit tests for the above. |
| `plugins/tracker-resources/src/components/issues/timereport/DurationInput.svelte` | **New.** Thin h/m stepper widget binding a decimal `value`. |
| `plugins/tracker-resources/src/components/issues/timereport/TimeSpendReportPopup.svelte` | **Rewrite.** Date-first layout, gating, validation. |
| `plugins/tracker-resources/src/components/issues/timereport/ReportsPopup.svelte` | Centered; responsive table height. |
| `plugins/tracker-resources/src/components/issues/timereport/ReportedTimeEditor.svelte` | Centered (2 call sites). |
| `plugins/tracker-resources/src/components/issues/timereport/TimeSpendReport.svelte` | Centered. |
| `plugins/tracker-resources/src/components/issues/timereport/TimeSpendReportsList.svelte` | Centered. |
| `plugins/tracker-resources/src/components/issues/timereport/EstimationPopup.svelte` | Centered. |
| `plugins/tracker-resources/src/plugin.ts` | 3 new `IntlString` declarations. |
| `plugins/tracker-assets/lang/en.json` | 3 new label values. |
| `plugins/tracker-resources/package.json` | Add `test` / `_phase:test` scripts (jest config exists, scripts don't). |

**Why a new module instead of `utils.ts` as the spec said.** The spec placed `endOfLocalDay()` in `plugins/tracker-resources/src/utils.ts`. That file imports from `@hcengineering/ui`, which is a Svelte package; the jest setup here is `testEnvironment: node` with the `ts-jest` preset and **no Svelte transform**, so importing `utils.ts` from a test would fail to resolve. A standalone dependency-free module is testable today with zero tooling changes and keeps one clear responsibility. This is a deliberate, documented deviation.

**Deliberate non-deletion.** `TimeReportDayDropdown.svelte`, `TimeReportDayIcon.svelte`, `getTimeReportDate()`, and `getTimeReportDayType()` become unused after Task 4. They are **left in place**. Deleting upstream files that upstream later modifies produces modify/delete conflicts on every `HULY_VERSION` re-pin, and unimported `.svelte` files are not bundled. Task 4 adds a comment recording that they are superseded. If the reviewer prefers deletion, that is a one-line change.

---

### Task 1: Pure helpers module + jest wiring

**Files:**
- Create: `plugins/tracker-resources/src/components/issues/timereport/timeEntryUtils.ts`
- Test: `plugins/tracker-resources/src/components/issues/timereport/timeEntryUtils.test.ts`
- Modify: `plugins/tracker-resources/package.json` (scripts block, lines 6-19)

**Interfaces:**
- Consumes: nothing.
- Produces, all imported by Tasks 2 and 4:
  - `interface HoursMinutes { hours: number, minutes: number }`
  - `toHoursMinutes (value: number | undefined): HoursMinutes`
  - `fromHoursMinutes (hours: number, minutes: number): number`
  - `normalizeHoursMinutes (hours: number, minutes: number): HoursMinutes`
  - `localDayOffset (days: number, now?: number): number`
  - `endOfLocalDay (ts?: number): number`

- [ ] **Step 1: Add the jest scripts**

`plugins/tracker-resources/jest.config.js` already exists but `package.json` has no test script, so `rushx test` does nothing today. Add two lines to the `scripts` block, matching the convention in `packages/analytics-providers/package.json:17-19`.

In `plugins/tracker-resources/package.json`, change:

```json
    "format": "format src",
    "build:watch": "compile ui",
```

to:

```json
    "format": "format src",
    "test": "jest --passWithNoTests --silent",
    "_phase:test": "jest --passWithNoTests --silent",
    "build:watch": "compile ui",
```

- [ ] **Step 2: Write the failing test**

Create `plugins/tracker-resources/src/components/issues/timereport/timeEntryUtils.test.ts`:

```ts
//
// Copyright © 2026 YoungGlobes.
//
import {
  toHoursMinutes,
  fromHoursMinutes,
  normalizeHoursMinutes,
  localDayOffset,
  endOfLocalDay
} from './timeEntryUtils'

describe('toHoursMinutes', () => {
  it('decomposes common quarter-hour values', () => {
    expect(toHoursMinutes(0.25)).toEqual({ hours: 0, minutes: 15 })
    expect(toHoursMinutes(0.5)).toEqual({ hours: 0, minutes: 30 })
    expect(toHoursMinutes(0.75)).toEqual({ hours: 0, minutes: 45 })
    expect(toHoursMinutes(1)).toEqual({ hours: 1, minutes: 0 })
    expect(toHoursMinutes(8)).toEqual({ hours: 8, minutes: 0 })
  })

  it('decomposes a non-quarter value such as 20 minutes', () => {
    expect(toHoursMinutes(1 / 3)).toEqual({ hours: 0, minutes: 20 })
    expect(toHoursMinutes(1 + 1 / 3)).toEqual({ hours: 1, minutes: 20 })
  })

  it('rolls 60 minutes up into an hour rather than reporting 0h 60m', () => {
    expect(toHoursMinutes(0.999)).toEqual({ hours: 1, minutes: 0 })
  })

  it('treats missing, non-finite and negative values as zero', () => {
    expect(toHoursMinutes(undefined)).toEqual({ hours: 0, minutes: 0 })
    expect(toHoursMinutes(NaN)).toEqual({ hours: 0, minutes: 0 })
    expect(toHoursMinutes(-1)).toEqual({ hours: 0, minutes: 0 })
  })
})

describe('fromHoursMinutes', () => {
  it('composes hours and minutes into decimal man-hours', () => {
    expect(fromHoursMinutes(0, 15)).toBeCloseTo(0.25, 10)
    expect(fromHoursMinutes(1, 20)).toBeCloseTo(1 + 1 / 3, 10)
    expect(fromHoursMinutes(8, 0)).toBe(8)
  })

  it('treats non-finite and negative inputs as zero', () => {
    expect(fromHoursMinutes(NaN, 30)).toBeCloseTo(0.5, 10)
    expect(fromHoursMinutes(-5, 30)).toBeCloseTo(0.5, 10)
  })
})

describe('round trip', () => {
  it('survives decompose then recompose', () => {
    for (const value of [0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2, 4, 8]) {
      const { hours, minutes } = toHoursMinutes(value)
      expect(fromHoursMinutes(hours, minutes)).toBeCloseTo(value, 6)
    }
  })
})

describe('normalizeHoursMinutes', () => {
  it('carries minutes of 60 or more into hours', () => {
    expect(normalizeHoursMinutes(0, 90)).toEqual({ hours: 1, minutes: 30 })
    expect(normalizeHoursMinutes(1, 60)).toEqual({ hours: 2, minutes: 0 })
    expect(normalizeHoursMinutes(0, 125)).toEqual({ hours: 2, minutes: 5 })
  })

  it('leaves already-valid values alone', () => {
    expect(normalizeHoursMinutes(1, 20)).toEqual({ hours: 1, minutes: 20 })
    expect(normalizeHoursMinutes(0, 0)).toEqual({ hours: 0, minutes: 0 })
  })

  it('clamps negatives to zero', () => {
    expect(normalizeHoursMinutes(-3, -10)).toEqual({ hours: 0, minutes: 0 })
  })
})

describe('localDayOffset', () => {
  // 2026-07-20 is a Monday. 2026-07-18 is a Saturday.
  const monday = new Date(2026, 6, 20, 9, 30).valueOf()
  const saturday = new Date(2026, 6, 18, 9, 30).valueOf()
  const sunday = new Date(2026, 6, 19, 9, 30).valueOf()

  it('returns the same instant for an offset of zero', () => {
    expect(localDayOffset(0, monday)).toBe(monday)
  })

  it('does NOT skip weekends - yesterday from Monday is Sunday, not Friday', () => {
    const result = new Date(localDayOffset(-1, monday))
    expect(result.getDay()).toBe(0) // Sunday
    expect(result.getDate()).toBe(19)
  })

  it('supports weekend work - today on a Saturday is Saturday', () => {
    const result = new Date(localDayOffset(0, saturday))
    expect(result.getDay()).toBe(6) // Saturday
    expect(result.getDate()).toBe(18)
  })

  it('supports weekend work - yesterday on a Sunday is Saturday', () => {
    const result = new Date(localDayOffset(-1, sunday))
    expect(result.getDay()).toBe(6) // Saturday
    expect(result.getDate()).toBe(18)
  })

  it('preserves the time of day', () => {
    const result = new Date(localDayOffset(-1, monday))
    expect(result.getHours()).toBe(9)
    expect(result.getMinutes()).toBe(30)
  })
})

describe('endOfLocalDay', () => {
  it('returns the last millisecond of the given local day', () => {
    const result = new Date(endOfLocalDay(new Date(2026, 6, 20, 9, 30).valueOf()))
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(6)
    expect(result.getDate()).toBe(20)
    expect(result.getHours()).toBe(23)
    expect(result.getMinutes()).toBe(59)
    expect(result.getSeconds()).toBe(59)
    expect(result.getMilliseconds()).toBe(999)
  })

  it('accepts any time on that day and still lands on the same boundary', () => {
    const morning = endOfLocalDay(new Date(2026, 6, 20, 0, 0, 0, 0).valueOf())
    const evening = endOfLocalDay(new Date(2026, 6, 20, 23, 0, 0, 0).valueOf())
    expect(morning).toBe(evening)
  })

  it('treats a timestamp earlier today as not in the future', () => {
    const now = new Date(2026, 6, 20, 9, 30).valueOf()
    expect(now > endOfLocalDay(now)).toBe(false)
  })

  it('treats tomorrow as in the future', () => {
    const now = new Date(2026, 6, 20, 9, 30).valueOf()
    const tomorrow = localDayOffset(1, now)
    expect(tomorrow > endOfLocalDay(now)).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && nvm use && npx jest src/components/issues/timereport/timeEntryUtils.test.ts
```

Expected: FAIL — `Cannot find module './timeEntryUtils' from 'src/components/issues/timereport/timeEntryUtils.test.ts'`

- [ ] **Step 4: Write the implementation**

Create `plugins/tracker-resources/src/components/issues/timereport/timeEntryUtils.ts`:

```ts
//
// Copyright © 2026 YoungGlobes.
//
// Pure helpers for the spent-time entry popup. Deliberately dependency-free so they can be
// unit-tested under the package's node/ts-jest setup, which has no Svelte transform.
//

/** A duration split into whole hours and whole minutes. */
export interface HoursMinutes {
  hours: number
  minutes: number
}

/**
 * Decompose decimal man-hours (the stored format) into whole hours and minutes.
 *
 * Rounding can push minutes to exactly 60 (e.g. 0.999 -> 0h 60m); that is rolled up into an
 * extra hour so the widget never displays "0h 60m".
 */
export function toHoursMinutes (value: number | undefined): HoursMinutes {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return { hours: 0, minutes: 0 }
  }
  let hours = Math.floor(value)
  let minutes = Math.round((value - hours) * 60)
  if (minutes >= 60) {
    hours += 1
    minutes -= 60
  }
  return { hours, minutes }
}

/** Compose whole hours and minutes back into decimal man-hours for storage. */
export function fromHoursMinutes (hours: number, minutes: number): number {
  const h = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0
  const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0
  return (h * 60 + m) / 60
}

/**
 * Normalise raw field input: carry minutes of 60 or more into hours, clamp negatives.
 * Typing "90" into the minutes field therefore becomes 1h 30m rather than being clamped to 59.
 */
export function normalizeHoursMinutes (hours: number, minutes: number): HoursMinutes {
  const h = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0
  const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0
  const total = h * 60 + m
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

/**
 * A literal calendar-day offset preserving the current time of day.
 *
 * Deliberately does NOT skip weekends. `getTimeReportDate()` in ../../../utils.ts walks
 * backwards off any weekend, which means Saturday work logged on Saturday silently lands on
 * Friday. Emergency weekend work must be loggable against the day it happened.
 */
export function localDayOffset (days: number, now: number = Date.now()): number {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  return d.valueOf()
}

/**
 * The last millisecond of the local day containing `ts`.
 *
 * Used for the future-date guard. Stored dates carry a time-of-day component, so comparing
 * against the day boundary is what makes "today at 09:30" count as not-in-the-future.
 */
export function endOfLocalDay (ts: number = Date.now()): number {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 999)
  return d.valueOf()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && nvm use && npx jest src/components/issues/timereport/timeEntryUtils.test.ts --verbose
```

Expected: PASS, 20 tests across 6 suites, 0 failures.

- [ ] **Step 6: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/tracker-resources/package.json \
        plugins/tracker-resources/src/components/issues/timereport/timeEntryUtils.ts \
        plugins/tracker-resources/src/components/issues/timereport/timeEntryUtils.test.ts
git commit -m "tracker: add pure time-entry helpers with tests

Decimal<->h/m conversion and literal day arithmetic for the spent-time popup.
localDayOffset deliberately does not skip weekends, unlike getTimeReportDate,
so Saturday work logs against Saturday."
```

---

### Task 2: `DurationInput` widget

**Files:**
- Create: `plugins/tracker-resources/src/components/issues/timereport/DurationInput.svelte`

**Interfaces:**
- Consumes from Task 1: `toHoursMinutes`, `fromHoursMinutes`, `normalizeHoursMinutes`. (The `HoursMinutes` type is inferred at the call sites and is not imported.)
- Produces, used by Task 4: a Svelte component with props
  - `value: number | undefined` (bindable, decimal man-hours)
  - `disabled: boolean` (default `false`)
  - `autoFocus: boolean` (default `false`)

**Critical trap — never set `maxValue={59}` on the minutes field.** `EditBox` clamps to `maxValue` in its own `setValue()` (`packages/ui/src/components/EditBox.svelte:61-72`), which runs *before* it dispatches change/blur. A `maxValue` of 59 would clamp a typed `90` down to `59` before this component ever sees it, defeating the carry behaviour.

*Superseded 2026-07-20 by user feedback ("spent time should be 2 digit"):* both fields now set `maxValue={99}`. 99 is safely above 59, so a typed `90` is not clamped and still carries to `1h 30m`; only 3-digit input (e.g. `120`) is clamped, to `99`, and then normalises to `1h 39m`. The original warning still holds for any value at or below 59.

- [ ] **Step 1: Write the component**

Create `plugins/tracker-resources/src/components/issues/timereport/DurationInput.svelte`:

```svelte
<!--
// Copyright © 2026 YoungGlobes.
-->
<script lang="ts">
  import { EditBox, Label } from '@hcengineering/ui'
  import tracker from '../../../plugin'
  import { toHoursMinutes, fromHoursMinutes, normalizeHoursMinutes } from './timeEntryUtils'

  export let value: number | undefined = undefined
  export let disabled: boolean = false
  export let autoFocus: boolean = false

  let hours: number = 0
  let minutes: number = 0
  // Guards against the reactive statement below clobbering the fields while the user types.
  let syncedFrom: number | undefined

  // Pull: decompose an externally-set `value` (edit mode, or a preset chip) into the fields.
  $: if (value !== syncedFrom) {
    const parts = toHoursMinutes(value)
    hours = parts.hours
    minutes = parts.minutes
    syncedFrom = value
  }

  // Push: recompose the fields into `value`, carrying minutes >= 60 into hours.
  function commit (): void {
    const normalized = normalizeHoursMinutes(hours, minutes)
    hours = normalized.hours
    minutes = normalized.minutes
    const next = fromHoursMinutes(hours, minutes)
    syncedFrom = next
    value = next
  }

  // Native number inputs step by 1. Minutes are far more useful stepped by 5.
  function onMinutesKeydown (event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const delta = event.key === 'ArrowUp' ? 5 : -5
    minutes = Math.max(0, (Number.isFinite(minutes) ? minutes : 0) + delta)
    commit()
  }
</script>

<div class="duration-input flex-row-center">
  <EditBox
    bind:value={hours}
    format={'number'}
    minValue={0}
    maxWidth={'3.5rem'}
    kind={'editbox'}
    {disabled}
    {autoFocus}
    on:change={commit}
    on:blur={commit}
  />
  <span class="unit" class:disabled><Label label={tracker.string.HourLabel} /></span>

  <EditBox
    bind:value={minutes}
    format={'number'}
    minValue={0}
    maxWidth={'3.5rem'}
    kind={'editbox'}
    {disabled}
    on:change={commit}
    on:blur={commit}
    on:keydown={onMinutesKeydown}
  />
  <span class="unit" class:disabled><Label label={tracker.string.MinuteLabel} /></span>
</div>

<style lang="scss">
  .duration-input {
    gap: 0.375rem;
  }
  .unit {
    margin-right: 0.75rem;
    color: var(--theme-dark-color);
    font-size: 0.8125rem;

    &.disabled {
      opacity: 0.4;
    }
  }
</style>
```

- [ ] **Step 2: Type-check the component**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && nvm use && npx svelte-check --threshold error --output human 2>&1 | tail -20
```

Expected: no errors mentioning `DurationInput.svelte`. Pre-existing errors in *other* files may appear — those are not yours to fix; confirm none name `DurationInput.svelte`.

- [ ] **Step 3: Re-run the Task 1 unit tests**

The widget delegates all arithmetic, so the existing suite still covers the logic. Confirm nothing regressed:

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && nvm use && npx jest src/components/issues/timereport/timeEntryUtils.test.ts
```

Expected: PASS, 20 tests.

- [ ] **Step 4: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/tracker-resources/src/components/issues/timereport/DurationInput.svelte
git commit -m "tracker: add DurationInput hours/minutes widget

Thin shell over timeEntryUtils. Minutes field originally had no maxValue so
EditBox cannot clamp a typed 90 to 59 before the carry into hours runs."
```

---

### Task 3: New UI strings

**Files:**
- Modify: `plugins/tracker-resources/src/plugin.ts` (string block, near line 273)
- Modify: `plugins/tracker-assets/lang/en.json` (near line 236)

**Interfaces:**
- Produces, used by Task 4: `tracker.string.PickADate`, `tracker.string.SelectDateFirst`, `tracker.string.FutureDateNotAllowed`.

`Today` and `Yesterday` already exist as `ui.string.Today` / `ui.string.Yesterday` in all 14 languages (`packages/ui/lang/en.json:35,108`) — do **not** add duplicates. Reuse the existing `TimeSpendReportDate` ("Date"), `TimeSpendReportValue` ("Spent time"), `TimeSpendReportDescription` ("Description"), `HourLabel` ("h") and `MinuteLabel` ("m").

Only `en.json` is edited. Huly falls back to English for missing keys, and we do not have translations.

- [ ] **Step 1: Declare the strings**

In `plugins/tracker-resources/src/plugin.ts`, change:

```ts
    TimeSpendReportDate: '' as IntlString,
    TimeSpendReportValue: '' as IntlString,
    TimeSpendReportDescription: '' as IntlString,
```

to:

```ts
    TimeSpendReportDate: '' as IntlString,
    TimeSpendReportValue: '' as IntlString,
    TimeSpendReportDescription: '' as IntlString,
    PickADate: '' as IntlString,
    SelectDateFirst: '' as IntlString,
    FutureDateNotAllowed: '' as IntlString,
```

- [ ] **Step 2: Add the English values**

In `plugins/tracker-assets/lang/en.json`, change:

```json
    "TimeSpendReportDescription": "Description",
```

to:

```json
    "TimeSpendReportDescription": "Description",
    "PickADate": "Pick a date…",
    "SelectDateFirst": "Select a date to continue",
    "FutureDateNotAllowed": "Can't log time for a future date",
```

- [ ] **Step 3: Verify the JSON is valid**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && node -e "const j=require('./plugins/tracker-assets/lang/en.json'); const s=Object.values(j)[0]; ['PickADate','SelectDateFirst','FutureDateNotAllowed'].forEach(k=>{ if(s[k]===undefined) throw new Error('missing '+k); console.log(k,'=>',s[k]) })"
```

Expected: three lines printing each key and its value, no exception.

- [ ] **Step 4: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/tracker-resources/src/plugin.ts plugins/tracker-assets/lang/en.json
git commit -m "tracker: add strings for date-first spent-time entry"
```

---

### Task 4: Restructure `TimeSpendReportPopup`

**Files:**
- Modify: `plugins/tracker-resources/src/components/issues/timereport/TimeSpendReportPopup.svelte` (full rewrite of the body, 164 lines)

**Interfaces:**
- Consumes from Task 1: `localDayOffset`, `endOfLocalDay`.
- Consumes from Task 2: `DurationInput`.
- Consumes from Task 3: `tracker.string.PickADate`, `tracker.string.SelectDateFirst`, `tracker.string.FutureDateNotAllowed`.
- Produces: unchanged public props — `issue`, `issueId`, `issueClass`, `space`, `assignee`, `value`, `placeholder`, `defaultTimeReportDay`. All five call sites keep compiling untouched.

`defaultTimeReportDay` is **kept as a prop** but ignored on create. Removing it would mean editing five call sites and the Project schema for no user benefit (spec, Non-goals).

`DatePresenter` is reused rather than calling `DatePopup` directly — it already owns the popup lifecycle (`packages/ui/src/components/calendar/DatePresenter.svelte:105-106`), accepts `value: number | null`, and renders `labelNull` when the value is null. That gives the "Pick a date…" affordance with no new popup plumbing.

**On focus.** The spec says focus should start on the date row. The critical half of that — the hours box **no longer steals focus** — is achieved by dropping `autoFocus` from it (the old file had `autoFocus` on the hours `EditBox` at line 107). No `autoFocus` is then set on anything: `DatePresenter` exposes only `focusIndex`, not `autoFocus`, and force-focusing a `Button` would need a custom Svelte action for little gain. Because the date row is now first in the DOM, the first Tab lands on the `Today` chip. Do **not** add an autofocus action to satisfy the letter of the spec; the intent (nothing pulls the user past the date) is met. Task 6 Step 4 verifies no field is focused on open.

- [ ] **Step 1: Replace the file contents**

Replace the whole of `plugins/tracker-resources/src/components/issues/timereport/TimeSpendReportPopup.svelte` with:

```svelte
<!--
// Copyright © 2022-2023 Hardcore Engineering Inc.
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
  import contact, { Employee, getCurrentEmployee } from '@hcengineering/contact'
  import { AttachedData, Class, DocumentUpdate, Ref, Space } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import { UserBox } from '@hcengineering/contact-resources'
  import { Issue, TimeReportDayType, TimeSpendReport, TrackerEvents } from '@hcengineering/tracker'
  import ui, { Button, DatePresenter, EditBox, Label } from '@hcengineering/ui'
  import tracker from '../../../plugin'
  import TitlePresenter from '../TitlePresenter.svelte'
  import DurationInput from './DurationInput.svelte'
  import { endOfLocalDay, localDayOffset } from './timeEntryUtils'
  import { Analytics } from '@hcengineering/analytics'

  export let issue: Issue | undefined = undefined
  export let issueId: Ref<Issue> | undefined = issue?._id
  export let issueClass: Ref<Class<Issue>> = issue?._class ?? tracker.class.Issue
  export let space: Ref<Space> | undefined = issue?.space
  export let assignee: Ref<Employee> | null | undefined = issue?.assignee as Ref<Employee>

  export let value: TimeSpendReport | undefined
  export let placeholder: IntlString = tracker.string.TimeSpendReportValue
  // Kept for call-site compatibility. Deliberately NOT used to pre-fill the date: silently
  // defaulting to the previous work day is what caused hours to land on the wrong day.
  export let defaultTimeReportDay: TimeReportDayType = TimeReportDayType.PreviousWorkDay

  const isEdit = value !== undefined

  const data = {
    // Starts null on create. The user must choose a day before anything else is editable.
    date: value?.date ?? null,
    description: value?.description ?? '',
    value: value?.value,
    employee: value?.employee ?? getCurrentEmployee() ?? assignee ?? null
  }

  export function canClose (): boolean {
    return true
  }

  const client = getClient()

  function setDay (offset: number): void {
    data.date = localDayOffset(offset)
  }

  async function create (): Promise<void> {
    if (value === undefined) {
      if (space && issueId) {
        await client.addCollection(
          tracker.class.TimeSpendReport,
          space,
          issueId,
          issueClass,
          'reports',
          data as AttachedData<TimeSpendReport>
        )
        Analytics.handleEvent(TrackerEvents.IssueTimeSpentAdded, { issue: issue?.identifier ?? issueId })
      }
    } else {
      const ops: DocumentUpdate<TimeSpendReport> = {}
      if (value.value !== data.value) {
        ops.value = data.value
      }
      if (value.employee !== data.employee) {
        ops.employee = data.employee
      }
      if (value.description !== data.description) {
        ops.description = data.description
      }
      if (value.date !== data.date) {
        ops.date = data.date
      }
      if (Object.keys(ops).length > 0) {
        await client.update(value, ops)
        Analytics.handleEvent(TrackerEvents.IssueTimeSpentUpdated, { issue: issue?.identifier ?? issueId })
      }
    }
  }

  $: dateChosen = data.date != null
  $: dateInFuture = data.date != null && data.date > endOfLocalDay()
  // Editing an existing report needs no gate: it already has a date.
  $: fieldsEnabled = isEdit || dateChosen
  $: canSave =
    dateChosen &&
    !dateInFuture &&
    Number.isFinite(data.value) &&
    data.value !== 0 &&
    space !== undefined &&
    issueId !== undefined
</script>

<Card
  label={value === undefined ? tracker.string.TimeSpendReportAdd : tracker.string.TimeSpendReportValue}
  {canSave}
  okAction={create}
  gap={'gapV-4'}
  on:close
  okLabel={value === undefined ? presentation.string.Create : presentation.string.Save}
  on:changeContent
>
  <svelte:fragment slot="header">
    {#if issue}
      <TitlePresenter showParent={false} value={issue} />
    {/if}
  </svelte:fragment>

  <!-- 1. Date. Promoted out of the footer pool: it is logically first, so it is visually first. -->
  <div class="field">
    <div class="field-label"><Label label={tracker.string.TimeSpendReportDate} /><span class="required">*</span></div>
    <div class="flex-row-center gap-2">
      <Button kind={'link-bordered'} on:click={() => { setDay(0) }}>
        <span slot="content"><Label label={ui.string.Today} /></span>
      </Button>
      <Button kind={'link-bordered'} on:click={() => { setDay(-1) }}>
        <span slot="content"><Label label={ui.string.Yesterday} /></span>
      </Button>
      <DatePresenter
        bind:value={data.date}
        editable
        kind={'regular'}
        size={'large'}
        labelNull={tracker.string.PickADate}
      />
    </div>
    {#if dateInFuture}
      <div class="field-error"><Label label={tracker.string.FutureDateNotAllowed} /></div>
    {:else if !fieldsEnabled}
      <div class="field-hint"><Label label={tracker.string.SelectDateFirst} /></div>
    {/if}
  </div>

  <!-- 2. Hours. Disabled until a date is chosen. -->
  <div class="field" class:gated={!fieldsEnabled}>
    <div class="field-label"><Label label={placeholder} /><span class="required">*</span></div>
    <DurationInput bind:value={data.value} disabled={!fieldsEnabled} />
    <div class="flex-row-center gap-2 presets">
      <Button kind={'link-bordered'} disabled={!fieldsEnabled} on:click={() => (data.value = 0.25)}>
        <span slot="content">15<Label label={tracker.string.MinuteLabel} /></span>
      </Button>
      <Button kind={'link-bordered'} disabled={!fieldsEnabled} on:click={() => (data.value = 0.5)}>
        <span slot="content">30<Label label={tracker.string.MinuteLabel} /></span>
      </Button>
      <Button kind={'link-bordered'} disabled={!fieldsEnabled} on:click={() => (data.value = 0.75)}>
        <span slot="content">45<Label label={tracker.string.MinuteLabel} /></span>
      </Button>
      <Button kind={'link-bordered'} disabled={!fieldsEnabled} on:click={() => (data.value = 1)}>
        <span slot="content">1<Label label={tracker.string.HourLabel} /></span>
      </Button>
      <Button kind={'link-bordered'} disabled={!fieldsEnabled} on:click={() => (data.value = 2)}>
        <span slot="content">2<Label label={tracker.string.HourLabel} /></span>
      </Button>
      <Button kind={'link-bordered'} disabled={!fieldsEnabled} on:click={() => (data.value = 4)}>
        <span slot="content">4<Label label={tracker.string.HourLabel} /></span>
      </Button>
      <Button kind={'link-bordered'} disabled={!fieldsEnabled} on:click={() => (data.value = 6)}>
        <span slot="content">6<Label label={tracker.string.HourLabel} /></span>
      </Button>
      <Button kind={'link-bordered'} disabled={!fieldsEnabled} on:click={() => (data.value = 8)}>
        <span slot="content">8<Label label={tracker.string.HourLabel} /></span>
      </Button>
    </div>
  </div>

  <!-- 3. Description. Disabled until a date is chosen. -->
  <div class="field" class:gated={!fieldsEnabled}>
    <div class="field-label"><Label label={tracker.string.TimeSpendReportDescription} /></div>
    <EditBox
      bind:value={data.description}
      placeholder={tracker.string.TimeSpendReportDescription}
      kind={'editbox'}
      disabled={!fieldsEnabled}
    />
  </div>

  <svelte:fragment slot="pool">
    <UserBox
      _class={contact.mixin.Employee}
      label={contact.string.Employee}
      kind={'regular'}
      size={'large'}
      bind:value={data.employee}
      showNavigate={false}
    />
  </svelte:fragment>
</Card>

<style lang="scss">
  .field + .field {
    margin-top: 1rem;
  }
  .field-label {
    margin-bottom: 0.5rem;
    color: var(--theme-dark-color);
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .required {
    margin-left: 0.125rem;
    color: var(--theme-warning-color);
  }
  .presets {
    margin-top: 0.5rem;
    flex-wrap: wrap;
  }
  .gated {
    opacity: 0.5;
    pointer-events: none;
  }
  .field-hint,
  .field-error {
    margin-top: 0.375rem;
    font-size: 0.75rem;
  }
  .field-hint {
    color: var(--theme-dark-color);
  }
  .field-error {
    color: var(--theme-error-color);
  }
</style>
```

- [ ] **Step 2: Record why the superseded files stay**

`TimeReportDayDropdown.svelte`, `TimeReportDayIcon.svelte`, `getTimeReportDate()` and `getTimeReportDayType()` are now unreferenced. First confirm that:

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && grep -rn "TimeReportDayDropdown\|getTimeReportDate\|getTimeReportDayType" --include=*.svelte --include=*.ts plugins/ models/ | grep -v "\.d\.ts" | grep -v "TimeReportDayDropdown.svelte:" | grep -v "utils.ts:3"
```

Expected: **no output** (every remaining hit is the definition itself, filtered out).

Then add a note at the top of `plugins/tracker-resources/src/components/issues/timereport/TimeReportDayDropdown.svelte`, immediately after the closing `-->` of the licence block and before `<script lang="ts">`:

```html
<!--
  SUPERSEDED (2026-07): the spent-time popup now uses literal Today/Yesterday chips.
  This component and getTimeReportDate() skip weekends, which silently logged Saturday
  work against Friday. Kept unreferenced rather than deleted so re-pinning HULY_VERSION
  against upstream does not produce modify/delete conflicts. Unimported .svelte files
  are not bundled. See docs/superpowers/specs/2026-07-20-spent-time-entry-ux-design.md
-->
```

- [ ] **Step 3: Type-check**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && nvm use && npx svelte-check --threshold error --output human 2>&1 | tail -30
```

Expected: no errors naming `TimeSpendReportPopup.svelte` or `DurationInput.svelte`.

- [ ] **Step 4: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/tracker-resources/src/components/issues/timereport/TimeSpendReportPopup.svelte \
        plugins/tracker-resources/src/components/issues/timereport/TimeReportDayDropdown.svelte
git commit -m "tracker: require an explicit date before logging spent time

The date was pre-filled to the previous work day while the hours box took
autofocus and the date controls sat at the bottom, so hours routinely landed
on the wrong day. Date now starts empty, sits first, and gates the other
fields; future dates are rejected. Hours are entered as h/m, not decimals."
```

---

### Task 5: Centered modals and a taller reports table

**Files:**
- Modify: `plugins/tracker-resources/src/components/issues/timereport/ReportsPopup.svelte:41-52, 67-88`
- Modify: `plugins/tracker-resources/src/components/issues/timereport/ReportedTimeEditor.svelte:43, 58`
- Modify: `plugins/tracker-resources/src/components/issues/timereport/TimeSpendReport.svelte:42`
- Modify: `plugins/tracker-resources/src/components/issues/timereport/TimeSpendReportsList.svelte:45`
- Modify: `plugins/tracker-resources/src/components/issues/timereport/EstimationPopup.svelte:133`
- Read only, **do not modify**: `models/tracker/src/actions.ts:379-384` (see Step 5)

**Interfaces:**
- Consumes: nothing new. `'center'` is already a valid `PopupPosAlignment` (`packages/ui/src/types.ts:233-234`), and `showPopup`'s third parameter is `element?: PopupAlignment` (`packages/ui/src/popups.ts:84-100`).
- Produces: nothing consumed by later tasks.

The `Card` in each popup already defaults to `width={'large'}` (45rem, max 60rem — `packages/theme/styles/dialogs.scss:252-255`), so no width prop is needed; only the anchoring changes.

- [ ] **Step 1: Find every anchored call site**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources/src/components/issues/timereport && grep -n "eventToHTMLElement(event)\|eventToHTMLElement(evt)" *.svelte
```

Expected: 6 hits — `EstimationPopup.svelte`, `ReportedTimeEditor.svelte` (2), `ReportsPopup.svelte`, `TimeSpendReport.svelte`, `TimeSpendReportsList.svelte`.

- [ ] **Step 2: Swap each anchor for `'center'`**

In each of those 6 locations, replace the `showPopup` third argument `eventToHTMLElement(event)` (or `eventToHTMLElement(evt)`) with the string `'center'`.

For example, in `ReportsPopup.svelte:40-53`, change:

```ts
  function addReport (event: MouseEvent): void {
    showPopup(
      TimeSpendReportPopup,
      {
        issue,
        issueId: issue._id,
        issueClass: issue._class,
        space: issue.space,
        assignee: issue.assignee,
        defaultTimeReportDay
      },
      eventToHTMLElement(event)
    )
  }
```

to:

```ts
  function addReport (event: MouseEvent): void {
    showPopup(
      TimeSpendReportPopup,
      {
        issue,
        issueId: issue._id,
        issueClass: issue._class,
        space: issue.space,
        assignee: issue.assignee,
        defaultTimeReportDay
      },
      'center'
    )
  }
```

Apply the same substitution at the other 5 sites, leaving every other argument untouched.

- [ ] **Step 3: Remove now-unused `eventToHTMLElement` imports**

Each edited file imports `eventToHTMLElement` from `@hcengineering/ui`. Remove it from the import list **only in files where no usage remains**. Verify per file:

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources/src/components/issues/timereport && grep -c "eventToHTMLElement" EstimationPopup.svelte ReportedTimeEditor.svelte ReportsPopup.svelte TimeSpendReport.svelte TimeSpendReportsList.svelte
```

Expected after the edit: each file shows `1` (the import line only) — remove that import. If a file shows more than 1, it has another unrelated popup; leave its import alone.

- [ ] **Step 4: Make the reports table grow with the window**

In `ReportsPopup.svelte`, change:

```svelte
  <div class="h-50">
    <Scroller fade={tableSP}>
```

to:

```svelte
  <div class="reports-table">
    <Scroller fade={tableSP}>
```

and add a `<style>` block at the end of the file, after the closing `</Card>`:

```svelte
<style lang="scss">
  .reports-table {
    // Was a fixed h-50, which kept a long list scrolling inside a short box.
    height: 100%;
    min-height: 12rem;
    max-height: 60vh;
  }
</style>
```

- [ ] **Step 5: Leave the `T` shortcut alone — analysis, no edit**

The `T` shortcut does not go through any call site above. It is a **model** action running
`view.actionImpl.ShowPopup`, which reads alignment from `props.element`
(`plugins/view-resources/src/actionImpl.ts:462, 474`). The tracker action
(`models/tracker/src/actions.ts:379-384`) does not set `element`, so:

- `getPopupAlignment(undefined, evt)` returns `undefined` (`actionImpl.ts:669-671`), and
- `fitPopupElement` only takes the anchored path when `element != null` (`popups.ts:271`),

meaning an unset alignment already falls through to the default centered branch. **No change
is required, and none should be made.**

Setting `element: 'center'` in `actions.ts` would be a **model change**, violating this plan's
"no model, server, or migration changes" constraint: model actions only take effect after a
workspace model upgrade, so it would turn a pure front-end fix into a deployment step for no
behavioural gain.

Task 6 Step 4 verifies empirically that the `T` shortcut opens centered. **If and only if it
does not**, stop and escalate to the plan author rather than editing `actions.ts` unilaterally
— the fix would need the model-upgrade cost weighed against leaving one entry point anchored.

- [ ] **Step 6: Type-check**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && nvm use && npx svelte-check --threshold error --output human 2>&1 | tail -30
```

Expected: no errors naming any of the 5 edited Svelte files. In particular, no
`'eventToHTMLElement' is declared but its value is never read`.

- [ ] **Step 7: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/tracker-resources/src/components/issues/timereport/ReportsPopup.svelte \
        plugins/tracker-resources/src/components/issues/timereport/ReportedTimeEditor.svelte \
        plugins/tracker-resources/src/components/issues/timereport/TimeSpendReport.svelte \
        plugins/tracker-resources/src/components/issues/timereport/TimeSpendReportsList.svelte \
        plugins/tracker-resources/src/components/issues/timereport/EstimationPopup.svelte
git commit -m "tracker: centre the spent-time popups, let the reports table grow

All five entry points opened anchored to whichever button was clicked, and the
reports list was locked to a short fixed height regardless of window size."
```

---

### Task 6: Build and manual end-to-end verification

**Files:** none modified. This task produces evidence, not code.

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: a verification record appended to the plan.

This is the only task that can catch a broken binding, a mis-wired popup, or a value that saves against the wrong day — none of which the unit tests or `svelte-check` can see.

- [ ] **Step 1: Build the front bundle**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && nvm use && node common/scripts/install-run-rush.js build --to @hcengineering/tracker-resources 2>&1 | tail -20
```

Expected: `rush build (…) completed successfully`. If Rush reports the project is not built because of a changed `package.json`, run `node common/scripts/install-run-rush.js update` first (Task 1 edited `plugins/tracker-resources/package.json`).

- [ ] **Step 2: Run the full package test + lint phase**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && nvm use && npx jest && npx svelte-check --threshold error --output human 2>&1 | tail -5
```

Expected: jest PASS (20 tests); svelte-check reports no errors in the six files this plan touched.

- [ ] **Step 3: Start the local stack and open an issue**

Serve the front end against the local stack:

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/dev/prod && nvm use && npx rushx dev-server
```

Expected: webpack serves on `http://localhost:8080`. Log in to the local test workspace and open any Tracker issue in a project with time reporting enabled.

If the local backend containers are not running, start them first using the procedure this fork already uses (`huly-selfhost/` compose stack in the sibling `huly-migration` repo) — do not invent a new one.

- [ ] **Step 4: Verify the gate, from each of the five entry points**

For each entry point below, open the add-report popup and confirm: it appears **centered** (not glued to the clicked button), the **Date** row is at the top, **no field has focus on open**, the **hours and description are greyed and non-interactive**, the hint reads *"Select a date to continue"*, and **Create is disabled**.

1. Reports list → the `+` button
2. Issue sidebar → the `Spent time` field
3. The estimation popup
4. The reports list → clicking an existing row (edit mode — see Step 7, this one should **not** be gated)
5. The `T` keyboard shortcut with an issue focused — this one is **not** changed by Task 5; it is expected to be centered already via the default alignment path. If it opens anchored instead, stop and escalate per Task 5 Step 5 rather than editing `models/tracker/src/actions.ts`.

Record pass/fail per entry point.

- [ ] **Step 5: Verify the date rules**

- Click `Today` → hours and description become editable; the date shows today.
- Click `Yesterday` → the date shows the literal previous calendar day.
- Open the date picker and select **tomorrow** → the error *"Can't log time for a future date"* appears and Create is disabled.
- Select a date last week → accepted, Create enabled once hours are set.

- [ ] **Step 6: Verify weekend work (the requirement from the spec)**

Pick the most recent **Saturday** from the calendar, enter `2h 0m`, save. Confirm the row appears in the reports list dated that Saturday — **not** the preceding Friday.

If the current date makes this awkward to judge, also confirm via the unit test already covering it:

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/tracker-resources && nvm use && npx jest -t "weekend"
```

Expected: 2 tests pass.

- [ ] **Step 7: Verify the duration widget and edit mode**

- Enter `0h 20m`, save. The reports list must display **20m** (not `0.33`).
- Type `90` into the minutes field and tab out → it must normalise to `1h 30m`.
- Press `↑` in the minutes field → it must step by 5.
- Click the `45m` preset → the widget must show `0h 45m`.
- Re-open that saved 20-minute report for **edit**: the date must be populated, **all fields immediately editable with no gate**, and the widget must read `0h 20m`.
- Change it to `1h 20m`, save, and confirm the list shows `1h 20m`.

- [ ] **Step 8: Record the results and commit**

Append a `## Verification` section to this plan file listing, for each of Steps 4-7, what was checked and the actual observed result. State failures plainly — do not record a step as passing unless it was actually observed.

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add docs/superpowers/plans/2026-07-20-spent-time-entry-ux.md
git commit -m "docs: record spent-time entry UX verification results"
```

---

## Out of Scope

Confirm none of these were touched:

- `packages/ui/**` — no shared-UI patches.
- Any model, server plugin, or migration.
- `EstimationValueEditor.svelte` — also decimal-hours, also a candidate for `DurationInput`, but a separate surface and a separate decision.
- The `defaultTimeReportDay` field on `Project` — still in the schema, merely no longer pre-filling.
- Anything on branch `yg_beta` (HR Timesheet work).
- Merging to `yg_develop` or deploying. This branch stays local until explicitly approved.
