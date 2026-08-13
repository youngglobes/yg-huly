# Punch-in device / location capture - design

Date: 2026-08-13
Status: approved (brainstorming), pending implementation plan
Area: yg-timesheet attendance (yg_beta)

## Problem

When an employee punches in we currently store only employee/date/punchIn/mode/note. HR wants
context on each punch-in: the device and browser used, the IP address, and where the person was
(location). This is an attendance-audit aid, shown to HR and owners.

## Decisions (from brainstorming)

1. **Capture four signals:** device/OS, browser, IP address, and location.
2. **Capture must NOT delay or block the punch.** The punch-in timestamp is recorded instantly with
   the synchronous signals; the slow signals (IP fetch, GPS fix) are gathered in the background and
   patched onto the same session a moment later. Any signal that fails or is denied is simply left
   blank; the punch always succeeds.
3. **Location = GPS when allowed, IP city as fallback.** Precise `navigator.geolocation` lat/lng when
   the employee has granted location; otherwise the coarse city derived from the IP stands in.
4. **A global, purpose-agnostic location-permission banner** (NOT a per-punch toast). Shown in the
   header on every page when geolocation is not granted, decoupled from punch-in so it does not
   reveal that location is captured at punch-in. Neutral copy: "Location access is off. Please
   enable location in your browser settings." It disappears the moment location is granted.
5. **Visibility: HR + owners only** (Option A - UI-gated, see Privacy).
6. **Neutral banner copy** - no mention of "record", "punch-in", or "location" purpose.

## Out of scope

- No reverse-geocoding API. GPS is stored as coordinates and shown as a Google Maps link
  (`https://maps.google.com/?q=<lat>,<lng>`); the human-readable place text comes only from the
  IP-derived city.
- No server-derived (authoritative) IP. IP is self-reported via a client-side geo-IP call
  (best-effort, spoofable by a determined user) - acceptable for attendance audit. Server-derived IP
  is a possible future hardening.
- No hard privacy boundary in this pass (see Privacy - Option A). A real HR-only mirror is deferred.
- No change to the punch-out flow (capture is punch-in only).

## Data model

New OPTIONAL fields on `AttendanceSession` (`plugins/yg-timesheet/src/index.ts` interface +
`models/yg-timesheet/src/index.ts` `TAttendanceSession`). All optional because capture is
best-effort and any signal may be absent:

```
device?: string     // e.g. "Windows 10 / Desktop", "Android / Mobile"
browser?: string    // e.g. "Chrome 151"
userAgent?: string  // raw navigator.userAgent, for audit
ip?: string         // public IP (self-reported)
ipCity?: string     // coarse "City, Region, Country" from the geo-IP call
geoLat?: number     // GPS latitude (when granted)
geoLng?: number     // GPS longitude
geoAccuracy?: number // GPS accuracy in metres
```

Modeled with `@Prop(TypeString(), ...)` / `@Prop(TypeNumber(), ...)` following the existing optional
fields in this file. No migration needed - existing sessions simply have these unset.

## Capture pipeline

Location of the write: `plugins/yg-timesheet-resources/src/utils/attendance-write.ts` `punchIn` and
a new capture helper.

1. **Synchronous (instant, into the createDoc):** read `navigator.userAgent`, parse it to
   `device`/`browser` via a pure helper, and include `device`, `browser`, `userAgent` in the
   `createDoc(AttendanceSession, ...)`. Capture the returned session `Ref`.
2. **Background (fire-and-forget after the createDoc returns):** an async `gatherPunchContext()`
   that, with short timeouts, (a) fetches IP + coarse city from a geo-IP endpoint, and (b) if
   `window.isSecureContext`, calls `navigator.geolocation.getCurrentPosition` for lat/lng/accuracy.
   Whatever it collects is written via `updateDoc(AttendanceSession, ..., sessionId, {...})`. Errors
   and denials are swallowed (best-effort); the punch is already saved.

The punch UI must not await the background gather; the punch completes on step 1.

### userAgent parser (pure, unit-tested)

A dependency-free helper `parseUserAgent(ua: string): { device: string, browser: string }` in a new
`plugins/yg-timesheet-resources/src/utils/user-agent.ts`. Recognizes the common browsers
(Chrome/Edge/Firefox/Safari/Opera/Brave-as-Chrome) and OS/form-factor (Windows/macOS/Linux/Android/
iOS, Desktop vs Mobile) from standard UA substrings; unknown -> a safe generic label (never throws).
Pure, so it is unit-tested in the resources jest suite.

### Geo-IP service

A single client-side `fetch` to a free, HTTPS, CORS-enabled, keyless geo-IP endpoint (pin
`https://ipwho.is/` in the plan; it returns `{ ip, city, region, country }`). Best-effort with an
AbortController timeout (~3s). Swappable - the call is isolated in the capture helper.

**Deploy gotcha:** the prod front may enforce a Content-Security-Policy. The geo-IP host MUST be
allowlisted in the front's `connect-src` or the fetch is blocked in prod (works locally without CSP).
The plan's deploy task verifies this and adds the host if a CSP is present.

## Global location-permission banner

New component `plugins/yg-timesheet-resources/src/components/LocationPermissionBanner.svelte`,
registered as a `presentation.class.ComponentPointExtension` on
`workbench.extensions.WorkbenchExtensions` in `models/yg-timesheet/src/index.ts` - the same global
slot the existing `AttendanceReminder` uses (proven pattern: renders a fixed-position element on
every workbench page).

Behavior:
- On mount, if `window.isSecureContext` is false, render nothing (insecure context can't grant
  geolocation; nagging is pointless).
- Otherwise read `navigator.permissions.query({ name: 'geolocation' })`. If the API is unsupported
  (older Safari), render nothing (graceful degradation).
- If `state !== 'granted'` (i.e. `denied` or `prompt`), render a slim fixed warning strip at the top:
  "Location access is off. Please enable location in your browser settings." Neutral, purpose-free.
- Subscribe to the `PermissionStatus.onchange` event; when state becomes `granted`, hide the banner
  immediately (and re-show if it ever flips back).
- Styling mirrors the existing global banner (AttendanceReminder) so it reads as one system.

This is independent of punch-in and carries no punch-in wording, so it does not disclose the capture
purpose.

## Display (HR + owners)

Show the captured details on the HR attendance surface (`HrAttendance.svelte` /
`AttendanceSessionRow.svelte`), which is already HR/owner-scoped. Per session: device, browser, IP,
`ipCity`, and a "Map" link (`https://maps.google.com/?q=<geoLat>,<geoLng>`) shown only when GPS
coordinates are present. Fields that are unset render as a muted dash. No employee-facing display in
this pass.

## Privacy - Option A (accepted beta debt)

`AttendanceSession` is world-readable (every workspace member can read all sessions), so storing
device/IP/location on it and gating only the UI is NOT a hard boundary - a member could read the raw
fields via the API. This is accepted for beta, the same class of issue as the documented
timesheet-approval gap. It MUST be closed before this data is treated as confidential: the closure is
Option B - capture into an HR-only mirror (like the existing `HrData`/`HrTimeEntry` private-space
projection) so only HR+owners can read it. Recorded here so it is not forgotten.

## Testing

- **Unit (pure):** `parseUserAgent` - table of representative UA strings -> expected device/browser,
  plus the unknown-UA safe-fallback case.
- The capture I/O (`gatherPunchContext`), the banner, and the display are wiring over browser APIs /
  an external fetch; verified manually on beta (device/browser/IP path) and on the HTTPS prod portal
  (the GPS + banner path, which the insecure beta cannot exercise).
- Manual beta checks: punch in, confirm device/browser/IP/city populate on the session within a few
  seconds and render on the HR surface; confirm the punch itself is instant.

## Deploy

MODEL change (new AttendanceSession fields + new global-extension registration), so the full path
from `huly-migration/huly-selfhost`: `./build-beta.sh` -> recreate `transactor account front`
(and `workspace`) -> `./run-tool-beta.sh upgrade-workspace yg` -> front `HTTP 200`. Verify the geo-IP
host against any front CSP. yg_beta only; the GPS + banner path is validated on the HTTPS prod portal
when the batch merges to `yg_develop`.
