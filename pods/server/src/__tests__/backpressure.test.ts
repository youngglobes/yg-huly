import { waitForDrain, type DrainSocket } from '../backpressure'

function fakeSocket (bufferedAmount: number): DrainSocket {
  return { bufferedAmount, readyState: 1, OPEN: 1 }
}

describe('waitForDrain', () => {
  it('returns once the buffer drains below the limit', async () => {
    const ws = fakeSocket(500)
    setTimeout(() => { ws.bufferedAmount = 10 }, 30)
    await waitForDrain(ws, 100, () => false, 5)
    expect(ws.bufferedAmount).toBe(10)
  })

  it('stops waiting when the socket closes with data still buffered', async () => {
    const ws = fakeSocket(500)
    setTimeout(() => { ws.readyState = 3 }, 30)
    await waitForDrain(ws, 100, () => false, 5)
    expect(ws.bufferedAmount).toBe(500)
  })

  it('stops waiting when the connection is marked closed', async () => {
    const ws = fakeSocket(500)
    let closed = false
    setTimeout(() => { closed = true }, 30)
    await waitForDrain(ws, 100, () => closed, 5)
    expect(closed).toBe(true)
  })

  it('sleeps between checks instead of spinning (2026-11-03 freeze)', async () => {
    const ws = fakeSocket(500)
    let checks = 0
    const closed = (): boolean => { checks++; return false }
    setTimeout(() => { ws.bufferedAmount = 0 }, 100)
    await waitForDrain(ws, 100, closed, 10)
    // ~10 checks in 100ms; the old setImmediate loop made tens of thousands
    expect(checks).toBeLessThan(30)
  })
})
