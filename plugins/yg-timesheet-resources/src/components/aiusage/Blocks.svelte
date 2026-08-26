<script lang="ts">
  // 5-hour session blocks. Ported from the reference's renderBlocks, via buildWindows() so the
  // window-reconstruction logic lives in exactly one place (utils/ai-usage.ts).
  //
  // Deliberate difference from the reference: the 5-hour limit is per Anthropic account, so a
  // block table that merges accounts would not describe any real limit window. When more than
  // one account is in the report and none is singled out, this renders a sentence instead.
  import { buildWindows, modelVar, type Filters, type UsageReport, type filterReport } from '../../utils/ai-usage'

  export let report: UsageReport
  export let view: ReturnType<typeof filterReport>
  export let filters: Filters

  const fmtM = (n: number): string => (n / 1e6 >= 100 ? (n / 1e6).toFixed(0) : (n / 1e6).toFixed(1)) + 'M'
  const fmtH = (s: number): string => (s / 3600).toFixed(2)
  const fmtPct = (p: number): string => (p >= 9.95 ? p.toFixed(0) : p.toFixed(1)) + '%'
  const D2 = (n: number): string => String(n).padStart(2, '0')
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  // Render an epoch (seconds, UTC) in the capture timezone, carried on the report so every
  // viewer reads the same clock the work happened on.
  $: tzSec = (() => {
    const m = /^([+-])(\d\d)(\d\d)$/.exec(report.tz || '+0000')
    if (m == null) return 0
    const sign = m[1] === '-' ? -1 : 1
    return sign * (Number(m[2]) * 3600 + Number(m[3]) * 60)
  })()
  function parts (ep: number): Date { return new Date((ep + tzSec) * 1000) }
  function hhmm (ep: number): string { const d = parts(ep); return `${D2(d.getUTCHours())}:${D2(d.getUTCMinutes())}` }
  function dayShort (ep: number): string {
    const d = parts(ep)
    return `${DAY_NAMES[d.getUTCDay()]} ${D2(d.getUTCDate())} ${MONTH_NAMES[d.getUTCMonth()]}`
  }

  $: merged = report.accounts.length > 1 && filters.account === '*'
  $: windows = merged ? [] : buildWindows(view.tok, view.act, view.sess).slice().reverse().filter((w) => w.tok > 0)
</script>

<section class="blocks">
  <div class="head"><h2>5-hour session blocks</h2></div>
  <p class="note">Your Max limit resets on a rolling 5-hour window. Each row is one window, with
    the share each model took inside it. Windows are reconstructed from activity gaps, so they
    approximate rather than mirror Anthropic's server-side reset clock.</p>

  {#if merged}
    <div class="scroll">
      <div class="empty">Select one account to see its 5-hour blocks. The limit window is per
        account, so merging accounts here would not mean anything.</div>
    </div>
  {:else if windows.length === 0}
    <div class="scroll"><div class="empty">No windows in range.</div></div>
  {:else}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Window</th><th class="bar-cell">Used of 5h</th><th class="n">Active</th>
            <th class="n">Tokens</th><th class="bar-cell">Model split</th><th class="n">Sess</th>
          </tr>
        </thead>
        <tbody>
          {#each windows as w (w.start)}
            {@const pct = Math.min(w.sec / 18000 * 100, 100)}
            {@const cvar = pct >= 90 ? '--crit' : pct >= 70 ? '--warn' : '--good'}
            {@const ms = [...w.models.entries()].sort((a, b) => b[1] - a[1])}
            {@const mt = ms.reduce((a, b) => a + b[1], 0) || 1}
            <tr>
              <td>
                <span class="daylabel">{dayShort(w.start)}</span><br />
                <span class="timelabel">{hhmm(w.start)}-{hhmm(w.last + 3600)}</span>
              </td>
              <td class="bar-cell">
                <div class="barrow">
                  <div class="track"><i style="width: {pct.toFixed(2)}%; background: var({cvar})" /></div>
                  <span class="pct">{fmtPct(w.sec / 18000 * 100)}</span>
                </div>
              </td>
              <td class="n">{fmtH(w.sec)}</td>
              <td class="n">{fmtM(w.tok)}</td>
              <td class="bar-cell">
                <div class="stack">
                  {#each ms as [m, t] (m)}
                    <i style="width: {(t / mt * 100).toFixed(2)}%; background: var({modelVar(m)})" title="{m} {fmtPct(t / mt * 100)}" />
                  {/each}
                </div>
                <div class="chips">
                  {#each ms.slice(0, 3) as [m, t] (m)}
                    <span class="chip"><i style="background: var({modelVar(m)})" />{m} {fmtPct(t / mt * 100)}</span>
                  {/each}
                </div>
              </td>
              <td class="n">{w.sess.size}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style lang="scss">
  .blocks {
    --m1: #104281; --m2: #184f95; --m3: #2a78d6; --m4: #6da7ec; --m5: #86b6ef;
    --good: #1baf7a; --warn: #eda100; --crit: #e34948;
    margin-bottom: 2.125rem;
  }
  :global(.theme-dark) .blocks {
    --m1: #256abf; --m2: #2a78d6; --m3: #3987e5; --m4: #6da7ec; --m5: #9ec5f4;
    --good: #199e70; --warn: #c98500; --crit: #e66767;
  }
  .head { display: flex; align-items: baseline; gap: .625rem; margin-bottom: .1875rem; flex-wrap: wrap; }
  h2 { font-size: .9375rem; font-weight: 600; letter-spacing: -.01em; margin: 0; color: var(--theme-caption-color); }
  .note { color: var(--theme-dark-color); font-size: .75rem; margin: 0 0 .75rem; max-width: 78ch; }
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
  .daylabel { font-size: .75rem; }
  .timelabel { font-size: .6875rem; color: var(--theme-dark-color); font-variant-numeric: tabular-nums; }
  .bar-cell { min-width: 10.5rem; }
  .barrow { display: flex; align-items: center; gap: .5625rem; }
  .barrow .track { flex: 1; min-width: 4rem; }
  .pct { font-variant-numeric: tabular-nums; font-size: .6875rem; color: var(--theme-dark-color); min-width: 2.5rem; text-align: right; flex: none; }
  .track { background: var(--theme-divider-color); border-radius: .1875rem; height: .5625rem; position: relative; overflow: hidden; }
  .track > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: .1875rem; }
  .stack { display: flex; height: .6875rem; border-radius: .1875rem; overflow: hidden; background: var(--theme-divider-color); min-width: 8.125rem; gap: .125rem; }
  .stack > i { display: block; height: 100%; border-radius: .125rem; }
  .chips { display: flex; flex-wrap: wrap; gap: .25rem; margin-top: .3125rem; }
  .chip {
    font-size: .65625rem; color: var(--theme-dark-color); border: 1px solid var(--theme-divider-color);
    border-radius: 1.25rem; padding: .0625rem .4375rem; white-space: nowrap;
  }
  .chip i { display: inline-block; width: .4375rem; height: .4375rem; border-radius: .125rem; margin-right: .3125rem; vertical-align: baseline; }
  .empty { padding: 1.75rem 1rem; text-align: center; color: var(--theme-dark-color); font-size: .8125rem; }
</style>
