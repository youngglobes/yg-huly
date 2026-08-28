import { DESIGNATIONS, TRACKED_DESIGNATIONS, isTracked, minutesToHHMM, hhmmToMinutes } from '../utils/work-profile'

describe('work-profile designations', () => {
  it('lists all 24 designations', () => {
    expect(DESIGNATIONS).toHaveLength(24)
    expect(new Set(DESIGNATIONS).size).toBe(24) // no duplicates
  })

  it('tracks 11 dev/tester titles', () => {
    expect(TRACKED_DESIGNATIONS.size).toBe(11)
    expect(isTracked('Senior Software Engineer')).toBe(true)
    expect(isTracked('Software Test Engineer')).toBe(true)
    expect(isTracked('Team Leader')).toBe(true)
  })

  it('does not track SEO/BD/exec titles or undefined', () => {
    expect(isTracked('SEO Analyst')).toBe(false)
    expect(isTracked('Business Development Executive')).toBe(false)
    expect(isTracked('CEO')).toBe(false)
    expect(isTracked(undefined)).toBe(false)
  })

  it('every tracked title is a known designation', () => {
    for (const d of TRACKED_DESIGNATIONS) expect(DESIGNATIONS).toContain(d)
  })
})

describe('shift-time conversion', () => {
  it('minutesToHHMM zero-pads', () => {
    expect(minutesToHHMM(540)).toBe('09:00')
    expect(minutesToHHMM(0)).toBe('00:00')
    expect(minutesToHHMM(23 * 60 + 5)).toBe('23:05')
  })
  it('hhmmToMinutes parses valid, rejects junk', () => {
    expect(hhmmToMinutes('09:00')).toBe(540)
    expect(hhmmToMinutes('23:05')).toBe(23 * 60 + 5)
    expect(hhmmToMinutes('')).toBeUndefined()
    expect(hhmmToMinutes('9')).toBeUndefined()
    expect(hhmmToMinutes('99:99')).toBeUndefined()
  })
})
