<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  // Segments are OPEN issues grouped by real status name (Done/Cancelled excluded upstream), each
  // with a color. Replaces the old fixed status-category buckets.
  export let segments: Array<{ name: string; count: number; color: string }>
  $: total = segments.reduce((s, o) => s + o.count, 0)
  // Build stroke-dasharray arcs on a circle (r=54, circumference C). Each segment = share*C.
  const R = 54; const C = 2 * Math.PI * R
  $: segs = (() => { let acc = 0; return segments.filter((o) => o.count > 0).map((o) => { const frac = total === 0 ? 0 : o.count / total; const seg = { color: o.color, dash: frac * C, offset: -acc * C }; acc += frac; return seg }) })()
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
      {#each segments as o}<div class="lg"><span class="lg__dot" style="background:{o.color}" />{o.name}<b>{o.count}</b></div>{:else}<div class="yg-empty">No open issues.</div>{/each}
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
