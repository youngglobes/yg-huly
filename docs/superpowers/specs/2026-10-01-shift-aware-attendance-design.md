# Shift-aware attendance: work day by shift type

Status: draft for review (2026-10-01). Branch: `yg_beta`, then `yg_develop` (prod) after beta.
Decided with the user and their PM in the 2026-09-30 brainstorm.

## Why

An attendance session is filed under the calendar day of its punch-in
(`AttendanceSession.date = localMidnight(punchIn)`, `utils/attendance-write.ts:35`). A UK-shift
employee working 15:00-01:00 IST who punches out at 23:50 and back in at 00:10 sees one shift
split over two days: most of it on day 1, 50 minutes on day 2. The data is correct; the record
misleads the employee and HR. The old HR portal (OrangeHRM, `hr.youngglobe.com`) has the same
behaviour: it selects records by `punchInUserTime` between `<date> 00:00:00` and `23:59:59`
(`viewAttendanceRecordAction.class.php`), with no shift logic.

## Decisions

1. **Shift types** say which shift an employee works. Four to start: **Day, UK, US, Aus**.
   They are configurable by HR (add, rename, edit, archive), each with a **description**.
2. Each shift type has a **day start** time (the "flip"): the clock time when one work day ends
   and the next begins. A session belongs to the work day in which its punch-in falls:
   from the day start on date D up to just before the day start on D+1.
3. Defaults (IST):

   | Shift | Usual hours (IST, informational) | Day starts at |
   |---|---|---|
   | Day | 09:00-20:00 (incl. 11:00 starters) | 06:00 |
   | UK | 13:30-01:00 | 06:00 |
   | US | 18:30-04:30 | 06:00 |
   | Aus | 04:00-16:00, evening support 17:00-22:00 | 00:00 (calendar day) |

   US assumes East-coast hours; a Pacific-hours team would need a later day start (e.g.
   10:00), which HR can set without a code change.
4. Each employee is assigned **one** shift type. The existing per-employee **work start time**
   (`WorkProfile.shiftStart`) **stays** and keeps driving late punch-in: grace is personal
   (seniors get a later start), not a property of the shift.
5. An employee with **no** shift type behaves exactly as today (day starts at 00:00).
6. The rule is **stateless**: the work day comes from the punch-in instant and the employee's
   shift type only. No look-back at earlier sessions or running totals.

## Model (`plugins/yg-timesheet`, `models/yg-timesheet`)

- New class `ShiftType` (domain `DOMAIN_YG_TIMESHEET`, space `core.space.Workspace`):
  - `name: string` (unique, case-insensitive)
  - `description: string` (shown on the config page and in the employee picker)
  - `dayStartMin: number` (0-1439, minutes since midnight: the day flip)
  - `hoursFromMin?: number`, `hoursToMin?: number` (usual working hours, informational; used
    only for the config-page warning below)
  - `archived?: boolean` (archived types cannot be newly assigned; existing assignments keep working)
- `WorkProfile` gains `shiftType?: Ref<ShiftType>`.
- Model migration seeds the four default types (idempotent, by name) with these descriptions:
  - Day: "Indian day shift. The work day runs 06:00 to 06:00, so late evening work stays on the day it started."
  - UK: "UK hours worked from India. Sessions after midnight (until 06:00) count on the day the shift started."
  - US: "US East-coast hours worked from India. Sessions after midnight (until 06:00) count on the day the shift started."
  - Aus: "Australian hours worked from India (early morning start). The work day is the calendar day."
- No change to `AttendanceSession`'s shape: `date` keeps its meaning "local midnight of the
  session's day", it is only stamped with the **work** day instead of the calendar day. Every
  reader that groups by `date` is therefore correct without change.

## Config page

A "Shifts" section at the bottom of **HR Settings** (HR app, `HrLists.svelte`, component
`plugins/yg-hr-resources/src/components/ShiftTypesSection.svelte`), visible to HR members and
admins like the other HR lists. (Amended 2026-10-01 after beta review: it first shipped as a
separate Timesheet settings page; moved so shifts sit with the other HR configuration. Clicking
"Add shift type" with missing fields shows "Enter a name" / "A shift with this name already
exists" / "Set the time the day starts"; the inside-hours warning also shows on the add row.)

- One row per shift type: name, description, day start, usual hours, number of employees
  assigned, archive toggle. Add / edit in place.
- A help panel at the top, in plain words with an example:
  > **Day starts at** is when one work day ends and the next begins. Everything an employee
  > punches between that time today and the same time tomorrow counts on today. Example, UK
  > shift with day start 06:00: punch in 15:00, out 23:50, in again 00:10, out 01:00: the whole
  > shift counts on the day it started. Set it to a time when nobody on this shift is working.
- Validation: a **warning** (not a block) when the day start falls inside the usual hours
  ("Day start 12:00 is inside this shift's hours 04:00-16:00: shifts will be split over two
  days").
- Changing a day start applies to **new** punch-ins only; existing records change only through
  the recompute tool (below). The page says so next to the field.

### Adding a new shift (no code change, no deployment)

New shifts are expected (e.g. splitting US into "US East" and "US West"). An **Add shift type**
button opens the same fields: name, description, usual hours, day starts at. On save:

- The new type appears immediately in the employee "Shift type" picker.
- Nothing else changes until HR assigns employees to it; their new punch-ins then follow it.
- To move those employees' earlier records too, run the recompute tool (dry run first).

Worked example, shown as placeholder text in the empty form:

| Field | Example |
|---|---|
| Name | US West |
| Description | US Pacific hours worked from India. Sessions after midnight (until 10:00) count on the day the shift started. |
| Usual hours | 21:30-06:30 |
| Day starts at | 10:00 |

Renaming the existing "US" to "US East" is an in-place edit; assigned employees keep it.
Removing a shift is **archive**, not delete, so history that refers to it stays readable; an
archived type with employees still assigned shows a warning listing them.

## Assigning employees

A "Shift type" picker (with each type's description as the hint) next to "Shift start" in:
the HR profile Job tab (`plugins/yg-hr-resources/src/components/tabs/JobTab.svelte`) and
`WorkProfileEditor.svelte`. HR only, same permission as editing shift start today.

## The rule in code

One pure function, unit-tested, used everywhere a day is decided:

```ts
// utils/workday.ts
/** Local midnight (ms) of the work day that `ms` falls in, for a day that starts at dayStartMin. */
export function workDayOf (ms: number, dayStartMin: number): number
// = localMidnight(ms - dayStartMin * 60000), using local (browser) time like localMidnight.
```

Callers resolve `dayStartMin` from the employee's shift type (0 when none) via one helper
`dayStartFor(employee)` backed by a live query of `ShiftType` + the employee's `WorkProfile`.

Changes:
- **Write:** `attendance-write.ts` stamps `date: workDayOf(at, dayStartMin)`.
- **"Today" for the signed-in employee:** `MyAttendance.svelte`, `EmployeeDashboard.svelte`,
  `dashboard/MyAttendanceCard.svelte` use `workDayOf(now, myDayStart)` instead of
  `localMidnight(now)`. A UK worker at 00:30 still sees their running shift as today.
- **Reports that recompute the day from `punchIn`** must read `session.date` instead:
  `utils/performance.ts:70` (`localMidnight(a.punchIn)`). The plan audits every other
  `localMidnight(`/`punchIn` day derivation in yg-timesheet and yg-hr (client and server).
- **HR views** keep keying by `date`. HR "Today" stays the calendar date key; in normal hours
  it equals every employee's work day.
- **Display:** in session lists, a punch time on a later calendar date than the session's work
  day gets a small "+1 day" marker (e.g. "00:10 +1 day"), so the record is honest about when it
  happened.

## Late punch-in

- Only the **first** session of a work day is checked (as today, but "day" is now the work day,
  so a UK worker's 00:10 return from a break is never a new day's first punch).
- Lateness is measured against the start **instant** anchored to the work day:
  `start = workDay + shiftStart`, plus one day when `shiftStart < dayStartMin` (a start time
  that falls after midnight in that shift's day). `minutesLate = max(0, punchIn - start)`.
  This fixes a latent bug for shifts whose start is after midnight; for every default type the
  result equals today's time-of-day comparison.
- `LatePermission.date` uses the same work-day key. Snapshots (`shiftStartSnapshot`) unchanged.

## Existing records

A recompute tool (run once at rollout, and again after HR changes a day start if they want old
records moved): for every employee with a shift type whose `dayStartMin > 0`, recompute
`date = workDayOf(punchIn, dayStartMin)` for their `AttendanceSession`s and the matching
`LatePermission`s. Dry run first: prints employee, session, old date, new date; writes nothing
until re-run with `--apply`. Sessions already on the right day are untouched. Only sessions
punched in between 00:00 and the day start can move, and only by one day.

## Not in scope

- Timesheet entries (`TimeSpendReport` dates are chosen by the user, not derived).
- Rotating rosters (different shift per date), per-employee day-start override.
- Payroll changes.
- The old HR portal.

## Testing

- Unit: `workDayOf` across the default day starts, DST-free IST, boundaries (exactly at day
  start counts on the new day; one minute before counts on the previous day); late anchoring
  incl. a start after midnight; "+1 day" marker predicate.
- Component-level: config page warning; picker shows descriptions; archived types not offered.
- Beta end-to-end: a UK-shift test employee punches 15:00-23:50 and 00:10-01:00 (clock faked
  or real) and sees one day of 9h40m in My Attendance, HR Attendance and Performance; a Day
  employee is unaffected; recompute dry run lists exactly the expected sessions.

## Rollout

Model change: full 5-image beta build, `upgrade-workspace` (runs the seed migration), HR assigns
shift types to UK/US/Aus staff, recompute dry run, then `--apply`. Prod via `yg_develop` with
`upgrade-workspace`, the same order, and the transactor restart rules in the runbook.
