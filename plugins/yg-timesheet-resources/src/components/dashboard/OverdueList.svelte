<script lang="ts">
  import { getPanelURI, Label } from '@hcengineering/ui'
  import tracker from '@hcengineering/tracker'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { type DashIssue } from '../../utils/dashboard'
  export let overdue: DashIssue[]
  export let dueSoon: DashIssue[]
  export let employeeNames: Map<string, string>
  const dfmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
  function href (id: string): string { return '#' + getPanelURI(tracker.component.EditIssue, id as any, tracker.class.Issue, 'content') }
</script>
<div class="q">
  <div class="q__title"><Label label={ygTimesheet.string.DueThisWeek} /></div>
  {#each [...overdue.map((i) => ({ i, late: true })), ...dueSoon.map((i) => ({ i, late: false }))] as { i, late } (i.id)}
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
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .q { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; }
  .q__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; }
  .orow { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-top: 1px solid var(--yg-border); text-decoration: none; color: var(--yg-text); }
  .orow__id { font-family: ui-monospace, monospace; font-size: 12px; color: var(--yg-text-dim); min-width: 64px; }
  .orow__t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .orow__a { font-size: 12px; color: var(--yg-text-dim); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .orow__due { font-size: 12px; color: var(--yg-text-dim); }
  .orow--late .orow__due { color: var(--yg-red); font-weight: 600; }
</style>
