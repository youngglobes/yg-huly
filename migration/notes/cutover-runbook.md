# Huly Self-Host Migration — Cutover Runbook (11 July 2026)

**Goal:** huly.app hosted service stops → take a FRESH backup → restore into the
self-hosted stack at `http://<SERVER_IP>/` → users log in (OTP) and see their
own projects.

**Status:** Every step below was validated on 2026-07-09 via a full clean
wipe+restore dry-run (data, accounts, per-user project visibility, OTP login all
confirmed). This runbook is the proven recipe — follow it in order.

---

## 0. Key facts (fill in the blanks marked ⟨…⟩ at cutover)

> **Placeholders:** `<SSH_TARGET>`, `<SERVER_IP>`, `<DEPLOY_DIR>`, `<BACKUP_DIR>`,
> `<SERVER_HOME>` resolve to the real server coordinates in `notes/server-access.md`
> (gitignored, not in version control).

| Item | Value |
|---|---|
| Server SSH | `ssh <SSH_TARGET>` (key already authorized; passwordless) |
| Deploy dir | `<DEPLOY_DIR>` |
| Backup dir on server | `<BACKUP_DIR>` |
| Huly version pin | `v0.7.426` (must match the backup) |
| Custom front image | `ghcr.io/youngglobes/front:v0.7.426-yg` (public GHCR — already wired in `compose.yml`) |
| Workspace slug | `yg` |
| Admin email / password | ⟨admin-email⟩ / ⟨admin-password⟩ (used for the password-admin login path) |
| Public URL | `http://<SERVER_IP>/` (HTTP, port 80) |

The server is already fully provisioned (Docker, 4 GB swap, mail service, custom
image, config). **The cutover = wipe the PoC data + restore the fresh backup.**

---

## 1. Pre-cutover checklist (do BEFORE 11 Jul)

- [x] **Email = Resend SMTP** (replaces AWS SES, which was paused account-side). Verified
      working 2026-07-10: OTP email delivered to a real user via Resend. No AWS dependency.
      `.mail.env` on server holds the SMTP block (see §7 / §9); domain `youngglobes.com` is
      Resend-verified. Nothing to un-pause — just confirm the mail service is up.
- [ ] Confirm the mail service starts on SMTP: `docker compose logs --tail=5 mail` shows
      `Using SMTP config` + `Mail service has been started` (no "Both SMTP and SES" error).
- [ ] Confirm you can SSH in: `ssh <SSH_TARGET> 'echo ok'`
- [ ] Decide the admin email + password for the restore.

---

## 2. Take the fresh backup from huly.app (manual)

1. Log into huly.app as a workspace owner.
2. Go to **Settings → Settings → Backup** (`https://<workspace>/setting/setting/backup`).
3. Click **"Download full backup"** → get the `.zip`.
   - ⚠️ Large files (video/audio/over the blob-size limit) are under "Not backed up"
     and are NOT in this zip — out of scope, same as the PoC.

---

## 3. Transfer + stage the backup on the server

From the machine that has the downloaded zip (or unzip locally first):

```bash
# Option A: copy the zip up, unzip on the server
scp <fresh-backup>.zip <SSH_TARGET>:<SERVER_HOME>/
ssh <SSH_TARGET> '
  rm -rf <BACKUP_DIR> && mkdir -p <BACKUP_DIR>
  unzip -o <SERVER_HOME>/<fresh-backup>.zip -d <BACKUP_DIR>
  ls <BACKUP_DIR> | head'   # expect index.json, backup.json.gz, blob-info.json.gz, snapshot dirs

# Option B: rsync an already-extracted folder (no -z; files are pre-compressed)
rsync -a --delete -e ssh <local>/extracted/ <SSH_TARGET>:<BACKUP_DIR>/
```

Verify the layout — the restore path must contain `index.json` + `*.gz` at its root:
```bash
ssh <SSH_TARGET> 'ls <BACKUP_DIR>/ | grep -E "index.json|backup.json.gz"'
```

---

## 4. Wipe the PoC data + bring up a fresh stack

```bash
ssh <SSH_TARGET> 'cd <DEPLOY_DIR> && docker compose down -v && docker compose up -d'
```
- `down -v` wipes ALL data volumes (cockroach, minio, elastic, redpanda). Config files
  (compose.yml, huly_v7.conf, .mail.env, .huly.nginx, compose.override.yml) are kept.
- `up -d` recreates a fresh, empty stack (~14 services + mail).

Wait for the account service to create the schema (~15–30 s), then confirm health:
```bash
ssh <SSH_TARGET> 'cd <DEPLOY_DIR> && sleep 30 && docker compose ps --status running -q | wc -l'   # expect 15 (14 + mail)
```

---

## 5. ⭐ CRITICAL: drop the person NOT-NULL constraints BEFORE restoring

**This is the make-or-break step.** Without it, users with a blank first/last name
fail to restore as accounts → OTP says "Account not found" for them. The membership
migration also needs the accounts present. Run it AFTER the schema exists, BEFORE the restore:

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

## 6. Run the restore

`restore-workspace.sh` already has the `assign-workspace <email> <workspace>` arg-order
bug fixed on this server. Run it detached (it takes ~20–30 min):

```bash
ssh <SSH_TARGET> "cd <DEPLOY_DIR> && nohup ./restore-workspace.sh ../backup/extracted yg -e ⟨admin-email⟩ -p '⟨admin-password⟩' > <SERVER_HOME>/restore.log 2>&1 & echo started"
```
- Same source/target version (`v0.7.426`) → the built-in `--upgrade` is a no-op.
- `--accounts` is on by default → all users restored (now that constraints are dropped).

Watch it (SSH watchers can drop on long idle — reconnect and check the log/process):
```bash
ssh -o ServerAliveInterval=20 <SSH_TARGET> 'pgrep -f restore-workspace.sh >/dev/null && echo RUNNING || echo ENDED; tail -3 <SERVER_HOME>/restore.log'
```
Done when the log shows `Restore finished.` → `Upgrade finished.` → `Done. Workspace 'yg' restored.`

---

## 7. Verify (post-restore)

```bash
ssh <SSH_TARGET> 'bash -s' <<'EOF'
cd <DEPLOY_DIR>
CRURL=$(grep -E '^CR_DB_URL=' huly_v7.conf | cut -d= -f2- | tr -d '"'); U="${CRURL}?sslmode=require"
echo "accounts/persons:"; docker compose exec -T cockroach cockroach sql --url "$U" -e "SELECT (SELECT count(*) FROM global_account.account) AS accounts, (SELECT count(*) FROM global_account.person) AS persons;"
echo "issues:"; docker compose exec -T cockroach cockroach sql --url "$U" -e "SELECT count(*) FROM public.task WHERE _class='tracker:class:Issue';"
EOF
```
Expect ~34 accounts and the full issue count. Then **log in as a real user** and confirm
they see their own projects (this is the real proof — the admin view shows fewer, that's
expected and NOT a problem):

- Normal path (Resend live): user opens `http://<SERVER_IP>/`, enters email → **"Login
  with code"** → gets the OTP by email (via Resend SMTP) → lands on their projects.
- DB-code fallback (if email ever fails): pull the code straight from the DB —
  ```bash
  # trigger a code
  curl -s -X POST http://<SERVER_IP>/_accounts -H 'Content-Type: application/json' \
    -d '{"method":"loginOtp","params":{"email":"⟨user-email⟩"}}'
  # read the newest code (expires in ~1 min — read + enter quickly)
  ssh <SSH_TARGET> "cd <DEPLOY_DIR> && CRURL=\$(grep -E '^CR_DB_URL=' huly_v7.conf | cut -d= -f2- | tr -d '\"') && docker compose exec -T cockroach cockroach sql --url \"\${CRURL}?sslmode=require\" -e \"SELECT code FROM global_account.otp ORDER BY expires_on DESC LIMIT 1;\""
  ```

**Verified in the dry-run:** a real user (karthikeyan) saw **32 projects matching
huly.app**, including their starred + own projects. Per-user membership resolves on
login — no reconstruction needed.

---

## 8. Rollback / safety

- The restore is non-destructive to huly.app (source is untouched).
- If a restore goes wrong, just re-run from §4 (wipe → fresh → constraints → restore).
  It's fully repeatable.
- Keep the fresh backup zip until the cutover is confirmed good.

---

## 9. Known items / notes

- **Email is Resend SMTP, not AWS SES** (SES was paused account-side; abandoned). The Huly
  `mail` image (`hardcoreeng/mail:v0.7.426`) supports SMTP natively via nodemailer — no code
  change / rebuild. Server-side `.mail.env` (gitignored) holds ONLY the SMTP block; the SES
  vars are commented out. **Critical:** SMTP and SES cannot both be set — if `SMTP_HOST` and
  `SES_ACCESS_KEY` are both non-empty the mail container refuses to boot
  ("Both SMTP and SES configuration are specified"). Working config:
  ```ini
  SMTP_HOST=smtp.resend.com
  SMTP_PORT=587           # 465 is BLOCKED outbound on this server; 587/2465/2587 are open
  SMTP_USERNAME=resend
  SMTP_PASSWORD=re_...    # a Resend API key with Sending access; NO inline # comment (env_file
                          # doesn't support them — the comment becomes part of the password)
  SMTP_TLS_MODE=upgrade   # STARTTLS for 587; use `secure` only for an SSL port like 2465
  SOURCE=noreply@youngglobes.com
  ```
  Rollback to SES = comment the SMTP block, uncomment the SES block, `docker compose up -d
  --force-recreate mail`. Transport is chosen by which block is populated, not by any protocol flag.
- **Large files** (video/audio/oversized) are not in the backup — migrate separately if needed.
- **URL format** `…/login%3Acomponent%3ALoginApp` is cosmetic (Huly's internal routing),
  not a problem.
- **Custom front feature** (Action item list in New Issue) rides on the custom image
  `ghcr.io/youngglobes/front:v0.7.426-yg`. Per-Huly-version rebuild in CI (`yg/action-item-in-create`
  branch on `youngglobes/yg-huly`) — see `notes/platform-fork-spike-findings.md`.
- **Production hardening (post-cutover, optional):** real domain + TLS (set `HOST_ADDRESS`
  + `SECURE`), consider 16 GB RAM if 34 users strain the 8 GB box.
