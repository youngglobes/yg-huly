<!--
// Copyright © 2026 YoungGlobes
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<!--
  PM dashboard: role-gated overview of the projects a PM/Team Lead (or admin) handles, covering
  KPIs, per-project stats, in-progress work, pending approvals, overdue/due-soon issues, and two
  charts. All queries live here; normalization to plain shapes is delegated to utils/dashboard.ts
  (pure, unit-tested) so the widgets below only ever receive plain data, never live Huly docs.
-->
<script lang="ts">
  import contact, { formatName, getCurrentEmployee, type Employee } from '@hcengineering/contact'
  import { AccountRole, getCurrentAccount, hasAccountRole, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import tracker, { type Issue, type IssueStatus, type Project, type TimeSpendReport } from '@hcengineering/tracker'
  import ygTimesheet, { type ProjectApprovers, type TimesheetTask, type TimesheetDay, type Timesheet } from '@hcengineering/yg-timesheet'
  import { canApproveView } from '../utils/task-approval'
  import { ensureHrMembership } from '../utils/hrMembership'
  import { type DropdownTextItem } from '@hcengineering/ui'
  import { periodRange } from '../utils/week'
  import {
    projectStats, portfolioHours, overdueIssues, dueSoonIssues,
    teamWorkload, priorityWatch, openStatusNames, openStatusTotals, isOpen, type Cat, type DashIssue, type DashTime, type DashProject
  } from '../utils/dashboard'
  // Palette for the "Issues by status" chart segments (real status names are dynamic). Mid-tone
  // hues that read on both light and dark themes; cycled if there are more statuses than colors.
  const STATUS_COLORS = ['#6366f1', '#f59e0b', '#0ea5e9', '#8b5cf6', '#14b8a6', '#ec4899', '#f43f5e', '#84cc16']
  import GreetingCard from './dashboard/GreetingCard.svelte'
  import KpiStrip, { type Kpi } from './dashboard/KpiStrip.svelte'
  import ProjectCards from './dashboard/ProjectCards.svelte'
  import InProgressTable from './dashboard/InProgressTable.svelte'
  import ApprovalsQueue from './dashboard/ApprovalsQueue.svelte'
  import OverdueList from './dashboard/OverdueList.svelte'
  import InboxWidget from './dashboard/InboxWidget.svelte'
  import PriorityWatch from './dashboard/PriorityWatch.svelte'
  import TeamWorkload from './dashboard/TeamWorkload.svelte'
  import Donut from './dashboard/Donut.svelte'

  // Owner bootstrap: the HR app is hidden from non-roster accounts and the roster editor lives INSIDE
  // that hidden app, so a fresh Owner could never reach it (chicken-and-egg - first member had to be
  // seeded by DB). Owners are admins and land here on the always-visible Timesheet app, so self-add
  // them to HrData now; the OnHrMembershipChange trigger then un-hides HR for them. No-op for non-owners.
  void ensureHrMembership()

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
  // isApprover is derived from the query; isAdmin is synchronous. Gating on isAdmin alone (not
  // waiting on isApprover) gives admins a fast path so they never sit behind "Restricted to
  // approvers." while the query is still in flight - mirrors Reports.svelte's isHRAdmin/isApprover
  // split exactly.
  let isApprover = false
  projectQuery.query(tracker.class.Project, {}, (res: Project[]) => {
    allProjects = res
    const pairs = res
      .filter((p) => h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers))
      .map((p) => { const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers; return { pm: a.pm, teamLead: a.teamLead } })
    isApprover = canApproveView(false, pairs, me)
  })
  $: canView = isAdmin || isApprover
  $: myProjectDocs = isAdmin
    ? allProjects
    : allProjects.filter((p) => {
      if (!h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers)) return false
      const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers
      return a.pm === me || a.teamLead === me
    })
  $: myProjectIds = new Set(myProjectDocs.map((p) => p._id))
  $: myProjects = myProjectDocs.map((p): DashProject => ({ id: p._id, name: p.name }))

  // --- Status names/categories --------------------------------------------
  const statusQuery = createQuery()
  let statusCat = new Map<string, Cat>()
  let statusName = new Map<string, string>()
  statusQuery.query(tracker.class.IssueStatus, {}, (res: IssueStatus[]) => {
    const m = new Map<string, Cat>()
    const nm = new Map<string, string>()
    for (const s of res) { m.set(s._id, toCat(s.category)); nm.set(s._id, s.name) }
    statusCat = m
    statusName = nm
  })

  // --- Issues in my projects ----------------------------------------------
  const issueQuery = createQuery()
  let issueDocs: Issue[] = []
  $: issueQuery.query(tracker.class.Issue, { space: { $in: [...myProjectIds] as Ref<Project>[] } }, (res: Issue[]) => { issueDocs = res })
  $: issues = issueDocs.map((i): DashIssue => ({
    id: i._id,
    identifier: i.identifier,
    title: i.title,
    project: i.space,
    cat: statusCat.get(i.status) ?? 'unstarted',
    status: statusName.get(i.status) ?? '—',
    assignee: (i.assignee as string) ?? null,
    priority: i.priority,
    dueDate: i.dueDate ?? null,
    estimation: i.estimation ?? 0,
    reportedTime: i.reportedTime ?? 0
  }))

  // --- Logged time in the selected period (Projects-you-handle filter, owned here + bound in) ---
  const presetItems: DropdownTextItem[] = [
    { id: 'thisWeek', label: 'This week' },
    { id: 'lastWeek', label: 'Last week' },
    { id: 'thisMonth', label: 'This month' },
    { id: 'custom', label: 'Custom' }
  ]
  let preset = 'thisWeek'
  let fromStr = ''
  let toStr = ''
  $: range = periodRange(preset, fromStr, toStr, Date.now())
  const timeQuery = createQuery()
  let timeDocs: TimeSpendReport[] = []
  $: timeQuery.query(tracker.class.TimeSpendReport, { date: { $gte: range.start, $lt: range.end } }, (res: TimeSpendReport[]) => { timeDocs = res })
  // TimeSpendReport.attachedTo = Issue; map issue -> project via the issue set above.
  $: issueProject = new Map(issueDocs.map((i) => [i._id as string, i.space as string]))
  $: times = timeDocs
    .filter((t) => issueProject.has(t.attachedTo as string))
    .map((t): DashTime => ({
      issue: t.attachedTo as string,
      project: issueProject.get(t.attachedTo as string) as string,
      employee: (t.employee as string) ?? '',
      date: t.date ?? 0,
      hours: t.value
    }))

  // --- Pending approvals (submitted tasks I can approve) -------------------
  // Flat resolution (no deep $lookup) mirroring Reports.svelte: task -> day -> timesheet -> employee.
  const pendTaskQuery = createQuery()
  const pendDayQuery = createQuery()
  const pendTsQuery = createQuery()
  let subTasks: TimesheetTask[] = []
  let dayTs = new Map<string, string>()
  let tsEmp = new Map<string, string>()
  pendTaskQuery.query(ygTimesheet.class.TimesheetTask, { status: 'Submitted' }, (r: TimesheetTask[]) => { subTasks = r })
  pendDayQuery.query(ygTimesheet.class.TimesheetDay, {}, (r: TimesheetDay[]) => { dayTs = new Map(r.map((d) => [d._id as string, d.attachedTo as string])) })
  pendTsQuery.query(ygTimesheet.class.Timesheet, {}, (r: Timesheet[]) => { tsEmp = new Map(r.map((t) => [t._id as string, t.employee as string])) })
  // Any PM/TL/admin can approve any task (per the approval model), so pending = all Submitted tasks
  // whose project is one I handle (scoping), with employee resolved for display.
  $: pendingRows = subTasks
    .filter((t) => myProjectIds.has(t.project))
    .map((t) => ({
      id: t._id,
      identifier: t.identifier,
      title: t.title,
      project: t.project as string,
      hours: t.submittedHours,
      submittedOn: t.submittedOn ?? 0,
      employee: tsEmp.get(dayTs.get(t.attachedTo as string) ?? '') ?? ''
    }))

  // --- Employee names ------------------------------------------------------
  const empQuery = createQuery()
  let employeeNames = new Map<string, string>()
  empQuery.query(contact.mixin.Employee, {}, (res: Employee[]) => { employeeNames = new Map(res.map((e) => [e._id as string, formatName(e.name)])) })

  // --- Derived (pure lib) --------------------------------------------------
  $: now = Date.now()
  $: stats = projectStats(issues, times, myProjects)
  $: portfolio = portfolioHours(stats)
  $: statusColumns = openStatusNames(issues)
  $: statusSegments = openStatusTotals(issues).map((s, idx) => ({ ...s, color: STATUS_COLORS[idx % STATUS_COLORS.length] }))
  $: overdue = overdueIssues(issues, now)
  $: dueSoon = dueSoonIssues(issues, now, 7)
  // In-progress table shows ONLY the literal "In Progress" status (not every active-category status
  // such as In Testing / In Review, which the coarse category would lump together).
  $: inProg = issues.filter((i) => i.status.trim().toLowerCase() === 'in progress')
  $: team = teamWorkload(issues, times)
  $: priority = priorityWatch(issues)
  $: hoursByIssue = (() => {
    const m = new Map<string, number>()
    for (const t of times) m.set(t.issue, Math.round(((m.get(t.issue) ?? 0) + t.hours) * 100) / 100)
    return m
  })()
  // Headline KPIs across the PM's projects. Neutral tiles are the "state of play"; overdue and
  // pending-approvals are "attention" tones that only light up when non-zero (see KpiStrip).
  $: openCount = issues.filter((i) => isOpen(i.cat)).length
  $: kpis = [
    { label: 'Open issues', value: openCount, tone: 'neutral', accent: '#6366f1', hint: 'Issues not Done/Cancelled across your projects' },
    { label: 'In progress', value: inProg.length, tone: 'neutral', accent: '#0ea5e9', hint: 'Issues in the In Progress status' },
    { label: 'Due this week', value: dueSoon.length, tone: 'neutral', accent: '#8b5cf6', hint: 'Open issues due in the next 7 days' },
    { label: 'Overdue', value: overdue.length, tone: 'red', accent: '#ef4444', hint: 'Open issues past their due date' },
    { label: 'Pending approvals', value: pendingRows.length, tone: 'amber', accent: '#f59e0b', hint: 'Submitted timesheet tasks awaiting your approval' }
  ] as Kpi[]
</script>

{#if !canView}
  <div class="yg-empty">Restricted to approvers.</div>
{:else}
  <div class="dash yg-page">
    <div class="yg-scroll">
      <GreetingCard name={employeeNames.get(me) ?? ''} />

      <!-- Headline KPIs: state-of-play + attention counters, right under the greeting. -->
      <KpiStrip tiles={kpis} />

      <!-- Attention band: the "act now" items, at the top. -->
      <div class="dash-attention">
        <InboxWidget />
        <ApprovalsQueue rows={pendingRows} {employeeNames} projectName={(id) => myProjects.find((p) => p.id === id)?.name ?? id} />
        <PriorityWatch issues={priority} {employeeNames} />
        <OverdueList overdue={overdue} dueSoon={dueSoon} {employeeNames} />
      </div>

      <!-- Overview: status mix + team workload this week (Hours-by-project dropped; the same
           per-project totals live in the "Projects you handle" Logged column). -->
      <div class="dash-two">
        <Donut segments={statusSegments} />
        <TeamWorkload {team} {employeeNames} />
      </div>

      <!-- Detail tables. -->
      <ProjectCards {stats} {portfolio} {statusColumns} {presetItems} bind:preset bind:fromStr bind:toStr />
      <InProgressTable issues={inProg} projects={myProjects} {employeeNames} {hoursByIssue} />
    </div>
  </div>
{/if}

<style lang="scss">
  @use './yg-table' as *;
  // Fill the app pane. The Dashboard app has no navigator, so its component mounts inside
  // .hulyPanels-container (a flex ROW); without flex-grow the page shrinks to content width and
  // hugs the left. flex:1 makes it fill the full pane like the navigator-based YG views do.
  .dash { flex: 1; min-width: 0; }
  // Issues-by-status (Donut) gets the wider column; the team table needs less width. Both cells
  // stretch to the taller card so the enlarged donut has room to breathe.
  // align-items: start so each card sizes to its own content - the donut card no longer stretches to
  // the (much taller) team table, which was leaving a large empty white area below the donut.
  .dash-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; align-items: start; }
  // Attention band: fixed 2x2 grid of equal-height cards. grid-auto-rows: 1fr sizes both rows to the
  // tallest, and align-items: stretch makes each card fill its cell (cards are flex-column with
  // height:100% so their list fills and any "view all" link sits at the bottom). Cards cap their
  // lists at ~6 rows and link to the full view. Collapses to a single column on narrow screens.
  .dash-attention { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-auto-rows: 1fr; gap: 16px; margin-top: 16px; align-items: stretch; }
  @media (max-width: 900px) { .dash-two { grid-template-columns: 1fr; } .dash-attention { grid-template-columns: 1fr; grid-auto-rows: auto; } }
</style>
