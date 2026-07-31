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
  Employee dashboard: my logged hours this week - the big total plus a short recent-entries list,
  newest first. Presentational only; the parent already scoped/aggregated the numbers.
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'

  export let hours: number
  export let entries: Array<{ identifier: string; title: string; hours: number; date: number }>

  $: sorted = [...entries].sort((a, b) => b.date - a.date)
</script>

<div class="mhc">
  <div class="mhc__title"><Label label={ygTimesheet.string.MyHoursThisWeek} /></div>
  <div class="mhc__total">{formatHours(hours)}</div>

  <div class="mhc__list">
    {#each sorted as e, idx (idx)}
      <div class="mhrow">
        <span class="mhrow__id">{e.identifier}</span>
        <span class="mhrow__t">{e.title}</span>
        <span class="mhrow__h">{formatHours(e.hours)}</span>
      </div>
    {:else}
      <div class="yg-empty">No hours logged this week.</div>
    {/each}
  </div>
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .mhc {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 14px 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .mhc :global(.yg-empty) { margin: auto 0; }
  .mhc__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; }
  .mhc__total {
    font-size: 28px; font-weight: 720; letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums; color: var(--yg-text); margin-bottom: 8px;
  }
  .mhc__list { max-height: 260px; overflow: auto; }
  .mhrow { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-top: 1px solid var(--yg-border); color: var(--yg-text); }
  .mhrow:first-child { border-top: 0; }
  .mhrow__id { font-family: ui-monospace, monospace; font-size: 12px; color: var(--yg-text-dim); min-width: 64px; }
  .mhrow__t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mhrow__h { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--yg-text-dim); }
</style>
