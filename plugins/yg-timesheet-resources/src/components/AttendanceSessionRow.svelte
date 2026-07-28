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
<!-- One attendance session as a table row: in -> out, type, duration. `now` drives an open
     session's live-ticking duration; a closed session ignores it. -->
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

<tr class="att-tr" class:is-open={open}>
  <td class="att-td">
    <span class="att-td__time">{timeFmt.format(session.punchIn)}</span>
    {#if session.punchInNote}<span class="att-td__note">{session.punchInNote}</span>{/if}
  </td>
  <td class="att-td">
    {#if session.punchOut}
      <span class="att-td__time">{timeFmt.format(session.punchOut)}</span>
      {#if session.punchOutNote}<span class="att-td__note">{session.punchOutNote}</span>{/if}
    {:else}
      <span class="att-td__live"><span class="att-dot" /><Label label={ygTimesheet.string.OnTheClock} /></span>
    {/if}
  </td>
  <td class="att-td att-td--type">
    <span class="att-chip" class:att-chip--wfh={session.mode === 'wfh'}>
      <Label label={session.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} />
    </span>
  </td>
  <td class="att-td att-td--dur" class:is-open={open}>{formatDuration(durationMs)}</td>
</tr>

<style lang="scss">
  @use './yg-table' as *;

  .att-td { padding: 13px 18px; border-top: 1px solid var(--yg-border); vertical-align: middle; }
  .att-td__time { font-variant-numeric: tabular-nums; font-weight: 640; color: var(--yg-text); letter-spacing: -0.01em; }
  .att-td__note { color: var(--yg-text-faint); font-size: 13px; margin-left: 8px; }
  .att-td__live { display: inline-flex; align-items: center; gap: 6px; color: var(--att-wfh); font-weight: 600; font-size: 13px; }
  .att-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--att-wfh); box-shadow: 0 0 0 0 var(--att-wfh-line); animation: att-pulse 1.8s ease-out infinite; }

  .att-td--type { white-space: nowrap; }
  .att-td--dur { text-align: right; font-variant-numeric: tabular-nums; font-weight: 680; color: var(--yg-text); white-space: nowrap; }
  .att-td--dur.is-open { color: var(--att-wfh); }

  .att-chip {
    display: inline-block;
    font-size: 11px; font-weight: 650; letter-spacing: 0.02em;
    padding: 3px 9px; border-radius: 999px;
    color: var(--yg-text-dim); background: var(--yg-grey-bg); border: 1px solid var(--yg-border);
  }
  .att-chip--wfh { color: var(--att-wfh); background: var(--att-wfh-bg); border-color: var(--att-wfh-line); }

  @keyframes att-pulse {
    0% { box-shadow: 0 0 0 0 var(--att-wfh-line); }
    100% { box-shadow: 0 0 0 7px transparent; }
  }
  @media (prefers-reduced-motion: reduce) { .att-dot { animation: none; } }
</style>
