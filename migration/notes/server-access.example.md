# Server Access — Huly Self-Host (TEMPLATE)

> **Template — safe to commit.** Copy this file to `notes/server-access.md` (which is
> gitignored) and fill in the real values. The tracked docs (`Claude_README.md`,
> `docs/backup-restore-guide.md`, `notes/cutover-runbook.md`) reference the `<PLACEHOLDER>`
> tokens below; the filled-in copy is where they resolve.
>
> ```bash
> cp notes/server-access.example.md notes/server-access.md
> # then edit notes/server-access.md with the real coordinates (ask the team if you don't have them)
> ```

## Coordinates

| Placeholder | Real value |
|---|---|
| `<SSH_TARGET>` | `⟨user⟩@⟨server-ip⟩` (passwordless key must be authorized) |
| `<SERVER_IP>` | `⟨server-ip⟩` (used in `http://<SERVER_IP>/` and the `_accounts` endpoint) |
| `<DEPLOY_DIR>` | `⟨/path/to/huly-selfhost⟩` (run stack + restore commands here) |
| `<BACKUP_DIR>` | `⟨/path/to/backup/extracted⟩` (staged backup; must hold `index.json` + `backup.json.gz` at its root) |
| `<SERVER_HOME>` | `⟨/home/user⟩` (where backup zips land before extraction) |
| Public URL | `http://⟨server-ip⟩/` |
| Workspace slug | `yg` |

## Admin login for restores

Decide/record the admin email + password used with `restore-workspace.sh -e … -p …`:

- Admin email: `⟨fill in at restore time⟩`
- Admin password: `⟨fill in at restore time⟩`

## Convenience: SSH alias

Add to `~/.ssh/config` so commands read `ssh huly-prod …`:

```
Host huly-prod
    HostName ⟨server-ip⟩
    User ⟨user⟩
```

## Secret files (server-only, never leave the box)

`huly_v7.conf` (compose `.env`), `.mail.env` (Resend API key), `.huly.secret`, `.cr.secret`,
`.rp.secret` — all live only in `<DEPLOY_DIR>` on the server and are gitignored.
