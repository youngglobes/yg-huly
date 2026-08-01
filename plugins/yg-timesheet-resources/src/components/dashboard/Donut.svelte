<script lang="ts">
  import { type IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  // Segments are OPEN issues grouped by real status name (Done/Cancelled excluded upstream), each
  // with a color. Replaces the old fixed status-category buckets.
  export let segments: Array<{ name: string; count: number; color: string }>
  // Title + center subtext default to the PM (issues-by-status) case so existing callers are
  // unaffected; the HR dashboard overrides both for its Office/WFH donut.
  export let title: IntlString = ygTimesheet.string.IssuesByStatus
  export let centerLabel: string = 'open'
  // HR dashboard reuse: optional top accent colour, and `fill` to stretch the card to its (fixed
  // height) grid cell with the donut vertically centered. Defaults keep the PM caller unchanged.
  export let accent = ''
  export let fill = false
  $: total = segments.reduce((s, o) => s + o.count, 0)
  // Build stroke-dasharray arcs on a circle (r=70, circumference C). Each segment = share*C.
  const R = 70; const C = 2 * Math.PI * R
  $: segs = (() => { let acc = 0; return segments.filter((o) => o.count > 0).map((o) => { const frac = total === 0 ? 0 : o.count / total; const seg = { color: o.color, dash: frac * C, offset: -acc * C }; acc += frac; return seg }) })()
</script>
<div class="chart" class:chart--fill={fill} style={accent ? `border-top: 3px solid ${accent}` : ''}>
  <div class="chart__title"><Label label={title} /></div>
  <div class="chart__body">
    <svg class="chart__svg" viewBox="0 0 180 180" width="180" height="180">
      <g transform="translate(90,90) rotate(-90)">
        <circle r={R} fill="none" stroke="var(--yg-border)" stroke-width="20" />
        {#each segs as s}
          <circle r={R} fill="none" stroke={s.color} stroke-width="20" stroke-dasharray="{s.dash} {C - s.dash}" stroke-dashoffset={s.offset} stroke-linecap="butt" />
        {/each}
      </g>
      <text x="90" y="82" text-anchor="middle" dominant-baseline="central" class="chart__total">{total}</text>
      <text x="90" y="106" text-anchor="middle" dominant-baseline="central" class="chart__sub">{centerLabel}</text>
    </svg>
    <div class="chart__legend">
      {#each segments as o}<div class="lg"><span class="lg__dot" style="background:{o.color}" /><span class="lg__name">{o.name}</span><b>{o.count}</b></div>{:else}<div class="yg-empty">No open issues.</div>{/each}
    </div>
  </div>
</div>
<style lang="scss">
  @use '../yg-table' as *;
  // Card sizes to its content (no height:100%) so it stays compact next to the taller team table.
  .chart { display: flex; flex-direction: column; background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 16px 20px; }
  // fill: stretch to the fixed-height grid cell and vertically center the donut (HR dashboard).
  .chart--fill { height: 100%; }
  .chart--fill .chart__body { flex: 1; }
  .chart__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; }
  // Donut + legend side by side, vertically centered on the ring.
  .chart__body { display: flex; align-items: center; gap: 28px; }
  .chart__svg { flex: none; }
  .chart__total { font-size: 34px; font-weight: 760; fill: var(--yg-text); }
  .chart__sub { font-size: 12px; font-weight: 600; fill: var(--yg-text-faint); text-transform: uppercase; letter-spacing: 0.04em; }
  .chart__legend { flex: 1; display: flex; flex-direction: column; gap: 10px; font-size: 13px; color: var(--yg-text-dim); }
  .lg { display: flex; align-items: center; gap: 9px; } .lg__name { flex: 1; } .lg b { color: var(--yg-text); margin-left: 4px; font-variant-numeric: tabular-nums; }
  .lg__dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  @media (max-width: 640px) { .chart__body { flex-direction: column; gap: 16px; } .chart__legend { width: 100%; } }
</style>
