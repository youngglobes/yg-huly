//
// Per-task approval logic. Pure — no platform deps → unit-testable.
//
// Replaces the day-level model, which had a single status and a single approver list built from
// the UNION of every project in the day. That let the lead of one project approve another lead's
// hours (and whoever clicked first locked the other out). Here each task carries only its own
// project's approvers, so that is structurally impossible.
//
import type { DayReportLike, ProjectApproverLike } from './workflow'
// Single source of truth for the per-task status values — declared in the plugin package
// (plugins/yg-timesheet/src/index.ts) and re-exported here so the model and this lib cannot drift.
import type { TaskStatus } from '@hcengineering/yg-timesheet'

export type { TaskStatus }

/** Day status is DERIVED from its tasks — for display only. Never stored, never queried. */
export type DerivedDayStatus = 'Draft' | 'Submitted' | 'PartiallyApproved' | 'Approved' | 'Rejected'

export interface TaskUnit {
  issue: string
  identifier: string
  title: string
  project: string
  submittedHours: number
  approvers: string[]
}

/**
 * Collapse a day's time entries into one unit per ISSUE, summing hours, and stamp each unit with
 * the PM + Team Lead of ITS OWN project only. An empty approver list means the project has no
 * PM/TL configured — surfaced to the user, never silently rerouted.
 */
export function buildTaskUnits (
  reports: DayReportLike[],
  byProject: Map<string, ProjectApproverLike>,
  employee: string
): TaskUnit[] {
  const byIssue = new Map<string, TaskUnit>()
  for (const r of reports) {
    let unit = byIssue.get(r.issue)
    if (unit === undefined) {
      const pa = byProject.get(r.project)
      const set = new Set<string>()
      if (pa?.pm != null && pa.pm !== '') set.add(pa.pm)
      if (pa?.teamLead != null && pa.teamLead !== '') set.add(pa.teamLead)
      set.delete(employee) // no self-approve
      unit = {
        issue: r.issue,
        identifier: r.identifier,
        title: r.title,
        project: r.project,
        submittedHours: 0,
        approvers: [...set]
      }
      byIssue.set(r.issue, unit)
    }
    unit.submittedHours += r.value
  }
  return [...byIssue.values()].sort((a, b) =>
    a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
  )
}

export function deriveDayStatus (statuses: TaskStatus[]): DerivedDayStatus {
  if (statuses.length === 0) return 'Draft'
  if (statuses.includes('Rejected')) return 'Rejected'
  const approved = statuses.filter((s) => s === 'Approved').length
  if (approved === statuses.length) return 'Approved'
  if (approved > 0) return 'PartiallyApproved'
  if (statuses.includes('Submitted')) return 'Submitted'
  return 'Draft'
}

export function canApproveTask (
  taskApprovers: string[], employee: string, actor: string, isAdmin: boolean
): boolean {
  if (actor === employee) return false // no self-approve, even admin
  return isAdmin || taskApprovers.includes(actor)
}

/**
 * Hours logged against this task since it was submitted, as a signed delta. FLAG ONLY — editing
 * time after approval is never blocked (the day-level `driftHours()` precedent, carried forward
 * per task). Rounded to 2dp so float noise never shows as spurious drift.
 */
export function taskDrift (submittedHours: number, liveHours: number): number {
  return Math.round((liveHours - submittedHours) * 100) / 100
}
