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
  import { weekRange } from '../utils/week'
  import {
    computeKpis, projectStats, statusBuckets, hoursByProject, inProgressIssues, overdueIssues, dueSoonIssues,
    type Cat, type DashIssue, type DashTime, type DashProject
  } from '../utils/dashboard'
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
    const pairs = res
      .filter((p) => h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers))
      .map((p) => { const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers; return { pm: a.pm, teamLead: a.teamLead } })
    canView = canApproveView(isAdmin, pairs, me)
  })
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
  statusQuery.query(tracker.class.IssueStatus, {}, (res: IssueStatus[]) => {
    const m = new Map<string, Cat>()
    for (const s of res) m.set(s._id, toCat(s.category))
    statusCat = m
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
    assignee: (i.assignee as string) ?? null,
    priority: i.priority,
    dueDate: i.dueDate ?? null
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
