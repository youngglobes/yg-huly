# App route-level access gate (HR module + AI Usage) - Part 1

- **Date:** 2026-09-04
- **Status:** Approved design, ready for implementation
- **Owner:** YG platform (yg-huly fork), branch `yg_beta`
- **Severity:** access-control / security

## 1. Problem

Hiding an app from the Huly nav (`HiddenApplication` / `app.hidden`) is **nav-only**; it does NOT gate
the app's routes. The route resolver (`Workbench.svelte` `syncLoc`) only checks `accessLevel`, a role
threshold that cannot express "is an HR-team (`ygTimesheet.space.HrData`) member" or "is on the AI-usage
allowlist". Consequences on beta:

- A non-HR USER can open the whole HR module by URL (`/workbench/yg/yg-hr/employees`, ...) even though
  its icon is hidden from their nav.
- The AI Usage app icon is visible to every USER (`hidden:false` + `accessLevel:User`), with no per-user
  hide (its data is already protected by the sidecar's 401, but the icon leaks).

## 2. Scope

**Part 1 (this spec): UI route gate + icon.** A non-authorized user hitting a gated app's URL gets a
**403 "Access Denied"** page (not a blank pane, not a redirect), and the AI Usage icon is hidden from
users not on the allowlist.

**Part 2 (separate, later spec): server-side data gate.** The HR profile fields are mixins on the
public Person doc, so a non-HR member can still read them via the API regardless of the UI. Closing
that (with self-service preserved: readable by HR OR the employee themselves) needs a transactor read
guard/middleware. Out of scope here; tracked as the follow-up.

## 3. Design

### 3.1 Route gate (the one shared-core change, kept minimal)

- **`plugins/workbench/src/types.ts`**: add one optional field to `workbench.class.Application`:
  ```ts
  accessCheck?: Resource<() => Promise<boolean>>
  ```
  (Application-level, not per-special, so one predicate gates the bare app URL AND every page under it.)
- **`plugins/workbench-resources/src/components/Workbench.svelte`** (`syncLoc`, the app-resolution block
  around the existing `accessLevel` check where `currentApplication` is set): after the app is found and
  passes `accessLevel`, if `newApplication.accessCheck` is defined, resolve and run it:
  - **fail** => do NOT set `currentApplication` / `navigatorModel` (leave them cleared) and
    `accessDeniedStore.set(true)` => the existing `{:else if $accessDeniedStore}` "Access denied" branch
    renders (this is the 403 UI).
  - **pass** => `accessDeniedStore.set(false)` and proceed as today.
  - Also set `accessDeniedStore.set(false)` on any normal successful app resolution so the denied state
    never sticks across navigations.
  - Apps with no `accessCheck` are completely unaffected (no behavior change, no regression).
- Because a failed check leaves `currentApplication` unset, no special resolves either, so the bare
  `/yg-hr` URL and every `/yg-hr/<special>` URL all land on the 403 view from this single check.

### 3.2 HR app wiring

- Predicate `checkHrAppAccess` (a `login`/plugin function resource in `plugins/yg-timesheet-resources`):
  returns `true` iff the current account is Owner/Maintainer/Admin OR a member of `ygTimesheet.space.HrData`
  - the exact rule already used as the edit gate in `EmployeeDirectory.svelte:79-84`, `EmployeeProfile`,
  `HrLists`. Registered under a plugin function id.
- Set `accessCheck: <that id>` on the HR app doc (`models/yg-timesheet/src/index.ts`, the
  `ygTimesheet.app.HumanResource` `builder.createDoc`). The HR app's existing per-user icon `HiddenApplication`
  reconcile is left as-is (still hides the icon; the new check adds the route 403).

### 3.3 AI Usage app wiring + icon

- Predicate `checkAiUsageAccess` (function resource in `plugins/yg-timesheet-resources`): returns `true`
  iff the account is Owner/Maintainer/Admin OR the usage-sidecar says the account may view (a light call
  through the existing `usageGet` client, e.g. `GET /config` -> `me` view flag, or `GET /report` -> 200 vs
  401). Cache the result briefly to avoid a call per navigation.
- Set `accessCheck: <that id>` on the AI Usage app doc (`ygTimesheet.app.AiUsage`) => route 403 for
  non-allowlisted.
- **Icon hide:** a small self-contained global component (registered at
  `workbench.extensions.WorkbenchExtensions`, same slot as `SelfActivate`, renders nothing) that, on load,
  runs `checkAiUsageAccess` for the current user and toggles THAT user's own `workbench.class.HiddenApplication`
  for `ygTimesheet.app.AiUsage` (create when not allowed, remove when allowed). The nav switcher already
  respects `HiddenApplication`, so this hides the icon without touching the shared switcher components.
  (The route 403 remains the real gate even if a user un-hides the icon manually.)

## 4. Deploy

Model change (the `accessCheck` field + wiring onto the app docs, which live in `core.space.Model`) plus
front (Workbench.svelte, predicates, the AI Usage icon component). => **full build + `upgrade-workspace`**,
beta first.

## 5. Testing (beta)

1. As a non-HR USER (e.g. Mukesh): opening `/workbench/yg/yg-hr/employees` (and the bare `/yg-hr`, and other
   specials) shows **403 Access Denied**, not the module.
2. As an HR member / admin: the HR module opens normally.
3. As a non-allowlisted USER: the AI Usage icon is gone from the nav; opening its URL shows 403.
4. As an admin or an allowlisted Team Leader: the AI Usage icon is present and the app opens.
5. Regression: every other app (Tracker, Timesheet, etc., which have no `accessCheck`) behaves exactly as
   before; default-landing still works.

## 6. Out of scope / follow-up

- **Part 2:** server-side read gating of the HR profile mixins (HR-or-self), so the data is not readable
  via the API by non-HR members. Needs a transactor read guard - its own spec.
- The AI Usage allowlist remaining sidecar-only (a Huly-side mirror is not required for this gate).
