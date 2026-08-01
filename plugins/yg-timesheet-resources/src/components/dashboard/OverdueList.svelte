<script lang="ts">
  import { getPanelURI, getCurrentLocation, navigate, Label } from '@hcengineering/ui'
  import tracker, { trackerId } from '@hcengineering/tracker'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { type DashIssue } from '../../utils/dashboard'
  export let overdue: DashIssue[]
  export let dueSoon: DashIssue[]
  export let employeeNames: Map<string, string>
  const dfmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
  $: total = overdue.length + dueSoon.length
  function href (id: string): string { return '#' + getPanelURI(tracker.component.EditIssue, id as any, tracker.class.Issue, 'content') }
  // "View all" -> Tracker's All Issues (the full list this card shows the top of).
  function goAll (): void {
    const loc = getCurrentLocation()
    loc.path[2] = trackerId
    loc.path[3] = 'all-issues'
    loc.path.length = 4
    navigate(loc)
  }
</script>
<div class="q">
  <div class="q__title"><Label label={ygTimesheet.string.DueThisWeek} />{#if overdue.length + dueSoon.length > 0}<span class="q__n">{overdue.length + dueSoon.length}</span>{/if}</div>
  {#each [...overdue.map((i) => ({ i, late: true })), ...dueSoon.map((i) => ({ i, late: false }))].slice(0, 6) as { i, late } (i.id)}
    <a class="orow" class:orow--late={late} href={href(i.id)}>
      <span class="orow__id">{i.identifier}</span>
      <span class="orow__t">{i.title}</span>
      <span class="orow__a">
        {#if i.assignee != null}
          {employeeNames.get(i.assignee) ?? i.assignee}
        {:else}
          <Label label={ygTimesheet.string.Unassigned} />
        {/if}
      </span>
      <span class="orow__due">{i.dueDate != null ? dfmt.format(i.dueDate) : ''}</span>
    </a>
  {:else}
    <div class="yg-empty"><Label label={ygTimesheet.string.NoOverdue} /></div>
  {/each}
  {#if total > 6}
    <button class="q__more" on:click={goAll}>View all {total}</button>
  {/if}
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .q { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; height: 100%; display: flex; flex-direction: column; }
  .q :global(.yg-empty) { margin: auto 0; }
  .q__more { margin-top: auto; align-self: flex-start; padding: 8px 2px 0; border: 0; background: transparent; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; color: var(--yg-text-dim); }
  .q__more:hover { color: var(--yg-text); text-decoration: underline; }
  .q__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; }
  .q__n { font-size: 11px; font-weight: 700; color: var(--yg-red); background: var(--yg-red-bg); border-radius: 999px; padding: 1px 7px; margin-left: 6px; }
  .orow { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-top: 1px solid var(--yg-border); text-decoration: none; color: var(--yg-text); }
  .orow__id { font-family: ui-monospace, monospace; font-size: 12px; color: var(--yg-text-dim); min-width: 64px; }
  .orow__t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .orow__a { font-size: 12px; color: var(--yg-text-dim); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .orow__due { font-size: 12px; color: var(--yg-text-dim); }
  .orow--late .orow__due { color: var(--yg-red); font-weight: 600; }
</style>
