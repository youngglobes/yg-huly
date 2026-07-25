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
import { getCurrentEmployee, type Employee } from '@hcengineering/contact'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'
import ygTimesheet, {
  type Timesheet,
  type TimesheetDay,
  type TimesheetLine,
  type TimesheetTask
} from '@hcengineering/yg-timesheet'
import { weekRange } from './week'
import { buildSnapshot, driftHours, resolveApprovers, type DayReportLike, type ProjectApproverLike } from './workflow'
import { buildTaskUnits } from './task-approval'

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

/** Returned by submitDay when one or more of the day's projects have no PM/TL configured. */
export interface NoApproverResult {
  kind: typeof NO_APPROVER
  projects: string[]
}

/**
 * Submit a day: collapse the day's reports into one task unit per issue (buildTaskUnits), each
 * stamped with the approvers of ITS OWN project only. If ANY task's project has no PM/TL
 * configured we do not write at all — the UI surfaces the offending projects (via NoApproverResult)
 * so the missing project config gets fixed, rather than silently parking that task where nobody
 * will ever see it. Otherwise lazily materialise Timesheet + TimesheetDay and write one
 * TimesheetTask row per issue.
 */
export async function submitDay (
  client: TxOperations,
  { employee, date, reports, approversByProject }: SubmitArgs
): Promise<Ref<TimesheetDay> | NoApproverResult> {
  const units = buildTaskUnits(reports, approversByProject, employee)
  // Every task must have somewhere to go. If ANY task's project has no PM/TL configured we do not
  // write at all — the UI surfaces the error so the missing project config gets fixed, rather than
  // silently parking that task where nobody will ever see it.
  //
  // NOTE this is STRICTER than the old day-level rule, which submitted as long as ONE project in
  // the day had an approver (leaving the rest unapprovable). Returning the offending projects
  // rather than a bare sentinel is deliberate (user decision 2026-07-23): a generic "No approver"
  // tells the employee nothing about who to chase.
  if (units.length === 0) return { kind: NO_APPROVER, projects: [] }
  const unapprovable = units.filter((u) => u.approvers.length === 0)
  if (unapprovable.length > 0) {
    return { kind: NO_APPROVER, projects: [...new Set(unapprovable.map((u) => u.project))] }
  }

  const totalHours = units.reduce((sum, u) => sum + u.submittedHours, 0)
  const submittedOn = Date.now()
  const tsId = await ensureTimesheet(client, employee, weekStartOf(date))
  const dayId = await ensureDay(client, tsId, date)

  // Replace any task rows from a previous submit of this day so a re-submit after edits cannot
  // leave stale issues behind. Approved rows are preserved — re-submitting a corrected task must
  // not silently discard a sibling task an approver already signed off.
  const existing = await client.findAll(ygTimesheet.class.TimesheetTask, { attachedTo: dayId })
  for (const t of existing) {
    if (t.status !== 'Approved') await client.remove(t)
  }
  const keptIssues = new Set(existing.filter((t) => t.status === 'Approved').map((t) => t.issue))

  for (const u of units) {
    if (keptIssues.has(u.issue as Ref<Issue>)) continue
    await client.addCollection(
      ygTimesheet.class.TimesheetTask,
      core.space.Workspace,
      dayId,
      ygTimesheet.class.TimesheetDay,
      'tasks',
      {
        date,
        issue: u.issue as Ref<Issue>,
        identifier: u.identifier,
        title: u.title,
        project: u.project as Ref<Project>,
        submittedHours: u.submittedHours,
        status: 'Submitted',
        approvers: u.approvers as Ref<Employee>[],
        submittedOn
      }
    )
  }

  await client.updateDoc(ygTimesheet.class.TimesheetDay, core.space.Workspace, dayId, {
    approvers: [...new Set(units.flatMap((u) => u.approvers))] as Ref<Employee>[],
    submittedOn,
    totalHours
  })
  return dayId
}

/**
 * Recall a submitted day back to Draft. The day label is DERIVED from its TimesheetTask rows, so
 * clearing only TimesheetDay (the old day-level flow) leaves every task at status='Submitted' —
 * the derived status stays 'Submitted', the Recall button never clears, and the tasks stay in the
 * approver queue. Recall is offered ONLY when the derived status is 'Submitted' (i.e. every task
 * is Submitted, none Approved/Rejected — see deriveDayStatus), so returning the day's Submitted
 * tasks to Draft is exactly what un-submits it: no Approved task can be present to worry about
 * preserving, and no Rejected task is touched (it stays Rejected until the employee fixes/resubmits).
 * The TimesheetDay cleanup below is kept (harmless) for the deprecated status/approvers/submittedOn.
 */
export async function recallDay (client: TxOperations, dayId: Ref<TimesheetDay>): Promise<void> {
  const tasks = await client.findAll(ygTimesheet.class.TimesheetTask, { attachedTo: dayId, status: 'Submitted' })
  for (const t of tasks) {
    await client.updateDoc(ygTimesheet.class.TimesheetTask, core.space.Workspace, t._id, {
      status: 'Draft', $unset: { submittedOn: '' }
    })
  }
  // keep the existing TimesheetDay cleanup (harmless; clears the deprecated status/approvers/submittedOn)
  await client.updateDoc(ygTimesheet.class.TimesheetDay, core.space.Workspace, dayId, {
    status: 'Draft', approvers: [], $unset: { submittedOn: '' }
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

/**
 * Approve ONE task with the approver's agreed hours.
 *
 * `approvedHours`, `approvedBy` and `approvedOn` do NOT live on TimesheetTask any more — they
 * live on the private `TimesheetApproval` doc (ygTimesheet.space.Approvals), which a non-member
 * (i.e. any employee) is refused write/read access to by the server. This function therefore:
 *  - sets ONLY `status: 'Approved'` (+ clears any stale rejectReason) on the shared, world-
 *    readable TimesheetTask — approvedHours must never be re-persisted there; and
 *  - creates (or, on re-approval after a change, updates) the TimesheetApproval row with
 *    `task` + `approvedHours` only. The server trigger stamps approvedBy / approvedOn
 *    authoritatively — do NOT set them here (same division of labour as the day-level flow).
 * Never touches the employee's TimeSpendReport: their logged time stays their record.
 */
export async function approveTask (
  client: TxOperations, taskId: Ref<TimesheetTask>, approvedHours: number
): Promise<void> {
  await client.updateDoc(ygTimesheet.class.TimesheetTask, core.space.Workspace, taskId, {
    status: 'Approved',
    $unset: { rejectReason: '' }
  })

  const existing = await client.findOne(ygTimesheet.class.TimesheetApproval, { task: taskId })
  if (existing !== undefined) {
    await client.updateDoc(ygTimesheet.class.TimesheetApproval, ygTimesheet.space.Approvals, existing._id, {
      approvedHours,
      approvedBy: getCurrentEmployee(),
      approvedOn: Date.now()
    })
  } else {
    await client.createDoc(ygTimesheet.class.TimesheetApproval, ygTimesheet.space.Approvals, {
      task: taskId,
      approvedHours,
      approvedBy: getCurrentEmployee(),
      approvedOn: Date.now()
    })
  }
}

/**
 * Reject ONE task with a required reason; it returns to Draft for the employee to fix.
 * A rejected task must not keep an approval record, so any existing TimesheetApproval row for
 * this task (from a prior approval) is removed. approvedHours/approvedBy/approvedOn are not
 * referenced here at all — they no longer live on TimesheetTask.
 */
export async function rejectTask (
  client: TxOperations, taskId: Ref<TimesheetTask>, reason: string
): Promise<void> {
  await client.updateDoc(ygTimesheet.class.TimesheetTask, core.space.Workspace, taskId, {
    status: 'Rejected',
    rejectReason: reason
  })

  const existing = await client.findOne(ygTimesheet.class.TimesheetApproval, { task: taskId })
  if (existing !== undefined) {
    await client.remove(existing)
  }
}
