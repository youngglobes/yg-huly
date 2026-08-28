# AI Usage dashboard (ingest + reports) - design

Date: 2026-08-26
Branch: `yg_beta`
Status: approved design, not yet implemented

A third admin surface in YG Portal, next to the PM/TL/HR dashboards, showing where the
shared Claude Max plan actually goes: by account, device, project and model. A finished
machine-side collector already exists (`~/dev/claude-usage-fleet/yg-usage.sh`) and posts a
fixed schema-1 payload; this spec covers everything on the portal side of that POST.

---

## 1. What already exists (inputs, not decisions)

`yg-usage.sh` v1.0.0 reads Claude Code's own `~/.claude/projects/*.jsonl` logs on a machine
and POSTs a canonical payload. Its behaviour is fixed and must not be changed by this work.

| Property | Value |
|---|---|
| Endpoint | `POST <portal>/_usage/ingest`, `Authorization: Bearer $YG_USAGE_TOKEN` |
| Rescan window | `--days 3` rolling, snapped to a whole hour (`CUT = cut/3600*3600`) |
| Schedule | hourly, via Windows Task Scheduler (WSL cron does not survive a closed terminal) |
| Idempotency | "re-posting a window replaces it"; a machine offline for a week self-heals |
| Offline | payload queued under `~/.claude/yg-usage-queue/`, newest 200, flushed next run |
| Failure codes | `2xx` ok, `4xx` reject and drop, anything else retry later |

Payload (schema 1), abridged:

```json
{ "schema": 1, "collector": "yg-usage/1.0.0",
  "account": { "id": "<uuid>", "label": "...", "email": "..." },
  "machine": { "name": "KARTHI-WSL", "os": "wsl" },
  "generated_utc": "2026-08-26T04:00:00Z", "tz": "+0530",
  "window": { "from": 1755000000, "to": 1755259200, "days": 3 },
  "idle_sec": 300,
  "stats": { "kept": 812, "duplicates_dropped": 795 },
  "tokens":   [[hour, cwd, project_hint, surface, model, req, in, out, cache_w, cache_r]],
  "activity": [[hour, cwd, project_hint, surface, active_sec]],
  "sessions": [[id8, cwd, project_hint, surface, first, last, tokens]] }
```

Three properties of that payload drive this design and are quoted here so the reasons do
not get lost:

1. **Tokens are deduplicated by `(message.id, requestId)`.** Claude Code replays every
   message surviving a resume or compaction, so a naive count inflates ~2x, by a
   *different* factor per machine. `stats.duplicates_dropped` is reported so the portal can
   alert if dedup ever stops working.
2. **Active time partitions the timeline.** Each idle gap (<= `idle_sec`) is credited to
   the one project holding focus, so per-project hours sum to true wall-clock and are safe
   to invoice. Measuring per-project gaps independently inflated 52.5 h into 81.1 h on a
   real sample.
3. **Rows carry the RAW `cwd`.** Project to client mapping lives in the portal
   deliberately, so a client can be re-mapped once and applied retroactively without
   touching any machine. `project_hint` is a visibility fallback, not the mapping.

### Known limits, carried into the UI

- **Account is stamped at collection time** from `~/.claude.json`. Usage log lines carry no
  `accountUuid`, so accounts cannot be separated retroactively. The rolling rescan
  re-stamps rescanned days with whoever is logged in now.
- **Active hours and sessions have no per-model dimension.** Under a model filter, tokens
  and cost are exact but hours and sessions are the buckets that model ran in. The
  dashboard must say so.
- **5-hour windows are reconstructed** from activity gaps and approximate Anthropic's
  server-side reset clock rather than mirroring it.
- **Surfaces** come from the log's `entrypoint`; VS Code appears only once the extension is
  actually used on a machine.

---

## 2. How the existing dashboards work (survey result)

Recorded because it determined the placement decision.

**Registration.** One `workbench.class.Application` doc, alias `yg-dashboard`, `order: 1`,
no navigator and no specials, component `DashboardHome`
(`models/yg-timesheet/src/index.ts:436-450`).

**`DashboardHome.svelte` is a role router, not a tab bar.** It resolves three live queries
(my `WorkProfile.designation`, `ProjectApprovers` pm/teamLead arrays across all projects,
`HrData` space membership) plus `hasAccountRole(Maintainer)`, waits for all three so the
template never flashes the wrong dashboard, then `resolveDashboardRole()`
(`utils/dashboard.ts:192`) picks exactly one of `org | pm | teamLead | hr | employee`.
PM and HR are **mutually exclusive branches of one page**. There is no slot to add a third
one beside them.

The contrasting pattern is the HR app (alias `yg-hr`): a `navigatorModel.specials` array,
each special its own component with its own `accessLevel`.

**Gating.** Four mechanisms, unequal in strength:

| Mechanism | Where | Strength |
|---|---|---|
| `accessLevel: AccountRole.X` | `Workbench.svelte:164,495,531,665`, `Navigator.svelte:122`, `AppSwitcher.svelte:75` via `hasAccountRole` | client-side only, hides UI |
| `visibleIf: <predicate>` | same files | client-side only |
| per-account `HiddenApplication` docs from a server trigger | HR app icon | best-effort, user can un-hide |
| private space membership refused server-side | `HrTimeEntry` in `HrData` | the only real gate, and CLAUDE.md records even this leaks |

`AccountRole` is an ordered ladder: `ReadOnlyGuest < DocGuest < Guest < User < Maintainer <
Owner < Admin`. The HR app deliberately carries **no** `accessLevel`, because "is HR staff"
is space membership, not a rung on that ladder.

**Consequence for this feature.** "Admin only" here *is* a rung on the ladder, so
`accessLevel: AccountRole.Maintainer` is the correct nav gate. It is also worth nothing as
security. Since usage data will not live in Huly behind a space, the only enforcement is at
the HTTP API, and it has to be designed in.

---

## 3. Architecture: two planes

### 3.1 Decision: sidecar for data, fork for the page

Storing facts as Huly docs was rejected on measured load, not taste. The collector re-posts
a 3-day window hourly, and the ingest contract replaces that window.

| | Sidecar + SQLite | Facts as Huly docs |
|---|---|---|
| Stored rows/year | ~35k (tokens+activity+sessions), ~4 MB | same 35k docs |
| Writes/day | ~72 transactions (3 machines x 24 runs) | ~12,000 doc deletes + creates |
| Writes/year | ~26k transactions | ~4.5M tx of pure rewrite churn |
| Path | own process, own file | transactor, then Cockroach |
| Broadcast | none | every tx fans out to connected sessions |
| DB load added | zero on Cockroach | new domain on a DB capped at `--max-sql-memory=2GiB` |
| Index risk | own indexes, own file | ships with only the `("workspaceId", _id)` PK, so every filtered query full-scans until `perf-indexes.sql` is extended |
| Extra RAM | ~50 MB RSS | Cockroach working set grows on a box already swapping |

The decisive figure is churn, not volume: the same three days rewritten every hour forever,
through the component behind both the 2026-07-21 and 2026-07-23 outages, on a `parallel: 4`
queue, on a box running ~10-12 GB of workload on 7.6 GB.

Reading is the same story. Huly reads through live queries, so a year of history would sit
subscribed in every admin's browser. The sidecar answers one request with ~660 token rows
for the default 14-day window, under 200 KB of JSON, and nginx routes `/_usage` past the
front container entirely.

**Net portal impact: one extra ~50 MB process, zero extra Cockroach queries, zero extra
transactor traffic.**

The rule this follows: *anything a person creates and edits stays in Huly's docs; this is a
meter reading, so it gets its own container.*

### 3.2 The two planes

**Sidecar** - service `usage`, listening on `:4700`, behind nginx `location /_usage`,
exactly like `/_accounts`, `/_stats`, `/_rekoni` already are. Owns ingest, the SQLite
store, the mapping rules, and the report API. `node:24-alpine` with **zero npm
dependencies**: `node:sqlite` for storage, `node:http` for serving, `node:crypto` for JWT
verification. No native build, no rush project.

**Fork** - one new `workbench.class.Application`, alias `yg-ai-usage`,
`accessLevel: AccountRole.Maintainer`, with `navigatorModel.specials`: `usage` at `top` and
`config` at `bottom` with the setting icon. That is the pattern the Timesheet app already
uses for `ProjectApproversEditor`, so the config page needs no new concept. This adds **no
new image and no new rebuild**: the custom front image is already rebuilt per Huly version
for the timesheet stack.

### 3.3 Where the sidecar source lives

`huly-migration` (ops repo), at `huly-selfhost/usage-sidecar/`. Not `yg-huly/services/`,
because the fork's rush build is already capped at 2 workers specifically to stop it
freezing WSL, and a sixth project makes every future Huly-version rebuild slower and more
fragile. A zero-dependency Node file with a 10-line Dockerfile needs none of that
machinery.

Accepted cost: the API contract spans two repos. It is contained to two shapes, `POST
/_usage/ingest` (already fixed by the collector) and `GET /_usage/report` (pinned in
section 6), and the response types are duplicated in the plugin as a few dozen lines that
change only when a report changes.

---

## 4. Authentication

Two doors, deliberately unrelated.

### 4.1 Report and config endpoints (admins)

The page sends `getMetadata(presentation.metadata.Token)` as a Bearer token, exactly as
`plugins/ai-bot-resources/src/requests.ts` does today against the `ai-bot` sidecar. The
sidecar then:

1. **Verifies the JWT locally.** Huly tokens are HS256 via `jwt-simple`, signed with the
   stack's `SECRET` (`foundations/core/packages/token/src/token.ts`). Verify with
   `node:crypto`; reject on bad signature, `exp` in the past, or `nbf` in the future.
2. **Checks the workspace.** The decoded `workspace` claim must equal the configured
   `YG_USAGE_WORKSPACE` uuid. A valid token for some other workspace is not valid here.
3. **Resolves the role.** The token carries `account` and `workspace` but **not** role, so
   the sidecar calls the account service:
   `POST http://account:3000/` with header `Authorization: Bearer <token>` and body
   `{"method":"getLoginInfoByToken","params":{},"id":1}`. The `WorkspaceLoginInfo` result
   carries `role` (`foundations/core/packages/account-client/src/types.ts:68`).
   Require `Maintainer`, `Owner` or `Admin`.
4. **Caches** the token-to-role decision for 60 s, so the account service is not hit per
   request. Cache key is a hash of the token, never the token itself.

Failures return `401` with no detail. Nothing about which step failed leaks.

### 4.2 Ingest (machines)

No Huly identity at all. `Authorization: Bearer <device token>`, looked up by
`sha256(token)` in the `device` table, rejected if `revoked_at` is set. Tokens are generated
by the sidecar (32 random bytes, base64url), shown **once** at creation on the config page,
and stored only as a hash. `yg-usage.sh` needs no change: the token is still just a string
in `YG_USAGE_TOKEN`.

Rejections use the collector's own contract: `401`/`400` are `4xx`, which the collector
treats as "reject and drop, do not queue" - correct behaviour for a revoked device, since
queuing forever would be pointless.

### 4.3 Endpoint URL from the page

The page calls `${window.location.origin}/_usage/...`. Nothing is threaded through
`services/front` config generation or `dev/prod/src/platform.ts`, so no front-service change
is needed. A `localStorage.YG_USAGE_URL` override covers running the front dev server
against a sidecar on another port.

---

## 5. Store

```sql
device (
  id INTEGER PRIMARY KEY, label TEXT NOT NULL UNIQUE, token_sha256 TEXT NOT NULL UNIQUE,
  os TEXT, created INTEGER NOT NULL, last_seen INTEGER, revoked_at INTEGER )

account (
  uuid TEXT PRIMARY KEY, label TEXT, email TEXT,
  employee_ref TEXT, employee_name TEXT,          -- snapshot, see 7.2
  plan_cents INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER, last_seen INTEGER )

fact_token (
  hour INTEGER, device_id INTEGER, account_uuid TEXT,
  cwd TEXT, cwd_norm TEXT, hint TEXT, surface TEXT, model TEXT,
  req INTEGER, t_in INTEGER, t_out INTEGER, t_cw INTEGER, t_cr INTEGER,
  PRIMARY KEY (hour, device_id, cwd, surface, model) )

fact_activity (
  hour INTEGER, device_id INTEGER, account_uuid TEXT,
  cwd TEXT, cwd_norm TEXT, hint TEXT, surface TEXT, sec INTEGER,
  PRIMARY KEY (hour, device_id, cwd, surface) )

fact_session (
  session_id TEXT, device_id INTEGER, account_uuid TEXT,
  cwd TEXT, cwd_norm TEXT, hint TEXT, surface TEXT,
  first INTEGER, last INTEGER, tokens INTEGER,
  PRIMARY KEY (session_id, device_id) )

map_rule (
  id INTEGER PRIMARY KEY, prefix TEXT NOT NULL UNIQUE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('project','label')),
  project_id TEXT, project_name TEXT, label TEXT, updated INTEGER )

ingest_log (
  id INTEGER PRIMARY KEY, device_id INTEGER, account_uuid TEXT,
  win_from INTEGER, win_to INTEGER,
  n_tokens INTEGER, n_activity INTEGER, n_sessions INTEGER,
  dup_dropped INTEGER, received INTEGER )

CREATE INDEX ix_token_hour    ON fact_token(hour);
CREATE INDEX ix_activity_hour ON fact_activity(hour);
CREATE INDEX ix_session_first ON fact_session(first);
```

WAL mode, `synchronous=NORMAL`. File on a bind mount, added to the nightly S3 backup script.
Size lands in single-digit MB per year, so **no retention policy and no pruning**: history
is kept in full. If that ever changes, it becomes a `DELETE ... WHERE hour <` and nothing
else.

### 5.1 Path normalization

The same checkout has a different absolute path on WSL and on Windows. On ingest, `cwd_norm`
is `cwd` with a leading `/home/<user>`, `/Users/<user>`, `/c/Users/<user>` or
`C:\Users\<user>` rewritten to `~`, and backslashes folded to `/`. Rules match against
`cwd_norm`, so one rule covers both machines. The raw `cwd` is kept untouched alongside it
and is what the Unmapped list displays.

### 5.2 Ingest semantics: window replacement

Inside a single transaction, for the payload's device:

```
DELETE FROM fact_token    WHERE device_id = ? AND hour >= win_from AND hour < win_to;
DELETE FROM fact_activity WHERE device_id = ? AND hour >= win_from AND hour < win_to;
INSERT ... all rows from the payload
UPSERT  fact_session BY (session_id, device_id)        -- sessions extend, they do not vanish
UPDATE  device.last_seen; UPSERT account; INSERT ingest_log
```

Delete-then-insert, not upsert, because a bucket that legitimately disappears from a re-post
(a session was deleted, a dedup fix removed rows) must disappear from the store too. Plain
upsert would leave a ghost forever. This is the literal reading of the collector's
"re-posting a window replaces it" and is what makes a week-offline machine self-heal.

**Deletion is scoped by device, not by (device, account).** The collector re-stamps
rescanned days with whoever is logged in now, so scoping by account would leave a stale
duplicate of the same hours under the previous account, double-counting them. This is a
consequence of the collector's documented account limit, not a new one.

`win_from`/`win_to` come from `window.from`/`window.to` in the payload, which the collector
already snapped to a whole hour.

**Device identity is the token, never `machine.name`.** The payload's `machine.name` is
self-reported and two machines could collide on it (two `DESKTOP-ABC123`s, or one renamed
host). The `device_id` the facts are keyed by comes from the token row that authenticated
the request. `machine.name` and `machine.os` only refresh that row's `label` and `os` for
display, and a label change is therefore a rename, not a new device.

### 5.3 Validation on ingest

Reject with `400` (which the collector drops rather than queues) if: `schema != 1`; any
required top-level key missing; `window.to <= window.from`; the window is longer than 31
days; a row is not an array of the expected arity; a numeric field is not a finite
non-negative number; the payload exceeds 8 MB. Unknown extra keys are ignored, so a future
collector adding a field does not break ingest.

---

## 6. Report API

```
POST   /_usage/ingest                      device token
GET    /_usage/report?days=<1|7|14|30>     admin
GET    /_usage/config                      admin   rules + accounts + devices
POST   /_usage/config/rule                 admin   create or update by prefix
DELETE /_usage/config/rule/:id             admin
POST   /_usage/config/account/:uuid        admin   { employee_ref, employee_name, plan_cents }
POST   /_usage/config/device               admin   { label } -> { token } shown once
POST   /_usage/config/device/:id/revoke    admin
GET    /_usage/healthz                     unauthenticated, liveness only, no data
```

`GET /_usage/report` returns the merged fleet for the period, in the same tuple-array shape
`dashboard.template.html` already parses, with `acct` and `dev` columns added so it can
carry more than one payload:

```jsonc
{ "report_schema": 1,          // unrelated to the ingest payload's "schema": 1
  "tz": "+0530",                       // single display tz, configured, not per-payload
  "generated": 1756180000,
  "window": { "from": ..., "to": ..., "days": 14 },
  "accounts": [{ "uuid": "...", "label": "...", "employee_name": "...", "plan_cents": 20000 }],
  "devices":  [{ "id": 1, "label": "KARTHI-WSL", "os": "wsl", "last_seen": ... }],
  "idle_sec": 300,
  "stats": { "dup_dropped": 795, "stale_devices": ["SEVVEL-WSL"] },
  "tokens":   [[hour, acct, dev, project, cwd, surface, model, req, in, out, cw, cr]],
  "activity": [[hour, acct, dev, project, cwd, surface, sec]],
  "sessions": [[id, acct, dev, project, cwd, surface, first, last, tok]] }
```

`project` is the **already-resolved** mapped label, so the browser never sees a rule and a
re-map needs no client change.

**Only `days` is a server-side filter.** Account, device, project and model filtering all
happen in the browser over the returned rows, exactly as the standalone template does it
today. At the sizes involved (~660 token rows for 14 days, ~1,400 for 30) that is free, it
keeps filter changes instant with no round trip, and it means the ported aggregation code
does not have to be re-implemented server-side as well.

### 6.1 Mapping resolution

Read-time, in JS, not SQL. The rule set is tens of rows and the distinct `cwd_norm` values
in any window are tens more, so the sidecar loads rules sorted by `prefix.length`
descending and resolves each distinct path by first match. Sub-millisecond, and obviously
correct in a way clever SQL would not be.

- `target_kind = 'project'` resolves to `project_name` (the snapshot).
- `target_kind = 'label'` resolves to `label`.
- No match resolves to `Unmapped`, and the row keeps its raw `cwd` so the config page can
  offer a one-click map.

Facts are stored raw and no rule is consulted at write time. Editing a rule therefore
changes every historical report on the very next request, with no migration and no data
rewrite. That retroactivity is the whole reason the collector sends raw `cwd`.

### 6.2 Direction of the Huly coupling

One-way, by design. The config page sends `project_id` **and a `project_name` snapshot**
when a rule is saved. The sidecar never opens Huly's database, holds no DB credentials,
couples to no Huly schema, and adds no queries to the capped Cockroach. It stores an id and
a string. If the project is later renamed or deleted, reports still render from the
snapshot and the config page flags the rule as stale.

---

## 7. UI

### 7.1 Dashboard special (`usage`)

The four reports and the account / device / project / model / period filters from
`dashboard.template.html`, unchanged in behaviour: **project ledger**, **5-hour session
blocks**, **terminal vs VS Code**, **models used**, plus the six stat tiles.

The aggregation (list-price weighting, rollups, 5-hour window reconstruction, the
share/cost denominator rule) is ported near-verbatim from the template, because that is
where it is already correct, and moves into `utils/ai-usage.ts` as pure functions with jest
tests. That matches how `utils/dashboard.ts` and `utils/hr-dashboard.ts` are already
structured and tested in this plugin.

Three deliberate deltas from the template:

1. **Period** gains `30d` alongside `24h / 7d / 14d`, and drives the fetch rather than a
   client-side slice of one payload.
2. **Plan fee** is no longer a number input on the page. It comes from `account.plan_cents`
   set on the config page, so the Cost column reads the same for everyone who opens it.
3. **5-hour blocks under "All accounts"**. The limit window is per Anthropic account, so
   merging two accounts into one block table is meaningless. With more than one account and
   none selected, that section asks for an account instead of showing a wrong number. The
   other three reports merge across accounts correctly.

Two invariants carried straight from the template and not to be "simplified" later:

- **The share and cost denominator is the selected account's whole period, not the filtered
  subset.** Renormalising inside a filter makes any single project look like it consumed
  the entire plan fee.
- **The model-filter footnote stays.** Under a model filter, hours and sessions are the
  buckets that model ran in, not time spent on that model. Tokens, weighted and cost are
  exact.

The template's palette maps onto Huly's theme variables so the page is not an alien island
in dark mode. Structure, copy and footnotes carry over as they are.

A stale-device warning surfaces `stats.stale_devices` (no payload in over 24 h) as a banner,
because silent collector failure is the known operational hazard and the ops repo has been
bitten by exactly that before.

### 7.2 Config special (`config`)

One special, three panels.

**Mapping.** Rules as `prefix -> target`. Target is either an existing tracker Project
(picked with the same project picker the Timesheet Reports page uses) or a free-text bucket
(`Internal`, `R&D`, `Learning`). Below the rules, the **Unmapped** list: every distinct raw
path in the current period with no rule, its token volume, and a one-click "map this" that
prefills the prefix. A new project is therefore visible the day it appears rather than
pooling silently into "other".

**Accounts.** Every Claude account seen in ingested payloads, with the portal employee it is
linked to (a contact picker; `employee_ref` plus an `employee_name` snapshot, same one-way
coupling as rules) and its monthly plan fee. An unlinked account still appears, labelled
with its Claude display name.

**Devices.** Add a device (returns the ingest token, displayed once, with a copy button and
an explicit "this is shown only once" notice), see `last_seen` with a stale marker, revoke.

---

## 8. Files touched

**yg-huly (`yg_beta`)**

| File | Change |
|---|---|
| `models/yg-timesheet/src/index.ts` | one `workbench.class.Application` doc, alias `yg-ai-usage`, `accessLevel: AccountRole.Maintainer`, two specials |
| `plugins/yg-timesheet/src/index.ts` | 2 component ids, new `IntlString`s |
| `plugins/yg-timesheet-resources/src/index.ts` | register both components |
| `plugins/yg-timesheet-resources/src/components/AiUsage.svelte` | dashboard shell, fetch + filters |
| `plugins/yg-timesheet-resources/src/components/aiusage/*.svelte` | filter bar, tiles, four report tables |
| `plugins/yg-timesheet-resources/src/components/AiUsageConfig.svelte` | three config panels |
| `plugins/yg-timesheet-resources/src/utils/ai-usage.ts` | pure aggregation, ported from the template |
| `plugins/yg-timesheet-resources/src/utils/ai-usage-api.ts` | fetch helpers, Bearer token |
| `plugins/yg-timesheet-resources/src/__tests__/ai-usage.test.ts` | jest |

**huly-migration (ops)**

| File | Change |
|---|---|
| `huly-selfhost/usage-sidecar/server.js` | the whole service |
| `huly-selfhost/usage-sidecar/schema.sql` | section 5 |
| `huly-selfhost/usage-sidecar/Dockerfile` | `node:24-alpine`, copy, `CMD node server.js` |
| `huly-selfhost/usage-sidecar/test/*.test.js` | `node:test` |
| `huly-selfhost/compose.override.beta.yml` | `usage` service + bind mount |
| beta nginx conf | `location /_usage` |
| `notes/ai-usage-runbook.md` | enroll a device, rotate a token, restore the DB |

Sidecar environment: `YG_USAGE_DB`, `YG_USAGE_PORT` (4700), `SECRET` (same as the stack),
`YG_USAGE_WORKSPACE` (the `yg` workspace uuid), `ACCOUNTS_URL` (`http://account:3000`),
`YG_USAGE_TZ` (`+0530`).

---

## 9. Testing

**Fork (jest, matching the existing pattern).** All aggregation is pure and tested in
isolation from queries and rendering: weighting at list price, project rollup, the
denominator rule under a filter, 5-hour window reconstruction including a session alive
across several windows, surface rollup, empty-state handling.

**Sidecar (`node:test`).**

- Ingest idempotency: post the same payload twice, row counts identical.
- Window replacement: a bucket present in post 1 and absent in post 2 is gone after post 2.
- Self-heal: post a 3-day window after a 7-day gap, nothing outside the window is touched.
- Cross-account restamp: same device, second payload with a different account uuid, no
  duplicated hours.
- Mapping: longest-prefix wins; home-path normalization matches the WSL and Windows form of
  one path; no rule resolves to `Unmapped` with the raw path intact; editing a rule changes
  a historical report with no data write.
- Validation: each `400` case in 5.3.
- Auth, one test per rejection: bad signature, expired, wrong workspace, `User` role,
  unknown device token, revoked device token.

**End to end.** Run `yg-usage.sh --post` at a local sidecar, then render the same
`facts.json` through `build-dashboard.sh` and through the portal page, and compare number
for number. **That comparison is the acceptance test** for the port: the standalone
template is the reference implementation, and any divergence is a bug in the port until
proven otherwise.

---

## 10. Rollout

Beta first. Build on `yg_beta`; run the sidecar against the local beta stack via
`compose.override.beta.yml` and the beta nginx; point the collectors at the beta URL and
collect real payloads for about a week. Then move to production in the same batch merge as
the other `yg_beta` work, adding the sidecar to the production compose and nginx and
re-pointing the Task Scheduler entries.

This respects the rule in the ops repo's `CLAUDE.md` that `yg_beta` is local/demo and is
never merged to `yg_develop` on its own, and it means a new public POST endpoint is not
exposed on the live portal until the schema has seen real traffic.

Production checklist, for the merge:

- `location /_usage` added to the production `.huly.nginx`, and **nginx restarted** (it
  resolves compose service names once at startup, per the 2026-07-23 ops rules).
- The SQLite file's bind mount added to `s3-backup.sh`.
- Device tokens re-issued for production; the beta tokens are not carried over.
- `SECRET` and the workspace uuid come from the production `huly_v7.conf`, not copied.

## 11. Out of scope

Alerting or email on a stale device (the banner is enough for now); per-project budgets or
limits; anything that writes back into Huly; a public or non-admin view; ingesting anything
other than Claude Code usage; changing `yg-usage.sh`.
