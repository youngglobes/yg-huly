# S3 Live Storage + Backup — Design Spec

**Date:** 2026-07-10
**Status:** Draft for review (do not implement until approved)
**Scope:** Move Huly blob (attachment) storage to AWS S3, and add disaster-recovery backups to S3.

---

## 1. Goals & context

- **Primary goal — stop attachments filling the server disk.** Server is Hetzner **Nuremberg** (`eu-central-1`-adjacent), 150 GB disk, 109 GB free today. Blobs (MinIO) are 6.6 GB and grow unbounded with every upload; DB (CockroachDB) is ~6 GB.
- **Secondary goal — disaster recovery.** Off-box backups so a dead server loses nothing.
- **Latency:** measured server→AWS RTT — `eu-central-1` **3.6 ms**, `ap-southeast-1` 251 ms. So live files must be in **eu-central-1**; backups (overnight) can sit in the existing Singapore bucket.

## 2. Decisions (fixed inputs)

| Item | Value |
|---|---|
| Live-files bucket | **`ygs-huly-files`**, region **`eu-central-1`**, **versioning ON** |
| Backup bucket | **`ygs-sites-backup`**, region `ap-southeast-1`, prefix **`backup/yg-huly/`** |
| Credentials | reuse the existing **SES IAM user** access key (now granted S3 access) — server-only |
| Workspace slug | `yg` |
| Huly version | `v0.7.426` |

## 3. Verified Huly internals (from `yg-huly` source + `tool:v0.7.426`)

- **`STORAGE_CONFIG` grammar** (`server-storage/src/starter.ts`): `;`-separated `kind|uri?params`; **the last entry is the default** (new blobs are written there); **all entries are readable** (fallback). Params after `?` become adapter fields.
- **S3 config string:**
  `s3|https://s3.eu-central-1.amazonaws.com?accessKey=<KEY>&secretKey=<SECRET>&region=eu-central-1&rootBucket=ygs-huly-files`
  `rootBucket` = one shared bucket for all workspaces (matches our single bucket).
- **Restore writes blobs to the default storage adapter.** So if S3 is the default at restore time, a fresh re-migration lands every file straight in S3 — **no separate blob migration needed.**
- **`move-files` (in-place MinIO→S3 migration) is NOT in `tool:v0.7.426`** (commented out upstream). Migrating *already-local* blobs would need a custom tool build — which the re-migration approach avoids entirely.
- **Backup commands present:** `backup <dirName> <workspace>` (incremental), `backup-compact <dirName>`, `backup-check[-all]`, `backup-restore <dirName> <workspace> [date]`, and native `backup-s3-compact` / `backup-s3-download <bucketName> …`.

## 4. Approach

### Track A — Blobs on S3, folded into the next re-migration
Because a full re-migration (`down -v` → fresh stack → restore) is planned after the cutover, we set S3 as the storage backend **before** the restore. The restore then writes all blobs directly to S3; MinIO is never populated and is removed. This avoids the `move-files` limitation completely.

### Track B — Nightly DR backup to S3
A cron job runs Huly's incremental `backup`, then syncs it to the Singapore backup bucket under `backup/yg-huly/`, with lifecycle-based retention. Since blobs live in versioned S3, this primarily protects the DB.

---

## 5. Track A — detailed design

### 5.1 Parameterize `STORAGE_CONFIG` (keeps the secret out of git)

The S3 config string contains the secret key, so it must live **only** in the gitignored `huly_v7.conf` — never in the tracked `compose.yml` / `run-tool.sh`.

**`huly_v7.conf`** (server-only, gitignored) — add, **quoted** (bash `source` + the `&` chars require it):
```ini
STORAGE_CONFIG="s3|https://s3.eu-central-1.amazonaws.com?accessKey=<S3_ACCESS_KEY>&secretKey=<S3_SECRET_KEY>&region=eu-central-1&rootBucket=ygs-huly-files"
```
> Note: if the secret key contains `+` `/` `=`, URL-encode those (`%2B` `%2F` `%3D`) since the value is parsed as a URL. The current SES key is plain alphanumeric, so no encoding needed.

**`compose.yml`** (tracked) — every service currently hardcodes
`- STORAGE_CONFIG=minio|minio?accessKey=minioadmin&secretKey=minioadmin`.
Replace each with the variable:
```yaml
      - STORAGE_CONFIG=${STORAGE_CONFIG}
```

**`run-tool.sh`** (tracked) — it hardcodes the MinIO string. It already `source`s `huly_v7.conf`, so change:
```bash
STORAGE_CONFIG="minio|minio?accessKey=minioadmin&secretKey=minioadmin"
```
to use the sourced value (with the MinIO literal only as a dev fallback):
```bash
STORAGE_CONFIG="${STORAGE_CONFIG:-minio|minio?accessKey=minioadmin&secretKey=minioadmin}"
```

> ⚠️ **Both `compose.yml` and `run-tool.sh` must resolve to S3**, because the restore runs *through `run-tool.sh`* and uses its own `STORAGE_CONFIG`. If only compose is changed, the restore silently writes to MinIO.

### 5.2 Remove MinIO
Once S3 is the sole storage: delete the `minio` service from `compose.yml` (and its volume) so it no longer runs or consumes disk. Remove any `depends_on: minio`.

### 5.3 Bucket setup (`ygs-huly-files`, eu-central-1)
- Create bucket in `eu-central-1`.
- **Enable Versioning.**
- **Lifecycle rule:** expire **noncurrent** versions after **30 days**; delete expired delete-markers. (Caps versioning storage cost; gives 30-day "oops" recovery.)
- IAM: the reused SES user needs `s3:GetObject/PutObject/DeleteObject/ListBucket` on `ygs-huly-files` (and the `ListAllMyBuckets`/`CreateBucket` only if Huly auto-creates — with `rootBucket` set the bucket already exists, so create-bucket isn't required).

### 5.4 Sequencing (into the re-migration)
1. Create + configure the bucket (5.3).
2. Put `STORAGE_CONFIG` in `huly_v7.conf`; switch `compose.yml` + `run-tool.sh` to `${STORAGE_CONFIG}`; remove `minio`.
3. Run the standard cutover (`down -v` → `up -d` → drop person NOT-NULL constraints → `restore-workspace.sh`).
4. **Verify:** upload a new attachment in the UI → confirm the object appears in `ygs-huly-files`; open an existing restored attachment → loads from S3.

### 5.5 Caveats (unchanged from the migration)
- `down -v` wipes the current local 6.6 GB — fine, we re-restore fresh.
- Large "datalake" files are **not** in the huly.app backup — they don't come across, S3 or not.
- Egress: uncached attachment views bill AWS egress (~$0.09/GB, `eu-central-1`). Modest at ~34 users.

---

## 6. Track B — Nightly DR backup

### 6.1 Job (server cron, e.g. 02:30 Europe/Berlin)
```bash
cd /home/developer/huly-selfhost
./run-tool.sh backup /backup/yg yg          # incremental workspace backup -> local dir
aws s3 sync /backup/yg s3://ygs-sites-backup/backup/yg-huly/ --region ap-southeast-1
```
- Huly `backup` is **incremental** — nightly runs add only deltas.
- `aws s3 sync` uploads only changed files.
- Periodically (weekly) `./run-tool.sh backup-compact /backup/yg` to keep the local store compact, then re-sync.

### 6.2 Retention
- **Backup bucket lifecycle** on prefix `backup/yg-huly/`: keep **30 days**, then expire.
- Local `/backup/yg` store: bounded by `backup-compact`; ~DB size (~6 GB). Acceptable (109 GB free).

### 6.3 Credentials
`aws` CLI on the server uses the same IAM key (env or `~/.aws/credentials`, server-only). Optionally a separate profile scoped to the backup bucket.

### 6.4 What it protects
- **Database** (projects/issues/docs) — the irreplaceable part.
- **Blobs** are already durable in versioned S3, so they are *not* re-copied by default. (Option: also `aws s3 sync` the live bucket to the backup bucket for a second copy — extra storage/egress; not recommended given versioning.)

### 6.5 Disk-optimal alternative (optional, later)
Native `backup-s3-*` keeps the incremental backup store **in S3 directly** (no local `/backup` dir). More moving parts; defer unless the local backup dir becomes a disk concern.

---

## 7. Restore procedure (updated)

- **DB / workspace:** pull the latest from S3, then restore:
  ```bash
  aws s3 sync s3://ygs-sites-backup/backup/yg-huly/ /backup/yg --region ap-southeast-1
  ./restore-workspace.sh /backup/yg yg -e <admin-email> -p '<admin-password>'
  ```
  (Same as `backup-restore-guide.md`, source = the S3-synced dir.)
- **Blobs:** already live in `ygs-huly-files` — nothing to restore if the bucket survives. Accidental deletes recover from **versioning**.

## 8. Secrets & git hygiene
- Real S3 key lives **only** in `huly_v7.conf` (gitignored) and the server's `aws` creds. Tracked files use `${STORAGE_CONFIG}` / placeholders.
- Never commit the access/secret key. Sweep before any commit.

## 9. Risks
- **Config drift between `compose.yml` and `run-tool.sh`** → restore writes to the wrong store. Mitigated by sourcing one `STORAGE_CONFIG` var.
- **URL-encoding** of a secret key with special chars (5.1).
- **Egress cost** on attachment views (modest at this scale).
- **No `move-files`** in the stock tool — accepted; re-migration approach sidesteps it.

## 10. Rollback
- Before the re-migration, revert is trivial (restore the old `compose.yml` / `run-tool.sh`, keep MinIO).
- After: to fall back to MinIO you would need to re-add the `minio` service and migrate blobs back (no `move-files`) — so treat the S3 cutover as forward-only once the re-migration is done and verified.

## 11. Open decisions (confirm before implementation)
1. **Backup frequency + retention:** nightly / keep 30 days? (assumed)
2. **Blob second-copy:** rely on live-bucket versioning only (recommended), or also mirror live→backup bucket?
3. **Native S3 backup (6.5):** now or defer? (recommend defer)
