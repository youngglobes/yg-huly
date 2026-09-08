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
  import { Avatar } from '@hcengineering/contact-resources'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet, {
    type AttendanceSession, type HrTimeEntry, type LatePermission, type WorkProfile
  } from '@hcengineering/yg-timesheet'
  import { performanceRows, type PerfAtt, type PerfEmp, type PerfHours, type PerfLate, type PerfRow } from '../utils/performance'
  import SortableTh from './SortableTh.svelte'
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
  // Employee object by id, so the person cell can hand the full doc to <Avatar>.
  $: empById = new Map(empDocs.map((e) => [e._id, e]))
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

  // Late arrivals in the window - filtered on `date`, same idiom as attQuery/hoursQuery.
  const lateQuery = createQuery()
  let lateDocs: LatePermission[] = []
  $: lateQuery.query(
    ygTimesheet.class.LatePermission,
    { date: { $gte: fromMid, $lt: toExcl } },
    (res: LatePermission[]) => { lateDocs = res }
  )
  $: lates = lateDocs.map((p): PerfLate => ({ employee: p.employee, date: p.date, status: p.status }))

  $: now = Date.now()
  $: rows = performanceRows(emps, hours, atts, now, holidays, lates)

  // Column sorting: click a header to sort by it, click again to flip. Employee sorts by name
  // (ascending default); numeric columns default to descending (largest first). A name tiebreak
  // keeps ties stable.
  type SortKey =
    | 'name' | 'offDayDays' | 'offDayHours' | 'overtimeHours' | 'overtimeDays'
    | 'lateNightDays' | 'lateArrivals' | 'totalExtraHours'
  let sortKey: SortKey = 'name'
  let sortDir: 1 | -1 = 1
  function toggleSort (k: SortKey): void {
    if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1
    else { sortKey = k; sortDir = k === 'name' ? 1 : -1 }
  }
  function compareRows (a: PerfRow, b: PerfRow): number {
    let r = 0
    switch (sortKey) {
      case 'name': r = a.name.localeCompare(b.name); break
      case 'offDayDays': r = a.offDayDays - b.offDayDays; break
      case 'offDayHours': r = a.offDayHours - b.offDayHours; break
      case 'overtimeHours': r = a.overtimeHours - b.overtimeHours; break
      case 'overtimeDays': r = a.overtimeDays - b.overtimeDays; break
      case 'lateNightDays': r = a.lateNightDays - b.lateNightDays; break
      case 'lateArrivals': r = a.lateArrivals - b.lateArrivals; break
      case 'totalExtraHours': r = a.totalExtraHours - b.totalExtraHours; break
    }
    return r !== 0 ? r * sortDir : a.name.localeCompare(b.name)
  }
  $: sortedRows = [...rows].sort(compareRows)

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
    <div class="yg-table-wrap">
      <table class="yg-table">
        <thead>
          <tr>
            <SortableTh active={sortKey === 'name'} asc={sortDir === 1} on:click={() => toggleSort('name')}>
              <Label label={ygTimesheet.string.Employee} />
            </SortableTh>
            <SortableTh numeric active={sortKey === 'offDayDays'} asc={sortDir === 1} on:click={() => toggleSort('offDayDays')}>
              <Label label={ygTimesheet.string.OffDayWork} /> (<Label label={ygTimesheet.string.Days} />)
            </SortableTh>
            <SortableTh numeric active={sortKey === 'offDayHours'} asc={sortDir === 1} on:click={() => toggleSort('offDayHours')}>
              <Label label={ygTimesheet.string.OffDayWork} /> (<Label label={ygTimesheet.string.Hours} />)
            </SortableTh>
            <SortableTh numeric active={sortKey === 'overtimeHours'} asc={sortDir === 1} on:click={() => toggleSort('overtimeHours')}>
              <Label label={ygTimesheet.string.OvertimeCol} /> (<Label label={ygTimesheet.string.Hours} />)
            </SortableTh>
            <SortableTh numeric active={sortKey === 'overtimeDays'} asc={sortDir === 1} on:click={() => toggleSort('overtimeDays')}>
              <Label label={ygTimesheet.string.OvertimeCol} /> (<Label label={ygTimesheet.string.Days} />)
            </SortableTh>
            <SortableTh numeric active={sortKey === 'lateNightDays'} asc={sortDir === 1} on:click={() => toggleSort('lateNightDays')}>
              <Label label={ygTimesheet.string.LateNightCol} />
            </SortableTh>
            <SortableTh numeric active={sortKey === 'lateArrivals'} asc={sortDir === 1} on:click={() => toggleSort('lateArrivals')}>
              <Label label={ygTimesheet.string.LateArrivals} />
            </SortableTh>
            <SortableTh numeric active={sortKey === 'totalExtraHours'} asc={sortDir === 1} on:click={() => toggleSort('totalExtraHours')}>
              <Label label={ygTimesheet.string.TotalExtraHours} />
            </SortableTh>
          </tr>
        </thead>
        <tbody>
          {#each sortedRows as r (r.employee)}
            <tr class="yg-row perf-clickable" class:is-sel={r.employee === selectedId} on:click={() => (selectedId = r.employee)}>
              <td class="left">
                <div class="yg-person">
                  <Avatar person={empById.get(r.employee)} name={r.name} size={'small'} />
                  <div class="yg-person__text">
                    <div class="yg-person__name">{r.name}</div>
                    {#if r.designation}<div class="yg-person__sub">{r.designation}</div>{/if}
                  </div>
                </div>
              </td>
              <td class="yg-num">{r.offDayDays}</td>
              <td class="yg-num">{formatHours(r.offDayHours)}</td>
              <td class="yg-num">{formatHours(r.overtimeHours)}</td>
              <td class="yg-num">{r.overtimeDays}</td>
              <td class="yg-num">{r.lateNightDays}</td>
              <td class="yg-num">{r.lateArrivals}</td>
              <td class="yg-num bold">{formatHours(r.totalExtraHours)}</td>
            </tr>
          {:else}
            <tr><td colspan={8} class="yg-empty"><Label label={ygTimesheet.string.NoData} /></td></tr>
          {/each}
        </tbody>
      </table>
    </div>
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
