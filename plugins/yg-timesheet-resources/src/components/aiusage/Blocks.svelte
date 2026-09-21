<script lang="ts">
  // 5-hour session blocks. Ported from the reference's renderBlocks, via buildWindows() so the
  // window-reconstruction logic lives in exactly one place (utils/ai-usage.ts).
  //
  // Deliberate difference from the reference: the 5-hour limit is per Anthropic account, so a
  // block table that merges accounts would not describe any real limit window. When more than
  // one account is in the report and none is singled out, this renders a sentence instead.
  import { buildWindows, fmtH, fmtM, fmtPct, modelVar, sessionList, usedOf5h, type Filters, type UsageReport, type filterReport } from '../../utils/ai-usage'

  export let report: UsageReport
  export let view: ReturnType<typeof filterReport>
  export let filters: Filters

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

  // Per-window breakdown: the sessions alive in the window, biggest first, so "which session ate
  // this window" has an answer. Toggled per window; collapsed by default to keep the table short.
  const SURFACE: Record<string, string> = { terminal: 'Terminal', vscode: 'VS Code', sdk: 'SDK / scripted', cowork: 'Cowork (Desktop)' }
  let open = new Set<number>()
  function toggle (start: number): void {
    if (open.has(start)) open.delete(start)
    else open.add(start)
    open = open
  }
  $: allSessions = sessionList(view.sess)
  function sessionsOf (ids: Set<string>): ReturnType<typeof sessionList> {
    return allSessions.filter((s) => ids.has(s.id)).sort((a, b) => b.tok - a.tok)
  }
  function dur (sec: number): string {
    if (sec < 60) return `${sec}s`
    const h = Math.floor(sec / 3600)
    const m = Math.round((sec % 3600) / 60)
    return h > 0 ? `${h}h ${D2(m)}m` : `${m}m`
  }
</script>

<section class="blocks">
  <div class="head"><h2>5-hour session blocks</h2></div>
  <p class="note">Your Max limit resets on a rolling 5-hour window. Each row is one window, with
    the share each model took inside it. Windows are reconstructed from activity gaps, so they
    approximate rather than mirror Anthropic's server-side reset clock. <b>Used</b> is active time
    against 5 h per machine that was active in the window (active time adds up across machines).
    Click a window to see the sessions inside it, largest first.</p>

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
            {@const used = usedOf5h(w)}
            {@const pct = Math.min(used, 100)}
            {@const cvar = pct >= 90 ? '--crit' : pct >= 70 ? '--warn' : '--good'}
            {@const ms = [...w.models.entries()].sort((a, b) => b[1] - a[1])}
            {@const mt = ms.reduce((a, b) => a + b[1], 0) || 1}
            {@const isOpen = open.has(w.start)}
            <tr class="win" class:is-open={isOpen} on:click={() => toggle(w.start)}>
              <td>
                <span class="chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                <span class="daylabel">{dayShort(w.start)}</span><br />
                <span class="timelabel">{hhmm(w.start)}-{hhmm(w.last + 3600)}</span>
              </td>
              <td class="bar-cell">
                <div class="barrow">
                  <div class="track"><i style="width: {pct.toFixed(2)}%; background: var({cvar})" /></div>
                  <span class="pct">{fmtPct(used)}</span>
                </div>
                {#if w.devs.size > 1}<span class="devs">of {w.devs.size} machines</span>{/if}
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
            {#if isOpen}
              {@const inside = sessionsOf(w.sess)}
              <tr class="detail">
                <td colspan="6">
                  {@const byProject = [...w.projects.entries()].sort((a, b) => b[1] - a[1])}
                  <div class="byproj">
                    <span class="byproj__label">Tokens in this window by project:</span>
                    {#each byProject as [p, t] (p)}
                      <span class="chip">{p} <b>{fmtM(t)}</b> {fmtPct(t / (w.tok || 1) * 100)}</span>
                    {/each}
                  </div>
                  {#if inside.length === 0}
                    <div class="dempty">No session rows for this window.</div>
                  {:else}
                    <table class="inner">
                      <thead>
                        <tr><th>Session project</th><th>Person</th><th>Device</th><th>Surface</th><th>Started</th><th class="n">Length</th><th class="n">Tokens, whole session</th></tr>
                      </thead>
                      <tbody>
                        {#each inside as s (s.id + s.dev)}
                          <tr>
                            <td title={s.cwd}>{s.project}</td>
                            <td>{s.person}</td>
                            <td class="dim">{s.dev}</td>
                            <td>{SURFACE[s.surface] ?? s.surface}</td>
                            <td class="mono">{dayShort(s.first)} {hhmm(s.first)}</td>
                            <td class="n">{dur(s.sec)}</td>
                            <td class="n">{fmtM(s.tok)}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                    <div class="dnote">A session can outlive the window (it runs from its first message to its last), so its
                      token count is for its whole life; the by-project line above is exact for these five hours.</div>
                  {/if}
                </td>
              </tr>
            {/if}
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
  tr.win { cursor: pointer; }
  tr.win.is-open td { border-bottom: 0; }
  .chev { display: inline-block; width: .9rem; font-size: .7rem; color: var(--theme-dark-color); }
  .devs { display: block; font-size: .625rem; color: var(--theme-dark-color); margin-top: .125rem; }
  tr.detail > td { padding: 0 .8125rem .75rem 2rem; background: var(--theme-bg-color); }
  tr.detail:hover { background: transparent; }
  .dempty { padding: .5rem 0; font-size: .75rem; color: var(--theme-dark-color); }
  .byproj { display: flex; flex-wrap: wrap; gap: .375rem; align-items: center; padding: .625rem 0 .5rem; font-size: .75rem; }
  .byproj__label { color: var(--theme-dark-color); margin-right: .25rem; }
  .byproj .chip b { font-weight: 600; margin: 0 .2rem; }
  .dnote { font-size: .6875rem; color: var(--theme-dark-color); padding: .5rem 0 0; max-width: 80ch; }
  table.inner { min-width: 0; font-size: .75rem; background: var(--theme-comp-header-color);
    border: 1px solid var(--theme-divider-color); border-radius: .5rem; overflow: hidden; }
  table.inner th, table.inner td { padding: .375rem .625rem; }
  table.inner thead th { position: static; font-size: .5625rem; }
  table.inner tbody tr:last-child td { border-bottom: 0; }
  td.dim { color: var(--theme-dark-color); }
  td.mono { font-variant-numeric: tabular-nums; white-space: nowrap; }
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
