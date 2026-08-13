export type DayStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected'

const LEGAL: Record<DayStatus, DayStatus[]> = {
  Draft: ['Submitted'],
  Submitted: ['Approved', 'Rejected', 'Draft'], // Draft = recall
  Approved: ['Draft'],                           // reopen (approver only — enforced in trigger)
  Rejected: ['Draft', 'Submitted']               // edit / re-submit
}

export function legalTransition (from: DayStatus, to: DayStatus): boolean {
  return LEGAL[from]?.includes(to) ?? false
}

// Normalize a possibly-scalar (legacy single value), possibly-null approver field to a clean
// array with empties removed. Generic so the string-typed pure helpers and the Ref<Employee>-typed
// Svelte reads share one implementation. Belt-and-suspenders with the scalar->array migration:
// any doc that slips through un-migrated still reads correctly.
export function asRefArray<T> (v: T | T[] | null | undefined): T[] {
  if (v == null) return []
  const arr = Array.isArray(v) ? v : [v]
  return arr.filter((x): x is T => x != null && (x as unknown) !== '')
}

export interface DayReportLike {
  project: string
  employee: string | null
  issue: string
  identifier: string
  title: string
  value: number
  note: string
}

export interface ProjectApproverLike { pm?: string | null, teamLead?: string | null }

export function resolveApprovers (
  reports: DayReportLike[], byProject: Map<string, ProjectApproverLike>, employee: string
): string[] {
  const set = new Set<string>()
  for (const r of reports) {
    const pa = byProject.get(r.project)
    if (pa?.pm != null && pa.pm !== '') set.add(pa.pm)
    if (pa?.teamLead != null && pa.teamLead !== '') set.add(pa.teamLead)
  }
  set.delete(employee) // no self-approve
  return [...set]
}

export interface SnapshotLine {
  issue: string, identifier: string, title: string, project: string, hours: number, note: string
}

export function buildSnapshot (reports: DayReportLike[]): { lines: SnapshotLine[], totalHours: number } {
  const byIssue = new Map<string, SnapshotLine>()
  let totalHours = 0
  for (const r of reports) {
    let line = byIssue.get(r.issue)
    if (line === undefined) {
      line = { issue: r.issue, identifier: r.identifier, title: r.title, project: r.project, hours: 0, note: r.note }
      byIssue.set(r.issue, line)
    }
    line.hours += r.value
    totalHours += r.value
  }
  const lines = [...byIssue.values()].sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }))
  return { lines, totalHours }
}

export function canApprove (approvers: string[], employee: string, actor: string, isAdmin: boolean): boolean {
  if (actor === employee) return false // no self-approve, even admin
  return isAdmin || approvers.includes(actor)
}

export function canEditApproved (approvedBy: string | undefined, actor: string, isAdmin: boolean): boolean {
  return isAdmin || (approvedBy !== undefined && actor === approvedBy)
}
