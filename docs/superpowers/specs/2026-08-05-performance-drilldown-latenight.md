# Performance report: late-night rule refinement + per-person drill-down

**Date:** 2026-08-05
**Status:** Design (approved)
**Repo:** youngglobes/yg-huly (branch `yg_beta`)
**Builds on:** `2026-08-04-performance-report-design.md` (the Performance report + `utils/performance.ts`).
**Follows on:** Holiday calendar (backlog #18) is the agreed NEXT feature, not part of this spec.

## Problem

Two refinements to the shipped-local Performance report, both raised in review with the team:

1. **Late-night is too loose.** It currently counts any day with an attendance session past a
   fixed hour, regardless of how much was actually worked. A tracked dev who merely finishes a
   normal 8h day late gets flagged. Pravin wants late-night to mean genuine heavy work that ran
   late, not late presence.
2. **The aggregate numbers have no drill-down.** A reviewer sees "2 off-day days, 4.5h overtime,
   1 late-night day" but cannot see *which* days those were without leaving the report.

## Scope (this spec)

Client-only changes to `plugins/yg-timesheet-resources`: the pure lib `utils/performance.ts` and
the `Performance.svelte` report page. No model change, no new queries, no server work. Deploys as a
front-only build (batched with the already-committed 9 PM -> 10 PM threshold change, commit
`c17ecd47a`).

## 1. Late-night rule

A day counts as **late-night** when BOTH hold:

- an attendance session that day runs **past 22:00 local** (10 PM), AND
- the day's **production hours** (logged timesheet hours, `HrTimeEntry` - the same basis the
  Overtime column uses, NOT attendance presence) are **> 8**.

Applies on any day (a heavy weekend logged past 10 PM counts too - it is independent of the
working/off-day classification). "Past 22:00" keeps the existing cross-midnight / open-session
handling: `end = punchOut ?? now`, late if `end > localMidnight(punchIn) + 22h`.

Rationale: tracked devs finish by ~8:30 PM, so being present at 9 PM is minor overtime; requiring
both past-10 PM AND >8h logged captures only real late overtime and excludes "completed a normal 8h
day late."

## 2. Per-person drill-down panel

Click any employee row in the Performance table -> a **panel slides in from the right** listing that
person's **flagged days** in the current date range. Single person at a time; clicking another row
switches; a close button / backdrop dismisses; the main table stays in place.

**Flagged day** = any day contributing to at least one signal: off-day (non-working day with logged
hours), overtime (working day with >8h logged), or late-night (rule above). Days with no signal are
omitted. Rows sorted **newest first**.

**Each row shows:** date + weekday; signal chip(s) - `Off-day` / `OT +Xh` / `Late`; hours logged
that day (blank if none); punch **in -> out** (earliest in / latest out of that day's sessions;
blank if no session). Missing pieces render blank (an off-day logged from a timesheet may have no
punch; conversely a punch-only day with <=8h logged is not flagged at all under the rules above).

Empty state: a person with zero flagged days (an all-zero row) opens a panel that says there are no
off-day, overtime, or late-night days in the range.

## Data flow

No new queries - `Performance.svelte` already loads every `HrTimeEntry` and `AttendanceSession` in
range and maps them to the lib's `PerfHours` / `PerfAtt` shapes. The pure lib is extended so each
`PerfRow` also carries the per-day detail it already computes internally:

```ts
export interface FlaggedDay {
  date: number        // localMidnight (ms) of the day
  offDay: boolean     // non-working day with hoursLogged > 0
  overtimeHours: number // working day: max(0, hoursLogged - 8); else 0
  lateNight: boolean  // hoursLogged > 8 AND a session past 22:00
  hoursLogged: number // summed logged hours that day (0 if none)
  punchIn?: number    // earliest punch-in of the day (if any session)
  punchOut?: number   // latest punch-out of the day (undefined if an open session / none)
}
// PerfRow gains:  days: FlaggedDay[]   // flagged days only, newest first
```

`performanceRows` builds a per-day map merging logged hours (by `localMidnight(HrTimeEntry.date)`)
with that day's attendance sessions (earliest in / latest out, and whether any end is past 22:00),
derives each `FlaggedDay`, and both (a) rolls them up into the existing aggregate columns and (b)
attaches the flagged subset as `days`. The aggregate `lateNightDays` becomes the count of
`days` where `lateNight` is true. All math stays in the lib; `Performance.svelte` renders the table
(unchanged columns) plus the new slide-in `<aside>` bound to the clicked row's `days`.

The panel is a lightweight styled `<aside>` local to `Performance.svelte` (no platform Panel infra).

## Testing

Extend `__tests__/performance.test.ts` (pure lib, jest):

- **Late-night rule:** past 10 PM AND >8h logged -> late; past 10 PM but <=8h logged -> NOT late;
  >8h logged but session ends before 10 PM -> NOT late; cross-midnight and open-session cases still
  honored with the >8h gate.
- **`days` array:** the flagged set is the union of off-day / overtime / late-night days; a
  multi-signal day (e.g. overtime + late-night) appears once with both flags; `hoursLogged` and
  `punchIn`/`punchOut` merge correctly; unflagged days (<=8h, no off-day, no late-night) are
  excluded; ordering is newest first.
- Existing aggregate assertions updated where the stricter late-night rule changes an expected count.

Panel rendering is verified manually after the front build (open Performance as HR, click a person,
confirm the flagged days and their chips/hours/punches match the row's aggregates).

## Out of scope

- Issue-level breakdown inside the panel (compact day list only, by decision).
- Excel export changes (stays aggregate-only for now).
- Holiday calendar (backlog #18) - the agreed next feature; when it lands, `isWorkingDay` gains a
  holiday lookup and this report picks up holidays as off-days with no rework here.
- Multi-person / comparison views.

## Deploy

Front-only build (`yg-local/front:beta`) + `up -d front` + restart nginx. No `upgrade-workspace`.
Batched with the pending 10 PM threshold commit; local test first, prod later with the other batched
work. Seed data (migration repo) will be tuned during implementation to demonstrate all three
late-night outcomes.
