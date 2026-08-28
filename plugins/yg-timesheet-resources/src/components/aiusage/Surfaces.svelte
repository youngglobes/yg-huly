<script lang="ts">
  // Terminal vs VS Code vs SDK. Ported from the reference's renderSurface. No cost or account
  // context here, so this component takes only `view`.
  import { A, T, fmtH, fmtM, fmtPct, rollup, sumBy, type filterReport } from '../../utils/ai-usage'

  export let view: ReturnType<typeof filterReport>

  const LABEL: Record<string, string> = { terminal: 'Terminal', vscode: 'VS Code', sdk: 'SDK / scripted' }
  const CV: Record<string, string> = { terminal: '--s1', vscode: '--s3', sdk: '--s4' }

  $: acts = sumBy(view.act, (r) => r[A.surface], (r) => r[A.sec])
  $: agg = rollup(view.tok, (r) => r[T.surface])
  $: tot = [...acts.values()].reduce((a, b) => a + b, 0) || 1
  $: rows = [...new Set([...acts.keys(), ...agg.keys()])]
    .map((k) => ({ k, sec: acts.get(k) ?? 0, a: agg.get(k) ?? { key: k, req: 0, tok: 0, wt: 0 } }))
    .sort((a, b) => b.sec - a.sec)
</script>

<section class="surfaces">
  <div class="head"><h2>Terminal vs VS Code</h2></div>
  <p class="note">Where the work happens, by surface. <code>sdk</code> covers scripted and
    agent-driven runs.</p>

  {#if rows.length === 0}
    <div class="scroll"><div class="empty">No activity in range.</div></div>
  {:else}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Surface</th><th class="bar-cell">Share of active time</th>
            <th class="n">Active h</th><th class="n">Tokens</th><th class="n">Requests</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.k)}
            {@const cv = CV[r.k] ?? '--s8'}
            {@const share = r.sec / tot * 100}
            <tr>
              <td><span class="name"><i class="swatch" style="background: var({cv})" />{LABEL[r.k] ?? r.k}</span></td>
              <td class="bar-cell">
                <div class="barrow">
                  <div class="track"><i style="width: {Math.max(share, 0).toFixed(2)}%; background: var({cv})" /></div>
                  <span class="pct">{fmtPct(share)}</span>
                </div>
              </td>
              <td class="n">{fmtH(r.sec)}</td>
              <td class="n">{fmtM(r.a.tok)}</td>
              <td class="n">{r.a.req.toLocaleString()}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style lang="scss">
  .surfaces {
    --s1: #2a78d6; --s3: #1baf7a; --s4: #eda100; --s8: #e34948;
    margin-bottom: 2.125rem;
  }
  :global(.theme-dark) .surfaces {
    --s1: #3987e5; --s3: #199e70; --s4: #c98500; --s8: #e66767;
  }
  .head { display: flex; align-items: baseline; gap: .625rem; margin-bottom: .1875rem; flex-wrap: wrap; }
  h2 { font-size: .9375rem; font-weight: 600; letter-spacing: -.01em; margin: 0; color: var(--theme-caption-color); }
  .note { color: var(--theme-dark-color); font-size: .75rem; margin: 0 0 .75rem; max-width: 78ch; }
  .note code {
    font-size: .75rem; background: var(--theme-bg-color); border: 1px solid var(--theme-divider-color);
    border-radius: .25rem; padding: .0625rem .3125rem;
  }
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
