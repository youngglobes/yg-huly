# Work Profiles + Performance & Attendance-Discipline — design / roadmap

**Date:** 2026-08-01
**Status:** Design (roadmap; build phase-by-phase)
**Repo:** youngglobes/yg-huly

## Problem

Pravin needs, for the yearly hike/performance review, visibility into effort **beyond the normal 8
hours** — off-hours/late-night work, holiday/weekend work, overtime. But "normal" differs by group
(junior devs start 9am, senior devs 11am, sales/salesforce 3pm, PMs no fixed hours), and only devs +
senior devs are in scope. There is no per-employee notion of category or shift start today, so neither
the report nor any attendance-discipline feature can be computed correctly.

## Foundation — Work Profile (build this first; everything depends on it)

A per-employee **work profile**: `category` + `shiftStart`.

- **Model:** a `WorkProfile` mixin on `contact.mixin.Employee` with:
  - `category`: `'junior-dev' | 'senior-dev' | 'sales' | 'salesforce' | 'other'`
  - `shiftStart`: local time-of-day (store as minutes-since-midnight or `"HH:MM"`), e.g. 540 = 09:00.
- **Editor:** an HR/owner-only page (an HR-app special, e.g. "Team profiles") listing all active
  employees with an inline category dropdown + start-time input. Owner/HR maintained.
- **PM exclusion is automatic** — PMs are the project approvers (`ProjectApprovers.pm`/`teamLead`),
  already derivable (same as the timesheet-compliance exclusion). No tag needed for them.
- `shiftStart` is dual-purpose: the "expected schedule" baseline AND the reference for late-punch-in
  (Phase 2+). It is NOT strictly required by the Phase-1 report math (that uses category + duration/
  clock thresholds), but is captured now so the later phases need no further model change.

Reusable rule already in code: `isWorkingDay` / `lastWorkingDay` (`utils/week.ts`) encodes the YG work
week (Mon-Fri + odd 1st/3rd/5th Saturdays; even Saturdays + Sundays off). See
[[yg-working-week-odd-saturdays]].

## Phase 1 — Performance Report (the hike-review report)

A new HR-app special **"Performance"** (report page), sibling to the Attendance report.

- **Filter:** date range (default last 12 months). **Excel export** (reuse the `hr-attendance-xlsx`
  pattern).
- **Included:** employees tagged **junior-dev or senior-dev** only. Excluded: sales, salesforce,
  other, untagged, and PMs (auto).
- **Per-employee columns / signals:**
  1. **Holiday/weekend work** — non-working days worked: count of days + hours. Source: `HrTimeEntry`
     (logged hours) dated on a non-working day (`isWorkingDay` + public holidays). *Available now
     (historical, backfilled).*
  2. **Overtime** — hours beyond 8h/day summed, + count of >8h days. Source: `HrTimeEntry` grouped per
     employee per day; `sum(hours) - 8` when > 8. Effort-based (logged >8h), available now.
  3. **Late-night** — days/sessions extending past ~21:00. Source: `AttendanceSession` punch times.
     *Sparse now; builds up going forward.*
- **Aggregation** in a pure, unit-tested lib (same pattern as the dashboards).
- **Naming:** "Performance" is deliberately broad so more metrics can be added later without renaming.

**Public holidays:** read Huly `hr.class.PublicHoliday` docs if maintained; if none entered, fall back
to weekends-only. Small "keep the holiday list updated" dependency for accurate holiday credit.

## Phase 2 — Late punch-in surfacing (employee-facing)

Once `shiftStart` is set, compute "late by X" = `punchIn - (todayShiftStart + grace)`.

- **Grace period:** a config value (e.g. 10-15 min) — decide when building (likely reuse/extend the
  existing Attendance reminder-settings doc, or a workspace setting).
- **Where shown:**
  - The employee's **My Attendance card** (Employee dashboard) and the **Attendance app** — a subtle
    "late" marker on today's first punch-in when applicable.
- Read-only awareness for the employee; no enforcement.

## Phase 3 — HR late-punch list

An HR view (report page or a tab on the Attendance report) listing late punch-ins across employees:
who, date, shift start, actual punch-in, minutes late. Filterable by date range / employee; exportable.
Excludes non-working days and (later) dismissed records.

## Phase 4 — Permission-based dismissal (waiver)

HR can mark a specific late punch-in as **excused** (punched late with permission) so it drops out of
counts/lists/reports.

- **Data model:** since `AttendanceSession.punchIn` is immutable, add a waiver signal — e.g. fields on
  the session (`lateWaived: boolean`, `lateWaivedBy: Ref<Employee>`, `lateWaiveReason`, `lateWaivedOn`)
  or a separate `LatePunchWaiver` doc keyed to the session. Owner/HR-only write (server-guarded, like
  the roster/approval spaces).
- Dismissed records show as "excused" in the HR list and are excluded from the late-punch tallies and
  the Performance report's late signals.

## Cross-cutting

- **Data reality:** holiday + overtime = available now (logged hours); everything punch-time-based
  (late-night, late punch-in) accumulates from the new attendance feature going forward.
- **Access:** the report + HR lists are HR/owner-only (HrData membership / role), consistent with the
  rest of the HR app. Remember icon-hiding is cosmetic; gate data reads server-side where it matters.
- **Build/deploy:** the WorkProfile mixin + each new HR special are model changes → the 4-image build +
  `upgrade-workspace` cutover path (as used for the dashboard release). Report/editor UI is front.
- **Testing:** all aggregation (holiday/overtime/late-night rollups, late-by-minutes, waiver filtering)
  in pure jest-tested libs.

## Build order (dependencies)

1. **Foundation — Work Profile** (mixin + HR editor). Blocks everything.
2. **Phase 1 — Performance Report** (needs category; holiday/overtime usable immediately).
3. **Phase 2 — Late punch-in surfacing** (needs shiftStart + attendance data).
4. **Phase 3 — HR late-punch list** (needs Phase 2's late computation).
5. **Phase 4 — Waiver/dismissal** (extends Phase 3).

Each phase is its own spec → plan → implement cycle. This doc is the umbrella roadmap.

## Open decisions (resolve per phase when building)

- Work profile: default start times per category vs fully per-person; how to treat untagged employees
  (exclude vs prompt HR).
- Overtime definition: logged >8h/day (chosen, available now) vs attendance-present >8h (needs data).
- Late-night threshold (21:00?) and grace period for lateness (10-15 min?).
- Waiver storage: session fields vs separate `LatePunchWaiver` doc.
- Holiday list ownership (who maintains `PublicHoliday`).
