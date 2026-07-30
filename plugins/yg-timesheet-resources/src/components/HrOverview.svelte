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
  HR overview sub-module: an all-employees weekly grid (rows = active employees, columns =
  Mon-Sun) built from the projected HrTimeEntry data, with a Week-total column, a completeness
  Status column, and org-wide daily/grand totals. Styled to match the stock HR "Schedule" chrome
  (Header + Breadcrumb + hulyHeader-container nav row). Mirrors HrTimesheet.svelte's query/week
  conventions and reuses its amber/green cell-coloring tokens so both grids agree visually.
-->
<script lang="ts">
  import contact, { formatName, type Employee, type Person } from '@hcengineering/contact'
  import { Avatar, employeeByIdStore } from '@hcengineering/contact-resources'
  import { type Ref } from '@hcengineering/core'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import ui, {
    getCurrentLocation,
    IconBack,
    IconForward,
    Label,
    navigate,
    showPopup
  } from '@hcengineering/ui'
  import ygTimesheet, { type HrTimeEntry } from '@hcengineering/yg-timesheet'
  import HrExportDialog from './HrExportDialog.svelte'
  import { buildOverviewGrid } from '../utils/hr-report'
  import { exportOverviewXlsx } from '../utils/hr-xlsx'
  import { ensureHrMembership } from '../utils/hrMembership'
  import { hrSelectedEmployee } from '../utils/hrStore'
  import { weekPeriod, type Period } from '../utils/period'
  import { formatHours, weekRange } from '../utils/week'

  void ensureHrMembership()

  const client = getClient()

  let exporting = false

  const DAY_TARGET = 8 // hours/day, weekdays

  let weekMs = Date.now()
  $: week = weekRange(weekMs)
  function shiftWeek (deltaDays: number): void {
    const d = new Date(weekMs)
    d.setDate(d.getDate() + deltaDays)
    weekMs = d.getTime()
  }

  // Active employees (rows). Overview shows everyone active, regardless of whether they've
  // logged time this week, so zero-hour employees still surface as "under target".
  const empQuery = createQuery()
  let employees: Array<{ ref: Ref<Person>, name: string }> = []
  empQuery.query(contact.mixin.Employee, { active: true }, (res: Employee[]) => {
    employees = res.map((e) => ({ ref: e._id, name: formatName(e.name) }))
  })

  // HR entries for the whole org, selected week (from the private HR space).
  const entryQuery = createQuery()
  let entries: HrTimeEntry[] = []
  $: entryQuery.query(ygTimesheet.class.HrTimeEntry, {
    space: ygTimesheet.space.HrData,
    date: { $gte: week.start, $lt: week.end }
  }, (res: HrTimeEntry[]) => {
    entries = res
  })

  $: viewPeriod = weekPeriod(week.start)
  $: rows = buildOverviewGrid(entries, employees, viewPeriod, DAY_TARGET)

  // Org-wide daily + grand totals across all rows.
  $: dailyTotals = [0, 1, 2, 3, 4, 5, 6].map((i) => rows.reduce((sum, r) => sum + r.days[i], 0))
  $: grandTotal = rows.reduce((sum, r) => sum + r.total, 0)

  const dowFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
  const rangeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
  $: dayHeaders = week.days.map((d) => dowFmt.format(d.date))
  $: weekLabel = `${rangeFmt.format(week.days[0].date)} – ${rangeFmt.format(week.days[6].date)}`

  // Hands the clicked employee off to the Timesheets sub-module via the shared store, then
  // navigates there. The HR app's specials (timesheets/overview/roster) live at path[3] —
  // the same segment `getTabDataByLocation` reads via `application.navigatorModel.specials`
  // (see plugins/workbench-resources/src/workbench.ts) and the same segment `doNavigate`'s
  // 'special' mode sets (plugins/workbench-resources/src/utils.ts) — so this follows that
  // convention rather than SpecialElement/NavLink's space-nested path[4], which doesn't apply
  // here since the HR app's specials aren't nested under a space.
  function selectEmployee (ref: Ref<Person>): void {
    hrSelectedEmployee.set(ref)
    const loc = getCurrentLocation()
    loc.path[3] = 'timesheets'
    loc.path.length = 4
    navigate(loc)
  }

  // Non-linking avatar lookup for the Overview name cell (see below) — reads the same
  // employeeByIdStore that EmployeePresenter/Avatar use internally.
  function employeeFor (ref: Ref<Person>): Employee | undefined {
    return $employeeByIdStore.get(ref as Ref<Employee>)
  }

  function openExport (): void {
    showPopup(HrExportDialog, { anchorMs: week.start }, undefined, (period?: Period) => {
      if (period !== undefined) void runExport(period)
    })
  }

  async function runExport (period: Period): Promise<void> {
    exporting = true
    try {
      // One-shot fetch over the chosen period. Deliberately NOT the live weekly subscription —
      // the grid on screen must keep showing the week the user is looking at.
      const rows = await client.findAll(ygTimesheet.class.HrTimeEntry, {
        space: ygTimesheet.space.HrData,
        date: { $gte: period.start, $lt: period.end }
      })
      const grid = buildOverviewGrid(rows, employees, period, DAY_TARGET)
      // .xlsx with real time-typed cells (see utils/hr-xlsx); write-excel-file triggers the download.
      await exportOverviewXlsx(grid, period)
    } catch (err: any) {
      // Surface the failure rather than letting the promise reject unhandled — and download
      // nothing, so the user never receives a half-built file they might forward on.
      await setPlatformStatus(unknownError(err))
    } finally {
      exporting = false
    }
  }
</script>

<div class="yg-page">
  <div class="yg-head">
    <h1 class="yg-title"><Label label={ygTimesheet.string.HrOverview} /></h1>
    <div class="yg-weekbar">
      <button class="yg-weekbar__nav" aria-label="Previous week" on:click={() => shiftWeek(-7)}>
        <IconBack size="small" />
      </button>
      <button class="yg-weekbar__today" on:click={() => (weekMs = Date.now())}><Label label={ui.string.Today} /></button>
      <span class="yg-weekbar__range">{weekLabel}</span>
      <button class="yg-weekbar__nav" aria-label="Next week" on:click={() => shiftWeek(7)}>
        <IconForward size="small" />
      </button>
      <span class="yg-weekbar__spacer" />
      <button class="yg-btn yg-btn--primary" disabled={exporting} on:click={openExport}>
        <Label label={ygTimesheet.string.Export} />
      </button>
    </div>
  </div>
  <div class="yg-scroll">
    <table class="yg-table">
      <thead>
        <tr>
          <th class="left"><Label label={ygTimesheet.string.Employee} /></th>
          {#each dayHeaders as d, i (i)}
            <th>{d}</th>
          {/each}
          <th><Label label={ygTimesheet.string.Week} /></th>
          <th><Label label={ygTimesheet.string.Status} /></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.employee)}
          <tr class="yg-row" on:click={() => selectEmployee(r.employee)}>
            <td class="left">
              <div class="flex-row-center flex-gap-2">
                <Avatar size={'x-small'} person={employeeFor(r.employee)} name={r.name} />
                <span class="overflow-label">{r.name}</span>
              </div>
            </td>
            {#each r.days as h, i (i)}
              <td class:yg-amber={i < 5 && h < DAY_TARGET} class:yg-green={i < 5 && h >= DAY_TARGET}>
                {h > 0 ? formatHours(h) : '·'}
              </td>
            {/each}
            <td class="bold">{formatHours(r.total)}</td>
            <td class="left">
              {#if r.complete}
                <span class="yg-tag yg-tag--approved"><span class="tick" />Complete</span>
              {:else}
                <span class="yg-tag yg-tag--submitted"><span class="tick" />Under {formatHours(r.shortfall)}</span>
              {/if}
            </td>
          </tr>
        {:else}
          <tr><td colspan={10} class="yg-empty"><Label label={ygTimesheet.string.NoData} /></td></tr>
        {/each}
      </tbody>
      <tfoot>
        <tr class="yg-totals">
          <td class="left"><Label label={ygTimesheet.string.Total} /></td>
          {#each dailyTotals as t, i (i)}
            <td class:yg-amber={i < 5 && t < DAY_TARGET} class:yg-green={i < 5 && t >= DAY_TARGET}>{formatHours(t)}</td>
          {/each}
          <td class="bold">{formatHours(grandTotal)}</td>
          <td />
        </tr>
      </tfoot>
    </table>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;

  // This grid's rows ARE clickable (selectEmployee, on:click above) — the shared
  // `:global(.yg-row:hover)` rule only highlights; add the pointer cursor back locally here.
  .yg-row:hover {
    cursor: pointer;
  }
</style>
