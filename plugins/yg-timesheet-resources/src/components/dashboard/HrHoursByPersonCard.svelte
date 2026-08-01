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
  HR dashboard: hours logged this week, one row per employee (member/hours/days/last active).
  Full-width table, scrollable so it scales with headcount. Presentational only; the parent
  already computed `rows` via utils/hr-dashboard.ts (hoursByPerson).
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'
  import { type PersonHours } from '../../utils/hr-dashboard'

  export let rows: PersonHours[]

  const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
  const fmtLastActive = (ms: number): string => (ms === 0 ? '-' : dateFmt.format(new Date(ms)))
</script>

<div class="hbp">
  <div class="hbp__title"><Label label={ygTimesheet.string.HoursByPerson} /></div>
  <div class="hbp__wrap">
    <table class="yg-table">
      <thead>
        <tr>
          <th class="left">Member</th>
          <th class="yg-num">Hours</th>
          <th class="yg-num"><Label label={ygTimesheet.string.DaysLogged} /></th>
          <th class="yg-num"><Label label={ygTimesheet.string.LastActive} /></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.employee)}
          <tr>
            <td class="left hbp__name">{r.name}</td>
            <td class="yg-num">{formatHours(r.hours)}</td>
            <td class="yg-num">{r.days}</td>
            <td class="yg-num">{fmtLastActive(r.lastActive)}</td>
          </tr>
        {:else}
          <tr><td colspan={4} class="yg-empty">No time logged this week.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .hbp {
    margin-top: 16px;
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 14px 16px;
  }
  .hbp__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 10px; }
  // Cap the height so a large headcount scrolls instead of pushing the rest of the page down.
  .hbp__wrap { max-height: 320px; overflow: auto; }
  .hbp__name { font-weight: 600; color: var(--yg-text); }
</style>
