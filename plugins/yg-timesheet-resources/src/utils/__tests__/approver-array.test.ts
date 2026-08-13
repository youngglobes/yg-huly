import { asRefArray } from '../workflow'

describe('asRefArray', () => {
  it('empties -> []', () => {
    expect(asRefArray(undefined)).toEqual([])
    expect(asRefArray(null)).toEqual([])
    expect(asRefArray('')).toEqual([])
    expect(asRefArray([])).toEqual([])
  })
  it('single legacy scalar -> one-element array', () => {
    expect(asRefArray('emp-1')).toEqual(['emp-1'])
  })
  it('array passes through, dropping empties', () => {
    expect(asRefArray(['a', 'b'])).toEqual(['a', 'b'])
    expect(asRefArray(['a', '', 'b'])).toEqual(['a', 'b'])
  })
})
