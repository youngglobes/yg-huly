<script lang="ts">
  import { getCurrentLocation, navigate, Label } from '@hcengineering/ui'
  import ygTimesheet, { ygTimesheetId } from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'
  export let rows: Array<{ id: string; identifier: string; title: string; project: string; hours: number; submittedOn: number; employee: string }>
  export let employeeNames: Map<string, string>
  export let projectName: (id: string) => string
  function goApprovals (): void { const loc = getCurrentLocation(); loc.path[2] = ygTimesheetId; loc.path[3] = 'approvals'; loc.path.length = 4; navigate(loc) }
</script>
<div class="q">
  <div class="q__head"><span class="q__title"><Label label={ygTimesheet.string.PendingApproval} />{#if rows.length > 0}<span class="q__n">{rows.length}</span>{/if}</span>
    {#if rows.length > 0}<button class="yg-btn yg-btn--ghost" on:click={goApprovals}><Label label={ygTimesheet.string.Approvals} /></button>{/if}</div>
  {#each rows.slice(0, 5) as r (r.id)}
    <button class="qrow" on:click={goApprovals}>
      <span class="qrow__who">{employeeNames.get(r.employee) ?? '-'}</span>
      <span class="qrow__mid">{r.identifier} · {projectName(r.project)}</span>
      <span class="qrow__hrs">{formatHours(r.hours)}</span>
    </button>
  {:else}
    <div class="yg-empty"><Label label={ygTimesheet.string.NothingWaiting} /></div>
  {/each}
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .q { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; height: 100%; display: flex; flex-direction: column; }
  .q :global(.yg-empty) { margin: auto 0; }
  .q__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .q__title { font-size: 13px; font-weight: 680; color: var(--yg-text); }
  .q__n { font-size: 11px; font-weight: 700; color: var(--yg-amber); background: var(--yg-amber-bg); border-radius: 999px; padding: 1px 7px; margin-left: 6px; }
  .qrow { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 6px; border: 0; border-top: 1px solid var(--yg-border); background: transparent; cursor: pointer; font: inherit; text-align: left; }
  .qrow__who { font-weight: 600; color: var(--yg-text); min-width: 120px; }
  .qrow__mid { color: var(--yg-text-dim); font-size: 12px; flex: 1; }
  .qrow__hrs { font-variant-numeric: tabular-nums; color: var(--yg-text); }
</style>
