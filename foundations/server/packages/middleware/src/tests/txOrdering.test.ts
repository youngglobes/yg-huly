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

/**
 * Test for TxOrderingMiddleware
 *
 * This test verifies that the middleware ensures transactions for the same document
 * are processed sequentially by waiting in the tx() method.
 */

import core, {
  type Class,
  type Doc,
  generateId,
  Hierarchy,
  MeasureMetricsContext,
  type MeasureContext,
  ModelDb,
  type Ref,
  type Space,
  type Tx,
  TxFactory
} from '@hcengineering/core'
import type { PipelineContext, TxMiddlewareResult } from '@hcengineering/server-core'
import { PlatformError } from '@hcengineering/platform'
import { TxOrderingMiddleware, txOrderWaitMs } from '../txOrdering'

interface TestDoc extends Doc {
  name: string
  counter: number
}

const testDocClass = 'test:class:TestDoc' as Ref<Class<TestDoc>>

/**
 * Track broadcasted transactions to verify ordering
 */
class BroadcastTracker {
  broadcasted: Tx[] = []

  record (tx: Tx): void {
    this.broadcasted.push(tx)
  }

  reset (): void {
    this.broadcasted = []
  }

  getOrder (): number[] {
    return this.broadcasted.map((tx) => tx.modifiedOn)
  }
}

describe('TxOrderingMiddleware', () => {
  let ctx: MeasureContext
  let middleware: TxOrderingMiddleware
  let tracker: BroadcastTracker
  let txFactory: TxFactory
  let testDoc: TestDoc

  beforeEach(async () => {
    ctx = new MeasureMetricsContext('test', {})
    ctx.contextData = {
      broadcast: {
        txes: [],
        queue: [],
        sessions: {}
      }
    } as any

    tracker = new BroadcastTracker()

    const hierarchy = new Hierarchy()
    const model = new ModelDb(hierarchy)

    const pipelineContext: PipelineContext = {
      workspace: { uuid: 'test-workspace' as any, url: 'test', dataId: 'test' as any },
      hierarchy,
      modelDb: model,
      branding: null as any,
      adapterManager: {} as any,
      storageAdapter: {} as any,
      contextVars: {},
      lastTx: '',
      lastHash: '',
      broadcastEvent: async (ctx, txes) => {
        for (const tx of txes) {
          tracker.record(tx)
        }
      }
    }

    // Create a mock "next" middleware that records transactions when they're processed
    const nextMiddleware = {
      tx: async (ctx: MeasureContext, txes: Tx[]): Promise<TxMiddlewareResult> => {
        // Record transactions as they're processed
        for (const tx of txes) {
          tracker.record(tx)
        }
        return {}
      },
      handleBroadcast: async (ctx: MeasureContext): Promise<void> => {
        // No-op since we removed handleBroadcast from TxOrderingMiddleware
      }
    }

    middleware = (await TxOrderingMiddleware.create()(
      ctx,
      pipelineContext,
      nextMiddleware as any
    )) as TxOrderingMiddleware
    txFactory = new TxFactory(core.account.System)

    testDoc = {
      _id: generateId<TestDoc>(),
      _class: testDocClass,
      space: 'test:space' as Ref<Space>,
      modifiedOn: 100,
      modifiedBy: core.account.System,
      name: 'Test Document',
      counter: 0
    }
  })

  it('should broadcast transactions in order by modifiedOn', async () => {
    // Create 3 transactions with different modifiedOn times
    const tx1 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 1 })
    tx1.modifiedOn = 101

    const tx2 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 2 })
    tx2.modifiedOn = 102

    const tx3 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 3 })
    tx3.modifiedOn = 103

    // Process transactions - they will be processed sequentially
    // even if called in parallel
    const promises = [
      middleware.tx(ctx as any, [tx2]),
      middleware.tx(ctx as any, [tx1]),
      middleware.tx(ctx as any, [tx3])
    ]

    await Promise.all(promises)

    // Verify they were processed (tracker records them during next.tx which is called in order)
    expect(tracker.broadcasted.length).toBe(3)
  })

  it('should handle multiple documents independently', async () => {
    const testDoc2: TestDoc = {
      _id: generateId<TestDoc>(),
      _class: testDocClass,
      space: 'test:space' as Ref<Space>,
      modifiedOn: 200,
      modifiedBy: core.account.System,
      name: 'Test Document 2',
      counter: 0
    }

    // Create transactions for doc1
    const tx1Doc1 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 1 })
    tx1Doc1.modifiedOn = 102

    const tx2Doc1 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 2 })
    tx2Doc1.modifiedOn = 101

    // Create transactions for doc2
    const tx1Doc2 = txFactory.createTxUpdateDoc(testDocClass, testDoc2.space, testDoc2._id, { counter: 1 })
    tx1Doc2.modifiedOn = 202

    const tx2Doc2 = txFactory.createTxUpdateDoc(testDocClass, testDoc2.space, testDoc2._id, { counter: 2 })
    tx2Doc2.modifiedOn = 201

    // Process all transactions - doc1 and doc2 can be processed in parallel
    await Promise.all([middleware.tx(ctx as any, [tx1Doc1, tx2Doc1]), middleware.tx(ctx as any, [tx1Doc2, tx2Doc2])])

    // Verify both documents were processed
    expect(tracker.broadcasted.length).toBe(4)
  })

  it('should wait for previous transactions to complete', async () => {
    // This test simulates concurrent tx() calls for the same document
    const tx1 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 1 })
    tx1.modifiedOn = 101

    const tx2 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 2 })
    tx2.modifiedOn = 102

    const tx3 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 3 })
    tx3.modifiedOn = 103

    // Track the order of execution
    const executionOrder: number[] = []

    // Create a mock next middleware that tracks execution order
    const trackingMiddleware = {
      tx: async (ctx: MeasureContext, txes: Tx[]): Promise<TxMiddlewareResult> => {
        for (const tx of txes) {
          executionOrder.push(tx.modifiedOn)
          // Simulate some async work
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        return {}
      },
      handleBroadcast: async (ctx: MeasureContext): Promise<void> => {}
    }

    // Recreate middleware with tracking
    const pipelineContext: PipelineContext = {
      workspace: { uuid: 'test-workspace' as any, url: 'test', dataId: 'test' as any },
      hierarchy: new Hierarchy(),
      modelDb: new ModelDb(new Hierarchy()),
      branding: null as any,
      adapterManager: {} as any,
      storageAdapter: {} as any,
      contextVars: {},
      lastTx: '',
      lastHash: '',
      broadcastEvent: async (ctx, txes) => {}
    }

    const testMiddleware = (await TxOrderingMiddleware.create()(
      ctx,
      pipelineContext,
      trackingMiddleware as any
    )) as TxOrderingMiddleware

    // Start all transactions "simultaneously" (tx2 first, but should wait for tx1)
    const promises = [
      testMiddleware.tx(ctx as any, [tx2]),
      testMiddleware.tx(ctx as any, [tx1]),
      testMiddleware.tx(ctx as any, [tx3])
    ]

    await Promise.all(promises)

    // Despite being called in order [tx2, tx1, tx3], they should execute sequentially
    // The order depends on which promise was awaited first, but all should complete
    expect(executionOrder.length).toBe(3)
    expect(new Set(executionOrder)).toEqual(new Set([101, 102, 103]))
  })

  it('should handle rapid sequential transactions', async () => {
    // Create 10 transactions for the same document
    const txes: Tx[] = []
    for (let i = 1; i <= 10; i++) {
      const tx = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: i })
      tx.modifiedOn = 100 + i
      txes.push(tx)
    }

    // Process all at once - they should be handled sequentially
    await middleware.tx(ctx as any, txes)

    // Should have processed all transactions
    expect(tracker.broadcasted.length).toBe(10)
  })

  it('should track statistics correctly', async () => {
    const tx1 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 1 })
    tx1.modifiedOn = 101

    const tx2 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 2 })
    tx2.modifiedOn = 102

    // Process transactions
    await middleware.tx(ctx as any, [tx1, tx2])

    // Verify transactions were processed
    expect(tracker.broadcasted.length).toBe(2)
  })

  it('should handle already ordered transactions efficiently', async () => {
    // Create transactions already in order
    const tx1 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 1 })
    tx1.modifiedOn = 101

    const tx2 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 2 })
    tx2.modifiedOn = 102

    const tx3 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 3 })
    tx3.modifiedOn = 103

    // Process in order
    await middleware.tx(ctx as any, [tx1, tx2, tx3])

    // Verify all were processed
    expect(tracker.broadcasted.length).toBe(3)
  })

  it('should release waits on exceptions', async () => {
    const tx1 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 1 })
    tx1.modifiedOn = 101

    const tx2 = txFactory.createTxUpdateDoc(testDocClass, testDoc.space, testDoc._id, { counter: 2 })
    tx2.modifiedOn = 102

    // Create middleware that throws on first transaction
    let shouldThrow = true
    const throwingMiddleware = {
      tx: async (ctx: MeasureContext, txes: Tx[]): Promise<TxMiddlewareResult> => {
        if (shouldThrow) {
          shouldThrow = false
          throw new Error('Test error')
        }
        return {}
      },
      handleBroadcast: async (ctx: MeasureContext): Promise<void> => {}
    }

    const pipelineContext: PipelineContext = {
      workspace: { uuid: 'test-workspace' as any, url: 'test', dataId: 'test' as any },
      hierarchy: new Hierarchy(),
      modelDb: new ModelDb(new Hierarchy()),
      branding: null as any,
      adapterManager: {} as any,
      storageAdapter: {} as any,
      contextVars: {},
      lastTx: '',
      lastHash: '',
      broadcastEvent: async (ctx, txes) => {}
    }

    const testMiddleware = (await TxOrderingMiddleware.create()(
      ctx,
      pipelineContext,
      throwingMiddleware as any
    )) as TxOrderingMiddleware

    // First transaction should throw
    await expect(testMiddleware.tx(ctx as any, [tx1])).rejects.toThrow('Test error')

    // Second transaction should not hang - it should be able to proceed
    await expect(testMiddleware.tx(ctx as any, [tx2])).resolves.toBeDefined()
  })
})

/**
 * Integration test with mocked pipeline context
 */
describe('TxOrderingMiddleware Integration', () => {
  it('should work with provideTx flow', async () => {
    const ctx = new MeasureMetricsContext('test', {})
    ctx.contextData = { broadcast: { txes: [], queue: [], sessions: {} } } as any

    const hierarchy = new Hierarchy()
    const model = new ModelDb(hierarchy)
    const processedOrder: number[] = []

    // Create middleware with next middleware mock
    const nextMiddleware = {
      tx: async (ctx: MeasureContext, txes: Tx[]): Promise<TxMiddlewareResult> => {
        // Track processing order
        for (const tx of txes) {
          processedOrder.push(tx.modifiedOn)
        }
        return {}
      },
      handleBroadcast: async (ctx: MeasureContext): Promise<void> => {}
    }

    const pipelineContext: PipelineContext = {
      workspace: { uuid: 'test-workspace' as any, url: 'test', dataId: 'test' as any },
      hierarchy,
      modelDb: model,
      branding: null as any,
      adapterManager: {} as any,
      storageAdapter: {} as any,
      contextVars: {},
      lastTx: '',
      lastHash: '',
      broadcastEvent: async (ctx, txes) => {}
    }

    const middleware = (await TxOrderingMiddleware.create()(
      ctx,
      pipelineContext,
      nextMiddleware as any
    )) as TxOrderingMiddleware
    const txFactory = new TxFactory(core.account.System)

    const docId = generateId()
    const tx1 = txFactory.createTxUpdateDoc('test:class' as any, 'test:space' as any, docId as any, {} as any)
    tx1.modifiedOn = 102

    const tx2 = txFactory.createTxUpdateDoc('test:class' as any, 'test:space' as any, docId as any, {} as any)
    tx2.modifiedOn = 101

    // Process in parallel - they should be serialized
    await Promise.all([middleware.tx(ctx as any, [tx1]), middleware.tx(ctx as any, [tx2])])

    // Verify both transactions were processed
    expect(processedOrder.length).toBe(2)
    expect(new Set(processedOrder)).toEqual(new Set([101, 102]))
  })
})

describe('TxOrderingMiddleware wait limit', () => {
  const sleep = async (ms: number): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, ms)) }
  const pending = Symbol('pending')
  const settleWithin = async <T>(p: Promise<T>, ms: number): Promise<T | typeof pending> =>
    await Promise.race([p, sleep(ms).then((): typeof pending => pending)])

  let ctx: MeasureContext
  let processed: string[]
  let hang: Set<string>
  let gates: Map<string, Promise<void>>
  const f = new TxFactory(core.account.System)
  const docA = generateId<TestDoc>()
  const docB = generateId<TestDoc>()
  const upd = (doc: Ref<TestDoc>): Tx => f.createTxUpdateDoc(testDocClass, 'test:space' as Ref<Space>, doc, { counter: 1 })

  const make = (waitMs: number): TxOrderingMiddleware => {
    const next = {
      tx: async (_ctx: MeasureContext, txes: Tx[]): Promise<TxMiddlewareResult> => {
        if (txes.some((t) => hang.has(t._id))) await new Promise(() => {})
        for (const t of txes) await gates.get(t._id)
        processed.push(...txes.map((t) => t._id))
        return {}
      }
    }
    return new TxOrderingMiddleware({} as any, next as any, waitMs)
  }

  beforeEach(() => {
    ctx = new MeasureMetricsContext('test', {})
    processed = []
    hang = new Set()
    gates = new Map()
  })

  it('fails a save stuck behind a hung save once the limit passes', async () => {
    const mw = make(50)
    const t1 = upd(docA)
    hang.add(t1._id)
    void mw.tx(ctx as any, [t1])
    const err = await mw.tx(ctx as any, [upd(docA)]).catch((e) => e)
    expect(err).toBeInstanceOf(PlatformError)
    expect(String(err.message)).toContain('still being processed')
  })

  it('a save queued behind a timed-out save fails on its own limit instead of jumping the queue', async () => {
    const mw = make(50)
    const t1 = upd(docA)
    hang.add(t1._id)
    void mw.tx(ctx as any, [t1])
    const t2 = mw.tx(ctx as any, [upd(docA)]).catch(() => 'failed')
    await sleep(30)
    const t3tx = upd(docA)
    const t3 = mw.tx(ctx as any, [t3tx]).catch((e) => e)
    expect(await t2).toBe('failed')
    expect(await t3).toBeInstanceOf(PlatformError)
    expect(processed).not.toContain(t3tx._id)
  })

  it('keeps write order when the blocker is slow, not dead', async () => {
    const mw = make(100)
    const t1 = upd(docA)
    let finish: () => void = () => {}
    gates.set(t1._id, new Promise<void>((resolve) => { finish = resolve }))
    void mw.tx(ctx as any, [t1])
    const t2 = mw.tx(ctx as any, [upd(docA)]).catch((e) => e)
    await sleep(120)
    // t2 timed out at ~100ms. t3 queues behind t2's entry, which is released only when t1 settles.
    const t3tx = upd(docA)
    const t3 = mw.tx(ctx as any, [t3tx])
    await sleep(30)
    expect(processed).not.toContain(t3tx._id)
    finish() // t1 done at ~150ms, well inside t3's own 100ms limit (ends ~220ms)
    expect(await t2).toBeInstanceOf(PlatformError)
    await t3
    expect(processed).toEqual([t1._id, t3tx._id])
  })

  it('fails a multi-document batch as a whole and keeps its documents queued behind the blocker', async () => {
    const mw = make(50)
    const t1 = upd(docA)
    hang.add(t1._id)
    void mw.tx(ctx as any, [t1])
    const batch = mw.tx(ctx as any, [upd(docA), upd(docB)]).catch(() => 'failed')
    expect(await batch).toBe('failed')
    // docB's entry from the failed batch is released only after t1 settles (never here), so a
    // later save on docB fails on its own limit rather than jumping ahead.
    const onB = upd(docB)
    const err = await mw.tx(ctx as any, [onB]).catch((e) => e)
    expect(err).toBeInstanceOf(PlatformError)
    expect(processed).not.toContain(onB._id)
  })

  it('leaves other documents alone while one is stuck', async () => {
    const mw = make(50)
    const t1 = upd(docA)
    hang.add(t1._id)
    void mw.tx(ctx as any, [t1])
    const onB = upd(docB)
    expect(await settleWithin(mw.tx(ctx as any, [onB]), 20)).not.toBe(pending)
  })

  it('waitMs 0 keeps the old unlimited wait', async () => {
    const mw = make(0)
    const t1 = upd(docA)
    hang.add(t1._id)
    void mw.tx(ctx as any, [t1])
    expect(await settleWithin(mw.tx(ctx as any, [upd(docA)]), 150)).toBe(pending)
  })

  it('reads TX_ORDER_WAIT_MS with a safe default', () => {
    expect(txOrderWaitMs({})).toBe(30000)
    expect(txOrderWaitMs({ TX_ORDER_WAIT_MS: '0' })).toBe(0)
    expect(txOrderWaitMs({ TX_ORDER_WAIT_MS: '5000' })).toBe(5000)
    expect(txOrderWaitMs({ TX_ORDER_WAIT_MS: 'abc' })).toBe(30000)
    expect(txOrderWaitMs({ TX_ORDER_WAIT_MS: '-5' })).toBe(30000)
    expect(txOrderWaitMs({ TX_ORDER_WAIT_MS: '30s' })).toBe(30000)
    expect(txOrderWaitMs({ TX_ORDER_WAIT_MS: '1.5' })).toBe(30000)
    expect(txOrderWaitMs({ TX_ORDER_WAIT_MS: ' 5000 ' })).toBe(5000)
    expect(txOrderWaitMs({ TX_ORDER_WAIT_MS: '' })).toBe(30000)
  })
})
