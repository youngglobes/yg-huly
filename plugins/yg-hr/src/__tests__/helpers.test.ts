import { formatEmployeeId } from '..'

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
