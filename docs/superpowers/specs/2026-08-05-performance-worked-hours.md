# Performance report: worked hours from summed punch sessions (timesheet fallback)

**Date:** 2026-08-05
**Status:** Design (approved)
**Repo:** youngglobes/yg-huly (branch `yg_beta`)
**Builds on:** `2026-08-05-performance-drilldown-latenight.md` (the `performanceRows` lib + drill-down panel).

## Problem

The report's worked-hours (driving Off-day, Overtime, and the late-night >8h gate) comes from
self-logged timesheet hours (`HrTimeEntry`). The team wants it from **attendance punch data**, and
crucially from the **sum of each punch session's duration**, NOT the first-punch-to-last-punch span.
A person present 11:00-20:30 (9.5h) who actually worked two sessions totalling 8h (with a 1h lunch +
0.5h evening break in between) should read **8h worked, 0 overtime** - not 9.5h / 1.5h OT. Summing
per-session durations excludes the break gaps automatically; the span does not.

## Decision (approved)

Worked hours per day come from **summed punch sessions when the day has punch data, else the
self-logged timesheet hours** (fallback). Punch/attendance is new (only ~Aug 2026 onward; ~5 rows vs
9,455 timesheet rows), so the fallback keeps the full year populated now, and each day upgrades to the
accurate punch measure as attendance accumulates.

## Rule

Per employee, per local calendar day (`localMidnight`):

- **workedHours** = if the day has ANY punch session: `sum over sessions of (sessionEnd - punchIn)`,
  converted to hours; ELSE: the summed `HrTimeEntry` hours for that day (today's behaviour).
- **sessionEnd** for a session = `punchOut` if closed; else (open session) `now` only when the punch-in
  is TODAY, otherwise `punchIn` (a past open session is a forgotten punch-out - contributes 0 rather
  than a runaway `now - punchIn`). The same `sessionEnd` feeds the late-night 22:00 check.
- Sessions are assumed non-overlapping (you cannot punch in twice without punching out), so the sum is
  real desk time minus the break gaps.

Everything then keys off `workedHours` (previously `hoursLogged`):

- **Off-day** (non-working day): `workedHours > 0` -> off-day day; off-day hours += `workedHours`.
- **Overtime** (working day): `max(0, workedHours - 8)`; overtime day iff `workedHours > 8`.
- **Late-night**: a session past 22:00 local AND `workedHours > 8`.
- **Total extra** = off-day hours + overtime hours (unchanged formula, new source).

The 8h threshold ("productivity") and the 22:00 late-night threshold are unchanged. Off-day / overtime
classification by working-vs-non-working day is unchanged.

## Data flow / implementation

`plugins/yg-timesheet-resources/src/utils/performance.ts` (`performanceRows`) already merges
`HrTimeEntry` (`PerfHours`) and `AttendanceSession` (`PerfAtt`) into a per-(employee, day)
accumulator. Extend the accumulator with `sessionMs` (summed session durations) and `hasSession`
(whether any punch touched the day); the per-day rollup computes `workedHours` from those (session-sum
or the logged fallback) and every signal uses it. No new queries - `Performance.svelte` already loads
both `HrTimeEntry` and `AttendanceSession` in range and maps them to `PerfHours`/`PerfAtt`. Multiple
`PerfAtt` for the same employee+day already accumulate correctly.

`FlaggedDay.hoursLogged` is renamed **`workedHours`** to reflect the new meaning (session-sum or
logged fallback); the drill-down panel reads the renamed field. The panel keeps showing the punch
in->out span; a day with `workedHours` but no `punchIn` is a timesheet-fallback day (blank punch marks
it). Excel export reads the aggregate `PerfRow` columns (off-day / overtime / total), which keep their
names - export is unaffected.

## Testing

Rewrite the pure-lib tests (`__tests__/performance.test.ts`) for the new source of truth:

- **Session-sum worked hours:** a day with two sessions (e.g. 13:00-17:00 + 17:30-21:15 = 7.75h)
  yields `workedHours` 7.75 (NOT the 8.25h span), so a working day is under 8h -> no overtime; the
  same shape summing to >8h -> the excess is overtime.
- **Fallback:** a day with `PerfHours` but no `PerfAtt` -> `workedHours` = the logged hours (existing
  off-day / overtime behaviour preserved).
- **Precedence:** a day with BOTH punch and logged hours -> punch session-sum wins (logged ignored).
- **Open session:** today's open session counts to `now`; a past open session contributes 0.
- **Late-night** re-expressed against `workedHours` (session-sum > 8 AND a session past 22:00).

## Out of scope

- Changing the 8h or 22:00 thresholds, or the working-day calendar.
- Public holidays (backlog #18) and per-shift expected-end (later).
- Showing per-session detail inside the panel (compact day list only; punch span stays as the
  in->out summary).
- Deduping/clamping pathological overlapping sessions beyond the past-open-session rule above.

## Deploy

Client-only (front-only build). Batched with any other pending front work; local first, then prod.
Seed data (migration repo) will gain a realistic multi-session day so the report demonstrates break
exclusion (worked < span).
