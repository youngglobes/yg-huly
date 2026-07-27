<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { type Cat } from '../../utils/dashboard'
  export let buckets: Record<Cat, number>
  const ORDER: Array<{ cat: Cat; label: string; color: string }> = [
    { cat: 'unstarted', label: 'Backlog', color: 'var(--yg-grey)' },
    { cat: 'todo', label: 'Todo', color: 'var(--yg-av3)' },
    { cat: 'active', label: 'In progress', color: 'var(--yg-amber)' },
    { cat: 'won', label: 'Done', color: 'var(--yg-green)' },
    { cat: 'lost', label: 'Cancelled', color: 'var(--yg-red)' }
  ]
  $: total = ORDER.reduce((s, o) => s + buckets[o.cat], 0)
  // Build stroke-dasharray arcs on a circle (r=54, circumference C). Each segment = share*C.
  const R = 54; const C = 2 * Math.PI * R
  $: segs = (() => { let acc = 0; return ORDER.filter((o) => buckets[o.cat] > 0).map((o) => { const frac = total === 0 ? 0 : buckets[o.cat] / total; const seg = { color: o.color, dash: frac * C, offset: -acc * C }; acc += frac; return seg }) })()
</script>
<div class="chart">
  <div class="chart__title"><Label label={ygTimesheet.string.IssuesByStatus} /></div>
  <div class="chart__body">
    <svg viewBox="0 0 140 140" width="140" height="140">
      <g transform="translate(70,70) rotate(-90)">
        <circle r={R} fill="none" stroke="var(--yg-border)" stroke-width="16" />
        {#each segs as s}
          <circle r={R} fill="none" stroke={s.color} stroke-width="16" stroke-dasharray="{s.dash} {C - s.dash}" stroke-dashoffset={s.offset} />
        {/each}
      </g>
      <text x="70" y="70" text-anchor="middle" dominant-baseline="central" class="chart__total">{total}</text>
    </svg>
    <div class="chart__legend">
      {#each ORDER as o}<div class="lg"><span class="lg__dot" style="background:{o.color}" />{o.label}<b>{buckets[o.cat]}</b></div>{/each}
    </div>
  </div>
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .chart { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 14px 16px; }
  .chart__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; }
  .chart__body { display: flex; align-items: center; gap: 18px; }
  .chart__total { font-size: 22px; font-weight: 720; fill: var(--yg-text); }
  .chart__legend { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--yg-text-dim); }
  .lg { display: flex; align-items: center; gap: 7px; } .lg b { color: var(--yg-text); margin-left: 4px; }
  .lg__dot { width: 9px; height: 9px; border-radius: 50%; }
</style>
