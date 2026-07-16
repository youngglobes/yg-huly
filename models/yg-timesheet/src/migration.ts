//
// YoungGlobes: yg-timesheet migrations — provision the private HR space.
//
import { TxOperations } from '@hcengineering/core'
import {
  tryUpgrade,
  type MigrateOperation,
  type MigrationClient,
  type MigrationUpgradeClient
} from '@hcengineering/model'
import core from '@hcengineering/model-core'
import workbench from '@hcengineering/model-workbench'
import hr from '@hcengineering/hr'
import ygTimesheet, { ygTimesheetId } from '@hcengineering/yg-timesheet'

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

export const ygTimesheetOperation: MigrateOperation = {
  async migrate (client: MigrationClient, mode): Promise<void> {},
  async upgrade (state: Map<string, Set<string>>, client: () => Promise<MigrationUpgradeClient>, mode): Promise<void> {
    await tryUpgrade(mode, state, client, ygTimesheetId, [
      {
        state: 'hr-space-0001',
        func: async (client) => {
          const ops = new TxOperations(client, core.account.System)
          await createHrSpace(ops)
          await hideStockHrApp(ops)
        }
      }
    ])
  }
}
