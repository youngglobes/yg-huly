import { istDayStart, istMinutesOfDay } from '@hcengineering/yg-timesheet'

describe('IST helpers (fixed UTC+5:30, no DST)', () => {
  // 2026-08-28 10:07 IST == 2026-08-28 04:37 UTC
  const punch = Date.UTC(2026, 7, 28, 4, 37)

  it('istMinutesOfDay: minutes since IST midnight', () => {
    expect(istMinutesOfDay(punch)).toBe(10 * 60 + 7) // 607
  })

  it('istDayStart: UTC-ms of IST 00:00 that day', () => {
    // IST midnight 2026-08-28 == 2026-08-27 18:30 UTC
    expect(istDayStart(punch)).toBe(Date.UTC(2026, 7, 27, 18, 30))
  })

  it('a punch just after IST midnight lands on that IST day, not the previous UTC day', () => {
    // 2026-08-28 00:30 IST == 2026-08-27 19:00 UTC (a different UTC calendar day)
    const early = Date.UTC(2026, 7, 27, 19, 0)
    expect(istMinutesOfDay(early)).toBe(30)
    expect(istDayStart(early)).toBe(Date.UTC(2026, 7, 27, 18, 30))
  })

  it('istDayStart is stable across a whole IST day', () => {
    const morning = Date.UTC(2026, 7, 27, 18, 30) // IST 00:00
    const evening = Date.UTC(2026, 7, 28, 18, 29) // IST 23:59
    expect(istDayStart(morning)).toBe(istDayStart(evening))
  })
})
