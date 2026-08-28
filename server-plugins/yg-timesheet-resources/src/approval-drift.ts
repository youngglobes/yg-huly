//
// YoungGlobes: approved-hours drift helpers (payroll integrity, 2026-08-07).
//
// Pure rules shared by OnTimeSpendReportChange's auto-reopen step: given a TimeSpendReport that
// was just created/edited, does the Approved task it belongs to now disagree with the live logged
// total for that (employee, issue, day)? No platform deps, so these are trivially unit-testable -
// same idiom as estimate-gate.ts in this package.
//
// day/window math intentionally mirrors plugins/yg-timesheet-resources/src/utils/attendance.ts
// (localMidnight) and .../week.ts (withinDay): this server package has no dependency on that
// (client, svelte-bundled) package, so the tiny local-calendar math is duplicated here rather than
// pulled in cross-package - this codebase already duplicates round2 the same way across several
// files in the client package.
//

/** Local midnight (ms) of the day containing `ms` - matches how TimesheetTask.date is stamped. */
export function localMidnightOf (ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** True when `instantMs` falls within the 24h window starting at `dayStartMs`. */
export function inDayWindow (dayStartMs: number, instantMs: number): boolean {
  return instantMs >= dayStartMs && instantMs < dayStartMs + 86_400_000
}

/** Round to 2 decimal places so float noise never reads as spurious drift. */
export function round2 (n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Sum `value` over every report whose `date` falls in the day window starting at `dayStartMs`.
 * Callers pre-filter the report list to the (employee, issue) pair; this only applies the
 * day-window cut. Rounded to 2dp.
 */
export function sumHoursInDayWindow (
  reports: ReadonlyArray<{ date: number | null | undefined, value: number }>,
  dayStartMs: number
): number {
  let total = 0
  for (const r of reports) {
    if (r.date == null) continue
    if (inDayWindow(dayStartMs, r.date)) total += r.value
  }
  return round2(total)
}

/**
 * Does the live total differ from what was approved/submitted (both rounded to 2dp first)? Used to
 * decide whether an Approved task must be reopened - and, just as importantly, to stay idempotent:
 * re-approving to the exact same number must never thrash the task back to Submitted.
 */
export function roundedHoursDiffer (approvedOrSubmitted: number, liveHours: number): boolean {
  return round2(approvedOrSubmitted) !== round2(liveHours)
}
