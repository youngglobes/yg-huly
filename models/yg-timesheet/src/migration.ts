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
import type { Employee } from '@hcengineering/contact'
import type { Project } from '@hcengineering/tracker'
import ygTimesheet, { ygTimesheetId, type TimesheetDay } from '@hcengineering/yg-timesheet'
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
      }
    ])
  }
}
