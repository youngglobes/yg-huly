# Spent-time entry UX — design

**Date:** 2026-07-20
**Branch:** `yg_ux` (cut from `yg_develop` @ `057c639623`)
**Status:** approved, ready for implementation plan

## Problem

Logging spent time on a Tracker issue has two UX defects that produce real, recurring data
errors.

### 1. Time lands on the wrong date

`TimeSpendReportPopup.svelte` pre-fills the date and never validates it:

```ts
const data = {
  date: value?.date ?? getTimeReportDate(defaultTimeReportDay),  // silently pre-filled
  ...
}
$: canSave = Number.isFinite(data.value) && data.value !== 0 && ...  // date never checked
```

Three things compound:

- The project setting `defaultTimeReportDay` defaults to `PreviousWorkDay`, so the date is
  pre-filled to **yesterday**, not today.
- The hours field has `autoFocus`.
- The date controls live in the `pool` slot at the **bottom** of the card — visually last,
  logically first.

The fast path is therefore: type hours → Enter → saved against yesterday. An employee in a
hurry never looks at the date. This has produced hours booked to the wrong day.

### 2. Hours must be entered as a decimal

The field is `format={'number'}` with `maxDigitsAfterPoint={3}`, storing decimal man-hours.
To log 20 minutes a person must type `0.333`. People get this wrong or round it away.

Note the asymmetry: the **display** side already speaks human — `TimePresenter.svelte` renders
`1h 10m` and rolls up to days at 8h. Only input is decimal. This design restores symmetry
rather than introducing a new concept.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | How strictly to force date-first | Empty date + gated fields (single modal, no wizard) |
| 2 | Which popups become large/centered | Both the reports list and the add/edit form |
| 3 | Date restrictions | Block future dates only; past stays fully open |
| 4 | Hours input | Hours + minutes steppers, with the existing preset chips |

## Scope

| File | Change |
|---|---|
| `plugins/tracker-resources/src/components/issues/timereport/DurationInput.svelte` | **New.** H/M stepper widget. |
| `.../timereport/TimeSpendReportPopup.svelte` | Reorder to Date → Hours → Description; empty date; gating; validation. |
| `.../timereport/ReportsPopup.svelte` | Centered; table `h-50` → `max-height: 60vh`. |
| `.../timereport/ReportedTimeEditor.svelte` | `eventToHTMLElement(event)` → `'center'` (2 call sites). |
| `.../timereport/TimeSpendReport.svelte` | Same. |
| `.../timereport/TimeSpendReportsList.svelte` | Same. |
| `.../timereport/EstimationPopup.svelte` | Same. |
| `models/tracker/src/actions.ts` | Verify the `T` shortcut action lands centered. |
| `plugins/tracker-resources/src/utils.ts` | Add `endOfLocalDay()` helper. |
| `plugins/tracker-resources/src/plugin.ts` + lang JSON | ~4 new labels. |

**No server, model, or migration changes.** `TimeSpendReport.date` is already
`Timestamp | null` (`plugins/tracker/src/index.ts:309`), so an empty date is representable
as-is.

## Component: `DurationInput.svelte`

Isolates all decimal↔human conversion in one place so the popup never handles it.

**Interface**

- `bind:value: number | undefined` — decimal man-hours, the stored format
- `disabled: boolean`
- `autoFocus: boolean`

**Internals** — two number fields, `hours` and `minutes`.

- out: `value = (hours * 60 + minutes) / 60`
- in: `hours = Math.floor(value)`, `minutes = Math.round((value % 1) * 60)`

**Normalisation on decompose.** A stored `0.999` decomposes to `0h 60m`; it must roll up to
`1h 0m`. Any decompose yielding `minutes === 60` increments hours and zeroes minutes.

**Input guards**

- Minutes clamp to 0–59, carrying into hours on overflow: typing `90` yields `1h 30m`.
- `↑`/`↓` step minutes by 5.
- Both fields reject negative values.

**Storage is unchanged** — still decimal man-hours. `TimePresenter`, HR reports, the
`Spent time` sidebar totals, and all existing rows keep working with zero migration.

Round-trip check: 20m → `20/60 = 0.3333…` → `TimePresenter` computes
`Math.round((value % 1) * 60) = 20` → renders `20m`. Correct.

## Component: `TimeSpendReportPopup.svelte`

Restructured into a vertical labelled stack. The date controls move **out of the bottom
`pool` slot** to the top of the card body.

1. **Date \*** — `Today` / `Yesterday` chips plus `Pick a date…` opening the existing
   `DatePopup`. Starts **empty**. Focus starts here; `autoFocus` moves off the hours box.
   The chosen date renders unambiguously, e.g. `Mon, 20 Jul 2026`.

   The chips are **literal** calendar days — today, and today minus one. They must **not**
   reuse `getTimeReportDate()`, which skips weekends (`utils.ts:311-314`): on a Monday that
   helper returns Friday, so a "Yesterday" chip built on it would silently log to the wrong
   day — the exact bug this design exists to remove.

### Weekend work is explicitly supported

Emergency work on a Saturday or Sunday must be loggable against the day it happened.

This is a **fix**, not a regression. Today `getTimeReportDate()` walks backwards off any
weekend, so an employee logging Saturday work on Saturday gets **Friday** — and neither
dropdown option can produce Saturday, because the `while (isWeekend(date))` loop applies to
`CurrentWorkDay` too. Saturday is currently reachable only via the calendar at the bottom of
the popup, which is exactly the control a rushing employee skips.

The only date rule this design adds is "not in the future". No rule restricts *which* past
day. Weekend days remain fully selectable in the calendar — `isWeekend` appears there purely
as a `class:weekend` style hook (`MonthSquare.svelte:164`, `MonthCalendar.svelte:62`), never
as a disable — and the literal chips reach them directly.
2. **Hours \*** — `DurationInput` plus the 15m/30m/45m/1h/2h/4h/6h/8h preset chips, which
   set `value` and are reflected by the widget. `disabled` until a date is chosen.
3. **Description** — `disabled` until a date is chosen.
4. **Employee** — remains in the footer pool, unchanged.

**Edit mode** (`value !== undefined`) skips the gate entirely: the date already exists, so
every field is live immediately.

**Validation**

A new helper is required in `plugins/tracker-resources/src/utils.ts` — no end-of-day helper
exists today. Comparing against the local day boundary matters because `getTimeReportDate()`
preserves the current time-of-day, so stored dates carry a time component:

```ts
export function endOfLocalDay (ts: number = Date.now()): number {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 999)
  return d.valueOf()
}
```

```ts
$: dateChosen = data.date != null
$: dateInFuture = dateChosen && data.date > endOfLocalDay()
$: canSave =
  dateChosen &&
  !dateInFuture &&
  Number.isFinite(data.value) &&
  data.value !== 0 &&
  space !== undefined &&
  issueId !== undefined
```

Inline messages: *"Select a date to continue"* while the date is empty, *"Can't log time for
a future date"* when a future day is selected.

## Centered modals

`Card` already supports `width` (`'large'` = 45rem, max 60rem — `dialogs.scss:252`) and
`showPopup` already accepts `'center'` as a `PopupPosAlignment` (`packages/ui/src/types.ts`).
All call sites change their third argument from `eventToHTMLElement(event)` to `'center'`.

`ReportsPopup` additionally swaps its fixed `h-50` table wrapper for `max-height: 60vh` so
the table grows with the window instead of scrolling inside a short box.

## Known limitation: future dates are rejected, not disabled

The shared `packages/ui` calendar (`DatePopup`, `Month`, `MonthSquare`, `DatePicker`) exposes
**no min/max prop**. Greying out future days would require patching shared UI, which adds
merge-conflict surface every time we re-pin `HULY_VERSION` against upstream Huly.

Therefore future dates are **rejected on selection** — inline error, `canSave` stays false —
rather than being unclickable. The guard is contained entirely to `tracker-resources`.

Making future days genuinely unclickable is a deliberate follow-up that would patch
`packages/ui`, to be taken only if the rejection message proves insufficient in practice.

## Non-goals

- No server, model, or migration changes.
- `defaultTimeReportDay` **stays** in the Project schema. It simply stops pre-filling the
  date. It is used nowhere else (verified by grep), but removing it means a migration for no
  user benefit. All call sites keep passing the prop; the popup ignores it on create.
- `EstimationValueEditor` also takes decimal hours and would benefit from `DurationInput`.
  Out of scope here — a separate surface, tracked as an optional follow-up.
- No back-fill lockout window (no "timesheet closed after N days" rule).
- The HR Timesheet / approval work stays parked on `yg_beta` and is untouched.

## Testing

- **`DurationInput` unit-level:** round-trip `value → h/m → value` for 0.25, 0.333, 0.5,
  0.999, 1, 8; minutes overflow (`90` → `1h 30m`); the `0h 60m` normalisation case; negative
  rejection.
- **Gating:** hours and description are non-interactive until a date is chosen; `Create`
  stays disabled; choosing a date enables all three.
- **Future date:** selecting tomorrow shows the error and keeps `Create` disabled; selecting
  today (with any time-of-day component) is accepted.
- **Chips on a Monday:** the `Yesterday` chip yields Sunday, not Friday.
- **Weekend work:** on a Saturday the `Today` chip yields Saturday (not Friday); on a Sunday
  the `Yesterday` chip yields Saturday; both save and appear in the reports list against the
  weekend date.
- **Edit mode:** opening an existing report shows its date and enabled fields immediately,
  and its decimal value decomposes to the right h/m.
- **Manual e2e in the local stack:** add a report from each of the five entry points
  (reports list `+`, sidebar `Spent time`, estimation popup, reports list row edit, and the
  `T` keyboard shortcut) and confirm each opens centered and saves to the chosen date.
