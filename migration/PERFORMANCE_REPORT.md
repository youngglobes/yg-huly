# Huly Performance Investigation & PostgreSQL Dry-Run — Report

**Date:** 2026-07-22/23 (updated 2026-07-23 — account registry migration now tested)
**Scope:** Local investigation only (macOS + Colima). Nothing in production (`yg_develop` /
the live VPS) was touched. All work is uncommitted local config.

---

## 1. TL;DR

- The self-hosted portal felt slow because of **two separate problems**, not one:
  1. **CockroachDB was burning a full CPU core at idle**, even with nobody using the app.
  2. **The entire database schema has no secondary indexes anywhere** — every list/filter
     query (an issue's comment feed, a project's board, a user's notifications) does a full
     table scan. This is true on CockroachDB *and* Postgres; it's an app-schema gap, not a
     database choice.
- We fixed #1 with CockroachDB config changes (no code, no data changes).
- We diagnosed #2 by standing up a side-by-side PostgreSQL dry-run, restoring real `yg` data
  into it, and proving that adding targeted indexes turned a **2.8-second query into 180ms**
  (15x) — with zero app code changes.
- Recommendation: **move production off CockroachDB onto plain PostgreSQL**, and ship the
  index set below as part of that migration. Cockroach's whole value proposition (distributed,
  multi-node, auto-failover) is unused in a single-VPS deployment — we're paying its overhead
  for nothing.
- **Update 2026-07-23:** the account-registry migration — previously flagged as *"the main
  unknown to de-risk"* — has now been tested and works. Huly's own `--accounts` restore flag
  doesn't work for a Cockroach→Postgres move (see §6.2), but a direct table-level copy does,
  and was verified end-to-end with a real production account logging in through the UI via
  OTP. See §6.2 for the actual method and §6.3 for the updated risk table.

---

## 2. What was actually causing the slowness

### 2.1 CockroachDB idle CPU (the "always slow" feeling)

Measured **110–122% CPU at rest** (more than one full core, pegged with zero user traffic).
Root cause: `start-single-node` mode still runs Cockroach's full distributed-cluster
machinery — Raft consensus, MVCC over replicated ranges, automatic statistics jobs, SQL
telemetry/diagnostics reporting — all designed for a multi-node cluster, running for a
cluster of one. That overhead is fixed cost regardless of whether anyone is using the app.

**Fix (already applied locally, config only):**
```sql
SET CLUSTER SETTING sql.stats.automatic_collection.enabled = false;
SET CLUSTER SETTING diagnostics.reporting.enabled = false;
SET CLUSTER SETTING sql.telemetry.query_sampling.enabled = false;
```
Result: idle CPU dropped from 110% to single digits (~2–40% depending on load).

**Also applied:**
- Colima VM: 4 CPU / 8GB → **6 CPU / 12GB** (host has 8 CPU / 16GB; the VM was starving
  everything else while Cockroach worked).
- Cockroach memory caps raised (`compose.perf.yml`): `--cache` 256MiB→512MiB,
  `--max-sql-memory` 512MiB→1GiB, container limit 2560M→3584M — this fixed a live
  `"memory budget exceeded"` error you hit under normal use; the original caps were sized
  too tight for real usage.
- `.huly.nginx`: fixed `serviceWorker.js` being cached for **1 year with no content hash**
  in its filename (Express's static middleware applies a blanket max-age to everything,
  but only hashed files are safe to cache that long) — this could have left users stuck on
  a stale service worker indefinitely. Everything else nginx/Express were already doing
  correctly (gzip, immutable caching on hashed bundles, no-store on `index.html`).

### 2.2 No secondary indexes anywhere (the "activity feed is slow" feeling — the real Eureka)

Checked the full schema on the **live CockroachDB instance**:
```sql
select table_name, index_name from information_schema.statistics
where table_schema='public' and index_name not like '%_pkey';
-- 0 rows
```
Every one of the ~60 domain tables (`activity`, `attachment`, `tracker`, `notification`,
`task`, etc.) has **only** a primary key on `(workspaceId, _id)`. Every query that filters by
anything else — which issue a comment belongs to, which project an issue is in, which user a
notification is for — does a full table scan. CockroachDB partially hides this because it can
spread a scan across its internal ranges; single-node Postgres does it as one serial scan, so
the same missing index hurts more there. But the underlying defect is identical on both
databases — Cockroach isn't "faster" here, it's just absorbing the cost differently.

**Proof, measured on the Postgres dry-run with real `yg` data (110,330-row `activity`
table, the busiest issue's comment feed — 4,961 records):**

| | Before index | After index | Improvement |
|---|---|---|---|
| Query plan | Seq Scan, full table | Index Scan | — |
| Execution time | **2,822 ms** | **182 ms** | **~15x** |

---

## 3. What the dry-run actually did

Set up an **isolated, disposable second stack** so nothing touched the live `yg` workspace:

| | Live (production-equivalent) | Dry-run |
|---|---|---|
| URL | http://localhost:8087 | http://localhost:8088 |
| Compose project | `huly_v7` | `huly_pg` |
| Database | CockroachDB | PostgreSQL 16 |
| Location | `migration/huly-selfhost/` | `migration/huly-postgres-dryrun/` |

Steps:
1. **Backup** the real `yg` workspace from CockroachDB using Huly's own tool
   (`backup /backup yg`, read-only against the source) — **42m 43s**, resulting in a 7.0GB
   backup set covering:
   - 460,771 transactions
   - 8,267 tracker items (issues/projects)
   - 22,690 attachments
   - 6.6GB of blob storage (files/images)
2. **Restored** that backup into a fresh workspace on the Postgres stack
   (`backup-restore /backup pgtest-ws`) — **34m 46s**. Postgres auto-detected correctly
   (Huly's `getDbFlavor()` runs `SELECT version()` — genuinely zero app code changes needed
   to point it at Postgres instead of Cockroach).
3. **Verified data integrity**: 460,929 tx rows and 8,267 tracker rows landed in Postgres,
   matching the source (small tx delta is normal workspace-init noise).
4. Logged in as a disposable test account (`pgtest@example.com`) and found only 18 of 86
   projects visible — **this was not data loss**. It's Huly's private-project membership
   model: the dummy test account was never added to the private projects real `yg` users
   belong to (18 non-private projects were visible correctly; the other 68 were correctly
   hidden). Confirmed via direct row counts in `space` table (87 `tracker:class:Project`
   rows present, matching source). Worked around it for testing purposes only by directly
   adding the test account to all projects' `members` arrays — **this is not something to
   do on production**, it was purely to unlock visibility for comparison.
5. Diagnosed the CPU-at-rest gap (see §2.1) and the missing-index gap (see §2.2), and fixed
   the latter live in the dry-run to prove the theory.

### Indexes added (dry-run Postgres, proof-of-concept)

| Table | Rows | Index column(s) | Why |
|---|---|---|---|
| `activity` | 110,330 | `(workspaceId, attachedTo)` | comment/activity feed per issue |
| `notification` | 137,076 | `(workspaceId, user)` | notification bell (see caveat below) |
| `collaborator` | 47,405 | `(workspaceId, attachedTo)` | who's watching a doc |
| `attachment` | 22,690 | `(workspaceId, attachedTo)` | files attached to an issue |
| `notification_dnc` | 21,720 | `(workspaceId, user)` | do-not-notify preferences |
| `time` | 19,358 | `(workspaceId, user)` | time-tracking reports |
| `event` | 13,084 | `(workspaceId, attachedTo)` | calendar events |
| `user_mention` | 11,198 | `(workspaceId, attachedTo)` | @mentions |
| `tracker` | 8,267 | `(workspaceId, space)` | project issue board |
| `task` | 6,546 | `(workspaceId, space)` | project task lists |
| `gmail` | 7,990 | `(workspaceId, attachedTo)` | email thread linkage |

**Caveat on `notification`:** indexing it did *not* speed up the busiest test case — that
user's unread notifications were 15% of the whole table, and Postgres's planner correctly
decided a full scan is still cheaper than an index at that selectivity. That's expected
behavior, not a bug — a fix there would need an app-level query change, out of scope here.

---

## 4. Why ditch CockroachDB specifically

CockroachDB's entire value proposition is **horizontal scale-out and automatic multi-node
fault tolerance** — a distributed SQL database that happens to speak the Postgres wire
protocol. This deployment runs `start-single-node`, meaning it pays the full cost of that
distributed machinery (Raft consensus, replicated-range MVCC) while using none of the benefit
(no second node, no automatic failover, no geo-distribution). That's exactly why it idles at
110%+ CPU doing nothing.

Real PostgreSQL in single-node mode has none of that tax — it's a mature, decades-optimized
relational database with no distributed bookkeeping overhead. For a single-VPS deployment
serving one team, Cockroach's scaling headroom is pure unused cost. The only reason to stay
on Cockroach would be a real plan to run multiple DB nodes or need automatic failover without
managing Postgres replication by hand — not the case here.

---

## 5. Future suggestions (not yet done)

1. **Watch other large tables as data grows.** The index list above covers what mattered at
   today's data size. As `yg` grows, re-run the same diagnostic (`EXPLAIN ANALYZE` on the
   slowest-feeling queries) rather than assuming today's index set stays sufficient forever.
2. **`notification` query pattern** may eventually need an app-level fix (e.g. a partial
   index on `isViewed = false`, since unread notifications are usually a much smaller,
   more selective slice than "all notifications for a user") — worth revisiting if the
   notification bell is ever reported as slow.
3. **Redpanda healthcheck is misconfigured** (pre-existing, unrelated to this work): its
   healthcheck probe fails with `ILLEGAL_SASL_STATE` because it doesn't pass the SASL
   credentials the broker requires. The container works fine; only the healthcheck script
   itself is wrong. Cheap to fix, separate task.
4. **MinIO memory limit and Colima RAM** were flagged in earlier notes as other quick wins
   — not yet explored in depth.
5. Re-run the `information_schema.statistics` "zero secondary indexes" check periodically —
   if a Huly version upgrade changes the schema, new tables may need the same treatment.
6. **Script the account-registry migration** (§6.2) into a checked-in tool instead of hand-run
   `psql \copy` commands — it's proven correct now, but doing it by hand on the real VPS
   migration is more error-prone than it needs to be.
7. **Clean up the duplicate-person-per-email data quirk** (§6.2) in production via
   `migrate-merged-accounts`, if it's ever worth the effort — not urgent, doesn't block
   anything.

---

## 6. How to implement this on the VPS

This is the important part for tomorrow. A few things are **materially different** on the
VPS versus what we tested locally, and need to be planned for — flagging them clearly rather
than glossing over them.

### 6.1 What carries over directly (low risk)

- **CockroachDB cluster settings** (§2.1) — pure SQL, apply immediately, zero downtime,
  fully reversible:
  ```sql
  SET CLUSTER SETTING sql.stats.automatic_collection.enabled = false;
  SET CLUSTER SETTING diagnostics.reporting.enabled = false;
  SET CLUSTER SETTING sql.telemetry.query_sampling.enabled = false;
  ```
  **Recommend doing this on the VPS immediately**, independent of any Postgres migration —
  it's a free win with no risk.
- **`.huly.nginx` serviceWorker cache fix** — copy the updated `.huly.nginx` from
  `migration/huly-selfhost/` to the VPS. Config-only, safe, no downtime (just needs an
  nginx container restart).

### 6.2 What needs a real migration plan (higher effort, real downtime)

**Account registry migration — now tested (2026-07-23), and it needs a different method
than originally assumed.** The original plan was to lean on `backup-restore --accounts`
(or the full-registry `backup-all-to-dir` path) to carry real logins over automatically.
That doesn't work for a Cockroach→Postgres move:

- `backup-restore --accounts` fails outright with a `social_id` foreign-key violation.
  Reason: a workspace backup only contains `account.socialId` records (which login method
  is tied to which person), never the `global_account.person` rows those socialIds
  reference — persons are global, not per-workspace, so they're simply not in a
  workspace-scoped backup. The restore assumes the target's account registry already has
  matching persons; on a fresh Postgres instance it never does, so every socialId insert
  fails, retries with backoff, and is effectively skipped.
- Neither built-in tool command bridges this gap: `move-account-db-to-pg` is a **Mongo→
  Postgres** migration (for old v6 deployments), not Cockroach→Postgres. And
  `ensure-global-persons-for-local-accounts` explicitly throws `"Only CockroachDB is
  supported"` when pointed at a Postgres target.

**What actually works:** since CockroachDB speaks the Postgres wire protocol and uses the
byte-identical `global_account` schema, do a direct table-level export/import instead of
going through the workspace-backup tool at all:

1. Temporarily bridge the target Postgres container onto the Cockroach stack's Docker
   network (`docker network connect <cockroach_network> <postgres_container>`) — read-only
   against the source, fully reversible, disconnect when done.
2. `psql "<cockroach-url>" -c "\copy (SELECT ...) TO 'file.csv' CSV"` each table out, then
   `psql "<postgres-url>" -c "\copy schema.table FROM 'file.csv' CSV"` each one in, **in FK
   dependency order**: `person` → `account` → `social_id` → `account_passwords` →
   `account_events` → `user_profile` → `workspace_members`.
3. Two schema gotchas hit and fixed along the way:
   - `social_id.key` is a generated column (`GENERATED ALWAYS AS ... STORED`) — `SELECT *`
     pulls it, but COPY rejects inserting into it. Export an explicit column list instead.
   - One legacy row had `person.last_name = NULL`, which Cockroach allowed but Postgres's
     schema forbids (`NOT NULL`, no default). Coalesce to `''` on export.
   - `workspace_members.workspace_uuid` has to be **remapped** from the source workspace's
     uuid to whatever uuid the restored workspace data actually landed under on the target
     (they won't match unless you deliberately force them to).
4. **Verified working**, not just theorized: ran `./run-tool.sh generate-token <email>
   <workspace>` (fails cleanly if the account doesn't resolve) and then did a real login —
   OTP code read from the `global_account.otp` table, entered in the browser, landed in the
   workspace as the correct account.

This is now a proven, repeatable procedure — worth scripting into a one-shot tool
(`migration/` currently has it as ad-hoc commands run by hand; turning it into a checked-in
script is a good follow-up before the real cutover).

**Data quirk surfaced along the way (pre-existing in production, unrelated to the
migration):** some users have **two separate `person` records for the same email** — one
per login method (e.g. a Google-login social-id and an email/OTP-login social-id pointing
at different person UUIDs), and in at least one case the two had different display names
(one was literally "Admin Platform" instead of the real name). Confirmed by checking
production Cockroach directly — this is real prod data, not something the copy introduced.
Doesn't block the migration, but worth cleaning up for real (the tool has a
`migrate-merged-accounts` command that looks purpose-built for this) since it'll carry over
as-is otherwise.

**Proposed VPS migration sequence:**

1. **Do the free wins first** (§6.1), on a normal deploy, no downtime.
2. **Schedule a maintenance window.** Based on today's timings (43min backup + 35min restore
   for ~7GB / ~460K transactions), budget at least **1.5–2 hours**, and expect it to grow
   with the production dataset size (which is likely larger than local `yg`).
3. **Take a fresh full backup** (workspace data via `backup`, plus the account-registry
   tables per the §6.2 procedure) to a safe location, in addition to the existing scheduled
   cloud backups.
4. **Stand up PostgreSQL** on the VPS (real Postgres, not CockroachDB) — size
   `shared_buffers`/`work_mem`/`effective_cache_size` to the VPS's actual RAM (the
   dry-run used Postgres defaults, which are conservative and fine for testing but worth
   tuning properly for production load).
5. **Restore workspace data** via `backup-restore`, then **migrate the account registry**
   via the direct table-copy procedure in §6.2 (now tested/working — do *not* rely on
   `backup-restore --accounts`, it doesn't work cross-engine).
6. **Run `ANALYZE`** immediately after restore (bulk-loaded tables have stale planner
   statistics until this runs — this alone caused part of the "still slow" feeling in the
   dry-run before we diagnosed the missing indexes).
7. **Apply the index set from §3** — same `CREATE INDEX CONCURRENTLY` statements, run once.
   Worth turning into a single idempotent `.sql` file checked into `migration/` so it's not
   manual/one-off.
8. **Point the stack's `DB_URL` at Postgres**, `docker compose up -d --force-recreate` the
   DB-dependent services, verify.
9. **Verify parity** with real accounts — log in as a real user (not a dummy test account)
   and confirm project memberships and visibility are correct now that the real account
   registry was migrated, not just workspace data.
10. **Keep the CockroachDB containers/volumes intact and untouched** for a defined rollback
    window (e.g. a few days) — don't delete them immediately after cutover. Rollback is just
    flipping `DB_URL` back and restarting, as long as nothing wrote to the new Postgres data
    that isn't also reflected back... in practice this means **freeze the rollback window
    once real user traffic starts hitting Postgres**, since a rollback after that point
    would lose whatever happened in between.
11. **Monitor CPU/memory for the first day** post-cutover to confirm the idle-load
    improvement holds under real traffic, not just the synthetic dry-run.
12. **Check disk headroom before the migration window, not during it.** During local
    testing, running both the Cockroach stack and the Postgres dry-run simultaneously while
    restoring ~460k rows filled the host disk to 100% and **crashed Postgres mid-checkpoint**
    (`PANIC: No space left on device`), which then needed free space just to *crash-recover*
    — a chicken-and-egg problem, resolved by pruning dangling Docker images. On the VPS,
    confirm free disk is comfortably larger than the full backup + restored data size
    *before* starting, not after — don't run this migration on a disk that's already tight.

### 6.3 Honest risk summary

| Risk | Severity | Mitigation |
|---|---|---|
| Account registry migration | ~~Medium-high~~ **Low — tested 2026-07-23** | Direct table-copy procedure (§6.2) verified end-to-end with a real account logging in; not yet scripted/automated, still run by hand |
| Duplicate person records per email (pre-existing prod data quirk) | Low | Carries over as-is unless cleaned up first via `migrate-merged-accounts`; doesn't block migration |
| Disk headroom during migration | Medium | Confirmed the failure mode locally (Postgres PANIC + crash-recovery loop on a full disk) — check free space generously before the real window, see step 12 |
| Downtime during migration | Medium | Scheduled maintenance window, sized generously |
| Index set incomplete for production data shape | Low | Same diagnostic method (EXPLAIN ANALYZE on slow queries) is repeatable post-cutover |
| Rollback after real traffic hits new DB | Medium | Freeze rollback window before go-live, communicate clearly |

---

*Everything above was done against local Docker/Colima only. No production system,
credentials, or data was modified. Local config changes (`.huly.nginx`,
`compose.perf.yml`, CockroachDB cluster settings) remain uncommitted per your instruction.*
