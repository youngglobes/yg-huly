<script lang="ts">
  // Team this week: for each person who logged time this week or owns an open issue on the PM's
  // projects, their hours logged + open issues assigned. Busiest first, so a PM sees who's
  // overloaded vs idle at a glance.
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'
  import { type TeamMember } from '../../utils/dashboard'
  export let team: TeamMember[]
  export let employeeNames: Map<string, string>
</script>

<div class="tw">
  <div class="tw__title"><Label label={ygTimesheet.string.TeamWorkload} /></div>
  <div class="tw__wrap">
    <table class="yg-table">
      <thead>
        <tr>
          <th class="left"><Label label={ygTimesheet.string.Member} /></th>
          <th class="yg-num"><Label label={ygTimesheet.string.Hours} /></th>
          <th class="yg-num">Open</th>
        </tr>
      </thead>
      <tbody>
        {#each team as m (m.employee)}
          <tr>
            <td class="left tw__name">{employeeNames.get(m.employee) ?? m.employee}</td>
            <td class="yg-num">{formatHours(m.hours)}</td>
            <td class="yg-num">{m.open}</td>
          </tr>
        {:else}
          <tr><td colspan={3} class="yg-empty">No activity this week.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .tw {
    margin-top: 16px;
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 14px 16px;
  }
  .tw__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 10px; }
  .tw__wrap { max-height: 280px; overflow: auto; }
  .tw__name { font-weight: 600; color: var(--yg-text); }
</style>
