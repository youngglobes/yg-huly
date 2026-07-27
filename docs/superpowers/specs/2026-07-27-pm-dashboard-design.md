# PM Dashboard — Design (Phase 1c-2)

**Date:** 2026-07-27 · **Branch:** `yg_beta` (LOCAL/beta only) · **Status:** design approved, spec for review

## Goal

A PM-focused **dashboard to act from**, not a wall of charts. It surfaces what a project
manager checks daily — their projects, in-progress work, timesheets awaiting their approval,
overdue issues — with two supporting SVG charts. Reference: Plane's dashboard (top KPI cards +
widgets), but leaning on the data our portal already owns (issues + status/assignee/priority/due,
logged hours via `TimeSpendReport`, approval state, and PM/TL project assignments).

This is Phase **1c-2** on the roadmap. The dashboard's data + logic are **client-side** (live queries
+ a pure aggregation lib + Svelte widgets). The one non-client piece is registering the new
`dashboard` **menu special**, which is a **model change** (an entry in the Timesheet app's
`navigatorModel.specials`) — so delivery needs the model-bearing images + `upgrade-workspace`, same as
the earlier sidebar/special additions, NOT a front-only rebuild. No server triggers and no data
migration.

## Audience, gating, scoping

- **Who sees it:** approvers (anyone assigned PM or Team Lead on a project via the
  `ygTimesheet.mixin.ProjectApprovers` mixin) **and** admins (Maintainer+). Same gate as
  Approvals/Reports — reuse `ygTimesheet.function.CanApprove` (`visibleIf`) plus the in-component
  `canApproveView` render-block for direct-URL access (mirrors Reports.svelte exactly).
- **Scope of data ("my projects"):** the projects where the current employee is `pm` or
  `teamLead`. **Admins (Maintainer+) see ALL projects.** A single helper resolves `myProjects:
  Ref<Project>[]` from the ProjectApprovers mixins (+ admin = all). Every widget is scoped to that set.
- **Placement:** a new workbench special `dashboard` in the Timesheet app (`models/yg-timesheet`),
  positioned **first** (`position: 'top'`, before `my`), `visibleIf: ygTimesheet.function.CanApprove`.
  **My Timesheet stays the default landing** for everyone (the `locationResolver` still defaults the
  app root to `my`).

## Data sources (all client-side live queries, `createQuery`)

| Source | Used for |
|---|---|
| `tracker.class.Project` + `ygTimesheet.mixin.ProjectApprovers` | resolve "my projects" (pm/teamLead) |
| `tracker.class.Issue` (space ∈ myProjects) | KPI counts, project cards, in-progress table, overdue, status donut |
| `tracker.class.IssueStatus` | status → **category** (Backlog/Unstarted/Started/Completed/Cancelled) + name |
| `tracker.class.TimeSpendReport` (this week, issue in myProjects) | hours KPI, hours-by-project bar, project-card hours, in-progress row hours |
| `ygTimesheet.class.TimesheetTask` (status `Submitted`) | pending-approval count + queue (same resolution as Approvals.svelte) |
| `contact.mixin.Employee` | assignee/employee names + avatars |

**Status semantics (from `IssueStatus.category`):** In progress = `Started`; Completed = `Completed`;
Open = not Completed/Cancelled; **Overdue** = `dueDate < todayStart` AND not Completed/Cancelled;
Due this week = `dueDate` within the next 7 days AND not Completed/Cancelled.

## Layout (top → bottom)

**Row A — Greeting + KPI cards**
- **Greeting card:** "Good {morning/afternoon/evening}, {First name}" + live date and clock (a
  `setInterval` tick each minute; cleared on destroy).
- **4 KPI cards** (number + label, color-coded, scoped to my projects): **In progress** (issue count) ·
  **Pending your approval** (submitted timesheet-task count → links to Approvals) · **Hours this week**
  (sum of TimeSpendReport this week) · **Overdue** (issue count).

**Row B — Projects you're handling**
- One card per my-project: name, open / in-progress / done issue counts, hours this week, team size
  (distinct assignees/loggers). Card links into the project (tracker location).

**Row C — In-progress tasks table**
- Issues whose status category = `Started`, on my projects. **Filter by project** (dropdown, "All" default).
  Each **row links to the issue** via `getPanelURI(tracker.component.EditIssue, id, tracker.class.Issue,
  'content')` (same link idiom My Timesheet uses). Columns: ID · Title · Assignee · Priority · Due ·
  Hours logged (this week). Capped at a sensible top-N (e.g. 50) with a count note if truncated.

**Row D — two action queues (side by side)**
- **Pending your approval:** submitted timesheet tasks awaiting me (employee · project · issue id ·
  hours · submitted date), each linking to Approvals. Empty state: "Nothing waiting on you."
- **Overdue / due this week:** issues past due or due within 7 days on my projects (id · title ·
  assignee · due date, past-due in red), linked to the issue.

**Row E — two SVG charts (supporting, hand-rolled, no external lib)**
- **Issues by status** (donut): counts per status category across my projects, YG status colors, legend
  with counts.
- **Hours by project this week** (horizontal bar): hours per my-project, bar width ∝ hours, labeled.

## Architecture

- **`components/Dashboard.svelte`** — the new special. Owns the live queries + the my-projects/role gate,
  passes derived data to widget children. Render-blocks non-approvers (mirrors Reports).
- **Widget components** under `components/dashboard/`: `GreetingCard.svelte`, `KpiCards.svelte`,
  `ProjectCards.svelte`, `InProgressTable.svelte`, `ApprovalsQueue.svelte`, `OverdueList.svelte`,
  `Donut.svelte`, `HoursBar.svelte`. Each has one clear job and takes already-aggregated props (so they
  are dumb/renderable and independently understandable).
- **`utils/dashboard.ts`** — PURE aggregation (no platform deps), unit-tested with jest (like
  `reports.ts`): compute KPI counts, per-project stats, status-category buckets, hours-by-project,
  overdue/due-soon filters, greeting-for-hour. All query results are mapped to plain shapes and fed in,
  so the math is tested in isolation from Huly queries and rendering.
- **Model (`models/yg-timesheet/src/index.ts`):** add the `dashboard` special (component id
  `ygTimesheet.component.Dashboard`, label `ygTimesheet.string.Dashboard`, icon, `visibleIf`
  `CanApprove`, position top-first). New IntlStrings (Dashboard + widget titles) in the plugin +
  `en.json`/`ru.json`.
- **Styling:** the YG design system (`yg-table.scss` tokens: `--yg-panel`/`--yg-border`/`--yg-*`,
  black-primary, status colors, `.yg-table`, cards, shadows). Matches the portal.

## Non-goals (v1, YAGNI)

No period selector (current-state widgets + fixed "this week" for hours); no drag/edit "customize"
mode; no activity feed; no per-person utilization chart; no hours-trend line; no server-side
aggregation (all client live queries — fine at our scale). All are easy follow-ons once v1 ships.

## Testing & delivery

- Jest unit tests for `utils/dashboard.ts` (bucketing, KPIs, overdue boundary at midnight, greeting).
- svelte-check + tsc clean on the resources package.
- **Delivery = the full 4-image rebuild + `upgrade-workspace`** (front for the component + strings;
  workspace/transactor/tool for the new model special) — the proven path for adding a menu special,
  same as the sidebar/portal changes. Heavy client webpack needs `NODE_OPTIONS=--max-old-space-size=6144`.
- LOCAL/beta only; no `yg_develop` merge without explicit user OK.
