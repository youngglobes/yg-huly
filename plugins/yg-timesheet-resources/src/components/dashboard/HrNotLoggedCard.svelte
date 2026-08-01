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
  HR dashboard: active employees who have logged zero hours this week. Presentational only; the
  parent already computed `emps` via utils/hr-dashboard.ts (notLoggedThisWeek).
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { type HrEmp } from '../../utils/hr-dashboard'

  export let emps: HrEmp[]

  const CAP = 6

  $: shown = emps.slice(0, CAP)
  $: hiddenCount = emps.length - shown.length
</script>

<div class="nlc">
  <div class="nlc__title">
    <Label label={ygTimesheet.string.NotLoggedThisWeek} />
    {#if emps.length > 0}<span class="nlc__count">{emps.length}</span>{/if}
  </div>

  <div class="nlc__list">
    {#each shown as e (e.id)}
      <div class="nlrow">
        <span class="nlrow__name">{e.name}</span>
      </div>
    {:else}
      <div class="yg-empty nlc__empty">Everyone has logged time this week.</div>
    {/each}
    {#if hiddenCount > 0}
      <div class="nlc__more">+{hiddenCount} more</div>
    {/if}
  </div>
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .nlc {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 14px 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .nlc :global(.yg-empty) { margin: auto 0; }
  .nlc__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .nlc__count { font-size: 11px; font-weight: 700; color: var(--yg-text-dim); background: var(--yg-panel-soft); border-radius: 999px; padding: 1px 8px; }
  .nlc__empty { color: var(--yg-green); }

  .nlc__list { max-height: 260px; overflow: auto; }
  .nlrow { display: flex; align-items: center; padding: 8px 6px; border-top: 1px solid var(--yg-border); color: var(--yg-text); }
  .nlrow:first-child { border-top: 0; }
  .nlrow__name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nlc__more { font-size: 12px; color: var(--yg-text-dim); padding: 6px; text-align: center; }
</style>
