# Transactor wedge hardening: diagnostics, same-document timeout, "server not responding" banner

Status: draft for review (2026-09-30). Branch: `yg_beta` first, then `yg_develop` (prod) after a beta soak.
Ops side (alert, recovery script, maintenance page) already shipped in `huly-migration`:
`docs/transactor-wedge-runbook.md`, `notes/incident-2026-09-30-transactor-wedge.md`.

## Why

Twice (2026-07-23, 2026-09-30) the whole portal froze: every user spun after login until an
account was evicted and the transactor restarted. On 30 Sep that cost 93 minutes and lost saves.

What is known (spike, 2026-09-30):

- One save never finishes. Both times it was a `workbench:class:WorkbenchTab` location update,
  sent while one account's browser reconnected many tabs at once (12 sessions in 22 s).
- Saves to the same document are serialized by `TxOrderingMiddleware`
  (`foundations/server/packages/middleware/src/txOrdering.ts`). A save waits, **without limit**,
  for the previous save to the same document. So one stuck save makes every later save to that
  document stick too. That explains 29 Sep: one account stuck for 24 h, everyone else fine.
- The "4 request slots" theory from the 23 Jul note is wrong: `parallel: 4` is
  `os.availableParallelism()`.

What is NOT known:

1. Why the first save never finishes. Not reproducible on beta (180 concurrent same-doc saves; a
   17-session reconnect storm: all fine). Likely needs prod conditions (memory pressure).
2. What turned one account's stuck chain into a company-wide freeze on 30 Sep.

The server's hang warning (`sessionManager.ts`, `request hang found`) says *that* a request is
stuck, never *where*. Without that, any general "request time limit" (option 3a) would be a guess
about which await to bound.

## Goals

- **D. Diagnostics:** the next time a request sticks, the log says where it is stuck.
- **E. Same-document timeout:** a save stuck behind another save fails after a bounded wait
  instead of hanging forever, so one bad save cannot pile up an unbounded chain.
- **C. Honest banner:** when the server stops answering, the browser says so and asks people not
  to refresh, instead of an endless spinner.

## Non-goals

- Fixing the root cause of the first stuck save (needs D's output first).
- A general request time limit (3a). Revisit with D's data.
- Changing any data model. No migration, no `upgrade-workspace`.

## D. Where is a request stuck?

Two levels, both logging only.

**D1. Request stage (coarse).** `SessionRequest` (`foundations/server/packages/core/src/types.ts`)
gets an optional `stage: string` and `stageAt: number`. `handleRequest` in `sessionManager.ts`
sets it as the request moves on:

| stage | set just before |
|---|---|
| `backpressure` | `await ws.backpressure(...)` |
| `workspace` | `workspace.with(...)` (waiting for the pipeline) |
| `pipeline` | the method call inside `workspace.with` |

The same for `handleRPC` (REST path). The `request hang found` warning adds `stage` and
`stageSec`. This alone answers unknown 2: if victims are stuck in `workspace`, the freeze is
workspace-wide pipeline access; if in `pipeline`, it is deeper.

**D2. Open spans (fine).** Every server step already runs inside `ctx.with('<name>', ...)`, and
all child contexts of one request share the same `contextData` object
(`MeasureMetricsContext.newChild`). `handleRequest` puts an array `yg_openSpans` on the request's
`contextData`; `MeasureMetricsContext.with` pushes `{ name, start }` when that array exists and
removes the entry in its existing `finally`. Contexts without the array (everything else,
including the front bundle) behave exactly as today: one property check per `with`.

The hang warning adds `openSpans`: the deepest 8 entries as `name@ageSec`, e.g.
`["🧨tx@95", "tx-ordering-wait@94"]` or `["🧨tx@95", "domain-tx@95", "postgres-update@95"]`.
That answers unknown 1 on the next occurrence.

Guardrails: cap the array at 64 entries (stop pushing beyond; never grows without limit); if
`contextData` is replaced mid-request the tracking just goes quiet, it never throws.

`huly-migration/huly-selfhost/wedge.py` parses the warning; extra fields are ignored by it, and its
report will print `stage`/`openSpans` when present (small follow-up in that repo).

## E. Same-document wait gets a limit

In `TxOrderingMiddleware.tx`, `await Promise.all(waitPromises)` becomes a race against a timer of
`TX_ORDER_WAIT_MS` (env, default `30000`; `0` = old unlimited behaviour, the kill switch).

On timeout:

1. Log `warn 'tx-order wait timeout'` with the doc id, this tx's ids, the blocking entry's tx ids
   and its age (evidence for D).
2. Resolve and remove this tx's own queue entries, exactly as the existing `finally` does, so
   saves queued behind it are not stranded.
3. Throw `PlatformError(unknownError('Previous change to this document is still being processed'))`.
   The client gets an error for that save (as for any failed save) instead of waiting forever.

Why fail instead of proceeding: proceeding would break the ordering guarantee the middleware
exists for. Failing is the conservative choice; the user retries, or for tab state nothing visible
happens.

Tx log side effect: the transaction log middleware (TxMiddleware, `server/server-pipeline/src/pipeline.ts`)
runs BEFORE the ordering middleware, so a save that fails on the wait limit has already been written to
the tx log (DOMAIN_TX) without being applied to the document. This was already true for any downstream
failure and for today's forever-hung saves; E makes it routine while a blocker hangs (one row per failed
follower). Harmless for WorkbenchTab; model transactions are replayed from the tx log at load, so a failed
model tx would take effect on the next load. Action before prod: confirm none of our tooling (backfill
scripts, AI-usage sidecar) treats DOMAIN_TX rows as applied changes.

What E does not do: the first stuck save stays stuck (unknown 1). E stops the pile-up behind it and
turns silent forever-waits into logged, bounded errors.

The wait itself runs inside `ctx.with('tx-ordering-wait', ...)` so D2 shows it by name.

## C. "Server not responding" banner

**Detection, in `plugins/client-resources/src/connection.ts`:** the client already keeps every
pending request with its `startTime` (`RequestPromise`). On the existing timer tick, compute:

- `oldest`: age of the oldest pending request, ignoring `ping`;
- `lastAnswer`: time of the last response to any non-ping request.

Requests enter the client's pending list only after hello; if the transactor is fully unreachable (no hello)
the banner does not show (that case is covered by the maintenance page and the ops alert).

The server is **stalled** when `oldest > 30 s` AND `now - lastAnswer > 30 s`. The second condition
matters: pings are answered even during a wedge, and one legitimately slow request (an export)
while others are answered is not a stall. **Recovered** when any non-ping response arrives or no
request is pending.

The connection publishes changes (not every tick) as a browser event
`window.dispatchEvent(new CustomEvent('yg:server-stall', { detail: { stalled, sinceMs } }))`.
A DOM event keeps `client-resources` free of any new UI dependency.

**Display:** a small `ServerStallBanner.svelte` in `workbench-resources`, mounted in
`WorkbenchApp.svelte` so it is visible both on the post-login loading screen (where people were
stuck on 30 Sep) and inside the app. Fixed at the top, YG yellow accent, not dismissable while the
stall lasts, disappears on recovery. Text (plugin strings, English):

> **YG Portal isn't responding right now.** Please don't refresh: keep this tab open, and changes
> you just made will be sent when it's back.

(Amended while planning: no "We've been alerted". A legitimate cold model load can exceed 30 s
with nothing answered, and no alert fires in that case.)

Basis for "will be sent": the 30 Sep logs show a browser re-sending the same pending save (same tx
`_id`) after reconnecting; a refresh discards that queue.

## Testing

- **D:** unit test that `with` records and clears spans only when `yg_openSpans` exists, including
  on rejection and the 64 cap. On beta: add a temporary test-only middleware delay (env-guarded,
  not shipped) or use E's wait to force a >30 s hang and check the warning carries
  `stage`/`openSpans`.
- **E:** extend `middleware/src/tests/txOrdering.test.ts`: stuck predecessor + timeout ⇒ error
  thrown, entry removed, third tx behind it proceeds; `TX_ORDER_WAIT_MS=0` ⇒ unchanged behaviour;
  normal ordering tests still pass.
- **C:** unit test for the stall predicate (pending/answered timelines incl. ping-only and one slow
  request). On beta: pause the transactor container (`docker pause`) with a tab open and on the
  login screen: banner within ~35 s; `docker unpause`: banner gone, a save made during the pause
  lands.
- Regression: run the existing `repro-wedge.js`-style load (in scratch) to confirm no slowdown.

## Rollout

1. Implement on `yg_beta`, full 5-image beta build (`huly-selfhost/build-beta.sh`; D/E are server,
   C is front). No workspace upgrade needed (no model change).
2. Beta checks above; soak a few days.
3. Merge to `yg_develop` (CI builds and deploys prod). Deploy = transactor restart: follow the
   runbook order, WS-probe after.
4. After the next WARNING alert on prod, read `openSpans` and write the root-cause fix (and decide
   on 3a) as a separate spec.

## Risks

- D2 touches `foundations/core/packages/measurements`, used everywhere. Mitigated: opt-in by a
  field only the transactor's request handler sets; one property check otherwise.
- E changes behaviour for saves queued behind a stuck save (error instead of hang). Kill switch
  `TX_ORDER_WAIT_MS=0`.
- C false positives on very slow networks: both conditions must hold for 30 s; the text does not
  blame the user's network or ask them to do anything but wait.
- Carrying these patches on each Huly version bump (same as our other `foundations/` patches).
