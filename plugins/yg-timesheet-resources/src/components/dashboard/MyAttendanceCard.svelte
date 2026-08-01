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
  import ygTimesheet, { type AttendanceMode } from '@hcengineering/yg-timesheet'
  import { formatDuration } from '../../utils/attendance'

  export let open: boolean
  export let mode: AttendanceMode | undefined
  export let todayMs: number
  export let sessions: number
  export let firstIn: number | undefined

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

  // Progress toward a standard 8h working day - fills the card and gives the total context.
  const STANDARD_MS = 8 * 60 * 60 * 1000
  $: pct = Math.min(100, Math.round((todayMs / STANDARD_MS) * 100))
  $: remainingMs = Math.max(0, STANDARD_MS - todayMs)
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

  <div class="mac__prog">
    <div class="mac__prog-row">
      <span class="mac__prog-cap">of 8h day</span>
      <span class="mac__prog-pct">{pct}%</span>
    </div>
    <span class="mac__track"><span class="mac__fill" style="width:{pct}%" /></span>
    <div class="mac__prog-note">
      {#if remainingMs > 0}{formatDuration(remainingMs)} to go{:else}Full day complete{/if}
    </div>
  </div>

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
  .mac__prog { display: flex; flex-direction: column; gap: 6px; }
  .mac__prog-row { display: flex; align-items: baseline; justify-content: space-between; }
  .mac__prog-cap { font-size: 12px; color: var(--yg-text-dim); }
  .mac__prog-pct { font-size: 12px; font-weight: 650; color: var(--yg-text-dim); font-variant-numeric: tabular-nums; }
  .mac__track { display: block; height: 10px; background: var(--yg-border); border-radius: 6px; overflow: hidden; }
  .mac__fill { display: block; height: 100%; background: var(--yg-green); }
  .mac__prog-note { font-size: 12px; color: var(--yg-text-faint); }
  .mac__grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: auto; }
  .mac__stat {
    display: flex; flex-direction: column; gap: 2px; padding: 8px 10px;
    background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 8px;
  }
  .mac__k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 650; color: var(--yg-text-faint); }
  .mac__v { font-size: 14px; font-weight: 680; font-variant-numeric: tabular-nums; color: var(--yg-text); }
</style>
