<script lang="ts">
  // Models used, ranked by share of weighted usage. Ported from the reference's renderModels.
  // Cost divides by view.baseW, never by the filtered subtotal.
  import { T, modelVar, rollup, type Filters, type UsageReport, type filterReport } from '../../utils/ai-usage'

  export let report: UsageReport
  export let view: ReturnType<typeof filterReport>
  export let filters: Filters

  const fmtM = (n: number): string => (n / 1e6 >= 100 ? (n / 1e6).toFixed(0) : (n / 1e6).toFixed(1)) + 'M'
  const fmtPct = (p: number): string => (p >= 9.95 ? p.toFixed(0) : p.toFixed(1)) + '%'
  const money = (n: number): string => '$' + (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2))

  $: planCents = report.accounts
    .filter((a) => filters.account === '*' || a.uuid === filters.account)
    .reduce((t, a) => t + a.plan_cents, 0)
  $: prorated = (planCents / 100) * (filters.days / 30)

  $: agg = rollup(view.tok, (r) => r[T.model])
  $: rows = [...agg.values()].sort((a, b) => b.wt - a.wt)
  $: totW = view.baseW > 0 ? view.baseW : 1
  $: mx = rows.length > 0 ? rows[0].wt / totW * 100 : 1
</script>

<section class="models">
  <div class="head"><h2>Models used</h2></div>
  <p class="note">Shaded by tier, darker is the more expensive model. <b>Weighted</b> prices
    tokens at published list rates.</p>

  {#if rows.length === 0}
    <div class="scroll"><div class="empty">No models in range.</div></div>
  {:else}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Model</th><th class="bar-cell">Share of weighted</th><th class="n">Requests</th>
            <th class="n">Tokens</th><th class="n">Weighted</th><th class="n">Cost</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.key)}
            {@const share = r.wt / totW * 100}
            {@const cv = modelVar(r.key)}
            <tr>
              <td><span class="name"><i class="swatch" style="background: var({cv})" />{r.key}</span></td>
              <td class="bar-cell">
                <div class="barrow">
                  <div class="track"><i style="width: {Math.max(share / (mx || 1) * 100, 0).toFixed(2)}%; background: var({cv})" /></div>
                  <span class="pct">{fmtPct(share)}</span>
                </div>
              </td>
              <td class="n">{r.req.toLocaleString()}</td>
              <td class="n">{fmtM(r.tok)}</td>
              <td class="n">{Math.round(r.wt).toLocaleString()}</td>
              <td class="n">{money(prorated * r.wt / totW)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style lang="scss">
  .models {
    --m1: #104281; --m2: #184f95; --m3: #2a78d6; --m4: #6da7ec; --m5: #86b6ef;
    margin-bottom: 2.125rem;
  }
  :global(.theme-dark) .models {
    --m1: #256abf; --m2: #2a78d6; --m3: #3987e5; --m4: #6da7ec; --m5: #9ec5f4;
  }
  .head { display: flex; align-items: baseline; gap: .625rem; margin-bottom: .1875rem; flex-wrap: wrap; }
  h2 { font-size: .9375rem; font-weight: 600; letter-spacing: -.01em; margin: 0; color: var(--theme-caption-color); }
  .note { color: var(--theme-dark-color); font-size: .75rem; margin: 0 0 .75rem; max-width: 78ch; }
  .note :global(b) { color: var(--theme-content-color); font-weight: 600; }
  .scroll { overflow-x: auto; background: var(--theme-comp-header-color); border: 1px solid var(--theme-divider-color); border-radius: .625rem; }
  table { width: 100%; border-collapse: collapse; font-size: .8125rem; min-width: 40rem; }
  th, td { padding: .5625rem .8125rem; text-align: left; border-bottom: 1px solid var(--theme-divider-color); vertical-align: middle; }
  thead th {
    font-size: .625rem; color: var(--theme-dark-color); font-weight: 500; text-transform: uppercase;
    letter-spacing: .08em; white-space: nowrap; position: sticky; top: 0; background: var(--theme-comp-header-color);
  }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: var(--theme-bg-color); }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .name { display: flex; align-items: center; gap: .5rem; font-weight: 500; white-space: nowrap; }
  .swatch { width: .5625rem; height: .5625rem; border-radius: .125rem; flex: none; display: inline-block; }
  .bar-cell { min-width: 10.5rem; }
  .barrow { display: flex; align-items: center; gap: .5625rem; }
  .barrow .track { flex: 1; min-width: 4rem; }
  .pct { font-variant-numeric: tabular-nums; font-size: .6875rem; color: var(--theme-dark-color); min-width: 2.5rem; text-align: right; flex: none; }
  .track { background: var(--theme-divider-color); border-radius: .1875rem; height: .5625rem; position: relative; overflow: hidden; }
  .track > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: .1875rem; }
  .empty { padding: 1.75rem 1rem; text-align: center; color: var(--theme-dark-color); font-size: .8125rem; }
</style>
