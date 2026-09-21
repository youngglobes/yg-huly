<script lang="ts">
  // One row per Claude session in the filtered period: when, how long, who and where, on which
  // surface, how many tokens. Metadata only, straight from the collector's session facts; the
  // conversation itself never leaves the machine and is not available here by design.
  import { fmtM, sessionList, type UsageReport, type filterReport } from '../../utils/ai-usage'

  export let report: UsageReport
  export let view: ReturnType<typeof filterReport>

  const LABEL: Record<string, string> = { terminal: 'Terminal', vscode: 'VS Code', sdk: 'SDK / scripted', cowork: 'Cowork (Desktop)' }
  const PAGE = 100

  $: rows = sessionList(view.sess)
  let shown = PAGE
  $: visible = rows.slice(0, shown)

  // Times in the report's zone, not the browser's, like the rest of the page.
  $: tzSec = (() => {
    const m = /^([+-])(\d\d)(\d\d)$/.exec(report.tz || '+0000')
    return m === null ? 0 : (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60)
  })()
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  function when (ep: number): string {
    const d = new Date((ep + tzSec) * 1000)
    const hh = String(d.getUTCHours()).padStart(2, '0')
    const mm = String(d.getUTCMinutes()).padStart(2, '0')
    return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}:${mm}`
  }
  function dur (sec: number): string {
    if (sec < 60) return `${sec}s`
    const h = Math.floor(sec / 3600)
    const m = Math.round((sec % 3600) / 60)
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
  }
</script>

<section class="sessions">
  <div class="head">
    <h2>Sessions</h2>
    <span class="count">{rows.length.toLocaleString()} in range</span>
  </div>
  <p class="note">Every Claude session in the period, newest first. Start and length come from the
    first and last message of the session; the conversation itself is never collected.</p>

  {#if rows.length === 0}
    <div class="scroll"><div class="empty">No sessions in range.</div></div>
  {:else}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Start ({report.tz})</th><th class="n">Length</th><th>Person</th><th>Device</th>
            <th>Project</th><th>Surface</th><th class="n">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {#each visible as s (s.id + s.dev)}
            <tr>
              <td class="mono">{when(s.first)}</td>
              <td class="n">{dur(s.sec)}</td>
              <td>{s.person}</td>
              <td class="dim">{s.dev}</td>
              <td title={s.cwd}>{s.project}</td>
              <td>{LABEL[s.surface] ?? s.surface}</td>
              <td class="n">{fmtM(s.tok)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if rows.length > shown}
        <button class="more" type="button" on:click={() => { shown += PAGE }}>
          Show {Math.min(PAGE, rows.length - shown)} more of {(rows.length - shown).toLocaleString()} remaining
        </button>
      {/if}
    </div>
  {/if}
</section>

<style lang="scss">
  .sessions { margin-bottom: 2.125rem; }
  .head { display: flex; align-items: baseline; gap: .625rem; margin-bottom: .1875rem; flex-wrap: wrap; }
  h2 { font-size: .9375rem; font-weight: 600; letter-spacing: -.01em; margin: 0; color: var(--theme-caption-color); }
  .count { font-size: .75rem; color: var(--theme-dark-color); }
  .note { color: var(--theme-dark-color); font-size: .75rem; margin: 0 0 .75rem; max-width: 78ch; }
  .scroll { overflow-x: auto; background: var(--theme-comp-header-color); border: 1px solid var(--theme-divider-color); border-radius: .625rem; }
  table { width: 100%; border-collapse: collapse; font-size: .8125rem; min-width: 46rem; }
  th, td { padding: .5rem .8125rem; text-align: left; border-bottom: 1px solid var(--theme-divider-color); vertical-align: middle; }
  thead th {
    font-size: .625rem; color: var(--theme-dark-color); font-weight: 500; text-transform: uppercase;
    letter-spacing: .08em; white-space: nowrap; position: sticky; top: 0; background: var(--theme-comp-header-color);
  }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: var(--theme-bg-color); }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.mono { font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.dim { color: var(--theme-dark-color); }
  .empty { padding: 1.75rem 1rem; text-align: center; color: var(--theme-dark-color); font-size: .8125rem; }
  .more {
    display: block; width: 100%; font: inherit; font-size: .8125rem; color: var(--theme-link-color, #2a78d6);
    background: transparent; border: 0; border-top: 1px solid var(--theme-divider-color); padding: .625rem; cursor: pointer;
  }
  .more:hover { background: var(--theme-bg-color); }
</style>
