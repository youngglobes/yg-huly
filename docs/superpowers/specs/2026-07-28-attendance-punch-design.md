# Attendance (Punch In/Out) — Design (Phase 1d)

**Date:** 2026-07-28 · **Branch:** `yg_beta` (LOCAL/beta only) · **Status:** design approved, spec for review

## Goal

Replace OrangeHRM's attendance punch with a cleaner, self-service punch in/out inside Huly, so
employees stop double-entering. v1 is **punch capture only** (self-service): the employee punches
in/out multiple times a day, each session tagged Office or WFH, with an optional note per punch, and
views their own sessions. HR/manager attendance reports and leave management are **later phases** in
this same new module.

Reference (what we are replacing + improving on): OrangeHRM's two separate pages — a "Punch In/Out"
page and a "My Attendance Records" table. We deliberately do NOT copy that two-page split; v1 is one
unified page.

## Placement — a new "Attendance" module

- A **new top-level `Attendance` app** in the left rail, built in the existing yg-timesheet packages
  (same pattern the HR app already uses: `ygTimesheet.app.HumanResource`). No new plugin.
  - `ygTimesheet.app.Attendance`, alias `yg-attendance`, label `ygTimesheet.string.Attendance`.
  - `navigatorModel.specials`: one special for v1 — **My Attendance** (`id: 'my'`, component
    `ygTimesheet.component.MyAttendance`, default landing). Leave + attendance-report specials get
    added here in later phases.
- The existing **Timesheet** app is unchanged (My Timesheet, Dashboard, Approvals, Reports,
  Configuration stay exactly as they are). Attendance is a separate module, not a menu inside Timesheet.

## Data model

One doc **per session** (a punch-in, later closed by a punch-out):

```ts
interface AttendanceSession extends Doc {
  employee: Ref<Employee>
  date: Timestamp          // local midnight (ms) of the punch-in day — for day grouping/history
  punchIn: Timestamp       // full ms timestamp of punch-in
  punchInNote?: string     // optional note captured at punch-in
  mode: 'office' | 'wfh'   // set at punch-in; immutable
  punchOut?: Timestamp     // full ms timestamp of punch-out; absent while the session is open
  punchOutNote?: string    // optional note captured at punch-out
}
```

- New model class `ygTimesheet.class.AttendanceSession` in domain `DOMAIN_YG_TIMESHEET` (reuses the
  existing `yg_timesheet` table; rows keyed by `_class`).
- Duration is **derived** (`punchOut - punchIn`), never stored.
- Space: `core.space.Workspace` (shared, like Timesheet/TimesheetTask). Each employee queries only
  their own (`employee == me`). NB: the shared space means a crafted tx could read/write others'
  sessions — acceptable for a self-service beta with a trusted team (same posture as the timesheet),
  and the future HR report reads all sessions from here anyway. No server trigger in v1.

## My Attendance — one unified page (`MyAttendance.svelte`)

**Punch card (top):**
- A live **clock** (today's date + current time, ticking).
- One **state-aware primary button**:
  - When **out** (no open session): reads **Punch In** (green). Clicking creates an
    `AttendanceSession` `{ employee: me, date: todayMidnight, punchIn: now, punchInNote: note, mode }`.
  - When **in** (an open session exists): shows the open session's start + a **live running timer**
    (elapsed = now − punchIn) and reads **Punch Out**. Clicking sets `{ punchOut: now, punchOutNote:
    note }` on that open session.
- A **Present/WFH toggle** (WFH on/off; Office is the default/off), shown when out:
  - Initializes to **today's most recent session's mode**, or **Office** if today has no sessions yet.
  - Effect: resets to Office each new day, but is **sticky within the day** — toggle WFH once in the
    morning and later sessions that day default WFH; toggle back to office and it holds. This avoids a
    stale WFH bleeding into the next (office) day. The toggle is hidden/disabled while punched in (mode
    is fixed at punch-in).
- An optional **Note** textarea, applied to the current action (the punch-in note when punching in,
  the punch-out note when punching out).

**Today's sessions (below the card):**
- A clean row per session for today: **In** (time + note) · **Out** (time + note) · **Present/WFH**
  chip · **Duration**. An open (not-yet-out) session shows its duration ticking live and no out time.
- A **daily Total** = sum of closed session durations (open session's live elapsed included in the
  running display).

**History:**
- A **date picker**; selecting a past date shows that day's sessions (same row layout), **read-only**.
  Defaults to today.

**Styling:** the YG design system (`yg-table.scss` tokens — `--yg-panel`/`--yg-ink`/status colors,
`.yg-table`, cards). Present = neutral/ink chip, WFH = a distinct accent chip.

## Behavior / rules

- **Immutable:** the only writes are Punch In (create) and Punch Out (close the open session). No edit,
  no delete, no manual time entry. "Immutable" is a UI guarantee in v1 (not server-enforced).
- **At most one open session** per employee at a time. Punch In is disabled if an open session exists
  (button is already "Punch Out"); Punch Out closes the single open session.
- **Notes** optional at both punch-in and punch-out.
- **Multiple sessions/day**; day boundary = **local** date. `date` on the session = local midnight of
  the punch-in instant. A session that spans midnight keeps the punch-in day's `date` (edge case;
  acceptable — the duration is still punchOut − punchIn).
- **Client-written**, no server trigger, no approval, no lock.

## Non-goals (v1)

No editing/corrections, no HR/manager attendance report, no leave management, no approval/lock, no
server-side immutability, no cross-employee views, no export. All are later phases in the Attendance
module.

## Testing & delivery

- Pure, jest-tested helper lib (`utils/attendance.ts`): duration, daily total, group-by-day,
  next-mode (today's-last-session-mode-else-office), find-open-session. Isolated from queries/UI.
- svelte-check + tsc clean on the resources package.
- **Delivery = full 4-image rebuild + `upgrade-workspace`** — a new model class (`AttendanceSession`)
  and a new app (`Attendance`) are model changes, so the workspace model + domain must be applied
  (same as the dashboard special / notification triggers). Client webpack needs
  `NODE_OPTIONS=--max-old-space-size=6144`; deploy redpanda-first.
- LOCAL/beta only; no `yg_develop` merge without explicit user OK (and blocked by the open
  timesheet-approval security gap regardless).
