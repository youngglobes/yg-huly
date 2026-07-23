//
// YoungGlobes: yg-timesheet migrations — provision the private HR space.
//
import { generateId, TxOperations, type Ref, type Timestamp } from '@hcengineering/core'
import {
  tryUpgrade,
  type MigrateOperation,
  type MigrationClient,
  type MigrationUpgradeClient
} from '@hcengineering/model'
import core from '@hcengineering/model-core'
import workbench from '@hcengineering/model-workbench'
import hr from '@hcengineering/hr'
import type { Employee } from '@hcengineering/contact'
import type { Project } from '@hcengineering/tracker'
import ygTimesheet, { ygTimesheetId, type TimesheetDay, type TimesheetTask } from '@hcengineering/yg-timesheet'
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

// Private space holding the approval overlay (approved hours + who approved). Members are the
// assigned PMs/TLs and admins — maintained by OnProjectApproversChange (Task R3). Private so the
// server refuses every row to a non-member: employees must not see approved hours.
async function createApprovalsSpace (tx: TxOperations): Promise<void> {
  const existing = await tx.findOne(core.class.Space, { _id: ygTimesheet.space.Approvals })
  if (existing !== undefined) return
  await tx.createDoc(
    core.class.Space,
    core.space.Space,
    {
      name: 'Timesheet Approvals',
      description: 'Approved hours + approver attribution. Members = assigned PMs/TLs.',
      private: true,
      archived: false,
      members: [],
      owners: [],
      autoJoin: false
    },
    ygTimesheet.space.Approvals
  )
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

// Per-task approval (2026-07-23): existing TimesheetDay rows carry a single status and a
// snapshot of their lines. Derive one TimesheetTask per snapshot line so history survives.
// Days with no snapshot yield no tasks and therefore read as Draft — accepted.
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
      // Carry the day's sign-off into the private Approvals space so approved history is not
      // lost. Approved hours default to what was submitted — nobody re-judged these
      // retrospectively. Lives off the task row on purpose: employees must never read it.
      if (day.status === 'Approved') {
        await client.create(DOMAIN_YG_TIMESHEET, {
          _id: generateId(),
          _class: ygTimesheet.class.TimesheetApproval,
          space: ygTimesheet.space.Approvals,
          modifiedBy: day.modifiedBy,
          modifiedOn: day.modifiedOn,
          task: taskId as Ref<TimesheetTask>,
          approvedHours: line.hours,
          approvedBy: day.approvedBy as Ref<Employee>,
          approvedOn: day.approvedOn as Timestamp
        })
      }
    }
  }
}

export const ygTimesheetOperation: MigrateOperation = {
  async migrate (client: MigrationClient, mode): Promise<void> {
    await migrateDaysToTasks(client)
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
      }
    ])
  }
}
