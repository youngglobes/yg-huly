//
// YoungGlobes: server-yg-timesheet-resources (Phase 1b spike).
//
// Spike finding: a SYNC trigger doing control.findAll deadlocks the tx (it queries
// through the same in-flight pipeline). The request/controlled-documents precedents
// are ASYNC + control.apply, and enforce on POST-APPLY state (the tx is applied
// before the trigger runs, so the doc already carries the new value — you cannot
// read the "from" state). This spike proves the async compensating-revert lands.
//
import core, { type Tx, type TxUpdateDoc } from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'
import type { Timesheet } from '@hcengineering/yg-timesheet'

// Spike rule (checkable on post-apply state): 'Approved' is forbidden here; revert to 'Draft'.
export async function OnTimesheetDecision (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    const utx = tx as TxUpdateDoc<Timesheet>
    const next = (utx.operations as any).spikeStatus as string | undefined
    if (next === undefined) continue
    const doc = (await control.findAll(control.ctx, utx.objectClass, { _id: utx.objectId }, { limit: 1 }))[0] as any
    if (doc === undefined) continue
    if (doc.spikeStatus === 'Approved') {
      const revert = control.txFactory.createTxUpdateDoc(utx.objectClass, utx.objectSpace, utx.objectId, {
        spikeStatus: 'Draft'
      } as any)
      await control.apply(control.ctx, [revert])
    }
  }
  return []
}

export default async () => ({ trigger: { OnTimesheetDecision } })
