# Punch-in device / location capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture device/OS, browser, IP+coarse city, and GPS location on each punch-in (best-effort, non-blocking), show them to HR+owners, and nudge users to enable location via a global purpose-agnostic banner.

**Architecture:** Add optional fields to `AttendanceSession`. Punch-in writes the synchronous signals (device/browser from userAgent) into the createDoc instantly, then fires a background best-effort gather (geo-IP fetch + GPS) that patches the session. A global banner mounted via the existing `WorkbenchExtensions` slot reads the geolocation permission state (no prompt) and shows a neutral warning strip when not granted. HR sees the details on the individual session log.

**Tech Stack:** TypeScript, Svelte, Huly platform, jest (ts-jest) in `plugins/yg-timesheet-resources`.

**Spec:** `docs/superpowers/specs/2026-08-13-punchin-device-location-capture-design.md`

## Global Constraints

- **No em-dashes** anywhere (code, comments, commit messages, output). Hyphens or rephrase.
- **No semicolons** as statement terminators in TS; 2-space indent; match surrounding style.
- **Capture is best-effort and MUST NOT block or delay the punch.** The punch completes on the createDoc; IP/GPS are gathered detached and never throw into the punch path.
- **Neutral banner copy** exactly: `Location access is off. Please enable location in your browser settings.` No mention of "record", "punch-in", or purpose.
- **Display is HR + owners only** (Option A, UI-gated). Do NOT add the captured device/IP/location to `AttendanceSessionRow.svelte` or `MyAttendance.svelte` (the employee self-view). Only the HR individual log shows them.
- **GPS + banner cannot be exercised on the http beta** (insecure context); they validate on the HTTPS prod portal. Device/browser/IP validate on beta.
- Tests: run from `plugins/yg-timesheet-resources` with `npx jest <path>` (script `npm test`).
- eslint gate: repo has pre-existing lint debt; "no new errors" = same `path:LINE:COL error` lines vs a `git stash` baseline.

---

### Task 1: `parseUserAgent` pure helper + unit tests

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/user-agent.ts`
- Test: `plugins/yg-timesheet-resources/src/utils/__tests__/user-agent.test.ts`

**Interfaces:**
- Produces: `parseUserAgent(ua: string): { device: string, browser: string }`.

- [ ] **Step 1: Write the failing test**

Create `user-agent.test.ts`:

```ts
import { parseUserAgent } from '../user-agent'

describe('parseUserAgent', () => {
  it('Chrome on Windows desktop', () => {
    const r = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36')
    expect(r.browser).toBe('Chrome 151')
    expect(r.device).toBe('Windows / Desktop')
  })
  it('Safari on iPhone', () => {
    const r = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
    expect(r.browser).toBe('Safari 17')
    expect(r.device).toBe('iOS / Mobile')
  })
  it('Chrome on Android mobile', () => {
    const r = parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36')
    expect(r.browser).toBe('Chrome 151')
    expect(r.device).toBe('Android / Mobile')
  })
  it('Edge on Windows', () => {
    const r = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0')
    expect(r.browser).toBe('Edge 151')
    expect(r.device).toBe('Windows / Desktop')
  })
  it('Firefox on macOS', () => {
    const r = parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0')
    expect(r.browser).toBe('Firefox 130')
    expect(r.device).toBe('macOS / Desktop')
  })
  it('unknown UA yields safe generic labels, never throws', () => {
    expect(parseUserAgent('')).toEqual({ device: 'Unknown', browser: 'Unknown' })
    expect(parseUserAgent('some-random-string')).toEqual({ device: 'Unknown', browser: 'Unknown' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/yg-timesheet-resources && npx jest src/utils/__tests__/user-agent.test.ts`
Expected: FAIL - `parseUserAgent` not exported.

- [ ] **Step 3: Write the implementation**

Create `user-agent.ts`:

```ts
// Pure userAgent parser: enough to label a punch-in's device + browser for HR. Order matters
// (Edge/Opera masquerade as Chrome; Chrome carries "Safari"), so test the more specific tokens
// first. Never throws - unknown input yields "Unknown".

interface Parsed { device: string, browser: string }

function osLabel (ua: string): string {
  if (/Android/i.test(ua)) return 'Android / Mobile'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS / Mobile'
  if (/Windows NT/i.test(ua)) return 'Windows / Desktop'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS / Desktop'
  if (/Linux/i.test(ua)) return 'Linux / Desktop'
  return 'Unknown'
}

function browserLabel (ua: string): string {
  const m = (re: RegExp): string | undefined => {
    const g = re.exec(ua)
    return g?.[1]?.split('.')[0]
  }
  let v: string | undefined
  if ((v = m(/Edg\/(\d+)/)) !== undefined) return `Edge ${v}`
  if ((v = m(/OPR\/(\d+)/)) !== undefined) return `Opera ${v}`
  if ((v = m(/Firefox\/(\d+)/)) !== undefined) return `Firefox ${v}`
  if ((v = m(/Chrome\/(\d+)/)) !== undefined) return `Chrome ${v}`
  if (/Safari/.test(ua) && (v = m(/Version\/(\d+)/)) !== undefined) return `Safari ${v}`
  return 'Unknown'
}

export function parseUserAgent (ua: string): Parsed {
  if (ua == null || ua === '') return { device: 'Unknown', browser: 'Unknown' }
  return { device: osLabel(ua), browser: browserLabel(ua) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugins/yg-timesheet-resources && npx jest src/utils/__tests__/user-agent.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/user-agent.ts plugins/yg-timesheet-resources/src/utils/__tests__/user-agent.test.ts
git commit -m "feat(yg-timesheet): pure parseUserAgent helper for punch-in device/browser

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Data model - optional capture fields on AttendanceSession

New optional fields. No data migration (existing sessions simply lack them); the model rebuild happens on upgrade-workspace at deploy.

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts` (AttendanceSession interface, ~line 152-160)
- Modify: `models/yg-timesheet/src/index.ts` (`TAttendanceSession`, ~line 166-175)

**Interfaces:**
- Produces: `AttendanceSession.{device?,browser?,userAgent?,ip?,ipCity?:string; geoLat?,geoLng?,geoAccuracy?:number}`.

- [ ] **Step 1: Extend the interface**

In `plugins/yg-timesheet/src/index.ts`, add to `interface AttendanceSession` (after `punchOutNote?`):

```ts
  device?: string      // parsed from userAgent at punch-in
  browser?: string
  userAgent?: string   // raw, for audit
  ip?: string          // self-reported public IP
  ipCity?: string      // coarse "City, Region, Country" from the geo-IP call
  geoLat?: number      // GPS (when granted on a secure context)
  geoLng?: number
  geoAccuracy?: number // metres
```

- [ ] **Step 2: Extend the model class**

In `models/yg-timesheet/src/index.ts`, add to `TAttendanceSession` (after `punchOutNote`). `TypeString`/`TypeNumber` are already imported:

```ts
  @Prop(TypeString(), core.string.Object) device?: string
  @Prop(TypeString(), core.string.Object) browser?: string
  @Prop(TypeString(), core.string.Object) userAgent?: string
  @Prop(TypeString(), core.string.Object) ip?: string
  @Prop(TypeString(), core.string.Object) ipCity?: string
  @Prop(TypeNumber(), core.string.Object) geoLat?: number
  @Prop(TypeNumber(), core.string.Object) geoLng?: number
  @Prop(TypeNumber(), core.string.Object) geoAccuracy?: number
```

- [ ] **Step 3: Typecheck both packages**

Run: `cd plugins/yg-timesheet && npx tsc --noEmit -p tsconfig.json` then rebuild its types if downstream needs them (`npm run build` if present), then `cd ../../models/yg-timesheet && npx tsc --noEmit -p tsconfig.json`
Expected: no NEW errors vs a `git stash` baseline (models/yg-timesheet has ~7 known pre-existing errors).

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts models/yg-timesheet/src/index.ts
git commit -m "feat(yg-timesheet): AttendanceSession device/ip/geo capture fields

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Capture pipeline (userAgent sync + IP/GPS background)

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/capture.ts`
- Modify: `plugins/yg-timesheet-resources/src/utils/attendance-write.ts` (`createPunchIn`)

**Interfaces:**
- Consumes: `parseUserAgent` (Task 1); `AttendanceSession` fields (Task 2).
- Produces: `readDeviceFields(): { device?, browser?, userAgent?: string }`; `capturePunchContext(client: TxOperations, sessionId: Ref<AttendanceSession>): Promise<void>`.

- [ ] **Step 1: Create the capture helper**

Create `capture.ts`:

```ts
//
// YoungGlobes: best-effort punch-in context capture. readDeviceFields is synchronous (goes into the
// punch createDoc so device/browser are recorded instantly). capturePunchContext is fired
// detached after the punch is saved - it gathers IP + GPS with short timeouts and patches the
// session. It NEVER throws and never blocks the punch.
//
import core, { type Ref, type TxOperations } from '@hcengineering/core'
import ygTimesheet, { type AttendanceSession } from '@hcengineering/yg-timesheet'
import { parseUserAgent } from './user-agent'

export function readDeviceFields (): { device?: string, browser?: string, userAgent?: string } {
  if (typeof navigator === 'undefined' || navigator.userAgent == null || navigator.userAgent === '') return {}
  const ua = navigator.userAgent
  const { device, browser } = parseUserAgent(ua)
  return { device, browser, userAgent: ua }
}

async function fetchGeoIp (signal: AbortSignal): Promise<{ ip?: string, ipCity?: string }> {
  try {
    const res = await fetch('https://ipwho.is/', { signal })
    if (!res.ok) return {}
    const j = (await res.json()) as { ip?: string, city?: string, region?: string, country?: string, success?: boolean }
    if (j.success === false) return {}
    const parts = [j.city, j.region, j.country].filter((x) => x != null && x !== '')
    return { ip: j.ip, ipCity: parts.length > 0 ? parts.join(', ') : undefined }
  } catch {
    return {}
  }
}

async function getGeo (): Promise<{ geoLat?: number, geoLng?: number, geoAccuracy?: number }> {
  if (typeof window === 'undefined' || !window.isSecureContext) return {}
  if (typeof navigator === 'undefined' || navigator.geolocation === undefined) return {}
  return await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ geoLat: pos.coords.latitude, geoLng: pos.coords.longitude, geoAccuracy: pos.coords.accuracy }),
      () => resolve({}),
      { timeout: 5000, maximumAge: 60000, enableHighAccuracy: false }
    )
  })
}

export async function capturePunchContext (client: TxOperations, sessionId: Ref<AttendanceSession>): Promise<void> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const [geoIp, geo] = await Promise.all([fetchGeoIp(ctrl.signal), getGeo()])
    clearTimeout(t)
    const merged: Record<string, unknown> = { ...geoIp, ...geo }
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(merged)) if (v !== undefined) clean[k] = v
    if (Object.keys(clean).length > 0) {
      await client.updateDoc(ygTimesheet.class.AttendanceSession, core.space.Workspace, sessionId, clean)
    }
  } catch {
    // best-effort: capture failures must never disrupt the punch
  }
}
```

- [ ] **Step 2: Wire into `createPunchIn`**

In `attendance-write.ts`: add the import, include the device fields in the createDoc, capture the returned id, and fire the background gather. Change the import block to add:

```ts
import { capturePunchContext, readDeviceFields } from './capture'
```

Replace the `await client.createDoc(...)` at the end of `createPunchIn` with:

```ts
  const id = await client.createDoc(ygTimesheet.class.AttendanceSession, core.space.Workspace, {
    employee,
    date: localMidnight(at),
    punchIn: at,
    mode,
    ...readDeviceFields(),
    ...(trimmed !== '' ? { punchInNote: trimmed } : {})
  })
  void capturePunchContext(client, id)
```

(The function stays `Promise<void>`; it returns right after the createDoc - the punch is instant. `void` detaches the gather; `capturePunchContext` never rejects.)

- [ ] **Step 3: Typecheck + run the suite**

Run: `cd plugins/yg-timesheet-resources && npm test`
Expected: PASS (existing suites unaffected; no test added here - the async I/O is verified manually on beta in Task 6). If svelte-check/tsc is wired, confirm no new errors in `capture.ts` / `attendance-write.ts`.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/capture.ts plugins/yg-timesheet-resources/src/utils/attendance-write.ts
git commit -m "feat(yg-timesheet): capture device/ip/gps on punch-in (best-effort, non-blocking)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Global location-permission banner

Mounted on every page via the existing `WorkbenchExtensions` slot (same as `AttendanceReminder`). Reads permission state without prompting.

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/LocationPermissionBanner.svelte`
- Modify: `plugins/yg-timesheet/src/index.ts` (component id, ~line 225 `component: {}` block)
- Modify: `plugins/yg-timesheet-resources/src/index.ts` (import + map, ~line 126 `component: {}` block)
- Modify: `models/yg-timesheet/src/index.ts` (register the ComponentPointExtension, near the existing AttendanceReminder registration ~line 465)

**Interfaces:**
- Consumes: `ygTimesheet.component.LocationPermissionBanner` (declared here); `workbench.extensions.WorkbenchExtensions`, `presentation.class.ComponentPointExtension` (already imported in the model).

- [ ] **Step 1: Declare the component id (plugin package)**

In `plugins/yg-timesheet/src/index.ts`, in the `component: { ... }` block (with `AttendanceReminder: '' as AnyComponent`), add:

```ts
    LocationPermissionBanner: '' as AnyComponent,
```

- [ ] **Step 2: Create the banner component**

Create `LocationPermissionBanner.svelte`:

```svelte
<!--
  YoungGlobes: global location-permission reminder. Mounted on every workbench page via
  workbench.extensions.WorkbenchExtensions. Reads the geolocation permission state WITHOUT
  prompting (Permissions API) and shows a neutral, purpose-agnostic strip when it is not granted.
  Silent on an insecure context (the http beta cannot grant geolocation) and when the Permissions
  API is unavailable. Disappears the moment location is granted.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  let show = false
  let status: PermissionStatus | undefined

  function apply (state: PermissionState): void {
    show = state !== 'granted'
  }

  onMount(async () => {
    if (typeof window === 'undefined' || !window.isSecureContext) return
    if (typeof navigator === 'undefined' || navigator.permissions?.query === undefined) return
    try {
      status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
      apply(status.state)
      status.onchange = () => {
        if (status !== undefined) apply(status.state)
      }
    } catch {
      // Permissions API cannot query geolocation here (older Safari) - stay hidden.
    }
  })

  onDestroy(() => {
    if (status !== undefined) status.onchange = null
  })
</script>

{#if show}
  <div class="yg-loc-banner" role="alert">
    <span class="yg-loc-banner__msg">Location access is off. Please enable location in your browser settings.</span>
  </div>
{/if}

<style lang="scss">
  .yg-loc-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px 16px;
    background: var(--theme-warning-color, #b8860b);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .yg-loc-banner__msg {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
```

- [ ] **Step 3: Map the component id to the svelte file (resources package)**

In `plugins/yg-timesheet-resources/src/index.ts`, add the import near the other component imports:

```ts
import LocationPermissionBanner from './components/LocationPermissionBanner.svelte'
```

and add `LocationPermissionBanner,` to the `component: { ... }` block (alongside `AttendanceReminder,`).

- [ ] **Step 4: Register it on the global slot (model)**

In `models/yg-timesheet/src/index.ts`, right after the existing `builder.createDoc(presentation.class.ComponentPointExtension, ...)` for `AttendanceReminder`, add:

```ts
  builder.createDoc(presentation.class.ComponentPointExtension, core.space.Model, {
    extension: workbench.extensions.WorkbenchExtensions,
    component: ygTimesheet.component.LocationPermissionBanner
  })
```

- [ ] **Step 5: Typecheck**

Run: `cd plugins/yg-timesheet && npx tsc --noEmit -p tsconfig.json` (rebuild types if needed), then the resources package (svelte-check if wired, else rely on Task 6 build), then `cd models/yg-timesheet && npx tsc --noEmit -p tsconfig.json`.
Expected: no new errors vs baseline.

- [ ] **Step 6: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts plugins/yg-timesheet-resources/src/index.ts plugins/yg-timesheet-resources/src/components/LocationPermissionBanner.svelte models/yg-timesheet/src/index.ts
git commit -m "feat(yg-timesheet): global location-permission banner (purpose-agnostic)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: HR individual-log display (HR + owners only)

Show device/browser/IP/city + a Map link on the HR individual session log. Thread the fields through the `SessionLike` mapping and the `individualLog` pure helper. Do NOT touch `AttendanceSessionRow.svelte` / `MyAttendance.svelte`.

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/HrAttendance.svelte` (the `SessionLike` map ~line 103 and the individual-log table)
- Modify: the pure helper file that exports `individualLog` (imported by HrAttendance - locate it, likely `plugins/yg-timesheet-resources/src/utils/hr-attendance.ts` or similar) and its test if present.

**Interfaces:**
- Consumes: `AttendanceSession` capture fields (Task 2).

- [ ] **Step 1: Locate `individualLog` and its row type**

Run: `grep -rn "individualLog\|SessionLike" plugins/yg-timesheet-resources/src` to find the helper file, the `SessionLike` type, and the individual-log row type. Read them so the field threading is exact.

- [ ] **Step 2: Extend `SessionLike` and the individual-log row**

In the helper: add the passthrough fields to `SessionLike` (`device?, browser?, ip?, ipCity?: string; geoLat?, geoLng?: number`) and to the individual-log row type the same fields; copy them straight from the session into each individual-log row (no aggregation - these are per-session). In `HrAttendance.svelte`, extend the `sessions = res.map((s) => ({ ... }))` mapping (~line 103) to include those fields from `s`.

If the helper has a unit test, update it: add the fields to a sample session and assert they pass through to the individual-log row.

- [ ] **Step 3: Render the details in the individual-log table**

In `HrAttendance.svelte`'s individual-log table, add a details cell per row showing (muted dash when unset):

```svelte
        <td class="att-audit">
          <div class="att-audit__line">{row.device ?? '-'}{#if row.browser} / {row.browser}{/if}</div>
          <div class="att-audit__line att-audit__muted">{row.ip ?? '-'}{#if row.ipCity} - {row.ipCity}{/if}</div>
          {#if row.geoLat !== undefined && row.geoLng !== undefined}
            <a class="att-audit__map" href={`https://maps.google.com/?q=${row.geoLat},${row.geoLng}`} target="_blank" rel="noopener noreferrer">Map</a>
          {/if}
        </td>
```

Add a matching header cell to that table and a small style block (`.att-audit__muted { color: var(--yg-text-faint); font-size: 12px } .att-audit__line { font-size: 13px }`). Keep the existing columns intact and adjust any hard-coded `colspan` on the table's empty-state row to include the new column.

- [ ] **Step 4: Confirm the employee self-view is untouched**

Run: `git diff --name-only` and confirm neither `AttendanceSessionRow.svelte` nor `MyAttendance.svelte` is in the change set.

- [ ] **Step 5: Run the suite + eslint gate**

Run: `cd plugins/yg-timesheet-resources && npm test`
Expected: PASS (incl. any updated helper test). eslint: no new errors vs `git stash` baseline for the touched files.

- [ ] **Step 6: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/HrAttendance.svelte plugins/yg-timesheet-resources/src/utils/<individualLog-file>.ts
git commit -m "feat(yg-timesheet): show punch-in device/ip/location on HR individual log

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Build, deploy to beta, verify

MODEL change (new fields + new global-extension registration), full deploy path. Run from `huly-migration/huly-selfhost`.

- [ ] **Step 1: Push**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && git push origin yg_beta
```

- [ ] **Step 2: Full build + recreate + upgrade**

From `huly-selfhost`:

```bash
./build-beta.sh
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d --force-recreate transactor account front workspace
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
./run-tool-beta.sh upgrade-workspace yg
```

- [ ] **Step 3: Front 200 + transactor healthy**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8087/
```
Expected: `200`. Confirm the transactor has no Kafka/redpanda timeout errors after recreate (redpanda must be up).

- [ ] **Step 4: CSP check for the geo-IP host**

Confirm whether the front sends a Content-Security-Policy that would block `https://ipwho.is`. Check response headers and the front `index.html` for a `connect-src`:

```bash
curl -sI http://localhost:8087/ | grep -i content-security-policy || echo "no CSP header (beta)"
```
If a `connect-src` CSP is present and does not include the geo-IP host, note it - `ipwho.is` must be added to the prod front CSP or the IP fetch is blocked in prod. On the beta (no CSP), the fetch works. Record the finding for the prod cutover.

- [ ] **Step 5: DB spot-check after a real punch-in (manual)**

Punch in from a browser on the beta, then:

```bash
URL="$(grep -E '^CR_DB_URL=' huly_v7.conf | cut -d= -f2-)?sslmode=require"
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml exec -T cockroach cockroach sql --url "$URL" --format=records -e "
SELECT device, browser, ip, \"ipCity\", \"geoLat\" FROM yg_timesheet
WHERE _class = 'yg-timesheet:class:AttendanceSession' ORDER BY \"punchIn\" DESC LIMIT 3;"
```
Expected: `device`/`browser` populated immediately; `ip`/`ipCity` populated within a few seconds (unless the geo-IP call is blocked); `geoLat` NULL on the http beta (geolocation blocked on insecure context - expected).

- [ ] **Step 6: Manual functional checks (report back)**

- Punch in on beta: confirm the punch is instant, and device/browser/IP/city appear on the HR individual log within a few seconds.
- Confirm the employee's own attendance view (MyAttendance) does NOT show device/IP/location.
- The GPS path + the location banner require the HTTPS prod portal to validate (insecure beta cannot grant geolocation). Note this for the prod cutover: on prod, deny location once and confirm the banner appears on every page with the neutral copy and disappears after granting.

- [ ] **Step 7: Report the deploy + verification outcome.** Prod follows on the batch merge to `yg_develop` (MODEL change - needs upgrade-workspace there too, plus the CSP allowlist for `ipwho.is`).

---

## Self-Review

**Spec coverage:** device/browser (Task 1 parser + Task 3 sync capture), IP+city (Task 3 geo-IP), GPS (Task 3 getGeo), non-blocking punch (Task 3 detached `void capturePunchContext`), model fields (Task 2), global banner via WorkbenchExtensions + Permissions API + secure-context gate + neutral copy + auto-hide (Task 4), HR+owners display with employee self-view excluded (Task 5), no-migration + upgrade-workspace (Tasks 2/6), geo-IP CSP gotcha + GPS-prod-only validation (Task 6). HR-only mirror (Option B) is explicitly deferred per spec - not implemented, correct.

**Placeholder scan:** all code steps carry real code. Task 5 Step 1 is a deliberate locate step (the `individualLog`/`SessionLike` exact shape is read at implementation time) with concrete field lists and render markup given in Steps 2-3; not a logic placeholder.

**Type consistency:** `AttendanceSession` optional fields (Task 2) are consumed identically by `capturePunchContext`/`readDeviceFields` (Task 3), the HR display (Task 5), and are strings/numbers matching the `@Prop(TypeString/TypeNumber)` model. `parseUserAgent` signature (Task 1) matches its use in `readDeviceFields` (Task 3). The banner component id `LocationPermissionBanner` is declared (Task 4 Step 1), mapped (Step 3), and registered (Step 4) under the same name.
