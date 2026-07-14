//
// YoungGlobes: client-side timesheet workflow helpers.
//
// Lazy create-or-find of the persisted Timesheet / TimesheetDay docs (in the shared
// Timesheets space) and the status transitions the UI drives. The pure decision logic
// (resolveApprovers / buildSnapshot / driftHours) lives in ./workflow (Task 2) and is
// re-exported for callers that only need one import site.
//
// Division of labour with the server trigger (server-yg-timesheet-resources): the CLIENT
// sends the status change (+ approvers on submit, + snapshot/totalHours on approve). It does
// NOT stamp approvedBy — the trigger authorizes the transition and stamps that authoritatively.
//
import core, { type Ref, type TxOperations } from '@hcengineering/core'
import { type Employee } from '@hcengineering/contact'
import tracker from '@hcengineering/tracker'
import ygTimesheet, { type Timesheet, type TimesheetDay, type TimesheetLine } from '@hcengineering/yg-timesheet'
import { weekRange } from './week'
import { buildSnapshot, driftHours, resolveApprovers, type DayReportLike, type ProjectApproverLike } from './workflow'

export { buildSnapshot, driftHours, resolveApprovers }
export type { DayReportLike, ProjectApproverLike }

/** Sentinel returned by submitDay when no approver resolves for the day's projects. */
export const NO_APPROVER = 'no-approver' as const

/** Monday-00:00 (local) week start for a given instant — the Timesheet.weekStart key. */
export function weekStartOf (dateMs: number): number {
  return weekRange(dateMs).start
}

/** Find the employee's Timesheet for a week, creating it (days: 0) if absent. */
export async function ensureTimesheet (
  client: TxOperations,
  employee: Ref<Employee>,
  weekStart: number
): Promise<Ref<Timesheet>> {
  const existing = await client.findOne(ygTimesheet.class.Timesheet, {
    space: core.space.Workspace,
    employee,
    weekStart
  })
  if (existing !== undefined) return existing._id
  return await client.createDoc(ygTimesheet.class.Timesheet, core.space.Workspace, {
    employee,
    weekStart,
    days: 0
  })
}

/** Find the TimesheetDay for a date under a Timesheet, creating a Draft if absent. */
export async function ensureDay (
  client: TxOperations,
  tsId: Ref<Timesheet>,
  date: number
): Promise<Ref<TimesheetDay>> {
  const existing = await client.findOne(ygTimesheet.class.TimesheetDay, { attachedTo: tsId, date })
  if (existing !== undefined) return existing._id
  return await client.addCollection(
    ygTimesheet.class.TimesheetDay,
    core.space.Workspace,
    tsId,
    ygTimesheet.class.Timesheet,
    'days',
    { date, status: 'Draft', approvers: [], totalHours: 0 }
  )
}

export interface SubmitArgs {
  employee: Ref<Employee>
  date: number
  reports: DayReportLike[]
  approversByProject: Map<string, ProjectApproverLike>
}

/**
 * Submit a day: resolve approvers from the day's reports; if none resolve, return the
 * NO_APPROVER sentinel WITHOUT writing so the UI can surface ygTimesheet.string.NoApprover.
 * Otherwise lazily materialise Timesheet + TimesheetDay and move it to Submitted.
 */
export async function submitDay (
  client: TxOperations,
  { employee, date, reports, approversByProject }: SubmitArgs
): Promise<Ref<TimesheetDay> | typeof NO_APPROVER> {
  const approvers = resolveApprovers(reports, approversByProject, employee) as Ref<Employee>[]
  if (approvers.length === 0) return NO_APPROVER

  const totalHours = reports.reduce((sum, r) => sum + r.value, 0)
  const tsId = await ensureTimesheet(client, employee, weekStartOf(date))
  const dayId = await ensureDay(client, tsId, date)
  await client.updateDoc(ygTimesheet.class.TimesheetDay, core.space.Workspace, dayId, {
    status: 'Submitted',
    approvers,
    submittedOn: Date.now(),
    totalHours
  })
  return dayId
}

/** Recall a submitted day back to Draft (clears approvers + submittedOn). */
export async function recallDay (client: TxOperations, dayId: Ref<TimesheetDay>): Promise<void> {
  await client.updateDoc(ygTimesheet.class.TimesheetDay, core.space.Workspace, dayId, {
    status: 'Draft',
    approvers: [],
    $unset: { submittedOn: '' }
  })
}

/**
 * Approve a day (Task 7-facing): write the live snapshot + totalHours and move to Approved.
 * The server trigger stamps approvedBy / approvedOn — do NOT set them here.
 */
export async function approveDay (
  client: TxOperations,
  day: Ref<TimesheetDay>,
  reports: DayReportLike[]
): Promise<void> {
  const { lines, totalHours } = buildSnapshot(reports)
  const snapshot: TimesheetLine[] = lines.map((l) => ({
    issue: l.issue as Ref<any>,
    identifier: l.identifier,
    title: l.title,
    project: l.project,
    hours: l.hours,
    note: l.note
  }))
  await client.updateDoc(ygTimesheet.class.TimesheetDay, core.space.Workspace, day, {
    status: 'Approved',
    snapshot,
    totalHours
  })
}

/** Reject a day (Task 7-facing) with a reason. */
export async function rejectDay (
  client: TxOperations,
  dayId: Ref<TimesheetDay>,
  reason: string
): Promise<void> {
  await client.updateDoc(ygTimesheet.class.TimesheetDay, core.space.Workspace, dayId, {
    status: 'Rejected',
    rejectReason: reason
  })
}

/**
 * Load the ProjectApprovers mixin (pm / teamLead) for a set of project refs.
 * Returns a Map keyed by project ref — the shape resolveApprovers expects.
 */
export async function loadProjectApprovers (
  client: TxOperations,
  projectRefs: string[]
): Promise<Map<string, ProjectApproverLike>> {
  const out = new Map<string, ProjectApproverLike>()
  const unique = [...new Set(projectRefs.filter((p) => p !== ''))]
  if (unique.length === 0) return out
  const hierarchy = client.getHierarchy()
  const projects = await client.findAll(tracker.class.Project, { _id: { $in: unique as Ref<any>[] } })
  for (const project of projects) {
    if (hierarchy.hasMixin(project, ygTimesheet.mixin.ProjectApprovers)) {
      const m = hierarchy.as(project, ygTimesheet.mixin.ProjectApprovers)
      out.set(project._id, { pm: m.pm ?? null, teamLead: m.teamLead ?? null })
    } else {
      out.set(project._id, { pm: null, teamLead: null })
    }
  }
  return out
}
