//
// YoungGlobes: pure logic for the reject/resubmit history (backlog items 2-4).
//
// Cycles are keyed by employee + issue + date, NOT by task ref, because submitDay deletes and
// recreates task rows on every resubmit. Everything here is pure and structurally typed so the
// real TimesheetRejectCycle docs (whose Refs are branded strings) pass straight in.
//

/** Structural shape of a cycle. Ref<T> is a branded string, so real docs satisfy this. */
export interface RejectCycleLike {
  employee: string
  issue: string
  date: number
  rejectReason: string
  rejectedBy?: string
  rejectedOn: number
  resubmitNote?: string
  resubmittedOn?: number
}

/** Stable grouping key for one unit of work. */
export function cycleKey (employee: string, issue: string, date: number): string {
  return `${employee}|${issue}|${date}`
}

/**
 * Bucket cycles by their triple, each bucket sorted oldest-first so the array index IS the round
 * number. Round is derived here rather than stored: a stored counter would drift if a create ever
 * failed, and the only read is "how many rounds" plus their order.
 */
export function groupCycles<T extends RejectCycleLike> (cycles: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const c of cycles) {
    const key = cycleKey(c.employee, c.issue, c.date)
    const list = out.get(key)
    if (list === undefined) out.set(key, [c])
    else list.push(c)
  }
  for (const list of out.values()) list.sort((a, b) => a.rejectedOn - b.rejectedOn)
  return out
}

/** Open = rejected, not yet resubmitted. */
export function isOpen (c: RejectCycleLike): boolean {
  return c.resubmittedOn == null
}

/**
 * The single open round, if any. Normally there is at most one; if a partial write ever left two,
 * prefer the newest so the employee is shown the reason that actually applies now.
 */
export function openCycle<T extends RejectCycleLike> (list: T[]): T | undefined {
  let best: T | undefined
  for (const c of list) {
    if (!isOpen(c)) continue
    if (best === undefined || c.rejectedOn > best.rejectedOn) best = c
  }
  return best
}

/** Completed rounds (rejected then resubmitted), oldest first. */
export function closedCycles<T extends RejectCycleLike> (list: T[]): T[] {
  return list.filter((c) => !isOpen(c)).sort((a, b) => a.rejectedOn - b.rejectedOn)
}

/**
 * Which open cycles a resubmit should close: those whose issue is actually in the day being
 * submitted. An issue the employee dropped from the day is NOT closed - nothing was resubmitted
 * for it, so its cycle stays open on purpose.
 */
export function cyclesToClose<T extends RejectCycleLike> (cycles: T[], issues: Set<string>): T[] {
  return cycles.filter((c) => isOpen(c) && issues.has(c.issue))
}
