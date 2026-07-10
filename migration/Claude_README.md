# Claude_README — Huly Migration

Guidance for developers (and Claude) working in this repo.

## What this repo is

The deployment/ops layer of this fork: a vendored copy of Huly's self-host stack plus custom
scripts, config, and runbooks. Everything under `migration/` is ours and rides along cleanly
when rebasing on upstream (upstream has no `migration/` path).

The rest of this repo (the root) is the Huly **platform source** — `youngglobes/yg-huly`, a
fork of `hcengineering/platform`. Feature customizations and version upgrades happen at the
root; deployment/ops changes happen here (see [CI & deployment](#ci--deployment)).

**Status:** self-host is live and proven on the server; a full backup restore (86 projects,
6546 issues, ~34 accounts) has been validated; OTP email works via Resend. The remaining
milestone is the production cutover — see `notes/cutover-runbook.md`.

## Layout

| Path | What |
|---|---|
| `huly-selfhost/` | Vendored Huly self-host stack (compose + upstream README) plus our custom scripts. |
| `huly-selfhost/compose.yml` | The 14-service stack (pinned `HULY_VERSION`, custom front image). |
| `huly-selfhost/compose.override.yml` | **Server-only** (gitignored dir aside): adds the `mail` service and wires `MAIL_URL`. |
| `huly-selfhost/restore-workspace.sh` | One-shot: create admin account → create/assign workspace → restore backup. |
| `huly-selfhost/backup-restore.sh` | Lower-level restore into an existing workspace (called by the above). |
| `huly-selfhost/run-tool.sh` | Runs the Huly `tool` container against the stack (create-account, backup-restore, upgrade-workspace, etc.). |
| `docs/backup-restore-guide.md` | **Reusable, step-by-step restore procedure** — start here to restore a backup. |
| `notes/cutover-runbook.md` | The proven, dated cutover recipe (production go-live). |
| `notes/stack-status.md` | Current stack state, services, resource notes. |
| `notes/platform-fork-spike-findings.md` | Why/how we fork the platform for the custom front feature. |
| `docs/superpowers/` | Design spec + implementation plan (historical context). |

## Key facts

- **Version pin:** `v0.7.426` — **must match the backup's source version**. Set in `huly_v7.conf`.
- **Custom image:** `ghcr.io/youngglobes/front:v0.7.426-yg` (public GHCR) — adds the
  "action item list in New Issue" feature. Rebuilt per Huly version by `youngglobes/yg-huly`
  CI (`yg/action-item-in-create` branch). <a id="custom-image"></a>
- **Workspace slug:** `yg`.
- **Email:** **Resend SMTP** (not AWS SES — SES was paused and abandoned). Config lives in
  server-only `.mail.env`. Details + gotchas in `docs/backup-restore-guide.md` and the runbook.
- **Server:** `ssh <SSH_TARGET>` (passwordless key), deploy dir
  `<DEPLOY_DIR>`. Public URL `http://<SERVER_IP>/`.
  - The `<SSH_TARGET>`, `<SERVER_IP>`, `<DEPLOY_DIR>`, `<BACKUP_DIR>`, `<SERVER_HOME>`
    placeholders used throughout the docs resolve in **`notes/server-access.md`**
    (gitignored, server coordinates — not in version control). New here? Copy the committed
    template: `cp notes/server-access.example.md notes/server-access.md` and fill in the
    real values (ask the team).

## CI & deployment <a id="ci--deployment"></a>

**Deployment is automated (since 2026-07-10).** Two CD paths, both ours, both gated by the
same post-deploy health check (front + accounts over https on the origin):

- **Deploy config:** push to `develop` touching `migration/huly-selfhost/**` →
  `.github/workflows/yg-deploy.yml` rsyncs the **git-tracked** files to `<DEPLOY_DIR>`,
  runs `docker compose up -d`, restarts nginx (it resolves upstream IPs only at startup),
  and health-checks. It never deletes, so server-only secrets (`huly_v7.conf`, `.mail.env`,
  `ssl/`, `.huly.nginx`) are untouched. Version bumps count too: changing image tags in
  `compose.yml` makes `up -d` pull the new tags.
- **App code (custom front feature):** push to `yg/action-item-in-create` → `yg-front.yml`
  (on that branch) builds + pushes `ghcr.io/youngglobes/front:v0.7.426-yg`, then its deploy
  job makes the server `docker compose pull front && up -d front` + nginx restart.
  Code NEVER deploys from `develop` — the stack is pinned to v0.7.426 and `develop` tracks
  newer upstream code (version mismatch would corrupt the workspace).

Required repo **Actions secrets**: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (private
half of the server's `~/.ssh/github_deploy`; public half is in `authorized_keys`).
Manual fallback still works (SSH + `docker compose up -d`); if repo and server drift,
**the server is the source of truth** — reconcile by syncing repo ← server.

**Upstream CI is disabled on this fork** (Actions → workflow → "Disable workflow", done
2026-07-10): `main.yml` (build + Playwright uitest/uitest-pg/uitest-qms/uitest-workspaces +
docker/dist/npm jobs) is upstream Huly's release pipeline, triggered on every push to
`develop` — ~12 heavy jobs to UI-test docs changes, and its publish jobs fail without
upstream secrets. Disabled via the UI (not a commit) so there's no diff against upstream at
rebase time. Re-enable the same way if ever needed; `baseimage.yaml`/`publish-npm.yml`
likewise if they fire.

## Secrets & config (important)

- `huly-selfhost/huly_v7.conf` (the compose `.env`, symlinked) is **gitignored** and lives
  only on the server. It holds DB URLs, `SECRET`, Redpanda creds. Regenerable via `./setup.sh`.
- `.mail.env` (Resend key), `.huly.secret`, `.cr.secret`, `.rp.secret` — **gitignored,
  server-only.** Never commit secrets. `backup/` contents are gitignored too.
- When editing server-side env files, remember the host is WSL-adjacent workflows can
  introduce CRLF — keep values clean (no quotes, no inline `#` comments in `.mail.env`).

## Operating the stack (run from `huly-selfhost/` on the server)

```bash
docker compose ps                       # service health (expect ~15 running: 14 + mail)
docker compose logs --tail=50 <svc>     # e.g. mail, account, transactor
docker compose up -d                    # start; add --force-recreate <svc> to reload env
docker compose down -v                  # ⚠ wipes ALL data volumes (fresh stack)
./run-tool.sh <cmd>                     # run a Huly tool command against the stack
```

## Restoring a backup

Follow **`docs/backup-restore-guide.md`**. The one make-or-break step that isn't obvious:
before restoring, you **must drop the `global_account.person` first_name/last_name NOT-NULL
constraints**, or users with blank names fail to restore as accounts (they then get
"Account not found" at OTP login). The guide covers this and the blob/datalake caveat.

## Conventions

- Keep operational knowledge in `notes/` and `docs/`; keep secrets out of git.
- Prefer the existing scripts (`restore-workspace.sh`, `run-tool.sh`) over ad-hoc `docker run`.
- When you change behavior on the server (config, email, restore steps), update the relevant
  doc in the same change so the next developer isn't working from stale instructions.
