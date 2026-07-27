<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'
  import { type ProjectStat } from '../../utils/dashboard'
  export let stats: ProjectStat[]
</script>
<div class="pc">
  <div class="pc__title"><Label label={ygTimesheet.string.ProjectsYouHandle} /></div>
  <div class="pc__grid">
    {#each stats as s (s.project)}
      <div class="pcard">
        <div class="pcard__name">{s.name}</div>
        <div class="pcard__row"><span>{s.inProgress} in progress</span><span>{s.open} open</span><span>{s.done} done</span></div>
        <div class="pcard__meta">{formatHours(s.hours)} this week · {s.members} {s.members === 1 ? 'member' : 'members'}</div>
      </div>
    {:else}
      <div class="yg-empty">No projects assigned to you.</div>
    {/each}
  </div>
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .pc { margin-top: 16px; }
  .pc__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 10px; }
  .pc__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .pcard { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; }
  .pcard__name { font-weight: 640; color: var(--yg-text); }
  .pcard__row { display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: var(--yg-text-dim); }
  .pcard__meta { margin-top: 6px; font-size: 12px; color: var(--yg-text-faint); }
</style>
