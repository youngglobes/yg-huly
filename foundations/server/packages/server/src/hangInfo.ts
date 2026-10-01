//
// Hang diagnostics for the transactor: where a stuck request is. Added after the 2026-09-30 wedge,
// where the warning said a request was stuck but never where.
//
import type { SessionRequest } from '@hcengineering/server-core'

export type RequestStage = 'queued' | 'backpressure' | 'workspace' | 'pipeline'

export interface HangInfo {
  stage?: string
  stageSec?: number
  openSpans?: string[]
}

const SHOWN_SPANS = 8

export function setStage (r: SessionRequest | undefined, stage: RequestStage, now: number = Date.now()): void {
  if (r === undefined) return
  r.stage = stage
  r.stageAt = now
}

export function describeHang (r: SessionRequest, now: number): HangInfo {
  const info: HangInfo = {}
  if (r.stage !== undefined) {
    info.stage = r.stage
    info.stageSec = Math.round((now - (r.stageAt ?? r.start)) / 1000)
  }
  if (r.openSpans !== undefined && r.openSpans.length > 0) {
    info.openSpans = r.openSpans
      .slice(-SHOWN_SPANS)
      .map((s) => `${s.name}@${Math.round((now - s.start) / 1000)}`)
  }
  return info
}
