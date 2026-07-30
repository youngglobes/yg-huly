# Punch Reminder (in-app) — Design

**Date:** 2026-07-29 · **Branch:** `yg_beta` (LOCAL/beta only) · **Status:** design approved, spec for review

## Goal

Employees forget to punch in (at day start, and after breaks) and sometimes forget to punch out,
which loses or inflates tracked hours. Add an **in-app reminder** that, while the Huly portal tab is
open, detects that the person is **actively working but not correctly punched**, and nudges them with
an **in-app banner + an actionable OS notification**. Reminder only — it **never auto-punches**.

v1 is **in-app only** (no browser extension). The org standardizes on **Chrome**, so the required
web APIs work uniformly across Windows, Ubuntu, and macOS.

## Coverage & the one requirement (explicit)

- **Works** whenever the **portal tab is open** (foreground OR a background tab) while the user works
  in other tabs/apps (e.g. a code editor). This is possible because the **Idle Detection API reports
  whole-machine activity** (keyboard/mouse anywhere, screen lock) — not just Huly-tab focus — and the
  **OS notification surfaces over whatever app is in front**.
- **Does not fire** if the portal tab is **fully closed** (no page = no engine). Mitigation: users
  keep/pin the portal tab (their work portal) or install it as a PWA. Guaranteed coverage when Huly
  is never open is a **later Chrome-extension phase**, out of scope for v1.
- **Cross-OS:** the APIs are Chromium features, so identical behavior on Chrome across Win/Ubuntu/mac.
  Per-OS one-time gotchas (documented for rollout, not code): macOS must allow Chrome in System
  Settings -> Notifications (Focus/DND can mute); Windows Focus Assist can mute; Ubuntu relies on the
  desktop notification daemon (standard GNOME is fine). The **in-app banner is the universal floor**.

## Architecture

Three cooperating parts plus one config doc:

1. **`utils/reminder.ts` — pure state machine (jest-tested).** Given a snapshot it returns an action.
   All rules live here; no browser/Svelte deps.
   ```ts
   type ReminderKind = 'none' | 'punch-in' | 'punch-out'
   interface ReminderConfig {
     enabled: boolean
     windowStartMin: number   // minutes from local midnight, e.g. 540 = 09:00
     windowEndMin: number     // e.g. 1080 = 18:00
     days: number[]           // local weekday numbers allowed, 0=Sun..6=Sat, e.g. [1,2,3,4,5]
     punchInDelayMin: number  // sustained active-without-punch before first punch-in reminder (default 5)
     repeatMin: number        // re-remind interval (default 5)
     punchOutIdleMin: number  // idle-while-punched-in before a punch-out reminder (default 15)
   }
   interface ReminderInput {
     now: number
     dayMidnight: number
     userActive: boolean          // IdleDetector userState === 'active' && screen unlocked
     punchedIn: boolean
     activeUnpunchedSince?: number // when the active+unpunched+in-window streak began (controller-tracked)
     idleSince?: number            // when the user went idle (controller-tracked); undefined while active
     snoozedUntil?: number
     lastRemindedAt?: number
     config: ReminderConfig
   }
   function evaluateReminder (i: ReminderInput): ReminderKind
   ```
   Rules encoded:
   - In-window = `config.enabled` AND local weekday in `config.days` AND `windowStartMin <= minutesSinceMidnight(now) < windowEndMin`.
   - Snooze/repeat gate = `now >= (snoozedUntil ?? 0)` AND (`lastRemindedAt` unset OR `now - lastRemindedAt >= repeatMin`).
   - **punch-in** when: in-window AND `userActive` AND NOT `punchedIn` AND `activeUnpunchedSince` set AND `now - activeUnpunchedSince >= punchInDelayMin` AND the snooze/repeat gate passes.
   - **punch-out** when: `punchedIn` AND ( (`idleSince` set AND `now - idleSince >= punchOutIdleMin`) OR (weekday in `days` AND `minutesSinceMidnight(now) >= windowEndMin`) ) AND the snooze/repeat gate passes. It re-reminds every `repeatMin` until the user punches out (or snoozes). The idle branch is intentionally NOT window-gated: a session left running while idle should be flagged even at night/weekend.
   - Otherwise `none`. `punch-in` and `punch-out` are mutually exclusive - one needs `punchedIn=false`, the other `punchedIn=true` - so at most one fires.

2. **`AttendanceReminder.svelte` — global controller (mounted once at the workbench level so it runs
   on every page, not only My Attendance).** Responsibilities:
   - Owns the `IdleDetector` (whole-machine active/idle + screen lock) and updates `userActive` +
     `idleSince`/`activeUnpunchedSince` on state changes.
   - Live-queries the user's `AttendanceSession` to know `punchedIn` (reuse `findOpenSession`).
   - Runs a ~30s tick (throttled to ~1/min when backgrounded - adequate for a 5-min rule), calls
     `evaluateReminder`, and on a non-`none` result: shows the **in-app banner** and asks the SW to
     show the **OS notification**; stamps `lastRemindedAt`.
   - Reads config (org doc) + per-user state (localStorage: opt-in, `snoozedUntil`, `lastRemindedAt`).
   - The banner + notification offer **Punch in / Punch out** (performs the create/close, reusing the
     existing punch logic) and **Snooze** (sets `snoozedUntil = now + repeatMin`).
   - **Degrades gracefully:** if `IdleDetector` is unavailable/denied, fall back to page-visibility +
     last-input (Huly-tab-focus only) and the always-available banner. (Not expected on all-Chrome, but
     kept so the feature never hard-fails.)

3. **Service Worker (`attendance-reminder-sw.js`, served by front).** Registered on opt-in. Hosts the
   **actionable, persistent OS notification** via `registration.showNotification(...)` with buttons
   **Punch in/out** and **Snooze**, and a `notificationclick` handler that **focuses the portal tab and
   relays the chosen action to the controller** (which performs the punch/snooze). Honest scope: the SW
   does NOT run idle detection or a standalone timer (workers are event-driven and get killed) - the
   engine stays in the page; the SW only makes notifications richer and click-through work.

4. **Org config doc — `AttendanceReminderSettings` (singleton, model).** Holds the `ReminderConfig`
   fields. Edited by admins in the Timesheet **Configuration** area (accessLevel Maintainer). Defaults:
   enabled true, 09:00-18:00, Mon-Fri, punchInDelay 5, repeat 5, punchOutIdle 15. Model change.

## Opt-in & permissions

Reminders are **off until the user opts in** (browsers require a user gesture for both permissions).
On **My Attendance**, a one-time **"Turn on punch reminders"** control:
1. Requests **Notification** permission and **Idle Detection** permission (`IdleDetector.requestPermission()`).
2. Registers the Service Worker.
3. Persists the opt-in (localStorage per user + browser).
If either permission is denied, fall back to banner-only (shown when the portal is focused) and surface
a hint on how to enable it. A "Turn off" control clears the opt-in.

## Data flow (steady state)

```
IdleDetector change / 30s tick (in page)
  -> controller updates userActive, idleSince/activeUnpunchedSince from IdleDetector + punch state
  -> evaluateReminder(snapshot) -> kind
       none        -> nothing
       punch-in /  -> show banner + SW.showNotification(actionable); lastRemindedAt = now
       punch-out
  user action:
     Punch in/out (banner or notification) -> create/close AttendanceSession (existing logic)
     Snooze                                -> snoozedUntil = now + repeatMin
     punch happens                          -> streak resets, reminders stop
```

## Non-goals (v1)

No Chrome extension (phase 2), no desktop-agent, no server-side "active-in-Huly" nudge (not needed on
all-Chrome), no per-employee schedules (one org window), no auto-punch, no reminder history/audit, no
mobile push. Reminders never write attendance except via an explicit user Punch action.

## Testing & delivery

- **`utils/reminder.ts`** fully **jest-tested** with a fixed clock: in/out of window (time + weekday),
  active vs idle, punched vs not, delay-not-met vs met, snooze active, repeat-interval gate, punch-out
  by idle vs by past-window-end, `enabled=false`. All branches.
- Controller + Service Worker + permission flow: **manual browser verification** on the local stack
  (opt-in, banner, OS notification + action buttons, click-to-focus, snooze, punch-in/out from the
  notification, day rollover).
- **Delivery = full 4-image rebuild + `upgrade-workspace`** (the config doc is a model change). The SW
  file, the global workbench mount, and the components ship in the **front** image. Client webpack heap
  `--max-old-space-size=6144`; deploy redpanda-first; restart nginx after recreating front.
- LOCAL/beta only; no `yg_develop` merge. No em-dashes anywhere.
