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
  HR dashboard: timesheet submission compliance - submitted/expected as a progress bar plus the
  list of active employees who have not submitted. Presentational only; the parent already
  computed `submitted`/`expected`/`missing` via utils/hr-dashboard.ts (submissionCompliance).
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { type HrEmp } from '../../utils/hr-dashboard'

  export let submitted: number
  export let expected: number
  export let missing: HrEmp[]

  const CAP = 5

  $: pct = expected > 0 ? Math.round((submitted / expected) * 100) : 0
  $: shown = missing.slice(0, CAP)
  $: hiddenCount = missing.length - shown.length
</script>

<div class="cc">
  <div class="cc__title"><Label label={ygTimesheet.string.TimesheetCompliance} /></div>

  {#if expected === 0}
    <div class="yg-empty cc__empty">No timesheet activity yet.</div>
  {:else}
    <div class="cc__bar-row">
      <span class="cc__frac">{submitted} / {expected}</span>
      <span class="cc__pct">{pct}%</span>
    </div>
    <span class="cc__track"><span class="cc__fill" style="width:{pct}%" /></span>

    <div class="cc__sub">
      <div class="cc__sub-title">
        <Label label={ygTimesheet.string.NotSubmitted} />
        <span class="cc__count">{missing.length}</span>
      </div>
      {#if missing.length > 0}
        <div class="cc__sub-list">
          {#each shown as e (e.id)}
            <span class="cc__chip">{e.name}</span>
          {/each}
          {#if hiddenCount > 0}
            <span class="cc__chip cc__chip--more">+{hiddenCount} more</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .cc {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 14px 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .cc :global(.yg-empty) { margin: auto 0; }
  .cc__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 10px; }

  .cc__bar-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
  .cc__frac { font-size: 20px; font-weight: 720; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--yg-text); }
  .cc__pct { font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--yg-text-dim); }

  .cc__track { display: block; height: 10px; background: var(--yg-border); border-radius: 6px; overflow: hidden; }
  .cc__fill { display: block; height: 100%; background: var(--yg-green); }

  .cc__sub { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--yg-border); }
  .cc__sub-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; font-weight: 650; color: var(--yg-text-dim);
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;
  }
  .cc__count {
    font-size: 11px; font-weight: 700; color: var(--yg-text-dim);
    background: var(--yg-panel-soft); border-radius: 999px; padding: 1px 8px;
  }
  .cc__sub-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .cc__chip {
    font-size: 12px; color: var(--yg-text-dim);
    background: var(--yg-panel-soft); border: 1px solid var(--yg-border);
    border-radius: 999px; padding: 3px 10px;
  }
  .cc__chip--more { color: var(--yg-text-faint); }
</style>
