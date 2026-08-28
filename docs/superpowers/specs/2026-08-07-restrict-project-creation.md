# Restrict project creation (#12) + Owners auto-member (#14) - design/spec

**Date:** 2026-08-07  **Branch:** yg_beta  **Status:** approved, ready to implement

## #12 - Restrict who can create projects (client-side hide)

**Rule (user-approved):** a user may create a project iff ANY of:
- workspace role >= `AccountRole.Owner` (`getCurrentAccount().role`), OR
- HR member: they are a member of `ygTimesheet.space.HrData`, OR
- PM: they are `pm` OR `teamLead` on ANY project's `ygTimesheet.mixin.ProjectApprovers` (reuse the
  `canApproveView` / approver-detection idiom in `utils/task-approval.ts`), OR
- their `WorkProfile.designation` is in the leadership set:
  `{ 'Project Manager', 'Team Leader', 'HR Executive', 'CEO', 'CTO', 'COO' }`.

Enforcement is **client-side hide only** (user's explicit choice - a determined API caller can still
create; not our concern here).

**Cross-plugin mechanism (avoid circular deps):** the "+" create-project buttons live in core
`tracker-resources` (`NewIssueHeader.svelte`) and `workbench-resources` (`navigator/SpacesNav.svelte`),
which must NOT import `yg-timesheet-resources`. So:
1. Add a plugin function id in `plugins/yg-timesheet/src/index.ts` under the existing `function: {}`
   block (next to `CanApprove`): `CanCreateProject: '' as Resource<() => Promise<boolean>>`.
2. Implement it in `yg-timesheet-resources` and register it where the other function resources are
   registered (find the `index.ts` that does `getResource`-style registration - the same place
   `CanApprove` / `TimesheetDayTitle` impls are wired). The impl uses `getClient()`/`getCurrentAccount()`
   and does the 4 checks above (queries: ProjectApprovers mixin over projects; HrData space membership;
   own WorkProfile mixin designation).
3. In `NewIssueHeader.svelte`: resolve the function via `getResource(ygTimesheet.function.CanCreateProject)`
   once, compute a `canCreateProject` boolean reactively, and REMOVE `tracker.string.CreateProject` from
   the `visibleActions` array when false (it currently always includes CreateProject). Import only the
   `yg-timesheet` PLUGIN for the function id (non-circular: yg-timesheet plugin does not depend on
   tracker-resources).
4. In `SpacesNav.svelte`: it renders an add-space "+" for any model with `addSpaceLabel`+`createComponent`
   (line ~108). Gate the tracker Project create specifically: when the space model is the tracker
   Projects app and `canCreateProject` is false, do not push that add action. (If distinguishing the
   tracker app is awkward, gating just the header `NewIssueHeader` "+" plus the tracker projects-nav add
   is acceptable; do NOT globally hide add-space for non-tracker apps like HR/Timesheet.)

Guard against the async resolve: default `canCreateProject = false` until the promise resolves so the
button does not flash for a non-permitted user (or default true and hide on resolve - pick the
less-flickery option and note it).

## #14 - New projects: all Owners are members by default

Intent: workspace Owners are members of every project so they can see/act on private ones.

**Hurdle (confirmed):** there is no easy "list all Owner-role accounts" query on the client OR server
(server has no role query; client only exposes `getCurrentAccount().role`). BEFORE implementing:
INVESTIGATE whether a client store/api exposes workspace members WITH their roles (look in
`login-resources`/`contact-resources`/presentation for a members-with-roles source, or an accounts API).
- If such a source exists: in `plugins/tracker-resources/src/components/projects/CreateProject.svelte`,
  default `members` (and keep `owners`) to include every Owner-role account uuid (union with the current
  user). Only affects NEW projects (`project === undefined`); do not change edits of existing projects.
- If NO such source exists: STOP and report - do NOT hardcode or guess. #14 then needs a separate
  design (e.g. a server-side approach or accepting that Owners already have admin space access). #12
  is independent and should still ship.

## Verify
- Rebuild the yg-timesheet plugin, then validate tracker-resources, workbench-resources,
  yg-timesheet-resources (no NEW errors; known pre-existing week.test.ts:116 aside).
- Jest stays green.
- This is a model change (new plugin function id + resource registration) -> full 4-image build +
  `upgrade-workspace yg` at deploy.

## Out of scope
Server-side enforcement of #12 (client hide only). Any project-visibility default (that is #13, done).
