//
// YoungGlobes: pure punch-reminder rule engine (Phase 1e). No browser/Svelte deps - the controller
// feeds it a snapshot and delivers the result. Unit-tested in __tests__/reminder.test.ts.
//
export type ReminderKind = 'none' | 'punch-in' | 'punch-out'

export interface ReminderConfig {
  enabled: boolean
  windowStartMin: number // minutes from local midnight, e.g. 540 = 09:00
  windowEndMin: number // e.g. 1080 = 18:00
  days: number[] // allowed local weekdays, 0=Sun..6=Sat
  punchInDelayMin: number // sustained active-without-punch before the first punch-in reminder
  repeatMin: number // re-remind interval
  punchOutIdleMin: number // idle-while-punched-in before a punch-out reminder
}

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  windowStartMin: 9 * 60,
  windowEndMin: 18 * 60,
  days: [1, 2, 3, 4, 5],
  punchInDelayMin: 5,
  repeatMin: 5,
  punchOutIdleMin: 15
}

export interface ReminderInput {
  now: number
  userActive: boolean // IdleDetector userState === 'active' && screen unlocked
  punchedIn: boolean
  activeUnpunchedSince?: number // when the active+unpunched+in-window streak began (controller-tracked)
  idleSince?: number // when the user went idle; undefined while active
  snoozedUntil?: number
  lastRemindedAt?: number
  config: ReminderConfig
}

const MIN = 60_000

function minutesSinceMidnight (now: number): number {
  const d = new Date(now)
  return d.getHours() * 60 + d.getMinutes()
}
function isWorkDay (now: number, c: ReminderConfig): boolean {
  return c.days.includes(new Date(now).getDay())
}
function inWorkWindow (now: number, c: ReminderConfig): boolean {
  const mins = minutesSinceMidnight(now)
  return isWorkDay(now, c) && mins >= c.windowStartMin && mins < c.windowEndMin
}

export function evaluateReminder (i: ReminderInput): ReminderKind {
  const c = i.config
  if (!c.enabled) return 'none'

  // Snooze + repeat gate: not snoozed, and at least repeatMin since the last reminder.
  const gateOpen =
    i.now >= (i.snoozedUntil ?? 0) &&
    (i.lastRemindedAt === undefined || i.now - i.lastRemindedAt >= c.repeatMin * MIN)
  if (!gateOpen) return 'none'

  if (i.punchedIn) {
    const idleLong = i.idleSince !== undefined && i.now - i.idleSince >= c.punchOutIdleMin * MIN
    const pastEnd = isWorkDay(i.now, c) && minutesSinceMidnight(i.now) >= c.windowEndMin
    return idleLong || pastEnd ? 'punch-out' : 'none'
  }

  if (!inWorkWindow(i.now, c)) return 'none'
  if (!i.userActive) return 'none'
  if (i.activeUnpunchedSince === undefined) return 'none'
  return i.now - i.activeUnpunchedSince >= c.punchInDelayMin * MIN ? 'punch-in' : 'none'
}
