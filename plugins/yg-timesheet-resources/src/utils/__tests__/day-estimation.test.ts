import { issuesMissingEstimation } from '../day'

describe('issuesMissingEstimation', () => {
  test('returns identifiers of issues with no estimation, de-duped, first-seen order', () => {
    const reports = [
      { issue: 'i1', identifier: 'TSK-1' },
      { issue: 'i2', identifier: 'TSK-2' },
      { issue: 'i1', identifier: 'TSK-1' }, // duplicate issue - counted once
      { issue: 'i3', identifier: 'TSK-3' }
    ]
    const est = new Map<string, number>([['i1', 4], ['i2', 0]]) // i3 absent from the map
    expect(issuesMissingEstimation(reports, est)).toEqual(['TSK-2', 'TSK-3'])
  })

  test('every issue estimated -> empty', () => {
    const reports = [{ issue: 'i1', identifier: 'A' }, { issue: 'i2', identifier: 'B' }]
    const est = new Map<string, number>([['i1', 2], ['i2', 8]])
    expect(issuesMissingEstimation(reports, est)).toEqual([])
  })

  test('an issue missing from the estimation map counts as no estimation', () => {
    expect(issuesMissingEstimation([{ issue: 'x', identifier: 'X' }], new Map())).toEqual(['X'])
  })

  test('no reports -> empty', () => {
    expect(issuesMissingEstimation([], new Map())).toEqual([])
  })
})
