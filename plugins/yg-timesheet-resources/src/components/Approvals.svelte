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
  import { getCurrentEmployee, type Employee } from '@hcengineering/contact'
  import { EmployeeRefPresenter } from '@hcengineering/contact-resources'
  import { type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Issue, type TimeSpendReport } from '@hcengineering/tracker'
  import { Button, IconDownOutline, IconForward, Label } from '@hcengineering/ui'
  import ygTimesheet, { type Timesheet, type TimesheetDay } from '@hcengineering/yg-timesheet'
  import { formatHours } from '../utils/week'
  import { approveDay, rejectDay, type DayReportLike } from '../utils/day'

  const me = getCurrentEmployee()
  const client = getClient()

  // Submitted days routed to me (me ∈ approvers). $lookup the parent Timesheet for owner + weekStart.
  const query = createQuery()
  let queue: TimesheetDay[] = []
  $: query.query(
    ygTimesheet.class.TimesheetDay,
    { space: ygTimesheet.space.Timesheets, status: 'Submitted', approvers: me },
    (res: TimesheetDay[]) => {
      queue = res
    },
    { lookup: { attachedTo: ygTimesheet.class.Timesheet } }
  )

  function parentOf (day: TimesheetDay): Timesheet | undefined {
    return day.$lookup?.attachedTo as Timesheet | undefined
  }
  function ownerOf (day: TimesheetDay): Ref<Employee> | undefined {
    return parentOf(day)?.employee
  }

  // Local-day [start, end) bounds for the day's TimeSpendReport window (DST-safe).
  function dayBounds (date: number): { start: number, end: number } {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    const start = d.getTime()
    const e = new Date(start)
    e.setDate(e.getDate() + 1)
    return { start, end: e.getTime() }
  }

  // Load the OWNER's live TimeSpendReports for a day, mapped to DayReportLike (what approveDay snapshots).
  async function loadDayReports (owner: Ref<Employee>, date: number): Promise<DayReportLike[]> {
    const { start, end } = dayBounds(date)
    const res = await client.findAll(
      tracker.class.TimeSpendReport,
      { employee: owner, date: { $gte: start, $lt: end } },
      { lookup: { attachedTo: tracker.class.Issue } }
    )
    return res.map((r: TimeSpendReport) => {
      const issue = r.$lookup?.attachedTo as Issue | undefined
      return {
        project: (issue?.space ?? '') as string,
        employee: r.employee as string,
        issue: (issue?._id ?? r.attachedTo) as string,
        identifier: issue?.identifier ?? '—',
        title: issue?.title ?? '(unknown issue)',
        value: r.value,
        note: r.description ?? ''
      }
    })
  }

  // Expand/collapse the day → its owner's live lines.
  let expanded: Ref<TimesheetDay> | null = null
  let linesByDay: Map<Ref<TimesheetDay>, DayReportLike[]> = new Map()
  async function toggle (day: TimesheetDay): Promise<void> {
    if (expanded === day._id) {
      expanded = null
      return
    }
    const owner = ownerOf(day)
    if (owner !== undefined && !linesByDay.has(day._id)) {
      const lines = await loadDayReports(owner, day.date)
      linesByDay.set(day._id, lines)
      linesByDay = linesByDay
    }
    expanded = day._id
  }

  async function onApprove (day: TimesheetDay): Promise<void> {
    const owner = ownerOf(day)
    if (owner === undefined) return
    const reports = await loadDayReports(owner, day.date)
    await approveDay(client, day._id, reports)
  }

  // Approve every queued day of the SAME parent Timesheet (same owner + weekStart) as this row.
  async function onApproveWeek (day: TimesheetDay): Promise<void> {
    const parentId = day.attachedTo
    const weekDays = queue.filter((d) => d.attachedTo === parentId)
    for (const d of weekDays) {
      const owner = ownerOf(d)
      if (owner === undefined) continue
      const reports = await loadDayReports(owner, d.date)
      await approveDay(client, d._id, reports)
    }
  }

  // Reject: an inline required-reason input per day.
  let rejectingId: Ref<TimesheetDay> | null = null
  let rejectReason = ''
  function startReject (day: TimesheetDay): void {
    rejectingId = day._id
    rejectReason = ''
  }
  function cancelReject (): void {
    rejectingId = null
    rejectReason = ''
  }
  async function confirmReject (day: TimesheetDay): Promise<void> {
    const reason = rejectReason.trim()
    if (reason === '') return
    await rejectDay(client, day._id, reason)
    cancelReject()
  }

  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
</script>

<div class="ap-root">
  {#if queue.length === 0}
    <div class="ap-empty"><Label label={ygTimesheet.string.NothingToApprove} /></div>
  {:else}
    {#each queue as day (day._id)}
      {@const owner = ownerOf(day)}
      <div class="ap-day">
        <div class="ap-day__head">
          <span class="ap-owner">
            {#if owner !== undefined}
              <EmployeeRefPresenter value={owner} readonly />
            {:else}
              <span>—</span>
            {/if}
          </span>
          <span class="ap-date">{dayFmt.format(day.date)}</span>
          <span class="ap-total">{formatHours(day.totalHours)}</span>
          <Button
            kind="ghost"
            size="small"
            icon={expanded === day._id ? IconDownOutline : IconForward}
            on:click={() => toggle(day)}
          />
        </div>

        {#if expanded === day._id}
          <div class="ap-lines">
            {#each linesByDay.get(day._id) ?? [] as line (line.issue)}
              <div class="ap-line">
                <span class="ap-line__id">{line.identifier}</span>
                <span class="ap-line__title">{line.title}</span>
                <span class="ap-line__hrs">{formatHours(line.value)}</span>
              </div>
            {:else}
              <div class="ap-line ap-line--empty">—</div>
            {/each}
          </div>
        {/if}

        {#if rejectingId === day._id}
          <div class="ap-reject">
            <input
              class="ap-reject__input"
              type="text"
              placeholder=""
              bind:value={rejectReason}
            />
            <Button
              kind="negative"
              size="small"
              label={ygTimesheet.string.Reject}
              disabled={rejectReason.trim() === ''}
              on:click={() => confirmReject(day)}
            />
            <Button kind="ghost" size="small" label={ygTimesheet.string.Recall} on:click={cancelReject} />
          </div>
        {:else}
          <div class="ap-actions">
            <Button kind="primary" size="small" label={ygTimesheet.string.Approve} on:click={() => onApprove(day)} />
            <Button kind="regular" size="small" label={ygTimesheet.string.Reject} on:click={() => startReject(day)} />
            <Button kind="regular" size="small" label={ygTimesheet.string.ApproveWeek} on:click={() => onApproveWeek(day)} />
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style lang="scss">
  .ap-root { padding: 1rem; overflow: auto; display: flex; flex-direction: column; gap: 0.5rem; }
  .ap-empty { color: var(--theme-darker-color); padding: 1rem; text-align: center; }
  .ap-day { border: 1px solid var(--theme-divider-color); border-radius: 0.5rem; padding: 0.75rem; }
  .ap-day__head { display: flex; align-items: center; gap: 0.75rem; }
  .ap-owner { min-width: 10rem; }
  .ap-date { color: var(--theme-content-color); }
  .ap-total { font-weight: 600; font-variant-numeric: tabular-nums; margin-left: auto; }
  .ap-lines { margin: 0.5rem 0; padding-left: 0.5rem; border-left: 2px solid var(--theme-divider-color); }
  .ap-line { display: flex; gap: 0.5rem; font-size: 0.8125rem; padding: 0.125rem 0; }
  .ap-line__id { color: var(--theme-dark-color); }
  .ap-line__title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ap-line__hrs { font-variant-numeric: tabular-nums; }
  .ap-line--empty { color: var(--theme-darker-color); }
  .ap-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap; }
  .ap-reject { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem; flex-wrap: wrap; }
  .ap-reject__input {
    flex: 1; min-width: 12rem; padding: 0.25rem 0.5rem;
    border: 1px solid var(--theme-divider-color); border-radius: 0.25rem;
    background: var(--theme-bg-color); color: var(--theme-content-color);
  }
</style>
