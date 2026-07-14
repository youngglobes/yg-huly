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
<script lang="ts">
  import { getCurrentEmployee } from '@hcengineering/contact'
  import { type Ref } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Issue, type TimeSpendReport } from '@hcengineering/tracker'
  import { Label, Button, IconForward, IconBack } from '@hcengineering/ui'
  import ygTimesheet, { type DayStatus, type Timesheet, type TimesheetDay } from '@hcengineering/yg-timesheet'
  import { weekRange, groupByDay, formatHours, localDayKey, type ReportLike, type DayGroup } from '../utils/week'
  import {
    submitDay,
    recallDay,
    loadProjectApprovers,
    driftHours,
    NO_APPROVER,
    type DayReportLike,
    type ProjectApproverLike
  } from '../utils/day'

  const me = getCurrentEmployee()
  const client = getClient()
  let anchor = Date.now()
  $: week = weekRange(anchor)

  const query = createQuery()
  let days: DayGroup[] = []
  let weekTotal = 0
  // Raw day reports (shaped for the workflow logic) + the approvers for their projects.
  let reportsByKey: Map<string, DayReportLike[]> = new Map()
  let approversByProject: Map<string, ProjectApproverLike> = new Map()

  $: query.query(
    tracker.class.TimeSpendReport,
    { employee: me, date: { $gte: week.start, $lt: week.end } },
    (res: TimeSpendReport[]) => {
      const reports: ReportLike[] = []
      const rbk = new Map<string, DayReportLike[]>()
      const projSet = new Set<string>()
      for (const r of res) {
        const issue = r.$lookup?.attachedTo as Issue | undefined
        reports.push({
          employee: r.employee as Ref<any> | null,
          date: r.date,
          value: r.value,
          issueId: (issue?._id ?? r.attachedTo) as string,
          issueIdentifier: issue?.identifier ?? '—',
          issueTitle: issue?.title ?? '(unknown issue)',
          project: (issue?.space ?? '') as string
        })
        if (r.employee == null || r.date == null) continue
        const project = (issue?.space ?? '') as string
        const key = localDayKey(r.date)
        const arr = rbk.get(key) ?? []
        arr.push({
          project,
          employee: r.employee as string,
          issue: (issue?._id ?? r.attachedTo) as string,
          identifier: issue?.identifier ?? '—',
          title: issue?.title ?? '(unknown issue)',
          value: r.value,
          note: r.description ?? ''
        })
        rbk.set(key, arr)
        if (project !== '') projSet.add(project)
      }
      const g = groupByDay(reports, week)
      days = g.days
      weekTotal = g.weekTotal
      reportsByKey = rbk
      void loadProjectApprovers(client, [...projSet]).then((m) => {
        approversByProject = m
      })
    },
    { lookup: { attachedTo: tracker.class.Issue } }
  )

  // My persisted Timesheet for the visible week (may not exist until first submit).
  const tsQuery = createQuery()
  let myTs: Timesheet | undefined
  $: tsQuery.query(
    ygTimesheet.class.Timesheet,
    { space: ygTimesheet.space.Timesheets, employee: me, weekStart: week.start },
    (r: Timesheet[]) => {
      myTs = r[0]
    }
  )

  // The persisted TimesheetDay docs for that Timesheet, joined to the grid by local day key.
  const dayQuery = createQuery()
  let dayByKey: Map<string, TimesheetDay> = new Map()
  $: if (myTs !== undefined) {
    dayQuery.query(
      ygTimesheet.class.TimesheetDay,
      { space: ygTimesheet.space.Timesheets, attachedTo: myTs._id },
      (r: TimesheetDay[]) => {
        const m = new Map<string, TimesheetDay>()
        for (const d of r) m.set(localDayKey(d.date), d)
        dayByKey = m
      }
    )
  } else {
    dayQuery.unsubscribe()
    dayByKey = new Map()
  }

  function statusString (s: DayStatus): IntlString {
    switch (s) {
      case 'Submitted':
        return ygTimesheet.string.Submitted
      case 'Approved':
        return ygTimesheet.string.Approved
      case 'Rejected':
        return ygTimesheet.string.Rejected
      default:
        return ygTimesheet.string.Draft
    }
  }

  // Per-day key on which the last Submit attempt found no approver (drives the inline message).
  let noApproverKey: string | null = null

  async function onSubmit (day: DayGroup): Promise<void> {
    const reports = reportsByKey.get(day.key) ?? []
    const res = await submitDay(client, { employee: me, date: day.date, reports, approversByProject })
    noApproverKey = res === NO_APPROVER ? day.key : null
  }

  async function onRecall (day: DayGroup): Promise<void> {
    const persisted = dayByKey.get(day.key)
    if (persisted !== undefined) await recallDay(client, persisted._id)
  }

  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  function shift (deltaWeeks: number): void {
    // Calendar-based shift (DST-safe): step whole days from this week's Monday.
    const d = new Date(week.start)
    d.setDate(d.getDate() + deltaWeeks * 7)
    anchor = d.getTime()
  }
</script>

<div class="ac-header full divide">
  <div class="ac-header__wrap-title">
    <span class="ac-header__title"><Label label={ygTimesheet.string.Timesheet} /></span>
  </div>
  <div class="ac-header-full">
    <Button icon={IconBack} kind="ghost" on:click={() => shift(-1)} />
    <span class="p-2">{weekdayFmt.format(week.days[0].date)} — {weekdayFmt.format(week.days[6].date)}</span>
    <Button icon={IconForward} kind="ghost" on:click={() => shift(1)} />
    <Button kind="ghost" label={ygTimesheet.string.Today} on:click={() => (anchor = Date.now())} />
    <div class="ml-4"><Label label={ygTimesheet.string.Total} />: <b>{formatHours(weekTotal)}</b></div>
  </div>
</div>

<div class="ts-grid">
  {#each days as day (day.key)}
    {@const persisted = dayByKey.get(day.key)}
    {@const status = persisted?.status ?? 'Draft'}
    {@const drift = status === 'Approved' ? driftHours(persisted?.totalHours ?? 0, day.total) : 0}
    <div class="ts-day">
      <div class="ts-day__head">
        <span>{weekdayFmt.format(day.date)}</span>
        <span class="ts-day__total">{formatHours(day.total)}</span>
      </div>
      <div class="ts-day__status">
        <span class="ts-pill ts-pill--{status.toLowerCase()}"><Label label={statusString(status)} /></span>
        {#if status === 'Approved' && drift !== 0}
          <span class="ts-drift" title="">⚠ <Label label={ygTimesheet.string.Drift} /></span>
        {/if}
      </div>
      {#if day.issues.length === 0}
        <div class="ts-empty">—</div>
      {:else}
        {#each day.issues as it (it.issueId)}
          <div class="ts-line">
            <span class="ts-line__id">{it.identifier}</span>
            <span class="ts-line__title">{it.title}</span>
            <span class="ts-line__hrs">{formatHours(it.hours)}</span>
          </div>
        {/each}
      {/if}
      {#if status === 'Rejected' && (persisted?.rejectReason ?? '') !== ''}
        <div class="ts-reason">
          <b><Label label={ygTimesheet.string.RejectReason} />:</b>
          {persisted?.rejectReason}
        </div>
      {/if}
      <div class="ts-actions">
        {#if (status === 'Draft' || status === 'Rejected') && day.issues.length > 0}
          <Button kind="primary" size="small" label={ygTimesheet.string.Submit} on:click={() => onSubmit(day)} />
        {:else if status === 'Submitted'}
          <Button kind="regular" size="small" label={ygTimesheet.string.Recall} on:click={() => onRecall(day)} />
        {/if}
        {#if noApproverKey === day.key}
          <span class="ts-noapprover"><Label label={ygTimesheet.string.NoApprover} /></span>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style lang="scss">
  .ts-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; padding: 1rem; overflow: auto; }
  .ts-day { border: 1px solid var(--theme-divider-color); border-radius: 0.5rem; padding: 0.5rem; min-height: 6rem; }
  .ts-day__head { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 0.5rem; }
  .ts-day__total { color: var(--theme-content-color); }
  .ts-line { display: flex; gap: 0.25rem; font-size: 0.75rem; padding: 0.125rem 0; }
  .ts-line__id { color: var(--theme-dark-color); }
  .ts-line__title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ts-line__hrs { font-variant-numeric: tabular-nums; }
  .ts-empty { color: var(--theme-darker-color); text-align: center; }
  .ts-day__status { display: flex; align-items: center; gap: 0.375rem; margin-bottom: 0.375rem; }
  .ts-pill {
    font-size: 0.6875rem; font-weight: 600; padding: 0.0625rem 0.375rem; border-radius: 0.75rem;
    background: var(--theme-button-default); color: var(--theme-content-color);
  }
  .ts-pill--submitted { background: var(--theme-warning-color); color: #fff; }
  .ts-pill--approved { background: var(--theme-won-color); color: #fff; }
  .ts-pill--rejected { background: var(--theme-lost-color); color: #fff; }
  .ts-drift { font-size: 0.6875rem; color: var(--theme-warning-color); }
  .ts-reason { font-size: 0.75rem; color: var(--theme-content-color); margin-top: 0.375rem; }
  .ts-actions { display: flex; align-items: center; gap: 0.375rem; margin-top: 0.5rem; flex-wrap: wrap; }
  .ts-noapprover { font-size: 0.6875rem; color: var(--theme-lost-color); }
</style>
