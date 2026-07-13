//
// YoungGlobes: server-yg-timesheet-resources (Phase 1b spike).
//
// Spike: prove a sync compensating-revert tx reaches the client in-request.
//
import core, { type Tx, type TxUpdateDoc } from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'
import type { Timesheet } from '@hcengineering/yg-timesheet'

// Spike: only 'Draft' -> 'Submitted' is legal. Any other target reverts to the stored value.
export async function OnTimesheetDecision (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    const utx = tx as TxUpdateDoc<Timesheet>
    const next = (utx.operations as any).spikeStatus as string | undefined
    if (next === undefined) continue
    const doc = (await control.findAll(control.ctx, utx.objectClass, { _id: utx.objectId }, { limit: 1 }))[0] as any
    if (doc === undefined) continue
    const prev = doc.spikeStatus ?? 'Draft'
    const legal = prev === 'Draft' && next === 'Submitted'
    if (!legal) {
      result.push(control.txFactory.createTxUpdateDoc(utx.objectClass, utx.objectSpace, utx.objectId, {
        spikeStatus: prev
      } as any))
    }
  }
  return result
}

export default async () => ({ trigger: { OnTimesheetDecision } })
