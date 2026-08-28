# Performance Report — off-hours / overtime / holiday effort (hike review)

**Date:** 2026-08-04
**Status:** Design (approved)
**Repo:** youngglobes/yg-huly (branch `yg_beta`)
**Depends on:** Work Profile foundation (WorkProfile mixin — category + shiftStart), already built/deployed.

## Problem

Pravin needs, for the yearly hike review, a per-employee view of effort **beyond the normal 8-hour
day** — off-hours/late-night work, holiday/weekend work, and overtime — for devs + senior devs only
(PMs and sales/salesforce excluded). See the umbrella roadmap
`2026-08-01-work-profile-performance-design.md`.

## Placement & access

A new **"Performance"** special in the Human Resource app (sibling to the Attendance report),
`accessLevel: AccountRole.DocGuest` — visible to HR-app users (roster members + owners), consistent
with the Overview/Timesheets/Attendance report specials. `position: 'top'`.

## Filter & export

- Date-range filter (from/to native date inputs), **default = last 12 months** (rolling). Optional
  quick presets (This year / Last year / Last 12 months) are a nice-to-have, not required.
- **Excel export** of the current range, reusing the `utils/hr-attendance-xlsx.ts` pattern.

## Who is included

Purely the WorkProfile tag: active employees whose `category` is **`junior-dev` or `senior-dev`**
(`isTracked` from `utils/work-profile.ts`). Everyone else — `sales`, `salesforce`, `other`, and anyone
**untagged** (category `undefined`) — is excluded automatically. PMs are simply not tagged dev, so
they fall out; no separate approver logic is needed (the tag is HR-controlled and authoritative).

## Signals (per included employee, over the selected range)

Non-working day = `!isWorkingDay(dayMs)` (Sundays + even 2nd/4th Saturdays; Mon-Fri + odd Saturdays are
working — the YG week, already in `utils/week.ts`). Public holidays are NOT yet modelled (weekends-only
per the roadmap's deferred holiday editor).

1. **Off-day work** — from `HrTimeEntry` (logged hours): days that are non-working AND have > 0 logged
   hours. Report **# off-day days** + **off-day hours** (sum on those days).
2. **Overtime** — from `HrTimeEntry` on **working** days only: for each working day, `max(0, dayHours -
   8)`; report **overtime hours** (sum) + **# overtime days** (days where dayHours > 8). Working-day-only
   so off-day hours are not double-counted (off-day work is its own column).
3. **Late-night** — from `AttendanceSession`: **# days** with any session running **past 21:00 local**
   (punchOut after 21:00, or an open session already past 21:00). Sparse now; accumulates going forward.

`HrTimeEntry.date` is a full ms timestamp → bucket to the local calendar day before per-day grouping
(same fix as the HR dashboard's Days column).

## Report layout

One row per included employee, columns:

| Employee | Category | Off-day (days / hrs) | Overtime (hrs / days) | Late-night (days) | **Total extra hrs** |

- **Total extra hrs** = off-day hours + overtime hours — the headline; table sorted by it **descending**
  (most extra effort first). Late-night is a day-count, shown separately (not summed into hours).
- **All included employees are shown**, even zero-effort ones (so a reviewer sees who did and did not
  go beyond). Ties broken by name.

## Data flow

`Performance.svelte` (report page) owns the queries — `HrTimeEntry` in the range, `AttendanceSession`
in the range, active `Employee`s + their WorkProfile mixin (category), plus the day/week helpers — maps
to plain shapes, and feeds a pure, unit-tested lib `utils/performance.ts` that produces the per-employee
rows. All math lives in the lib; the component only queries + renders + exports.

Access: `HrTimeEntry` lives in the private HrData space (readable by roster members); `AttendanceSession`
is world-readable. The Performance viewer is a roster member (HR app), so both resolve.

## Testing

- Pure lib (`utils/performance.ts`): jest — off-day day/hour rollup, working-day overtime (>8h),
  late-night day detection (past 21:00, incl. cross-midnight/open sessions), tag inclusion, total +
  sort. No platform deps.
- Manual: log in as HR/owner → Performance special shows tagged dev/senior-dev only, numbers reconcile,
  date range + Excel export work; untagged/sales excluded.

## Out of scope (later)

- Public-holiday credit (weekends-only for now; holiday-list editor is a later roadmap follow-on).
- Late punch-in / tardiness columns (separate roadmap phase; the `shiftStart` field supports it).
- Attendance-based overtime (uses logged-hours >8h now; refine when attendance history matures).
- Per-shift "expected end" precision (absolute 9 PM late-night threshold is intentional).

## Deploy

Model change (new HR special) → the 4-image build + `upgrade-workspace yg` cutover (local first, then
prod later — best batched with the Work Profile foundation into one prod release).
