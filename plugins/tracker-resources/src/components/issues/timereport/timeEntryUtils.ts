//
// Copyright © 2026 YoungGlobes.
//
// Pure helpers for the spent-time entry popup. Deliberately dependency-free so they can be
// unit-tested under the package's node/ts-jest setup, which has no Svelte transform.
//

/** A duration split into whole hours and whole minutes. */
export interface HoursMinutes {
  hours: number
  minutes: number
}

/**
 * Decompose decimal man-hours (the stored format) into whole hours and minutes.
 *
 * Rounding can push minutes to exactly 60 (e.g. 0.999 -> 0h 60m); that is rolled up into an
 * extra hour so the widget never displays "0h 60m".
 */
export function toHoursMinutes (value: number | undefined): HoursMinutes {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return { hours: 0, minutes: 0 }
  }
  let hours = Math.floor(value)
  let minutes = Math.round((value - hours) * 60)
  if (minutes >= 60) {
    hours += 1
    minutes -= 60
  }
  return { hours, minutes }
}

/** Compose whole hours and minutes back into decimal man-hours for storage. */
export function fromHoursMinutes (hours: number, minutes: number): number {
  const h = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0
  const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0
  return (h * 60 + m) / 60
}

/**
 * Normalise raw field input: carry minutes of 60 or more into hours, clamp negatives.
 * Typing "90" into the minutes field therefore becomes 1h 30m rather than being clamped to 59.
 */
export function normalizeHoursMinutes (hours: number, minutes: number): HoursMinutes {
  const h = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0
  const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0
  const total = h * 60 + m
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

/**
 * A literal calendar-day offset preserving the current time of day.
 *
 * Deliberately does NOT skip weekends. `getTimeReportDate()` in ../../../utils.ts walks
 * backwards off any weekend, which means Saturday work logged on Saturday silently lands on
 * Friday. Emergency weekend work must be loggable against the day it happened.
 */
export function localDayOffset (days: number, now: number = Date.now()): number {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  return d.valueOf()
}

/**
 * The last millisecond of the local day containing `ts`.
 *
 * Used for the future-date guard. Stored dates carry a time-of-day component, so comparing
 * against the day boundary is what makes "today at 09:30" count as not-in-the-future.
 */
export function endOfLocalDay (ts: number = Date.now()): number {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 999)
  return d.valueOf()
}
