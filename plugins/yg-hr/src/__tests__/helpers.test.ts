import { formatEmployeeId, isHrDesignationByFlag } from '..'

describe('formatEmployeeId', () => {
  it('pads to width 4 with the YGS prefix by default', () => {
    expect(formatEmployeeId(25)).toBe('YGS0025')
    expect(formatEmployeeId(1)).toBe('YGS0001')
  })
  it('does not truncate numbers wider than the pad width', () => {
    expect(formatEmployeeId(12345)).toBe('YGS12345')
  })
  it('honours a custom prefix and width', () => {
    expect(formatEmployeeId(7, 'EMP', 3)).toBe('EMP007')
  })
})

describe('isHrDesignationByFlag', () => {
  it('is true when the designation carries the isHr flag', () => {
    expect(isHrDesignationByFlag({ isHr: true, name: 'Whatever' })).toBe(true)
  })
  it('is true for the legacy "HR Executive" name even without the flag', () => {
    expect(isHrDesignationByFlag({ name: 'HR Executive' })).toBe(true)
  })
  it('is false for any other unflagged designation', () => {
    expect(isHrDesignationByFlag({ name: 'Senior Software Engineer' })).toBe(false)
    expect(isHrDesignationByFlag({ isHr: false, name: 'HR Coordinator' })).toBe(false)
  })
  it('is false when no designation is given', () => {
    expect(isHrDesignationByFlag(undefined)).toBe(false)
  })
})
