<script lang="ts">
  import { getPanelURI, Label, DropdownLabels, type DropdownTextItem } from '@hcengineering/ui'
  import tracker from '@hcengineering/tracker'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { priorityLabel } from '../../utils/reports'
  import { formatHours } from '../../utils/week'
  import { type DashIssue, type DashProject } from '../../utils/dashboard'
  export let issues: DashIssue[]
  export let projects: DashProject[]
  export let employeeNames: Map<string, string>
  export let hoursByIssue: Map<string, number>
  let projSel: string | undefined
  $: items = projects.map((p): DropdownTextItem => ({ id: p.id, label: p.name }))
  $: rows = issues.filter((i) => projSel == null || i.project === projSel)
    .sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) || a.identifier.localeCompare(b.identifier, undefined, { numeric: true }))
  const dfmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
</script>
<div class="ipt">
  <div class="ipt__head">
    <span class="ipt__title"><Label label={ygTimesheet.string.InProgressTasks} /></span>
    <DropdownLabels {items} bind:selected={projSel} label={ygTimesheet.string.Project} autoSelect={false} allowDeselect kind="regular" />
  </div>
  <table class="yg-table">
    <thead><tr><th class="left">ID</th><th class="left">Title</th><th class="left"><Label label={ygTimesheet.string.Assignee} /></th><th><Label label={ygTimesheet.string.Priority} /></th><th><Label label={ygTimesheet.string.DueDate} /></th><th class="yg-num"><Label label={ygTimesheet.string.Hours} /></th></tr></thead>
    <tbody>
      {#each rows as r (r.id)}
        <tr>
          <td class="left"><a class="yg-idbadge" href="#{getPanelURI(tracker.component.EditIssue, r.id, tracker.class.Issue, 'content')}">{r.identifier}</a></td>
          <td class="left">{r.title}</td>
          <td class="left">
            {#if r.assignee != null}
              {employeeNames.get(r.assignee) ?? r.assignee}
            {:else}
              <Label label={ygTimesheet.string.Unassigned} />
            {/if}
          </td>
          <td>{priorityLabel(r.priority)}</td>
          <td>{r.dueDate != null ? dfmt.format(r.dueDate) : '·'}</td>
          <td class="yg-num">{formatHours(hoursByIssue.get(r.id) ?? 0)}</td>
        </tr>
      {:else}
        <tr><td colspan={6} class="yg-empty">No in-progress tasks.</td></tr>
      {/each}
    </tbody>
  </table>
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .ipt { margin-top: 16px; background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; }
  .ipt__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .ipt__title { font-size: 13px; font-weight: 680; color: var(--yg-text); }
  a.yg-idbadge { text-decoration: none; }
</style>
