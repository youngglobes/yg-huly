# Holidays calendar (HR portal) — PAUSED mid-brainstorm

**Date:** 2026-08-05
**Status:** PAUSED (brainstorm in progress; no spec finalized, no code). Resume with superpowers:brainstorming.
**Repo:** youngglobes/yg-huly (branch `yg_beta`)
**Backlog:** item #18 (holiday list). Follows the performance-report work.

## Why / goal

Add a "Holidays" feature to the custom HR portal so HR marks public/festival holidays (Diwali, etc.).
A holiday becomes a NON-WORKING day everywhere via `isWorkingDay`, so in the Performance report work
logged/punched on a holiday counts as off-day effort ("working during holidays"). HR-only access.

## Research findings (done — do not re-research)

- **Huly "Planner"** (`plugins/time` + `time-resources`) is a DAY-COLUMN time-grid (schedule to-dos into
  time slots), NOT a month grid — wrong shape for holidays. The user referenced it only as "a calendar".
- **Reusable month calendar:** `packages/ui/src/components/calendar/MonthCalendar.svelte` — full-size month
  grid, weekday header, `cell` slot with `{date, today, selected, wrongMonth}` for custom day rendering,
  dispatches `change` on click. Best fit. Also `Month.svelte` (compact), `internal/DateUtils.ts` helpers.
  Stock month view precedent: `plugins/calendar-resources/src/components/CalendarView.svelte:353-379`
  (uses MonthCalendar + a `Day.svelte` cell).
- **Stock HR already has holidays** — `hr.class.PublicHoliday {title, description, date: TzDate, department}`
  in `core.space.Workspace` (`plugins/hr/src/index.ts:70-75`, `models/hr/src/index.ts:179-186`), with a
  click-a-day popup `plugins/hr-resources/src/components/schedule/CreatePublicHoliday.svelte` and
  `MonthView.svelte:206-333`, plus `isHoliday()` in `plugins/hr-resources/src/utils.ts:207-224`. BUT it is
  department-scoped and uses the older `TzDate` struct — heavier than we want and not wired into the
  yg-timesheet HR app. Recommendation: DO NOT adopt it; build a clean lightweight doc following the
  yg-timesheet `AttendanceSession` convention (plain `Timestamp` = local midnight).
- **HR app extension points** (`models/yg-timesheet/src/index.ts`): specials array at ~265-332; existing
  specials overview/timesheets/attendance/performance (accessLevel `AccountRole.DocGuest`), roster/
  team-profiles (`AccountRole.Owner`). Add a special the same way. New domain doc: `@Model(..., core.class.Doc,
  DOMAIN_YG_TIMESHEET)` + `builder.createModel(...)` (copy `TAttendanceSession` ~144-167). Plugin ids in
  `plugins/yg-timesheet/src/index.ts` (class/component/string blocks); strings also in
  `plugins/yg-timesheet-assets/lang/en.json`. Space: use `core.space.Workspace` (world-readable, like
  AttendanceSession) NOT the private HrData.

## Proposed design (agreed in principle, not finalized)

- **Data:** new `ygTimesheet.class.Holiday { date: Timestamp (local midnight), name: string }`, domain
  `DOMAIN_YG_TIMESHEET`, space `core.space.Workspace` (world-readable so every consumer can factor it in;
  HR-only WRITE — UI-gated, optional light server guard).
- **UI:** new "Holidays" HR special (visible to HR-app users, `DocGuest`) = a modern **month calendar**
  (`MonthCalendar`) with a custom holiday cell (highlight + name); click empty day -> add (name it), click a
  holiday -> remove; month nav; a side list of the year's holidays. Modern, self-contained (no departments,
  no TzDate, no approval workflow — write via `client.createDoc`/`client.remove` like attendance).
- **Integration:** `isWorkingDay(dayMs, holidays?: Set<number>)` gains an OPTIONAL holidays set (local-midnight
  ms) — default none, so existing callers are unaffected. The Performance report loads Holiday docs in range,
  builds the set, and threads it through `performanceRows` -> `isWorkingDay`. A holiday -> non-working ->
  off-day effort. (Timesheet-compliance and other `isWorkingDay` callers can adopt holidays later.)
- **Deploy:** MODEL CHANGE (new doc class + new special) -> full 4-image build + `upgrade-workspace yg`
  (NOT front-only, unlike the recent performance/estimate-gate front builds).

## PAUSED AT — the open questions to resume on

1. **Entry model:** single-day toggle (recommended — one date per Holiday doc, multi-day = multiple clicks)
   vs multi-day date ranges (one named entry spans start-end; more UI + overlap handling). *User rejected the
   binary and wanted to clarify first — ask what they want to clarify.*
2. Likely related clarifications the user may raise: org-wide vs per-department/team holidays; whether
   holidays repeat yearly (recurring) vs entered per year; optional/half-day holidays.

Next step on resume: re-open superpowers:brainstorming, ask the user what they wanted to clarify on entry,
settle 1-2, then write the real spec (`2026-08-…-holidays-calendar-design.md`) -> plan.
