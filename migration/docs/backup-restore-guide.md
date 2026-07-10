# Huly Backup & Restore Guide

How to restore a Huly workspace backup into the self-hosted stack. This is the reusable
procedure any developer can follow. For the specific production go-live, see
`notes/cutover-runbook.md` (same mechanics, dated + checklist form).

**Validated:** this exact recipe restored 86 projects / 6546 issues / ~34 accounts and was
confirmed by real users logging in via OTP and seeing their own projects.

---

## 0. Prerequisites

> **Placeholders:** `<SSH_TARGET>`, `<SERVER_IP>`, `<DEPLOY_DIR>`, `<BACKUP_DIR>`,
> `<SERVER_HOME>` below resolve to the real server coordinates in `notes/server-access.md`
> (gitignored, not in version control). Substitute them, or set up the SSH alias it suggests.

| Item | Value |
|---|---|
| Server SSH | `ssh <SSH_TARGET>` (passwordless key) |
| Deploy dir | `<DEPLOY_DIR>` (run all commands here) |
| Version pin | `v0.7.426` — **must match the backup's source version** (`HULY_VERSION` in `huly_v7.conf`) |
| Workspace slug | `yg` (the target workspace id to create/restore into) |

- The stack must be provisioned (Docker, config, custom image). `huly_v7.conf` and the
  `.mail.env`/`.secret` files live only on the server (gitignored).
- Restoring is **non-destructive to the source** (huly.app is untouched).
- The whole procedure is **repeatable** — if anything goes wrong, wipe and start again from §2.

---

## 1. Take a backup from huly.app (source side)

1. Log into huly.app as a workspace **owner**.
2. **Settings → Settings → Backup** (`https://<workspace>/setting/setting/backup`).
3. **Download full backup** → a `.zip`.

> ⚠️ Large files (video/audio / over the blob-size limit) appear under "Not backed up" and are
> **not** in the zip. See the [blob caveat](#blob-caveat) below.

---

## 2. Stage the backup on the server

The restore path must contain `index.json` + `backup.json.gz` at its **root**.

```bash
# Option A: copy the zip up and unzip on the server
scp <fresh-backup>.zip <SSH_TARGET>:<SERVER_HOME>/
ssh <SSH_TARGET> '
  rm -rf <BACKUP_DIR> && mkdir -p <BACKUP_DIR>
  unzip -o <SERVER_HOME>/<fresh-backup>.zip -d <BACKUP_DIR>
  ls <BACKUP_DIR> | head'   # expect index.json, backup.json.gz, snapshot dirs

# Option B: rsync an already-extracted folder (no -z; files are already compressed)
rsync -a --delete -e ssh <local>/extracted/ <SSH_TARGET>:<BACKUP_DIR>/
```

Verify the layout:
```bash
ssh <SSH_TARGET> 'ls <BACKUP_DIR>/ | grep -E "index.json|backup.json.gz"'
```

---

## 3. Bring up a fresh, empty stack

To restore into a clean workspace, wipe existing data volumes and recreate:

```bash
ssh <SSH_TARGET> 'cd <DEPLOY_DIR> && docker compose down -v && docker compose up -d'
```
- `down -v` wipes **all** data volumes (cockroach, minio, elastic, redpanda). Config files
  (`compose.yml`, `huly_v7.conf`, `.mail.env`, `compose.override.yml`) are kept.
- `up -d` recreates ~15 services (14 core + `mail`).

Wait for the account service to create the schema (~15–30 s), then confirm health:
```bash
ssh <SSH_TARGET> 'cd <DEPLOY_DIR> && sleep 30 && docker compose ps --status running -q | wc -l'   # expect 15
```

> Restoring into an **existing** workspace instead of a fresh one? Skip the wipe and pass
> `--skip-account` / `--skip-workspace` in §5, or use `-- --merge`. The fresh-wipe path is the
> validated default.

---

## 4. ⭐ CRITICAL: drop the person NOT-NULL constraints (before restoring)

**Make-or-break step.** Users with a blank first/last name fail to restore as accounts, and
then get "Account not found" at OTP login; the membership migration also needs the accounts
present. Run this **after** the schema exists, **before** the restore:

```bash
ssh <SSH_TARGET> 'bash -s' <<'EOF'
cd <DEPLOY_DIR>
CRURL=$(grep -E '^CR_DB_URL=' huly_v7.conf | cut -d= -f2- | tr -d '"'); U="${CRURL}?sslmode=require"
# wait until the account schema (person table) exists
for i in $(seq 1 20); do
  e=$(docker compose exec -T cockroach cockroach sql --url "$U" -e "SELECT count(*) FROM information_schema.tables WHERE table_schema='global_account' AND table_name='person';" 2>/dev/null | tail -1 | tr -d ' ')
  [ "$e" = "1" ] && break; sleep 10
done
docker compose exec -T cockroach cockroach sql --url "$U" -e "ALTER TABLE global_account.person ALTER COLUMN first_name DROP NOT NULL; ALTER TABLE global_account.person ALTER COLUMN last_name DROP NOT NULL;"
docker compose exec -T cockroach cockroach sql --url "$U" -e "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='global_account' AND table_name='person' AND column_name IN ('first_name','last_name');"
EOF
```
Expect both columns to show `is_nullable = YES`.

---

## 5. Run the restore

`restore-workspace.sh <backup-dir> <workspace> [options]` does it all: creates the admin
account, creates + assigns the workspace, then restores the backup (via `backup-restore.sh`).
Key options: `-e/--email`, `-p/--password`, `--skip-account`, `--skip-workspace`,
`--no-accounts` (default: accounts **on**), `--no-upgrade`.

It takes ~20–30 min, so run it detached:
```bash
ssh <SSH_TARGET> "cd <DEPLOY_DIR> && nohup ./restore-workspace.sh ../backup/extracted yg -e <admin-email> -p '<admin-password>' > <SERVER_HOME>/restore.log 2>&1 & echo started"
```
- Same source/target version (`v0.7.426`) → the built-in `--upgrade` is a harmless no-op.
- `--accounts` is on by default → all users restored (works now that §4 dropped the constraints).

Watch it (long-idle SSH can drop — reconnect and re-check):
```bash
ssh -o ServerAliveInterval=20 <SSH_TARGET> 'pgrep -f restore-workspace.sh >/dev/null && echo RUNNING || echo ENDED; tail -3 <SERVER_HOME>/restore.log'
```
Done when the log shows: `Restore finished.` → `Upgrade finished.` → `Done. Workspace 'yg' restored.`

---

## 6. Verify

```bash
ssh <SSH_TARGET> 'bash -s' <<'EOF'
cd <DEPLOY_DIR>
CRURL=$(grep -E '^CR_DB_URL=' huly_v7.conf | cut -d= -f2- | tr -d '"'); U="${CRURL}?sslmode=require"
echo "accounts/persons:"; docker compose exec -T cockroach cockroach sql --url "$U" -e "SELECT (SELECT count(*) FROM global_account.account) AS accounts, (SELECT count(*) FROM global_account.person) AS persons;"
echo "issues:"; docker compose exec -T cockroach cockroach sql --url "$U" -e "SELECT count(*) FROM public.task WHERE _class='tracker:class:Issue';"
EOF
```
Expect the full account and issue counts. Then **log in as a real user** (the real proof —
the admin view shows fewer projects, which is expected and fine):

- **Normal path:** user opens `http://<SERVER_IP>/`, enters email → **"Login with code"** →
  receives the OTP by email (via Resend) → lands on their own projects.
- **DB-code fallback** (if email is unavailable during testing) — OTP codes expire in ~1 min,
  so read and enter fast:
  ```bash
  # trigger a code
  curl -s -X POST http://<SERVER_IP>/_accounts -H 'Content-Type: application/json' \
    -d '{"method":"loginOtp","params":{"email":"<user-email>"}}'
  # read the newest code
  ssh <SSH_TARGET> "cd <DEPLOY_DIR> && CRURL=\$(grep -E '^CR_DB_URL=' huly_v7.conf | cut -d= -f2- | tr -d '\"') && docker compose exec -T cockroach cockroach sql --url \"\${CRURL}?sslmode=require\" -e \"SELECT code FROM global_account.otp ORDER BY expires_on DESC LIMIT 1;\""
  ```

---

## 7. Email / OTP delivery (Resend SMTP)

OTP and transactional email go through the `mail` service using **Resend SMTP** (AWS SES was
paused account-side and abandoned). The Huly `mail` image supports SMTP natively — no code
change. Config is server-only in `.mail.env`:

```ini
SMTP_HOST=smtp.resend.com
SMTP_PORT=587           # 465 & 25 are BLOCKED outbound on this server; 587/2465/2587 are open
SMTP_USERNAME=resend
SMTP_PASSWORD=re_...    # Resend API key with Sending access
SMTP_TLS_MODE=upgrade   # STARTTLS for 587 (use `secure` only for an implicit-SSL port like 2465)
SOURCE=noreply@youngglobes.com
```
Apply changes with `docker compose up -d --force-recreate mail`. Healthy start logs:
`Using SMTP config` + `Mail service has been started`. A good send logs
`User "resend" authenticated` → `sent: 250 <id>`.

**Gotchas (each cost real debugging time):**
- **SMTP and SES cannot both be set.** If `SMTP_HOST` and `SES_ACCESS_KEY` are both non-empty,
  the mail container throws `Both SMTP and SES configuration are specified` and won't boot.
  Comment out the SES vars. (Transport is chosen by which block is populated — no protocol flag.)
- **Port 465 times out** here (blocked). Use 587 + `SMTP_TLS_MODE=upgrade`.
- **`.mail.env` has no inline comments.** `SMTP_PASSWORD=re_xxx  # note` sends the whole string
  (incl. the comment) as the password → `535 Authentication credentials invalid`. Value only.
- **Rollback to SES:** comment the SMTP block, uncomment SES, `docker compose up -d --force-recreate mail`.

---

## 8. Caveats & rollback

<a id="blob-caveat"></a>
- **Blob / datalake caveat:** Huly cloud uses a *datalake* blob store; this stack uses minio.
  DB content (projects, issues, docs, comments, time entries) restores fully. If the backup
  contains `blobs/blobs.json`, `backup-restore.sh` **warns and skips** those extra blobs —
  large file attachments/images are not uploaded. Migrate large files separately if needed.
- **Rollback:** the restore is non-destructive to the source. If a restore goes wrong, re-run
  from §3 (wipe → fresh → drop constraints → restore). Keep the backup zip until the restore
  is confirmed good.
- **`assign-workspace` arg order:** the copy on the server already has the arg-order fix; the
  scripts here reflect it.
