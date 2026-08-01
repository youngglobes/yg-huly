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
  HR dashboard: who is present today (office/wfh, "in now" if still punched in), plus a muted
  subsection of active employees who have not punched in at all. Presentational only; the parent
  already computed `present`/`notPunched` via utils/hr-dashboard.ts (attendanceToday/notPunchedToday).
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { type AttToday, type HrEmp } from '../../utils/hr-dashboard'

  export let present: AttToday[]
  export let notPunched: HrEmp[]
  // Optional top accent colour (set by the HR dashboard to distinguish the row's cards).
  export let accent = ''

  const CAP = 6
  const SUB_CAP = 6

  $: shown = present.slice(0, CAP)
  $: hiddenCount = present.length - shown.length
  $: subShown = notPunched.slice(0, SUB_CAP)
  $: subHiddenCount = notPunched.length - subShown.length
</script>

<div class="atc" style={accent ? `border-top: 3px solid ${accent}` : ''}>
  <div class="atc__title"><Label label={ygTimesheet.string.AttendanceToday} /></div>

  <div class="atc__list">
    {#each shown as p (p.employee)}
      <div class="atrow">
        <span class="atrow__name">{p.name}</span>
        {#if p.open}
          <span class="atrow__now"><span class="atrow__dot" /><Label label={ygTimesheet.string.InNow} /></span>
        {/if}
        <span class="atrow__mode">
          <Label label={p.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} />
        </span>
      </div>
    {:else}
      <div class="yg-empty">No punches yet today.</div>
    {/each}
    {#if hiddenCount > 0}
      <div class="atc__more">+{hiddenCount} more</div>
    {/if}
  </div>

  {#if notPunched.length > 0}
    <div class="atc__sub">
      <div class="atc__sub-title">
        <Label label={ygTimesheet.string.NotPunchedIn} />
        <span class="atc__count">{notPunched.length}</span>
      </div>
      <div class="atc__sub-list">
        {#each subShown as e (e.id)}
          <span class="atc__chip">{e.name}</span>
        {/each}
        {#if subHiddenCount > 0}
          <span class="atc__chip atc__chip--more">+{subHiddenCount} more</span>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .atc {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 14px 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .atc :global(.yg-empty) { margin: auto 0; }
  .atc__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; }

  // Fill the remaining card height and scroll when the present-list overflows (card height is fixed
  // by the parent grid); the not-punched subsection below stays pinned.
  .atc__list { flex: 1; min-height: 0; overflow: auto; }
  .atrow { display: flex; align-items: center; gap: 8px; padding: 8px 6px; border-top: 1px solid var(--yg-border); color: var(--yg-text); }
  .atrow:first-child { border-top: 0; }
  .atrow__name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .atrow__now {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; font-weight: 650; color: var(--yg-green);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .atrow__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--yg-green); }
  .atrow__mode {
    font-size: 11px; font-weight: 700; color: var(--yg-text-dim);
    background: var(--yg-panel-soft); border: 1px solid var(--yg-border);
    border-radius: 999px; padding: 1px 8px;
  }
  .atc__more { font-size: 12px; color: var(--yg-text-dim); padding: 6px; text-align: center; }

  .atc__sub { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--yg-border); }
  .atc__sub-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; font-weight: 650; color: var(--yg-text-dim);
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;
  }
  .atc__count {
    font-size: 11px; font-weight: 700; color: var(--yg-text-dim);
    background: var(--yg-panel-soft); border-radius: 999px; padding: 1px 8px;
  }
  .atc__sub-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .atc__chip {
    font-size: 12px; color: var(--yg-text-dim);
    background: var(--yg-panel-soft); border: 1px solid var(--yg-border);
    border-radius: 999px; padding: 3px 10px;
  }
  .atc__chip--more { color: var(--yg-text-faint); }
</style>
