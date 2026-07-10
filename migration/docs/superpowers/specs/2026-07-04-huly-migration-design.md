# Huly Migration — Design Spec

**Date:** 2026-07-04
**Goal:** Migrate the company's Huly workspace (currently on Huly cloud `huly.app`, which is shutting down its hosted service) to self-hosted infrastructure we control, without losing project/issue/document/time-tracking data. Prove the restore locally first, then port the proven config to production (EC2 or Railway — decided after the local proof succeeds).

---

## Background & key findings

- **Huly cloud is being retired**; the vendor is moving customers to self-hosting. We must export our workspace and stand up our own Huly.
- **Our cloud workspace runs `v0.7.426`** (seen in Help & Support). Self-host will be pinned to the **same** image tag → no version-upgrade step during restore. Tag `v0.7.426` is confirmed published on Docker Hub (`hardcoreeng/*`, amd64 + arm64).
- **The existing Huly MCP server (`Jonard-hours/huly-mcp-private`) cannot produce a backup.** It is an application-level API client (36 tools: `list_issues`, `create_issue`, `log_time`, `get_document`, …) talking over the Huly WebSocket SDK. It reads/writes entities one call at a time and has no access to the database or object storage. It can *scrape* data to CSV/JSON (as `Jonard-hours` already does) but that is **not** a restorable Huly backup. → The backup must come from Huly's own backup UI.
- **Backups are datastore-level**, produced by Huly and consumed by the admin tool (`@hcengineering/tool`), which `huly-selfhost` wraps in `restore-workspace.sh` / `backup-restore.sh` / `run-tool.sh`. Restore runs *against a already-running self-host stack*.
- **`huly-selfhost` is a ~10-container docker-compose stack** (`front`, `account`, `transactor`, `workspace`, `cockroachdb`, `redpanda`, `elasticsearch`, `minio`, `rekoni`, `stats`; optional: mail/love/aibot/github/…). Designed to run as `docker compose up -d` on **one Linux host**. Wants 8 GB min / 16 GB recommended.

## Hosting decision

A **single host running docker-compose** is the correct topology for Huly (matches the officially supported/tested path; stateful stores CockroachDB/Redpanda/Elasticsearch/MinIO stay on one disk; inter-service traffic stays on loopback instead of network hops). A Railway multi-service split was considered and rejected: it diverges from the supported path, spreads stateful volumes across services, adds per-hop latency to a chatty stack, and costs more at 8–16 GB. **Railway remains the right home for the lightweight MCP server, not for Huly itself.**

Final production host (EC2 vs Railway single-instance vs VPS) is **deferred** until the local restore is proven.

## The backup source

- Obtained from `https://<workspace-url>/setting/setting/backup` → **"Download full backup"** (`.zip`), obtained manually by the user.
- ⚠️ **Large files (video/audio/anything over the server blob-size limit) are NOT in this backup** — they live under the UI's "Not backed up" section and would need separate download. **Out of scope** for this proof.

## Local environment (the proof machine)

WSL2, 4 vCPU, **9.7 GB RAM** (~5.9 GB free), 725 GB disk, Docker 27.4.1 + Compose v2.32.1.
9.7 GB is at the low edge, so: **skip all optional services** and **cap Elasticsearch heap** (`ES_JAVA_OPTS=-Xms512m -Xmx1g`) to keep the core stack under ~7 GB. Sufficient to prove a restore; production gets the full 16 GB.

---

## Plan

### Folder layout — `/home/karthi_0008/dev/client-projects/huly-migration/`
- `huly-selfhost/` — cloned upstream repo (compose stack + restore scripts)
- `backup/` — user drops the Huly `.zip` here (git-ignored); `backup/extracted/` = unzipped layout
- `notes/` — pinned versions, workspace slug, env values (secrets git-ignored)
- `docs/superpowers/specs/` — this spec

### Phase 1 — Stand up the stack locally
1. Clone `huly-selfhost` into the folder.
2. Run `./setup.sh` → answer `HOST_ADDRESS=localhost:8087`, HTTP (no TLS/SECURE), and set **`HULY_VERSION=v0.7.426`** in the generated config.
3. Edit the generated compose to (a) cap Elasticsearch heap and (b) confirm optional services are off.
4. `docker compose up -d`; wait ~60 s; verify every container is healthy and `http://localhost:8087` loads (WSL2 forwards localhost to the Windows browser).
5. Sanity check: create a throwaway account, confirm the UI works end-to-end.

### Phase 2 — Restore the backup
6. User places the `.zip` in `backup/`; unzip into `backup/extracted/` in the folder layout the tool expects.
7. Run `./restore-workspace.sh backup/extracted <workspace-slug> -e <admin-email> -p <password>`.
   - The `-p` password path creates the admin account directly, **avoiding the email-OTP flow** (no mail server needed locally).
   - Same source/target version → **no `--upgrade` flag**.
8. Verify projects, issues, documents, and time entries from the cloud workspace appear in the local UI. Spot-check counts against the live cloud workspace before it's shut down.

### Phase 3 — Port to production *(deferred until Phase 2 passes)*
9. Freeze the working `.env` + compose as the source of truth (already git-tracked here).
10. Choose EC2 / Railway single-instance / VPS, provision, set real `HOST_ADDRESS` + TLS + a mail service (so real users can OTP-login), redeploy, and re-restore the (possibly refreshed) backup.

---

## Risks & open items

| # | Risk | Mitigation / status |
|---|---|---|
| 1 | Version mismatch cloud→self-host | ✅ Resolved: pin `v0.7.426`, exact match |
| 2 | 9.7 GB RAM too tight locally | Trim optional services + cap ES heap; escalate to prod host if it OOMs |
| 3 | Backup `.zip` layout vs what restore script expects | Unzip + inspect during Phase 2; adjust folder path passed to script |
| 4 | Large files not in backup | Documented, out of scope for proof; revisit for production cutover |
| 5 | Post-restore login (OTP needs mail) | Local: use `-p` password admin path; prod: configure mail service |
| 6 | Backup staleness (cloud keeps changing until cutover) | Take a final fresh backup at the real production cutover, not this proof |

## Success criteria (local proof)
- All core containers healthy on the local machine.
- `restore-workspace.sh` completes without error against the real backup.
- The migrated workspace's projects/issues/docs/time-entries are visible and browsable in the local Huly UI, matching the cloud source on spot-checked counts.
