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
  Employee dashboard: today's attendance at a glance. Presentational only - no queries, no punch
  actions (those live on the Attendance app itself). The parent EmployeeDashboard supplies the
  live numbers as plain props, same split as PriorityWatch/OverdueList.
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet, { type AttendanceMode, type AttendanceSession } from '@hcengineering/yg-timesheet'
  import { buildDayTimeline, formatDuration, localMidnight } from '../../utils/attendance'

  export let open: boolean
  export let mode: AttendanceMode | undefined
  export let todayMs: number
  export let sessions: number
  export let firstIn: number | undefined
  // Today's raw sessions + a live clock, for the punch-in/out timeline.
  export let todaySessions: AttendanceSession[] = []
  export let now: number = Date.now()

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

  // Timeline of today's sessions. Window is driven purely by the punches (startHour=24/endHour=0
  // disables the default padding), so it fits ANY shift with no special-casing: first punch to
  // now/last punch. A 9-6 day and a 3pm-1am night shift each get their own tight axis.
  $: timeline = buildDayTimeline(todaySessions, localMidnight(now), now, 24, 0)
</script>

<div class="mac">
  <div class="mac__title"><Label label={ygTimesheet.string.MyAttendanceToday} /></div>

  <div class="mac__status">
    {#if open}
      <span class="mac__badge mac__badge--on"><span class="mac__dot" /><Label label={ygTimesheet.string.OnTheClock} /></span>
      {#if mode !== undefined}
        <span class="mac__mode"><Label label={mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} /></span>
      {/if}
    {:else}
      <span class="mac__badge"><span class="mac__dot" /><Label label={ygTimesheet.string.NotPunchedIn} /></span>
    {/if}
  </div>

  <div class="mac__total">{formatDuration(todayMs)}</div>

  {#if todaySessions.length > 0}
    <div class="mac__tl">
      <div class="mac__track">
        {#each timeline.blocks as b, i (i)}
          <span class="mac__blk" class:is-wfh={b.mode === 'wfh'} class:is-open={b.open} style="left:{b.leftPct}%; width:{b.widthPct}%" />
        {/each}
        {#if timeline.nowPct !== undefined}<span class="mac__now" style="left:{timeline.nowPct}%" />{/if}
      </div>
      <div class="mac__tl-lbl">
        <span>{timeFmt.format(timeline.startMs)}</span>
        <span>{timeFmt.format(timeline.endMs)}</span>
      </div>
    </div>
  {:else}
    <div class="mac__none">No sessions yet today.</div>
  {/if}

  <div class="mac__grid">
    <div class="mac__stat">
      <span class="mac__k"><Label label={ygTimesheet.string.Sessions} /></span>
      <span class="mac__v">{sessions}</span>
    </div>
    <div class="mac__stat">
      <span class="mac__k"><Label label={ygTimesheet.string.FirstIn} /></span>
      <span class="mac__v">{firstIn !== undefined ? timeFmt.format(firstIn) : '--'}</span>
    </div>
  </div>
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .mac {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 14px 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .mac__title { font-size: 13px; font-weight: 680; color: var(--yg-text); }
  .mac__status { display: flex; align-items: center; gap: 8px; }
  .mac__badge {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12px; font-weight: 650; color: var(--yg-text-dim);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .mac__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--yg-text-faint); }
  .mac__badge--on { color: var(--yg-green); }
  .mac__badge--on .mac__dot { background: var(--yg-green); }
  .mac__mode {
    font-size: 11px; font-weight: 700; color: var(--yg-text-dim);
    background: var(--yg-panel-soft); border: 1px solid var(--yg-border);
    border-radius: 999px; padding: 1px 8px;
  }
  .mac__total {
    font-size: 28px; font-weight: 720; letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums; color: var(--yg-text);
  }
  // Session timeline: bars positioned on a per-person window (first punch to now/last punch).
  .mac__tl { display: flex; flex-direction: column; gap: 6px; }
  .mac__track { position: relative; height: 26px; border-radius: 8px; background: var(--yg-panel-soft); border: 1px solid var(--yg-border); }
  .mac__blk { position: absolute; top: 6px; height: 12px; min-width: 4px; border-radius: 4px; background: #6366f1; }
  .mac__blk.is-wfh { background: #14b8a6; }
  .mac__blk.is-open { opacity: 0.85; box-shadow: 0 0 0 2px var(--yg-panel-soft), 0 0 0 3px currentColor; }
  .mac__now { position: absolute; top: 2px; bottom: 2px; width: 2px; background: var(--yg-ink); transform: translateX(-1px); border-radius: 2px; }
  .mac__tl-lbl { display: flex; justify-content: space-between; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--yg-text-faint); }
  .mac__none { font-size: 12px; color: var(--yg-text-faint); }
  .mac__grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: auto; }
  .mac__stat {
    display: flex; flex-direction: column; gap: 2px; padding: 8px 10px;
    background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 8px;
  }
  .mac__k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 650; color: var(--yg-text-faint); }
  .mac__v { font-size: 14px; font-weight: 680; font-variant-numeric: tabular-nums; color: var(--yg-text); }
</style>
