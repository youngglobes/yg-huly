import { isStalled, StallMonitor, STALL_MS, type StallState } from '../stall'

const PING = 'ping'
const req = (method: string, startTime: number): { method: string, startTime: number } => ({ method, startTime })

describe('isStalled', () => {
  const now = 100_000
  it('is false with nothing pending', () => {
    expect(isStalled([], 0, now, PING)).toBe(false)
  })
  it('ignores pings', () => {
    expect(isStalled([req(PING, 0)], 0, now, PING)).toBe(false)
  })
  it('is false for one slow request while others are still answered', () => {
    expect(isStalled([req('findAll', 0)], now - 5_000, now, PING)).toBe(false)
  })
  it('is true when a request waited too long and nothing was answered', () => {
    expect(isStalled([req('tx', now - STALL_MS - 1)], now - STALL_MS - 1, now, PING)).toBe(true)
  })
  it('is false exactly at the limit', () => {
    expect(isStalled([req('tx', now - STALL_MS)], now - STALL_MS, now, PING)).toBe(false)
  })
})

describe('StallMonitor', () => {
  it('emits once on stall and once on recovery', () => {
    const events: StallState[] = []
    const m = new StallMonitor(PING, (s) => events.push(s), 0)
    const pending = [req('loadModel', 0)]
    m.check(pending, STALL_MS + 1)
    m.check(pending, STALL_MS + 5_000)
    expect(events).toEqual([{ stalled: true, sinceMs: STALL_MS + 1 }])
    m.answered('loadModel', STALL_MS + 6_000)
    m.check([], STALL_MS + 7_000)
    expect(events).toEqual([{ stalled: true, sinceMs: STALL_MS + 1 }, { stalled: false, sinceMs: 0 }])
  })

  it('does not count ping answers as recovery', () => {
    const events: StallState[] = []
    const m = new StallMonitor(PING, (s) => events.push(s), 0)
    const pending = [req('tx', 0)]
    m.check(pending, STALL_MS + 1)
    m.answered(PING, STALL_MS + 2)
    m.check(pending, STALL_MS + 3)
    expect(events).toHaveLength(1)
  })

  it('stop() clears a showing banner, and is quiet otherwise', () => {
    const events: StallState[] = []
    const m = new StallMonitor(PING, (s) => events.push(s), 0)
    m.stop()
    expect(events).toHaveLength(0)
    m.check([req('tx', 0)], STALL_MS + 1)
    m.stop()
    expect(events.map((e) => e.stalled)).toEqual([true, false])
  })
})
