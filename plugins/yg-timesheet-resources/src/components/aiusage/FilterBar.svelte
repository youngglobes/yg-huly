<script lang="ts">
  // Seven controls: Account, Device, Project, Person, Model, Period, Reset. Option lists are
  // derived from the whole report (never the current filters), so a filter never narrows what
  // you can pick next. Only `days` triggers a refetch; the rest are applied client-side by the
  // parent.
  import { T, TIER, weight, customActive, type Filters, type UsageReport } from '../../utils/ai-usage'

  export let report: UsageReport
  export let filters: Filters

  const PERIODS: Array<{ d: number, label: string }> = [
    { d: 1, label: '24h' },
    { d: 7, label: '7d' },
    { d: 14, label: '14d' },
    { d: 30, label: '30d' }
  ]

  $: accountOptions = report.accounts.map((a) => ({ value: a.uuid, label: a.label }))

  $: deviceOptions = report.devices.map((d) => ({
    id: d.id,
    value: d.label,
    label: d.os != null && d.os !== '' ? `${d.label} · ${d.os}` : d.label
  }))

  // Projects ordered by total weight, descending, so the busiest project sorts first.
  $: projectOptions = (() => {
    const byW = new Map<string, number>()
    for (const r of report.tokens) {
      byW.set(r[T.project], (byW.get(r[T.project]) ?? 0) + weight(r[T.model], r[T.in], r[T.out], r[T.cw], r[T.cr]))
    }
    return [...byW.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
  })()

  // Same shape as projectOptions: derived from the rows (the PERSON dimension, resolved from
  // the device at report-build time), sorted by weight descending.
  $: personOptions = (() => {
    const byW = new Map<string, number>()
    for (const r of report.tokens) {
      byW.set(r[T.person], (byW.get(r[T.person]) ?? 0) + weight(r[T.model], r[T.in], r[T.out], r[T.cw], r[T.cr]))
    }
    return [...byW.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
  })()

  // Models ordered by tier, most expensive first, matching the ramp used for their swatches.
  $: modelOptions = [...new Set(report.tokens.map((r) => r[T.model]))]
    .sort((a, b) => TIER.indexOf(a) - TIER.indexOf(b))

  // Custom period: two calendar dates in the report zone. The range only takes effect once
  // both are set (customActive), so half-typed dates never fire a fetch; a preset click clears it.
  $: custom = filters.range !== undefined
  $: tzSec = (() => {
    const m = /^([+-])(\d\d)(\d\d)$/.exec(report.tz || '+0000')
    return m === null ? 0 : (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60)
  })()
  function dayStr (ep: number): string { return new Date((ep + tzSec) * 1000).toISOString().slice(0, 10) }
  function openCustom (): void {
    if (filters.range !== undefined) return
    // Start from the currently shown window so the page does not jump.
    filters.range = { from: dayStr(report.window.from), to: dayStr(report.window.to - 1) }
  }
  function preset (d: number): void {
    filters.days = d
    filters.range = undefined
  }
  function reset (): void {
    filters = { account: '*', device: '*', project: '*', person: '*', model: '*', days: 14 }
  }
</script>

<div class="bar">
  <div class="fld">
    <label for="ai-usage-f-account">Account</label>
    <select id="ai-usage-f-account" bind:value={filters.account}>
      <option value="*">All accounts</option>
      {#each accountOptions as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </div>
  <div class="fld">
    <label for="ai-usage-f-device">Device</label>
    <select id="ai-usage-f-device" bind:value={filters.device}>
      <option value="*">All devices</option>
      {#each deviceOptions as opt (opt.id)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </div>
  <div class="fld">
    <label for="ai-usage-f-project">Project</label>
    <select id="ai-usage-f-project" bind:value={filters.project}>
      <option value="*">All projects</option>
      {#each projectOptions as p (p)}
        <option value={p}>{p}</option>
      {/each}
    </select>
  </div>
  <div class="fld">
    <label for="ai-usage-f-person">Person</label>
    <select id="ai-usage-f-person" bind:value={filters.person}>
      <option value="*">All people</option>
      {#each personOptions as p (p)}
        <option value={p}>{p}</option>
      {/each}
    </select>
  </div>
  <div class="fld">
    <label for="ai-usage-f-model">Model</label>
    <select id="ai-usage-f-model" bind:value={filters.model}>
      <option value="*">All models</option>
      {#each modelOptions as m (m)}
        <option value={m}>{m}</option>
      {/each}
    </select>
  </div>
  <div class="fld">
    <span class="fld-label">Period</span>
    <div class="seg" role="group" aria-label="Period">
      {#each PERIODS as p (p.d)}
        <button
          type="button"
          aria-pressed={!custom && filters.days === p.d}
          on:click={() => preset(p.d)}
        >
          {p.label}
        </button>
      {/each}
      <button type="button" aria-pressed={custom} on:click={openCustom}>Custom</button>
    </div>
  </div>
  {#if custom && filters.range !== undefined}
    <div class="fld">
      <label for="ai-usage-f-from">From</label>
      <input id="ai-usage-f-from" type="date" bind:value={filters.range.from} max={filters.range.to || undefined} />
    </div>
    <div class="fld">
      <label for="ai-usage-f-to">To</label>
      <input id="ai-usage-f-to" type="date" bind:value={filters.range.to} min={filters.range.from || undefined} />
    </div>
    {#if !customActive(filters)}
      <span class="hint">pick both dates</span>
    {/if}
  {/if}
  <div class="spacer" />
  <button class="reset" type="button" on:click={reset}>Reset filters</button>
</div>

<style lang="scss">
  .bar {
    display: flex; flex-wrap: wrap; gap: .625rem; align-items: flex-end;
    background: var(--theme-comp-header-color); border: 1px solid var(--theme-divider-color);
    border-radius: .625rem; padding: .75rem .875rem; margin-bottom: 1.25rem;
    position: sticky; top: 0; z-index: 20;
  }
  .fld { display: flex; flex-direction: column; gap: .3125rem; min-width: 0; }
  .fld > label, .fld > .fld-label {
    font-size: .625rem; color: var(--theme-dark-color); text-transform: uppercase;
    letter-spacing: .09em;
  }
  select {
    font: inherit; font-size: .8125rem; color: var(--theme-content-color);
    background: var(--theme-bg-color); border: 1px solid var(--theme-divider-color);
    border-radius: .4375rem; padding: .375rem .5625rem; min-width: 8.25rem;
    appearance: none; cursor: pointer;
  }
  input[type="date"] {
    font: inherit; font-size: .8125rem; color: var(--theme-content-color);
    background: var(--theme-bg-color); border: 1px solid var(--theme-divider-color);
    border-radius: .4375rem; padding: .3125rem .5625rem; min-width: 9.5rem;
  }
  .hint { font-size: .75rem; color: var(--theme-dark-color); align-self: center; padding-bottom: .4rem; }
  select:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--theme-link-color, #2a78d6); outline-offset: 2px; }
  .seg { display: flex; border: 1px solid var(--theme-divider-color); border-radius: .4375rem; overflow: hidden; }
  .seg button {
    font-size: .75rem; border: 0; padding: .4375rem .75rem; background: var(--theme-bg-color);
    color: var(--theme-dark-color); cursor: pointer; border-right: 1px solid var(--theme-divider-color);
  }
  .seg button:last-child { border-right: 0; }
  .seg button[aria-pressed='true'] {
    background: var(--theme-caption-color); color: var(--theme-bg-color); font-weight: 600;
  }
  .spacer { flex: 1 1 auto; min-width: 0; }
  .reset {
    align-self: flex-end; font-size: .75rem; background: none; border: 0;
    color: var(--theme-dark-color); cursor: pointer; text-decoration: underline; padding: .4375rem .125rem;
  }
  @media (max-width: 40rem) {
    .bar { position: static; }
    select { min-width: 0; width: 100%; }
    .fld { flex: 1 1 8.125rem; }
  }
</style>
