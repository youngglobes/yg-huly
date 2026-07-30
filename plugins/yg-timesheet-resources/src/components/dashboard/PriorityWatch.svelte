<script lang="ts">
  // Priority watch: still-open Urgent/High issues on the PM's projects, most-urgent first, each
  // linking to the issue. The "what's on fire" triage list.
  import { getPanelURI, Label } from '@hcengineering/ui'
  import tracker from '@hcengineering/tracker'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { priorityLabel } from '../../utils/reports'
  import { type DashIssue } from '../../utils/dashboard'
  export let issues: DashIssue[]
  export let employeeNames: Map<string, string>
  function href (id: string): string {
    return '#' + getPanelURI(tracker.component.EditIssue, id as any, tracker.class.Issue, 'content')
  }
</script>

<div class="pw">
  <div class="pw__title">
    <Label label={ygTimesheet.string.PriorityWatch} />
    {#if issues.length > 0}<span class="pw__count">{issues.length}</span>{/if}
  </div>
  {#each issues.slice(0, 6) as i (i.id)}
    <a class="pwrow" href={href(i.id)}>
      <span class="pwtag pwtag--{i.priority === 1 ? 'urgent' : 'high'}">{priorityLabel(i.priority)}</span>
      <span class="pwrow__id">{i.identifier}</span>
      <span class="pwrow__t">{i.title}</span>
      <span class="pwrow__a">{i.assignee != null ? (employeeNames.get(i.assignee) ?? '') : ''}</span>
    </a>
  {:else}
    <div class="yg-empty">Nothing urgent open.</div>
  {/each}
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .pw {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 14px 16px;
  }
  .pw__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .pw__count { font-size: 11px; font-weight: 700; color: var(--yg-red); background: var(--yg-red-bg); border-radius: 999px; padding: 1px 8px; }
  .pwrow { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-top: 1px solid var(--yg-border); text-decoration: none; color: var(--yg-text); }
  .pwtag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 1px 6px; border-radius: 5px; flex: none; }
  .pwtag--urgent { color: var(--yg-red); background: var(--yg-red-bg); }
  .pwtag--high { color: var(--yg-amber); background: var(--yg-amber-bg); }
  .pwrow__id { font-family: ui-monospace, monospace; font-size: 12px; color: var(--yg-text-dim); min-width: 64px; }
  .pwrow__t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pwrow__a { font-size: 12px; color: var(--yg-text-dim); }
</style>
