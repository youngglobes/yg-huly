//
// YoungGlobes: yg-timesheet migrations — provision the private HR space.
//
import { DOMAIN_SPACE, generateId, TxOperations, type Ref, type Timestamp } from '@hcengineering/core'
import {
  tryUpgrade,
  type MigrateOperation,
  type MigrationClient,
  type MigrationUpgradeClient
} from '@hcengineering/model'
import core from '@hcengineering/model-core'
import workbench from '@hcengineering/model-workbench'
import hr from '@hcengineering/hr'
import tracker from '@hcengineering/tracker'
import contact, { type Employee } from '@hcengineering/contact'
import type { Issue, Project, TimeSpendReport } from '@hcengineering/tracker'
import ygTimesheet, { ygTimesheetId, type TimesheetDay, type WorkDesignation } from '@hcengineering/yg-timesheet'
import { DOMAIN_YG_TIMESHEET } from '.'

async function createHrSpace (tx: TxOperations): Promise<void> {
  const existing = await tx.findOne(core.class.Space, { _id: ygTimesheet.space.HrData })
  if (existing !== undefined) return
  await tx.createDoc(
    core.class.Space,
    core.space.Space,
    {
      name: 'HR Timesheets',
      description: 'Private HR timesheet projection (HrTimeEntry). Members = HR admins.',
      private: true,
      archived: false,
      members: [],
      owners: [],
      autoJoin: false
    },
    ygTimesheet.space.HrData
  )
}

// Space holding the approval overlay (approved hours + who approved). READABLE for beta (user
// decision 2026-07-25): a private space refused the read to legitimate approvers/admins who are not
// members, so Reports and the CSV export came back empty on refresh. Proper per-employee privacy is
// deferred to the server-materialization security fix; until then the space is public so the
// approver audience can read approved hours reliably.
async function createApprovalsSpace (tx: TxOperations): Promise<void> {
  const existing = await tx.findOne(core.class.Space, { _id: ygTimesheet.space.Approvals })
  if (existing !== undefined) return
  await tx.createDoc(
    core.class.Space,
    core.space.Space,
    {
      name: 'Timesheet Approvals',
      description: 'Approved hours + approver attribution. Readable by the approver audience.',
      private: false,
      archived: false,
      members: [],
      owners: [],
      autoJoin: false
    },
    ygTimesheet.space.Approvals
  )
}

// Flip an EXISTING private Approvals space to public (beta) so approvers/admins can read approved
// hours in Reports + export on refresh.
//
// Runs in the MIGRATE phase via a RAW domain update, NOT an upgrade-phase updateDoc. The earlier
// upgrade-phase version (a `TxOperations.updateDoc` on the Space) was rejected by the pipeline's
// NormalizeTxMiddleware with platform:status:BadRequest and silently aborted, so the space stayed
// private on the beta workspace (diagnosed 2026-07-27: approved hours + approver came back blank on
// refresh and in the CSV export because a private space serves its docs to members only). A raw
// domain update bypasses the tx pipeline entirely, exactly like the manual SQL flip used to unblock
// the beta workspace. Idempotent: the query only matches a still-private space, so re-running is a
// no-op. Fresh workspaces are created public by createApprovalsSpace, so this only ever repairs a
// workspace whose Approvals space predates that.
async function openApprovalsSpaceRaw (client: MigrationClient): Promise<void> {
  await client.update(DOMAIN_SPACE, { _id: ygTimesheet.space.Approvals, private: true }, { private: false })
}

// Hide Huly's built-in HR app so there is one HR menu (ours). Best-effort: an existing app doc can
// only be updated by a TxOperations client (not the model Builder), and updating a model-space doc
// is not guaranteed on every backend — so never let this fail the workspace provision.
async function hideStockHrApp (tx: TxOperations): Promise<void> {
  try {
    const app = await tx.findOne(workbench.class.Application, { _id: hr.app.HR })
    if (app !== undefined && app.hidden !== true) {
      await tx.updateDoc(workbench.class.Application, core.space.Model, hr.app.HR, { hidden: true })
    }
  } catch (err) {
    console.error('yg-timesheet: could not hide stock HR app (non-fatal)', err)
  }
}

// Point the Timesheet app at a reports-style glyph so it is visually distinct from the Attendance
// app (which keeps the clock icon). Best-effort like hideStockHrApp: updating a model-space
// Application doc via TxOperations is not guaranteed on every backend, so never fail the provision.
// (Fresh workspaces already get the new icon from createModel; this only repairs existing ones.)
async function setTimesheetAppIcon (tx: TxOperations): Promise<void> {
  try {
    const app = await tx.findOne(workbench.class.Application, { _id: ygTimesheet.app.Timesheet })
    if (app !== undefined && app.icon !== tracker.icon.TimeReport) {
      await tx.updateDoc(workbench.class.Application, core.space.Model, ygTimesheet.app.Timesheet, {
        icon: tracker.icon.TimeReport
      })
    }
  } catch (err) {
    console.error('yg-timesheet: could not set Timesheet app icon (non-fatal)', err)
  }
}

// Point the HR app at the people/HR glyph (was the reused clock icon) so it is visually distinct
// from the Timesheet + Attendance apps. Same best-effort model-space updateDoc as setTimesheetAppIcon.
async function setHrAppIcon (tx: TxOperations): Promise<void> {
  try {
    const app = await tx.findOne(workbench.class.Application, { _id: ygTimesheet.app.HumanResource })
    if (app !== undefined && app.icon !== hr.icon.HR) {
      await tx.updateDoc(workbench.class.Application, core.space.Model, ygTimesheet.app.HumanResource, {
        icon: hr.icon.HR
      })
    }
  } catch (err) {
    console.error('yg-timesheet: could not set HR app icon (non-fatal)', err)
  }
}

// Remove Huly's built-in right-sidebar widgets from the Calendar and Love (virtual office) plugins.
// User decision 2026-07-25: the YG portal is timesheet-focused, so those default widgets are just
// clutter. Matched by the doc _id prefix so no calendar/love dependency is needed. Best-effort like
// hideStockHrApp: on the pinned model version nothing re-creates them, so the removal sticks. Never
// let it fail the workspace provision.
async function hideStockWidgets (tx: TxOperations): Promise<void> {
  try {
    const widgets = await tx.findAll(workbench.class.Widget, {})
    for (const w of widgets) {
      if (w._id.startsWith('calendar:') || w._id.startsWith('love:')) {
        await tx.removeDoc(workbench.class.Widget, w.space, w._id)
      }
    }
  } catch (err) {
    console.error('yg-timesheet: could not remove stock right-sidebar widgets (non-fatal)', err)
  }
}

// Per-task approval (2026-07-23): existing TimesheetDay rows carry a single status and a
// snapshot of their lines. Derive one TimesheetTask per snapshot line so history survives.
// Days with no snapshot yield no tasks and therefore read as Draft — accepted.
//
// NOTE: this runs in the `migrate` phase (raw MigrationClient, domain-level writes only). It
// deliberately does NOT create the TimesheetApproval rows for Approved days here — those
// reference ygTimesheet.space.Approvals, which is only provisioned in the `upgrade` phase
// (createApprovalsSpace). Creating a doc against a space that doesn't exist yet is fragile, so
// the approval-row backfill is a separate step (migrateApprovalRows, below) that runs in
// `upgrade`, after the space exists. See ygTimesheetOperation.upgrade for the ordering.
async function migrateDaysToTasks (client: MigrationClient): Promise<void> {
  const days = await client.find<TimesheetDay>(DOMAIN_YG_TIMESHEET, {
    _class: ygTimesheet.class.TimesheetDay
  })
  for (const day of days) {
    const already = await client.find(DOMAIN_YG_TIMESHEET, {
      _class: ygTimesheet.class.TimesheetTask,
      attachedTo: day._id
    })
    if (already.length > 0) continue // idempotent — safe to re-run
    for (const line of day.snapshot ?? []) {
      const taskId = generateId()
      await client.create(DOMAIN_YG_TIMESHEET, {
        _id: taskId,
        _class: ygTimesheet.class.TimesheetTask,
        space: core.space.Workspace,
        attachedTo: day._id,
        attachedToClass: ygTimesheet.class.TimesheetDay,
        collection: 'tasks',
        modifiedBy: day.modifiedBy,
        modifiedOn: day.modifiedOn,
        date: day.date,
        issue: line.issue,
        identifier: line.identifier,
        title: line.title,
        project: line.project as Ref<Project>,
        submittedHours: line.hours,
        status: day.status,
        approvers: day.approvers,
        submittedOn: day.submittedOn,
        ...(day.rejectReason != null ? { rejectReason: day.rejectReason } : {})
      })
    }
  }
}

// Backfill the private Approvals-space overlay for tasks migrated (above) from an already-
// Approved day, so approved history is not lost. Approved hours default to what was submitted —
// nobody re-judged these retrospectively. Runs in the `upgrade` phase, AFTER createApprovalsSpace
// has provisioned ygTimesheet.space.Approvals (see ygTimesheetOperation.upgrade — this state is
// ordered after 'approvals-space-0001'). Idempotent: skips any task that already has an
// approval doc, so it is safe to re-run and safe even if migrateDaysToTasks is re-run first.
async function migrateApprovalRows (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  const tasks = await ops.findAll(ygTimesheet.class.TimesheetTask, { status: 'Approved' })
  for (const task of tasks) {
    const existing = await ops.findOne(ygTimesheet.class.TimesheetApproval, { task: task._id })
    if (existing !== undefined) continue // idempotent — safe to re-run
    const day = await ops.findOne(ygTimesheet.class.TimesheetDay, { _id: task.attachedTo as Ref<TimesheetDay> })
    if (day?.approvedBy == null || day?.approvedOn == null) continue // no sign-off to carry over
    await ops.createDoc(ygTimesheet.class.TimesheetApproval, ygTimesheet.space.Approvals, {
      task: task._id,
      approvedHours: task.submittedHours,
      approvedBy: day.approvedBy as Ref<Employee>,
      approvedOn: day.approvedOn as Timestamp
    })
  }
}

// Backfill the HrTimeEntry projection from EXISTING TimeSpendReports. The server trigger
// (OnTimeSpendReportChange -> upsertMirror) only mirrors reports changed AFTER it was deployed, so
// on an existing workspace all historical time is missing from HR until this one-shot backfill runs.
// Mirrors upsertMirror's field mapping exactly. Idempotent: skips any report that already has a
// mirror (keyed by `source`), so it is safe to re-run. Runs in the `upgrade` phase, ordered AFTER
// 'hr-space-0001' so ygTimesheet.space.HrData exists before we create entries in it.
async function backfillHrTimeEntries (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  const reports = await ops.findAll(tracker.class.TimeSpendReport, {})
  if (reports.length === 0) return
  // Pre-load lookups once (avoids ~4 queries per report over thousands of rows).
  const haveSource = new Set((await ops.findAll(ygTimesheet.class.HrTimeEntry, {})).map((e) => e.source))
  const issueById = new Map((await ops.findAll(tracker.class.Issue, {})).map((i) => [i._id, i]))
  const projectById = new Map((await ops.findAll(tracker.class.Project, {})).map((p) => [p._id, p]))
  for (const report of reports) {
    const employee = report.employee
    if (employee == null) continue // matches upsertMirror: no employee -> no mirror
    if (haveSource.has(report._id)) continue // idempotent
    const issue: Issue | undefined = issueById.get(report.attachedTo as Ref<Issue>)
    const project = issue !== undefined ? projectById.get(issue.space) : undefined
    await ops.createDoc(ygTimesheet.class.HrTimeEntry, ygTimesheet.space.HrData, {
      source: report._id,
      employee,
      date: report.date ?? 0,
      hours: report.value,
      project: (issue?.space ?? '') as Ref<Project>,
      projectName: project?.name ?? '',
      issue: (issue?._id ?? report.attachedTo) as Ref<Issue>,
      identifier: issue?.identifier ?? '-',
      title: issue?.title ?? '(unknown issue)',
      note: report.description ?? ''
    })
  }
}

// Map the retired WorkProfile.category to the new designation so the Performance report keeps its
// tracked roster after the Category -> Designation change. HR fine-tunes exact titles afterward.
// junior-dev/senior-dev/salesforce map to tracked titles; sales maps to an untracked title; 'other'
// (and any unknown) is left unset. Idempotent: skips any profile that already has a designation.
const CATEGORY_TO_DESIGNATION: Record<string, WorkDesignation> = {
  'junior-dev': 'Associate Software Engineer',
  'senior-dev': 'Senior Software Engineer',
  salesforce: 'Salesforce Developer',
  sales: 'Business Development Executive'
}

async function migrateWorkProfileDesignation (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  const profiles = await ops.findAll(ygTimesheet.mixin.WorkProfile, {})
  for (const p of profiles) {
    if (p.designation !== undefined) continue // idempotent
    const oldCat = (p as unknown as { category?: string }).category
    if (oldCat === undefined) continue
    const designation = CATEGORY_TO_DESIGNATION[oldCat]
    if (designation === undefined) continue // 'other' / unknown -> leave unset
    await ops.updateMixin(p._id, contact.mixin.Employee, p.space, ygTimesheet.mixin.WorkProfile, { designation })
  }
}

export const ygTimesheetOperation: MigrateOperation = {
  async migrate (client: MigrationClient, mode): Promise<void> {
    await migrateDaysToTasks(client)
    // Raw flip of an existing private Approvals space -> public (see openApprovalsSpaceRaw for why
    // this is here and not an upgrade-phase updateDoc). Cheap + idempotent, safe every run.
    await openApprovalsSpaceRaw(client)
  },
  async upgrade (state: Map<string, Set<string>>, client: () => Promise<MigrationUpgradeClient>, mode): Promise<void> {
    await tryUpgrade(mode, state, client, ygTimesheetId, [
      {
        state: 'hr-space-0001',
        func: async (client) => {
          const ops = new TxOperations(client, core.account.System)
          await createHrSpace(ops)
          await hideStockHrApp(ops)
        }
      },
      {
        // One-shot backfill of the HrTimeEntry projection from existing TimeSpendReports so HR shows
        // historical time (the trigger only mirrors going forward). After 'hr-space-0001' so HrData exists.
        state: 'hr-timeentry-backfill-0002',
        func: backfillHrTimeEntries
      },
      {
        state: 'approvals-space-0001',
        func: async (client) => {
          const ops = new TxOperations(client, core.account.System)
          await createApprovalsSpace(ops)
        }
      },
      {
        // Ordered after 'approvals-space-0001' so ygTimesheet.space.Approvals is guaranteed to
        // exist before any TimesheetApproval doc referencing it is created — see
        // migrateApprovalRows above for why this can't run in the `migrate` phase.
        state: 'approval-rows-0001',
        func: migrateApprovalRows
      },
      {
        // Remove Huly's built-in Calendar + Love (Office) right-sidebar widgets for a clean portal.
        state: 'hide-stock-widgets-0001',
        func: async (client) => {
          const ops = new TxOperations(client, core.account.System)
          await hideStockWidgets(ops)
        }
      },
      {
        // Give the Timesheet app its reports-style icon on already-provisioned workspaces.
        state: 'timesheet-app-icon-0001',
        func: async (client) => {
          const ops = new TxOperations(client, core.account.System)
          await setTimesheetAppIcon(ops)
        }
      },
      {
        // Give the HR app its people glyph on already-provisioned workspaces.
        state: 'hr-app-icon-0001',
        func: async (client) => {
          const ops = new TxOperations(client, core.account.System)
          await setHrAppIcon(ops)
        }
      },
      {
        // Backfill WorkProfile.designation from the retired category so the Performance report stays
        // populated after the Category -> Designation change. Idempotent (skips set designations).
        state: 'workprofile-designation-0001',
        func: migrateWorkProfileDesignation
      }
    ])
  }
}
