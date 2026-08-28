# Holidays calendar (HR portal) — design

**Date:** 2026-08-05
**Status:** Design (approved)
**Repo:** youngglobes/yg-huly (branch `yg_beta`)
**Backlog:** item #18. Supersedes the research note `2026-08-05-holidays-calendar-PAUSED.md`.

## Problem / goal

HR needs to mark public/festival holidays (Diwali, etc.) so a holiday becomes a NON-WORKING day
everywhere. Immediate consumer: the Performance report, where work logged/punched on a holiday then
counts as off-day effort ("working during holidays"). HR-only management, modern month-calendar UI.

## Decisions (locked)

- **Entry model:** ONE entry per day (name + date). This is the dominant HR-portal pattern (BambooHR,
  Zoho, Keka, GreytHR, and Huly's own stock `hr.class.PublicHoliday`); a multi-day festival is multiple
  entries (a few clicks on the calendar). No date ranges.
- **Scope:** org-wide (single office). No department/location scoping.
- **No type/recurring:** no mandatory-vs-optional type, no half-days, no auto-recurring. Entered fresh
  per year (festival dates move anyway). All are explicit non-goals for v1.

## Data model

New `ygTimesheet.class.Holiday` (domain `DOMAIN_YG_TIMESHEET`, following the `AttendanceSession`
precedent — plain `Timestamp`, NOT the stock HR `TzDate` struct):

```ts
export interface Holiday extends Doc {
  date: Timestamp // local midnight (ms) of the holiday day - same convention as AttendanceSession.date
  name: string    // e.g. "Diwali", "Independence Day"
}
```

**Space / access:** stored in `core.space.Workspace` (world-readable, like `AttendanceSession`), so EVERY
consumer (the report now, attendance/leave later) can factor holidays in. WRITE is HR-only, enforced by
the UI (only the HR-app "Holidays" special exposes add/remove), matching the "client-written" convention
attendance already uses (no server guard). A server-side write guard is an optional hardening follow-on
(low impact: a forged holiday only mis-marks a working day as off in reports, no data exposure).

## UI — "Holidays" HR special

A new special in the Human Resource app (`models/yg-timesheet/src/index.ts` specials array),
`accessLevel: AccountRole.DocGuest` (visible to HR-app users — roster members + owners, like the other
HR specials), `position: 'top'`. Component `HrHolidays.svelte`.

Layout: a **month calendar** (reuse `packages/ui`'s `MonthCalendar.svelte`, `cell` slot) with month
navigation and a **year selector**, beside a **list of that year's holidays** (date + name, newest or
chronological). Interaction:
- Click a **non-holiday day** -> a small inline popup to type the holiday name -> `client.createDoc`
  a `Holiday` at that day's local midnight.
- Click a **holiday day** (highlighted with its name) -> shows the name with a remove (x) -> `client.remove`.
- The side list mirrors the same add/remove.

Modern, self-contained: direct `createDoc`/`remove` (no approval workflow), plain `Timestamp`, no
departments — a clean lightweight take, not the heavier stock-HR schedule/TzDate model.

## Integration — holiday becomes a non-working day

`utils/week.ts` `isWorkingDay` gains an OPTIONAL holidays argument (backward compatible — only two callers
today, `performanceRows` and `lastWorkingDay`):

```ts
export function isWorkingDay (dateMs: number, holidays?: ReadonlySet<number>): boolean {
  // ... existing Sun/even-Sat/odd-Sat logic ...
  // then: if holidays?.has(localMidnight(dateMs)) return false
}
```
The holidays set holds each holiday's local-midnight ms. `performanceRows(emps, hours, atts, now,
holidays?)` threads the set into every `isWorkingDay(day, holidays)` call. `Performance.svelte` loads
`Holiday` docs in the report's date range (a new query), builds the `Set<number>`, and passes it in.
Result: a holiday is non-working, so hours on it are off-day effort (and never overtime), automatically.

`lastWorkingDay` (timesheet-compliance "most recent working day") also accepts the optional holidays set
and passes it through, but its consumers adopting holidays is a SEPARATE follow-on (out of scope here) —
this spec delivers the Holidays feature + the Performance-report integration only.

## Data flow

`HrHolidays.svelte` owns holiday CRUD (createDoc/remove) + the calendar/list render. The report loads
holidays read-only. All working-day math stays in the pure `week.ts`/`performance.ts` libs (unit-tested);
components only query + render.

## Testing

- Pure lib (`week.ts`): jest — `isWorkingDay(day, holidays)` returns false for a holiday on an otherwise
  working day; unaffected when no set is passed (existing tests still green); holiday keyed by local
  midnight matches regardless of the time-of-day in `dateMs`.
- Pure lib (`performance.ts`): a holiday day with logged/punch hours becomes off-day (not overtime); the
  aggregate off-day rollup includes it. `performanceRows` without a holidays arg behaves exactly as today.
- Manual: HR opens "Holidays", marks a day, it highlights + lists; the Performance report shows work on
  that day as off-day; removing the holiday reverts it; non-HR users do not see the special.

## Out of scope (v1)

- Date ranges, holiday type (mandatory/optional), half-days, recurring/auto-roll, department/location scope.
- Timesheet-compliance / attendance / leave adopting holidays (a follow-on; `lastWorkingDay` is made
  holiday-ready but its consumers are not wired here).
- Server-side write guard (optional hardening; UI-gated for v1, per the attendance precedent).
- Importing the stock `hr.class.PublicHoliday` data (different model; not adopted).

## Deploy

MODEL CHANGE (new doc class + new HR special) -> full 4-image build + `upgrade-workspace yg` (NOT a
front-only build). Local first, then prod (batchable with other pending model work).
