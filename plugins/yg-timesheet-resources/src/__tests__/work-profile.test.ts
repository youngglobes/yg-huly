import { CATEGORY_ORDER, isTracked, minutesToHHMM, hhmmToMinutes } from '../utils/work-profile'
describe('isTracked', () => {
  it('only dev + senior-dev are tracked for the performance report', () => {
    expect(isTracked('junior-dev')).toBe(true)
    expect(isTracked('senior-dev')).toBe(true)
    expect(isTracked('sales')).toBe(false)
    expect(isTracked('salesforce')).toBe(false)
    expect(isTracked('other')).toBe(false)
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
