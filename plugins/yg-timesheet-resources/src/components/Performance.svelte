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
  Performance report: date-range ranking of off-day work / overtime / late-night hours per
  tracked employee (only those whose designation is in TRACKED_DESIGNATIONS - see
  utils/work-profile.ts). Reads HrTimeEntry + AttendanceSession + each employee's WorkProfile
  designation, hands them to the pure
  performanceRows lib (utils/performance.ts) and renders the ranked table. Read-only. Excel export.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet, {
    type AttendanceSession, type HrTimeEntry, type WorkProfile
  } from '@hcengineering/yg-timesheet'
  import { performanceRows, type PerfAtt, type PerfEmp, type PerfHours } from '../utils/performance'
  import { exportPerformanceXlsx } from '../utils/performance-xlsx'
  import { ensureHrMembership } from '../utils/hrMembership'
  import { formatHours, localDayKey } from '../utils/week'

  onMount(() => { void ensureHrMembership() })

  const client = getClient()
  const h = client.getHierarchy()

  // Date range: defaults to the trailing 12 months .. today. yyyy-mm-dd native inputs, same
  // fromKey/toKey/fromMid/toExcl idiom as HrAttendance.svelte.
  let fromKey = localDayKey(Date.now() - 365 * 86_400_000)
  let toKey = localDayKey(Date.now())
  $: fromMid = new Date(`${fromKey}T00:00:00`).getTime()
  $: toExcl = new Date(`${toKey}T00:00:00`).getTime() + 86_400_000 // inclusive `to`, exclusive query bound

  // Active employees + their (optional) WorkProfile designation.
  const empQuery = createQuery()
  let empDocs: Employee[] = []
  empQuery.query(contact.mixin.Employee, { active: true }, (res: Employee[]) => { empDocs = res })
  $: emps = empDocs.map((e): PerfEmp => ({
    id: e._id,
    name: formatName(e.name),
    designation: h.hasMixin(e, ygTimesheet.mixin.WorkProfile)
      ? (h.as(e, ygTimesheet.mixin.WorkProfile) as WorkProfile).designation
      : undefined
  }))

  // Logged hours in the window.
  const hoursQuery = createQuery()
  let hoursDocs: HrTimeEntry[] = []
  $: hoursQuery.query(
    ygTimesheet.class.HrTimeEntry,
    { date: { $gte: fromMid, $lt: toExcl } },
    (res: HrTimeEntry[]) => { hoursDocs = res }
  )
  $: hours = hoursDocs.map((d): PerfHours => ({ employee: d.employee, hours: d.hours, date: d.date }))

  // Attendance sessions in the window - filtered on the day-bucket `date` field, matching how
  // HrDashboard.svelte queries AttendanceSession.
  const attQuery = createQuery()
  let attDocs: AttendanceSession[] = []
  $: attQuery.query(
    ygTimesheet.class.AttendanceSession,
    { date: { $gte: fromMid, $lt: toExcl } },
    (res: AttendanceSession[]) => { attDocs = res }
  )
  $: atts = attDocs.map((d): PerfAtt => ({ employee: d.employee, punchIn: d.punchIn, punchOut: d.punchOut }))

  // Holidays - no date filter, load all holidays to apply to any date range.
  const holQuery = createQuery()
  let holidayDates: number[] = []
  holQuery.query(ygTimesheet.class.Holiday, {}, (res) => { holidayDates = res.map((h) => h.date) })
  $: holidays = new Set<number>(holidayDates)

  $: now = Date.now()
  $: rows = performanceRows(emps, hours, atts, now, holidays)

  // Drill-down: the row whose flagged days are shown in the slide-in panel. Tracked by id so it
  // survives a rows recompute (date-range change) and auto-closes if the person drops out.
  let selectedId: string | undefined
  $: selected = selectedId !== undefined ? rows.find((r) => r.employee === selectedId) : undefined

  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  function fmtPunch (inMs: number | undefined, outMs: number | undefined): string {
    if (inMs === undefined) return ''
    return outMs === undefined ? `${timeFmt.format(inMs)} -> ...` : `${timeFmt.format(inMs)} -> ${timeFmt.format(outMs)}`
  }

  let exporting = false
  async function doExport (): Promise<void> {
    exporting = true
    try {
      await exportPerformanceXlsx(rows, fromMid, toExcl)
    } catch (err: any) {
      await setPlatformStatus(unknownError(err))
    } finally {
      exporting = false
    }
  }
</script>

<div class="dash yg-page">
  <div class="yg-head">
    <h1 class="yg-title"><Label label={ygTimesheet.string.Performance} /></h1>
    <div class="yg-weekbar">
      <span class="perf-range">
        <input class="yg-input" type="date" bind:value={fromKey} />
        <span class="perf-range__sep">-</span>
        <input class="yg-input" type="date" bind:value={toKey} />
      </span>
      <span class="yg-weekbar__spacer" />
      <button class="yg-btn yg-btn--primary" disabled={exporting} on:click={doExport}>
        <Label label={ygTimesheet.string.Export} />
      </button>
    </div>
  </div>

  <div class="yg-scroll">
    <table class="yg-table">
      <thead>
        <tr>
          <th class="left"><Label label={ygTimesheet.string.Employee} /></th>
          <th class="left"><Label label={ygTimesheet.string.Designation} /></th>
          <th class="yg-num"><Label label={ygTimesheet.string.OffDayWork} /> (<Label label={ygTimesheet.string.Days} />)</th>
          <th class="yg-num"><Label label={ygTimesheet.string.OffDayWork} /> (<Label label={ygTimesheet.string.Hours} />)</th>
          <th class="yg-num"><Label label={ygTimesheet.string.OvertimeCol} /> (<Label label={ygTimesheet.string.Hours} />)</th>
          <th class="yg-num"><Label label={ygTimesheet.string.OvertimeCol} /> (<Label label={ygTimesheet.string.Days} />)</th>
          <th class="yg-num"><Label label={ygTimesheet.string.LateNightCol} /></th>
          <th class="yg-num"><Label label={ygTimesheet.string.TotalExtraHours} /></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.employee)}
          <tr class="yg-row perf-clickable" class:is-sel={r.employee === selectedId} on:click={() => (selectedId = r.employee)}>
            <td class="left bold">{r.name}</td>
            <td class="left">{r.designation ?? '-'}</td>
            <td class="yg-num">{r.offDayDays}</td>
            <td class="yg-num">{formatHours(r.offDayHours)}</td>
            <td class="yg-num">{formatHours(r.overtimeHours)}</td>
            <td class="yg-num">{r.overtimeDays}</td>
            <td class="yg-num">{r.lateNightDays}</td>
            <td class="yg-num bold">{formatHours(r.totalExtraHours)}</td>
          </tr>
        {:else}
          <tr><td colspan={8} class="yg-empty"><Label label={ygTimesheet.string.NoData} /></td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if selected}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="perf-backdrop" on:click={() => (selectedId = undefined)} />
    <aside class="perf-panel">
      <div class="perf-panel__head">
        <span class="perf-panel__name">{selected.name}</span>
        <button class="perf-panel__close" aria-label="Close" on:click={() => (selectedId = undefined)}>x</button>
      </div>
      {#if selected.days.length === 0}
        <div class="perf-panel__empty">No off-day, overtime, or late-night days in this range.</div>
      {:else}
        <div class="perf-panel__list">
          {#each selected.days as d (d.date)}
            <div class="perf-day">
              <div class="perf-day__date">{dayFmt.format(d.date)}</div>
              <div class="perf-day__chips">
                {#if d.offDay}<span class="perf-chip perf-chip--off">Off-day</span>{/if}
                {#if d.overtimeHours > 0}<span class="perf-chip perf-chip--ot">OT +{formatHours(d.overtimeHours)}</span>{/if}
                {#if d.lateNight}<span class="perf-chip perf-chip--late">Late night</span>{/if}
              </div>
              <div class="perf-day__meta">
                {#if d.workedHours > 0}<span class="perf-day__hrs">{formatHours(d.workedHours)}</span>{/if}
                {#if d.punchIn !== undefined}<span class="perf-day__punch">{fmtPunch(d.punchIn, d.punchOut)}</span>{/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </aside>
  {/if}
</div>

<style lang="scss">
  @use './yg-table' as *;
  // See HrDashboard.svelte: this special has no navigator, so the page needs flex:1 to fill
  // the app pane instead of shrinking to content width.
  .dash { flex: 1; min-width: 0; }
  .perf-range { display: inline-flex; align-items: center; gap: 8px; }
  .perf-range__sep { color: var(--yg-text-faint); }

  .perf-clickable { cursor: pointer; }
  .perf-clickable.is-sel { background: var(--yg-panel-soft); }

  .perf-backdrop {
    position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.18);
  }
  .perf-panel {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 41; width: 360px; max-width: 92vw;
    display: flex; flex-direction: column;
    background: var(--yg-panel); border-left: 1px solid var(--yg-border); box-shadow: var(--yg-shadow);
    overflow: hidden;
  }
  .perf-panel__head {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 16px; border-bottom: 1px solid var(--yg-border);
  }
  .perf-panel__name { font-weight: 660; font-size: 15px; color: var(--yg-text); flex: 1; }
  .perf-panel__close {
    border: 1px solid var(--yg-border); background: var(--yg-panel); color: var(--yg-text-dim);
    width: 26px; height: 26px; border-radius: 7px; cursor: pointer; line-height: 1;
  }
  .perf-panel__close:hover { color: var(--yg-text); }
  .perf-panel__empty { padding: 18px 16px; color: var(--yg-text-faint); font-size: 13px; }
  .perf-panel__list { overflow: auto; padding: 8px 0; }

  .perf-day { padding: 10px 16px; border-bottom: 1px solid var(--yg-border); }
  .perf-day__date { font-weight: 600; font-size: 13px; color: var(--yg-text); }
  .perf-day__chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 4px; }
  .perf-chip {
    font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
    border: 1px solid var(--yg-border); color: var(--yg-text-dim);
  }
  .perf-chip--off { background: var(--yg-amber-bg, transparent); }
  .perf-chip--ot { background: var(--yg-panel-soft); }
  .perf-chip--late { background: var(--yg-red-bg, transparent); color: var(--yg-text); }
  .perf-day__meta { display: flex; gap: 12px; font-size: 12px; color: var(--yg-text-dim); font-variant-numeric: tabular-nums; }
</style>
