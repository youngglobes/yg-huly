import { isLate, minutesLateOf, dayLateStatus, countUnexcusedLate, localTimeOfDayMin } from '../utils/late'

// 2026-08-11 09:30 local == 570 minutes of day. Build via Date so the test is tz-agnostic.
const at = (h: number, m: number): number => new Date(2026, 7, 11, h, m, 0, 0).getTime()

describe('localTimeOfDayMin', () => {
  it('returns minutes since local midnight', () => {
    expect(localTimeOfDayMin(at(9, 0))).toBe(540)
    expect(localTimeOfDayMin(at(9, 30))).toBe(570)
    expect(localTimeOfDayMin(at(0, 0))).toBe(0)
  })
})

describe('isLate', () => {
  it('is late strictly after shiftStart, not at or before', () => {
    expect(isLate(at(9, 1), 540)).toBe(true)
    expect(isLate(at(9, 0), 540)).toBe(false) // exactly on time is not late
    expect(isLate(at(8, 59), 540)).toBe(false)
  })
})

describe('minutesLateOf', () => {
  it('is the positive delta, 0 when on time or early', () => {
    expect(minutesLateOf(at(9, 45), 540)).toBe(45)
    expect(minutesLateOf(at(9, 0), 540)).toBe(0)
    expect(minutesLateOf(at(8, 30), 540)).toBe(0)
  })
})

describe('dayLateStatus', () => {
  it('maps permission status to a per-day label', () => {
    expect(dayLateStatus(undefined)).toBe('none')
    expect(dayLateStatus('Pending')).toBe('pending')
    expect(dayLateStatus('Rejected')).toBe('late')
    expect(dayLateStatus('Approved')).toBe('excused')
  })
})

describe('countUnexcusedLate', () => {
  it('counts Pending and Rejected, excludes Approved', () => {
    expect(countUnexcusedLate(['Pending', 'Approved', 'Rejected', 'Approved'])).toBe(2)
    expect(countUnexcusedLate([])).toBe(0)
    expect(countUnexcusedLate(['Approved'])).toBe(0)
  })
})
