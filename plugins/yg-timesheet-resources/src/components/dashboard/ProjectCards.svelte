<script lang="ts">
  // "Projects you handle" as a compact, sortable portfolio table (not cards): one dense row per
  // project, sorted most-active first, scrollable so it scales whether a PM has 3 projects or 30.
  // Carries the budget view: Estimated (planned) vs Spent (all-time actual) per project + a
  // portfolio total; a project that has spent more than estimated reads amber.
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'
  import { type ProjectStat } from '../../utils/dashboard'
  export let stats: ProjectStat[]
  export let portfolio: { estimated: number, spent: number }
  // Most-active first: in-progress desc, then spent desc, then name.
  $: rows = [...stats].sort((a, b) => b.inProgress - a.inProgress || b.spent - a.spent || a.name.localeCompare(b.name))
</script>

<div class="pc">
  <div class="pc__head">
    <div class="pc__title"><Label label={ygTimesheet.string.ProjectsYouHandle} /></div>
    <div class="pc__tot">
      <span><Label label={ygTimesheet.string.Estimated} /> <b>{formatHours(portfolio.estimated)}</b></span>
      <span><Label label={ygTimesheet.string.Spent} /> <b>{formatHours(portfolio.spent)}</b></span>
    </div>
  </div>
  <div class="pc__wrap">
    <table class="yg-table">
      <thead>
        <tr>
          <th class="left"><Label label={ygTimesheet.string.Project} /></th>
          <th class="yg-num"><Label label={ygTimesheet.string.InProgress} /></th>
          <th class="yg-num">Open</th>
          <th class="yg-num">Done</th>
          <th class="yg-num"><Label label={ygTimesheet.string.Estimated} /></th>
          <th class="yg-num"><Label label={ygTimesheet.string.Spent} /></th>
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
            <td class="yg-num">{formatHours(s.estimated)}</td>
            <td class="yg-num" class:pc__over={s.estimated > 0 && s.spent > s.estimated}>{formatHours(s.spent)}</td>
            <td class="yg-num">{s.members}</td>
          </tr>
        {:else}
          <tr><td colspan={7} class="yg-empty">No projects assigned to you.</td></tr>
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
  .pc__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .pc__title { font-size: 13px; font-weight: 680; color: var(--yg-text); }
  .pc__tot { display: flex; gap: 16px; font-size: 12px; color: var(--yg-text-dim); }
  .pc__tot b { color: var(--yg-text); font-variant-numeric: tabular-nums; }
  // Cap the height so a many-project portfolio scrolls instead of pushing the rest of the page down.
  .pc__wrap { max-height: 320px; overflow: auto; }
  .pc__name { font-weight: 600; color: var(--yg-text); }
  // Over-budget (spent > estimated) reads amber so a PM spots it at a glance.
  .pc__over { color: var(--yg-amber); font-weight: 600; }
</style>
