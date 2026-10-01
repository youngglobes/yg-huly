//
// Copyright © 2025 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import {
  TxProcessor,
  type Doc,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Tx,
  type TxCUD
} from '@hcengineering/core'
import { PlatformError, unknownError } from '@hcengineering/platform'
import { BaseMiddleware } from '@hcengineering/server-core'
import type {
  Middleware,
  MiddlewareCreator,
  PipelineContext,
  TxMiddlewareResult
} from '@hcengineering/server-core'

interface TxOrderEntry {
  txIds: string[] // All transaction IDs in this batch
  modifiedOn: number
  enqueuedAt: number // server clock, for diagnostics (modifiedOn is client-set)
  completionPromise: Promise<void>
  completionResolve: () => void
}

/**
 * Longest wait (ms) for an earlier save to the same document before this save fails. 0 = wait
 * forever (the upstream behaviour). A save that never finishes used to make every later save to
 * that document wait forever too (2026-09-30 wedge).
 */
export function txOrderWaitMs (env: Record<string, string | undefined> = process.env): number {
  const raw = (env.TX_ORDER_WAIT_MS ?? '').trim()
  if (raw === '') return 30000
  const v = Number(raw)
  return Number.isInteger(v) && v >= 0 ? v : 30000
}

async function waitAtMost (p: Promise<unknown>, ms: number): Promise<boolean> {
  if (ms <= 0) {
    await p
    return true
  }
  let timer: any
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => { resolve(false) }, ms)
  })
  try {
    return await Promise.race([p.then(() => true), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @public
 *
 * TxOrderingMiddleware ensures that transactions for the same document
 * are processed sequentially by waiting in the tx() method.
 *
 * This prevents race conditions on the client side when transactions
 * arrive out of order (e.g., tx1 with modifiedOn=101 arrives after
 * tx2 with modifiedOn=102), which would cause unnecessary getCurrentDoc calls.
 *
 * How it works:
 * 1. In tx(): Wait for previous transaction for the same document to complete before proceeding
 * 2. After processing completes (after provideTx returns), mark the transaction as complete
 * 3. In handleBroadcast(): Simply pass through since ordering is already guaranteed
 */
export class TxOrderingMiddleware extends BaseMiddleware implements Middleware {
  // Track transactions order per document: Map<docId, TxOrderEntry>
  // Only stores the last pending transaction per document
  private readonly docTxQueue = new Map<Ref<Doc>, TxOrderEntry>()

  constructor (context: PipelineContext, next: Middleware | undefined, private readonly waitMs: number) {
    super(context, next)
  }

  static create (waitMs: number = txOrderWaitMs()): MiddlewareCreator {
    return async (ctx, context, next) => new TxOrderingMiddleware(context, next, waitMs)
  }

  override async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    // Group transactions by document ID
    const txesByDoc = new Map<Ref<Doc>, Tx[]>()

    for (const tx of txes) {
      const docId = this.getTargetDocId(tx)
      if (docId !== undefined) {
        let docTxes = txesByDoc.get(docId)
        if (docTxes === undefined) {
          docTxes = []
          txesByDoc.set(docId, docTxes)
        }
        docTxes.push(tx)
      }
    }

    // For each document, wait for previous transaction to complete
    const waitPromises: Promise<void>[] = []
    const blockers: TxOrderEntry[] = []
    const currentEntries = new Map<Ref<Doc>, TxOrderEntry>()

    for (const [docId, docTxes] of txesByDoc) {
      // Get the previous entry for this document if it exists
      const prevEntry = this.docTxQueue.get(docId)
      if (prevEntry !== undefined) {
        // Wait for the previous transaction to complete
        waitPromises.push(prevEntry.completionPromise)
        blockers.push(prevEntry)
      }

      // Create a new entry for this batch
      let completionResolve: () => void = () => {}
      const completionPromise = new Promise<void>((resolve) => {
        completionResolve = resolve
      })

      const minModifiedOn = Math.min(...docTxes.map((tx) => tx.modifiedOn))

      const entry: TxOrderEntry = {
        txIds: docTxes.map((tx) => tx._id),
        modifiedOn: minModifiedOn,
        enqueuedAt: Date.now(),
        completionPromise,
        completionResolve
      }

      currentEntries.set(docId, entry)
      this.docTxQueue.set(docId, entry)
    }

    // Wait for all previous transactions to complete, but not forever
    if (waitPromises.length > 0) {
      const done = await ctx.with('tx-ordering-wait', {}, () => waitAtMost(Promise.all(waitPromises), this.waitMs))
      if (!done) {
        ctx.warn('tx-order wait timeout', {
          waitMs: this.waitMs,
          docs: [...currentEntries.keys()],
          txIds: txes.map((tx) => tx._id),
          blockedBy: blockers.map((b) => ({ txIds: b.txIds, ageSec: Math.round((Date.now() - b.enqueuedAt) / 1000) }))
        })
        // Do not release yet: the blockers may only be slow, and saves queued behind this one must
        // not run before them. Release once every blocker has settled. Followers each have their own
        // bounded wait, so they fail on their own limit rather than hang.
        void Promise.all(waitPromises).then(() => {
          this.release(currentEntries)
        })
        throw new PlatformError(unknownError('Previous change to this document is still being processed'))
      }
    }

    try {
      // Process the transactions
      return await this.provideTx(ctx, txes)
    } finally {
      // Always mark entries as complete and clean up, even if there's an exception
      // This ensures waiting transactions don't get stuck
      this.release(currentEntries)
    }
  }

  // Wake whoever waits on these entries and drop them from the queue if still current.
  private release (entries: Map<Ref<Doc>, TxOrderEntry>): void {
    for (const entry of entries.values()) {
      entry.completionResolve()
    }
    for (const [docId, entry] of entries) {
      if (this.docTxQueue.get(docId) === entry) {
        this.docTxQueue.delete(docId)
      }
    }
  }

  /**
   * Extract target document ID from transaction
   */
  private getTargetDocId (tx: Tx): Ref<Doc> | undefined {
    if (TxProcessor.isExtendsCUD(tx._class)) {
      return (tx as TxCUD<Doc>).objectId
    }
    return undefined
  }
}
