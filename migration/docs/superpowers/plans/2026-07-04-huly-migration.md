# Huly Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a deployment/ops plan: each "verify" step is a shell command with expected output, not a unit test.

**Goal:** Stand up a self-hosted Huly `v0.7.426` stack locally via docker-compose and restore the cloud workspace backup into it, as a proof before porting to production.

**Architecture:** Clone `huly-selfhost` (docker-compose, ~10 containers) into `huly-migration/huly-selfhost/`. Configure for a memory-constrained local WSL2 host (skip optional services, cap Elasticsearch heap), pin `HULY_VERSION=v0.7.426`. Bring the stack up, verify health + UI, then restore the backup with `restore-workspace.sh` using the password (non-OTP) admin path.

**Tech Stack:** Docker 27.4.1, Docker Compose v2.32.1, huly-selfhost (`main`), Huly images `hardcoreeng/*:v0.7.426`.

## Global Constraints

- `HULY_VERSION=v0.7.426` — exact match to the cloud workspace (Help & Support showed 0.7.426). No `--upgrade` on restore.
- `HOST_ADDRESS=localhost:8087`, HTTP only (no TLS) for the local proof.
- **Skip all optional services** (love, aibot, mail, github, telegram, print, calendar…). Core only.
- **Cap Elasticsearch heap:** `ES_JAVA_OPTS=-Xms512m -Xmx1g` (host has 9.7 GB total).
- All work under `/home/karthi_0008/dev/client-projects/huly-migration/`. Backups git-ignored.
- Restore login uses the **`-p` password** admin path (no mail server locally).

---

### Task 1: Clone huly-selfhost and inspect setup

**Files:**
- Create: `huly-migration/huly-selfhost/` (git clone target)

- [ ] **Step 1: Clone the repo**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration
git clone https://github.com/hcengineering/huly-selfhost.git
```

- [ ] **Step 2: Verify clone + inspect what setup.sh asks and which compose file it uses**

```bash
cd huly-selfhost
ls -1 *.sh *.conf* compose*.yml docker-compose*.yml 2>/dev/null
sed -n '1,120p' setup.sh
```
Expected: `setup.sh`, `restore-workspace.sh`, `backup-restore.sh`, `run-tool.sh`, a `.template.huly.conf`, and a compose file exist. Note the prompt variable names (HOST_ADDRESS, SECRET, HULY_VERSION, volume paths) so Task 2 can write the config non-interactively.

---

### Task 2: Generate config non-interactively for local

**Files:**
- Create/Modify: `huly-migration/huly-selfhost/huly.conf` (or the `*.conf` name setup.sh emits)
- Modify: the generated compose file (Elasticsearch heap)

**Interfaces:**
- Produces: a running-ready config with `HOST_ADDRESS=localhost:8087`, `HULY_VERSION=v0.7.426`, secrets generated, optional services absent.

- [ ] **Step 1: Run setup.sh feeding local answers**

setup.sh is interactive. Feed answers via a heredoc/pipe. Exact prompt order is confirmed in Task 1 Step 2; typical order is hostname then secure-flag. Example (adjust to observed prompts):
```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
printf 'localhost:8087\n\n' | ./setup.sh || true
```
If setup.sh cannot be driven non-interactively, copy `.template.huly.conf` to the live conf and edit fields directly instead.

- [ ] **Step 2: Force the pinned version and confirm host**

```bash
sed -i 's/^HULY_VERSION=.*/HULY_VERSION=v0.7.426/' huly.conf
grep -E '^(HULY_VERSION|HOST_ADDRESS|SECURE|SECRET)=' huly.conf
```
Expected: `HULY_VERSION=v0.7.426`, `HOST_ADDRESS=localhost:8087`, `SECURE` empty, `SECRET` non-empty.

- [ ] **Step 3: Cap Elasticsearch heap in the compose file**

Locate the `elastic`/`elasticsearch` service and ensure its environment includes:
```yaml
      - ES_JAVA_OPTS=-Xms512m -Xmx1g
```
Verify:
```bash
grep -nA2 'ES_JAVA_OPTS' compose.yml
```
Expected: the `-Xms512m -Xmx1g` line is present.

- [ ] **Step 4: Commit the config into the migration repo**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration
git add -A
git commit -m "Add huly-selfhost clone + local config (v0.7.426, ES heap capped)"
```

---

### Task 3: Bring the stack up and verify health

- [ ] **Step 1: Pull images (pinned tag) and start**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose pull
docker compose up -d
```
Expected: images tagged `v0.7.426` pull; containers create without error.

- [ ] **Step 2: Wait ~60s, then check every container is up**

```bash
sleep 60
docker compose ps
```
Expected: `front`, `account`, `transactor`, `workspace`, `cockroach`, `redpanda`, `elastic`, `minio`, `rekoni`, `stats` all `running`/`healthy`. None restarting.

- [ ] **Step 3: Check memory headroom (host is tight)**

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' ; free -h
```
Expected: total container memory comfortably under available RAM; no OOM kills. If a container is OOM-looping (`docker compose ps` shows restart), lower ES heap further or stop non-essential services and note it.

- [ ] **Step 4: Verify the front UI responds**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:8087
```
Expected: `200` (or `3xx`). Also open `http://localhost:8087` in the Windows browser — the Huly login screen should render.

- [ ] **Step 5: Smoke-test account creation (throwaway)**

In the browser, sign up a throwaway account and confirm you land in an empty workspace. This proves account→transactor→db→storage wiring before we trust a restore. (No command; UI check.)

---

### Task 4: Restore the backup *(BLOCKED until the user drops `backup/*.zip`)*

**Files:**
- Input: `huly-migration/backup/<file>.zip`
- Create: `huly-migration/backup/extracted/`

**Interfaces:**
- Consumes: a running stack from Task 3 and the Huly-cloud backup zip.

- [ ] **Step 1: Unzip and inspect the backup layout**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration
mkdir -p backup/extracted
unzip -o backup/*.zip -d backup/extracted
find backup/extracted -maxdepth 2 | head -40
```
Expected: a backup folder structure (blobs/metadata). Note whether the zip contains the backup dir directly or nested one level — the path passed to the restore script must point at the backup root.

- [ ] **Step 2: Restore into a fresh workspace (password admin path)**

Replace `<slug>`, `<email>`, `<password>` with real values. `<slug>` = the workspace identifier to create locally (e.g. `yg`).
```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
./restore-workspace.sh ../backup/extracted <slug> -e <email> -p <password>
```
Expected: script connects to the running stack and reports restore progress to completion without a version error. (Same source/target version → no `--upgrade`.)

- [ ] **Step 3: Verify the migrated data in the UI**

Log in at `http://localhost:8087` with `<email>`/`<password>`, open the restored workspace `<slug>`.
Expected: projects, issues, documents, and time entries from the cloud workspace are present. Spot-check a known issue identifier (e.g. `JONAR-xxxx`) and a couple of issue counts against the live cloud workspace.

- [ ] **Step 4: Record the outcome**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration
printf 'Restore verified %s: workspace <slug>, source v0.7.426.\n' "$(date -u +%FT%TZ)" >> notes/restore-log.txt
git add notes/restore-log.txt && git commit -m "Record successful local restore proof"
```

---

## Phase 3 (production) — out of scope for this plan
Once Task 4 passes, a separate plan will: freeze the working `huly.conf`+compose, provision the chosen host (EC2/Railway/VPS), set a real `HOST_ADDRESS`+TLS+mail, and re-restore a fresh backup taken at the true cutover.

## Self-Review notes
- Spec coverage: Phase 1 → Tasks 1–3; Phase 2 → Task 4; Phase 3 → deferred (matches spec). Risks 1 (version pin), 2 (ES heap/mem), 3 (zip layout), 5 (password path) each map to explicit steps.
- Task 4 is correctly gated on the backup arriving; Tasks 1–3 run now and are independently verifiable.
