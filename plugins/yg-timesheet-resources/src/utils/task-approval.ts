//
// Per-task approval logic. Pure — no platform deps → unit-testable.
//
// Replaces the day-level model, which had a single status and a single approver list built from
// the UNION of every project in the day. That let the lead of one project approve another lead's
// hours (and whoever clicked first locked the other out).
//
// REVISION 2 (2026-07-23): authorization is now a ROLE check. Any PM/TL on ANY project may
// approve ANY task — covering for an absent lead is the motivating case. Each task still carries
// only its own project's approvers for NOTIFICATION routing; that field is no longer authorization.
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
 * the PM + Team Lead of ITS OWN project only — for NOTIFICATION routing only, not authorization.
 * An empty approver list means the project has no PM/TL configured — surfaced to the user, never
 * silently rerouted.
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

/**
 * May this actor approve/reject this task?
 *
 * REVISION 2 (2026-07-23): authorization is a ROLE check, not a per-project one. Any employee
 * assigned as PM or Team Lead on ANY project may approve ANY task — when a project's own lead is
 * away, another lead who knows the work must be able to sign it off. What the business needs is
 * ATTRIBUTION (who approved), not prevention.
 *
 * Deliberately does NOT consult the task's stored `approvers` list: that field is client-writable
 * and is only notification routing. Authorization must never depend on data an attacker can write.
 *
 * `isApproverRole` is derived server-side from the ProjectApprovers assignments; the caller must
 * not compute it from anything the acting user controls.
 */
export function canApproveTask (
  isApproverRole: boolean, employee: string, actor: string, isAdmin: boolean
): boolean {
  if (actor === employee) return false // no self-approve, ever — not even admins
  return isAdmin || isApproverRole
}

/**
 * Hours logged against this task since it was submitted, as a signed delta. Rounded to 2dp so float
 * noise never shows as spurious drift. NOTE: drift is now enforced server-side by
 * reopenDriftedApprovedTask (auto-reopen for re-approval); this pure helper is retained for tests.
 */
export function taskDrift (submittedHours: number, liveHours: number): number {
  return Math.round((liveHours - submittedHours) * 100) / 100
}

/**
 * May the current user SEE the Approvals/Reports surfaces? Admin (Maintainer+) OR assigned as PM or
 * Team Lead on ANY project. `approverPairs` are the ProjectApprovers mixins across all projects;
 * `me` is the current employee. Pure — the caller supplies isAdmin and the pairs.
 */
export function canApproveView (
  isAdmin: boolean,
  approverPairs: Array<{ pm?: string, teamLead?: string }>,
  me: string
): boolean {
  if (isAdmin) return true
  return approverPairs.some((a) => a.pm === me || a.teamLead === me)
}
