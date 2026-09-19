//
// YoungGlobes: pure decision helpers for the server-side attendance session guard (OnAttendancePunch).
//
// Why the server must own this: a browser tab that was frozen (a phone tab left open since the
// morning punch-in, a desktop that slept) still shows the session it last saw as "open". On wake
// it reconnects and, if the user taps within the refresh window, sends a punch-out for a session
// that was closed long ago, or a punch-in while another session is open. The client-side
// findAll guard cannot help: LiveQuery.findAll answers repeated queries from its in-memory cache,
// which is exactly as stale as the tab. Seen live 2026-09-03 and 2026-09-19 (prod tx log): a mobile
// session closed at 09:45 was re-closed from the phone at 11:16, overwriting punchOut and
// overlapping the desktop session that had legitimately started at 10:02.
//
import { type Timestamp } from '@hcengineering/core'

/** The subset of a TxUpdateDoc<AttendanceSession> the guard reads. */
export interface PunchTxLike {
  _id: string
  modifiedOn: Timestamp
  operations: { punchOut?: Timestamp }
}

/**
 * The punchOut a session ALREADY had before `currentTxId` tried to close it again, or undefined
 * when this is the first punch-out (the legit case). Among earlier closes the earliest wins: with
 * this guard in place every stale re-close is reverted, so any later close recorded in the tx log
 * is itself a stale attempt, and the first one is the real punch-out.
 */
export function originalPunchOut (txes: PunchTxLike[], currentTxId: string): Timestamp | undefined {
  const prior = txes
    .filter((t) => t._id !== currentTxId && t.operations.punchOut !== undefined)
    .sort((a, b) => a.modifiedOn - b.modifiedOn)
  return prior[0]?.operations.punchOut
}

/** True when a session other than `selfId` is still open: the punch-in that created `selfId` is a duplicate. */
export function hasOtherOpenSession (sessions: Array<{ _id: string, punchOut?: Timestamp }>, selfId: string): boolean {
  return sessions.some((s) => s._id !== selfId && s.punchOut === undefined)
}
