<script lang="ts">
  // "Projects you handle" as a compact, sortable portfolio table (not cards): one dense row per
  // project, sorted most-active first (in-progress desc, then hours), scrollable so it stays
  // scannable whether a PM has 3 projects or 30. In our org a PM can hold many projects at once,
  // so the card grid was replaced with this table (user decision 2026-07-27).
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'
  import { type ProjectStat } from '../../utils/dashboard'
  export let stats: ProjectStat[]
  // Most-active first: in-progress desc, then hours desc, then name.
  $: rows = [...stats].sort((a, b) => b.inProgress - a.inProgress || b.hours - a.hours || a.name.localeCompare(b.name))
</script>

<div class="pc">
  <div class="pc__title"><Label label={ygTimesheet.string.ProjectsYouHandle} /></div>
  <div class="pc__wrap">
    <table class="yg-table">
      <thead>
        <tr>
          <th class="left"><Label label={ygTimesheet.string.Project} /></th>
          <th class="yg-num"><Label label={ygTimesheet.string.InProgress} /></th>
          <th class="yg-num">Open</th>
          <th class="yg-num">Done</th>
          <th class="yg-num"><Label label={ygTimesheet.string.Hours} /></th>
          <th class="yg-num">Team</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as s (s.project)}
          <tr>
            <td class="left pc__name">{s.name}</td>
            <td class="yg-num">{s.inProgress}</td>
            <td class="yg-num">{s.open}</td>
            <td class="yg-num">{s.done}</td>
            <td class="yg-num">{formatHours(s.hours)}</td>
            <td class="yg-num">{s.members}</td>
          </tr>
        {:else}
          <tr><td colspan={6} class="yg-empty">No projects assigned to you.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .pc {
    margin-top: 16px;
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 14px 16px;
  }
  .pc__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 10px; }
  // Cap the height so a many-project portfolio scrolls instead of pushing the rest of the page down.
  .pc__wrap { max-height: 320px; overflow: auto; }
  .pc__name { font-weight: 600; color: var(--yg-text); }
</style>
