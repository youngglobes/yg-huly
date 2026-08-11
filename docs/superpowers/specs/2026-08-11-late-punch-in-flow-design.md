# Late punch-in flow (backlog #9) - design

Date: 2026-08-11
Status: approved (brainstorming), pending implementation plan
Area: yg-timesheet attendance (yg_beta)

## Problem

Employees are expected to start at a per-employee shift time (`WorkProfile.shiftStart`, already
stored as minutes-since-midnight and editable by HR in the Work Profile editor). Today nothing
happens when someone punches in after their shift start: there is no record, no reason, and no
punctuality signal anywhere. HR wants late arrivals captured with a reason, approved or rejected by
HR, and an approved (excused) late day to not count against the employee.

This is the first piece of backlog #9 (HR permissions and leaves). It covers late punch-in only;
broader leave/permission handling is out of scope here.

## Decisions (from brainstorming)

1. **Core flow:** detect a late punch-in, require a reason, record it as a Pending request, HR
   approves or rejects. Approved = excused (does not count against the employee); Pending or
   Rejected = counts as an un-excused late day.
2. **Late trigger:** exact `shiftStart`, no grace. Late = the first punch-in of the day has a
   local time-of-day strictly greater than `shiftStart`. Employees with no `shiftStart` set are
   exempt (no prompt, no record) until HR sets one.
3. **Approver:** HR only.
4. **Surfacing:** per-day status (Late / Excused / Pending) in the employee attendance history, plus
   a per-employee "Late arrivals" count in the HR Performance report (and its xlsx export) that
   tallies only un-excused late days.
5. **Reason is required (blocking):** a late punch-in cannot be completed without a reason.
6. **Enforcement:** client gates Approve/Reject to HR, plus a server guard that reverts a non-HR (or
   self) status change so an approval cannot be forged.

## Data model

New class `LatePermission` (one per late day), stored in `core.space.Workspace` (world-readable),
matching how `AttendanceSession` already stores attendance. Keyed logically by (employee, date):
at most one per employee per day.

Fields:

- `employee: Ref<Employee>`
- `date: Timestamp` - local midnight of the late day (same day key as `AttendanceSession.date`)
- `punchIn: Timestamp` - full ms of the triggering (first) punch-in
- `shiftStartSnapshot: number` - `shiftStart` (minutes) captured at creation, so a later profile
  edit never rewrites history
- `minutesLate: number` - snapshot: punch-in local time-of-day minus `shiftStartSnapshot`
- `reason: string` - required, entered by the employee at punch-in
- `status: 'Pending' | 'Approved' | 'Rejected'`
- `approvedBy?: Ref<Employee>` / `approvedOn?: Timestamp`
- `rejectReason?: string` - captured when HR rejects, mirroring the timesheet reject pattern

Rationale for a standalone doc (not a field on `AttendanceSession`): late is a per-day fact tied to
the first punch, a day can have several sessions, and the approval overlay (status, approver,
reason) is cleanly separate from the immutable punch record. This mirrors the existing
`TimesheetApproval`/`TimesheetTask` split.

## Detection and reason capture (punch-in)

`createPunchIn` (`utils/attendance-write.ts`) is the single choke point for punch-ins and already
enforces one open session. The My Attendance punch flow is extended:

1. On a punch-in attempt, if this is the **first** punch of the day (no earlier `AttendanceSession`
   with the same `date`), read the employee's `WorkProfile.shiftStart` (the mixin on Employee).
2. If `shiftStart` is set and the punch-in local time-of-day is strictly after it, the punch is
   **late**. The punch UI requires a **reason** before it will complete.
3. On confirm, the same user action writes both the `AttendanceSession` (via `createPunchIn`) and a
   `Pending` `LatePermission` with the snapshots above.
4. If `shiftStart` is unset, or the punch is on time, or it is a second+ punch of the day, behave
   exactly as today (no prompt, no record).

Late detection is a pure helper (e.g. `isLate(punchInMs, shiftStartMin)` and a `minutesLateOf`
companion) unit-tested in isolation, same idiom as `approval-drift.ts`.

Note: the reminder controller no longer auto-punches (it opens My Attendance), so the reason prompt
always has a UI to render in; `createPunchIn` keeps writing only the session.

## HR review

A new **"Late Permissions"** view in the HR app menu, alongside Timesheets / Attendance /
Performance / Holidays (its own distinct icon, matching the existing HR submenu treatment). It lists
`LatePermission` docs, filterable by status, each row showing employee, date, minutes late, reason,
and current status. Actions: **Approve** (sets `Approved`, stamps `approvedBy`/`approvedOn`) and
**Reject** (sets `Rejected`, captures `rejectReason`). Visible/actionable to HR only.

## Surfacing

- **Employee - My Attendance history:** each day derives a status from its `LatePermission`:
  `Approved` -> **Excused**, `Rejected`/`Pending` -> **Late** (with the pending/rejected state
  distinguishable), no record -> nothing. Derivation is a pure helper.
- **HR - Performance report + xlsx:** a per-employee **"Late arrivals"** count that tallies late days
  whose permission is not `Approved` (i.e. Pending or Rejected). Approved days are excused and
  excluded. This is a focused punctuality metric; it does not change existing performance scoring
  (hours, overtime, off-days, late-night are untouched). Aggregation is a pure helper.

## Enforcement and security

- **Client gate:** Approve/Reject controls render only for HR.
- **Server guard:** an async trigger reverts any `LatePermission` status change (to `Approved`/
  `Rejected`) made by a non-HR actor, or a self-approval, back to its prior state - mirroring the
  existing approval/membership guards in `server-plugins/yg-timesheet-resources`. This closes the
  forge-your-own-approval hole rather than leaving it client-only.
- **Read privacy:** like `AttendanceSession`, `LatePermission` (including the reason text) is
  world-readable in this beta. That is consistent with the current attendance model; tightening
  per-employee read privacy is deferred with the rest of the attendance/approval hardening.

## Testing

Pure, dependency-free helpers with unit tests (same idiom as `performance.ts` / `approval-drift.ts`):

- late detection: `isLate` / `minutesLate` across before/at/after `shiftStart`, unset shiftStart,
  and day-boundary edges
- per-day status derivation from a `LatePermission` (Approved -> Excused, Pending/Rejected -> Late,
  none -> nothing)
- HR late-arrival count: excludes Approved, counts Pending + Rejected, per employee and per period

## Out of scope

- Broader permissions/leaves (rest of #9), reporting-manager approval, TL approval.
- Grace periods and org-default shift fallback (rejected in brainstorming; may revisit).
- Wiring holidays into the HR dashboard reference day / HR attendance grids (separate known gap).
- Any change to existing performance scoring beyond adding the late-arrival count.
