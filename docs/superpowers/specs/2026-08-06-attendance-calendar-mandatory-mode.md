# Attendance: holiday calendar + mandatory punch mode + notification fix + "Late night" label

**Date:** 2026-08-06
**Status:** Design (approved)
**Repo:** youngglobes/yg-huly (branch `yg_beta`)
**Backlog:** covers #5 (force Office/WFH on every punch-in) + #6 (notification must not auto punch-in),
plus a read-only holiday calendar for employees and a label tweak. Builds on the Holidays feature
(`2026-08-05-holidays-calendar-design.md`) and the Performance drill-down.

## Goal

Four client-only changes:
1. Show a **read-only holiday calendar** on the My Attendance page (all employees see holidays + today).
2. Make the **Office/WFH mode mandatory on every punch-in** (no sticky default).
3. Stop the **reminder notification from auto-punching** (open the app so the mode is chosen).
4. Rename the performance drill-down chip **"Late" -> "Late night"**.

All front-only (no model change - the `Holiday` doc already exists).

## 1. Read-only holiday calendar on My Attendance + relayout

`MyAttendance.svelte`'s hero is a 2-column grid (`.att-hero`, `grid-template-columns: 1.35fr 1fr`):
`.att-punch` (left) and `.att-glance` "Today at a glance" (right). Relayout the RIGHT column to stack a
**holiday calendar on top** and the **existing glance box beneath** it. Left column (punch panel)
unchanged except for item 2.

New component `HolidayCalendarView.svelte` (read-only): queries `ygTimesheet.class.Holiday`, renders
Huly's `MonthCalendar` with month prev/next nav and a non-interactive `cell` slot showing the day
number, a highlight + name for holiday days, and a ring/marker for **today**. No click, no popup (unlike
the HR-editable `HrHolidays.svelte`, which stays as the management UI). It reuses the `MonthCalendar` +
`midOf(date)` local-midnight keying + `shiftMonth` idiom from `HrHolidays.svelte`.

`MyAttendance.svelte` imports and renders `<HolidayCalendarView />` as the top of the right column.

## 2. Office/WFH mode mandatory on every punch-in

Today `MyAttendance.svelte` defaults the mode (`let mode: AttendanceMode = 'office'`) and re-seeds it to
the last-used mode (`nextMode(todays)`) whenever not punched in - so a punch-in always has a mode
preselected. Change to require an explicit choice each time:

- `let mode: AttendanceMode | undefined = undefined` - start with NOTHING selected.
- Remove the sticky re-seed reactive block (the `modeSeedKey` / `nextMode` logic).
- The Office/WFH segmented toggle shows neither option active when `mode === undefined`.
- The **Punch In button is disabled** while not punched in AND `mode === undefined` (a hint like "Select
  Office or WFH" is fine).
- The punch handler guards `if (mode === undefined) return` before `createPunchIn(client, me, mode, note)`
  (`createPunchIn` already requires a non-optional `mode`).
- After a punch-OUT, reset `mode = undefined` so the next punch-in requires a fresh choice.

`createPunchIn` (utils/attendance-write.ts) is unchanged - `mode` is already a required parameter.

## 3. Reminder notification: no auto-punch (open the app instead)

`AttendanceReminder.svelte`'s `doPunch()` currently, when not punched in, calls
`createPunchIn(client, me, nextMode(todays))` - an auto punch-in with an auto-picked mode, triggered by
the OS-notification click (via the service worker -> `onSwMessage` -> `doPunch`) AND the in-app reminder
banner button. Change the **punch-IN** branch to NOT write; instead just `goToMyAttendance()` so the
employee lands on the punch panel and picks the mode. Keep the **punch-OUT** branch as-is
(`closePunchOut` - no mode needed, auto-close is fine). Both the OS-notification path and the in-app
banner button share `doPunch`, so this one change fixes both. No service-worker change needed (it already
focuses/opens the app and posts the action; only the page-side write is removed).

## 4. Rename "Late" -> "Late night"

In `Performance.svelte` (drill-down panel), the `lateNight` chip text changes from `Late` to `Late night`
(plain text, consistent with the sibling `Off-day` / `OT +Xh` chips). The aggregate column header already
reads "Late night" (`ygTimesheet.string.LateNightCol`) - unchanged.

## Cleanup

`nextMode` (utils/attendance.ts) loses both its callers (the seed in MyAttendance and the auto-punch in
AttendanceReminder). If it becomes unused, remove it and its unit test; if any other caller remains, leave
it.

## Testing

- Mostly manual (UI): calendar shows holidays + today read-only on Attendance; punch-in is blocked until a
  mode is picked and requires re-picking each time; the reminder notification and banner open My
  Attendance without punching; the performance chip reads "Late night".
- If `nextMode` is removed, drop its jest test; otherwise the pure libs are unchanged (no new lib logic -
  the calendar and mode gating are component-level).

## Out of scope

- Changing the `AttendanceSession` model or `createPunchIn` signature.
- Showing attendance/worked data inside the calendar (it shows holidays + today only).
- Reworking the reminder settings or the service worker beyond removing the page-side auto-punch.
- Any performance-report math change (label only).

## Deploy

Front-only build (`yg-local/front:beta`) + `up -d front` + restart nginx. No `upgrade-workspace`.
Batchable; local first, then prod with the other pending `yg_beta` work.
