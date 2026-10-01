//
// "Server not responding" detection for the YG Portal banner (2026-09-30 wedge follow-up).
// Pings are answered even while the transactor is wedged, so they never count; one slow request
// while others are answered is not a stall either.
//

export const STALL_MS = 30 * 1000
export const STALL_EVENT = 'yg:server-stall'

export interface StallState {
  stalled: boolean
  sinceMs: number
}

interface PendingRequest {
  method: string
  startTime: number
}

export function isStalled (
  pending: Iterable<PendingRequest>,
  lastAnswer: number,
  now: number,
  pingMethod: string,
  limitMs: number = STALL_MS
): boolean {
  if (now - lastAnswer <= limitMs) return false
  for (const p of pending) {
    if (p.method !== pingMethod && now - p.startTime > limitMs) return true
  }
  return false
}

export function dispatchStall (s: StallState): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent<StallState>(STALL_EVENT, { detail: s }))
}

export class StallMonitor {
  private lastAnswer: number
  private stalled = false

  constructor (
    private readonly pingMethod: string,
    private readonly emit: (s: StallState) => void = dispatchStall,
    now: number = Date.now()
  ) {
    this.lastAnswer = now
  }

  answered (method: string, now: number = Date.now()): void {
    if (method !== this.pingMethod) this.lastAnswer = now
  }

  check (pending: Iterable<PendingRequest>, now: number = Date.now()): void {
    const stalled = isStalled(pending, this.lastAnswer, now, this.pingMethod)
    if (stalled === this.stalled) return
    this.stalled = stalled
    this.emit(stalled ? { stalled: true, sinceMs: now - this.lastAnswer } : { stalled: false, sinceMs: 0 })
  }

  stop (): void {
    if (!this.stalled) return
    this.stalled = false
    this.emit({ stalled: false, sinceMs: 0 })
  }
}
