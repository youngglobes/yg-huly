import { evaluateReminder, DEFAULT_REMINDER_CONFIG, type ReminderInput } from '../reminder'

// Fixed clock helpers. 2026-07-29 is a Wednesday (getDay() === 3).
const at = (h: number, m = 0): number => new Date(2026, 6, 29, h, m, 0).getTime()
const cfg = { ...DEFAULT_REMINDER_CONFIG } // 09:00-18:00 Mon-Fri, in 5 / repeat 5 / out-idle 15
const base: ReminderInput = { now: at(10), userActive: true, punchedIn: false, config: cfg }

describe('evaluateReminder - punch-in', () => {
  test('active, unpunched, in window, streak >= delay -> punch-in', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 54) })).toBe('punch-in') // 6 min
  })
  test('streak shorter than delay -> none', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 58) })).toBe('none') // 2 min
  })
  test('idle (not active) -> none', () => {
    expect(evaluateReminder({ ...base, userActive: false, activeUnpunchedSince: at(9, 50) })).toBe('none')
  })
  test('before the work window -> none', () => {
    expect(evaluateReminder({ ...base, now: at(8), activeUnpunchedSince: at(7, 50) })).toBe('none')
  })
  test('weekend day not in config.days -> none', () => {
    const sun = new Date(2026, 6, 26, 10, 0, 0).getTime() // Sunday
    expect(evaluateReminder({ ...base, now: sun, activeUnpunchedSince: sun - 20 * 60000 })).toBe('none')
  })
  test('snoozed -> none until snooze passes', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 50), snoozedUntil: at(10, 5) })).toBe('none')
  })
  test('within repeat interval of last reminder -> none', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 50), lastRemindedAt: at(9, 58) })).toBe('none')
  })
  test('repeat interval elapsed -> punch-in again', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 50), lastRemindedAt: at(9, 54) })).toBe('punch-in')
  })
  test('enabled=false -> none', () => {
    expect(evaluateReminder({ ...base, activeUnpunchedSince: at(9, 50), config: { ...cfg, enabled: false } })).toBe('none')
  })
})

describe('evaluateReminder - punch-out', () => {
  const inbase: ReminderInput = { now: at(19), userActive: false, punchedIn: true, config: cfg }
  test('past window end while still punched in -> punch-out', () => {
    expect(evaluateReminder({ ...inbase, now: at(18, 30), userActive: true })).toBe('punch-out')
  })
  test('idle >= punchOutIdle while punched in (even off-window) -> punch-out', () => {
    expect(evaluateReminder({ ...inbase, now: at(21), idleSince: at(20, 40) })).toBe('punch-out') // 20 min idle
  })
  test('idle shorter than threshold, inside window -> none', () => {
    expect(evaluateReminder({ ...inbase, now: at(14), idleSince: at(13, 55) })).toBe('none') // 5 min
  })
  test('active, punched in, inside window -> none', () => {
    expect(evaluateReminder({ ...inbase, now: at(14), userActive: true })).toBe('none')
  })
})
