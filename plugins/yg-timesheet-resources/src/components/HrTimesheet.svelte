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
  import core, { type Ref, type WithLookup } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import ui, { Breadcrumb, ButtonIcon, Header, IconBack, IconForward, Label, ModernButton } from '@hcengineering/ui'
  import ygTimesheet, { type HrTimeEntry, type Timesheet, type TimesheetDay } from '@hcengineering/yg-timesheet'
  import { get } from 'svelte/store'
  import { buildWeekGrid, type HrEntry } from '../utils/hr-report'
  import { ensureHrMembership } from '../utils/hrMembership'
  import { hrSelectedEmployee } from '../utils/hrStore'
  import { formatHours, localDayKey, weekRange } from '../utils/week'

  void ensureHrMembership()

  const DAY_TARGET = 8 // hours/day, weekdays

  // Seed from the shared store so a click-through from Overview lands pre-loaded on that
  // employee's grid; the local EmployeeBox picker below still works as before either way.
  let employee: Ref<Person> | undefined
  const pre = get(hrSelectedEmployee)
  if (pre !== undefined) employee = pre

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

  // Per-day approval status for the selected employee (from the shared workspace space).
  const dayQuery = createQuery()
  let statusByKey = new Map<string, string>()
  $: dayQuery.query(
    ygTimesheet.class.TimesheetDay,
    { space: core.space.Workspace, date: { $gte: week.start, $lt: week.end } },
    (res: Array<WithLookup<TimesheetDay>>) => {
      const m = new Map<string, string>()
      for (const d of res) {
        const parent = d.$lookup?.attachedTo as Timesheet | undefined
        if (parent?.employee == null) continue
        m.set(`${parent.employee}|${localDayKey(d.date)}`, d.status)
      }
      statusByKey = m
    },
    { lookup: { attachedTo: ygTimesheet.class.Timesheet } }
  )
  $: statusRow = week.days.map((d) => (employee != null ? statusByKey.get(`${employee}|${d.key}`) ?? '' : ''))

  const dowFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' })
  const rangeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
  function isWeekend (i: number): boolean {
    return i >= 5
  }
</script>

<div class="hrt-root hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={ygTimesheet.icon.Timesheet} label={ygTimesheet.string.HrTimesheets} size={'large'} isCurrent />
  </Header>
  <div class="hulyHeader-container clearPadding justify-between flex-gap-4">
    <div class="flex-row-center flex-gap-2">
      <ButtonIcon icon={IconBack} kind={'tertiary'} size={'small'} on:click={() => shiftWeek(-7)} />
      <ModernButton label={ui.string.Today} kind={'tertiary'} size={'small'} on:click={() => (weekMs = Date.now())} />
      <ButtonIcon icon={IconForward} kind={'tertiary'} size={'small'} on:click={() => shiftWeek(7)} />
      <div class="hulyHeader-divider short" />
      <div class="fs-title flex-row-center">
        {rangeFmt.format(week.days[0].date)} – {rangeFmt.format(week.days[6].date)}
      </div>
    </div>
    <div class="hrt-field">
      <EmployeeBox label={ygTimesheet.string.Employee} bind:value={employee} allowDeselect kind="regular" />
    </div>
  </div>

  {#if employee == null}
    <div class="hrt-empty"><Label label={ygTimesheet.string.NoEmployeeSelected} /></div>
  {:else}
    <div class="hrt-table-wrap">
      <table class="hrt-table">
        <thead>
          <tr>
            <th><Label label={ygTimesheet.string.Project} /></th>
            {#each week.days as d, i (d.key)}
              <th class="hrt-num" class:hrt-weekend={isWeekend(i)}>{dowFmt.format(d.date)}</th>
            {/each}
            <th class="hrt-num"><Label label={ygTimesheet.string.TotalHours} /></th>
          </tr>
        </thead>
        <tbody>
          {#if grid.rows.length === 0}
            <tr><td colspan={9} class="hrt-empty-row"><Label label={ygTimesheet.string.NoData} /></td></tr>
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
                  <td class="hrt-num" title={r.notesByDay[i]}>
                    {c === 0 ? '—' : formatHours(c)}
                    {#if r.notesByDay[i] !== undefined}
                      <span class="hrt-note-dot" title={r.notesByDay[i]}>●</span>
                    {/if}
                  </td>
                {/each}
                <td class="hrt-num"><b>{formatHours(r.rowTotal)}</b></td>
              </tr>
            {/each}
          {/if}
        </tbody>
        <tfoot>
          <tr class="hrt-totals">
            <td><Label label={ygTimesheet.string.TotalHours} /></td>
            {#each grid.dayTotals as t, i (i)}
              <td
                class="hrt-num"
                class:amber={!isWeekend(i) && t < DAY_TARGET}
                class:green={!isWeekend(i) && t >= DAY_TARGET}
              >
                {formatHours(t)}
              </td>
            {/each}
            <td class="hrt-num"><b>{formatHours(grid.grandTotal)}</b></td>
          </tr>
          <tr class="hrt-status-row">
            <td><Label label={ygTimesheet.string.Status} /></td>
            {#each statusRow as s, i (i)}
              <td class="hrt-num">
                {#if s !== ''}
                  <span class="hrt-pill hrt-pill--{s.toLowerCase()}">{s}</span>
                {:else}
                  <span class="hrt-muted">—</span>
                {/if}
              </td>
            {/each}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  {/if}
</div>

<style lang="scss">
  .hrt-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .hrt-field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 12rem; }
  .hrt-empty { color: var(--theme-darker-color); padding: 2rem; text-align: center; }
  .hrt-empty-row { color: var(--theme-darker-color); text-align: center; padding: 1.5rem; }
  .hrt-table-wrap { overflow: auto; flex: 1; padding: 1rem; }
  .hrt-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
  .hrt-table th {
    text-align: right; font-weight: 600; color: var(--theme-dark-color);
    padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--theme-divider-color); white-space: nowrap;
    position: sticky; top: 0; background: var(--theme-bg-color);
  }
  .hrt-table th:first-child { text-align: left; }
  .hrt-table td { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--theme-divider-color); vertical-align: top; }
  .hrt-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .hrt-weekend { color: var(--theme-darker-color); }
  .hrt-task { display: flex; flex-direction: column; gap: 0.0625rem; }
  .hrt-task__project { color: var(--theme-dark-color); font-size: 0.6875rem; }
  .hrt-task__id { color: var(--theme-dark-color); font-weight: 600; }
  .hrt-task__title { color: var(--theme-content-color); }
  .hrt-note-dot { color: var(--theme-link-color, var(--primary-button-default)); font-size: 0.5rem; margin-left: 0.1875rem; vertical-align: super; }
  .hrt-totals td { font-weight: 600; border-top: 2px solid var(--theme-divider-color); }
  .amber { color: var(--theme-warning-color); font-weight: 500; }
  .green { color: var(--theme-won-color); }
  .hrt-status-row td { border-top: none; padding-top: 0.25rem; }
  .hrt-pill {
    font-size: 0.6875rem; font-weight: 600; padding: 0.0625rem 0.375rem; border-radius: 0.75rem;
    background: var(--theme-button-default); color: var(--theme-content-color);
  }
  .hrt-pill--submitted { background: var(--theme-warning-color); color: #fff; }
  .hrt-pill--approved { background: var(--theme-won-color); color: #fff; }
  .hrt-pill--rejected { background: var(--theme-lost-color); color: #fff; }
  .hrt-muted { color: var(--theme-dark-color); }
</style>
