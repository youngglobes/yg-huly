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

export const ygTimesheetOperation: MigrateOperation = {
  async migrate (client: MigrationClient, mode): Promise<void> {},
  async upgrade (state: Map<string, Set<string>>, client: () => Promise<MigrationUpgradeClient>, mode): Promise<void> {
    await tryUpgrade(mode, state, client, ygTimesheetId, [
      {
        state: 'hr-space-0001',
        func: async (client) => {
          const ops = new TxOperations(client, core.account.System)
          await createHrSpace(ops)
        }
      }
    ])
  }
}
