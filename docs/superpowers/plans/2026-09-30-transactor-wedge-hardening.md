# Transactor Wedge Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a transactor request sticks, the log says where (D); a save stuck behind another save to the same document fails after a bounded wait instead of hanging forever (E); and the browser tells people the server is not responding instead of spinning (C).

**Architecture:** D adds opt-in open-span tracking to `MeasureMetricsContext` plus a per-request stage on `SessionRequest`, both printed by the existing `request hang found` warning. E wraps `TxOrderingMiddleware`'s wait in a timer (`TX_ORDER_WAIT_MS`, default 30000, `0` = old behaviour). C adds a stall monitor in the browser `Connection` that emits a DOM event, and a banner component mounted in `WorkbenchApp.svelte`.

**Tech Stack:** TypeScript, Jest (per-package `npx jest`), Svelte 4, rush monorepo `yg-huly-beta` (branch `yg_beta`), beta stack via `huly-migration/huly-selfhost/build-beta.sh`.

**Spec:** `docs/superpowers/specs/2026-09-30-transactor-wedge-hardening-design.md` (same repo).

## Global Constraints

- Repo: `/home/karthi_0008/dev/client-projects/yg-huly-beta`, branch `yg_beta`. **Never run `git add` or `git commit` in this repo** (another session may be working in it; the user commits). Each task ends by listing its changed files instead.
- No em dash, en dash or other long dash in anything written: code, comments, strings, docs. Use `-`, `,`, `:` or parentheses.
- Say "YG Portal" in anything user-facing we author; upstream package names stay.
- `TX_ORDER_WAIT_MS`: default `30000`; `0` means unlimited (kill switch).
- Stall rule: stalled when a non-ping request has waited `> 30 s` AND no non-ping response for `> 30 s`.
- Open-span list cap: `64` entries; the warning prints the deepest `8` as `name@ageSec`.
- New UI strings: English text, added to all 14 files in `plugins/workbench-assets/lang/` (the repo keeps identical key sets across languages).
- No data model change, no migration, no `upgrade-workspace`.
- **Spec amendment (planning, 2026-09-30):** banner text drops "We've been alerted." A legitimate cold model load can exceed 30 s with nothing answered, and no alert fires in that case. Final text: "YG Portal isn't responding right now." / "Please don't refresh: keep this tab open, and changes you just made will be sent when it's back."

## Review Focus

1. **Async fan-out inside one request** (`Promise.all` of many `ctx.with`): spans finish out of order; each must remove only itself, and the list must never exceed 64. Test in Task 1.
2. **A save batch touching several documents where only one is blocked:** the whole batch fails and releases every entry it registered, so saves queued behind any of its documents are not stranded. Test in Task 3.
3. **The failed save must surface as a normal error, not crash anything:** the middleware throws a `PlatformError`; `sessionManager` already turns thrown errors into an error response. Test asserts the error type in Task 3.
4. **One slow request while others are still answered** (a big export) must NOT show the banner. Test in Task 4.
5. **Closing a connection while stalled** (logout, workspace switch) must hide the banner, and the monitor must keep checking while the socket reconnects (its own interval, not the ping interval). Tests in Task 4.

---

### Task 1: Open-span tracking in `MeasureMetricsContext` (D2)

**Files:**
- Modify: `foundations/core/packages/measurements/src/context.ts` (class `MeasureMetricsContext` at line 56: new field, `newChild`, `with`; new exports after the class)
- Test: `foundations/core/packages/measurements/src/__tests__/context.test.ts` (append a `describe`)

**Interfaces:**
- Produces (exported from `@hcengineering/measurements`, re-exported by `@hcengineering/core`):
  - `interface OpenSpan { name: string, start: number }` (`start` = `Date.now()` ms)
  - `const MAX_OPEN_SPANS = 64`
  - `function trackOpenSpans (ctx: MeasureContext): OpenSpan[] | undefined` (starts tracking on this context and every context derived from it later; returns the live list, or `undefined` if `ctx` is not a `MeasureMetricsContext`)

- [ ] **Step 1: Write the failing tests**

Append to `context.test.ts` (add `trackOpenSpans`, `MAX_OPEN_SPANS` to the existing `from '../context'` import):

```ts
describe('open span tracking', () => {
  it('records nothing unless tracking was started', async () => {
    const ctx = new MeasureMetricsContext('t', {})
    await ctx.with('a', {}, async () => {})
    expect((ctx as any).openSpans).toBeUndefined()
  })

  it('lists running spans, children included, and clears them when done', async () => {
    const ctx = new MeasureMetricsContext('t', {})
    const spans = trackOpenSpans(ctx) as OpenSpan[]
    let seen: string[] = []
    await ctx.with('outer', {}, async (c) => {
      await c.with('inner', {}, async () => {
        seen = spans.map((s) => s.name)
      })
    })
    expect(seen).toEqual(['outer', 'inner'])
    expect(spans).toEqual([])
  })

  it('clears a span when the operation rejects', async () => {
    const ctx = new MeasureMetricsContext('t', {})
    const spans = trackOpenSpans(ctx) as OpenSpan[]
    await expect(ctx.with('bad', {}, async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(spans).toEqual([])
  })

  it('clears a span when a sync operation throws', () => {
    const ctx = new MeasureMetricsContext('t', {})
    const spans = trackOpenSpans(ctx) as OpenSpan[]
    expect(() => ctx.with('bad', {}, () => { throw new Error('x') })).toThrow('x')
    expect(spans).toEqual([])
  })

  it('keeps a hung span listed with its start time', () => {
    const ctx = new MeasureMetricsContext('t', {})
    const spans = trackOpenSpans(ctx) as OpenSpan[]
    const before = Date.now()
    void ctx.with('stuck', {}, async () => await new Promise(() => {}))
    expect(spans.map((s) => s.name)).toEqual(['stuck'])
    expect(spans[0].start).toBeGreaterThanOrEqual(before)
  })

  it('removes only the finished span when parallel spans end out of order', async () => {
    const ctx = new MeasureMetricsContext('t', {})
    const spans = trackOpenSpans(ctx) as OpenSpan[]
    let releaseA: () => void = () => {}
    const a = ctx.with('a', {}, async () => { await new Promise<void>((resolve) => { releaseA = resolve }) })
    const b = ctx.with('b', {}, async () => {})
    await b
    expect(spans.map((s) => s.name)).toEqual(['a'])
    releaseA()
    await a
    expect(spans).toEqual([])
  })

  it(`never grows past ${MAX_OPEN_SPANS} entries`, () => {
    const ctx = new MeasureMetricsContext('t', {})
    const spans = trackOpenSpans(ctx) as OpenSpan[]
    for (let i = 0; i < MAX_OPEN_SPANS + 10; i++) {
      void ctx.with(`s${i}`, {}, async () => await new Promise(() => {}))
    }
    expect(spans.length).toBe(MAX_OPEN_SPANS)
  })

  it('returns undefined for contexts that cannot track', () => {
    expect(trackOpenSpans(new NoMetricsContext())).toBeUndefined()
  })
})
```

Also add `type OpenSpan` to the imports from `'../context'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd foundations/core/packages/measurements && npx jest src/__tests__/context.test.ts`
Expected: FAIL, TypeScript error `Module '"../context"' has no exported member 'trackOpenSpans'`.

- [ ] **Step 3: Implement**

In `context.ts`, inside `export class MeasureMetricsContext`, next to `contextData: object = {}`:

```ts
  // Open-span tracking for hang diagnostics. Undefined (off) unless trackOpenSpans() started it;
  // shared by reference with every child so one list covers a whole request.
  openSpans?: OpenSpan[]
```

In `newChild`, after `result.contextData = this.contextData`:

```ts
    result.openSpans = this.openSpans
```

Replace the body of `with<T>(...)` with (same behaviour plus span bookkeeping):

```ts
    const c = this.newChild(name, params, { fullParams, logger: this.logger })
    const spans = this.openSpans
    const span: OpenSpan | undefined =
      spans !== undefined && spans.length < MAX_OPEN_SPANS ? { name, start: Date.now() } : undefined
    if (span !== undefined) spans?.push(span)
    const closeSpan = (): void => {
      if (span === undefined || spans === undefined) return
      const i = spans.indexOf(span)
      if (i >= 0) spans.splice(i, 1)
    }
    let needFinally = true
    try {
      const value = op(c)
      if (value instanceof Promise) {
        needFinally = false
        return value.finally(() => {
          c.end()
          closeSpan()
          if (opt?.log === true) {
            this.logger.logOperation(name, platformNowDiff((c as MeasureMetricsContext).st), {
              ...params,
              ...fullParams
            })
          }
        })
      } else {
        if (value == null) {
          return nullPromise as Promise<T>
        }
        return Promise.resolve(value)
      }
    } finally {
      if (needFinally) {
        c.end()
        closeSpan()
      }
    }
```

After the closing `}` of `class MeasureMetricsContext`, add:

```ts
/** A step that started and has not finished yet (hang diagnostics). `start` is Date.now() ms. */
export interface OpenSpan {
  name: string
  start: number
}

/** Cap so an async fan-out can never grow a request's open-span list without limit. */
export const MAX_OPEN_SPANS = 64

/**
 * Start recording open spans on `ctx` and every context derived from it afterwards. Returns the
 * live list (entries disappear as their steps finish), or undefined when `ctx` cannot track.
 * The transactor uses it to report where a hung request is stuck.
 */
export function trackOpenSpans (ctx: MeasureContext): OpenSpan[] | undefined {
  if (!(ctx instanceof MeasureMetricsContext)) return undefined
  ctx.openSpans = ctx.openSpans ?? []
  return ctx.openSpans
}
```

(`MeasureContext` is already imported in `context.ts` from `./types`; if not, add `import type { MeasureContext } from './types'`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd foundations/core/packages/measurements && npx jest`
Expected: all suites PASS (the 35 existing context tests plus 8 new).

- [ ] **Step 5: Build the package so dependants see the new exports**

Run: `cd foundations/core/packages/measurements && npm run build`
Expected: exit 0.

- [ ] **Step 6: Record changed files (no commit)**

`foundations/core/packages/measurements/src/context.ts`, `.../src/__tests__/context.test.ts`

---

### Task 2: Request stage and the richer hang warning (D1)

**Files:**
- Create: `foundations/server/packages/server/src/hangInfo.ts`
- Test: `foundations/server/packages/server/src/__tests__/hangInfo.test.ts`
- Modify: `foundations/server/packages/core/src/types.ts:551-555` (`SessionRequest`)
- Modify: `foundations/server/packages/server/src/sessionManager.ts` (hang warning ~line 398-408; `handleRequest` ~1399-1533; `handleRPC` ~1535-1606)

**Interfaces:**
- Consumes: `OpenSpan`, `trackOpenSpans` from `@hcengineering/core` (Task 1).
- Produces:
  - `SessionRequest` gains `stage?: string`, `stageAt?: number`, `openSpans?: OpenSpan[]`
  - `hangInfo.ts`: `type RequestStage = 'queued' | 'backpressure' | 'workspace' | 'pipeline'`; `interface HangInfo { stage?: string, stageSec?: number, openSpans?: string[] }`; `function setStage (r: SessionRequest | undefined, stage: RequestStage, now?: number): void`; `function describeHang (r: SessionRequest, now: number): HangInfo`
  - The log line `request hang found` gains fields `stage`, `stageSec`, `openSpans` (Task 6 parses them).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/hangInfo.test.ts`:

```ts
import { describeHang, setStage } from '../hangInfo'
import type { SessionRequest } from '@hcengineering/server-core'

const req = (): SessionRequest => ({ id: '1', params: {}, start: 0 })

describe('hang description', () => {
  it('reports the stage and how long it has been in it', () => {
    const r = req()
    setStage(r, 'workspace', 1000)
    expect(describeHang(r, 31000)).toEqual({ stage: 'workspace', stageSec: 30 })
  })

  it('lists the deepest 8 open spans with their ages', () => {
    const r = req()
    r.openSpans = Array.from({ length: 10 }, (_, i) => ({ name: `s${i}`, start: 0 }))
    expect(describeHang(r, 5000).openSpans).toEqual(['s2@5', 's3@5', 's4@5', 's5@5', 's6@5', 's7@5', 's8@5', 's9@5'])
  })

  it('adds nothing for a request without diagnostics', () => {
    expect(describeHang(req(), 1)).toEqual({})
  })

  it('ignores an empty span list', () => {
    const r = req()
    r.openSpans = []
    expect(describeHang(r, 1)).toEqual({})
  })

  it('setStage tolerates a request that is already gone', () => {
    expect(() => { setStage(undefined, 'pipeline') }).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd foundations/server/packages/server && npx jest src/__tests__/hangInfo.test.ts`
Expected: FAIL, `Cannot find module '../hangInfo'`.

- [ ] **Step 3: Extend `SessionRequest`**

In `foundations/server/packages/core/src/types.ts`, add `type OpenSpan` to the existing `from '@hcengineering/core'` import block (line ~51), and change the interface:

```ts
export interface SessionRequest {
  id: string
  params: any
  start: number
  // Hang diagnostics: where the request is now (see server/src/hangInfo.ts) and which steps are open.
  stage?: string
  stageAt?: number
  openSpans?: OpenSpan[]
}
```

Then build server-core so the server package sees it: `cd foundations/server/packages/core && npm run build` (exit 0).

- [ ] **Step 4: Create `hangInfo.ts`**

```ts
//
// Hang diagnostics for the transactor: where a stuck request is. Added after the 2026-09-30 wedge,
// where the warning said a request was stuck but never where.
//
import type { SessionRequest } from '@hcengineering/server-core'

export type RequestStage = 'queued' | 'backpressure' | 'workspace' | 'pipeline'

export interface HangInfo {
  stage?: string
  stageSec?: number
  openSpans?: string[]
}

const SHOWN_SPANS = 8

export function setStage (r: SessionRequest | undefined, stage: RequestStage, now: number = Date.now()): void {
  if (r === undefined) return
  r.stage = stage
  r.stageAt = now
}

export function describeHang (r: SessionRequest, now: number): HangInfo {
  const info: HangInfo = {}
  if (r.stage !== undefined) {
    info.stage = r.stage
    info.stageSec = Math.round((now - (r.stageAt ?? r.start)) / 1000)
  }
  if (r.openSpans !== undefined && r.openSpans.length > 0) {
    info.openSpans = r.openSpans
      .slice(-SHOWN_SPANS)
      .map((s) => `${s.name}@${Math.round((now - s.start) / 1000)}`)
  }
  return info
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd foundations/server/packages/server && npx jest src/__tests__/hangInfo.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Wire stages and spans into `sessionManager.ts`**

Imports: add `trackOpenSpans` to the existing `@hcengineering/core` import, and `import { describeHang, setStage } from './hangInfo'`.

Hang warning (in `handleSessionTick`, the loop over `s.session.requests.values()`), add the spread:

```ts
            this.ctx.warn('request hang found', {
              sec,
              wsId,
              total: s.session.requests.size,
              user: s.session.getUser(),
              params: cutObjectArray(r.params),
              ...describeHang(r, now)
            })
```

`handleRequest`: the `service.requests.set(reqId, {...})` call becomes

```ts
      service.requests.set(reqId, {
        id: reqId,
        params: request,
        start: st,
        stage: 'queued',
        stageAt: st
      })
      const req = service.requests.get(reqId)
```

then, in the same function:

```ts
        if (ws.isBackpressure()) {
          setStage(req, 'backpressure')
          await ws.backpressure(requestCtx)
        }
```

and the request call becomes (only the `setStage` lines and the `callTx` body change):

```ts
        setStage(req, 'workspace')
        await this.counters.withCounter('request', 1, () =>
          workspace.with(async (pipeline) => {
            setStage(req, 'pipeline')
            await requestCtx.with(
              '🧨' + request.method,
              { source, mode: 'websocket' },
              (callTx) => {
                if (req !== undefined) req.openSpans = trackOpenSpans(callTx)
                return f.apply(service, [
                  this.createOpContext(callTx, requestCtx, pipeline, request.id, service, ws, rateLimit),
                  ...params
                ])
              },
              {
                user: service.getUser(),
                socialId: service.getRawAccount().primarySocialId,
                workspace: workspace.wsId.uuid
              },
              { meta: request.meta }
            )
          })
        )
```

`handleRPC`: same pattern. The `service.requests.set` gets `stage: 'queued', stageAt: st` and is followed by `const req = service.requests.get(reqId)`; `setStage(req, 'workspace')` goes before `await this.counters.withCounter(`; `setStage(req, 'pipeline')` is the first line inside `workspace.with(async (pipeline) => {`; and the `(callTx) => operation(...)` arrow becomes:

```ts
              (callTx) => {
                if (req !== undefined) req.openSpans = trackOpenSpans(callTx)
                return operation(
                  this.createOpContext(callTx, requestCtx, pipeline, reqId, service, ws, rateLimitStatus),
                  rateLimitStatus
                )
              },
```

(`🧨` is the literal emoji already used on that line; keep it exactly as it is in the file.)

- [ ] **Step 7: Run the server package tests and type-check**

Run: `cd foundations/server/packages/server && npx jest && npm run _phase:validate`
Expected: all tests PASS (existing `sessionManager.test.ts` plus `hangInfo.test.ts`); validate exit 0.

- [ ] **Step 8: Record changed files (no commit)**

`foundations/server/packages/core/src/types.ts`, `foundations/server/packages/server/src/hangInfo.ts`, `.../src/__tests__/hangInfo.test.ts`, `.../src/sessionManager.ts`

---

### Task 3: Bounded same-document wait in `TxOrderingMiddleware` (E)

**Files:**
- Modify: `foundations/server/packages/middleware/src/txOrdering.ts`
- Test: `foundations/server/packages/middleware/src/tests/txOrdering.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `MeasureContext.with` (named span `tx-ordering-wait` shows up in Task 2's `openSpans`).
- Produces:
  - `export function txOrderWaitMs (env?: Record<string, string | undefined>): number` (default 30000; `'0'` gives 0; invalid gives 30000)
  - `new TxOrderingMiddleware(context: PipelineContext, next: Middleware | undefined, waitMs: number)` (public constructor)
  - `static create (waitMs?: number): MiddlewareCreator` (default `txOrderWaitMs()`; `server-pipeline/src/pipeline.ts:183` keeps calling `create()` unchanged)
  - On timeout: `ctx.warn('tx-order wait timeout', { waitMs, docs, txIds, blockedBy })` and `throw new PlatformError(unknownError('Previous change to this document is still being processed'))`

- [ ] **Step 1: Write the failing tests**

Append to `txOrdering.test.ts` (add `txOrderWaitMs` to the `'../txOrdering'` import and `import { PlatformError } from '@hcengineering/platform'`):

```ts
describe('TxOrderingMiddleware wait limit', () => {
  const sleep = async (ms: number): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, ms)) }
  const pending = Symbol('pending')
  const settleWithin = async <T>(p: Promise<T>, ms: number): Promise<T | typeof pending> =>
    await Promise.race([p, sleep(ms).then(() => pending)])

  let ctx: MeasureContext
  let processed: string[]
  let hang: Set<string>
  const f = new TxFactory(core.account.System)
  const docA = generateId<TestDoc>()
  const docB = generateId<TestDoc>()
  const upd = (doc: Ref<TestDoc>): Tx => f.createTxUpdateDoc(testDocClass, 'test:space' as Ref<Space>, doc, { counter: 1 })

  const make = (waitMs: number): TxOrderingMiddleware => {
    const next = {
      tx: async (_ctx: MeasureContext, txes: Tx[]): Promise<TxMiddlewareResult> => {
        if (txes.some((t) => hang.has(t._id))) await new Promise(() => {})
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

  it('does not strand a save queued behind the one that failed', async () => {
    const mw = make(50)
    const t1 = upd(docA)
    hang.add(t1._id)
    void mw.tx(ctx as any, [t1])
    const t2 = mw.tx(ctx as any, [upd(docA)]).catch(() => 'failed')
    await sleep(30)
    const t3tx = upd(docA)
    const t3 = mw.tx(ctx as any, [t3tx])
    expect(await t2).toBe('failed')
    await t3
    expect(processed).toContain(t3tx._id)
  })

  it('fails a multi-document batch as a whole and releases all of its documents', async () => {
    const mw = make(50)
    const t1 = upd(docA)
    hang.add(t1._id)
    void mw.tx(ctx as any, [t1])
    const batch = mw.tx(ctx as any, [upd(docA), upd(docB)]).catch(() => 'failed')
    expect(await batch).toBe('failed')
    const onB = upd(docB)
    expect(await settleWithin(mw.tx(ctx as any, [onB]), 200)).not.toBe(pending)
    expect(processed).toContain(onB._id)
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
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd foundations/server/packages/middleware && npx jest src/tests/txOrdering.test.ts`
Expected: FAIL, `Module '"../txOrdering"' has no exported member 'txOrderWaitMs'` (and the 3-argument constructor does not exist).

- [ ] **Step 3: Implement**

In `txOrdering.ts` add imports:

```ts
import { PlatformError, unknownError } from '@hcengineering/platform'
import type { PipelineContext } from '@hcengineering/server-core'
```

and extend the existing server-core type import with `Middleware` if it is not there. Add above the class:

```ts
/**
 * Longest wait (ms) for an earlier save to the same document before this save fails. 0 = wait
 * forever (the upstream behaviour). A save that never finishes used to make every later save to
 * that document wait forever too (2026-09-30 wedge).
 */
export function txOrderWaitMs (env: Record<string, string | undefined> = process.env): number {
  const v = Number.parseInt(env.TX_ORDER_WAIT_MS ?? '', 10)
  return Number.isFinite(v) && v >= 0 ? v : 30000
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
```

In the class, add the constructor and change `create`:

```ts
  constructor (context: PipelineContext, next: Middleware | undefined, private readonly waitMs: number) {
    super(context, next)
  }

  static create (waitMs: number = txOrderWaitMs()): MiddlewareCreator {
    return async (ctx, context, next) => new TxOrderingMiddleware(context, next, waitMs)
  }
```

In `tx()`: declare `const blockers: TxOrderEntry[] = []` next to `waitPromises`; where `prevEntry !== undefined`, also `blockers.push(prevEntry)`. Replace everything from `if (waitPromises.length > 0) {` to the end of the method with:

```ts
    if (waitPromises.length > 0) {
      const done = await ctx.with('tx-ordering-wait', {}, () => waitAtMost(Promise.all(waitPromises), this.waitMs))
      if (!done) {
        ctx.warn('tx-order wait timeout', {
          waitMs: this.waitMs,
          docs: [...currentEntries.keys()],
          txIds: txes.map((tx) => tx._id),
          blockedBy: blockers.map((b) => ({ txIds: b.txIds, ageSec: Math.round((Date.now() - b.modifiedOn) / 1000) }))
        })
        this.release(currentEntries)
        throw new PlatformError(unknownError('Previous change to this document is still being processed'))
      }
    }

    try {
      return await this.provideTx(ctx, txes)
    } finally {
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
```

(Keep any existing comments in the replaced region that still apply; do not leave the old `finally` loop duplicated.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd foundations/server/packages/middleware && npx jest src/tests/txOrdering.test.ts && npm run _phase:validate`
Expected: 14 tests PASS (8 existing + 6 new); validate exit 0.

- [ ] **Step 5: Run the whole middleware suite**

Run: `cd foundations/server/packages/middleware && npx jest`
Expected: all PASS.

- [ ] **Step 6: Record changed files (no commit)**

`foundations/server/packages/middleware/src/txOrdering.ts`, `.../src/tests/txOrdering.test.ts`

---

### Task 4: Stall detection in the browser connection (C, logic)

**Files:**
- Create: `foundations/core/packages/client-resources/src/stall.ts`
- Test: `foundations/core/packages/client-resources/src/__tests__/stall.test.ts`
- Modify: `foundations/core/packages/client-resources/src/connection.ts` (fields near line 104; constructor end ~line 161; response dispatch line 409; `close()` line 214)

**Interfaces:**
- Produces:
  - `const STALL_MS = 30000`, `const STALL_EVENT = 'yg:server-stall'`
  - `interface StallState { stalled: boolean, sinceMs: number }` (event `detail`)
  - `function isStalled (pending: Iterable<{ method: string, startTime: number }>, lastAnswer: number, now: number, pingMethod: string, limitMs?: number): boolean`
  - `class StallMonitor { constructor (pingMethod: string, emit?: (s: StallState) => void, now?: number); answered (method: string, now?: number): void; check (pending: Iterable<{ method: string, startTime: number }>, now?: number): void; stop (): void }`
  - Task 5 listens for `window` event `'yg:server-stall'` with `detail: StallState`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/stall.test.ts`:

```ts
import { isStalled, StallMonitor, STALL_MS, type StallState } from '../stall'

const PING = 'ping'
const req = (method: string, startTime: number): { method: string, startTime: number } => ({ method, startTime })

describe('isStalled', () => {
  const now = 100_000
  it('is false with nothing pending', () => {
    expect(isStalled([], 0, now, PING)).toBe(false)
  })
  it('ignores pings', () => {
    expect(isStalled([req(PING, 0)], 0, now, PING)).toBe(false)
  })
  it('is false for one slow request while others are still answered', () => {
    expect(isStalled([req('findAll', 0)], now - 5_000, now, PING)).toBe(false)
  })
  it('is true when a request waited too long and nothing was answered', () => {
    expect(isStalled([req('tx', now - STALL_MS - 1)], now - STALL_MS - 1, now, PING)).toBe(true)
  })
  it('is false exactly at the limit', () => {
    expect(isStalled([req('tx', now - STALL_MS)], now - STALL_MS, now, PING)).toBe(false)
  })
})

describe('StallMonitor', () => {
  it('emits once on stall and once on recovery', () => {
    const events: StallState[] = []
    const m = new StallMonitor(PING, (s) => events.push(s), 0)
    const pending = [req('loadModel', 0)]
    m.check(pending, STALL_MS + 1)
    m.check(pending, STALL_MS + 5_000)
    expect(events).toEqual([{ stalled: true, sinceMs: STALL_MS + 1 }])
    m.answered('loadModel', STALL_MS + 6_000)
    m.check([], STALL_MS + 7_000)
    expect(events).toEqual([{ stalled: true, sinceMs: STALL_MS + 1 }, { stalled: false, sinceMs: 0 }])
  })

  it('does not count ping answers as recovery', () => {
    const events: StallState[] = []
    const m = new StallMonitor(PING, (s) => events.push(s), 0)
    const pending = [req('tx', 0)]
    m.check(pending, STALL_MS + 1)
    m.answered(PING, STALL_MS + 2)
    m.check(pending, STALL_MS + 3)
    expect(events).toHaveLength(1)
  })

  it('stop() clears a showing banner, and is quiet otherwise', () => {
    const events: StallState[] = []
    const m = new StallMonitor(PING, (s) => events.push(s), 0)
    m.stop()
    expect(events).toHaveLength(0)
    m.check([req('tx', 0)], STALL_MS + 1)
    m.stop()
    expect(events.map((e) => e.stalled)).toEqual([true, false])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd foundations/core/packages/client-resources && npx jest src/__tests__/stall.test.ts`
Expected: FAIL, `Cannot find module '../stall'`.

- [ ] **Step 3: Create `stall.ts`**

```ts
//
// "Server not responding" detection for the YG Portal banner (2026-09-30 wedge follow-up).
// Pings are answered even while the transactor is wedged, so they never count; one slow request
// while others are answered is not a stall either.
//

export const STALL_MS = 30 * 1000
export const STALL_EVENT = 'yg:server-stall'

export interface StallState {
  stalled: boolean
  sinceMs: number
}

interface PendingRequest {
  method: string
  startTime: number
}

export function isStalled (
  pending: Iterable<PendingRequest>,
  lastAnswer: number,
  now: number,
  pingMethod: string,
  limitMs: number = STALL_MS
): boolean {
  if (now - lastAnswer <= limitMs) return false
  for (const p of pending) {
    if (p.method !== pingMethod && now - p.startTime > limitMs) return true
  }
  return false
}

export function dispatchStall (s: StallState): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent<StallState>(STALL_EVENT, { detail: s }))
}

export class StallMonitor {
  private lastAnswer: number
  private stalled = false

  constructor (
    private readonly pingMethod: string,
    private readonly emit: (s: StallState) => void = dispatchStall,
    now: number = Date.now()
  ) {
    this.lastAnswer = now
  }

  answered (method: string, now: number = Date.now()): void {
    if (method !== this.pingMethod) this.lastAnswer = now
  }

  check (pending: Iterable<PendingRequest>, now: number = Date.now()): void {
    const stalled = isStalled(pending, this.lastAnswer, now, this.pingMethod)
    if (stalled === this.stalled) return
    this.stalled = stalled
    this.emit(stalled ? { stalled: true, sinceMs: now - this.lastAnswer } : { stalled: false, sinceMs: 0 })
  }

  stop (): void {
    if (!this.stalled) return
    this.stalled = false
    this.emit({ stalled: false, sinceMs: 0 })
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd foundations/core/packages/client-resources && npx jest src/__tests__/stall.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Wire into `connection.ts`**

Import: `import { StallMonitor } from './stall'`.

Fields, next to `private readonly requests = new Map<ReqId, RequestPromise>()`:

```ts
  // Banner when the server stops answering (stall.ts). Own timer: keeps checking while the socket
  // reconnects, which the ping interval does not.
  private readonly stall = new StallMonitor(pingConst)
  private stallTimer: any
```

Constructor, just before `this.scheduleOpen(this.ctx, false)`:

```ts
    this.stallTimer = setInterval(() => {
      this.stall.check(this.requests.values())
    }, 5 * SECOND)
```

Response dispatch (line 409), right after `const promise = this.requests.get(resp.id)`:

```ts
      if (promise !== undefined) this.stall.answered(promise.method)
```

`close()`, after `clearInterval(this.interval)`:

```ts
    clearInterval(this.stallTimer)
    this.stall.stop()
```

- [ ] **Step 6: Type-check and run the package tests**

Run: `cd foundations/core/packages/client-resources && npx jest && npm run _phase:validate`
Expected: PASS; validate exit 0.

- [ ] **Step 7: Record changed files (no commit)**

`foundations/core/packages/client-resources/src/stall.ts`, `.../src/__tests__/stall.test.ts`, `.../src/connection.ts`

---

### Task 5: The banner (C, UI)

**Files:**
- Create: `plugins/workbench-resources/src/components/ServerStallBanner.svelte`
- Modify: `plugins/workbench-resources/src/components/WorkbenchApp.svelte` (imports; mount inside the top `{#if $location.path[0] === workbenchId ...}` before `{#key ...}`)
- Modify: `plugins/workbench-resources/src/plugin.ts` (`string:` block, line ~23)
- Modify: all 14 `plugins/workbench-assets/lang/*.json`

**Interfaces:**
- Consumes: window event `'yg:server-stall'`, `detail: { stalled: boolean, sinceMs: number }` (Task 4). The name is repeated as a string literal on purpose: `workbench-resources` does not depend on `client-resources`.
- Produces: strings `workbenchRes.string.ServerNotResponding`, `workbenchRes.string.ServerNotRespondingHint`.

- [ ] **Step 1: Add the strings**

`plugin.ts`, inside `string: {` next to `WorkspaceCreating: '' as IntlString,`:

```ts
    ServerNotResponding: '' as IntlString,
    ServerNotRespondingHint: '' as IntlString,
```

All 14 lang files, inserting after the `"string": {` line without reformatting the rest:

```bash
cd plugins/workbench-assets/lang && python3 - <<'EOF'
import glob
for p in sorted(glob.glob('*.json')):
    lines = open(p, encoding='utf-8').read().split('\n')
    i = next(n for n, l in enumerate(lines) if l.strip() == '"string": {')
    ind = ' ' * (len(lines[i + 1]) - len(lines[i + 1].lstrip()))
    lines[i + 1:i + 1] = [
        f'{ind}"ServerNotResponding": "YG Portal isn\'t responding right now.",',
        f'{ind}"ServerNotRespondingHint": "Please don\'t refresh: keep this tab open, and changes you just made will be sent when it\'s back.",',
    ]
    open(p, 'w', encoding='utf-8').write('\n'.join(lines))
    print('ok', p)
EOF
for f in *.json; do python3 -c "import json,sys; json.load(open('$f'))" || echo "BROKEN $f"; done
```

Expected: 14 `ok` lines, no `BROKEN`.

- [ ] **Step 2: Create `ServerStallBanner.svelte`**

```svelte
<!--
// YG Portal: "server not responding" banner (2026-09-30 wedge follow-up). Driven by the
// 'yg:server-stall' window event from client-resources/src/stall.ts.
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'
  import workbenchRes from '../plugin'

  const STALL_EVENT = 'yg:server-stall' // must match client-resources/src/stall.ts

  let stalled = false
  function onStall (e: Event): void {
    stalled = (e as CustomEvent<{ stalled: boolean }>).detail?.stalled === true
  }
  window.addEventListener(STALL_EVENT, onStall)
  onDestroy(() => {
    window.removeEventListener(STALL_EVENT, onStall)
  })
</script>

{#if stalled}
  <div class="yg-stall" role="status" aria-live="polite">
    <span class="yg-stall-dot" />
    <span>
      <b><Label label={workbenchRes.string.ServerNotResponding} /></b>
      <Label label={workbenchRes.string.ServerNotRespondingHint} />
    </span>
  </div>
{/if}

<style lang="scss">
  .yg-stall {
    position: fixed;
    top: 0.5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20000;
    max-width: calc(100vw - 2rem);
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid #f6c500;
    background: var(--theme-popup-color);
    color: var(--theme-caption-color);
    box-shadow: var(--theme-popup-shadow);
    font-size: 0.8125rem;
    line-height: 1.4;
  }
  .yg-stall-dot {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: #f6c500;
    animation: yg-stall-pulse 1.6s ease-in-out infinite;
  }
  @keyframes yg-stall-pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>
```

(`--theme-popup-color`, `--theme-caption-color`, `--theme-popup-shadow` exist in `packages/theme/styles/_colors.scss`.)

- [ ] **Step 3: Mount it in `WorkbenchApp.svelte`**

Add `import ServerStallBanner from './ServerStallBanner.svelte'` to the script. Place the component as the first child of the top-level `{#if $location.path[0] === workbenchId || ...}` block, before `{#key $location.path[1]}`, so it shows over the post-login loading screen and inside the app:

```svelte
{#if $location.path[0] === workbenchId || $location.path[0] === workbenchRes.component.WorkbenchApp}
  <ServerStallBanner />
  {#key $location.path[1]}
```

- [ ] **Step 4: Type-check**

Run: `cd plugins/workbench-resources && npm run svelte-check && npm run _phase:validate`
Expected: 0 errors in `ServerStallBanner.svelte` and `WorkbenchApp.svelte` (pre-existing warnings elsewhere are fine; compare against a run before the change if unsure).

- [ ] **Step 5: Dash check**

Run: `grep -rnP '[\x{2012}-\x{2015}\x{2212}]' plugins/workbench-resources/src/components/ServerStallBanner.svelte foundations/core/packages/client-resources/src/stall.ts plugins/workbench-assets/lang/en.json foundations/server/packages/server/src/hangInfo.ts foundations/server/packages/middleware/src/txOrdering.ts`
Expected: no output.

- [ ] **Step 6: Record changed files (no commit)**

`plugins/workbench-resources/src/components/ServerStallBanner.svelte`, `.../WorkbenchApp.svelte`, `.../src/plugin.ts`, `plugins/workbench-assets/lang/*.json`

---

### Task 6: `wedge.py` shows where requests are stuck (huly-migration repo)

**Files:**
- Modify: `/home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost/wedge.py` (`hangs()`, `alert_body()`)

**Interfaces:**
- Consumes: `request hang found` fields `stage`, `stageSec`, `openSpans` (Task 2).

- [ ] **Step 1: Write the check (a synthetic log line)**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
SP=/tmp/claude-1002/-home-karthi-0008-dev-client-projects-huly-migration/67d06a5f-37fc-4a46-8fd3-5438c8d52e0c/scratchpad
python3 - > $SP/wedge-synth.log <<'EOF'
import json
for u in ('u1','u2','u3'):
    for s in (150, 330):
        print('transactor-1  | ' + json.dumps({"level":"warn","message":"request hang found","sec":s,"timestamp":"2026-10-01T04:03:00.000Z","user":u,"wsId":"w","stage":"pipeline","stageSec":s,"openSpans":["🧨tx@%d" % s,"tx-ordering-wait@%d" % s],"params":{"method":"tx","time":1,"params":[{"_class":"core:class:TxUpdateDoc","_id":"a"*24,"objectClass":"workbench:class:WorkbenchTab","objectId":"b"*24,"modifiedOn":1}]}}))
EOF
python3 wedge.py watch --dry-run --log-file $SP/wedge-synth.log --now 2026-10-01T04:03:30Z | grep -c "Stuck at:"
```

Expected before the change: `0`.

- [ ] **Step 2: Implement**

In `hangs()`, add to the record dict `'stage': j.get('stage'), 'spans': j.get('openSpans') or []`. In `alert_body()`, after the suspects table and before `if who:`:

```python
    deepest = max(recs, key=lambda r: r['sec'])
    if deepest.get('stage'):
        text.append(f'Stuck at: stage {deepest["stage"]}, steps {" > ".join(deepest["spans"]) or "-"} '
                    f'(longest-stuck request, {human(deepest["sec"])}).')
        text.append('')
```

- [ ] **Step 3: Verify**

Re-run the Step 1 command. Expected: `1`. Then the replay from the runbook still works:
`python3 wedge.py watch --dry-run --log-file /tmp/w2930.log --now 2026-09-30T04:03:00Z | head -1` on the server after copying (expected `level: critical`). Deploy: `scp wedge.py developer@46.224.150.17:/home/developer/huly-selfhost/`.

- [ ] **Step 4: Record changed files (no commit)**

`huly-migration/huly-selfhost/wedge.py`

---

### Task 7: Beta build and end-to-end verification

**Files:** none new. Uses `huly-migration/huly-selfhost/build-beta.sh`, `compose.override.beta.yml`, and the throwaway repro at `/tmp/claude-1002/-home-karthi-0008-dev-client-projects-huly-migration/67d06a5f-37fc-4a46-8fd3-5438c8d52e0c/scratchpad/repro-wedge.js` (tokens in `/tmp/claude-1002/-home-karthi-0008-dev-client-projects-huly-migration/67d06a5f-37fc-4a46-8fd3-5438c8d52e0c/scratchpad/tok-a`, `tok-b`; regenerate with `./run-tool-beta.sh generate-token admin@local yg` if expired).

- [ ] **Step 1: Full 5-image beta build**

Run: `cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost && ./build-beta.sh 2>&1 | tee .build-wedge-hardening.log | tail -20`
Expected: build succeeds and prints the "stack was RUNNING" instructions. Run the two commands it prints for recreate and nginx restart. **Skip `upgrade-workspace`** (no model change).

- [ ] **Step 2: Baseline, nothing broke**

Run the repro in both modes:
`TOK_A=$(cat tok-a) TOK_B=$(cat tok-b) N=6 ROUNDS=30 node repro-wedge.js | tail -1` and `... MODE=storm N=2 ROUNDS=15 GAP=3000 HANG_MS=45000 node repro-wedge.js | tail -2`
Expected: `RESULT: hung saves 0, slow bystander reads 0` both times.

- [ ] **Step 3: D + E under a real stall**

Pause the database while saves to one document are in flight:

```bash
cd /tmp/claude-1002/-home-karthi-0008-dev-client-projects-huly-migration/67d06a5f-37fc-4a46-8fd3-5438c8d52e0c/scratchpad
(TOK_A=$(cat tok-a) TOK_B=$(cat tok-b) N=3 ROUNDS=3 HANG_MS=90000 node repro-wedge.js > e2e.out 2>&1 &)
sleep 2; docker pause huly_v7-cockroach-1; sleep 75; docker unpause huly_v7-cockroach-1; sleep 20
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -p huly_v7 logs --since 3m transactor 2>&1 | grep -E "request hang found|tx-order wait timeout" | sed 's/\x1b\[[0-9;]*m//g' | grep -oE '"(message|stage|stageSec|openSpans|blockedBy)":("[^"]*"|\[[^]]*\]|[0-9]+)' | sort | uniq -c | head -20
cat /tmp/claude-1002/-home-karthi-0008-dev-client-projects-huly-migration/67d06a5f-37fc-4a46-8fd3-5438c8d52e0c/scratchpad/e2e.out | tail -5
```

Expected:
- `request hang found` lines now carry `"stage":"pipeline"` and an `openSpans` list naming the step (a database step for the first save, `tx-ordering-wait` for the ones behind it).
- At least one `tx-order wait timeout` with `blockedBy`.
- `e2e.out` shows `err:...still being processed` for queued saves (not `HANG`).
- After unpause, the stack recovers (a new repro run ends `hung saves 0`).

- [ ] **Step 4: C, the banner**

In a browser on beta (`http://localhost:8087`), logged in:
1. `docker pause huly_v7-transactor-1`, then click to open any issue. Expected: within about 35 s the banner "YG Portal isn't responding right now..." appears at the top.
2. `docker unpause huly_v7-transactor-1`. Expected: banner disappears within ~5 s of the first answered request; the issue opens.
3. Pause cockroach (not the transactor) with a tab already loaded, then reload: the hello is answered but `loadModel` waits on the database, so the banner appears over the loading screen after about 35 s. Unpause: loading completes and the banner goes. (Pausing the transactor itself blocks the hello, so nothing is pending and no banner shows; that case is covered by the maintenance page.)
4. With the transactor running normally, use the app for a few minutes. Expected: no banner.

If the page keeps loading after the rebuild without a banner, check for a stale service worker first (hard reload or incognito), per the known beta gotcha.

- [ ] **Step 5: Kill switch**

Set `TX_ORDER_WAIT_MS=0` for the beta transactor (env in `compose.override.beta.yml` under `transactor.environment`), recreate transactor + restart nginx, rerun Step 3. Expected: no `tx-order wait timeout` lines (old unlimited behaviour). Remove the env again and recreate.

- [ ] **Step 6: Hand off**

Report to the user: every changed file (Tasks 1-6), test counts per package, the Step 3 log excerpt, and banner screenshots or a description. The user commits in `yg-huly-beta` and later merges to `yg_develop` for prod (transactor restart: follow `docs/transactor-wedge-runbook.md` restart rules, WS-probe after).
