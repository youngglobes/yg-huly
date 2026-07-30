<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { formatHours } from '../../utils/week'
  export let bars: Array<{ project: string; name: string; hours: number }>
  $: max = Math.max(1, ...bars.map((b) => b.hours))
  $: sorted = [...bars].sort((a, b) => b.hours - a.hours)
</script>
<div class="chart">
  <div class="chart__title"><Label label={ygTimesheet.string.HoursByProject} /></div>
  {#each sorted as b (b.project)}
    <div class="bar">
      <span class="bar__name">{b.name}</span>
      <span class="bar__track"><span class="bar__fill" style="width:{(b.hours / max) * 100}%" /></span>
      <span class="bar__val">{formatHours(b.hours)}</span>
    </div>
  {:else}
    <div class="yg-empty">No hours logged this week.</div>
  {/each}
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .chart { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; }
  .chart__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 10px; }
  .bar { display: grid; grid-template-columns: 120px 1fr 56px; align-items: center; gap: 10px; margin-bottom: 8px; }
  .bar__name { font-size: 12px; color: var(--yg-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar__track { height: 12px; background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 6px; overflow: hidden; }
  .bar__fill { display: block; height: 100%; background: var(--yg-ink); }
  .bar__val { text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--yg-text); }
</style>
