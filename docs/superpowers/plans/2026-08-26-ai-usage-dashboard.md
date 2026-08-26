# AI Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a third admin surface in YG Portal showing where the shared Claude Max plan goes, fed by the existing `yg-usage.sh` collector through a new ingest/report sidecar.

**Architecture:** Two planes. A dependency-free Node sidecar (`usage`, port 4700, behind nginx `/_usage`) owns ingest, a SQLite store, the project mapping rules and a report API; facts are stored raw and mapping resolves at read time so a re-map is retroactive. The fork gets one `workbench.class.Application` (alias `yg-ai-usage`, `accessLevel: Maintainer`) with a dashboard special and a config special, which fetch that API with the caller's Huly token.

**Tech Stack:** Sidecar: Node 24 (`node:24-alpine`), `node:sqlite`, `node:http`, `node:crypto`, `node:test`. **Zero npm dependencies.** Fork: Svelte 4, TypeScript, jest + ts-jest, Huly platform plugins.

**Spec:** `docs/superpowers/specs/2026-08-26-ai-usage-dashboard-design.md` (this repo). Read it before Task 1; this plan argues from it.

**Two repos.** Tasks 1-7 are in the ops repo `~/dev/client-projects/huly-migration`. Tasks 8-13 are in the fork `~/dev/client-projects/yg-huly` on branch `yg_beta`. Each task says which. Commit in the repo the task names, never both in one commit.

## Global Constraints

- **Zero npm dependencies in the sidecar.** No `package.json` `dependencies`, no `node_modules`, no native builds. Only `node:`-prefixed builtins. This is what keeps it a ~50 MB process on a 7.6 GB box.
- **Node 24 is required** for `node:sqlite` without a flag. The host has Node v20, so **all sidecar tests run inside the container image**, never with the host `node`. Task 1 builds the wrapper that does this.
- **Never change `~/dev/claude-usage-fleet/yg-usage.sh`.** Its payload contract is an input, not a variable.
- **No em-dashes** in any UI copy, comment, commit message or doc. Use commas, parentheses or semicolons.
- **Facts are stored raw.** No mapping rule may be consulted at write time. Mapping happens only in the report path.
- **Ingest deletes by `device_id`, never by `(device_id, account_uuid)`.** See spec 5.2.
- **Device identity is the token**, never the payload's `machine.name`.
- **Two invariants ported from `dashboard.template.html` that must not be "simplified":** (1) the share and cost denominator is the selected account's whole period, not the filtered subset; (2) the model-filter footnote stays, because hours and sessions have no per-model dimension.
- **Workspace uuid** (`YG_USAGE_WORKSPACE`) and `SECRET` come from `huly_v7.conf` on the machine running the stack. Never hardcode them in a committed file.
- Sidecar paths in this plan are relative to `~/dev/client-projects/huly-migration/huly-selfhost/usage-sidecar/`.

---

## File Structure

**Ops repo** (`huly-migration`)

| File | Responsibility |
|---|---|
| `huly-selfhost/usage-sidecar/schema.sql` | the six tables and three indexes, nothing else |
| `huly-selfhost/usage-sidecar/db.js` | open the database, apply the schema, expose the handle |
| `huly-selfhost/usage-sidecar/paths.js` | pure: home-path normalization, rule compile, longest-prefix resolve |
| `huly-selfhost/usage-sidecar/ingest.js` | pure-ish: validate a schema-1 payload, replace a window transactionally |
| `huly-selfhost/usage-sidecar/auth.js` | pure-ish: verify a Huly JWT, resolve role, cache the decision |
| `huly-selfhost/usage-sidecar/report.js` | build the report envelope, apply mapping at read time |
| `huly-selfhost/usage-sidecar/config.js` | rule / account / device CRUD used by the config page |
| `huly-selfhost/usage-sidecar/server.js` | HTTP routing and nothing else; every handler delegates |
| `huly-selfhost/usage-sidecar/Dockerfile` | `node:24-alpine`, copy, run |
| `huly-selfhost/usage-sidecar/run-tests.sh` | run `node --test` inside the image |
| `huly-selfhost/usage-sidecar/test/*.test.js` | one file per module above |
| `huly-selfhost/compose.override.beta.yml` | add the `usage` service (modify) |
| `huly-selfhost/.huly.nginx.beta` | beta nginx with `location /_usage` |
| `notes/ai-usage-runbook.md` | enroll a device, rotate a token, restore the DB |

Split by responsibility: `paths.js` is pure string work and is the most-tested file; `auth.js` is the security boundary and is kept away from routing so it can be tested without a socket; `server.js` stays thin so a route change never risks the ingest transaction.

**Fork** (`yg-huly`, branch `yg_beta`)

| File | Responsibility |
|---|---|
| `plugins/yg-timesheet/src/index.ts` | 2 component ids, new `IntlString`s (modify) |
| `plugins/yg-timesheet-assets/lang/en.json`, `ru.json` | the new strings (modify) |
| `models/yg-timesheet/src/index.ts` | the `yg-ai-usage` Application doc (modify) |
| `plugins/yg-timesheet-resources/src/index.ts` | register both components (modify) |
| `plugins/yg-timesheet-resources/src/utils/ai-usage.ts` | pure aggregation ported from the template |
| `plugins/yg-timesheet-resources/src/utils/ai-usage-api.ts` | fetch helpers, Bearer token, base URL |
| `plugins/yg-timesheet-resources/src/components/AiUsage.svelte` | dashboard shell: fetch, filter state, sections |
| `plugins/yg-timesheet-resources/src/components/aiusage/FilterBar.svelte` | the six filters |
| `plugins/yg-timesheet-resources/src/components/aiusage/Tiles.svelte` | six stat tiles |
| `plugins/yg-timesheet-resources/src/components/aiusage/ProjectLedger.svelte` | report 1 |
| `plugins/yg-timesheet-resources/src/components/aiusage/Blocks.svelte` | report 2 |
| `plugins/yg-timesheet-resources/src/components/aiusage/Surfaces.svelte` | report 3 |
| `plugins/yg-timesheet-resources/src/components/aiusage/Models.svelte` | report 4 |
| `plugins/yg-timesheet-resources/src/components/AiUsageConfig.svelte` | three config panels |
| `plugins/yg-timesheet-resources/src/__tests__/ai-usage.test.ts` | jest |

One component per report, matching how `components/dashboard/*.svelte` is already split in this plugin. `AiUsage.svelte` holds fetch and filter state and passes plain arrays down, so every report component is dumb and the maths stays in `utils/ai-usage.ts`.

---

## Task 1: Sidecar skeleton, schema, and a test harness that runs in Node 24

**Repo:** `huly-migration`

**Files:**
- Create: `huly-selfhost/usage-sidecar/schema.sql`
- Create: `huly-selfhost/usage-sidecar/db.js`
- Create: `huly-selfhost/usage-sidecar/Dockerfile`
- Create: `huly-selfhost/usage-sidecar/run-tests.sh`
- Create: `huly-selfhost/usage-sidecar/test/db.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `db.js` exports `open(path) -> DatabaseSync`. Every later task opens a test database with `open(':memory:')`.

- [ ] **Step 1: Create the directory and write the schema**

```bash
mkdir -p ~/dev/client-projects/huly-migration/huly-selfhost/usage-sidecar/test
```

`schema.sql` (verbatim from spec section 5):

```sql
CREATE TABLE IF NOT EXISTS device (
  id INTEGER PRIMARY KEY, label TEXT NOT NULL UNIQUE, token_sha256 TEXT NOT NULL UNIQUE,
  os TEXT, created INTEGER NOT NULL, last_seen INTEGER, revoked_at INTEGER );

CREATE TABLE IF NOT EXISTS account (
  uuid TEXT PRIMARY KEY, label TEXT, email TEXT,
  employee_ref TEXT, employee_name TEXT,
  plan_cents INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER, last_seen INTEGER );

CREATE TABLE IF NOT EXISTS fact_token (
  hour INTEGER NOT NULL, device_id INTEGER NOT NULL, account_uuid TEXT,
  cwd TEXT NOT NULL, cwd_norm TEXT NOT NULL, hint TEXT, surface TEXT NOT NULL, model TEXT NOT NULL,
  req INTEGER NOT NULL, t_in INTEGER NOT NULL, t_out INTEGER NOT NULL,
  t_cw INTEGER NOT NULL, t_cr INTEGER NOT NULL,
  PRIMARY KEY (hour, device_id, cwd, surface, model) );

CREATE TABLE IF NOT EXISTS fact_activity (
  hour INTEGER NOT NULL, device_id INTEGER NOT NULL, account_uuid TEXT,
  cwd TEXT NOT NULL, cwd_norm TEXT NOT NULL, hint TEXT, surface TEXT NOT NULL, sec INTEGER NOT NULL,
  PRIMARY KEY (hour, device_id, cwd, surface) );

CREATE TABLE IF NOT EXISTS fact_session (
  session_id TEXT NOT NULL, device_id INTEGER NOT NULL, account_uuid TEXT,
  cwd TEXT NOT NULL, cwd_norm TEXT NOT NULL, hint TEXT, surface TEXT,
  first INTEGER NOT NULL, last INTEGER NOT NULL, tokens INTEGER NOT NULL,
  PRIMARY KEY (session_id, device_id) );

CREATE TABLE IF NOT EXISTS map_rule (
  id INTEGER PRIMARY KEY, prefix TEXT NOT NULL UNIQUE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('project','label')),
  project_id TEXT, project_name TEXT, label TEXT, updated INTEGER );

CREATE TABLE IF NOT EXISTS ingest_log (
  id INTEGER PRIMARY KEY, device_id INTEGER, account_uuid TEXT,
  win_from INTEGER, win_to INTEGER,
  n_tokens INTEGER, n_activity INTEGER, n_sessions INTEGER,
  dup_dropped INTEGER, received INTEGER );

CREATE INDEX IF NOT EXISTS ix_token_hour    ON fact_token(hour);
CREATE INDEX IF NOT EXISTS ix_activity_hour ON fact_activity(hour);
CREATE INDEX IF NOT EXISTS ix_session_first ON fact_session(first);
```

- [ ] **Step 2: Write the failing test**

`test/db.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { open } = require('../db.js')

test('open applies the schema and every table exists', () => {
  const db = open(':memory:')
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all().map((r) => r.name)
  assert.deepStrictEqual(names, [
    'account', 'device', 'fact_activity', 'fact_session', 'fact_token', 'ingest_log', 'map_rule'
  ])
})

test('open is idempotent', () => {
  const db = open(':memory:')
  assert.doesNotThrow(() => { open(':memory:') })
  assert.ok(db)
})

test('map_rule rejects an unknown target_kind', () => {
  const db = open(':memory:')
  assert.throws(() => {
    db.prepare('INSERT INTO map_rule (prefix, target_kind) VALUES (?, ?)').run('~/x', 'nonsense')
  })
})
```

- [ ] **Step 3: Write the Dockerfile and the test wrapper**

`Dockerfile`:

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY . .
EXPOSE 4700
CMD ["node", "server.js"]
```

`run-tests.sh`:

```bash
#!/usr/bin/env bash
# Run the sidecar test suite inside node:24-alpine.
#
# The host runs Node 20, which has no `node:sqlite`. Running these tests with the host node
# fails with ERR_UNKNOWN_BUILTIN_MODULE and looks like a broken require. Always use this script.
set -euo pipefail
cd "$(dirname "$0")"
exec docker run --rm -v "$PWD":/app -w /app node:24-alpine node --test "$@"
```

```bash
chmod +x ~/dev/client-projects/huly-migration/huly-selfhost/usage-sidecar/run-tests.sh
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `./run-tests.sh test/db.test.js`
Expected: FAIL, `Cannot find module '../db.js'`.

- [ ] **Step 5: Write the minimal implementation**

`db.js`:

```js
const { DatabaseSync } = require('node:sqlite')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const SCHEMA = readFileSync(join(__dirname, 'schema.sql'), 'utf8')

// WAL keeps the hourly ingest write from blocking a report read. synchronous=NORMAL is the
// right trade for telemetry: a crash can lose the last transaction, and the collector re-posts
// a rolling 3-day window every hour, so anything lost comes back on its own.
function open (path) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA synchronous=NORMAL')
  db.exec(SCHEMA)
  return db
}

module.exports = { open }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `./run-tests.sh test/db.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
cd ~/dev/client-projects/huly-migration
git add huly-selfhost/usage-sidecar
git commit -m "feat(usage): sidecar skeleton, SQLite schema, containerised test harness"
```

---

## Task 2: Path normalization and longest-prefix mapping

**Repo:** `huly-migration`

**Files:**
- Create: `huly-selfhost/usage-sidecar/paths.js`
- Create: `huly-selfhost/usage-sidecar/test/paths.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normPath(cwd: string) -> string` (home prefix folded to `~`, backslashes to `/`)
  - `compileRules(rows: Array<{prefix,target_kind,project_name,label}>) -> Array<rule>` (sorted longest prefix first)
  - `resolveProject(rules: Array<rule>, cwdNorm: string) -> string` (the mapped label, or `'Unmapped'`)

- [ ] **Step 1: Write the failing test**

`test/paths.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { normPath, compileRules, resolveProject } = require('../paths.js')

test('normPath folds every home form to ~', () => {
  assert.strictEqual(normPath('/home/karthi_0008/dev/x'), '~/dev/x')
  assert.strictEqual(normPath('/Users/karthi/dev/x'), '~/dev/x')
  assert.strictEqual(normPath('/c/Users/karthi/dev/x'), '~/dev/x')
  assert.strictEqual(normPath('C:\\Users\\karthi\\dev\\x'), '~/dev/x')
})

test('normPath leaves a non-home path and the unknown marker alone', () => {
  assert.strictEqual(normPath('/opt/work/x'), '/opt/work/x')
  assert.strictEqual(normPath('?'), '?')
  assert.strictEqual(normPath(''), '')
  assert.strictEqual(normPath(undefined), '')
})

test('normPath maps the WSL and Windows copy of one checkout to the same string', () => {
  assert.strictEqual(
    normPath('/home/karthi_0008/dev/client-projects/yg-huly'),
    normPath('C:\\Users\\karthi\\dev\\client-projects\\yg-huly')
  )
})

test('resolveProject picks the longest matching prefix, not the first', () => {
  const rules = compileRules([
    { prefix: '~/dev', target_kind: 'label', label: 'Everything' },
    { prefix: '~/dev/client-projects/yg-huly', target_kind: 'project', project_name: 'YG Portal' }
  ])
  assert.strictEqual(resolveProject(rules, '~/dev/client-projects/yg-huly'), 'YG Portal')
  assert.strictEqual(resolveProject(rules, '~/dev/client-projects/yg-huly/plugins'), 'YG Portal')
  assert.strictEqual(resolveProject(rules, '~/dev/other'), 'Everything')
})

test('resolveProject matches on a path boundary, not a bare string prefix', () => {
  const rules = compileRules([{ prefix: '~/dev/foo', target_kind: 'label', label: 'Foo' }])
  assert.strictEqual(resolveProject(rules, '~/dev/foo'), 'Foo')
  assert.strictEqual(resolveProject(rules, '~/dev/foo/bar'), 'Foo')
  assert.strictEqual(resolveProject(rules, '~/dev/foobar'), 'Unmapped')
})

test('resolveProject tolerates a trailing slash in a stored rule', () => {
  const rules = compileRules([{ prefix: '~/dev/yg-projects/', target_kind: 'label', label: 'Internal' }])
  assert.strictEqual(resolveProject(rules, '~/dev/yg-projects/portal'), 'Internal')
  assert.strictEqual(resolveProject(rules, '~/dev/yg-projects'), 'Internal')
})

test('no rule resolves to Unmapped', () => {
  assert.strictEqual(resolveProject(compileRules([]), '~/dev/anything'), 'Unmapped')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./run-tests.sh test/paths.test.js`
Expected: FAIL, `Cannot find module '../paths.js'`.

- [ ] **Step 3: Write the minimal implementation**

`paths.js`:

```js
// Pure string work. No database, no I/O, so every branch is cheap to test.

// The same checkout has a different absolute path on WSL and on Windows. Folding the home
// prefix to ~ means ONE rule covers both machines instead of two that drift apart.
function normPath (cwd) {
  let p = String(cwd == null ? '' : cwd).replace(/\\/g, '/')
  p = p.replace(/^[A-Za-z]:\/Users\/[^/]+/, '~')
  p = p.replace(/^\/[A-Za-z]\/Users\/[^/]+/, '~')
  p = p.replace(/^\/home\/[^/]+/, '~')
  p = p.replace(/^\/Users\/[^/]+/, '~')
  return p
}

// Longest prefix wins, so a specific project rule beats a broad directory rule regardless of
// the order they were entered in. Rule counts are in the tens, so sorting per request is free.
function compileRules (rows) {
  return rows
    .map((r) => ({ ...r, prefix: String(r.prefix).replace(/\/+$/, '') }))
    .sort((a, b) => b.prefix.length - a.prefix.length)
}

// Boundary match, not a bare startsWith: ~/dev/foo must not swallow ~/dev/foobar.
function resolveProject (rules, cwdNorm) {
  const p = String(cwdNorm == null ? '' : cwdNorm)
  for (const r of rules) {
    if (p === r.prefix || p.startsWith(r.prefix + '/')) {
      const target = r.target_kind === 'project' ? r.project_name : r.label
      return target == null || target === '' ? 'Unmapped' : target
    }
  }
  return 'Unmapped'
}

module.exports = { normPath, compileRules, resolveProject }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./run-tests.sh test/paths.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/client-projects/huly-migration
git add huly-selfhost/usage-sidecar/paths.js huly-selfhost/usage-sidecar/test/paths.test.js
git commit -m "feat(usage): home-path normalization and longest-prefix project mapping"
```

---

## Task 3: Payload validation

**Repo:** `huly-migration`

**Files:**
- Create: `huly-selfhost/usage-sidecar/ingest.js`
- Create: `huly-selfhost/usage-sidecar/test/validate.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `validatePayload(payload) -> string | null` (an error message, or `null` when valid). Task 4 adds `applyPayload` to the same file.

- [ ] **Step 1: Write the failing test**

`test/validate.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { validatePayload } = require('../ingest.js')

const HOUR = 1755000000 - (1755000000 % 3600)
function good () {
  return {
    schema: 1,
    collector: 'yg-usage/1.0.0',
    account: { id: 'acct-uuid', label: 'Karthi', email: 'k@yg.com' },
    machine: { name: 'KARTHI-WSL', os: 'wsl' },
    generated_utc: '2026-08-26T04:00:00Z',
    tz: '+0530',
    window: { from: HOUR, to: HOUR + 3 * 86400, days: 3 },
    idle_sec: 300,
    stats: { kept: 10, duplicates_dropped: 5 },
    tokens: [[HOUR, '/home/k/dev/a', 'a', 'terminal', 'opus-5', 3, 100, 200, 300, 400]],
    activity: [[HOUR, '/home/k/dev/a', 'a', 'terminal', 1800]],
    sessions: [['abcd1234', '/home/k/dev/a', 'a', 'terminal', HOUR, HOUR + 60, 1000]]
  }
}

test('a well-formed schema-1 payload validates', () => {
  assert.strictEqual(validatePayload(good()), null)
})

test('empty fact arrays are valid (an idle machine still reports)', () => {
  const p = good(); p.tokens = []; p.activity = []; p.sessions = []
  assert.strictEqual(validatePayload(p), null)
})

test('a future collector adding a key does not break ingest', () => {
  const p = good(); p.something_new = { a: 1 }
  assert.strictEqual(validatePayload(p), null)
})

test('rejects a wrong schema version', () => {
  const p = good(); p.schema = 2
  assert.match(validatePayload(p), /schema/)
})

test('rejects a missing window', () => {
  const p = good(); delete p.window
  assert.match(validatePayload(p), /window/)
})

test('rejects an inverted window', () => {
  const p = good(); p.window = { from: HOUR + 3600, to: HOUR, days: 1 }
  assert.match(validatePayload(p), /window/)
})

test('rejects a window longer than 31 days', () => {
  const p = good(); p.window = { from: HOUR, to: HOUR + 32 * 86400, days: 32 }
  assert.match(validatePayload(p), /too long/)
})

test('rejects a token row of the wrong arity', () => {
  const p = good(); p.tokens = [[HOUR, '/home/k/dev/a', 'a', 'terminal', 'opus-5']]
  assert.match(validatePayload(p), /tokens/)
})

test('rejects a negative or non-finite number in a row', () => {
  const p = good(); p.tokens[0][6] = -5
  assert.match(validatePayload(p), /tokens/)
  const q = good(); q.activity[0][4] = Number.NaN
  assert.match(validatePayload(q), /activity/)
})

test('rejects a missing account id', () => {
  const p = good(); p.account = { label: 'x' }
  assert.match(validatePayload(p), /account/)
})

test('rejects a non-object', () => {
  assert.match(validatePayload(null), /object/)
  assert.match(validatePayload([]), /object/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./run-tests.sh test/validate.test.js`
Expected: FAIL, `Cannot find module '../ingest.js'`.

- [ ] **Step 3: Write the minimal implementation**

`ingest.js`:

```js
const MAX_WINDOW_SEC = 31 * 86400

// Row shapes are fixed by yg-usage.sh schema 1 and must not drift.
const ARITY = { tokens: 10, activity: 5, sessions: 7 }
// Which columns of each row must be finite non-negative numbers.
const NUMERIC = { tokens: [0, 5, 6, 7, 8, 9], activity: [0, 4], sessions: [4, 5, 6] }

function num (v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

// Returns an error string, or null when the payload is acceptable.
// Every rejection here becomes a 400, which the collector treats as "drop, do not queue".
// That is correct: a malformed payload will still be malformed on the next attempt.
function validatePayload (p) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return 'payload must be an object'
  if (p.schema !== 1) return `unsupported schema: ${String(p.schema)}`
  if (p.account === null || typeof p.account !== 'object' || typeof p.account.id !== 'string' || p.account.id === '') {
    return 'account.id is required'
  }
  const w = p.window
  if (w === null || typeof w !== 'object' || !num(w.from) || !num(w.to)) return 'window.from and window.to are required'
  if (w.to <= w.from) return 'window is inverted or empty'
  if (w.to - w.from > MAX_WINDOW_SEC) return 'window is too long'

  for (const key of ['tokens', 'activity', 'sessions']) {
    const rows = p[key]
    if (!Array.isArray(rows)) return `${key} must be an array`
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== ARITY[key]) return `${key}: row has the wrong shape`
      for (const i of NUMERIC[key]) if (!num(row[i])) return `${key}: column ${i} must be a non-negative number`
    }
  }
  return null
}

module.exports = { validatePayload, MAX_WINDOW_SEC }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./run-tests.sh test/validate.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/client-projects/huly-migration
git add huly-selfhost/usage-sidecar/ingest.js huly-selfhost/usage-sidecar/test/validate.test.js
git commit -m "feat(usage): schema-1 payload validation"
```

---

## Task 4: Window-replacement ingest

**Repo:** `huly-migration`

**Files:**
- Modify: `huly-selfhost/usage-sidecar/ingest.js`
- Create: `huly-selfhost/usage-sidecar/test/ingest.test.js`

**Interfaces:**
- Consumes: `open` from Task 1, `normPath` from Task 2, `validatePayload` from Task 3.
- Produces: `applyPayload(db, deviceId, payload, now) -> { n_tokens, n_activity, n_sessions }`. Task 7 calls it from the route.

- [ ] **Step 1: Write the failing test**

`test/ingest.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { open } = require('../db.js')
const { applyPayload } = require('../ingest.js')

const H = 1755000000 - (1755000000 % 3600)
const NOW = H + 4 * 86400

function db () {
  const d = open(':memory:')
  d.prepare('INSERT INTO device (id, label, token_sha256, created) VALUES (1, ?, ?, ?)')
    .run('KARTHI-WSL', 'hash1', NOW)
  d.prepare('INSERT INTO device (id, label, token_sha256, created) VALUES (2, ?, ?, ?)')
    .run('KARTHI-WIN', 'hash2', NOW)
  return d
}

function payload (over = {}) {
  return {
    schema: 1,
    account: { id: 'acct-a', label: 'Karthi', email: 'k@yg.com' },
    machine: { name: 'KARTHI-WSL', os: 'wsl' },
    tz: '+0530',
    window: { from: H, to: H + 3 * 86400, days: 3 },
    idle_sec: 300,
    stats: { kept: 1, duplicates_dropped: 7 },
    tokens: [[H, '/home/k/dev/a', 'a', 'terminal', 'opus-5', 3, 100, 200, 300, 400]],
    activity: [[H, '/home/k/dev/a', 'a', 'terminal', 1800]],
    sessions: [['sess1', '/home/k/dev/a', 'a', 'terminal', H, H + 60, 1000]],
    ...over
  }
}

const count = (d, t) => d.prepare(`SELECT count(*) c FROM ${t}`).get().c

test('applyPayload stores rows and normalizes the path', () => {
  const d = db()
  applyPayload(d, 1, payload(), NOW)
  const row = d.prepare('SELECT * FROM fact_token').get()
  assert.strictEqual(row.cwd, '/home/k/dev/a')
  assert.strictEqual(row.cwd_norm, '~/dev/a')
  assert.strictEqual(row.account_uuid, 'acct-a')
  assert.strictEqual(row.t_cr, 400)
})

test('re-posting the same payload is idempotent', () => {
  const d = db()
  applyPayload(d, 1, payload(), NOW)
  applyPayload(d, 1, payload(), NOW)
  assert.strictEqual(count(d, 'fact_token'), 1)
  assert.strictEqual(count(d, 'fact_activity'), 1)
  assert.strictEqual(count(d, 'fact_session'), 1)
})

test('a bucket that disappears from a re-post is removed, not left as a ghost', () => {
  const d = db()
  applyPayload(d, 1, payload({
    tokens: [
      [H, '/home/k/dev/a', 'a', 'terminal', 'opus-5', 3, 100, 200, 300, 400],
      [H + 3600, '/home/k/dev/b', 'b', 'terminal', 'opus-5', 1, 1, 1, 1, 1]
    ]
  }), NOW)
  assert.strictEqual(count(d, 'fact_token'), 2)
  applyPayload(d, 1, payload(), NOW)
  assert.strictEqual(count(d, 'fact_token'), 1)
  assert.strictEqual(d.prepare('SELECT cwd FROM fact_token').get().cwd, '/home/k/dev/a')
})

test('replacement is scoped to the window, so older history survives', () => {
  const d = db()
  applyPayload(d, 1, payload({
    window: { from: H - 10 * 86400, to: H - 7 * 86400, days: 3 },
    tokens: [[H - 9 * 86400, '/home/k/dev/old', 'old', 'terminal', 'opus-5', 1, 1, 1, 1, 1]],
    activity: [], sessions: []
  }), NOW)
  applyPayload(d, 1, payload(), NOW)
  assert.strictEqual(count(d, 'fact_token'), 2)
})

test('replacement is scoped to the device, so another machine is untouched', () => {
  const d = db()
  applyPayload(d, 2, payload({ machine: { name: 'KARTHI-WIN', os: 'windows' } }), NOW)
  applyPayload(d, 1, payload(), NOW)
  assert.strictEqual(count(d, 'fact_token'), 2)
})

test('a re-stamped account on the same device does not double count the hours', () => {
  const d = db()
  applyPayload(d, 1, payload(), NOW)
  applyPayload(d, 1, payload({ account: { id: 'acct-b', label: 'Sevvel', email: 's@yg.com' } }), NOW)
  assert.strictEqual(count(d, 'fact_token'), 1)
  assert.strictEqual(d.prepare('SELECT account_uuid FROM fact_token').get().account_uuid, 'acct-b')
})

test('a session that extends across posts keeps one row with the later end', () => {
  const d = db()
  applyPayload(d, 1, payload(), NOW)
  applyPayload(d, 1, payload({
    sessions: [['sess1', '/home/k/dev/a', 'a', 'terminal', H, H + 7200, 5000]]
  }), NOW)
  assert.strictEqual(count(d, 'fact_session'), 1)
  const s = d.prepare('SELECT * FROM fact_session').get()
  assert.strictEqual(s.last, H + 7200)
  assert.strictEqual(s.tokens, 5000)
})

test('device last_seen, account and ingest_log are all recorded', () => {
  const d = db()
  applyPayload(d, 1, payload(), NOW)
  assert.strictEqual(d.prepare('SELECT last_seen FROM device WHERE id=1').get().last_seen, NOW)
  assert.strictEqual(d.prepare('SELECT os FROM device WHERE id=1').get().os, 'wsl')
  const a = d.prepare('SELECT * FROM account').get()
  assert.strictEqual(a.uuid, 'acct-a')
  assert.strictEqual(a.email, 'k@yg.com')
  const log = d.prepare('SELECT * FROM ingest_log').get()
  assert.strictEqual(log.dup_dropped, 7)
  assert.strictEqual(log.n_tokens, 1)
})

test('an invalid payload throws and writes nothing', () => {
  const d = db()
  assert.throws(() => { applyPayload(d, 1, payload({ schema: 9 }), NOW) })
  assert.strictEqual(count(d, 'fact_token'), 0)
  assert.strictEqual(count(d, 'ingest_log'), 0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./run-tests.sh test/ingest.test.js`
Expected: FAIL, `applyPayload is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `ingest.js` (and extend the `module.exports` at the bottom of the file):

```js
const { normPath } = require('./paths.js')

// Column layout of each row in a schema-1 payload.
const T = { hour: 0, cwd: 1, hint: 2, surface: 3, model: 4, req: 5, in: 6, out: 7, cw: 8, cr: 9 }
const A = { hour: 0, cwd: 1, hint: 2, surface: 3, sec: 4 }
const S = { id: 0, cwd: 1, hint: 2, surface: 3, first: 4, last: 5, tok: 6 }

// Delete-then-insert inside the payload's window, NOT upsert. A bucket that legitimately
// disappears from a re-post (a deleted session, a dedup fix) must disappear from the store too;
// a plain upsert would leave it as a ghost forever. This is the literal reading of the
// collector's "re-posting a window replaces it" and is what lets a week-offline machine heal.
//
// Scoped by device_id and NOT by (device_id, account_uuid): the collector re-stamps rescanned
// days with whoever is logged in now, so scoping by account would leave a stale duplicate of the
// same hours under the previous account and double count them.
function applyPayload (db, deviceId, p, now) {
  const err = validatePayload(p)
  if (err !== null) throw new Error(err)

  const from = p.window.from
  const to = p.window.to
  const acct = p.account.id

  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM fact_token    WHERE device_id = ? AND hour >= ? AND hour < ?').run(deviceId, from, to)
    db.prepare('DELETE FROM fact_activity WHERE device_id = ? AND hour >= ? AND hour < ?').run(deviceId, from, to)

    const it = db.prepare(`INSERT INTO fact_token
      (hour, device_id, account_uuid, cwd, cwd_norm, hint, surface, model, req, t_in, t_out, t_cw, t_cr)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (const r of p.tokens) {
      it.run(r[T.hour], deviceId, acct, r[T.cwd], normPath(r[T.cwd]), r[T.hint], r[T.surface],
        r[T.model], r[T.req], r[T.in], r[T.out], r[T.cw], r[T.cr])
    }

    const ia = db.prepare(`INSERT INTO fact_activity
      (hour, device_id, account_uuid, cwd, cwd_norm, hint, surface, sec) VALUES (?,?,?,?,?,?,?,?)`)
    for (const r of p.activity) {
      ia.run(r[A.hour], deviceId, acct, r[A.cwd], normPath(r[A.cwd]), r[A.hint], r[A.surface], r[A.sec])
    }

    // Sessions upsert rather than window-replace: a session extends as work continues, and its
    // start can sit before the window while its end sits inside it.
    const is = db.prepare(`INSERT INTO fact_session
      (session_id, device_id, account_uuid, cwd, cwd_norm, hint, surface, first, last, tokens)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(session_id, device_id) DO UPDATE SET
        account_uuid=excluded.account_uuid, cwd=excluded.cwd, cwd_norm=excluded.cwd_norm,
        hint=excluded.hint, surface=excluded.surface,
        first=min(fact_session.first, excluded.first),
        last=max(fact_session.last, excluded.last),
        tokens=excluded.tokens`)
    for (const r of p.sessions) {
      is.run(r[S.id], deviceId, acct, r[S.cwd], normPath(r[S.cwd]), r[S.hint], r[S.surface],
        r[S.first], r[S.last], r[S.tok])
    }

    db.prepare('UPDATE device SET last_seen = ?, os = COALESCE(?, os) WHERE id = ?')
      .run(now, p.machine?.os ?? null, deviceId)

    db.prepare(`INSERT INTO account (uuid, label, email, first_seen, last_seen)
      VALUES (?,?,?,?,?)
      ON CONFLICT(uuid) DO UPDATE SET label=excluded.label, email=excluded.email, last_seen=excluded.last_seen`)
      .run(acct, p.account.label ?? null, p.account.email ?? null, now, now)

    db.prepare(`INSERT INTO ingest_log
      (device_id, account_uuid, win_from, win_to, n_tokens, n_activity, n_sessions, dup_dropped, received)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(deviceId, acct, from, to, p.tokens.length, p.activity.length, p.sessions.length,
        p.stats?.duplicates_dropped ?? 0, now)

    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return { n_tokens: p.tokens.length, n_activity: p.activity.length, n_sessions: p.sessions.length }
}

module.exports = { validatePayload, applyPayload, MAX_WINDOW_SEC }
```

Delete the earlier one-line `module.exports = { validatePayload, MAX_WINDOW_SEC }` from Task 3 so there is exactly one export statement, at the end of the file.

- [ ] **Step 4: Run the whole suite to verify it passes**

Run: `./run-tests.sh`
Expected: PASS, all files green (db 3, paths 6, validate 11, ingest 9).

- [ ] **Step 5: Commit**

```bash
cd ~/dev/client-projects/huly-migration
git add huly-selfhost/usage-sidecar/ingest.js huly-selfhost/usage-sidecar/test/ingest.test.js
git commit -m "feat(usage): transactional window-replacement ingest"
```

---

## Task 5: Auth (JWT verify, workspace check, role lookup, cache)

**Repo:** `huly-migration`

**Files:**
- Create: `huly-selfhost/usage-sidecar/auth.js`
- Create: `huly-selfhost/usage-sidecar/test/auth.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `verifyToken(token: string, secret: string, now: number) -> payload` (throws on any failure)
  - `makeAuth({ secret, workspace, roleLookup, ttl }) -> { requireAdmin(token, now) -> Promise<{account, role}> }`
  - `deviceIdForToken(db, token) -> number | null`
  - `sha256(s) -> string`, `newDeviceToken() -> string`
  - `roleLookup` is injected so tests never open a socket. Task 7 passes the real one, which POSTs to `ACCOUNTS_URL`.

Background verified before writing this task: `jwt-simple` emits header `{"typ":"JWT","alg":"HS256"}`, and a `node:crypto` HMAC over `header.payload` reproduces its signature exactly.

- [ ] **Step 1: Write the failing test**

`test/auth.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')
const { open } = require('../db.js')
const { verifyToken, makeAuth, sha256, newDeviceToken, deviceIdForToken } = require('../auth.js')

const SECRET = 'test-secret'
const WS = 'ws-uuid'
const NOW = 1_756_000_000

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function sign (payload, secret = SECRET, header = { typ: 'JWT', alg: 'HS256' }) {
  const h = b64(header)
  const p = b64(payload)
  const s = crypto.createHmac('sha256', secret).update(h + '.' + p).digest('base64url')
  return `${h}.${p}.${s}`
}

test('verifyToken accepts a correctly signed token', () => {
  const t = sign({ account: 'a', workspace: WS })
  assert.strictEqual(verifyToken(t, SECRET, NOW).account, 'a')
})

test('verifyToken rejects a wrong secret, a tampered payload and a malformed token', () => {
  assert.throws(() => verifyToken(sign({ account: 'a', workspace: WS }, 'other'), SECRET, NOW))
  const t = sign({ account: 'a', workspace: WS }).split('.')
  assert.throws(() => verifyToken(`${t[0]}.${b64({ account: 'evil', workspace: WS })}.${t[2]}`, SECRET, NOW))
  assert.throws(() => verifyToken('not.a.token', SECRET, NOW))
  assert.throws(() => verifyToken('', SECRET, NOW))
})

test('verifyToken rejects alg none, which would otherwise skip the signature entirely', () => {
  const h = b64({ typ: 'JWT', alg: 'none' })
  const p = b64({ account: 'a', workspace: WS })
  assert.throws(() => verifyToken(`${h}.${p}.`, SECRET, NOW))
})

test('verifyToken honours exp and nbf', () => {
  assert.throws(() => verifyToken(sign({ account: 'a', workspace: WS, exp: NOW - 1 }), SECRET, NOW), /expired/)
  assert.throws(() => verifyToken(sign({ account: 'a', workspace: WS, nbf: NOW + 60 }), SECRET, NOW), /active/)
  assert.doesNotThrow(() => verifyToken(sign({ account: 'a', workspace: WS, exp: NOW + 60 }), SECRET, NOW))
})

test('requireAdmin admits Maintainer, Owner and Admin', async () => {
  for (const role of ['MAINTAINER', 'OWNER', 'ADMIN']) {
    const auth = makeAuth({ secret: SECRET, workspace: WS, roleLookup: async () => role, ttl: 60 })
    const r = await auth.requireAdmin(sign({ account: 'a', workspace: WS }), NOW)
    assert.strictEqual(r.role, role)
  }
})

test('requireAdmin refuses an ordinary User', async () => {
  const auth = makeAuth({ secret: SECRET, workspace: WS, roleLookup: async () => 'USER', ttl: 60 })
  await assert.rejects(auth.requireAdmin(sign({ account: 'a', workspace: WS }), NOW), /forbidden/)
})

test('requireAdmin refuses a valid token for another workspace', async () => {
  const auth = makeAuth({ secret: SECRET, workspace: WS, roleLookup: async () => 'OWNER', ttl: 60 })
  await assert.rejects(auth.requireAdmin(sign({ account: 'a', workspace: 'other-ws' }), NOW), /workspace/)
})

test('the role decision is cached, then expires', async () => {
  let calls = 0
  const auth = makeAuth({ secret: SECRET, workspace: WS, roleLookup: async () => { calls++; return 'OWNER' }, ttl: 60 })
  const t = sign({ account: 'a', workspace: WS })
  await auth.requireAdmin(t, NOW)
  await auth.requireAdmin(t, NOW + 30)
  assert.strictEqual(calls, 1)
  await auth.requireAdmin(t, NOW + 61)
  assert.strictEqual(calls, 2)
})

test('a rejected role is not cached as a pass', async () => {
  let role = 'USER'
  const auth = makeAuth({ secret: SECRET, workspace: WS, roleLookup: async () => role, ttl: 60 })
  const t = sign({ account: 'a', workspace: WS })
  await assert.rejects(auth.requireAdmin(t, NOW))
  role = 'OWNER'
  const r = await auth.requireAdmin(t, NOW)
  assert.strictEqual(r.role, 'OWNER')
})

test('device tokens are random, stored only as a hash, and revocable', () => {
  const db = open(':memory:')
  const tok = newDeviceToken()
  assert.notStrictEqual(tok, newDeviceToken())
  assert.ok(tok.length >= 32)
  db.prepare('INSERT INTO device (label, token_sha256, created) VALUES (?,?,?)').run('M1', sha256(tok), NOW)
  assert.strictEqual(deviceIdForToken(db, tok), 1)
  assert.strictEqual(deviceIdForToken(db, 'wrong-token'), null)
  db.prepare('UPDATE device SET revoked_at = ? WHERE id = 1').run(NOW)
  assert.strictEqual(deviceIdForToken(db, tok), null)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./run-tests.sh test/auth.test.js`
Expected: FAIL, `Cannot find module '../auth.js'`.

- [ ] **Step 3: Write the implementation**

`auth.js`:

```js
const crypto = require('node:crypto')

// Huly issues HS256 JWTs via jwt-simple, signed with the stack SECRET
// (foundations/core/packages/token/src/token.ts). Verified against a real jwt-simple token:
// the header is {"typ":"JWT","alg":"HS256"} and the signature is an HMAC over "header.payload".
const ADMIN_ROLES = new Set(['MAINTAINER', 'OWNER', 'ADMIN'])

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const newDeviceToken = () => crypto.randomBytes(32).toString('base64url')

function verifyToken (token, secret, now) {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3) throw new Error('malformed token')
  const [h, p, s] = parts

  const expect = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
  const got = Buffer.from(s)
  const want = Buffer.from(expect)
  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new Error('bad signature')

  let header, payload
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString())
    payload = JSON.parse(Buffer.from(p, 'base64url').toString())
  } catch {
    throw new Error('malformed token')
  }
  // Without this, a token with alg "none" and an empty signature would pass whenever the
  // HMAC of an empty string happened to be compared against an empty one.
  if (header.alg !== 'HS256') throw new Error('unsupported alg')
  if (payload.exp != null && payload.exp < now) throw new Error('token expired')
  if (payload.nbf != null && payload.nbf > now) throw new Error('token not yet active')
  return payload
}

// roleLookup is injected so the security boundary is testable without a socket.
function makeAuth ({ secret, workspace, roleLookup, ttl = 60 }) {
  const cache = new Map() // sha256(token) -> { role, until }

  async function requireAdmin (token, now) {
    const payload = verifyToken(token, secret, now)
    if (payload.workspace !== workspace) throw new Error('wrong workspace')

    const key = sha256(token) // never key the cache on the token itself
    const hit = cache.get(key)
    let role
    if (hit !== undefined && hit.until > now) {
      role = hit.role
    } else {
      role = await roleLookup(token)
      // Only a passing decision is cached. Caching a refusal would keep a just-promoted
      // admin locked out for the whole TTL for no benefit.
      if (ADMIN_ROLES.has(role)) cache.set(key, { role, until: now + ttl })
    }
    if (!ADMIN_ROLES.has(role)) throw new Error('forbidden')
    return { account: payload.account, role }
  }

  return { requireAdmin }
}

function deviceIdForToken (db, token) {
  const row = db.prepare('SELECT id FROM device WHERE token_sha256 = ? AND revoked_at IS NULL')
    .get(sha256(token))
  return row === undefined ? null : row.id
}

module.exports = { verifyToken, makeAuth, deviceIdForToken, sha256, newDeviceToken, ADMIN_ROLES }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./run-tests.sh test/auth.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/client-projects/huly-migration
git add huly-selfhost/usage-sidecar/auth.js huly-selfhost/usage-sidecar/test/auth.test.js
git commit -m "feat(usage): Huly token verification, admin role gate and device tokens"
```

---

## Task 6: Report builder and config CRUD

**Repo:** `huly-migration`

**Files:**
- Create: `huly-selfhost/usage-sidecar/report.js`
- Create: `huly-selfhost/usage-sidecar/config.js`
- Create: `huly-selfhost/usage-sidecar/test/report.test.js`

**Interfaces:**
- Consumes: `compileRules`, `resolveProject` from Task 2.
- Produces:
  - `buildReport(db, days, tz, now) -> envelope` (the exact shape in spec section 6)
  - `configSnapshot(db, now) -> { rules, accounts, devices }`
  - `upsertRule(db, {prefix, target_kind, project_id, project_name, label}, now) -> id`
  - `deleteRule(db, id)`, `updateAccount(db, uuid, {employee_ref, employee_name, plan_cents})`
  - `addDevice(db, label, now) -> { id, token }`, `revokeDevice(db, id, now)`
  - `unmapped(db, from, to) -> Array<{cwd, cwd_norm, tokens}>`

- [ ] **Step 1: Write the failing test**

`test/report.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { open } = require('../db.js')
const { applyPayload } = require('../ingest.js')
const { buildReport } = require('../report.js')
const { upsertRule, addDevice, updateAccount, configSnapshot, unmapped, revokeDevice } = require('../config.js')
const { deviceIdForToken } = require('../auth.js')

const H = 1755000000 - (1755000000 % 3600)
const NOW = H + 86400

function seeded () {
  const d = open(':memory:')
  const dev = addDevice(d, 'KARTHI-WSL', NOW)
  applyPayload(d, dev.id, {
    schema: 1,
    account: { id: 'acct-a', label: 'Karthi', email: 'k@yg.com' },
    machine: { name: 'KARTHI-WSL', os: 'wsl' },
    tz: '+0530',
    window: { from: H, to: H + 86400, days: 1 },
    idle_sec: 300,
    stats: { kept: 2, duplicates_dropped: 7 },
    tokens: [
      [H, '/home/k/dev/client-projects/yg-huly', 'yg-huly', 'terminal', 'opus-5', 3, 100, 200, 300, 400],
      [H, '/home/k/dev/scratch', 'scratch', 'vscode', 'sonnet-5', 1, 10, 20, 30, 40]
    ],
    activity: [[H, '/home/k/dev/client-projects/yg-huly', 'yg-huly', 'terminal', 1800]],
    sessions: [['sess1', '/home/k/dev/client-projects/yg-huly', 'yg-huly', 'terminal', H, H + 60, 1000]]
  }, NOW)
  return { d, dev }
}

test('an unmapped path reports as Unmapped and keeps its raw cwd', () => {
  const { d } = seeded()
  const r = buildReport(d, 14, '+0530', NOW)
  assert.deepStrictEqual([...new Set(r.tokens.map((t) => t[3]))].sort(), ['Unmapped'])
  assert.ok(r.tokens.every((t) => t[4].startsWith('/home/k/')))
})

test('adding a rule re-maps history retroactively with no data rewrite', () => {
  const { d } = seeded()
  const before = d.prepare('SELECT cwd, cwd_norm FROM fact_token ORDER BY cwd').all()
  upsertRule(d, { prefix: '~/dev/client-projects/yg-huly', target_kind: 'project', project_id: 'p1', project_name: 'YG Portal' }, NOW)
  const r = buildReport(d, 14, '+0530', NOW)
  assert.ok(r.tokens.some((t) => t[3] === 'YG Portal'))
  assert.ok(r.tokens.some((t) => t[3] === 'Unmapped'))
  const after = d.prepare('SELECT cwd, cwd_norm FROM fact_token ORDER BY cwd').all()
  assert.deepStrictEqual(after, before) // facts are stored raw and never rewritten
})

test('a label rule maps to its free-text bucket', () => {
  const { d } = seeded()
  upsertRule(d, { prefix: '~/dev/scratch', target_kind: 'label', label: 'Internal' }, NOW)
  const r = buildReport(d, 14, '+0530', NOW)
  assert.ok(r.tokens.some((t) => t[3] === 'Internal'))
})

test('the envelope carries accounts, devices, tz and stats', () => {
  const { d } = seeded()
  const r = buildReport(d, 14, '+0530', NOW)
  assert.strictEqual(r.report_schema, 1)
  assert.strictEqual(r.tz, '+0530')
  assert.strictEqual(r.window.days, 14)
  assert.strictEqual(r.accounts.length, 1)
  assert.strictEqual(r.accounts[0].uuid, 'acct-a')
  assert.strictEqual(r.devices[0].label, 'KARTHI-WSL')
  assert.strictEqual(r.stats.dup_dropped, 7)
})

test('rows carry account and device columns so several payloads can merge', () => {
  const { d } = seeded()
  const r = buildReport(d, 14, '+0530', NOW)
  const row = r.tokens[0]
  assert.strictEqual(row.length, 12)
  assert.strictEqual(row[1], 'acct-a')
  assert.strictEqual(row[2], 'KARTHI-WSL')
})

test('the period anchors on the newest fact hour, not on wall clock', () => {
  const { d } = seeded()
  const late = buildReport(d, 1, '+0530', NOW + 400 * 86400)
  assert.strictEqual(late.tokens.length, 2, 'a stale fleet still shows its most recent window')
})

test('a shorter period excludes older rows', () => {
  const { d, dev } = seeded()
  applyPayload(d, dev.id, {
    schema: 1,
    account: { id: 'acct-a' },
    machine: { name: 'KARTHI-WSL', os: 'wsl' },
    window: { from: H - 20 * 86400, to: H - 19 * 86400, days: 1 },
    idle_sec: 300, stats: { kept: 1, duplicates_dropped: 0 },
    tokens: [[H - 20 * 86400, '/home/k/dev/old', 'old', 'terminal', 'opus-5', 1, 1, 1, 1, 1]],
    activity: [], sessions: []
  }, NOW)
  assert.strictEqual(buildReport(d, 30, '+0530', NOW).tokens.length, 3)
  assert.strictEqual(buildReport(d, 7, '+0530', NOW).tokens.length, 2)
})

test('stale_devices lists a device with no payload in over 24 hours', () => {
  const { d } = seeded()
  assert.deepStrictEqual(buildReport(d, 14, '+0530', NOW).stats.stale_devices, [])
  assert.deepStrictEqual(buildReport(d, 14, '+0530', NOW + 3 * 86400).stats.stale_devices, ['KARTHI-WSL'])
})

test('plan_cents and the linked employee come back on the account', () => {
  const { d } = seeded()
  updateAccount(d, 'acct-a', { employee_ref: 'emp-1', employee_name: 'Karthikeyan', plan_cents: 20000 })
  const r = buildReport(d, 14, '+0530', NOW)
  assert.strictEqual(r.accounts[0].plan_cents, 20000)
  assert.strictEqual(r.accounts[0].employee_name, 'Karthikeyan')
})

test('upsertRule updates in place when the prefix already exists', () => {
  const { d } = seeded()
  const id1 = upsertRule(d, { prefix: '~/dev/a', target_kind: 'label', label: 'One' }, NOW)
  const id2 = upsertRule(d, { prefix: '~/dev/a', target_kind: 'label', label: 'Two' }, NOW)
  assert.strictEqual(id1, id2)
  assert.strictEqual(configSnapshot(d, NOW).rules.length, 1)
  assert.strictEqual(configSnapshot(d, NOW).rules[0].label, 'Two')
})

test('unmapped lists distinct raw paths with no rule, heaviest first', () => {
  const { d } = seeded()
  upsertRule(d, { prefix: '~/dev/client-projects/yg-huly', target_kind: 'label', label: 'Portal' }, NOW)
  const u = unmapped(d, H - 86400, H + 86400)
  assert.strictEqual(u.length, 1)
  assert.strictEqual(u[0].cwd, '/home/k/dev/scratch')
  assert.ok(u[0].tokens > 0)
})

test('configSnapshot never exposes a device token or its hash', () => {
  const { d } = seeded()
  const snap = configSnapshot(d, NOW)
  const s = JSON.stringify(snap)
  assert.ok(!s.includes('token_sha256'))
  assert.strictEqual(snap.devices[0].label, 'KARTHI-WSL')
})

test('a revoked device stops authenticating but keeps its history', () => {
  const { d, dev } = seeded()
  revokeDevice(d, dev.id, NOW)
  assert.strictEqual(deviceIdForToken(d, dev.token), null)
  assert.strictEqual(buildReport(d, 14, '+0530', NOW).tokens.length, 2)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./run-tests.sh test/report.test.js`
Expected: FAIL, `Cannot find module '../report.js'`.

- [ ] **Step 3: Write `config.js`**

```js
const { newDeviceToken, sha256 } = require('./auth.js')
const { compileRules, resolveProject } = require('./paths.js')

const STALE_SEC = 24 * 3600

function upsertRule (db, r, now) {
  db.prepare(`INSERT INTO map_rule (prefix, target_kind, project_id, project_name, label, updated)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(prefix) DO UPDATE SET target_kind=excluded.target_kind, project_id=excluded.project_id,
      project_name=excluded.project_name, label=excluded.label, updated=excluded.updated`)
    .run(String(r.prefix).replace(/\/+$/, ''), r.target_kind, r.project_id ?? null,
      r.project_name ?? null, r.label ?? null, now)
  return db.prepare('SELECT id FROM map_rule WHERE prefix = ?')
    .get(String(r.prefix).replace(/\/+$/, '')).id
}

function deleteRule (db, id) {
  db.prepare('DELETE FROM map_rule WHERE id = ?').run(id)
}

function updateAccount (db, uuid, a) {
  db.prepare(`UPDATE account SET employee_ref = ?, employee_name = ?, plan_cents = ? WHERE uuid = ?`)
    .run(a.employee_ref ?? null, a.employee_name ?? null, Math.max(0, Math.round(a.plan_cents ?? 0)), uuid)
}

// The plaintext token is returned here and NEVER again: only its hash is stored.
function addDevice (db, label, now) {
  const token = newDeviceToken()
  db.prepare('INSERT INTO device (label, token_sha256, created) VALUES (?,?,?)').run(label, sha256(token), now)
  const id = db.prepare('SELECT id FROM device WHERE label = ?').get(label).id
  return { id, token }
}

function revokeDevice (db, id, now) {
  db.prepare('UPDATE device SET revoked_at = ? WHERE id = ?').run(now, id)
}

function configSnapshot (db, now) {
  return {
    rules: db.prepare('SELECT id, prefix, target_kind, project_id, project_name, label, updated FROM map_rule ORDER BY prefix').all(),
    accounts: db.prepare('SELECT uuid, label, email, employee_ref, employee_name, plan_cents, last_seen FROM account ORDER BY label').all(),
    // token_sha256 is deliberately not selected. It must never reach a browser.
    devices: db.prepare('SELECT id, label, os, created, last_seen, revoked_at FROM device ORDER BY label')
      .all().map((d) => ({ ...d, stale: d.revoked_at == null && (d.last_seen == null || now - d.last_seen > STALE_SEC) }))
  }
}

function unmapped (db, from, to) {
  const rules = compileRules(db.prepare('SELECT prefix, target_kind, project_name, label FROM map_rule').all())
  return db.prepare(`SELECT cwd, cwd_norm, SUM(t_in + t_out + t_cw + t_cr) AS tokens
      FROM fact_token WHERE hour >= ? AND hour < ? GROUP BY cwd, cwd_norm`).all(from, to)
    .filter((r) => resolveProject(rules, r.cwd_norm) === 'Unmapped')
    .sort((a, b) => b.tokens - a.tokens)
}

module.exports = { upsertRule, deleteRule, updateAccount, addDevice, revokeDevice, configSnapshot, unmapped, STALE_SEC }
```

- [ ] **Step 4: Write `report.js`**

```js
const { compileRules, resolveProject } = require('./paths.js')
const { STALE_SEC } = require('./config.js')

// The period anchors on the newest fact hour, not on wall clock, exactly as
// dashboard.template.html does (maxHour() + 3600 - days * 86400). A fleet that stopped
// reporting still shows its last window instead of an empty page, and the portal render
// matches the standalone template render row for row, which is the acceptance test.
function anchorHour (db) {
  const a = db.prepare('SELECT max(hour) h FROM fact_token').get().h
  const b = db.prepare('SELECT max(hour) h FROM fact_activity').get().h
  return Math.max(a ?? 0, b ?? 0)
}

function buildReport (db, days, tz, now) {
  const d = Math.max(1, Math.min(365, Number(days) || 14))
  const to = anchorHour(db) + 3600
  const from = to - d * 86400

  const rules = compileRules(db.prepare('SELECT prefix, target_kind, project_name, label FROM map_rule').all())
  const devName = new Map(db.prepare('SELECT id, label FROM device').all().map((r) => [r.id, r.label]))
  // Distinct paths in a window are in the tens, so resolve each one once and reuse it.
  const memo = new Map()
  const proj = (cwdNorm) => {
    let v = memo.get(cwdNorm)
    if (v === undefined) { v = resolveProject(rules, cwdNorm); memo.set(cwdNorm, v) }
    return v
  }

  const tokens = db.prepare(`SELECT hour, account_uuid, device_id, cwd, cwd_norm, surface, model,
      req, t_in, t_out, t_cw, t_cr FROM fact_token WHERE hour >= ? AND hour < ? ORDER BY hour`)
    .all(from, to)
    .map((r) => [r.hour, r.account_uuid, devName.get(r.device_id) ?? '?', proj(r.cwd_norm), r.cwd,
      r.surface, r.model, r.req, r.t_in, r.t_out, r.t_cw, r.t_cr])

  const activity = db.prepare(`SELECT hour, account_uuid, device_id, cwd, cwd_norm, surface, sec
      FROM fact_activity WHERE hour >= ? AND hour < ? ORDER BY hour`)
    .all(from, to)
    .map((r) => [r.hour, r.account_uuid, devName.get(r.device_id) ?? '?', proj(r.cwd_norm), r.cwd, r.surface, r.sec])

  const sessions = db.prepare(`SELECT session_id, account_uuid, device_id, cwd, cwd_norm, surface,
      first, last, tokens FROM fact_session WHERE last >= ? AND first < ? ORDER BY first`)
    .all(from, to)
    .map((r) => [r.session_id, r.account_uuid, devName.get(r.device_id) ?? '?', proj(r.cwd_norm), r.cwd,
      r.surface, r.first, r.last, r.tokens])

  const devices = db.prepare('SELECT id, label, os, last_seen, revoked_at FROM device WHERE revoked_at IS NULL').all()
  const dup = db.prepare('SELECT COALESCE(sum(dup_dropped), 0) s FROM ingest_log WHERE received >= ?')
    .get(now - 7 * 86400).s

  return {
    report_schema: 1,
    tz,
    generated: now,
    window: { from, to, days: d },
    accounts: db.prepare('SELECT uuid, label, email, employee_ref, employee_name, plan_cents FROM account ORDER BY label').all(),
    devices: devices.map((x) => ({ id: x.id, label: x.label, os: x.os, last_seen: x.last_seen })),
    idle_sec: 300,
    stats: {
      dup_dropped: dup,
      stale_devices: devices.filter((x) => x.last_seen == null || now - x.last_seen > STALE_SEC).map((x) => x.label)
    },
    tokens,
    activity,
    sessions
  }
}

module.exports = { buildReport }
```

- [ ] **Step 5: Run the whole suite to verify it passes**

Run: `./run-tests.sh`
Expected: PASS, all files green.

- [ ] **Step 6: Commit**

```bash
cd ~/dev/client-projects/huly-migration
git add huly-selfhost/usage-sidecar/report.js huly-selfhost/usage-sidecar/config.js huly-selfhost/usage-sidecar/test/report.test.js
git commit -m "feat(usage): report envelope with read-time mapping, and config CRUD"
```

---

## Task 7: HTTP server, routes, and the real role lookup

**Repo:** `huly-migration`

**Files:**
- Create: `huly-selfhost/usage-sidecar/server.js`
- Create: `huly-selfhost/usage-sidecar/test/server.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: `createServer({ db, auth, tz }) -> http.Server`. Exported so tests can start it on port 0. The module also self-starts when run directly.

- [ ] **Step 1: Write the failing test**

`test/server.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')
const { open } = require('../db.js')
const { makeAuth } = require('../auth.js')
const { addDevice } = require('../config.js')
const { createServer } = require('../server.js')

const SECRET = 'test-secret'
const WS = 'ws-uuid'
const H = 1755000000 - (1755000000 % 3600)

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function adminToken (workspace = WS) {
  const h = b64({ typ: 'JWT', alg: 'HS256' })
  const p = b64({ account: 'a', workspace })
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}

async function boot (role = 'OWNER') {
  const db = open(':memory:')
  const dev = addDevice(db, 'KARTHI-WSL', H)
  const auth = makeAuth({ secret: SECRET, workspace: WS, roleLookup: async () => role, ttl: 60 })
  const srv = createServer({ db, auth, tz: '+0530' })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${srv.address().port}`
  return { db, dev, srv, base }
}

function payload () {
  return {
    schema: 1,
    account: { id: 'acct-a', label: 'Karthi', email: 'k@yg.com' },
    machine: { name: 'KARTHI-WSL', os: 'wsl' },
    tz: '+0530',
    window: { from: H, to: H + 86400, days: 1 },
    idle_sec: 300, stats: { kept: 1, duplicates_dropped: 3 },
    tokens: [[H, '/home/k/dev/a', 'a', 'terminal', 'opus-5', 3, 100, 200, 300, 400]],
    activity: [[H, '/home/k/dev/a', 'a', 'terminal', 1800]],
    sessions: [['sess1', '/home/k/dev/a', 'a', 'terminal', H, H + 60, 1000]]
  }
}

test('ingest accepts a valid device token and stores the payload', async (t) => {
  const { db, dev, srv, base } = await boot()
  t.after(() => srv.close())
  const res = await fetch(`${base}/_usage/ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${dev.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload())
  })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(db.prepare('SELECT count(*) c FROM fact_token').get().c, 1)
})

test('ingest refuses an unknown token with 401 and a bad payload with 400', async (t) => {
  const { dev, srv, base } = await boot()
  t.after(() => srv.close())
  const bad = await fetch(`${base}/_usage/ingest`, {
    method: 'POST', headers: { Authorization: 'Bearer nope' }, body: JSON.stringify(payload())
  })
  assert.strictEqual(bad.status, 401)
  const p = payload(); p.schema = 9
  const wrong = await fetch(`${base}/_usage/ingest`, {
    method: 'POST', headers: { Authorization: `Bearer ${dev.token}` }, body: JSON.stringify(p)
  })
  assert.strictEqual(wrong.status, 400)
})

test('report requires an admin token', async (t) => {
  const a = await boot('OWNER')
  t.after(() => a.srv.close())
  assert.strictEqual((await fetch(`${a.base}/_usage/report?days=14`)).status, 401)
  assert.strictEqual((await fetch(`${a.base}/_usage/report?days=14`, {
    headers: { Authorization: `Bearer ${adminToken('other-ws')}` }
  })).status, 401)
  const ok = await fetch(`${a.base}/_usage/report?days=14`, { headers: { Authorization: `Bearer ${adminToken()}` } })
  assert.strictEqual(ok.status, 200)
  assert.strictEqual((await ok.json()).report_schema, 1)

  const b = await boot('USER')
  t.after(() => b.srv.close())
  assert.strictEqual((await fetch(`${b.base}/_usage/report?days=14`, {
    headers: { Authorization: `Bearer ${adminToken()}` }
  })).status, 401)
})

test('a device token cannot read the report and an admin token cannot ingest', async (t) => {
  const { dev, srv, base } = await boot()
  t.after(() => srv.close())
  assert.strictEqual((await fetch(`${base}/_usage/report?days=14`, {
    headers: { Authorization: `Bearer ${dev.token}` }
  })).status, 401)
  assert.strictEqual((await fetch(`${base}/_usage/ingest`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken()}` }, body: JSON.stringify(payload())
  })).status, 401)
})

test('config round trip: add a rule, see it, delete it', async (t) => {
  const { srv, base } = await boot()
  t.after(() => srv.close())
  const hdr = { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' }
  const made = await fetch(`${base}/_usage/config/rule`, {
    method: 'POST', headers: hdr,
    body: JSON.stringify({ prefix: '~/dev/a', target_kind: 'label', label: 'Internal' })
  })
  assert.strictEqual(made.status, 200)
  const id = (await made.json()).id
  const snap = await (await fetch(`${base}/_usage/config`, { headers: hdr })).json()
  assert.strictEqual(snap.rules.length, 1)
  assert.ok(Array.isArray(snap.unmapped))
  assert.strictEqual((await fetch(`${base}/_usage/config/rule/${id}`, { method: 'DELETE', headers: hdr })).status, 200)
  assert.strictEqual((await (await fetch(`${base}/_usage/config`, { headers: hdr })).json()).rules.length, 0)
})

test('a new device returns its token exactly once', async (t) => {
  const { srv, base } = await boot()
  t.after(() => srv.close())
  const hdr = { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' }
  const made = await (await fetch(`${base}/_usage/config/device`, {
    method: 'POST', headers: hdr, body: JSON.stringify({ label: 'NEW-BOX' })
  })).json()
  assert.ok(made.token.length >= 32)
  const snap = await (await fetch(`${base}/_usage/config`, { headers: hdr })).json()
  assert.ok(!JSON.stringify(snap).includes(made.token))
})

test('healthz needs no auth and leaks no data', async (t) => {
  const { srv, base } = await boot()
  t.after(() => srv.close())
  const res = await fetch(`${base}/_usage/healthz`)
  assert.strictEqual(res.status, 200)
  assert.deepStrictEqual(await res.json(), { ok: true })
})

test('an oversized body is refused', async (t) => {
  const { dev, srv, base } = await boot()
  t.after(() => srv.close())
  const res = await fetch(`${base}/_usage/ingest`, {
    method: 'POST', headers: { Authorization: `Bearer ${dev.token}` }, body: 'x'.repeat(9 * 1024 * 1024)
  })
  assert.strictEqual(res.status, 413)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./run-tests.sh test/server.test.js`
Expected: FAIL, `Cannot find module '../server.js'`.

- [ ] **Step 3: Write the implementation**

`server.js`:

```js
const http = require('node:http')
const { open } = require('./db.js')
const { makeAuth, deviceIdForToken } = require('./auth.js')
const { applyPayload } = require('./ingest.js')
const { buildReport } = require('./report.js')
const cfg = require('./config.js')

const MAX_BODY = 8 * 1024 * 1024
const now = () => Math.floor(Date.now() / 1000)

const bearer = (req) => {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

function send (res, code, body) {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) })
  res.end(s)
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    let n = 0
    let tooBig = false
    const chunks = []
    // Keep draining rather than destroying the socket: destroying it means the client never
    // reads the 413 we are about to send, and the caller just sees a connection reset.
    req.on('data', (c) => {
      n += c.length
      if (n > MAX_BODY) { tooBig = true; return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (tooBig) { reject(Object.assign(new Error('body too large'), { code: 413 })); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')) } catch { reject(Object.assign(new Error('bad json'), { code: 400 })) }
    })
    req.on('error', reject)
  })
}

// The real role lookup. The account service returns WorkspaceLoginInfo, whose `role` is the
// workspace role of the token's account. The sidecar never talks to Huly's database.
function makeRoleLookup (accountsUrl) {
  return async function roleLookup (token) {
    const res = await fetch(accountsUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'getLoginInfoByToken', params: {}, id: 1 })
    })
    if (!res.ok) throw new Error('account service refused the token')
    const body = await res.json()
    return body?.result?.role ?? ''
  }
}

function createServer ({ db, auth, tz }) {
  return http.createServer((req, res) => {
    handle(req, res, { db, auth, tz }).catch((e) => {
      // Failures are opaque on purpose: nothing about which check failed leaks to a caller.
      send(res, e.code ?? 401, { error: e.code === 413 ? 'body too large' : e.code === 400 ? 'bad request' : 'unauthorized' })
    })
  })
}

async function handle (req, res, ctx) {
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname.replace(/^\/_usage/, '')
  const t = now()

  if (req.method === 'GET' && p === '/healthz') return send(res, 200, { ok: true })

  if (req.method === 'POST' && p === '/ingest') {
    const deviceId = deviceIdForToken(ctx.db, bearer(req))
    if (deviceId === null) throw new Error('unauthorized')
    const body = await readBody(req)
    let counts
    try { counts = applyPayload(ctx.db, deviceId, body, t) } catch (e) { throw Object.assign(e, { code: 400 }) }
    return send(res, 200, { ok: true, ...counts })
  }

  // Everything below this line is admin-only.
  await ctx.auth.requireAdmin(bearer(req), t)

  if (req.method === 'GET' && p === '/report') {
    return send(res, 200, buildReport(ctx.db, url.searchParams.get('days') ?? 14, ctx.tz, t))
  }
  if (req.method === 'GET' && p === '/config') {
    const anchor = buildReport(ctx.db, 30, ctx.tz, t).window
    return send(res, 200, { ...cfg.configSnapshot(ctx.db, t), unmapped: cfg.unmapped(ctx.db, anchor.from, anchor.to) })
  }
  if (req.method === 'POST' && p === '/config/rule') {
    return send(res, 200, { id: cfg.upsertRule(ctx.db, await readBody(req), t) })
  }
  if (req.method === 'DELETE' && p.startsWith('/config/rule/')) {
    cfg.deleteRule(ctx.db, Number(p.split('/').pop()))
    return send(res, 200, { ok: true })
  }
  if (req.method === 'POST' && p.startsWith('/config/account/')) {
    cfg.updateAccount(ctx.db, decodeURIComponent(p.split('/').pop()), await readBody(req))
    return send(res, 200, { ok: true })
  }
  if (req.method === 'POST' && p === '/config/device') {
    const { label } = await readBody(req)
    return send(res, 200, cfg.addDevice(ctx.db, String(label ?? '').trim(), t))
  }
  if (req.method === 'POST' && /^\/config\/device\/\d+\/revoke$/.test(p)) {
    cfg.revokeDevice(ctx.db, Number(p.split('/')[3]), t)
    return send(res, 200, { ok: true })
  }
  return send(res, 404, { error: 'not found' })
}

module.exports = { createServer, makeRoleLookup }

if (require.main === module) {
  const db = open(process.env.YG_USAGE_DB ?? '/data/usage.db')
  const auth = makeAuth({
    secret: process.env.SECRET,
    workspace: process.env.YG_USAGE_WORKSPACE,
    roleLookup: makeRoleLookup(process.env.ACCOUNTS_URL ?? 'http://account:3000/'),
    ttl: 60
  })
  const port = Number(process.env.YG_USAGE_PORT ?? 4700)
  createServer({ db, auth, tz: process.env.YG_USAGE_TZ ?? '+0530' })
    .listen(port, () => { console.log(`yg-usage sidecar listening on ${port}`) })
}
```

- [ ] **Step 4: Run the whole suite to verify it passes**

Run: `./run-tests.sh`
Expected: PASS, every file green.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/client-projects/huly-migration
git add huly-selfhost/usage-sidecar/server.js huly-selfhost/usage-sidecar/test/server.test.js
git commit -m "feat(usage): HTTP routes, ingest and admin gates, account-service role lookup"
```

---

## Task 8: Run the sidecar for real against the beta stack

**Repo:** `huly-migration`

**Files:**
- Modify: `huly-selfhost/compose.override.beta.yml`
- Create: `huly-selfhost/.huly.nginx.beta`
- Create: `notes/ai-usage-runbook.md`

**Interfaces:**
- Consumes: the sidecar from Tasks 1-7.
- Produces: a running `usage` service reachable at `http://localhost/_usage/healthz`, and a real device token for the collector. Task 13 uses both.

- [ ] **Step 1: Add the service to the beta override**

Append to `huly-selfhost/compose.override.beta.yml`:

```yaml
  usage:
    build: ./usage-sidecar
    environment:
      - YG_USAGE_DB=/data/usage.db
      - YG_USAGE_PORT=4700
      - YG_USAGE_TZ=+0530
      - SECRET=${SECRET}
      - YG_USAGE_WORKSPACE=${YG_USAGE_WORKSPACE}
      - ACCOUNTS_URL=http://account:3000/
    volumes:
      - ./usage-data:/data
    restart: unless-stopped
    networks:
      - huly_net
```

- [ ] **Step 2: Add the nginx location**

Copy the running config and add the block:

```bash
cd ~/dev/client-projects/huly-migration/huly-selfhost
cp .huly.nginx .huly.nginx.beta
```

Insert before the closing `}` of the `server { ... }` block in `.huly.nginx.beta`:

```nginx
    location /_usage {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        client_max_body_size 10M;
        proxy_pass http://usage:4700;
    }
```

Note there is deliberately **no `rewrite` and no trailing slash on `proxy_pass`**, unlike the
`/_accounts` block above it. Those strip the prefix; this service wants to see `/_usage` because
`server.js` strips it itself. Adding a trailing slash here makes every route 404.

Point the beta nginx service at this file by changing its volume line in
`compose.override.beta.yml`:

```yaml
  nginx:
    volumes:
      - ./.huly.nginx.beta:/etc/nginx/conf.d/default.conf
```

- [ ] **Step 3: Get the workspace uuid and bring the service up**

```bash
cd ~/dev/client-projects/huly-migration/huly-selfhost
grep -E '^SECRET=' huly_v7.conf | head -1          # confirm SECRET is set in the compose env
docker compose -f compose.yml -f compose.override.beta.yml exec cockroach \
  cockroach sql --insecure -e "SELECT uuid, url FROM global_account.workspace;" | head
```

Put the `yg` workspace uuid in `huly_v7.conf` as `YG_USAGE_WORKSPACE=<uuid>` (no quotes, no
inline comment: that file is the compose `.env` and CRLF or quoting breaks it), then:

```bash
mkdir -p usage-data
docker compose -f compose.yml -f compose.override.beta.yml up -d --build usage
docker compose -f compose.yml -f compose.override.beta.yml restart nginx
```

The nginx restart is not optional: nginx resolves compose service names once at startup, so a
newly created `usage` container is invisible to it until then (2026-07-23 ops rule 1).

- [ ] **Step 4: Verify it is reachable and correctly gated**

```bash
curl -s http://localhost/_usage/healthz                      # expect {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/_usage/report   # expect 401
docker compose -f compose.yml -f compose.override.beta.yml logs --tail=20 usage
```

Expected: `{"ok":true}`, then `401`, then a `listening on 4700` log line and no stack traces.

- [ ] **Step 5: Write the runbook**

Create `notes/ai-usage-runbook.md` covering, with the exact commands used above: what the
service is and where its data lives (`huly-selfhost/usage-data/usage.db`); how to enroll a
device (call `POST /_usage/config/device` from the portal config page, paste the token into
that machine's Task Scheduler entry as `YG_USAGE_TOKEN`, and note that the token is shown
once); how to rotate (revoke, add again, update the one machine); how to check health
(`curl /_usage/healthz`, plus `SELECT label, datetime(last_seen,'unixepoch') FROM device;`);
how to back up and restore the SQLite file; and the reminder that the nginx restart is
mandatory after recreating the service.

- [ ] **Step 6: Commit**

```bash
cd ~/dev/client-projects/huly-migration
git add huly-selfhost/compose.override.beta.yml huly-selfhost/.huly.nginx.beta notes/ai-usage-runbook.md
git commit -m "ops(usage): run the AI usage sidecar behind nginx /_usage on the beta stack"
```

Note: `huly-selfhost/usage-data/` holds the live database. Confirm it is covered by the repo's
existing gitignore rules before committing, and add `huly-selfhost/usage-data/` to
`.gitignore` if it is not.

---

## Task 9: Register the app in the fork

**Repo:** `yg-huly`, branch `yg_beta`

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts:233-256` (component block), string block
- Modify: `plugins/yg-timesheet-assets/lang/en.json`, `plugins/yg-timesheet-assets/lang/ru.json`
- Modify: `models/yg-timesheet/src/index.ts` (after the Dashboard app doc, around line 450)
- Modify: `plugins/yg-timesheet-resources/src/index.ts` (imports and the `component` export)

**Interfaces:**
- Consumes: nothing.
- Produces: `ygTimesheet.component.AiUsage`, `ygTimesheet.component.AiUsageConfig`, and the app
  `ygTimesheet.app.AiUsage`. Tasks 11 and 12 fill in the two components.

This task ends with two placeholder components so the app is verifiably registered and gated
before any report code exists. That is the point: it isolates "does the icon appear for the
right people" from "are the numbers right".

- [ ] **Step 1: Declare the ids and strings**

In `plugins/yg-timesheet/src/index.ts`, add to the `component:` block (after `HrLatePermissions`):

```ts
    AiUsage: '' as AnyComponent,
    AiUsageConfig: '' as AnyComponent
```

Add to the `string:` block:

```ts
    AiUsage: '' as IntlString,
    AiUsageDashboard: '' as IntlString,
    AiUsageConfiguration: '' as IntlString
```

Find the `app:` block in the same file and add `AiUsage: '' as Ref<Application>` alongside the
existing `Dashboard`, `HumanResource` and `Attendance` entries, matching whatever type
annotation those already use.

- [ ] **Step 2: Add the strings to both locales**

`plugins/yg-timesheet-assets/lang/en.json`, inside `"string"`:

```json
    "AiUsage": "AI Usage",
    "AiUsageDashboard": "Usage",
    "AiUsageConfiguration": "Configuration",
```

`plugins/yg-timesheet-assets/lang/ru.json`, inside `"string"`:

```json
    "AiUsage": "AI Usage",
    "AiUsageDashboard": "Usage",
    "AiUsageConfiguration": "Configuration",
```

Russian is left in English deliberately: the workspace runs in English and inventing a
translation nobody reads is worse than an honest passthrough.

- [ ] **Step 3: Create the two placeholder components**

`plugins/yg-timesheet-resources/src/components/AiUsage.svelte`:

```svelte
<script lang="ts">
</script>

<div class="p-4">AI Usage dashboard</div>
```

`plugins/yg-timesheet-resources/src/components/AiUsageConfig.svelte`:

```svelte
<script lang="ts">
</script>

<div class="p-4">AI Usage configuration</div>
```

- [ ] **Step 4: Register them**

In `plugins/yg-timesheet-resources/src/index.ts`, add the imports next to the other component
imports:

```ts
import AiUsage from './components/AiUsage.svelte'
import AiUsageConfig from './components/AiUsageConfig.svelte'
```

and add `AiUsage,` and `AiUsageConfig` to the `component: { ... }` object in the default export.

- [ ] **Step 5: Register the application**

In `models/yg-timesheet/src/index.ts`, immediately after the `ygTimesheet.app.Dashboard`
`createDoc` call, add:

```ts
  // Admin-only "AI Usage" app. Registered as its own top-level Application rather than as a
  // branch of DashboardHome, because DashboardHome is a role ROUTER: resolveDashboardRole picks
  // exactly one of org/pm/teamLead/hr/employee, so there is no slot to add a third dashboard
  // beside PM and HR without changing who sees the other two.
  //
  // accessLevel is the right nav gate here (unlike the HR app, where "is HR staff" is space
  // membership and cannot be expressed as a rung on the AccountRole ladder). It is also
  // client-side ONLY: it hides the icon. The real gate is the sidecar, which verifies the
  // caller's Huly token and asks the account service for their workspace role before answering.
  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: ygTimesheet.string.AiUsage,
      icon: tracker.icon.TimeReport,
      alias: 'yg-ai-usage',
      hidden: false,
      position: 'top',
      accessLevel: AccountRole.Maintainer,
      navigatorModel: {
        spaces: [],
        specials: [
          {
            id: 'usage',
            label: ygTimesheet.string.AiUsageDashboard,
            icon: tracker.icon.TimeReport,
            component: ygTimesheet.component.AiUsage,
            position: 'top'
          },
          {
            id: 'config',
            label: ygTimesheet.string.AiUsageConfiguration,
            icon: setting.icon.Setting,
            component: ygTimesheet.component.AiUsageConfig,
            position: 'bottom'
          }
        ]
      }
    },
    ygTimesheet.app.AiUsage
  )
```

- [ ] **Step 6: Type-check**

Run: `cd ~/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && npm run svelte-check`
Expected: no new errors mentioning `AiUsage`.

- [ ] **Step 7: Build and deploy the beta stack**

This is a MODEL change (a new Application doc), so a front-only build silently ships without
it and the app looks broken for no visible reason.

```bash
cd ~/dev/client-projects/huly-migration/huly-selfhost
./build-beta.sh                  # full 5-image build
```

Then follow the instructions the script prints at the end for recreating the stack and running
`upgrade-workspace`, and restart nginx afterwards.

- [ ] **Step 8: Verify the gate by hand**

In the portal: an Owner or Maintainer account sees an "AI Usage" icon in the left rail with
two entries, Usage and Configuration, showing the placeholder text. An ordinary User account
does not see the icon at all.

- [ ] **Step 9: Commit**

```bash
cd ~/dev/client-projects/yg-huly
git add plugins/yg-timesheet/src/index.ts plugins/yg-timesheet-assets/lang \
        models/yg-timesheet/src/index.ts plugins/yg-timesheet-resources/src
git commit -m "feat(ai-usage): register the admin-only AI Usage app with usage and config specials"
```

---

## Task 10: Port the aggregation into a tested pure module

**Repo:** `yg-huly`, branch `yg_beta`

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/ai-usage.ts`
- Create: `plugins/yg-timesheet-resources/src/__tests__/ai-usage.test.ts`

**Reference:** `~/dev/claude-usage-fleet/dashboard.template.html`, the `<script>` block. The
maths there is the reference implementation and is already correct; this task moves it into a
typed, tested module. Read that file before starting.

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 11 and 12):
  - types `TokenRow`, `ActivityRow`, `SessionRow`, `UsageReport`, `Filters`
  - `T`, `A`, `S` column-index maps
  - `weight(model, i, o, cw, cr) -> number`
  - `modelVar(model) -> string`
  - `filterReport(report, filters) -> { tok, act, sess, baseW, cut }`
  - `rollup(rows, keyFn) -> Map<string, Agg>` where `Agg = { key, req, tok, wt }`
  - `sumBy(rows, keyFn, valFn) -> Map<string, number>`
  - `buildWindows(tok, act, sess) -> Window[]` where `Window = { start, last, tok, sec, models: Map<string, number>, sess: Set<string> }`

- [ ] **Step 1: Write the failing test**

`plugins/yg-timesheet-resources/src/__tests__/ai-usage.test.ts`:

```ts
import {
  weight, modelVar, filterReport, rollup, sumBy, buildWindows,
  type UsageReport, type TokenRow, type ActivityRow, type SessionRow
} from '../utils/ai-usage'

const H = 1755000000 - (1755000000 % 3600)

function report (over: Partial<UsageReport> = {}): UsageReport {
  return {
    report_schema: 1,
    tz: '+0530',
    generated: H + 86400,
    window: { from: H - 14 * 86400, to: H + 3600, days: 14 },
    accounts: [{ uuid: 'a1', label: 'Karthi', employee_name: 'Karthikeyan', plan_cents: 20000 }],
    devices: [{ id: 1, label: 'WSL', os: 'wsl', last_seen: H }],
    idle_sec: 300,
    stats: { dup_dropped: 5, stale_devices: [] },
    tokens: [
      [H, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 'opus-5', 2, 1_000_000, 0, 0, 0],
      [H, 'a1', 'WSL', 'Other', '~/o', 'vscode', 'sonnet-5', 1, 1_000_000, 0, 0, 0]
    ] as TokenRow[],
    activity: [
      [H, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 3600],
      [H, 'a1', 'WSL', 'Other', '~/o', 'vscode', 1800]
    ] as ActivityRow[],
    sessions: [['s1', 'a1', 'WSL', 'Portal', '~/p', 'terminal', H, H + 600, 1000]] as SessionRow[],
    ...over
  }
}

const ALL = { account: '*', device: '*', project: '*', model: '*', days: 14 }

describe('weighting', () => {
  it('prices a model at its list rate', () => {
    expect(weight('opus-5', 1_000_000, 0, 0, 0)).toBeCloseTo(15)
    expect(weight('sonnet-5', 1_000_000, 0, 0, 0)).toBeCloseTo(3)
    expect(weight('opus-5', 0, 1_000_000, 0, 0)).toBeCloseTo(75)
  })

  it('falls back to the mid tier for an unknown model rather than zero', () => {
    expect(weight('some-future-model', 1_000_000, 0, 0, 0)).toBeCloseTo(3)
    expect(modelVar('some-future-model')).toBe('--m5')
    expect(modelVar('opus-5')).toBe('--m1')
  })
})

describe('filtering', () => {
  it('with no filters returns every row', () => {
    const v = filterReport(report(), ALL)
    expect(v.tok).toHaveLength(2)
    expect(v.act).toHaveLength(2)
    expect(v.sess).toHaveLength(1)
  })

  it('filters by project, device and model', () => {
    expect(filterReport(report(), { ...ALL, project: 'Portal' }).tok).toHaveLength(1)
    expect(filterReport(report(), { ...ALL, model: 'sonnet-5' }).tok).toHaveLength(1)
    expect(filterReport(report(), { ...ALL, device: 'NOPE' }).tok).toHaveLength(0)
    expect(filterReport(report(), { ...ALL, account: 'nobody' }).tok).toHaveLength(0)
  })

  it('keeps the denominator at the whole period, so one project never looks like the whole plan', () => {
    const all = filterReport(report(), ALL)
    const one = filterReport(report(), { ...ALL, project: 'Portal' })
    expect(one.baseW).toBeCloseTo(all.baseW)
    const share = rollup(one.tok, (r) => r[3]).get('Portal')!.wt / one.baseW
    expect(share).toBeLessThan(1)
    expect(share).toBeCloseTo(15 / 18)
  })

  it('under a model filter keeps only the activity buckets that model ran in', () => {
    const v = filterReport(report(), { ...ALL, model: 'sonnet-5' })
    expect(v.act).toHaveLength(1)
    expect(v.act[0][3]).toBe('Other')
  })

  it('narrows the period relative to the newest row, not to wall clock', () => {
    const old: TokenRow = [H - 10 * 86400, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 'opus-5', 1, 1, 1, 1, 1]
    const r = report({ tokens: [...report().tokens, old] })
    expect(filterReport(r, { ...ALL, days: 14 }).tok).toHaveLength(3)
    expect(filterReport(r, { ...ALL, days: 7 }).tok).toHaveLength(2)
  })
})

describe('rollup', () => {
  it('sums requests, tokens and weight per key', () => {
    const m = rollup(report().tokens, (r) => r[3])
    expect(m.get('Portal')!.req).toBe(2)
    expect(m.get('Portal')!.tok).toBe(1_000_000)
    expect(m.get('Portal')!.wt).toBeCloseTo(15)
    expect(m.get('Other')!.wt).toBeCloseTo(3)
  })

  it('sumBy totals a single column', () => {
    const m = sumBy(report().activity, (r) => r[3], (r) => r[6])
    expect(m.get('Portal')).toBe(3600)
  })
})

describe('5-hour windows', () => {
  it('opens a new window only after five hours have elapsed', () => {
    const rows: TokenRow[] = [0, 3600, 7200, 18000].map((d) =>
      [H + d, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 'opus-5', 1, 10, 0, 0, 0])
    const w = buildWindows(rows, [], [])
    expect(w).toHaveLength(2)
    expect(w[0].start).toBe(H)
    expect(w[1].start).toBe(H + 18000)
  })

  it('counts a session in every window it was alive for, not only the one it started in', () => {
    const rows: TokenRow[] = [0, 18000].map((d) =>
      [H + d, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 'opus-5', 1, 10, 0, 0, 0])
    const sess: SessionRow[] = [['s1', 'a1', 'WSL', 'Portal', '~/p', 'terminal', H, H + 20000, 50]]
    const w = buildWindows(rows, [], sess)
    expect(w[0].sess.size).toBe(1)
    expect(w[1].sess.size).toBe(1)
  })

  it('accumulates active seconds and the per-model split inside a window', () => {
    const act: ActivityRow[] = [[H, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 1200]]
    const w = buildWindows(report().tokens, act, [])
    expect(w[0].sec).toBe(1200)
    expect(w[0].models.get('opus-5')).toBe(1_000_000)
    expect(w[0].models.get('sonnet-5')).toBe(1_000_000)
  })

  it('returns nothing for an empty period', () => {
    expect(buildWindows([], [], [])).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && npx jest ai-usage`
Expected: FAIL, cannot resolve `../utils/ai-usage`.

- [ ] **Step 3: Write the implementation**

`plugins/yg-timesheet-resources/src/utils/ai-usage.ts`:

```ts
// Pure aggregation for the AI Usage dashboard. No platform deps, so all the maths is testable
// in isolation from queries and rendering, the same way utils/dashboard.ts is.
//
// Ported from ~/dev/claude-usage-fleet/dashboard.template.html, which is the reference
// implementation: the portal render must match a build-dashboard.sh render of the same facts
// number for number.

export type TokenRow = [number, string, string, string, string, string, string, number, number, number, number, number]
export type ActivityRow = [number, string, string, string, string, string, number]
export type SessionRow = [string, string, string, string, string, string, number, number, number]

export const T = { hour: 0, acct: 1, dev: 2, project: 3, cwd: 4, surface: 5, model: 6, req: 7, in: 8, out: 9, cw: 10, cr: 11 } as const
export const A = { hour: 0, acct: 1, dev: 2, project: 3, cwd: 4, surface: 5, sec: 6 } as const
export const S = { id: 0, acct: 1, dev: 2, project: 3, cwd: 4, surface: 5, first: 6, last: 7, tok: 8 } as const

export interface UsageAccount { uuid: string, label: string, employee_name?: string | null, plan_cents: number }
export interface UsageDevice { id: number, label: string, os: string | null, last_seen: number | null }
export interface UsageReport {
  report_schema: number
  tz: string
  generated: number
  window: { from: number, to: number, days: number }
  accounts: UsageAccount[]
  devices: UsageDevice[]
  idle_sec: number
  stats: { dup_dropped: number, stale_devices: string[] }
  tokens: TokenRow[]
  activity: ActivityRow[]
  sessions: SessionRow[]
}
export interface Filters { account: string, device: string, project: string, model: string, days: number }
export interface Agg { key: string, req: number, tok: number, wt: number }
export interface UsageWindow { start: number, last: number, tok: number, sec: number, models: Map<string, number>, sess: Set<string> }

// List price per 1M tokens: in, out, cache-write, cache-read. Order also drives the blue ramp,
// darkest being most expensive.
const PRICE: Record<string, [number, number, number, number]> = {
  'opus-5': [15, 75, 18.75, 1.5],
  'opus-4-8': [15, 75, 18.75, 1.5],
  'opus-4-7': [15, 75, 18.75, 1.5],
  'sonnet-5': [3, 15, 3.75, 0.3],
  'sonnet-4-6': [3, 15, 3.75, 0.3],
  'haiku-4-5': [1, 5, 1.25, 0.1],
  'fable-5': [1, 5, 1.25, 0.1]
}
const DEFAULT_PRICE: [number, number, number, number] = [3, 15, 3.75, 0.3]
export const TIER = ['opus-5', 'opus-4-8', 'opus-4-7', 'sonnet-5', 'sonnet-4-6', 'haiku-4-5', 'fable-5']
const MVAR = ['--m1', '--m2', '--m2', '--m3', '--m3', '--m4', '--m5']

export function weight (model: string, i: number, o: number, cw: number, cr: number): number {
  const p = PRICE[model] ?? DEFAULT_PRICE
  return (i * p[0] + o * p[1] + cw * p[2] + cr * p[3]) / 1e6
}

export function modelVar (model: string): string {
  const i = TIER.indexOf(model)
  return i < 0 ? '--m5' : MVAR[i]
}

function maxHour (r: UsageReport): number {
  let mx = 0
  for (const row of r.tokens) if (row[T.hour] > mx) mx = row[T.hour]
  for (const row of r.activity) if (row[A.hour] > mx) mx = row[A.hour]
  return mx
}

export function filterReport (r: UsageReport, f: Filters): {
  tok: TokenRow[], act: ActivityRow[], sess: SessionRow[], baseW: number, cut: number
} {
  const cut = maxHour(r) + 3600 - f.days * 86400
  const inAcct = (a: string): boolean => f.account === '*' || a === f.account
  const inDev = (d: string): boolean => f.device === '*' || d === f.device

  const tok = r.tokens.filter((x) =>
    x[T.hour] >= cut && inAcct(x[T.acct]) && inDev(x[T.dev]) &&
    (f.project === '*' || x[T.project] === f.project) &&
    (f.model === '*' || x[T.model] === f.model))

  // Active time carries no model dimension in the logs. Under a model filter we keep only the
  // (hour, project) buckets where that model actually ran: an attribution, not a measurement.
  // The dashboard footnote says so, and that footnote must not be removed.
  const keep = f.model === '*' ? null : new Set(tok.map((x) => `${x[T.hour]}|${x[T.project]}`))

  const act = r.activity.filter((x) =>
    x[A.hour] >= cut && inAcct(x[A.acct]) && inDev(x[A.dev]) &&
    (f.project === '*' || x[A.project] === f.project) &&
    (keep == null || keep.has(`${x[A.hour]}|${x[A.project]}`)))

  const sess = r.sessions.filter((x) =>
    x[S.first] >= cut && inAcct(x[S.acct]) && inDev(x[S.dev]) &&
    (f.project === '*' || x[S.project] === f.project))

  // The denominator for share and cost is the selected ACCOUNT's whole period, never the
  // filtered subset. Renormalising inside a filter makes any single project look like it
  // consumed the entire plan fee, which is backwards for an invoice.
  let baseW = 0
  for (const x of r.tokens) {
    if (x[T.hour] >= cut && inAcct(x[T.acct])) baseW += weight(x[T.model], x[T.in], x[T.out], x[T.cw], x[T.cr])
  }

  return { tok, act, sess, baseW, cut }
}

export function rollup (rows: TokenRow[], keyFn: (r: TokenRow) => string): Map<string, Agg> {
  const m = new Map<string, Agg>()
  for (const r of rows) {
    const k = keyFn(r)
    let o = m.get(k)
    if (o === undefined) { o = { key: k, req: 0, tok: 0, wt: 0 }; m.set(k, o) }
    o.req += r[T.req]
    o.tok += r[T.in] + r[T.out] + r[T.cw] + r[T.cr]
    o.wt += weight(r[T.model], r[T.in], r[T.out], r[T.cw], r[T.cr])
  }
  return m
}

export function sumBy<R> (rows: R[], keyFn: (r: R) => string, valFn: (r: R) => number): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(keyFn(r), (m.get(keyFn(r)) ?? 0) + valFn(r))
  return m
}

const FIVE_HOURS = 18000

export function buildWindows (tok: TokenRow[], act: ActivityRow[], sess: SessionRow[]): UsageWindow[] {
  const hours = [...new Set(tok.map((r) => r[T.hour]))].sort((a, b) => a - b)
  const wins: UsageWindow[] = []
  let end = -Infinity
  for (const h of hours) {
    if (h >= end) { wins.push({ start: h, last: h, tok: 0, sec: 0, models: new Map(), sess: new Set() }); end = h + FIVE_HOURS }
    wins[wins.length - 1].last = h
  }
  const find = (h: number): UsageWindow | null => {
    for (let i = wins.length - 1; i >= 0; i--) if (h >= wins[i].start && h < wins[i].start + FIVE_HOURS) return wins[i]
    return null
  }
  for (const r of tok) {
    const w = find(r[T.hour])
    if (w == null) continue
    const t = r[T.in] + r[T.out] + r[T.cw] + r[T.cr]
    w.tok += t
    w.models.set(r[T.model], (w.models.get(r[T.model]) ?? 0) + t)
  }
  for (const r of act) { const w = find(r[A.hour]); if (w != null) w.sec += r[A.sec] }
  // A session counts in every window it was ALIVE for, not just the one it started in, or a
  // long session leaves later windows reading zero.
  for (const s of sess) {
    for (const w of wins) if (s[S.last] >= w.start && s[S.first] < w.start + FIVE_HOURS) w.sess.add(s[S.id])
  }
  return wins
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && npx jest ai-usage`
Expected: PASS, all describes green.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/utils/ai-usage.ts \
        plugins/yg-timesheet-resources/src/__tests__/ai-usage.test.ts
git commit -m "feat(ai-usage): pure aggregation module ported from the reference dashboard"
```

---

## Task 11: The dashboard page

**Repo:** `yg-huly`, branch `yg_beta`

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/ai-usage-api.ts`
- Modify: `plugins/yg-timesheet-resources/src/components/AiUsage.svelte` (replace the placeholder)
- Create: `plugins/yg-timesheet-resources/src/components/aiusage/FilterBar.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/aiusage/Tiles.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/aiusage/ProjectLedger.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/aiusage/Blocks.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/aiusage/Surfaces.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/aiusage/Models.svelte`

**Reference:** `~/dev/claude-usage-fleet/dashboard.template.html`. Port its markup, CSS and
per-section render functions. `renderTiles` becomes `Tiles.svelte`, `renderProjects` becomes
`ProjectLedger.svelte`, `renderBlocks` becomes `Blocks.svelte`, `renderSurface` becomes
`Surfaces.svelte`, `renderModels` becomes `Models.svelte`. All maths comes from
`utils/ai-usage.ts`; no component recomputes a weight or a share.

**Interfaces:**
- Consumes: everything exported by `utils/ai-usage.ts` (Task 10), and `GET /_usage/report` (Task 7).
- Produces: `usageBase()`, `usageGet(path)`, `usagePost(path, body)`, `usageDelete(path)` from
  `ai-usage-api.ts`, which Task 12 reuses.

- [ ] **Step 1: Write the API helper**

`plugins/yg-timesheet-resources/src/utils/ai-usage-api.ts`:

```ts
import { getMetadata } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'

// Same-origin by design: nginx routes /_usage to the sidecar, so nothing has to be threaded
// through the front service config or dev/prod/src/platform.ts. The override exists only for
// running the front dev server against a sidecar on another port.
export function usageBase (): string {
  try {
    const o = window.localStorage.getItem('YG_USAGE_URL')
    if (o != null && o !== '') return o.replace(/\/+$/, '')
  } catch { /* private mode or blocked storage: fall through to same origin */ }
  return `${window.location.origin}/_usage`
}

async function call (method: string, path: string, body?: unknown): Promise<any> {
  const token = getMetadata(presentation.metadata.Token) ?? ''
  const res = await fetch(`${usageBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (!res.ok) {
    throw new Error(res.status === 401
      ? 'Not authorised. AI Usage needs a Maintainer or Owner role.'
      : `Usage service returned ${res.status}`)
  }
  return await res.json()
}

export const usageGet = async (path: string): Promise<any> => await call('GET', path)
export const usagePost = async (path: string, body: unknown): Promise<any> => await call('POST', path, body)
export const usageDelete = async (path: string): Promise<any> => await call('DELETE', path)
```

- [ ] **Step 2: Write the dashboard shell**

Replace `plugins/yg-timesheet-resources/src/components/AiUsage.svelte` entirely:

```svelte
<script lang="ts">
  import { Scroller } from '@hcengineering/ui'
  import { usageGet } from '../utils/ai-usage-api'
  import { filterReport, type Filters, type UsageReport } from '../utils/ai-usage'
  import FilterBar from './aiusage/FilterBar.svelte'
  import Tiles from './aiusage/Tiles.svelte'
  import ProjectLedger from './aiusage/ProjectLedger.svelte'
  import Blocks from './aiusage/Blocks.svelte'
  import Surfaces from './aiusage/Surfaces.svelte'
  import Models from './aiusage/Models.svelte'

  let filters: Filters = { account: '*', device: '*', project: '*', model: '*', days: 14 }
  let report: UsageReport | undefined
  let error: string | undefined
  let loading = true
  let loadedDays = -1

  // Only `days` hits the network. Account, device, project and model are applied in
  // filterReport over the rows already in hand, so changing a filter is instant.
  $: if (filters.days !== loadedDays) { void load(filters.days) }

  async function load (days: number): Promise<void> {
    loadedDays = days
    loading = true
    error = undefined
    try {
      report = await usageGet(`/report?days=${days}`)
    } catch (e: any) {
      error = e?.message ?? 'Could not reach the usage service.'
      report = undefined
    } finally {
      loading = false
    }
  }

  $: view = report === undefined ? undefined : filterReport(report, filters)
  $: stale = report?.stats?.stale_devices ?? []
</script>

<Scroller>
  <div class="ai-usage">
    <h1>AI Usage</h1>
    <p class="lede">Where the shared Max plan actually goes, by device, project and model.
      Tokens are deduplicated by message and request id; active hours partition the timeline,
      so per-project time sums to real wall-clock and can be invoiced as-is.</p>

    {#if loading}
      <div class="state">Loading usage...</div>
    {:else if error !== undefined}
      <div class="state err">{error}</div>
    {:else if report !== undefined && view !== undefined}
      {#if stale.length > 0}
        <div class="state warn">
          No usage received from {stale.join(', ')} in over 24 hours.
          Check that machine's scheduled task.
        </div>
      {/if}

      <FilterBar {report} bind:filters />

      {#if view.tok.length === 0}
        <div class="state">No usage matches these filters.</div>
      {:else}
        <Tiles {report} {view} {filters} />
        <ProjectLedger {report} {view} {filters} />
        <Blocks {report} {view} {filters} />
        <Surfaces {view} />
        <Models {report} {view} {filters} />
      {/if}

      <p class="foot">
        {#if filters.model !== '*'}
          <b>Model filter is on.</b> Active hours and sessions have no per-model dimension in the
          logs, so those two columns show the buckets in which {filters.model} ran, not time spent
          on that model alone. Tokens, weighted and cost are exact.
        {/if}
        Tokens and active time are read from Claude Code's own logs, deduplicated by
        (message.id, requestId), because the raw logs replay every message that survives a session
        resume or compaction, which inflates a naive count about 2 times.
        <b>Weighted</b> prices tokens at published list rates; on a Max plan you pay nothing per
        token, so it is a relative measure of who burned the shared limit, not a bill.
        <b>Cost</b> divides the plan fee by that share. Times shown in {report.tz}.
      </p>
    {/if}
  </div>
</Scroller>

<style lang="scss">
  .ai-usage { padding: 1.5rem 1.25rem 4rem; max-width: 72rem; margin: 0 auto; }
  h1 { font-size: 1.3rem; font-weight: 700; margin: 0 0 .25rem; }
  .lede { color: var(--theme-dark-color); font-size: .85rem; margin: 0 0 1.25rem; max-width: 68ch; }
  .state { padding: 1.75rem 1rem; text-align: center; color: var(--theme-dark-color);
    border: 1px solid var(--theme-divider-color); border-radius: .5rem; margin-bottom: 1rem; }
  .state.err { color: var(--theme-error-color); }
  .state.warn { color: var(--theme-warning-color); text-align: left; }
  .foot { color: var(--theme-dark-color); font-size: .75rem; line-height: 1.65;
    border-top: 1px solid var(--theme-divider-color); padding-top: .9rem; margin-top: 2.25rem;
    max-width: 82ch; }
  .foot :global(b) { color: var(--theme-content-color); font-weight: 600; }
</style>
```

- [ ] **Step 3: Write the filter bar**

`FilterBar.svelte` takes `report` and a bindable `filters` and renders six controls, matching
the template's filter bar: Account, Device, Project, Model (all `<select>`), Period (a segmented
control with 24h / 7d / 14d / 30d), and a "Reset filters" button. Option lists come from the
report: accounts from `report.accounts` (label is `employee_name ?? label`), devices from
`report.devices`, projects as the distinct `r[T.project]` ordered by total weight descending,
models as the distinct `r[T.model]` ordered by `TIER.indexOf`.

The template's plan-fee number input is **not** ported. The fee now lives on the account and is
set on the config page.

- [ ] **Step 4: Write the five report components**

Each takes `report` and `view` as props and renders the corresponding section from the template,
using `rollup`, `sumBy` and `buildWindows`. Two behaviours must be preserved exactly:

- Every share and every cost divides by `view.baseW`, never by the filtered subtotal.
- `Blocks.svelte` refuses to merge accounts. When `report.accounts.length > 1 && filters.account === '*'`,
  it renders `Select one account to see its 5-hour blocks. The limit window is per account, so merging accounts here would not mean anything.` instead of a table.

Cost is `planCents / 100 * (days / 30) * (wt / baseW)`, where `planCents` is the sum of
`plan_cents` over the selected accounts.

Map the template's palette onto Huly theme variables so the page reads correctly in both
themes. Keep the template's own `--s1..--s8` and `--m1..--m5` series as locally-defined
variables on the page root, since they carry meaning (project series and model tier ramp), and
take `background`, `text` and `border` from the platform theme.

- [ ] **Step 5: Type-check and build**

Run: `cd ~/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && npm run svelte-check && npx jest ai-usage`
Expected: no new errors, jest still green.

- [ ] **Step 6: Deploy front-only and look at it**

This task changes no model, so a front-only build is enough:

```bash
cd ~/dev/client-projects/huly-migration/huly-selfhost
./build-beta.sh --front-only
docker compose -f compose.yml -f compose.override.beta.yml up -d --force-recreate front
docker compose -f compose.yml -f compose.override.beta.yml restart nginx
```

Open AI Usage as an admin. With no data ingested yet, expect the empty state and no console
errors. With Task 8's device enrolled and one collector run posted, expect four populated
tables.

- [ ] **Step 7: Commit**

```bash
cd ~/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/utils/ai-usage-api.ts \
        plugins/yg-timesheet-resources/src/components/AiUsage.svelte \
        plugins/yg-timesheet-resources/src/components/aiusage
git commit -m "feat(ai-usage): dashboard page with the four reports and six filters"
```

---

## Task 12: The config page

**Repo:** `yg-huly`, branch `yg_beta`

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/AiUsageConfig.svelte` (replace the placeholder)

**Interfaces:**
- Consumes: `usageGet`, `usagePost`, `usageDelete` (Task 11), and `GET/POST/DELETE /_usage/config*` (Task 7).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Build the three panels**

Load `snap = await usageGet('/config')` on mount, giving `{ rules, accounts, devices, unmapped }`.
Render three sections.

**Mapping.** A table of `snap.rules`: prefix, target, and a remove button. Target renders as
either the project name with a project chip, or the free-text label. An "Add rule" row takes a
prefix, a kind toggle (Project or Label), and then either a tracker project picker or a text
input. Save with:

```ts
await usagePost('/config/rule', {
  prefix,
  target_kind: kind,                                  // 'project' | 'label'
  project_id: kind === 'project' ? project._id : null,
  project_name: kind === 'project' ? project.name : null,   // snapshot, see below
  label: kind === 'label' ? label : null
})
```

The project id **and** its name are both sent. The sidecar stores the snapshot and never reads
Huly's database, so a renamed or deleted project still renders in historical reports. Use
`createQuery().query(tracker.class.Project, {}, ...)` for the picker options, following
`ProjectApproversList.svelte`.

Below the table, render `snap.unmapped` as a list of raw paths with their token volume and a
"Map this" button that prefills the add-rule row with `normPath`-style prefix suggestion (use
the returned `cwd_norm` directly, which is already normalized).

**Accounts.** A row per `snap.accounts` entry: the Claude label and email, an employee picker
(`UserBoxList` from `@hcengineering/contact-resources`, as `ProjectApprovers.svelte` uses, but
single-select), and a monthly fee input in whole currency units. Save with:

```ts
await usagePost(`/config/account/${encodeURIComponent(uuid)}`, {
  employee_ref: employee?._id ?? null,
  employee_name: employee?.name ?? null,
  plan_cents: Math.round(fee * 100)
})
```

**Devices.** A row per `snap.devices` entry: label, os, last seen as a relative time, and a
`stale` marker reading `no payload in over 24 hours`. A Revoke button calls
`usagePost('/config/device/' + id + '/revoke', {})`. An "Add device" input calls
`usagePost('/config/device', { label })` and then shows the returned token in a copyable block
with the notice: `Copy this now. It is shown once and cannot be retrieved later.`

Reload `snap` after every mutation so the page never shows stale state.

- [ ] **Step 2: Type-check**

Run: `cd ~/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && npm run svelte-check`
Expected: no new errors.

- [ ] **Step 3: Deploy and exercise every control**

```bash
cd ~/dev/client-projects/huly-migration/huly-selfhost
./build-beta.sh --front-only
docker compose -f compose.yml -f compose.override.beta.yml up -d --force-recreate front
docker compose -f compose.yml -f compose.override.beta.yml restart nginx
```

By hand, in order: add a device and confirm the token appears once; add a project rule and a
label rule; confirm an unmapped path appears and that mapping it moves it out of the list;
link an account to an employee and set a fee; go to the Usage page and confirm the project
names and the Cost column changed with no re-ingest; come back and revoke the device.

- [ ] **Step 4: Commit**

```bash
cd ~/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/components/AiUsageConfig.svelte
git commit -m "feat(ai-usage): config page for mapping rules, account links and device tokens"
```

---

## Task 13: End-to-end acceptance against the reference render

**Repo:** both (no code changes expected; fixes go to whichever repo is wrong)

**Files:**
- Create: `notes/ai-usage-acceptance-2026-08-26.md` (in `huly-migration`)

**Interfaces:**
- Consumes: everything.
- Produces: a recorded comparison, and a green light for the production merge.

The standalone template is the reference implementation. Any divergence between it and the
portal is a bug in the port until proven otherwise.

- [ ] **Step 1: Capture one payload two ways**

```bash
cd ~/dev/claude-usage-fleet
./yg-usage.sh --days 14 --out /tmp/facts.json
./build-dashboard.sh /tmp/facts.json /tmp/reference.html
./yg-usage.sh --days 14 --post http://localhost/_usage/ingest --token "$YG_USAGE_TOKEN"
```

Use the device token from Task 8. Expect `posted OK` on the last command.

- [ ] **Step 2: Map every project so both renders group identically**

In the portal config page, add a rule for every path the reference render shows as a project,
mapping each to the same name the reference uses. Set the account's plan fee to the same value
the reference defaults to (200), so the Cost columns are comparable.

- [ ] **Step 3: Compare, number for number**

Open `/tmp/reference.html` and the portal AI Usage page side by side, both on 14d with no
filters. Compare and record: the six tiles; every row of the project ledger (active hours,
tokens, cost, sessions); the 5-hour block count and each block's used-of-5h percentage; the
surface split; and every model row's requests, tokens and weighted value.

Then repeat with a model filter applied to both, and confirm the model-filter footnote appears
in the portal.

- [ ] **Step 4: Verify the ingest properties end to end**

```bash
cd ~/dev/claude-usage-fleet
./yg-usage.sh --days 14 --post http://localhost/_usage/ingest --token "$YG_USAGE_TOKEN"
```

Reload the portal page. Every number must be unchanged: re-posting a window replaces it. Then
check the database directly:

```bash
cd ~/dev/client-projects/huly-migration/huly-selfhost
docker compose -f compose.yml -f compose.override.beta.yml exec usage \
  node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/usage.db');
  for (const t of ['fact_token','fact_activity','fact_session','ingest_log'])
    console.log(t, d.prepare('SELECT count(*) c FROM '+t).get().c)"
```

Row counts must be identical before and after the second post, and `ingest_log` must have
exactly one more row.

- [ ] **Step 5: Verify the security boundary from outside the portal**

```bash
curl -s -o /dev/null -w 'no token: %{http_code}\n'   http://localhost/_usage/report
curl -s -o /dev/null -w 'bad token: %{http_code}\n'  -H 'Authorization: Bearer garbage' http://localhost/_usage/report
curl -s -o /dev/null -w 'device token on report: %{http_code}\n' -H "Authorization: Bearer $YG_USAGE_TOKEN" http://localhost/_usage/report
```

All three must be `401`. Then sign in as an ordinary User account, open the app switcher, and
confirm AI Usage is absent; if it can be forced open by URL, confirm the page shows the
not-authorised error rather than any data.

- [ ] **Step 6: Record the result and commit**

Write `notes/ai-usage-acceptance-2026-08-26.md` with the two renders' numbers side by side, the
idempotency row counts, the three `401`s, and any divergence found with its resolution.

```bash
cd ~/dev/client-projects/huly-migration
git add notes/ai-usage-acceptance-2026-08-26.md
git commit -m "notes(usage): AI Usage acceptance run against the reference dashboard render"
```

---

## Deferred to the production merge

Not part of this plan, listed so nothing is lost. From spec section 10, when the `yg_beta` work
is batch-merged to `yg_develop`:

- Add `location /_usage` to the production `.huly.nginx` and **restart nginx**.
- Add the `usage` service to the production `compose.yml` with the production `SECRET` and
  workspace uuid from the production `huly_v7.conf`.
- Add the SQLite file's bind mount to `s3-backup.sh`.
- Issue fresh production device tokens; do not carry the beta ones over.
- Re-point each machine's Task Scheduler entry at the production URL.
