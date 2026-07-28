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
<!-- One attendance session row: in -> out, mode chip, duration. Shared by the today list and
     the read-only history list so the markup lives in one place. `now` drives an open session's
     live-ticking duration; a closed session ignores it. -->
<script lang="ts">
  import ygTimesheet, { type AttendanceSession } from '@hcengineering/yg-timesheet'
  import { Label } from '@hcengineering/ui'
  import { formatDuration } from '../utils/attendance'

  export let session: AttendanceSession
  export let now: number

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
  $: open = session.punchOut === undefined
  $: durationMs = (session.punchOut ?? now) - session.punchIn
</script>

<div class="att-row" class:is-open={open}>
  <div class="att-leg">
    <span class="att-leg__time">{timeFmt.format(session.punchIn)}</span>
    {#if session.punchInNote}<span class="att-leg__note">{session.punchInNote}</span>{/if}
  </div>

  <span class="att-sep" aria-hidden="true">&#8594;</span>

  <div class="att-leg att-leg--out">
    {#if session.punchOut}
      <span class="att-leg__time">{timeFmt.format(session.punchOut)}</span>
      {#if session.punchOutNote}<span class="att-leg__note">{session.punchOutNote}</span>{/if}
    {:else}
      <span class="att-leg__live"><span class="att-dot" /><Label label={ygTimesheet.string.OnTheClock} /></span>
    {/if}
  </div>

  <span class="att-chip" class:att-chip--wfh={session.mode === 'wfh'}>
    <Label label={session.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} />
  </span>

  <span class="att-row__dur" class:is-open={open}>{formatDuration(durationMs)}</span>
</div>

<style lang="scss">
  @use './yg-table' as *;

  .att-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto auto;
    align-items: center;
    gap: 12px;
    padding: 13px 18px;
  }
  .att-row + :global(.att-row) { border-top: 1px solid var(--yg-border); }

  .att-leg { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .att-leg--out { justify-content: flex-start; }
  .att-leg__time { font-variant-numeric: tabular-nums; font-weight: 640; color: var(--yg-text); letter-spacing: -0.01em; }
  .att-leg__note {
    color: var(--yg-text-faint);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .att-leg__live { display: inline-flex; align-items: center; gap: 6px; color: var(--att-wfh); font-weight: 600; font-size: 13px; }
  .att-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--att-wfh); box-shadow: 0 0 0 0 var(--att-wfh-line); animation: att-pulse 1.8s ease-out infinite; }

  .att-sep { color: var(--yg-text-faint); font-size: 14px; }

  .att-chip {
    justify-self: start;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.02em;
    padding: 3px 9px;
    border-radius: 999px;
    color: var(--yg-text-dim);
    background: var(--yg-grey-bg);
    border: 1px solid var(--yg-border);
  }
  .att-chip--wfh {
    color: var(--att-wfh);
    background: var(--att-wfh-bg);
    border-color: var(--att-wfh-line);
  }

  .att-row__dur { font-variant-numeric: tabular-nums; font-weight: 680; color: var(--yg-text); min-width: 68px; text-align: right; }
  .att-row__dur.is-open { color: var(--att-wfh); }

  @keyframes att-pulse {
    0% { box-shadow: 0 0 0 0 var(--att-wfh-line); }
    100% { box-shadow: 0 0 0 7px transparent; }
  }
  @media (prefers-reduced-motion: reduce) { .att-dot { animation: none; } }
</style>
