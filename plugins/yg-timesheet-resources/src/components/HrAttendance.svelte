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
  HR attendance report: one page, three modes (Today live board / All-employees summary /
  Individual session log). Reads AttendanceSession directly from the shared core.space.Workspace
  (world-readable; no HR projection). Read-only. Excel export per mode. Mirrors HrOverview chrome.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import contact, { formatName, getCurrentEmployee, type Employee, type Person } from '@hcengineering/contact'
  import { EmployeeBox } from '@hcengineering/contact-resources'
  import core, { type Ref } from '@hcengineering/core'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet, { type AttendanceSession } from '@hcengineering/yg-timesheet'
  import {
    todayBoard,
    attendanceSummary,
    individualLog,
    type SessionLike,
    type EmpRef
  } from '../utils/hr-attendance'
  import { exportTodayXlsx, exportSummaryXlsx, exportIndividualXlsx } from '../utils/hr-attendance-xlsx'
  import { ensureHrMembership } from '../utils/hrMembership'
  import { localMidnight } from '../utils/attendance'
  import { formatHours, localDayKey, weekRange } from '../utils/week'

  void ensureHrMembership()

  type Mode = 'today' | 'all' | 'individual'
  let mode: Mode = 'today'

  // Live clock so the Today board totals/open sessions tick.
  let nowMs = Date.now()
  let timer: ReturnType<typeof setInterval>
  onMount(() => {
    timer = setInterval(() => (nowMs = Date.now()), 1000)
  })
  onDestroy(() => clearInterval(timer))

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const fmt = (ms?: number): string => (ms !== undefined ? timeFmt.format(ms) : '-')

  // Date range (period modes). Defaults to this week (Monday .. today). yyyy-mm-dd native inputs.
  let fromKey = localDayKey(weekRange(Date.now()).start)
  let toKey = localDayKey(Date.now())
  $: fromMid = new Date(`${fromKey}T00:00:00`).getTime()
  $: toExcl = new Date(`${toKey}T00:00:00`).getTime() + 86_400_000 // inclusive `to`, exclusive query bound
  function today (): void {
    fromKey = toKey = localDayKey(Date.now())
  }
  function thisWeek (): void {
    fromKey = localDayKey(weekRange(Date.now()).start)
    toKey = localDayKey(Date.now())
  }
  function thisMonth (): void {
    const d = new Date()
    fromKey = localDayKey(new Date(d.getFullYear(), d.getMonth(), 1).getTime())
    toKey = localDayKey(Date.now())
  }

  // EmployeeBox binds a Ref<Person>; the aggregation keys on Ref<Employee> (same _id). Keep the
  // bound value as Ref<Person> and cast at the individualLog / nameOf boundary.
  const me = getCurrentEmployee()
  let selectedEmployee: Ref<Person> | undefined = me as Ref<Person>
  $: selectedEmp = selectedEmployee as unknown as Ref<Employee> | undefined

  // Active employees -> EmpRef[] name source.
  const empQuery = createQuery()
  let employees: EmpRef[] = []
  let nameOf: Map<Ref<Employee>, string> = new Map()
  empQuery.query(contact.mixin.Employee, { active: true }, (res: Employee[]) => {
    employees = res.map((e) => ({ ref: e._id, name: formatName(e.name) }))
    nameOf = new Map(employees.map((e) => [e.ref, e.name]))
  })

  // The queried window: today for the board, else the selected range.
  $: todayMid = localMidnight(nowMs)
  $: queryFrom = mode === 'today' ? todayMid : fromMid
  $: queryTo = mode === 'today' ? todayMid + 86_400_000 : toExcl

  // Live sessions in the window (shared, world-readable space).
  const sessQuery = createQuery()
  let sessions: SessionLike[] = []
  $: sessQuery.query(
    ygTimesheet.class.AttendanceSession,
    { space: core.space.Workspace, date: { $gte: queryFrom, $lt: queryTo } },
    (res: AttendanceSession[]) => {
      sessions = res.map((s) => ({
        employee: s.employee,
        date: s.date,
        punchIn: s.punchIn,
        punchOut: s.punchOut,
        mode: s.mode,
        punchInNote: s.punchInNote,
        punchOutNote: s.punchOutNote,
        device: s.device,
        browser: s.browser,
        ip: s.ip,
        ipCity: s.ipCity,
        geoLat: s.geoLat,
        geoLng: s.geoLng
      }))
    }
  )

  $: todayRows = todayBoard(sessions, employees, todayMid, nowMs)
  $: summaryRows = attendanceSummary(sessions, employees, fromMid, toExcl, nowMs)
  $: individual = selectedEmp !== undefined
    ? individualLog(sessions, selectedEmp, fromMid, toExcl, nowMs)
    : { days: [], summary: { daysPresent: 0, totalMs: 0, officeMs: 0, wfhMs: 0 } }

  $: summaryTotals = summaryRows.reduce(
    (acc, r) => ({
      totalMs: acc.totalMs + r.totalMs,
      officeMs: acc.officeMs + r.officeMs,
      wfhMs: acc.wfhMs + r.wfhMs
    }),
    { totalMs: 0, officeMs: 0, wfhMs: 0 }
  )

  let exporting = false
  async function doExport (): Promise<void> {
    exporting = true
    try {
      if (mode === 'today') await exportTodayXlsx(todayRows)
      else if (mode === 'all') await exportSummaryXlsx(summaryRows, fromMid, toExcl)
      else await exportIndividualXlsx(individual, (selectedEmp !== undefined ? nameOf.get(selectedEmp) : undefined) ?? 'employee', fromMid, toExcl)
    } catch (err: any) {
      await setPlatformStatus(unknownError(err))
    } finally {
      exporting = false
    }
  }
</script>

<div class="yg-page">
  <div class="yg-head">
    <h1 class="yg-title"><Label label={ygTimesheet.string.HrAttendance} /></h1>
    <div class="yg-weekbar">
      <div class="att-seg" role="group">
        <button class="att-seg__opt" class:is-on={mode === 'today'} on:click={() => (mode = 'today')}>
          <Label label={ygTimesheet.string.Today} />
        </button>
        <button class="att-seg__opt" class:is-on={mode === 'all'} on:click={() => (mode = 'all')}>
          <Label label={ygTimesheet.string.AllEmployees} />
        </button>
        <button class="att-seg__opt" class:is-on={mode === 'individual'} on:click={() => (mode = 'individual')}>
          <Label label={ygTimesheet.string.Individual} />
        </button>
      </div>

      {#if mode !== 'today'}
        <span class="att-range">
          <input class="att-date" type="date" bind:value={fromKey} />
          <span class="att-range__sep">-</span>
          <input class="att-date" type="date" bind:value={toKey} />
          <button class="att-preset" on:click={today}><Label label={ygTimesheet.string.Today} /></button>
          <button class="att-preset" on:click={thisWeek}><Label label={ygTimesheet.string.Week} /></button>
          <button class="att-preset" on:click={thisMonth}><Label label={ygTimesheet.string.Month} /></button>
        </span>
      {/if}

      {#if mode === 'individual'}
        <span class="att-empbox">
          <EmployeeBox
            label={ygTimesheet.string.Employee}
            bind:value={selectedEmployee}
            allowDeselect={false}
            kind="regular"
          />
        </span>
      {/if}

      <span class="yg-weekbar__spacer" />
      <button class="yg-btn yg-btn--primary" disabled={exporting} on:click={doExport}>
        <Label label={ygTimesheet.string.Export} />
      </button>
    </div>
  </div>

  <div class="yg-scroll">
    {#if mode === 'today'}
      <table class="yg-table">
        <thead>
          <tr>
            <th class="left"><Label label={ygTimesheet.string.Employee} /></th>
            <th><Label label={ygTimesheet.string.Status} /></th>
            <th><Label label={ygTimesheet.string.FirstIn} /></th>
            <th><Label label={ygTimesheet.string.LastOut} /></th>
            <th><Label label={ygTimesheet.string.Sessions} /></th>
            <th><Label label={ygTimesheet.string.TotalHours} /></th>
            <th><Label label={ygTimesheet.string.Type} /></th>
          </tr>
        </thead>
        <tbody>
          {#each todayRows as r (r.employee)}
            <tr class="yg-row">
              <td class="left">{r.name}</td>
              <td>
                {#if r.status === 'in'}
                  <span class="att-live"><span class="att-dot" /><Label label={ygTimesheet.string.InNow} /></span>
                {:else}
                  <Label label={ygTimesheet.string.Out} />
                {/if}
              </td>
              <td>{fmt(r.firstIn)}</td>
              <td>{fmt(r.lastOut)}</td>
              <td>{r.sessions}</td>
              <td class="bold">{formatHours(r.totalMs / 3600000)}</td>
              <td><Label label={r.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} /></td>
            </tr>
          {:else}
            <tr><td colspan={7} class="yg-empty"><Label label={ygTimesheet.string.NoData} /></td></tr>
          {/each}
        </tbody>
      </table>

    {:else if mode === 'all'}
      <table class="yg-table">
        <thead>
          <tr>
            <th class="left"><Label label={ygTimesheet.string.Employee} /></th>
            <th><Label label={ygTimesheet.string.DaysPresent} /></th>
            <th><Label label={ygTimesheet.string.TotalHours} /></th>
            <th><Label label={ygTimesheet.string.OfficeHours} /></th>
            <th><Label label={ygTimesheet.string.WfhHours} /></th>
          </tr>
        </thead>
        <tbody>
          {#each summaryRows as r (r.employee)}
            <tr class="yg-row">
              <td class="left">{r.name}</td>
              <td>{r.daysPresent}</td>
              <td class="bold">{formatHours(r.totalMs / 3600000)}</td>
              <td>{formatHours(r.officeMs / 3600000)}</td>
              <td>{formatHours(r.wfhMs / 3600000)}</td>
            </tr>
          {:else}
            <tr><td colspan={5} class="yg-empty"><Label label={ygTimesheet.string.NoData} /></td></tr>
          {/each}
        </tbody>
        <tfoot>
          <tr class="yg-totals">
            <td class="left"><Label label={ygTimesheet.string.Total} /></td>
            <td />
            <td class="bold">{formatHours(summaryTotals.totalMs / 3600000)}</td>
            <td>{formatHours(summaryTotals.officeMs / 3600000)}</td>
            <td>{formatHours(summaryTotals.wfhMs / 3600000)}</td>
          </tr>
        </tfoot>
      </table>

    {:else}
      <div class="att-summary">
        <span class="att-summary__k"><Label label={ygTimesheet.string.DaysPresent} />: <b>{individual.summary.daysPresent}</b></span>
        <span class="att-summary__k"><Label label={ygTimesheet.string.TotalHours} />: <b>{formatHours(individual.summary.totalMs / 3600000)}</b></span>
        <span class="att-summary__k"><Label label={ygTimesheet.string.OfficeHours} />: <b>{formatHours(individual.summary.officeMs / 3600000)}</b></span>
        <span class="att-summary__k"><Label label={ygTimesheet.string.WfhHours} />: <b>{formatHours(individual.summary.wfhMs / 3600000)}</b></span>
      </div>
      <table class="yg-table">
        <thead>
          <tr>
            <th class="left"><Label label={ygTimesheet.string.Date} /></th>
            <th><Label label={ygTimesheet.string.In} /></th>
            <th><Label label={ygTimesheet.string.Out} /></th>
            <th><Label label={ygTimesheet.string.Type} /></th>
            <th><Label label={ygTimesheet.string.Duration} /></th>
            <th><Label label={ygTimesheet.string.Details} /></th>
          </tr>
        </thead>
        <tbody>
          {#each individual.days as day (day.date)}
            {#each day.sessions as s, i (s.punchIn)}
              <tr class="yg-row">
                <td class="left">{i === 0 ? dateFmt.format(day.date) : ''}</td>
                <td>{timeFmt.format(s.punchIn)}{#if s.punchInNote}<span class="att-note"> · {s.punchInNote}</span>{/if}</td>
                <td>{#if s.punchOut !== undefined}{timeFmt.format(s.punchOut)}{#if s.punchOutNote}<span class="att-note"> · {s.punchOutNote}</span>{/if}{:else}-{/if}</td>
                <td><Label label={s.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} /></td>
                <td>{s.punchOut !== undefined ? formatHours((s.punchOut - s.punchIn) / 3600000) : '-'}</td>
                <td class="att-audit">
                  <div class="att-audit__line">{s.device ?? '-'}{#if s.browser} / {s.browser}{/if}</div>
                  <div class="att-audit__line att-audit__muted">{s.ip ?? '-'}{#if s.ipCity} - {s.ipCity}{/if}</div>
                  {#if s.geoLat !== undefined && s.geoLng !== undefined}
                    <a class="att-audit__map" href={`https://maps.google.com/?q=${s.geoLat},${s.geoLng}`} target="_blank" rel="noopener noreferrer">Map</a>
                  {/if}
                </td>
              </tr>
            {/each}
          {:else}
            <tr><td colspan={6} class="yg-empty"><Label label={ygTimesheet.string.NoData} /></td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;

  .att-seg { display: inline-flex; padding: 3px; gap: 3px; background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 9px; }
  .att-seg__opt { appearance: none; border: 0; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 6px; background: transparent; color: var(--yg-text-dim); }
  .att-seg__opt:hover { color: var(--yg-text); }
  .att-seg__opt.is-on { background: var(--yg-ink); color: var(--yg-ink-fg); box-shadow: var(--yg-shadow); }

  .att-range { display: inline-flex; align-items: center; gap: 8px; }
  .att-range__sep { color: var(--yg-text-faint); }
  .att-date { appearance: none; font: inherit; font-size: 13px; color: var(--yg-text); background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 8px; padding: 5px 9px; }
  // Quick period presets ("Today"/"Month"): soft pill buttons matching the date inputs (base .yg-btn
  // is border/background-less, so it rendered as bare text here).
  .att-preset { appearance: none; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; color: var(--yg-text-dim); background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 8px; padding: 5px 12px; }
  .att-preset:hover { color: var(--yg-text); border-color: var(--yg-border-strong); }
  .att-empbox { display: inline-flex; align-items: center; }

  .att-live { display: inline-flex; align-items: center; gap: 6px; color: var(--yg-green); font-weight: 600; }
  .att-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--yg-green); }
  .att-note { color: var(--yg-text-faint); }

  .att-summary { display: flex; flex-wrap: wrap; gap: 18px; padding: 4px 2px 14px; font-size: 13px; color: var(--yg-text-dim); }
  .att-summary__k b { color: var(--yg-text); font-variant-numeric: tabular-nums; }

  .att-audit__line { font-size: 13px; }
  .att-audit__muted { color: var(--yg-text-faint); font-size: 12px; }
</style>
