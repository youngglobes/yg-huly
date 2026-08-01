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
    attendanceToday, headcount, hoursByPerson, notPunchedToday, orgHoursTotal,
    submissionCompliance, wfhOfficeSplit, type HrAtt, type HrEmp, type HrHours, type HrSub
  } from '../utils/hr-dashboard'
  import { localMidnight } from '../utils/attendance'
  import { formatHours, lastWorkingDay, weekRange } from '../utils/week'
  import Donut from './dashboard/Donut.svelte'
  import GreetingCard from './dashboard/GreetingCard.svelte'
  import HrAttendanceTodayCard from './dashboard/HrAttendanceTodayCard.svelte'
  import HrComplianceCard from './dashboard/HrComplianceCard.svelte'
  import HrHoursByPersonCard from './dashboard/HrHoursByPersonCard.svelte'
  import KpiStrip, { type Kpi } from './dashboard/KpiStrip.svelte'
  import { ensureHrMembership } from '../utils/hrMembership'

  onMount(() => { void ensureHrMembership() })

  const me = getCurrentEmployee()

  // Org owners - not tracked on this dashboard: they do not log in, punch, or do tasks, so counting
  // them would skew every metric (headcount, present, hours, compliance). Excluded from ALL data.
  // Refs are the workspace contact Person _ids (looked up 2026-08-01): Pravin Mohanraj, Arunkumar M,
  // Raj kumar R.
  const EXCLUDED = new Set<string>([
    '65b35513cc768dc52f35e01e',
    '66d59296fa21aec0c6251ab7',
    '66a9ec9f00e2942c53e1ec93'
  ])

  // --- Employees ---------------------------------------------------------------
  const empQuery = createQuery()
  let empDocs: Employee[] = []
  empQuery.query(contact.mixin.Employee, {}, (res: Employee[]) => { empDocs = res })
  $: emps = empDocs
    .filter((e) => !EXCLUDED.has(e._id))
    .map((e): HrEmp => ({ id: e._id, name: formatName(e.name), active: e.active !== false }))
  $: meName = emps.find((e) => e.id === me)?.name ?? ''

  // --- Today's attendance, org-wide --------------------------------------------
  $: today = localMidnight(Date.now())
  const attQuery = createQuery()
  let attDocs: AttendanceSession[] = []
  $: attQuery.query(ygTimesheet.class.AttendanceSession, { date: today }, (res: AttendanceSession[]) => { attDocs = res })
  $: att = attDocs
    .filter((a) => !EXCLUDED.has(a.employee))
    .map((a): HrAtt => ({ employee: a.employee, mode: a.mode, open: a.punchOut == null, punchIn: a.punchIn }))

  // --- Hours logged this week, org-wide -----------------------------------------
  $: week = weekRange(Date.now())
  const hoursQuery = createQuery()
  let hoursDocs: HrTimeEntry[] = []
  $: hoursQuery.query(
    ygTimesheet.class.HrTimeEntry,
    { date: { $gte: week.start, $lt: week.end } },
    (res: HrTimeEntry[]) => { hoursDocs = res }
  )
  // HrTimeEntry.date is a full ms timestamp (the moment logged), not a day boundary. Bucket it to
  // the local calendar day so hoursByPerson's distinct-"days" counts real working days (<= 7 in a
  // week) instead of distinct entry timestamps, and "last active" shows the correct day. The week
  // filter above already ran on the raw timestamp, so this only affects day-grouping/display.
  $: hours = hoursDocs
    .filter((h) => !EXCLUDED.has(h.employee))
    .map((h): HrHours => ({ employee: h.employee, hours: h.hours, date: localMidnight(h.date) }))

  // --- Timesheet submissions for the last working day ----------------------------
  // Compliance is measured against the most recent COMPLETED working day (today is excluded -
  // employees submit at end of day, so today's would read zero until EOD). lastWorkingDay() encodes
  // the YoungGlobes work week (Mon-Fri + odd Saturdays). That day may sit in a prior calendar week
  // (e.g. on Monday it is Friday/Saturday of last week), so scope the Timesheet query to THAT day's
  // week, then keep only the TimesheetDay rows for that exact day.
  // Timesheet -> its TimesheetDay children (attachedTo), joined in JS (no $lookup). HR may lack read
  // access to Timesheet/TimesheetDay entirely; both queries then resolve empty -> empty-state card.
  const DAY_MS = 24 * 60 * 60 * 1000
  $: refDay = lastWorkingDay(Date.now())
  $: refWeekStart = weekRange(refDay).start
  const tsQuery = createQuery()
  let tsDocs: Timesheet[] = []
  $: tsQuery.query(ygTimesheet.class.Timesheet, { weekStart: refWeekStart }, (res: Timesheet[]) => { tsDocs = res })
  $: tsEmpById = new Map<Ref<Timesheet>, Ref<Employee>>(tsDocs.map((t) => [t._id, t.employee]))
  $: tsIds = tsDocs.map((t) => t._id)

  const dayQuery = createQuery()
  let dayDocs: TimesheetDay[] = []
  $: dayQuery.query(
    ygTimesheet.class.TimesheetDay,
    { attachedTo: { $in: tsIds }, date: { $gte: refDay, $lt: refDay + DAY_MS } },
    (res: TimesheetDay[]) => { dayDocs = res }
  )
  $: subs = dayDocs
    .filter((d) => d.submittedOn != null)
    .map((d): HrSub | undefined => {
      const employee = tsEmpById.get(d.attachedTo as Ref<Timesheet>)
      return employee === undefined || EXCLUDED.has(employee) ? undefined : { employee, submitted: true }
    })
    .filter((s): s is HrSub => s !== undefined)

  // --- Derived (pure lib) --------------------------------------------------------
  $: present = attendanceToday(att, emps)
  $: split = wfhOfficeSplit(att, emps)
  $: notPunched = notPunchedToday(att, emps)
  $: byPerson = hoursByPerson(hours, emps)
  $: comp = submissionCompliance(subs, emps)
  // Human-readable label for the compliance reference day (e.g. "Fri, 31 Jul").
  $: refDayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(refDay)

  // Headline KPIs, org-scoped. Matches Dashboard.svelte/EmployeeDashboard.svelte precedent: plain
  // string labels (KpiStrip's Kpi.label is `string`, not IntlString) - not resolved via translate().
  $: kpis = [
    { label: 'Headcount', value: headcount(emps), tone: 'neutral' },
    { label: 'Present today', value: present.length, tone: 'neutral' },
    { label: 'WFH / Office', value: `${split.wfh} / ${split.office}`, tone: 'neutral' },
    { label: 'Hours this week', value: formatHours(orgHoursTotal(hours)), tone: 'neutral' },
    {
      label: 'Timesheet submissions',
      value: `${comp.submitted} / ${comp.expected}`,
      tone: comp.expected > 0 && comp.submitted < comp.expected ? 'amber' : 'neutral',
      hint: `Submitted for ${refDayLabel} (the last working day)`
    }
  ] as Kpi[]
</script>

<div class="dash yg-page">
  <div class="yg-scroll">
    <GreetingCard name={meName} />

    <!-- Headline KPIs, org-scoped. -->
    <KpiStrip tiles={kpis} />

    <!-- Attention band: fixed-height, colour-accented cards in one row. -->
    <div class="dash-attention">
      <HrAttendanceTodayCard {present} {notPunched} accent="#6366f1" />
      <HrComplianceCard submitted={comp.submitted} expected={comp.expected} missing={comp.missing} submittedList={comp.submittedList} dayLabel={refDayLabel} accent="#f59e0b" />
      <Donut
        segments={[
          { name: 'Office', count: split.office, color: '#6366f1' },
          { name: 'WFH', count: split.wfh, color: '#14b8a6' }
        ]}
        title={ygTimesheet.string.OfficeVsWfh}
        centerLabel={'present'}
        accent="#8b5cf6"
        fill
      />
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
  // Attention band: three fixed-height cards in one row. grid-auto-rows pins the height so each card
  // is the same size regardless of content; cards that overflow scroll internally. Collapses to a
  // single column (auto height) on narrow screens.
  .dash-attention { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 320px; gap: 16px; margin-top: 16px; align-items: stretch; }
  @media (max-width: 1100px) { .dash-attention { grid-template-columns: 1fr; grid-auto-rows: auto; } }
</style>
