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
  Employee dashboard: the non-PM branch of the role router. Every query here is scoped to the
  current employee (assignee/employee = me) - no project/approver gating, unlike Dashboard.svelte.
  All queries live here; normalization to plain shapes is delegated to utils/dashboard.ts and
  utils/attendance.ts (pure, unit-tested) so the cards below only ever receive plain data.
-->
<script lang="ts">
  import contact, { formatName, getCurrentEmployee, type Employee } from '@hcengineering/contact'
  import { type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import tracker, { type Issue, type IssueStatus, type TimeSpendReport } from '@hcengineering/tracker'
  import ygTimesheet, { type AttendanceSession } from '@hcengineering/yg-timesheet'
  import { dayStats, findOpenSession, localMidnight } from '../utils/attendance'
  import {
    assignedTo, dueSoonIssues, openStatusNames, overdueIssues, priorityWatch, type Cat, type DashIssue
  } from '../utils/dashboard'
  import { weekRange } from '../utils/week'
  import GreetingCard from './dashboard/GreetingCard.svelte'
  import InboxWidget from './dashboard/InboxWidget.svelte'
  import MyAttendanceCard from './dashboard/MyAttendanceCard.svelte'
  import MyHoursCard from './dashboard/MyHoursCard.svelte'
  import MyTasksCard from './dashboard/MyTasksCard.svelte'
  import OverdueList from './dashboard/OverdueList.svelte'
  import PriorityWatch from './dashboard/PriorityWatch.svelte'

  const me = getCurrentEmployee()
  const client = getClient()

  // Category ref -> normalized Cat. Copied from Dashboard.svelte (not exported from utils/dashboard
  // - it maps a platform ref, so it stays a query-adjacent concern, not pure-lib).
  function toCat (categoryRef: Ref<any> | undefined): Cat {
    switch (categoryRef) {
      case task.statusCategory.Active: return 'active'
      case task.statusCategory.Won: return 'won'
      case task.statusCategory.Lost: return 'lost'
      case task.statusCategory.ToDo: return 'todo'
      default: return 'unstarted'
    }
  }

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

  // --- My issues (assignee: me) --------------------------------------------
  const issueQuery = createQuery()
  let issueDocs: Issue[] = []
  issueQuery.query(tracker.class.Issue, { assignee: me }, (res: Issue[]) => { issueDocs = res })
  $: issues = issueDocs.map((i): DashIssue => ({
    id: i._id,
    identifier: i.identifier,
    title: i.title,
    project: i.space,
    cat: statusCat.get(i.status) ?? 'unstarted',
    status: statusName.get(i.status) ?? '-',
    assignee: (i.assignee as string) ?? null,
    priority: i.priority,
    dueDate: i.dueDate ?? null,
    estimation: i.estimation ?? 0,
    reportedTime: i.reportedTime ?? 0
  }))
  // Already scoped by the query above; re-derived via the shared helper to keep the "me" filter
  // explicit and in one place (matches the brief - this is the single source of truth for "mine").
  $: myIssues = assignedTo(issues, me)

  // --- My logged time this week ---------------------------------------------
  $: week = weekRange(Date.now())
  const timeQuery = createQuery()
  let timeDocs: TimeSpendReport[] = []
  $: timeQuery.query(
    tracker.class.TimeSpendReport,
    { employee: me, date: { $gte: week.start, $lt: week.end } },
    (res: TimeSpendReport[]) => { timeDocs = res }
  )
  // TimeSpendReport carries no issue identifier/title - resolve via the issues queried above (my
  // own logged time is always against an issue assigned to me).
  $: issueMeta = new Map(issueDocs.map((i) => [i._id as string, { identifier: i.identifier, title: i.title }]))
  $: hours = round2(timeDocs.reduce((s, t) => s + t.value, 0))
  $: entries = timeDocs.map((t) => ({
    identifier: issueMeta.get(t.attachedTo as string)?.identifier ?? (t.attachedTo as string),
    title: issueMeta.get(t.attachedTo as string)?.title ?? '',
    hours: t.value,
    date: t.date ?? 0
  }))

  $: now = Date.now()

  // --- Today's attendance ----------------------------------------------------
  $: today = localMidnight(now)
  const attendanceQuery = createQuery()
  let attendanceDocs: AttendanceSession[] = []
  $: attendanceQuery.query(
    ygTimesheet.class.AttendanceSession,
    { employee: me, date: today },
    (res: AttendanceSession[]) => { attendanceDocs = res }
  )
  $: openSession = findOpenSession(attendanceDocs)
  $: todayStats = dayStats(attendanceDocs, now)

  // --- Employee names ---------------------------------------------------------
  const empQuery = createQuery()
  let employeeNames = new Map<string, string>()
  empQuery.query(contact.mixin.Employee, {}, (res: Employee[]) => { employeeNames = new Map(res.map((e) => [e._id as string, formatName(e.name)])) })

  // --- Derived (pure lib) --------------------------------------------------
  $: statusColumns = openStatusNames(myIssues)
  $: priority = priorityWatch(myIssues)
  $: overdue = overdueIssues(myIssues, now)
  $: dueSoon = dueSoonIssues(myIssues, now, 7)

  function round2 (n: number): number {
    return Math.round(n * 100) / 100
  }
</script>

<div class="dash yg-page">
  <div class="yg-scroll">
    <GreetingCard name={employeeNames.get(me) ?? ''} />

    <!-- Attention band: the "act now" items, at the top. -->
    <div class="dash-attention">
      <MyAttendanceCard
        open={openSession !== undefined}
        mode={openSession?.mode}
        todayMs={todayStats.totalMs}
        sessions={todayStats.count}
        firstIn={todayStats.firstIn}
      />
      <InboxWidget />
      <PriorityWatch issues={priority} {employeeNames} />
      <OverdueList {overdue} {dueSoon} {employeeNames} />
    </div>

    <!-- Full-width detail cards. -->
    <div class="dash-detail">
      <MyTasksCard issues={myIssues} {statusColumns} />
      <MyHoursCard {hours} {entries} />
    </div>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;
  .dash-detail { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
  .dash-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; }
  // Attention band: fixed 2x2 grid of equal-height cards. grid-auto-rows: 1fr sizes both rows to the
  // tallest, and align-items: stretch makes each card fill its cell (cards are flex-column with
  // height:100% so their list fills and any "view all" link sits at the bottom). Cards cap their
  // lists at ~6 rows and link to the full view. Collapses to a single column on narrow screens.
  .dash-attention { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-auto-rows: 1fr; gap: 16px; margin-top: 16px; align-items: stretch; }
  @media (max-width: 900px) { .dash-two { grid-template-columns: 1fr; } .dash-attention { grid-template-columns: 1fr; grid-auto-rows: auto; } }
</style>
