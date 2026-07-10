# YG Timesheet — Phase 0 Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the custom-model pipeline end-to-end: a one-class `yg-timesheet` model compiles, CI builds workspace/transactor/tool images carrying it, and a local Huly stack running those images creates a workspace with the class present — WITHOUT touching production.

**Architecture:** Two new rush packages (`plugins/yg-timesheet` = plugin ids, `models/yg-timesheet` = model class) registered in `models/all`; CI extended with a backend-images job; verification on the LOCAL huly-selfhost stack (`/home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost`), never production.

**Tech Stack:** Huly platform monorepo (rush + pnpm, TypeScript, esbuild), GitHub Actions, Docker/GHCR, local docker-compose stack.

## Global Constraints

- Repo: `/home/karthi_0008/dev/client-projects/yg-huly`. ALL code work on branch **`yg/spike-model-trio`** (created off `yg_develop`). NEVER commit spike code to `develop` or directly to `yg_develop`.
- Version pin: every new package `"version": "0.7.426"`, workspace deps `"workspace:^0.7.426"`.
- Image registry/tag: `ghcr.io/youngglobes/<name>:v0.7.426-yg` where `<name>` ∈ `front|workspace|transactor|tool`.
- Production safety: the `deploy-front` job must run ONLY on `yg_develop` (spike branch builds images but deploys nothing). Production compose keeps stock `hardcoreeng/workspace|transactor` images until Phase 1 — spike images are verified locally only.
- New-files-only rule: upstream files touched are exactly `rush.json`, `models/all/package.json`, `models/all/src/index.ts`, `.github/workflows/yg-front.yml` — nothing else.
- Node/rush commands run from the repo root and use the repo's wrappers: `node common/scripts/install-run-rush.js <cmd>`.
- rush install requires the repo's node version (`.nvmrc`); use `nvm use` if the build errors on node version.

---

### Task 1: Plugin ids package `plugins/yg-timesheet`

**Files:**
- Create: `plugins/yg-timesheet/package.json`
- Create: `plugins/yg-timesheet/src/index.ts`
- Create: `plugins/yg-timesheet/tsconfig.json`
- Create: `plugins/yg-timesheet/.eslintrc.js`
- Create: `plugins/yg-timesheet/config/rig.json`
- Modify: `rush.json` (add one project entry, keep alphabetical-ish placement near other plugins)

**Interfaces:**
- Produces: package `@hcengineering/yg-timesheet` exporting `ygTimesheetId: Plugin` (value `'yg-timesheet'`), interface `Timesheet extends Doc { employee: Ref<Employee>, weekStart: Timestamp }`, and default plugin object with `class.Timesheet`. Task 2's model imports these exact names.

- [ ] **Step 1: Create the spike branch**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git fetch origin yg_develop && git switch yg_develop && git pull --ff-only origin yg_develop
git switch -c yg/spike-model-trio
```

- [ ] **Step 2: Write `plugins/yg-timesheet/package.json`**

```json
{
  "name": "@hcengineering/yg-timesheet",
  "version": "0.7.426",
  "main": "lib/index.js",
  "svelte": "src/index.ts",
  "types": "types/index.d.ts",
  "author": "YoungGlobes",
  "template": "@hcengineering/default-package",
  "license": "EPL-2.0",
  "scripts": {
    "build": "compile",
    "build:watch": "compile",
    "format": "format src",
    "_phase:build": "compile transpile src",
    "_phase:format": "format src",
    "_phase:validate": "compile validate",
    "_phase:test": "jest --passWithNoTests --silent --forceExit",
    "test": "jest --passWithNoTests --silent --forceExit"
  },
  "devDependencies": {
    "@hcengineering/platform-rig": "workspace:^0.7.426",
    "@typescript-eslint/eslint-plugin": "^6.21.0",
    "eslint-plugin-import": "^2.26.0",
    "eslint-plugin-promise": "^6.1.1",
    "eslint-plugin-n": "^15.4.0",
    "eslint": "^8.54.0",
    "@typescript-eslint/parser": "^6.21.0",
    "eslint-config-standard-with-typescript": "^40.0.0",
    "prettier": "^3.6.2",
    "typescript": "^5.9.3",
    "@types/node": "^22.18.1",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.5",
    "ts-jest": "^29.1.1"
  },
  "dependencies": {
    "@hcengineering/core": "workspace:^0.7.426",
    "@hcengineering/platform": "workspace:^0.7.426",
    "@hcengineering/contact": "workspace:^0.7.426"
  }
}
```

Before writing tsconfig/eslintrc/rig.json, copy them from the sibling plugin so they match the repo's rig exactly:

```bash
cp plugins/guest/tsconfig.json plugins/yg-timesheet/tsconfig.json
cp plugins/guest/.eslintrc.js  plugins/yg-timesheet/.eslintrc.js
mkdir -p plugins/yg-timesheet/config && cp plugins/guest/config/rig.json plugins/yg-timesheet/config/rig.json
# check guest's package.json "template" field; if it says @hcengineering/platform-package or similar,
# use that same value in our package.json instead of @hcengineering/default-package:
grep '"template"' plugins/guest/package.json
```
If the grep shows a different template value, edit our `package.json` `"template"` to match it.

- [ ] **Step 3: Write `plugins/yg-timesheet/src/index.ts`**

```ts
//
// YoungGlobes: timesheet plugin ids (Phase 0 spike — one class only).
//
import type { Employee } from '@hcengineering/contact'
import { type Class, type Doc, type Ref, type Timestamp } from '@hcengineering/core'
import type { Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'

/** One timesheet per employee per week (weekStart = Monday 00:00 workspace tz). */
export interface Timesheet extends Doc {
  employee: Ref<Employee>
  weekStart: Timestamp
}

export const ygTimesheetId = 'yg-timesheet' as Plugin

export default plugin(ygTimesheetId, {
  class: {
    Timesheet: '' as Ref<Class<Timesheet>>
  }
})
```

- [ ] **Step 4: Register in `rush.json`**

Find the `"@hcengineering/guest"` entry in `rush.json` and add this sibling entry right after its closing `},`:

```json
    {
      "packageName": "@hcengineering/yg-timesheet",
      "projectFolder": "plugins/yg-timesheet",
      "shouldPublish": false
    },
```

- [ ] **Step 5: Install + build — verify it compiles**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet
```
Expected: `rush update` links the new project; build ends with `SUCCESS` (exit 0). If it fails on lint/rig config, the copied tsconfig/eslintrc from guest is the fix baseline — compare against `plugins/guest`.

- [ ] **Step 6: Commit**

```bash
git add plugins/yg-timesheet rush.json
git commit -m "spike: add yg-timesheet plugin ids package (one class)"
```

---

### Task 2: Model package `models/yg-timesheet`

**Files:**
- Create: `models/yg-timesheet/package.json`
- Create: `models/yg-timesheet/src/index.ts`
- Create: `models/yg-timesheet/tsconfig.json`, `models/yg-timesheet/.eslintrc.js`, `models/yg-timesheet/config/rig.json` (copied from `models/guest`)
- Modify: `rush.json` (one entry)

**Interfaces:**
- Consumes: `@hcengineering/yg-timesheet` → `ygTimesheet` default (ids), `Timesheet` interface, `ygTimesheetId` (Task 1).
- Produces: `@hcengineering/model-yg-timesheet` exporting `createModel (builder: Builder): void` and re-exporting `ygTimesheetId`. Task 3 imports `{ ygTimesheetId, createModel as ygTimesheetModel }` from it. Domain string: `'yg-timesheet'`.

- [ ] **Step 1: Write `models/yg-timesheet/package.json`**

```json
{
  "name": "@hcengineering/model-yg-timesheet",
  "version": "0.7.426",
  "main": "lib/index.js",
  "svelte": "src/index.ts",
  "types": "types/index.d.ts",
  "author": "YoungGlobes",
  "template": "@hcengineering/model-package",
  "license": "EPL-2.0",
  "scripts": {
    "build": "compile",
    "build:watch": "compile",
    "format": "format src",
    "_phase:build": "compile transpile src",
    "_phase:format": "format src",
    "_phase:validate": "compile validate",
    "_phase:test": "jest --passWithNoTests --silent --forceExit",
    "test": "jest --passWithNoTests --silent --forceExit"
  },
  "devDependencies": {
    "@hcengineering/platform-rig": "workspace:^0.7.426",
    "@typescript-eslint/eslint-plugin": "^6.21.0",
    "eslint-plugin-import": "^2.26.0",
    "eslint-plugin-promise": "^6.1.1",
    "eslint-plugin-n": "^15.4.0",
    "eslint": "^8.54.0",
    "@typescript-eslint/parser": "^6.21.0",
    "eslint-config-standard-with-typescript": "^40.0.0",
    "prettier": "^3.6.2",
    "typescript": "^5.9.3",
    "@types/node": "^22.18.1",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.5",
    "ts-jest": "^29.1.1"
  },
  "dependencies": {
    "@hcengineering/core": "workspace:^0.7.426",
    "@hcengineering/model": "workspace:^0.7.426",
    "@hcengineering/model-core": "workspace:^0.7.426",
    "@hcengineering/platform": "workspace:^0.7.426",
    "@hcengineering/contact": "workspace:^0.7.426",
    "@hcengineering/yg-timesheet": "workspace:^0.7.426"
  }
}
```

```bash
cp models/guest/tsconfig.json models/yg-timesheet/tsconfig.json
cp models/guest/.eslintrc.js  models/yg-timesheet/.eslintrc.js
mkdir -p models/yg-timesheet/config && cp models/guest/config/rig.json models/yg-timesheet/config/rig.json
```

- [ ] **Step 2: Write `models/yg-timesheet/src/index.ts`**

```ts
//
// YoungGlobes: yg-timesheet model (Phase 0 spike — one class, no UI, no triggers).
//
import type { Employee } from '@hcengineering/contact'
import { type Domain, type Ref, type Timestamp } from '@hcengineering/core'
import { type Builder, Model, Prop, TypeDate, TypeRef } from '@hcengineering/model'
import contact from '@hcengineering/contact'
import core, { TDoc } from '@hcengineering/model-core'
import ygTimesheet, { type Timesheet } from '@hcengineering/yg-timesheet'

export { ygTimesheetId } from '@hcengineering/yg-timesheet'

export const DOMAIN_YG_TIMESHEET = 'yg-timesheet' as Domain

@Model(ygTimesheet.class.Timesheet, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TTimesheet extends TDoc implements Timesheet {
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object)
    employee!: Ref<Employee>

  @Prop(TypeDate(), core.string.Object)
    weekStart!: Timestamp
}

export function createModel (builder: Builder): void {
  builder.createModel(TTimesheet)
}
```

Note for the implementer: if `compile` fails on `contact.mixin.Employee` (Employee is a mixin on Person in this version), check how another model references Employee: `grep -rn "TypeRef(contact.mixin.Employee)" models/ | head -3` and copy that exact form. If `core.string.Object` fails as a label, use the same label another model uses for a plain field (grep `@Prop(TypeDate(NULL` patterns in `models/tracker/src/types.ts` around `TTimeSpendReport` and mirror them).

- [ ] **Step 3: Register in `rush.json`**

Add after the `"@hcengineering/model-guest"` entry:

```json
    {
      "packageName": "@hcengineering/model-yg-timesheet",
      "projectFolder": "models/yg-timesheet",
      "shouldPublish": false
    },
```

- [ ] **Step 4: Build — verify it compiles**

```bash
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-timesheet
```
Expected: `SUCCESS` (exit 0).

- [ ] **Step 5: Commit**

```bash
git add models/yg-timesheet rush.json
git commit -m "spike: add model-yg-timesheet (TTimesheet in domain yg-timesheet)"
```

---

### Task 3: Register the model in `models/all`

**Files:**
- Modify: `models/all/package.json` (add dependency)
- Modify: `models/all/src/index.ts` (one import + one builders entry)

**Interfaces:**
- Consumes: `{ ygTimesheetId, createModel as ygTimesheetModel }` from `@hcengineering/model-yg-timesheet` (Task 2).
- Produces: model-all output now contains the `yg-timesheet` class txes → every image bundling model-all (workspace, tool) or running get-model (transactor/pod-server) carries it. Verified in Tasks 5–6.

- [ ] **Step 1: Add dependency to `models/all/package.json`**

In the `"dependencies"` object, add (keep alphabetical near other `model-*` entries):

```json
    "@hcengineering/model-yg-timesheet": "workspace:^0.7.426",
```

- [ ] **Step 2: Register in `models/all/src/index.ts`**

Add with the other model imports (near the `model-guest` import):

```ts
import { ygTimesheetId, createModel as ygTimesheetModel } from '@hcengineering/model-yg-timesheet'
```

Find `const builders: BuilderConfig[] = [` (~line 170) and add one entry at the END of the array (after the last existing entry, before `]`):

```ts
    [ygTimesheetModel, ygTimesheetId],
```

- [ ] **Step 3: Build model-all**

```bash
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js build --to @hcengineering/model-all
```
Expected: `SUCCESS`.

- [ ] **Step 4: Commit**

```bash
git add models/all/package.json models/all/src/index.ts
# pnpm lockfile changes from rush update belong with this change:
git add common/config/rush/pnpm-lock.yaml 2>/dev/null || true
git commit -m "spike: register yg-timesheet model in model-all"
```

(If earlier tasks' `rush update` already changed `common/config/rush/pnpm-lock.yaml` and it's still uncommitted, amend it into whichever commit introduced the dependency — or just include it here; it must be committed before CI runs.)

---

### Task 4: CI — build workspace + transactor + tool images (no prod deploy from spike branch)

**Files:**
- Modify: `.github/workflows/yg-front.yml` (on branch `yg/spike-model-trio`)

**Interfaces:**
- Consumes: repo state from Tasks 1–3 (model compiles).
- Produces: GHCR images `ghcr.io/youngglobes/workspace:v0.7.426-yg`, `ghcr.io/youngglobes/transactor:v0.7.426-yg`, `ghcr.io/youngglobes/tool:v0.7.426-yg` (Task 5 pulls them). `deploy-front` gated to `yg_develop` only.

- [ ] **Step 1: Add the spike branch to triggers and gate the deploy job**

In `.github/workflows/yg-front.yml`, change the `on.push.branches` list to:

```yaml
on:
  workflow_dispatch: {}
  push:
    branches:
      - yg_develop
      - yg/spike-model-trio
```

And on the `deploy-front:` job add a condition (first line under the job id):

```yaml
  deploy-front:
    if: github.ref == 'refs/heads/yg_develop'
    needs: build-front
```

- [ ] **Step 2: Add the backend-images job**

Append to the `jobs:` section (same file). It mirrors `build-front`'s setup steps exactly, then bundles/builds the three pods:

```yaml
  build-backend:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    env:
      REG: ghcr.io/${{ github.repository_owner }}
      TAG: v0.7.426-yg
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          fetch-tags: true

      - name: Free up disk space
        run: |
          sudo rm -rf /usr/share/dotnet /opt/ghc /usr/local/lib/android /usr/local/share/boost "$AGENT_TOOLSDIRECTORY" 2>/dev/null || true
          docker image prune -af || true
          df -h

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'

      - name: Rush install
        run: node common/scripts/install-run-rush.js install

      - name: Build backend dependency graphs
        run: node common/scripts/install-run-rush.js build --to @hcengineering/pod-workspace --to @hcengineering/pod-server --to @hcengineering/tool

      - name: Compute versions
        run: |
          echo "MODEL_VERSION=$(node common/scripts/show_version.js)" >> "$GITHUB_ENV"
          echo "VERSION=$(node common/scripts/show_tag.js)" >> "$GITHUB_ENV"

      - name: Bundle pods
        run: |
          cd pods/workspace && node ../../common/scripts/install-run-rushx.js bundle && cd ../..
          cd pods/server    && node ../../common/scripts/install-run-rushx.js bundle && cd ../..
          cd dev/tool       && node ../../common/scripts/install-run-rushx.js bundle && cd ../..

      - name: Log in to GHCR
        run: echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "${{ github.actor }}" --password-stdin

      - name: Build and push images
        run: |
          docker build -t "$REG/workspace:$TAG"  pods/workspace && docker push "$REG/workspace:$TAG"
          docker build -t "$REG/transactor:$TAG" pods/server    && docker push "$REG/transactor:$TAG"
          docker build -t "$REG/tool:$TAG"       dev/tool       && docker push "$REG/tool:$TAG"
          echo "Pushed workspace/transactor/tool :$TAG"
```

Implementer note: if a pod's `docker build` fails because its Dockerfile expects a different context or a pre-`package` step, look at that pod's `docker:build` script target (`common/scripts/docker_build.sh <name>`) and replicate what it stages (e.g. some pods need `rushx package` before docker build — run `git show HEAD:pods/workspace/package.json` and check for a `package` script; if present, add `node ../../common/scripts/install-run-rushx.js package` after bundle for that pod).

- [ ] **Step 3: Validate YAML, commit, push — CI is the test**

```bash
python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/yg-front.yml')); print('jobs:', list(d['jobs'].keys()))"
```
Expected: `jobs: ['build-front', 'deploy-front', 'build-backend']`

```bash
git add .github/workflows/yg-front.yml
git commit -m "spike: CI builds workspace/transactor/tool images; deploy gated to yg_develop"
git push -u origin yg/spike-model-trio
```

- [ ] **Step 4: Watch the run to completion**

```bash
# poll (repo is public; no auth needed)
curl -s "https://api.github.com/repos/youngglobes/yg-huly/actions/runs?branch=yg/spike-model-trio&per_page=3" \
 | python3 -c "import json,sys; [print(r['name'], r['status'], r.get('conclusion')) for r in json.load(sys.stdin)['workflow_runs']]"
```
Expected (after ~15–25 min): `Build custom front image (yg) completed success` — with `build-front` and `build-backend` green and `deploy-front` **skipped** (gated). If `build-backend` fails, read the failing step log in the Actions UI; the two known-likely fixes are the Dockerfile-context note in Step 2 and node version mismatch.

---

### Task 5: Verify the model is baked into the images

**Files:** none (verification only)

**Interfaces:**
- Consumes: GHCR images from Task 4.
- Produces: evidence for the spike gate (grep hits of the class id inside each image bundle).

- [ ] **Step 1: Pull and grep each image's bundle for the class id**

```bash
for img in workspace transactor tool; do
  echo "=== $img ==="
  docker pull -q ghcr.io/youngglobes/$img:v0.7.426-yg
  docker run --rm --entrypoint sh ghcr.io/youngglobes/$img:v0.7.426-yg -c \
    'grep -roc "yg-timesheet" /usr/src/app/ 2>/dev/null | grep -v ":0" | head -3'
done
```
Expected: at least one file with count ≥ 1 for EACH image (the model builder string `yg-timesheet` appears in the bundled model). Zero hits in any image = model not carried → STOP, debug model-all wiring (Task 3) before proceeding.

- [ ] **Step 2: Record results**

Append a `## Spike log` section to this plan file with the three grep outputs, and commit:

```bash
git add migration/docs/plans/2026-07-10-yg-timesheet-phase0-spike.md 2>/dev/null || true
# (plan lives on develop; if editing there, commit on develop — otherwise keep notes for Task 7's report)
```
(If working purely on the spike branch, just keep the outputs in a scratch note for Task 7.)

---

### Task 6: Local-stack verification — fresh workspace gets the class

**Files:**
- Create: `/home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost/compose.override.spike.yml` (LOCAL machine only — huly-migration repo, NOT committed to yg-huly)

**Interfaces:**
- Consumes: verified images (Task 5); the local huly-selfhost stack (`.env` → `huly_v7.conf`, `HOST_ADDRESS=localhost:8087`).
- Produces: a running local stack on the custom images with a freshly created workspace; upgrade-workspace output; the spike gate's final evidence.

- [ ] **Step 1: Write the local override**

`/home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost/compose.override.spike.yml`:

```yaml
services:
  workspace:
    image: ghcr.io/youngglobes/workspace:v0.7.426-yg
  transactor:
    image: ghcr.io/youngglobes/transactor:v0.7.426-yg
```

- [ ] **Step 2: Start a FRESH local stack on the custom images**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -f compose.yml -f compose.override.spike.yml down -v
docker compose -f compose.yml -f compose.override.spike.yml up -d
sleep 45
docker compose ps --status running -q | wc -l
```
Expected: all core services running (≈14). This is the LOCAL stack (`localhost:8087`) — production is untouched.

- [ ] **Step 3: Create a workspace using the CUSTOM tool image**

`run-tool.sh` hardcodes the stock tool image, so run the tool container directly (same env wiring as run-tool.sh, custom image):

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
source huly_v7.conf
docker run --rm -t --network "${DOCKER_NAME}_huly_net" \
  -e SERVER_SECRET="$SECRET" -e DB_URL="$CR_DB_URL" -e ACCOUNT_DB_URL="$CR_DB_URL" \
  -e STORAGE_CONFIG="minio|minio?accessKey=minioadmin&secretKey=minioadmin" \
  -e ACCOUNTS_URL="http://account:3000" -e TRANSACTOR_URL="ws://transactor:3333" \
  ghcr.io/youngglobes/tool:v0.7.426-yg \
  bundle.js create-account spike@local -p spike123 -f Spike -l Test

docker run --rm -t --network "${DOCKER_NAME}_huly_net" \
  -e SERVER_SECRET="$SECRET" -e DB_URL="$CR_DB_URL" -e ACCOUNT_DB_URL="$CR_DB_URL" \
  -e STORAGE_CONFIG="minio|minio?accessKey=minioadmin&secretKey=minioadmin" \
  -e ACCOUNTS_URL="http://account:3000" -e TRANSACTOR_URL="ws://transactor:3333" \
  ghcr.io/youngglobes/tool:v0.7.426-yg \
  bundle.js create-workspace spiketest email:spike@local
```
Expected: both commands exit 0; create-workspace logs workspace creation + model application without errors.

- [ ] **Step 4: Verify the class exists in the workspace model (the gate)**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
source huly_v7.conf
# model transactions live in the workspace DB; search for our class id string:
docker compose exec -T cockroach cockroach sql --url "${CR_DB_URL}?sslmode=require" \
  -e "SELECT count(*) FROM public.tx WHERE data::STRING LIKE '%yg-timesheet:class:Timesheet%';" 2>/dev/null \
  || docker compose exec -T cockroach cockroach sql --url "${CR_DB_URL}?sslmode=require" \
  -e "SHOW TABLES FROM public;" | head -30
```
Expected: count ≥ 1 (a CreateDoc tx for the class). If the first query errors because the tx table has a different name/schema, use the fallback `SHOW TABLES` output to locate the model/tx table (look for `tx` / `model`), then rerun the LIKE query against it — record the actual table name in the spike log.

Additional soft checks:
```bash
docker compose logs --since=10m --no-log-prefix transactor | grep -icE "error|failed" || echo 0
curl -s -o /dev/null -w "front: %{http_code}\n" http://localhost:8087/
```
Expected: 0 (or only benign) errors; front → 200.

- [ ] **Step 5: Stock-tool interaction check (the re-migration risk)**

Run `upgrade-workspace` from the STOCK tool against this workspace and observe whether our model survives (this simulates the post-12th re-migration path if we forget the custom tool):

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
./run-tool.sh upgrade-workspace spiketest
docker compose exec -T cockroach cockroach sql --url "${CR_DB_URL}?sslmode=require" \
  -e "SELECT count(*) FROM public.tx WHERE data::STRING LIKE '%yg-timesheet:class:Timesheet%';"
```
Record the outcome in the spike log:
- count unchanged → stock-tool upgrades are additive (custom tool needed only for create, low risk)
- count dropped / errors → **stock tool strips or breaks the custom model** → Phase 1 MUST pin the custom tool image in `run-tool.sh`/runbooks. Either result is a valid spike finding; neither blocks the gate.

- [ ] **Step 6: Tear down the local spike stack**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -f compose.yml -f compose.override.spike.yml down -v
rm compose.override.spike.yml
```

---

### Task 7: Spike report + merge gate

**Files:**
- Modify: `migration/docs/2026-07-10-huly-timesheet-attendance-design.md` (on `develop`: §4 architecture — add the tool image + spike findings)
- Modify: this plan file (append `## Spike log` with all verification outputs)

**Interfaces:**
- Consumes: all evidence from Tasks 5–6.
- Produces: updated design doc; spike branch merged to `yg_develop` (front auto-deploys — inert model additions; workspace/transactor/tool images published but NOT deployed to prod compose until Phase 1); the go/no-go decision for Phase 1 planning.

- [ ] **Step 1: Update the design doc on `develop`**

In `migration/docs/2026-07-10-huly-timesheet-attendance-design.md` §4, change "a **trio**" wording to the four-image set and add a "Spike findings (2026-07-XX)" subsection with: images built ✓/✗, model-in-image grep results, fresh-workspace class creation ✓/✗, stock-tool upgrade behavior, and any deviations discovered. Commit on `develop`:

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git switch develop && git pull --ff-only origin develop
# edit the design doc + this plan file (append Spike log)
git add migration/docs/
git commit -m "spike findings: record model-pipeline verification results in design + plan"
git push origin develop
```

- [ ] **Step 2: Merge the spike branch into `yg_develop`** (only if all gates passed)

```bash
git switch yg_develop && git pull --ff-only origin yg_develop
git merge --no-ff yg/spike-model-trio -m "Merge spike: yg-timesheet skeleton model + backend image CI"
git push origin yg_develop
```
Expected: CI runs on `yg_develop` — `build-front` + `build-backend` green, `deploy-front` deploys front to production (model additions are inert without UI; production compose still runs stock workspace/transactor). Confirm site still 200 after the deploy.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -m 15 https://huly.youngglobe.com/
```

- [ ] **Step 3: Delete the spike branch, report go/no-go**

```bash
git push origin --delete yg/spike-model-trio
git branch -d yg/spike-model-trio
```
Deliverable: a short go/no-go summary. **Go** = proceed to write the Phase 1 (timesheet module) implementation plan. **No-go** = design §4 must be revisited with the specific failure.

---

## Self-review notes

- Spec coverage: this plan implements design §4 "Phase 0 spike" fully (CI images incl. the tool-image discovery, model application on fresh workspace, stock-tool risk check) and deliberately nothing of Phases 1–3 (separate plans after the gate).
- Uncertainty is handled with concrete fallback instructions (Dockerfile context, Employee mixin reference, tx table name) rather than placeholders.
- Type/name consistency: `ygTimesheetId` / `@hcengineering/yg-timesheet` / `@hcengineering/model-yg-timesheet` / `DOMAIN_YG_TIMESHEET` / class id `yg-timesheet:class:Timesheet` used consistently across Tasks 1–6.
