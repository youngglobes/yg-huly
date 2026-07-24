# Timesheet App — Sidebar UX Restructure (Design)

**Date:** 2026-07-24
**Branch:** `yg_beta` (local/demo; **never** merged to `yg_develop`, which CI auto-deploys to prod)
**Status:** design — approved decisions below, pending spec review → writing-plans

## Goal

Restructure the custom **Timesheet** workbench app (`ygTimesheet.app.Timesheet`) from a single
tabbed component into a **left-sidebar app** that mirrors the existing custom **Human Resource**
app (`ygTimesheet.app.HumanResource`, which already uses `navigatorModel.specials[]`). Gate the
Approvals/Reports menu items to admins and approvers, relocate PM/TL assignment to a sidebar item,
and standardize the tables on the existing HR table styling.

This is a **UX/structure** change only — no change to the approval authorization model, the server
triggers, the migration, or the data schema. A later phase will do a modern visual restyle of each
module; this phase only reuses the styles that already exist.

## Approved decisions (from brainstorming, 2026-07-24)

1. **App structure:** keep the two apps separate. Convert the **Timesheet** app's tabs into a
   left-sidebar (`navigatorModel`); the Human Resource app is unchanged.
2. **Admin threshold:** `AccountRole.Maintainer+` (matches the server-side approval guard and every
   existing gate; Owners are included since Owner > Maintainer).
3. **Table scope:** apply the shared HR table styling to **Reports**, **Approvals** (restructured
   from a card-list into a table), and **My Timesheet** (the weekly view).
4. **PM/TL in the native Huly project dialog:** **NOT done** — verified infeasible without patching
   vendored code (`tracker-resources`' `CreateProject.svelte` has no injection slot, and
   `tracker.class.Project` has no `view.mixin.ObjectEditor`/`ObjectEditorFooter` registered). PM/TL
   assignment stays in our own UI, relocated to the "Projects" sidebar item.

## Part 1 — Tabs → left-sidebar navigator

Replace the Timesheet app's `component: ygTimesheet.component.TimesheetApp` registration
(`models/yg-timesheet/src/index.ts:142-154`) with a `navigatorModel` whose `specials[]` mirror the
`yg-hr` app (`models/yg-timesheet/src/index.ts:176-216`). One special per former tab:

| id | label | component | position | gate |
|---|---|---|---|---|
| `my` | `ygTimesheet.string.Timesheet` | `ygTimesheet.component.Timesheet` | top | none (everyone) |
| `approvals` | `ygTimesheet.string.Approvals` | `ygTimesheet.component.Approvals` | top | `visibleIf: CanApprove` |
| `reports` | `ygTimesheet.string.Reports` | `ygTimesheet.component.Reports` | top | `visibleIf: CanApprove` |
| `projects` | `ygTimesheet.string.Projects` | `ygTimesheet.component.ProjectApproversEditor` | bottom | `accessLevel: AccountRole.Maintainer` |

- Each of `Timesheet`, `Approvals`, `Reports`, `ProjectApproversList` (registered as
  `ProjectApproversEditor`) is already a self-contained component that queries its own data, so it
  renders directly as a special — no wrapper needed.
- **`TimesheetApp.svelte` is retired:** remove it from the resources `component` registration and
  from the app definition (the file may be deleted; keep only if nothing else references it —
  confirmed nothing does).
- Icons: reuse existing assets (`ygTimesheet.icon.Timesheet` for `my`; pick sensible existing
  `view.icon.*`/`contact.icon.*`/`hr.icon.*` assets for the others — finalized in the plan). This is
  cosmetic and not load-bearing.
- Sidebar routing uses `path[3]` = special id (`workbench-resources`); no component relies on the
  old tab-selection state, so no in-component routing changes are expected. Any component that reads
  a selected-tab prop from `TimesheetApp` must be checked and de-coupled during implementation.

## Part 2 — Gating

- **`projects`** → `accessLevel: AccountRole.Maintainer` (built-in single-role gate; clean).
- **`approvals` / `reports`** → `visibleIf: ygTimesheet.function.CanApprove`, a **new registered
  async resource predicate**:
  ```ts
  // returns true if the current user may see Approvals/Reports:
  //   admin (Maintainer+)  OR  assigned as PM/TeamLead on ≥1 project (data-driven)
  export async function canApprove (): Promise<boolean> {
    if (hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)) return true
    const me = getCurrentEmployee()
    const projects = await getClient().findAll(tracker.class.Project, {})
    const h = getClient().getHierarchy()
    return projects.some((p) =>
      h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers) &&
      (() => { const a = h.as(p, ygTimesheet.mixin.ProjectApprovers); return a.pm === me || a.teamLead === me })())
  }
  ```
  This is the same `isHRAdmin || isApprover` logic `TimesheetApp.svelte:28-43` computes today, moved
  into a registered function. `SpecialNavModel.visibleIf` is `Resource<(spaces: Space[]) =>
  Promise<boolean>>` and is awaited by `Navigator.svelte:125-126`, so an async client query is
  supported (mirrors `tracker.function.IsProjectJoined`). Declare the id
  `ygTimesheet.function.CanApprove` in `plugins/yg-timesheet/src/index.ts` and register the
  implementation in `plugins/yg-timesheet-resources/src/index.ts`.
- The components keep their existing in-component gates as defence-in-depth (e.g. `Approvals.svelte`
  already self-gates), so a hidden menu item is not the only protection. Server-side enforcement is
  unchanged and remains the real security boundary.

## Part 3 — PM/TL assignment relocated

`ProjectApproversList.svelte` / `ProjectApprovers.svelte` are unchanged in behavior; they simply
become the `projects` sidebar special instead of the `projects` tab. Same `EmployeeBox` PM/TeamLead
pickers writing the `ygTimesheet.mixin.ProjectApprovers` mixin, same Maintainer gate.

## Part 4 — Shared HR table style

Two equivalent table styles exist today, local to their components:
- `HrOverview.svelte:220-283` — `.hrTable` (sticky header, row hover, `.amber`/`.green`/`.ok`/`.warn`
  tokens, totals).
- `HrTimesheet.svelte:242-283` — `.hrt-table` + status pills `.hrt-pill--{submitted,approved,rejected,partiallyapproved}`.

Extract a **single shared table style** into one place (a shared SCSS partial imported by the
components, or a small reusable wrapper — mechanism finalized in the plan) under a neutral namespace
(e.g. `yg-table` / `yg-pill`, not `hr*`), consolidating the duplicated `.amber`/`.green` tokens and
the status-pill classes. Then apply it to:
- **Reports.svelte** — swap its local `.rp-*` table classes for the shared classes.
- **Approvals.svelte** — restructure the current card-list (`.ap-*`) into a table: columns
  **employee / date / identifier / title / submitted hours / actions** (Approve · Reject), using the
  shared table classes; keep the existing `showPopup` Approve/Reject wiring.
- **Timesheet.svelte** (My Timesheet) — adopt the shared table visual language (header, row hover,
  status-pill classes, cell tokens) for the weekly view, preserving its day-row semantics, submit/
  recall actions, per-task status/rejectReason, and the "never show approved hours" rule.
- The HR components (`HrOverview`/`HrTimesheet`) should also switch to the shared classes so there is
  one source of truth (removing their now-duplicated local copies).

## Out of scope

- PM/TL inside Huly's native project dialog (infeasible without vendoring; see decision 4).
- Any change to authorization, triggers, migration, or the `TimesheetApproval` schema.
- The modern visual restyle of each module (explicitly a **later phase**).
- The deferred approval server-materialization security fix (tracked separately).

## Constraints

- Commits on `yg_beta`; **never** merge to `yg_develop`.
- `svelte-check` is mandatory on any `.svelte` change; known pre-existing baseline (3 `$lookup` +
  ~21 in `text-editor-resources`) is not ours. No NEW non-`$lookup` errors on touched files.
- The unit suite (currently 109) must not regress. This change is UI/model wiring; no unit-testable
  logic is added beyond the `canApprove` predicate (which can get a focused test if extracted as a
  pure helper taking `(isAdmin, projects, me)`).
- Model change (Application `navigatorModel`) requires an `upgrade-workspace` to take effect;
  existing users' stored location may point at the old tab id — verify the app still opens cleanly
  (falls back to the first special) after upgrade.

## Testing

- Build + `svelte-check` on every touched `.svelte`; classify any `$lookup` noise.
- Optional focused unit test for the extracted `canApprove(isAdmin, projects, me)` pure helper.
- Manual/e2e (local beta stack, deferred to the user): the Timesheet app shows a left sidebar; a
  plain employee sees only **My Timesheet**; a PM/TL sees **My Timesheet + Approvals + Reports**; an
  admin also sees **Projects**; all three tables render in the shared HR style; PM/TL assignment
  works from the Projects item.
