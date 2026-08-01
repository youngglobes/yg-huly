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
  HR dashboard: org-wide roster view for HR/Owner viewers - who is in today (office/wfh), who
  hasn't logged time this week, timesheet submission compliance, and per-person hours. Every
  query here is org-scoped (no assignee/employee=me filter), unlike EmployeeDashboard.svelte.
  All normalization to plain shapes is delegated to utils/hr-dashboard.ts (pure, unit-tested) so
  the cards below only ever receive plain data.
-->
<script lang="ts">
  import contact, { formatName, getCurrentEmployee, type Employee } from '@hcengineering/contact'
  import { type Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { onMount } from 'svelte'
  import ygTimesheet, {
    type AttendanceSession, type HrTimeEntry, type Timesheet, type TimesheetDay
  } from '@hcengineering/yg-timesheet'
  import {
    attendanceToday, headcount, hoursByPerson, notLoggedThisWeek, notPunchedToday, orgHoursTotal,
    submissionCompliance, wfhOfficeSplit, type HrAtt, type HrEmp, type HrHours, type HrSub
  } from '../utils/hr-dashboard'
  import { localMidnight } from '../utils/attendance'
  import { formatHours, weekRange } from '../utils/week'
  import Donut from './dashboard/Donut.svelte'
  import GreetingCard from './dashboard/GreetingCard.svelte'
  import HrAttendanceTodayCard from './dashboard/HrAttendanceTodayCard.svelte'
  import HrComplianceCard from './dashboard/HrComplianceCard.svelte'
  import HrHoursByPersonCard from './dashboard/HrHoursByPersonCard.svelte'
  import HrNotLoggedCard from './dashboard/HrNotLoggedCard.svelte'
  import KpiStrip, { type Kpi } from './dashboard/KpiStrip.svelte'
  import { ensureHrMembership } from '../utils/hrMembership'

  onMount(() => { void ensureHrMembership() })

  const me = getCurrentEmployee()

  // --- Employees ---------------------------------------------------------------
  const empQuery = createQuery()
  let empDocs: Employee[] = []
  empQuery.query(contact.mixin.Employee, {}, (res: Employee[]) => { empDocs = res })
  $: emps = empDocs.map((e): HrEmp => ({ id: e._id, name: formatName(e.name), active: e.active !== false }))
  $: meName = emps.find((e) => e.id === me)?.name ?? ''

  // --- Today's attendance, org-wide --------------------------------------------
  $: today = localMidnight(Date.now())
  const attQuery = createQuery()
  let attDocs: AttendanceSession[] = []
  $: attQuery.query(ygTimesheet.class.AttendanceSession, { date: today }, (res: AttendanceSession[]) => { attDocs = res })
  $: att = attDocs.map((a): HrAtt => ({ employee: a.employee, mode: a.mode, open: a.punchOut == null, punchIn: a.punchIn }))

  // --- Hours logged this week, org-wide -----------------------------------------
  $: week = weekRange(Date.now())
  const hoursQuery = createQuery()
  let hoursDocs: HrTimeEntry[] = []
  $: hoursQuery.query(
    ygTimesheet.class.HrTimeEntry,
    { date: { $gte: week.start, $lt: week.end } },
    (res: HrTimeEntry[]) => { hoursDocs = res }
  )
  $: hours = hoursDocs.map((h): HrHours => ({ employee: h.employee, hours: h.hours, date: h.date }))

  // --- Timesheet submissions this week -------------------------------------------
  // Timesheet -> its TimesheetDay children (attachedTo), joined in JS (no $lookup) - same pattern
  // as Dashboard.svelte's pendingRows. HR may lack read access to Timesheet/TimesheetDay entirely;
  // both queries then simply resolve empty, which yields an empty-state compliance card - fine.
  const tsQuery = createQuery()
  let tsDocs: Timesheet[] = []
  $: tsQuery.query(ygTimesheet.class.Timesheet, { weekStart: week.start }, (res: Timesheet[]) => { tsDocs = res })
  $: tsEmpById = new Map<Ref<Timesheet>, Ref<Employee>>(tsDocs.map((t) => [t._id, t.employee]))
  $: tsIds = tsDocs.map((t) => t._id)

  const dayQuery = createQuery()
  let dayDocs: TimesheetDay[] = []
  $: dayQuery.query(ygTimesheet.class.TimesheetDay, { attachedTo: { $in: tsIds } }, (res: TimesheetDay[]) => { dayDocs = res })
  $: subs = dayDocs
    .filter((d) => d.status === 'Submitted' || d.status === 'Approved')
    .map((d): HrSub | undefined => {
      const employee = tsEmpById.get(d.attachedTo as Ref<Timesheet>)
      return employee === undefined ? undefined : { employee, submitted: true }
    })
    .filter((s): s is HrSub => s !== undefined)

  // --- Derived (pure lib) --------------------------------------------------------
  $: present = attendanceToday(att, emps)
  $: split = wfhOfficeSplit(att, emps)
  $: notPunched = notPunchedToday(att, emps)
  $: byPerson = hoursByPerson(hours, emps)
  $: notLogged = notLoggedThisWeek(hours, emps)
  $: comp = submissionCompliance(subs, emps)

  // Headline KPIs, org-scoped. Matches Dashboard.svelte/EmployeeDashboard.svelte precedent: plain
  // string labels (KpiStrip's Kpi.label is `string`, not IntlString) - not resolved via translate().
  $: kpis = [
    { label: 'Headcount', value: headcount(emps), tone: 'neutral' },
    { label: 'Present today', value: present.length, tone: 'neutral' },
    { label: 'WFH / Office', value: `${split.wfh} / ${split.office}`, tone: 'neutral' },
    { label: 'Hours this week', value: formatHours(orgHoursTotal(hours)), tone: 'neutral' },
    { label: 'Not logged this week', value: notLogged.length, tone: 'amber' },
    {
      label: 'Timesheet submissions',
      value: `${comp.submitted} / ${comp.expected}`,
      tone: comp.expected > 0 && comp.submitted < comp.expected ? 'amber' : 'neutral'
    }
  ] as Kpi[]
</script>

<div class="dash yg-page">
  <div class="yg-scroll">
    <GreetingCard name={meName} />

    <!-- Headline KPIs, org-scoped. -->
    <KpiStrip tiles={kpis} />

    <!-- Attention band: the "act now" items, at the top. -->
    <div class="dash-attention">
      <HrAttendanceTodayCard {present} {notPunched} />
      <HrNotLoggedCard emps={notLogged} />
      <HrComplianceCard submitted={comp.submitted} expected={comp.expected} missing={comp.missing} />
      <Donut segments={[
        { name: 'Office', count: split.office, color: '#6366f1' },
        { name: 'WFH', count: split.wfh, color: '#14b8a6' }
      ]} />
    </div>

    <!-- Full-width detail: per-person hours table. -->
    <div class="dash-detail">
      <HrHoursByPersonCard rows={byPerson} />
    </div>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;
  // Fill the app pane. The Human Resource app has no navigator on this special, so its component
  // mounts inside .hulyPanels-container (a flex ROW); without flex-grow the page shrinks to
  // content width and hugs the left. flex:1 makes it fill the full pane like the navigator-based
  // YG views do.
  .dash { flex: 1; min-width: 0; }
  // Single full-width detail block (unlike EmployeeDashboard's two-column split).
  .dash-detail { margin-top: 16px; }
  // Attention band: fixed 2x2 grid of equal-height cards. grid-auto-rows: 1fr sizes both rows to the
  // tallest, and align-items: stretch makes each card fill its cell. Collapses to a single column
  // on narrow screens.
  .dash-attention { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-auto-rows: 1fr; gap: 16px; margin-top: 16px; align-items: stretch; }
  @media (max-width: 900px) { .dash-attention { grid-template-columns: 1fr; grid-auto-rows: auto; } }
</style>
