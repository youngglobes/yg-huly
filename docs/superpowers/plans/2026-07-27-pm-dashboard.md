# PM Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PM/TL dashboard (first menu in the Timesheet app, default landing for approvers/admins) with a greeting + KPI cards, "projects you handle" cards, an in-progress tasks table, pending-approval and overdue queues, and two hand-rolled SVG charts — all scoped to the viewer's projects.

**Architecture:** One special component `Dashboard.svelte` runs live Huly queries, normalizes them to plain shapes, feeds a PURE aggregation lib (`utils/dashboard.ts`, jest-tested), and renders dumb widget children. A new `dashboard` workbench special is registered in the model; the app's `locationResolver` becomes role-aware so approvers/admins land on the dashboard.

**Tech Stack:** Svelte 4, `@hcengineering/presentation` (`createQuery`, `getClient`), tracker/contact/yg-timesheet models, hand-rolled SVG (no chart lib), jest, YG design tokens (`yg-table.scss`).

## Global Constraints

- Branch `yg_beta` only; LOCAL/beta; never merge to `yg_develop`.
- Charts are **hand-rolled SVG — no external chart library** (CSP/bundle rule).
- No em-dashes in UI copy, commit messages, or docs (user reads them as an AI tell); use `-` or `·`.
- Reuse the YG design system (`plugins/yg-timesheet-resources/src/components/yg-table.scss` tokens: `--yg-panel`/`--yg-border`/`--yg-ink`/status colors/`.yg-table`/`.yg-btn`). Black is primary.
- Gate = `ygTimesheet.function.CanApprove` (`visibleIf`) + in-component `canApproveView` render-block (mirror `Reports.svelte`).
- Status category (Huly): `task.statusCategory.{UnStarted, ToDo, Active, Won, Lost}`. In progress = `Active`; Done = `Won`; Open = not Won/Lost.
- Issue link idiom: `getPanelURI(tracker.component.EditIssue, issueId, tracker.class.Issue, 'content')` in an `href="#{...}"`.
- Timesheet approval data lives in the now-public `ygTimesheet.space.Approvals`; TimesheetTask/Day/Timesheet are in `core.space.Workspace`. Resolve chains with FLAT queries (no deep `$lookup`) — see `Reports.svelte`'s approval join for the proven pattern.
- Build: full 4-image rebuild + `upgrade-workspace` (new model special). Client webpack needs `NODE_OPTIONS=--max-old-space-size=6144`. Deploy redpanda-first; restart transactor/stats/nginx; verify Kafka rejoin.

---

## File Structure

**Create:**
- `plugins/yg-timesheet-resources/src/utils/dashboard.ts` — pure aggregation (KPIs, project stats, status buckets, hours-by-project, overdue/due-soon, greeting).
- `plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts` — jest tests for the above.
- `plugins/yg-timesheet-resources/src/components/Dashboard.svelte` — the special: queries + gate + layout, feeds widgets.
- `plugins/yg-timesheet-resources/src/components/dashboard/GreetingCard.svelte`
- `.../dashboard/KpiCards.svelte`
- `.../dashboard/ProjectCards.svelte`
- `.../dashboard/InProgressTable.svelte`
- `.../dashboard/ApprovalsQueue.svelte`
- `.../dashboard/OverdueList.svelte`
- `.../dashboard/Donut.svelte`
- `.../dashboard/HoursBar.svelte`

**Modify:**
- `plugins/yg-timesheet/src/index.ts` — add `component.Dashboard` id + IntlString ids.
- `plugins/yg-timesheet-resources/src/index.ts` — register `Dashboard` component; make `resolveLocation` role-aware.
- `models/yg-timesheet/src/index.ts` — add the `dashboard` special (first, `visibleIf` CanApprove).
- `plugins/yg-timesheet-assets/lang/en.json`, `ru.json` — new strings.

---

## Task 1: Pure aggregation lib `utils/dashboard.ts` + tests

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/dashboard.ts`
- Test: `plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts`

**Interfaces — Produces** (later tasks + Dashboard.svelte consume these):
```ts
export type Cat = 'unstarted' | 'todo' | 'active' | 'won' | 'lost'
export interface DashIssue {
  id: string; identifier: string; title: string; project: string
  cat: Cat; assignee: string | null; priority: number; dueDate: number | null
}
export interface DashTime { issue: string; project: string; employee: string; date: number; hours: number }
export interface DashProject { id: string; name: string }
export interface ProjectStat { project: string; name: string; open: number; inProgress: number; done: number; hours: number; members: number }
export interface Kpis { inProgress: number; hoursThisWeek: number; overdue: number }

export function greetingFor (hour: number): string            // 'Good morning|afternoon|evening'
export function isOpen (c: Cat): boolean                        // not won/lost
export function inProgressIssues (issues: DashIssue[]): DashIssue[]       // cat==='active'
export function overdueIssues (issues: DashIssue[], now: number): DashIssue[]  // dueDate<todayStart(now) && open
export function dueSoonIssues (issues: DashIssue[], now: number, days: number): DashIssue[] // [todayStart, +days) && open
export function statusBuckets (issues: DashIssue[]): Record<Cat, number>
export function hoursByProject (times: DashTime[], projects: DashProject[]): Array<{ project: string; name: string; hours: number }>
export function projectStats (issues: DashIssue[], times: DashTime[], projects: DashProject[]): ProjectStat[]
export function computeKpis (issues: DashIssue[], times: DashTime[], now: number): Kpis // hoursThisWeek = sum(times)
export function todayStart (now: number): number               // local midnight of `now`
```
Notes: `computeKpis.hoursThisWeek` sums whatever `times` it is given (Dashboard.svelte passes the current-week TimeSpendReports), so the week window lives in the query, not the lib. "Pending approval" is a plain count computed in Dashboard.svelte, not here.

- [ ] **Step 1: Write the failing tests**
```ts
import {
  greetingFor, isOpen, inProgressIssues, overdueIssues, dueSoonIssues,
  statusBuckets, hoursByProject, projectStats, computeKpis, todayStart, type DashIssue, type DashTime, type DashProject
} from '../utils/dashboard'

const D = (y: number, m: number, d: number, h = 9): number => new Date(y, m, d, h).getTime()
const iss = (o: Partial<DashIssue>): DashIssue => ({
  id: 'i1', identifier: 'A-1', title: 't', project: 'p1', cat: 'active', assignee: 'e1', priority: 3, dueDate: null, ...o
})

describe('greetingFor', () => {
  it('buckets the hour', () => {
    expect(greetingFor(6)).toBe('Good morning')
    expect(greetingFor(13)).toBe('Good afternoon')
    expect(greetingFor(20)).toBe('Good evening')
  })
})

describe('status helpers', () => {
  const issues = [iss({ cat: 'active' }), iss({ id: 'i2', cat: 'won' }), iss({ id: 'i3', cat: 'todo' }), iss({ id: 'i4', cat: 'lost' })]
  it('isOpen excludes won/lost', () => {
    expect(isOpen('active')).toBe(true); expect(isOpen('todo')).toBe(true)
    expect(isOpen('won')).toBe(false); expect(isOpen('lost')).toBe(false)
  })
  it('inProgressIssues returns only active', () => {
    expect(inProgressIssues(issues).map((i) => i.id)).toEqual(['i1'])
  })
  it('statusBuckets counts each category', () => {
    expect(statusBuckets(issues)).toEqual({ unstarted: 0, todo: 1, active: 1, won: 1, lost: 1 })
  })
})

describe('overdue / due-soon (boundary at local midnight)', () => {
  const now = D(2026, 6, 15, 14) // 15 Jul 2026, 14:00 local
  const issues = [
    iss({ id: 'past', dueDate: D(2026, 6, 14, 23), cat: 'active' }),   // yesterday -> overdue
    iss({ id: 'today', dueDate: D(2026, 6, 15, 8), cat: 'active' }),   // today -> NOT overdue, IS due-soon
    iss({ id: 'soon', dueDate: D(2026, 6, 18, 8), cat: 'todo' }),      // +3d -> due-soon
    iss({ id: 'far', dueDate: D(2026, 6, 30, 8), cat: 'active' }),     // +15d -> neither
    iss({ id: 'donepast', dueDate: D(2026, 6, 1, 8), cat: 'won' })     // past but done -> excluded
  ]
  it('overdue = dueDate before today-midnight and still open', () => {
    expect(overdueIssues(issues, now).map((i) => i.id)).toEqual(['past'])
  })
  it('due-soon = [today-midnight, +7d) and open (incl. today)', () => {
    expect(dueSoonIssues(issues, now, 7).map((i) => i.id).sort()).toEqual(['soon', 'today'])
  })
})

describe('hoursByProject', () => {
  const projects: DashProject[] = [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }]
  const times: DashTime[] = [
    { issue: 'i1', project: 'p1', employee: 'e1', date: D(2026, 6, 14), hours: 2 },
    { issue: 'i2', project: 'p1', employee: 'e2', date: D(2026, 6, 14), hours: 1.5 },
    { issue: 'i3', project: 'p2', employee: 'e1', date: D(2026, 6, 14), hours: 3 }
  ]
  it('sums hours per project, ordered by the projects list', () => {
    expect(hoursByProject(times, projects)).toEqual([
      { project: 'p1', name: 'Alpha', hours: 3.5 },
      { project: 'p2', name: 'Beta', hours: 3 }
    ])
  })
})

describe('projectStats', () => {
  const projects: DashProject[] = [{ id: 'p1', name: 'Alpha' }]
  const issues = [iss({ project: 'p1', cat: 'active' }), iss({ id: 'i2', project: 'p1', cat: 'won' }), iss({ id: 'i3', project: 'p1', cat: 'todo' })]
  const times: DashTime[] = [
    { issue: 'i1', project: 'p1', employee: 'e1', date: D(2026, 6, 14), hours: 2 },
    { issue: 'i3', project: 'p1', employee: 'e2', date: D(2026, 6, 14), hours: 1 }
  ]
  it('rolls up counts, hours and distinct members', () => {
    expect(projectStats(issues, times, projects)).toEqual([
      { project: 'p1', name: 'Alpha', open: 2, inProgress: 1, done: 1, hours: 3, members: 2 }
    ])
  })
})

describe('computeKpis', () => {
  const projects: DashProject[] = [{ id: 'p1', name: 'Alpha' }]
  const now = D(2026, 6, 15, 14)
  const issues = [iss({ cat: 'active' }), iss({ id: 'i2', cat: 'active' }), iss({ id: 'od', cat: 'todo', dueDate: D(2026, 6, 1) })]
  const times: DashTime[] = [{ issue: 'i1', project: 'p1', employee: 'e1', date: D(2026, 6, 14), hours: 4 }]
  it('counts in-progress, overdue, and sums given hours', () => {
    expect(computeKpis(issues, times, now)).toEqual({ inProgress: 2, hoursThisWeek: 4, overdue: 1 })
  })
})
```

- [ ] **Step 2: Run to verify they fail**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources
node ../../common/scripts/install-run-rushx.js test -- dashboard.test
```
Expected: FAIL (module `../utils/dashboard` not found).

- [ ] **Step 3: Implement `utils/dashboard.ts`**
```ts
// Pure aggregation for the PM dashboard. No platform deps -> unit-testable. Dashboard.svelte maps
// live query results to these plain shapes (mapping Huly status.category -> Cat, TimeSpendReport ->
// DashTime, etc.) and feeds them in, so all math is tested in isolation from queries/rendering.
export type Cat = 'unstarted' | 'todo' | 'active' | 'won' | 'lost'

export interface DashIssue {
  id: string; identifier: string; title: string; project: string
  cat: Cat; assignee: string | null; priority: number; dueDate: number | null
}
export interface DashTime { issue: string; project: string; employee: string; date: number; hours: number }
export interface DashProject { id: string; name: string }
export interface ProjectStat { project: string; name: string; open: number; inProgress: number; done: number; hours: number; members: number }
export interface Kpis { inProgress: number; hoursThisWeek: number; overdue: number }

export function greetingFor (hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function isOpen (c: Cat): boolean {
  return c !== 'won' && c !== 'lost'
}

export function inProgressIssues (issues: DashIssue[]): DashIssue[] {
  return issues.filter((i) => i.cat === 'active')
}

export function todayStart (now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function overdueIssues (issues: DashIssue[], now: number): DashIssue[] {
  const start = todayStart(now)
  return issues.filter((i) => isOpen(i.cat) && i.dueDate != null && i.dueDate < start)
}

export function dueSoonIssues (issues: DashIssue[], now: number, days: number): DashIssue[] {
  const start = todayStart(now)
  const end = start + days * 24 * 60 * 60 * 1000
  return issues.filter((i) => isOpen(i.cat) && i.dueDate != null && i.dueDate >= start && i.dueDate < end)
}

export function statusBuckets (issues: DashIssue[]): Record<Cat, number> {
  const b: Record<Cat, number> = { unstarted: 0, todo: 0, active: 0, won: 0, lost: 0 }
  for (const i of issues) b[i.cat]++
  return b
}

export function hoursByProject (times: DashTime[], projects: DashProject[]): Array<{ project: string; name: string; hours: number }> {
  const sum = new Map<string, number>()
  for (const t of times) sum.set(t.project, (sum.get(t.project) ?? 0) + t.hours)
  return projects.map((p) => ({ project: p.id, name: p.name, hours: round2(sum.get(p.id) ?? 0) }))
}

export function projectStats (issues: DashIssue[], times: DashTime[], projects: DashProject[]): ProjectStat[] {
  return projects.map((p) => {
    const pi = issues.filter((i) => i.project === p.id)
    const pt = times.filter((t) => t.project === p.id)
    return {
      project: p.id,
      name: p.name,
      open: pi.filter((i) => isOpen(i.cat)).length,
      inProgress: pi.filter((i) => i.cat === 'active').length,
      done: pi.filter((i) => i.cat === 'won').length,
      hours: round2(pt.reduce((s, t) => s + t.hours, 0)),
      members: new Set(pt.map((t) => t.employee)).size
    }
  })
}

export function computeKpis (issues: DashIssue[], times: DashTime[], now: number): Kpis {
  return {
    inProgress: inProgressIssues(issues).length,
    hoursThisWeek: round2(times.reduce((s, t) => s + t.hours, 0)),
    overdue: overdueIssues(issues, now).length
  }
}

function round2 (n: number): number {
  return Math.round(n * 100) / 100
}
```

- [ ] **Step 4: Run to verify pass**
```bash
node ../../common/scripts/install-run-rushx.js test -- dashboard.test
```
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/utils/dashboard.ts plugins/yg-timesheet-resources/src/__tests__/dashboard.test.ts
git commit -m "yg-timesheet: pure PM-dashboard aggregation lib + tests"
```

---

## Task 2: Model — dashboard special, role-aware resolver, strings

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts` (add `component.Dashboard`; strings)
- Modify: `plugins/yg-timesheet-assets/lang/en.json`, `ru.json`
- Modify: `models/yg-timesheet/src/index.ts` (register the special)
- Modify: `plugins/yg-timesheet-resources/src/index.ts` (role-aware `resolveLocation`; register component)

**Interfaces — Produces:** `ygTimesheet.component.Dashboard` (AnyComponent), strings `Dashboard`, `GoodMorning/GoodAfternoon/GoodEvening` (optional — greeting may be inline English), `MyProjects`, `InProgress`, `PendingApproval`, `HoursThisWeek`, `Overdue`, `ProjectsYouHandle`, `InProgressTasks`, `DueThisWeek`, `IssuesByStatus`, `HoursByProject`, `NothingWaiting`, `NoOverdue`, `Assignee`, `Unassigned`.

- [ ] **Step 1: Add the component id** in `plugins/yg-timesheet/src/index.ts` `component:` block:
```ts
    RejectTaskPopup: '' as AnyComponent,
    NotificationRedirect: '' as AnyComponent,
    Dashboard: '' as AnyComponent
```
And add the IntlString ids to the `string:` block (each `'' as IntlString`): `Dashboard`, `MyProjects`, `InProgress`, `PendingApproval`, `HoursThisWeek`, `Overdue`, `ProjectsYouHandle`, `InProgressTasks`, `DueThisWeek`, `IssuesByStatus`, `HoursByProject`, `NothingWaiting`, `NoOverdue`, `Assignee`, `Unassigned`.

- [ ] **Step 2: Add strings** to `en.json` (and Russian equivalents to `ru.json`, keys in sync):
```json
"Dashboard": "Dashboard",
"MyProjects": "My projects",
"InProgress": "In progress",
"PendingApproval": "Pending your approval",
"HoursThisWeek": "Hours this week",
"Overdue": "Overdue",
"ProjectsYouHandle": "Projects you handle",
"InProgressTasks": "In progress tasks",
"DueThisWeek": "Overdue / due this week",
"IssuesByStatus": "Issues by status",
"HoursByProject": "Hours by project",
"NothingWaiting": "Nothing waiting on you.",
"NoOverdue": "Nothing overdue.",
"Assignee": "Assignee",
"Unassigned": "Unassigned"
```

- [ ] **Step 3: Register the special** in `models/yg-timesheet/src/index.ts`, as the FIRST entry of the Timesheet app `navigatorModel.specials` (before `my`):
```ts
          {
            id: 'dashboard',
            label: ygTimesheet.string.Dashboard,
            icon: tracker.icon.Home,
            component: ygTimesheet.component.Dashboard,
            visibleIf: ygTimesheet.function.CanApprove,
            position: 'top'
          },
```
(Keep the existing `my`/`approvals`/`reports`/`projects` specials after it. `tracker.icon.Home` is already importable via the existing `tracker` model import; if absent, use `ygTimesheet.icon.Timesheet`.)

- [ ] **Step 4: Make `resolveLocation` role-aware** in `plugins/yg-timesheet-resources/src/index.ts`. Replace the body so the app-root default depends on approver/admin status (reuse the existing `CanApprove` machinery already in this file):
```ts
export async function resolveLocation (loc: Location): Promise<ResolvedLocation | undefined> {
  if (loc.path[2] !== ygTimesheetId || loc.path[3] != null) {
    return undefined
  }
  // Approvers/admins land on the dashboard; everyone else on My Timesheet.
  const special = (await CanApprove([])) ? 'dashboard' : 'my'
  const resolved = { ...loc, path: [loc.path[0], loc.path[1], ygTimesheetId, special] }
  return { loc: resolved, defaultLocation: resolved }
}
```
And register the component in the `component:` map of the default export:
```ts
    NotificationRedirect,
    Dashboard
```
with `import Dashboard from './components/Dashboard.svelte'` at the top. (`CanApprove` is already defined in this file and returns `Promise<boolean>`.)

- [ ] **Step 5: Build + typecheck**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-timesheet --to @hcengineering/yg-timesheet-resources
( cd plugins/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:validate )   # regen plugin .d.ts for new ids
```
Expected: build SUCCESS; validate clean for plugins/yg-timesheet. (Dashboard.svelte does not exist yet, so build the model/resources AFTER Task 3, or stub `Dashboard.svelte` first — see note.) NOTE: create a minimal `Dashboard.svelte` stub (`<script lang="ts"></script><div />`) before this step so the import resolves; Task 3 fills it.

- [ ] **Step 6: Commit**
```bash
git add plugins/yg-timesheet/src/index.ts plugins/yg-timesheet-assets/lang/ models/yg-timesheet/src/index.ts plugins/yg-timesheet-resources/src/index.ts plugins/yg-timesheet-resources/src/components/Dashboard.svelte
git commit -m "yg-timesheet: register dashboard special + role-aware default landing"
```

---

## Task 3: Dashboard shell — queries, gate, layout, normalization

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Dashboard.svelte` (replace the stub)

**Interfaces — Consumes:** everything from `utils/dashboard.ts`. **Produces (to widget children):** typed props — `myProjects: DashProject[]`, `issues: DashIssue[]`, `times: DashTime[]`, `stats: ProjectStat[]`, `kpis: Kpis`, `pendingCount: number`, `pendingRows`, `employeeNames: Map<string,string>`, `now: number`.

- [ ] **Step 1: Implement Dashboard.svelte** — role gate (mirror Reports lines 41-54), the queries, normalization to plain shapes, and the row layout that mounts the widgets from Tasks 4-8. Key code:
```svelte
<script lang="ts">
  import contact, { formatName, getCurrentEmployee, type Employee } from '@hcengineering/contact'
  import { AccountRole, getCurrentAccount, hasAccountRole, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import tracker, { type Issue, type IssueStatus, type Project, type TimeSpendReport } from '@hcengineering/tracker'
  import ygTimesheet, { type ProjectApprovers, type TimesheetTask, type TimesheetDay, type Timesheet } from '@hcengineering/yg-timesheet'
  import { canApproveView } from './utils/task-approval'   // NOTE: relative path from components/ is '../utils/task-approval'
  import { weekRange, localDayKey } from '../utils/week'
  import { computeKpis, projectStats, statusBuckets, hoursByProject, inProgressIssues, overdueIssues, dueSoonIssues,
    type Cat, type DashIssue, type DashTime, type DashProject } from '../utils/dashboard'
  import GreetingCard from './dashboard/GreetingCard.svelte'
  import KpiCards from './dashboard/KpiCards.svelte'
  import ProjectCards from './dashboard/ProjectCards.svelte'
  import InProgressTable from './dashboard/InProgressTable.svelte'
  import ApprovalsQueue from './dashboard/ApprovalsQueue.svelte'
  import OverdueList from './dashboard/OverdueList.svelte'
  import Donut from './dashboard/Donut.svelte'
  import HoursBar from './dashboard/HoursBar.svelte'

  const me = getCurrentEmployee()
  const client = getClient()
  const h = client.getHierarchy()
  const isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  // Category ref -> normalized Cat.
  function toCat (categoryRef: Ref<any> | undefined): Cat {
    switch (categoryRef) {
      case task.statusCategory.Active: return 'active'
      case task.statusCategory.Won: return 'won'
      case task.statusCategory.Lost: return 'lost'
      case task.statusCategory.ToDo: return 'todo'
      default: return 'unstarted'
    }
  }

  // --- My projects (pm/teamLead == me, or admin => all) --------------------
  const projectQuery = createQuery()
  let allProjects: Project[] = []
  let canView = false
  projectQuery.query(tracker.class.Project, {}, (res: Project[]) => {
    allProjects = res
    const pairs = res.filter((p) => h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers))
      .map((p) => { const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers; return { pm: a.pm, teamLead: a.teamLead } })
    canView = canApproveView(isAdmin, pairs, me)
  })
  $: myProjectDocs = isAdmin
    ? allProjects
    : allProjects.filter((p) => { if (!h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers)) return false; const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers; return a.pm === me || a.teamLead === me })
  $: myProjectIds = new Set(myProjectDocs.map((p) => p._id))
  $: myProjects = myProjectDocs.map((p): DashProject => ({ id: p._id, name: p.name }))

  // --- Status names/categories --------------------------------------------
  const statusQuery = createQuery()
  let statusCat = new Map<string, Cat>()
  statusQuery.query(tracker.class.IssueStatus, {}, (res: IssueStatus[]) => {
    const m = new Map<string, Cat>(); for (const s of res) m.set(s._id, toCat(s.category)); statusCat = m
  })

  // --- Issues in my projects ----------------------------------------------
  const issueQuery = createQuery()
  let issueDocs: Issue[] = []
  $: issueQuery.query(tracker.class.Issue, { space: { $in: [...myProjectIds] as Ref<Project>[] } }, (res: Issue[]) => { issueDocs = res })
  $: issues = issueDocs.map((i): DashIssue => ({
    id: i._id, identifier: i.identifier, title: i.title, project: i.space,
    cat: statusCat.get(i.status) ?? 'unstarted', assignee: (i.assignee as string) ?? null, priority: i.priority, dueDate: i.dueDate ?? null
  }))

  // --- Time this week in my projects --------------------------------------
  const week = weekRange(Date.now())
  const timeQuery = createQuery()
  let timeDocs: TimeSpendReport[] = []
  $: timeQuery.query(tracker.class.TimeSpendReport, { date: { $gte: week.start, $lt: week.end } }, (res: TimeSpendReport[]) => { timeDocs = res })
  // TimeSpendReport.attachedTo = Issue; map issue -> project via the issue set above.
  $: issueProject = new Map(issueDocs.map((i) => [i._id as string, i.space as string]))
  $: times = timeDocs
    .filter((t) => issueProject.has(t.attachedTo as string))
    .map((t): DashTime => ({ issue: t.attachedTo as string, project: issueProject.get(t.attachedTo as string) as string, employee: (t.employee as string) ?? '', date: t.date ?? 0, hours: t.value }))

  // --- Pending approvals (submitted tasks I can approve) -------------------
  // Flat resolution (no deep $lookup) mirroring Reports.svelte: task -> day -> timesheet -> employee.
  const pendTaskQuery = createQuery(); const pendDayQuery = createQuery(); const pendTsQuery = createQuery()
  let subTasks: TimesheetTask[] = []; let dayTs = new Map<string, string>(); let tsEmp = new Map<string, string>()
  pendTaskQuery.query(ygTimesheet.class.TimesheetTask, { status: 'Submitted' }, (r: TimesheetTask[]) => { subTasks = r })
  pendDayQuery.query(ygTimesheet.class.TimesheetDay, {}, (r: TimesheetDay[]) => { dayTs = new Map(r.map((d) => [d._id as string, d.attachedTo as string])) })
  pendTsQuery.query(ygTimesheet.class.Timesheet, {}, (r: Timesheet[]) => { tsEmp = new Map(r.map((t) => [t._id as string, t.employee as string])) })
  // Any PM/TL/admin can approve any task (per the approval model), so pending = all Submitted tasks
  // whose project is one I handle (scoping), with employee resolved for display.
  $: pendingRows = subTasks
    .filter((t) => myProjectIds.has(t.project as any))
    .map((t) => ({ id: t._id, identifier: t.identifier, title: t.title, project: t.project as string, hours: t.submittedHours, submittedOn: t.submittedOn ?? 0, employee: tsEmp.get(dayTs.get(t.attachedTo as string) ?? '') ?? '' }))
  $: pendingCount = pendingRows.length

  // --- Employee names ------------------------------------------------------
  const empQuery = createQuery()
  let employeeNames = new Map<string, string>()
  empQuery.query(contact.mixin.Employee, {}, (res: Employee[]) => { employeeNames = new Map(res.map((e) => [e._id as string, formatName(e.name)])) })

  // --- Derived (pure lib) --------------------------------------------------
  $: now = Date.now()
  $: kpis = computeKpis(issues, times, now)
  $: stats = projectStats(issues, times, myProjects)
  $: buckets = statusBuckets(issues)
  $: hoursBars = hoursByProject(times, myProjects)
  $: overdue = overdueIssues(issues, now)
  $: dueSoon = dueSoonIssues(issues, now, 7)
  $: inProg = inProgressIssues(issues)
</script>

{#if !canView}
  <div class="yg-empty">Restricted to approvers.</div>
{:else}
  <div class="dash yg-page">
    <div class="yg-scroll">
      <GreetingCard name={employeeNames.get(me) ?? ''} />
      <KpiCards {kpis} {pendingCount} />
      <ProjectCards {stats} />
      <InProgressTable issues={inProg} projects={myProjects} {employeeNames} />
      <div class="dash-two">
        <ApprovalsQueue rows={pendingRows} {employeeNames} projectName={(id) => myProjects.find((p) => p.id === id)?.name ?? id} />
        <OverdueList overdue={overdue} dueSoon={dueSoon} {employeeNames} />
      </div>
      <div class="dash-two">
        <Donut {buckets} />
        <HoursBar bars={hoursBars} />
      </div>
    </div>
  </div>
{/if}

<style lang="scss">
  @use './yg-table' as *;
  .dash-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
  @media (max-width: 900px) { .dash-two { grid-template-columns: 1fr; } }
</style>
```
Correct the `canApproveView` import path to `'../utils/task-approval'`. Verify `Issue` has fields `status` (Ref<IssueStatus>), `assignee`, `priority`, `dueDate`, `identifier`, `title`, `space` — adjust names to the actual tracker types if the build complains.

- [ ] **Step 2: Stub the 8 widget components** so this compiles (each: `<script lang="ts">export let ...</script><div/>`), then svelte-check:
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check
```
Expected: no NEW errors in Dashboard.svelte (pre-existing `$lookup` findings in other files are fine).

- [ ] **Step 3: Commit**
```bash
git add plugins/yg-timesheet-resources/src/components/
git commit -m "yg-timesheet: dashboard shell (queries, gate, normalization, layout)"
```

---

## Task 4: GreetingCard + KpiCards

**Files:** Create `dashboard/GreetingCard.svelte`, `dashboard/KpiCards.svelte`.

**Interfaces — Consumes:** `GreetingCard { name: string }`; `KpiCards { kpis: Kpis; pendingCount: number }`.

- [ ] **Step 1: GreetingCard.svelte** — greeting from the current hour + live clock:
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { greetingFor } from '../../utils/dashboard'
  export let name: string
  let nowD = new Date()
  let timer: any
  onMount(() => { timer = setInterval(() => (nowD = new Date()), 60000) })
  onDestroy(() => clearInterval(timer))
  const dfmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const tfmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
  $: greeting = greetingFor(nowD.getHours())
</script>
<div class="greet yg-section">
  <div class="greet__hi">{greeting}{name ? `, ${name}` : ''}</div>
  <div class="greet__meta">{dfmt.format(nowD)} · {tfmt.format(nowD)}</div>
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .greet { max-width: none; margin-bottom: 16px; }
  .greet__hi { font-size: 22px; font-weight: 680; letter-spacing: -0.01em; color: var(--yg-text); }
  .greet__meta { margin-top: 4px; color: var(--yg-text-dim); font-size: 13px; }
</style>
```

- [ ] **Step 2: KpiCards.svelte** — four cards; Pending links to Approvals:
```svelte
<script lang="ts">
  import { getCurrentLocation, navigate, Label } from '@hcengineering/ui'
  import ygTimesheet, { ygTimesheetId } from '@hcengineering/yg-timesheet'
  import { type Kpis } from '../../utils/dashboard'
  export let kpis: Kpis
  export let pendingCount: number
  function goApprovals (): void { const loc = getCurrentLocation(); loc.path[2] = ygTimesheetId; loc.path[3] = 'approvals'; loc.path.length = 4; navigate(loc) }
</script>
<div class="kpis">
  <div class="kpi"><span class="kpi__k"><Label label={ygTimesheet.string.InProgress} /></span><span class="kpi__v kpi__v--info">{kpis.inProgress}</span></div>
  <button class="kpi kpi--btn" on:click={goApprovals}><span class="kpi__k"><Label label={ygTimesheet.string.PendingApproval} /></span><span class="kpi__v kpi__v--amber">{pendingCount}</span></button>
  <div class="kpi"><span class="kpi__k"><Label label={ygTimesheet.string.HoursThisWeek} /></span><span class="kpi__v">{kpis.hoursThisWeek}</span></div>
  <div class="kpi"><span class="kpi__k"><Label label={ygTimesheet.string.Overdue} /></span><span class="kpi__v kpi__v--red">{kpis.overdue}</span></div>
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  @media (max-width: 900px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
  .kpi { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; text-align: left; }
  .kpi--btn { cursor: pointer; font: inherit; }
  .kpi__k { color: var(--yg-text-dim); font-size: 13px; }
  .kpi__v { font-size: 30px; font-weight: 720; letter-spacing: -0.02em; color: var(--yg-text); }
  .kpi__v--info { color: var(--yg-av3); } .kpi__v--amber { color: var(--yg-amber); } .kpi__v--red { color: var(--yg-red); }
</style>
```

- [ ] **Step 3: svelte-check + commit**
```bash
cd /home/karthi_0008/dev/client-projects/yg-timesheet-resources 2>/dev/null || cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources
node ../../common/scripts/install-run-rushx.js svelte-check
cd /home/karthi_0008/dev/client-projects/yg-huly && git add plugins/yg-timesheet-resources/src/components/dashboard/ && git commit -m "yg-timesheet: dashboard greeting + KPI cards"
```

---

## Task 5: ProjectCards

**Files:** Create `dashboard/ProjectCards.svelte`.
**Interfaces — Consumes:** `ProjectCards { stats: ProjectStat[] }`.

- [ ] **Step 1: Implement** — a titled section with a responsive card grid:
```svelte
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'
  import { type ProjectStat } from '../../utils/dashboard'
  export let stats: ProjectStat[]
</script>
<div class="pc">
  <div class="pc__title"><Label label={ygTimesheet.string.ProjectsYouHandle} /></div>
  <div class="pc__grid">
    {#each stats as s (s.project)}
      <div class="pcard">
        <div class="pcard__name">{s.name}</div>
        <div class="pcard__row"><span>{s.inProgress} in progress</span><span>{s.open} open</span><span>{s.done} done</span></div>
        <div class="pcard__meta">{formatHours(s.hours)} this week · {s.members} {s.members === 1 ? 'member' : 'members'}</div>
      </div>
    {:else}
      <div class="yg-empty">No projects assigned to you.</div>
    {/each}
  </div>
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .pc { margin-top: 16px; }
  .pc__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 10px; }
  .pc__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .pcard { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; }
  .pcard__name { font-weight: 640; color: var(--yg-text); }
  .pcard__row { display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: var(--yg-text-dim); }
  .pcard__meta { margin-top: 6px; font-size: 12px; color: var(--yg-text-faint); }
</style>
```

- [ ] **Step 2: svelte-check + commit**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check
cd /home/karthi_0008/dev/client-projects/yg-huly && git add plugins/yg-timesheet-resources/src/components/dashboard/ProjectCards.svelte && git commit -m "yg-timesheet: dashboard project cards"
```

---

## Task 6: InProgressTable (filter + issue links)

**Files:** Create `dashboard/InProgressTable.svelte`.
**Interfaces — Consumes:** `InProgressTable { issues: DashIssue[]; projects: DashProject[]; employeeNames: Map<string,string> }`.

- [ ] **Step 1: Implement** — project filter + `.yg-table`; each ID links to the issue via `getPanelURI`:
```svelte
<script lang="ts">
  import { getPanelURI, Label, DropdownLabels, type DropdownTextItem } from '@hcengineering/ui'
  import tracker from '@hcengineering/tracker'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { priorityLabel } from '../../utils/reports'
  import { type DashIssue, type DashProject } from '../../utils/dashboard'
  export let issues: DashIssue[]
  export let projects: DashProject[]
  export let employeeNames: Map<string, string>
  let projSel: string | undefined
  $: items = projects.map((p): DropdownTextItem => ({ id: p.id, label: p.name }))
  $: rows = issues.filter((i) => projSel == null || i.project === projSel)
    .sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) || a.identifier.localeCompare(b.identifier, undefined, { numeric: true }))
  const dfmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
</script>
<div class="ipt">
  <div class="ipt__head">
    <span class="ipt__title"><Label label={ygTimesheet.string.InProgressTasks} /></span>
    <DropdownLabels {items} bind:selected={projSel} label={ygTimesheet.string.Project} autoSelect={false} allowDeselect kind="regular" />
  </div>
  <table class="yg-table">
    <thead><tr><th class="left">ID</th><th class="left">Title</th><th class="left"><Label label={ygTimesheet.string.Assignee} /></th><th><Label label={ygTimesheet.string.Priority} /></th><th><Label label={ygTimesheet.string.DueDate} /></th></tr></thead>
    <tbody>
      {#each rows as r (r.id)}
        <tr>
          <td class="left"><a class="yg-idbadge" href="#{getPanelURI(tracker.component.EditIssue, r.id, tracker.class.Issue, 'content')}">{r.identifier}</a></td>
          <td class="left">{r.title}</td>
          <td class="left">{r.assignee != null ? (employeeNames.get(r.assignee) ?? r.assignee) : ''}</td>
          <td>{priorityLabel(r.priority)}</td>
          <td>{r.dueDate != null ? dfmt.format(r.dueDate) : '·'}</td>
        </tr>
      {:else}
        <tr><td colspan={5} class="yg-empty">No in-progress tasks.</td></tr>
      {/each}
    </tbody>
  </table>
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .ipt { margin-top: 16px; background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; }
  .ipt__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .ipt__title { font-size: 13px; font-weight: 680; color: var(--yg-text); }
  a.yg-idbadge { text-decoration: none; }
</style>
```

- [ ] **Step 2: svelte-check + commit**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check
cd /home/karthi_0008/dev/client-projects/yg-huly && git add plugins/yg-timesheet-resources/src/components/dashboard/InProgressTable.svelte && git commit -m "yg-timesheet: dashboard in-progress tasks table"
```

---

## Task 7: ApprovalsQueue + OverdueList

**Files:** Create `dashboard/ApprovalsQueue.svelte`, `dashboard/OverdueList.svelte`.
**Interfaces — Consumes:**
- `ApprovalsQueue { rows: Array<{ id: string; identifier: string; title: string; project: string; hours: number; submittedOn: number; employee: string }>; employeeNames: Map<string,string>; projectName: (id: string) => string }`
- `OverdueList { overdue: DashIssue[]; dueSoon: DashIssue[]; employeeNames: Map<string,string> }`

- [ ] **Step 1: ApprovalsQueue.svelte** — list + "go to Approvals":
```svelte
<script lang="ts">
  import { getCurrentLocation, navigate, Label } from '@hcengineering/ui'
  import ygTimesheet, { ygTimesheetId } from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'
  export let rows: Array<{ id: string; identifier: string; title: string; project: string; hours: number; submittedOn: number; employee: string }>
  export let employeeNames: Map<string, string>
  export let projectName: (id: string) => string
  function goApprovals (): void { const loc = getCurrentLocation(); loc.path[2] = ygTimesheetId; loc.path[3] = 'approvals'; loc.path.length = 4; navigate(loc) }
</script>
<div class="q">
  <div class="q__head"><span class="q__title"><Label label={ygTimesheet.string.PendingApproval} /></span>
    {#if rows.length > 0}<button class="yg-btn yg-btn--ghost" on:click={goApprovals}><Label label={ygTimesheet.string.Approvals} /></button>{/if}</div>
  {#each rows.slice(0, 8) as r (r.id)}
    <button class="qrow" on:click={goApprovals}>
      <span class="qrow__who">{employeeNames.get(r.employee) ?? '-'}</span>
      <span class="qrow__mid">{r.identifier} · {projectName(r.project)}</span>
      <span class="qrow__hrs">{formatHours(r.hours)}</span>
    </button>
  {:else}
    <div class="yg-empty"><Label label={ygTimesheet.string.NothingWaiting} /></div>
  {/each}
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .q { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; }
  .q__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .q__title { font-size: 13px; font-weight: 680; color: var(--yg-text); }
  .qrow { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 6px; border: 0; border-top: 1px solid var(--yg-border); background: transparent; cursor: pointer; font: inherit; text-align: left; }
  .qrow__who { font-weight: 600; color: var(--yg-text); min-width: 120px; }
  .qrow__mid { color: var(--yg-text-dim); font-size: 12px; flex: 1; }
  .qrow__hrs { font-variant-numeric: tabular-nums; color: var(--yg-text); }
</style>
```

- [ ] **Step 2: OverdueList.svelte** — overdue (red) then due-soon, each linking to the issue:
```svelte
<script lang="ts">
  import { getPanelURI, Label } from '@hcengineering/ui'
  import tracker from '@hcengineering/tracker'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { type DashIssue } from '../../utils/dashboard'
  export let overdue: DashIssue[]
  export let dueSoon: DashIssue[]
  export let employeeNames: Map<string, string>
  const dfmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
  function href (id: string): string { return '#' + getPanelURI(tracker.component.EditIssue, id as any, tracker.class.Issue, 'content') }
</script>
<div class="q">
  <div class="q__title"><Label label={ygTimesheet.string.DueThisWeek} /></div>
  {#each [...overdue.map((i) => ({ i, late: true })), ...dueSoon.map((i) => ({ i, late: false }))] as { i, late } (i.id)}
    <a class="orow" class:orow--late={late} href={href(i.id)}>
      <span class="orow__id">{i.identifier}</span>
      <span class="orow__t">{i.title}</span>
      <span class="orow__due">{i.dueDate != null ? dfmt.format(i.dueDate) : ''}</span>
    </a>
  {:else}
    <div class="yg-empty"><Label label={ygTimesheet.string.NoOverdue} /></div>
  {/each}
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .q { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; }
  .q__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; }
  .orow { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-top: 1px solid var(--yg-border); text-decoration: none; color: var(--yg-text); }
  .orow__id { font-family: ui-monospace, monospace; font-size: 12px; color: var(--yg-text-dim); min-width: 64px; }
  .orow__t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .orow__due { font-size: 12px; color: var(--yg-text-dim); }
  .orow--late .orow__due { color: var(--yg-red); font-weight: 600; }
</style>
```

- [ ] **Step 3: svelte-check + commit**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check
cd /home/karthi_0008/dev/client-projects/yg-huly && git add plugins/yg-timesheet-resources/src/components/dashboard/ && git commit -m "yg-timesheet: dashboard approvals + overdue queues"
```

---

## Task 8: SVG charts — Donut + HoursBar

**Files:** Create `dashboard/Donut.svelte`, `dashboard/HoursBar.svelte`.
**Interfaces — Consumes:** `Donut { buckets: Record<Cat, number> }`; `HoursBar { bars: Array<{ project: string; name: string; hours: number }> }`.

- [ ] **Step 1: Donut.svelte** — hand-rolled arcs from category counts:
```svelte
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { type Cat } from '../../utils/dashboard'
  export let buckets: Record<Cat, number>
  const ORDER: Array<{ cat: Cat; label: string; color: string }> = [
    { cat: 'unstarted', label: 'Backlog', color: 'var(--yg-grey)' },
    { cat: 'todo', label: 'Todo', color: 'var(--yg-av3)' },
    { cat: 'active', label: 'In progress', color: 'var(--yg-amber)' },
    { cat: 'won', label: 'Done', color: 'var(--yg-green)' },
    { cat: 'lost', label: 'Cancelled', color: 'var(--yg-red)' }
  ]
  $: total = ORDER.reduce((s, o) => s + buckets[o.cat], 0)
  // Build stroke-dasharray arcs on a circle (r=54, circumference C). Each segment = share*C.
  const R = 54; const C = 2 * Math.PI * R
  $: segs = (() => { let acc = 0; return ORDER.filter((o) => buckets[o.cat] > 0).map((o) => { const frac = total === 0 ? 0 : buckets[o.cat] / total; const seg = { color: o.color, dash: frac * C, offset: -acc * C }; acc += frac; return seg }) })()
</script>
<div class="chart">
  <div class="chart__title"><Label label={ygTimesheet.string.IssuesByStatus} /></div>
  <div class="chart__body">
    <svg viewBox="0 0 140 140" width="140" height="140">
      <g transform="translate(70,70) rotate(-90)">
        <circle r={R} fill="none" stroke="var(--yg-border)" stroke-width="16" />
        {#each segs as s}
          <circle r={R} fill="none" stroke={s.color} stroke-width="16" stroke-dasharray="{s.dash} {C - s.dash}" stroke-dashoffset={s.offset} />
        {/each}
      </g>
      <text x="70" y="70" text-anchor="middle" dominant-baseline="central" class="chart__total">{total}</text>
    </svg>
    <div class="chart__legend">
      {#each ORDER as o}<div class="lg"><span class="lg__dot" style="background:{o.color}" />{o.label}<b>{buckets[o.cat]}</b></div>{/each}
    </div>
  </div>
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .chart { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; }
  .chart__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; }
  .chart__body { display: flex; align-items: center; gap: 18px; }
  .chart__total { font-size: 22px; font-weight: 720; fill: var(--yg-text); }
  .chart__legend { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--yg-text-dim); }
  .lg { display: flex; align-items: center; gap: 7px; } .lg b { color: var(--yg-text); margin-left: 4px; }
  .lg__dot { width: 9px; height: 9px; border-radius: 50%; }
</style>
```

- [ ] **Step 2: HoursBar.svelte** — horizontal bars, width ∝ hours:
```svelte
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'
  export let bars: Array<{ project: string; name: string; hours: number }>
  $: max = Math.max(1, ...bars.map((b) => b.hours))
  $: sorted = [...bars].sort((a, b) => b.hours - a.hours)
</script>
<div class="chart">
  <div class="chart__title"><Label label={ygTimesheet.string.HoursByProject} /></div>
  {#each sorted as b (b.project)}
    <div class="bar">
      <span class="bar__name">{b.name}</span>
      <span class="bar__track"><span class="bar__fill" style="width:{(b.hours / max) * 100}%" /></span>
      <span class="bar__val">{formatHours(b.hours)}</span>
    </div>
  {:else}
    <div class="yg-empty">No hours logged this week.</div>
  {/each}
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .chart { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; }
  .chart__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 10px; }
  .bar { display: grid; grid-template-columns: 120px 1fr 56px; align-items: center; gap: 10px; margin-bottom: 8px; }
  .bar__name { font-size: 12px; color: var(--yg-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar__track { height: 12px; background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 6px; overflow: hidden; }
  .bar__fill { display: block; height: 100%; background: var(--yg-ink); }
  .bar__val { text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--yg-text); }
</style>
```

- [ ] **Step 3: svelte-check + commit**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check
cd /home/karthi_0008/dev/client-projects/yg-huly && git add plugins/yg-timesheet-resources/src/components/dashboard/ && git commit -m "yg-timesheet: dashboard SVG donut + hours bar charts"
```

---

## Task 9: Build, rebuild images, deploy, verify

**Files:** none (build/deploy).

- [ ] **Step 1: Full package build + typecheck + tests**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-timesheet --to @hcengineering/yg-timesheet-resources
( cd plugins/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:validate )
( cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js _phase:validate )
( cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test -- dashboard.test )
( cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check )
```
Expected: build SUCCESS; validate clean (only known pre-existing `migration.ts`/`$lookup` items); dashboard tests PASS; svelte-check no new Dashboard findings.

- [ ] **Step 2: Rebuild all 4 images** (new model special → not front-only). Free RAM first (stop the huly stack + other projects), then run the sequential build with the heap flag (`build-beta.sh`: rush build → dev/prod webpack → front/workspace/transactor/tool images). Verify all four `yg-local/*:beta` timestamps are fresh.

- [ ] **Step 3: Deploy + upgrade** (redpanda-first):
```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
DC="docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml"
$DC up -d redpanda && sleep 8 && docker exec huly_v7-redpanda-1 rpk cluster health | grep Healthy
$DC up -d && sleep 15 && $DC restart transactor stats nginx
./run-tool-beta.sh upgrade-workspace testws | tail -3         # applies the new special into the workspace model
docker logs huly_v7-transactor-1 --tail 40 | grep -i "joined the group"
curl -s -o /dev/null -w "front %{http_code}\n" http://localhost/
```
Restart the other projects (outline/docketpress).

- [ ] **Step 4: Browser verify** — log in as an approver (praja/other): the Timesheet app opens on **Dashboard** (default landing); greeting shows name + time; KPI numbers match; project cards list your projects; the in-progress table filters by project and each ID opens the issue; pending-approval + overdue lists populate and link out; the donut + hours bar render. Log in as a non-approver: app still opens on **My Timesheet** and no Dashboard menu appears.

- [ ] **Step 5: Update the ledger** (`.superpowers/sdd/progress.md`) with the dashboard summary, then final commit if anything is uncommitted.

---

## Self-Review (author)

- **Spec coverage:** greeting+KPIs (T4), project cards (T5), in-progress table w/ filter+links (T6), approvals+overdue queues (T7), 2 SVG charts (T8), gating + own-projects scope + role-aware default landing (T2/T3), pure tested aggregation (T1), delivery (T9). All spec rows covered.
- **Placeholders:** none — every code step has concrete code; commit + test commands are literal.
- **Type consistency:** `DashIssue/DashTime/DashProject/ProjectStat/Kpis/Cat` defined in T1 and consumed unchanged in T3-T8; widget prop names match the Dashboard.svelte mount props in T3.
- **Known verification points (flagged in-task, not placeholders):** exact tracker field names on `Issue` (`status`/`assignee`/`priority`/`dueDate`/`space`) and `task.statusCategory.*` refs are confirmed against the codebase during T3 build; `canApproveView` import path is `../utils/task-approval`.
