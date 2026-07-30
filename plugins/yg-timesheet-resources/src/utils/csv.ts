//
// Shared CSV cell encoding for every yg-timesheet export. Pure — no platform deps.
//
// Kept in ONE place on purpose: this is a security control (spreadsheet formula injection),
// and two copies are how one quietly stops matching the other.
//

/** Wrap in double quotes, doubling any embedded double quote (RFC 4180). */
export function esc (v: string): string {
  return `"${v.replace(/"/g, '""')}"`
}

// Cells whose first char could be interpreted as a spreadsheet formula (=, +, -, @) or a
// tab/CR (used in some formula-injection payloads) get apostrophe-prefixed before quoting,
// so opening the CSV in Excel/Sheets doesn't execute attacker-controlled text as a formula.
export const RISKY_PREFIX = /^[=+\-@\t\r]/

/** Escape a free-text cell: neutralise formula prefixes, then quote. */
export function escText (v: string): string {
  return esc(RISKY_PREFIX.test(v) ? `'${v}` : v)
}
