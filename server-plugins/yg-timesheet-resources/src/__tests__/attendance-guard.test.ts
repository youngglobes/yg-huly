import { hasOtherOpenSession, originalPunchOut } from '../attendance-guard'

describe('originalPunchOut', () => {
  const cur = 'tx-current'

  it('is undefined when no earlier tx closed the session (a legit first punch-out)', () => {
    const txes = [
      { _id: 'tx-geo', modifiedOn: 100, operations: { ip: '1.2.3.4' } },
      { _id: cur, modifiedOn: 200, operations: { punchOut: 200 } }
    ]
    expect(originalPunchOut(txes, cur)).toBeUndefined()
  })

  it('returns the first earlier punch-out when the session is being re-closed by a stale tab', () => {
    // The 2026-09-19 prod shape: mobile closed at 09:45, phone tab re-closed it at 11:16.
    const txes = [
      { _id: 'tx-first-out', modifiedOn: 945, operations: { punchOut: 945 } },
      { _id: cur, modifiedOn: 1116, operations: { punchOut: 1116 } }
    ]
    expect(originalPunchOut(txes, cur)).toBe(945)
  })

  it('keeps the earliest close when several stale re-closes have already been recorded', () => {
    const txes = [
      { _id: cur, modifiedOn: 1200, operations: { punchOut: 1200 } },
      { _id: 'tx-stale-1', modifiedOn: 1116, operations: { punchOut: 1116 } },
      { _id: 'tx-first-out', modifiedOn: 945, operations: { punchOut: 945 } }
    ]
    expect(originalPunchOut(txes, cur)).toBe(945)
  })

  it('ignores updates that do not touch punchOut (ip/geo patches, notes)', () => {
    const txes = [
      { _id: 'tx-geo', modifiedOn: 100, operations: { ip: '1.2.3.4', city: 'Chennai' } },
      { _id: 'tx-note', modifiedOn: 150, operations: { punchOutNote: 'x' } },
      { _id: cur, modifiedOn: 200, operations: { punchOut: 200 } }
    ]
    expect(originalPunchOut(txes, cur)).toBeUndefined()
  })
})

describe('hasOtherOpenSession', () => {
  it('is false when the only open session is the one just created', () => {
    const sessions = [
      { _id: 'a', punchOut: 100 },
      { _id: 'new' }
    ]
    expect(hasOtherOpenSession(sessions, 'new')).toBe(false)
  })

  it('is true when another session is still open (duplicate punch-in from a stale tab)', () => {
    const sessions = [
      { _id: 'a' },
      { _id: 'new' }
    ]
    expect(hasOtherOpenSession(sessions, 'new')).toBe(true)
  })

  it('is false when every other session is closed', () => {
    const sessions = [
      { _id: 'a', punchOut: 100 },
      { _id: 'b', punchOut: 200 },
      { _id: 'new' }
    ]
    expect(hasOtherOpenSession(sessions, 'new')).toBe(false)
  })
})
