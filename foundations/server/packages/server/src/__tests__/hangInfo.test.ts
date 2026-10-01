import { describeHang, setStage } from '../hangInfo'
import type { SessionRequest } from '@hcengineering/server-core'

const req = (): SessionRequest => ({ id: '1', params: {}, start: 0 })

describe('hang description', () => {
  it('reports the stage and how long it has been in it', () => {
    const r = req()
    setStage(r, 'workspace', 1000)
    expect(describeHang(r, 31000)).toEqual({ stage: 'workspace', stageSec: 30 })
  })

  it('lists the deepest 8 open spans with their ages', () => {
    const r = req()
    r.openSpans = Array.from({ length: 10 }, (_, i) => ({ name: `s${i}`, start: 0 }))
    expect(describeHang(r, 5000).openSpans).toEqual(['s2@5', 's3@5', 's4@5', 's5@5', 's6@5', 's7@5', 's8@5', 's9@5'])
  })

  it('adds nothing for a request without diagnostics', () => {
    expect(describeHang(req(), 1)).toEqual({})
  })

  it('ignores an empty span list', () => {
    const r = req()
    r.openSpans = []
    expect(describeHang(r, 1)).toEqual({})
  })

  it('setStage tolerates a request that is already gone', () => {
    expect(() => { setStage(undefined, 'pipeline') }).not.toThrow()
  })
})
