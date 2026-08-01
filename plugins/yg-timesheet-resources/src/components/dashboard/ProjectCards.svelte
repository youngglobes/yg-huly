<script lang="ts">
  // "Projects you handle" as a compact, sortable portfolio table (not cards): one dense row per
  // project, sorted most-active first, scrollable so it scales whether a PM has 3 projects or 30.
  // Carries the budget view: Estimated (planned) vs Spent (all-time actual) per project + a
  // portfolio total; a project that has spent more than estimated reads amber.
  import { DropdownLabels, Label, type DropdownTextItem } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'
  import { type ProjectStat } from '../../utils/dashboard'
  export let stats: ProjectStat[]
  export let portfolio: { estimated: number, spent: number }
  // Real OPEN-status columns (e.g. Todo, In Progress, In Testing, In Review), auto-derived from the
  // data upstream and shared across projects; a project with no issues in a status shows 0. Replaces
  // the old single "In Progress" column, which lumped every active-category status together.
  export let statusColumns: string[] = []
  // Period filter (owned by Dashboard, bound in): scopes the "Logged" column (s.hours) to the
  // chosen range. Estimated/Spent stay all-time (the budget view).
  export let presetItems: DropdownTextItem[] = []
  export let preset = 'thisWeek'
  export let fromStr = ''
  export let toStr = ''
  // Most-active first: most open work desc, then spent desc, then name.
  $: rows = [...stats].sort((a, b) => b.open - a.open || b.spent - a.spent || a.name.localeCompare(b.name))
  // Org-wide logged time in the selected period (sum of the per-project Logged column) - "how much
  // work went into all projects this week". Replaces the less-actionable all-time Estimated/Spent totals.
  $: totalLogged = stats.reduce((s, r) => s + r.hours, 0)
  $: periodLabel = (presetItems.find((p) => p.id === preset)?.label ?? '').toLowerCase()
</script>

<div class="pc">
  <div class="pc__head">
    <div class="pc__left">
      <div class="pc__title"><Label label={ygTimesheet.string.ProjectsYouHandle} /></div>
      <div class="pc__filter">
        <DropdownLabels items={presetItems} bind:selected={preset} autoSelect={false} kind="regular" size="small" />
        {#if preset === 'custom'}
          <input class="yg-input pc__date" type="date" bind:value={fromStr} aria-label="From" />
          <span class="pc__dash">-</span>
          <input class="yg-input pc__date" type="date" bind:value={toStr} aria-label="To" />
        {/if}
      </div>
    </div>
    <div class="pc__tot">
      <span>Total logged <span class="pc__period">{periodLabel}</span> <b>{formatHours(totalLogged)}</b></span>
    </div>
  </div>
  <div class="pc__wrap">
    <table class="yg-table">
      <thead>
        <tr>
          <th class="left"><Label label={ygTimesheet.string.Project} /></th>
          {#each statusColumns as c}
            <th class="yg-num" title={c}>{c}</th>
          {/each}
          <th class="yg-num" title="Hours logged in the selected period">Logged</th>
          <th class="yg-num"><Label label={ygTimesheet.string.Estimated} /></th>
          <th class="yg-num"><Label label={ygTimesheet.string.Spent} /></th>
          <th class="yg-num">Team</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as s (s.project)}
          <tr>
            <td class="left pc__name">{s.name}</td>
            {#each statusColumns as c}
              <td class="yg-num">{s.byStatus[c] ?? 0}</td>
            {/each}
            <td class="yg-num">{formatHours(s.hours)}</td>
            <td class="yg-num">{formatHours(s.estimated)}</td>
            <td class="yg-num" class:pc__over={s.estimated > 0 && s.spent > s.estimated}>{formatHours(s.spent)}</td>
            <td class="yg-num">{s.members}</td>
          </tr>
        {:else}
          <tr><td colspan={statusColumns.length + 5} class="yg-empty">No projects assigned to you.</td></tr>
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
  .pc__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
  .pc__left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .pc__title { font-size: 13px; font-weight: 680; color: var(--yg-text); }
  .pc__filter { display: inline-flex; align-items: center; gap: 6px; }
  .pc__period { color: var(--yg-text-dim); }
  .pc__date { font-size: 12px; padding: 2px 6px; }
  .pc__dash { color: var(--yg-text-faint); }
  .pc__tot { display: flex; gap: 16px; font-size: 12px; color: var(--yg-text-dim); }
  .pc__tot b { color: var(--yg-text); font-variant-numeric: tabular-nums; }
  // Cap the height so a many-project portfolio scrolls instead of pushing the rest of the page down.
  .pc__wrap { max-height: 320px; overflow: auto; }
  .pc__name { font-weight: 600; color: var(--yg-text); }
  // Over-budget (spent > estimated) reads amber so a PM spots it at a glance.
  .pc__over { color: var(--yg-amber); font-weight: 600; }
</style>
