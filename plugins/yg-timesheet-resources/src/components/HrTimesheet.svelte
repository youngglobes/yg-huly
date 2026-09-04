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
  HR timesheet sub-module: a per-employee weekly grid (Project/Task rows × Mon-Sun columns)
  built from the projected HrTimeEntry data, with row/day/grand totals, an 8h/weekday target
  highlight, and a per-day approval-status row (from TimesheetDay). Mirrors Reports.svelte's
  conventions (createQuery, employee-name map, sticky-header table, --theme-* vars). Styled to
  match HrOverview.svelte's "Schedule" chrome (Header + Breadcrumb + hulyHeader-container nav
  row) and its amber/green text-color cell tokens, so both HR grids agree visually.
-->
<script lang="ts">
  import contact, { formatName, type Employee, type Person } from '@hcengineering/contact'
  import { EmployeeBox } from '@hcengineering/contact-resources'
  import core, { type Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import ui, { IconBack, IconForward, Label } from '@hcengineering/ui'
  import ygTimesheet, {
    type HrTimeEntry,
    type TaskStatus,
    type Timesheet,
    type TimesheetDay,
    type TimesheetTask
  } from '@hcengineering/yg-timesheet'
  import { get } from 'svelte/store'
  import { buildWeekGrid, type HrEntry } from '../utils/hr-report'
  import { ensureHrMembership } from '../utils/hrMembership'
  import { hrSelectedEmployee } from '../utils/hrStore'
  import { deriveDayStatus, type DerivedDayStatus } from '../utils/task-approval'
  import { formatHours, localDayKey, weekRange } from '../utils/week'

  void ensureHrMembership()

  const DAY_TARGET = 8 // hours/day, weekdays

  // Seed from the shared store so a click-through from Overview lands pre-loaded on that
  // employee's grid; the local EmployeeBox picker below still works as before either way.
  let employee: Ref<Person> | undefined
  const pre = get(hrSelectedEmployee)
  if (pre !== undefined) {
    employee = pre
    hrSelectedEmployee.set(undefined)
  }

  let weekMs = Date.now()
  $: week = weekRange(weekMs)
  function shiftWeek (deltaDays: number): void {
    const d = new Date(weekMs)
    d.setDate(d.getDate() + deltaDays)
    weekMs = d.getTime()
  }

  // Employee display names.
  const empQuery = createQuery()
  let employeeNames = new Map<string, string>()
  empQuery.query(contact.mixin.Employee, {}, (res: Employee[]) => {
    const m = new Map<string, string>()
    for (const e of res) m.set(e._id, formatName(e.name))
    employeeNames = m
  })

  // HR entries for the selected employee + week (from the private HR space).
  const entryQuery = createQuery()
  let entries: HrTimeEntry[] = []
  $: entryQuery.query(
    ygTimesheet.class.HrTimeEntry,
    {
      space: ygTimesheet.space.HrData,
      employee: (employee ?? '') as any,
      date: { $gte: week.start, $lt: week.end }
    },
    (res: HrTimeEntry[]) => {
      entries = employee == null ? [] : res
    }
  )
  $: hrEntries = entries.map(
    (e): HrEntry => ({
      date: e.date,
      project: e.project,
      projectName: e.projectName,
      issue: e.issue,
      identifier: e.identifier,
      title: e.title,
      hours: e.hours,
      note: e.note
    })
  )
  $: grid = buildWeekGrid(hrEntries, week)

  // Per-day approval status, ALL employees for the visible week - this IS a cross-employee view,
  // so a week date-range query is correct here (unlike Timesheet.svelte's own employee-scoped
  // dayIds query). Query TimesheetTask directly (never the deprecated TimesheetDay.status) and
  // resolve each task's employee via the nested attachedTo lookup: task → TimesheetDay →
  // Timesheet → .employee, exactly as Approvals.svelte:51-61. Group by
  // `${employee}|${localDayKey(task.date)}` (submitDay stamps task.date = the day's date) and
  // derive each entry's label via deriveDayStatus - never stored, never read off TimesheetDay.
  function employeeOfTask (task: TimesheetTask): Ref<Employee> | undefined {
    const day = task.$lookup?.attachedTo as TimesheetDay | undefined
    const parent = day?.$lookup?.attachedTo as Timesheet | undefined
    return parent?.employee
  }

  const taskQuery = createQuery()
  let statusByKey = new Map<string, DerivedDayStatus>()
  $: taskQuery.query(
    ygTimesheet.class.TimesheetTask,
    { space: core.space.Workspace, date: { $gte: week.start, $lt: week.end } },
    (res: TimesheetTask[]) => {
      const groups = new Map<string, TaskStatus[]>()
      for (const t of res) {
        const emp = employeeOfTask(t)
        if (emp == null) continue
        const key = `${emp}|${localDayKey(t.date)}`
        const arr = groups.get(key) ?? []
        arr.push(t.status)
        groups.set(key, arr)
      }
      const m = new Map<string, DerivedDayStatus>()
      for (const [key, statuses] of groups) m.set(key, deriveDayStatus(statuses))
      statusByKey = m
    },
    { lookup: { attachedTo: [ygTimesheet.class.TimesheetDay, { attachedTo: ygTimesheet.class.Timesheet }] } }
  )
  $: statusRow = week.days.map((d) => (employee != null ? statusByKey.get(`${employee}|${d.key}`) : undefined))

  const dowFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' })
  const rangeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
  function isWeekend (i: number): boolean {
    return i >= 5
  }
</script>

<div class="yg-page">
  <div class="yg-head">
    <h1 class="yg-title"><Label label={ygTimesheet.string.HrTimesheets} /></h1>
    <div class="yg-weekbar">
      <button class="yg-weekbar__nav" aria-label="Previous week" on:click={() => shiftWeek(-7)}>
        <IconBack size="small" />
      </button>
      <button class="yg-weekbar__today" on:click={() => (weekMs = Date.now())}><Label label={ui.string.Today} /></button>
      <span class="yg-weekbar__range">
        {rangeFmt.format(week.days[0].date)} to {rangeFmt.format(week.days[6].date)}
      </span>
      <button class="yg-weekbar__nav" aria-label="Next week" on:click={() => shiftWeek(7)}>
        <IconForward size="small" />
      </button>
      <span class="yg-weekbar__spacer" />
      <div class="hrt-field">
        <EmployeeBox label={ygTimesheet.string.Employee} bind:value={employee} allowDeselect kind="regular" />
      </div>
    </div>
  </div>

  {#if employee == null}
    <div class="hrt-empty"><Label label={ygTimesheet.string.NoEmployeeSelected} /></div>
  {:else}
    <div class="yg-scroll">
      <div class="yg-table-wrap">
        <table class="yg-table">
          <thead>
            <tr>
              <th><Label label={ygTimesheet.string.Project} /></th>
              {#each week.days as d, i (d.key)}
                <th class="yg-num" class:hrt-weekend={isWeekend(i)}>{dowFmt.format(d.date)}</th>
              {/each}
              <th class="yg-num"><Label label={ygTimesheet.string.TotalHours} /></th>
            </tr>
          </thead>
          <tbody>
            {#if grid.rows.length === 0}
              <tr><td colspan={9} class="yg-empty"><Label label={ygTimesheet.string.NoData} /></td></tr>
            {:else}
              {#each grid.rows as r (r.issue)}
                <tr>
                  <td>
                    <div class="hrt-task">
                      <span class="hrt-task__project">{r.projectName}</span>
                      <span class="hrt-task__id">{r.identifier}</span>
                      <span class="hrt-task__title">{r.title}</span>
                    </div>
                  </td>
                  {#each r.cells as c, i (i)}
                    <td class="yg-num" title={r.notesByDay[i]}>
                      {c === 0 ? '·' : formatHours(c)}
                      {#if r.notesByDay[i] !== undefined}
                        <span class="hrt-note-dot" title={r.notesByDay[i]}>●</span>
                      {/if}
                    </td>
                  {/each}
                  <td class="yg-num"><b>{formatHours(r.rowTotal)}</b></td>
                </tr>
              {/each}
            {/if}
          </tbody>
          <tfoot>
            <tr class="yg-totals">
              <td><Label label={ygTimesheet.string.TotalHours} /></td>
              {#each grid.dayTotals as t, i (i)}
                <td
                  class="yg-num"
                  class:yg-amber={!isWeekend(i) && t < DAY_TARGET}
                  class:yg-green={!isWeekend(i) && t >= DAY_TARGET}
                >
                  {formatHours(t)}
                </td>
              {/each}
              <td class="yg-num"><b>{formatHours(grid.grandTotal)}</b></td>
            </tr>
            <tr class="hrt-status-row">
              <td><Label label={ygTimesheet.string.Status} /></td>
              {#each statusRow as s, i (i)}
                <td class="yg-num">
                  {#if s !== undefined}
                    <span class="yg-pill yg-pill--{s.toLowerCase()}">
                      {#if s === 'PartiallyApproved'}
                        <Label label={ygTimesheet.string.PartiallyApproved} />
                      {:else}
                        {s}
                      {/if}
                    </span>
                  {:else}
                    <span class="hrt-muted">·</span>
                  {/if}
                </td>
              {/each}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  @use './yg-table' as *;

  .hrt-field { min-width: 12rem; }
  .hrt-empty { color: var(--yg-text-dim); padding: 2rem; text-align: center; }

  // HrTimesheet's table chrome (right-aligned/compact headers, top-aligned wrapping cells)
  // differs from HrOverview's (centered/uppercase/middle-aligned) even though both now share
  // `.yg-table`/`.yg-num` class names via yg-table.scss. These local rules are plain
  // (non-`:global`) Svelte-scoped rules, so the compiler auto-suffixes them with this
  // component's own scope class - that reliably out-specificities the shared partial's
  // `:global(...)` (hash-less) base rules regardless of source order, letting this component
  // keep its pre-existing look on top of the shared class names rather than adopting
  // HrOverview's flavor. See yg-table.scss's header comment for the full rationale.
  .yg-table th {
    text-align: right;
    font-weight: 600;
    color: var(--theme-dark-color);
    font-size: inherit;
    text-transform: none;
    padding: 0.75rem 0.9375rem;
    border-bottom: 1px solid var(--theme-divider-color);
    white-space: nowrap;
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--theme-comp-header-color);
  }
  .yg-table th:first-child { text-align: left; padding-left: 1.125rem; }
  .yg-table th:last-child { padding-right: 1.125rem; }
  .yg-table td {
    padding: 0.75rem 0.9375rem;
    border-bottom: 1px solid var(--theme-divider-color);
    vertical-align: top;
    text-align: left;
    font-variant-numeric: normal;
    white-space: normal;
  }
  .yg-table td:first-child { padding-left: 1.125rem; }
  .yg-table td:last-child { padding-right: 1.125rem; }
  .yg-table th.yg-num,
  .yg-table td.yg-num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .hrt-weekend { color: var(--theme-darker-color); }
  .hrt-task { display: flex; flex-direction: column; gap: 0.0625rem; }
  .hrt-task__project { color: var(--theme-dark-color); font-size: 0.6875rem; }
  .hrt-task__id { color: var(--theme-dark-color); font-weight: 600; }
  .hrt-task__title { color: var(--theme-content-color); }
  .hrt-note-dot { color: var(--theme-link-color, var(--primary-button-default)); font-size: 0.5rem; margin-left: 0.1875rem; vertical-align: super; }
  .hrt-status-row td { border-top: none; padding-top: 0.25rem; }
  .hrt-muted { color: var(--theme-dark-color); }
</style>
