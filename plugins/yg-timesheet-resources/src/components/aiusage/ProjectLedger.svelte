<script lang="ts">
  // Project ledger: one row per project, ranked by share of weighted usage. Ported from the
  // reference's renderProjects. Cost divides the prorated plan fee by view.baseW, never by the
  // filtered subtotal, so a single-project filter can't read as "consumed the whole plan".
  import {
    A, S, T, fmtH, fmtM, fmtPct, modelVar, money, rollup, sumBy, weight,
    type Filters, type UsageReport, type filterReport
  } from '../../utils/ai-usage'

  export let report: UsageReport
  export let view: ReturnType<typeof filterReport>
  export let filters: Filters

  $: planCents = report.accounts
    .filter((a) => filters.account === '*' || a.uuid === filters.account)
    .reduce((t, a) => t + a.plan_cents, 0)
  $: prorated = (planCents / 100) * (filters.days / 30)

  // Colour follows the project, fixed by its overall (unfiltered) weight, so a filter never
  // repaints the projects that survive it.
  $: projColor = (() => {
    const byW = rollup(report.tokens, (r) => r[T.project])
    const ranked = [...byW.values()].sort((a, b) => b.wt - a.wt)
    const m = new Map<string, string>()
    ranked.forEach((r, i) => m.set(r.key, `--s${Math.min(i + 1, 8)}`))
    return m
  })()

  $: agg = rollup(view.tok, (r) => r[T.project])
  $: acts = sumBy(view.act, (r) => r[A.project], (r) => r[A.sec])
  $: sessN = (() => {
    const m = new Map<string, number>()
    for (const s of view.sess) m.set(s[S.project], (m.get(s[S.project]) ?? 0) + 1)
    return m
  })()

  // Per-project model split, for the Models chip column. This calls weight() directly (the
  // exported pricing function) because rollup only groups by one key, and the chips need
  // project x model.
  $: perProjectModels = (() => {
    const pm = new Map<string, Map<string, number>>()
    for (const r of view.tok) {
      const k = r[T.project]
      let inner = pm.get(k)
      if (inner === undefined) { inner = new Map(); pm.set(k, inner) }
      const w = weight(r[T.model], r[T.in], r[T.out], r[T.cw], r[T.cr])
      inner.set(r[T.model], (inner.get(r[T.model]) ?? 0) + w)
    }
    return pm
  })()

  $: totW = view.baseW > 0 ? view.baseW : 1
  $: rows = [...agg.values()].sort((a, b) => b.wt - a.wt)
  $: selW = rows.reduce((a, r) => a + r.wt, 0)
  $: totT = rows.reduce((a, r) => a + r.tok, 0)
  $: totS = [...acts.values()].reduce((a, b) => a + b, 0)
  $: maxShare = rows.length > 0 ? rows[0].wt / totW * 100 : 0
  $: filtered = filters.project !== '*' || filters.model !== '*'

  interface Chip { model: string, pct: number }
  function chipsFor (project: string): Chip[] {
    const inner = [...(perProjectModels.get(project) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    const iw = inner.reduce((a, b) => a + b[1], 0) || 1
    return inner.map(([model, w]) => ({ model, pct: w / iw * 100 }))
  }
</script>

<section class="ledger">
  <div class="head"><h2>Project ledger</h2><span class="tag">Main</span></div>
  <p class="note">Ranked by share of weighted usage. <b>Cost</b> allocates the plan fee across
    projects by that share, prorated to the selected period, time worked and cost carried side
    by side.</p>

  {#if rows.length === 0}
    <div class="scroll"><div class="empty">No usage matches these filters.</div></div>
  {:else}
    <div class="legend">
      {#each rows as r (r.key)}
        <span><i class="swatch" style="background: var({projColor.get(r.key) ?? '--s8'})" />{r.key}</span>
      {/each}
    </div>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Project</th><th class="bar-cell">Share</th><th class="n">Active h</th>
            <th class="n">Tokens</th><th class="n">Cost</th><th class="n">Sessions</th><th>Models</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.key)}
            {@const share = r.wt / totW * 100}
            {@const cv = projColor.get(r.key) ?? '--s8'}
            <tr>
              <td><span class="name"><i class="swatch" style="background: var({cv})" />{r.key}</span></td>
              <td class="bar-cell">
                <div class="barrow">
                  <div class="track"><i style="width: {Math.max(share / (maxShare || 1) * 100, 0).toFixed(2)}%; background: var({cv})" /></div>
                  <span class="pct">{fmtPct(share)}</span>
                </div>
              </td>
              <td class="n">{fmtH(acts.get(r.key) ?? 0)}</td>
              <td class="n">{fmtM(r.tok)}</td>
              <td class="n">{money(prorated * r.wt / totW)}</td>
              <td class="n">{sessN.get(r.key) ?? 0}</td>
              <td>
                <div class="chips">
                  {#each chipsFor(r.key) as c (c.model)}
                    <span class="chip"><i style="background: var({modelVar(c.model)})" />{c.model} {fmtPct(c.pct)}</span>
                  {/each}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <td>{filtered ? 'Selected' : 'Total'}</td>
            <td class="bar-cell">
              <div class="barrow">
                <div class="track"><i style="width: {(selW / totW * 100).toFixed(2)}%; background: var(--theme-dark-color)" /></div>
                <span class="pct">{fmtPct(selW / totW * 100)}</span>
              </div>
            </td>
            <td class="n">{fmtH(totS)}</td>
            <td class="n">{fmtM(totT)}</td>
            <td class="n">{money(prorated * selW / totW)}</td>
            <td class="n">{view.sess.length}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  {/if}
</section>

<style lang="scss">
  .ledger {
    --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
    --s5: #e87ba4; --s6: #008300; --s7: #4a3aa7; --s8: #e34948;
    --m1: #104281; --m2: #184f95; --m3: #2a78d6; --m4: #6da7ec; --m5: #86b6ef;
    margin-bottom: 2.125rem;
  }
  :global(.theme-dark) .ledger {
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
    --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
    --m1: #256abf; --m2: #2a78d6; --m3: #3987e5; --m4: #6da7ec; --m5: #9ec5f4;
  }
  .head { display: flex; align-items: baseline; gap: .625rem; margin-bottom: .1875rem; flex-wrap: wrap; }
  h2 { font-size: .9375rem; font-weight: 600; letter-spacing: -.01em; margin: 0; color: var(--theme-caption-color); }
  .tag {
    font-size: .5625rem; letter-spacing: .1em; text-transform: uppercase; padding: .125rem .4375rem;
    border-radius: 1.25rem; background: var(--theme-caption-color); color: var(--theme-bg-color); font-weight: 600;
  }
  .note { color: var(--theme-dark-color); font-size: .75rem; margin: 0 0 .75rem; max-width: 78ch; }
  .legend { display: flex; flex-wrap: wrap; gap: .75rem; margin: 0 0 .6875rem; font-size: .75rem; color: var(--theme-dark-color); }
  .legend span { display: flex; align-items: center; gap: .375rem; }
  .scroll { overflow-x: auto; background: var(--theme-comp-header-color); border: 1px solid var(--theme-divider-color); border-radius: .625rem; }
  table { width: 100%; border-collapse: collapse; font-size: .8125rem; min-width: 40rem; }
  th, td { padding: .5625rem .8125rem; text-align: left; border-bottom: 1px solid var(--theme-divider-color); vertical-align: middle; }
  thead th {
    font-size: .625rem; color: var(--theme-dark-color); font-weight: 500; text-transform: uppercase;
    letter-spacing: .08em; white-space: nowrap; position: sticky; top: 0; background: var(--theme-comp-header-color);
  }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: var(--theme-bg-color); }
  tfoot td { border-top: 1px solid var(--theme-divider-color); border-bottom: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .name { display: flex; align-items: center; gap: .5rem; font-weight: 500; white-space: nowrap; }
  .swatch { width: .5625rem; height: .5625rem; border-radius: .125rem; flex: none; display: inline-block; }
  .bar-cell { min-width: 10.5rem; }
  .barrow { display: flex; align-items: center; gap: .5625rem; }
  .barrow .track { flex: 1; min-width: 4rem; }
  .pct { font-variant-numeric: tabular-nums; font-size: .6875rem; color: var(--theme-dark-color); min-width: 2.5rem; text-align: right; flex: none; }
  .track { background: var(--theme-divider-color); border-radius: .1875rem; height: .5625rem; position: relative; overflow: hidden; }
  .track > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: .1875rem; }
  .chips { display: flex; flex-wrap: wrap; gap: .25rem; }
  .chip {
    font-size: .65625rem; color: var(--theme-dark-color); border: 1px solid var(--theme-divider-color);
    border-radius: 1.25rem; padding: .0625rem .4375rem; white-space: nowrap;
  }
  .chip i { display: inline-block; width: .4375rem; height: .4375rem; border-radius: .125rem; margin-right: .3125rem; vertical-align: baseline; }
  .empty { padding: 1.75rem 1rem; text-align: center; color: var(--theme-dark-color); font-size: .8125rem; }
</style>
