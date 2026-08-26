<script lang="ts">
  // Six headline numbers. Ported from the reference's renderTiles. Allocated always divides by
  // view.baseW (the selected account's whole period), never by a filtered subtotal.
  import { A, fmtH, fmtM, money, rollup, type Filters, type UsageReport, type filterReport } from '../../utils/ai-usage'

  export let report: UsageReport
  export let view: ReturnType<typeof filterReport>
  export let filters: Filters

  // The plan fee lives on the account, not the page. Sum it over the accounts currently
  // selected: '*' means every account in the report.
  $: planCents = report.accounts
    .filter((a) => filters.account === '*' || a.uuid === filters.account)
    .reduce((t, a) => t + a.plan_cents, 0)
  $: prorated = (planCents / 100) * (filters.days / 30)

  $: tot = [...rollup(view.tok, () => '*').values()][0] ?? { key: '*', req: 0, tok: 0, wt: 0 }
  $: secs = view.act.reduce((a, r) => a + r[A.sec], 0)
  $: allocated = prorated * (view.baseW > 0 ? tot.wt / view.baseW : 0)
  $: allocatedSub = filters.project === '*' && filters.model === '*'
    ? `${filters.days}d of plan fee`
    : `of ${money(prorated)} this period`

  $: tiles = [
    { k: 'Active', v: `${fmtH(secs)} h`, s: 'idle gaps excluded' },
    { k: 'Tokens', v: fmtM(tot.tok), s: 'deduplicated' },
    { k: 'Weighted', v: Math.round(tot.wt).toLocaleString(), s: 'list-price units' },
    { k: 'Allocated', v: money(allocated), s: allocatedSub },
    { k: 'Sessions', v: String(view.sess.length), s: 'started in period' },
    { k: 'Requests', v: tot.req.toLocaleString(), s: 'API calls' }
  ]
</script>

<div class="tiles">
  {#each tiles as t (t.k)}
    <div class="tile">
      <div class="k">{t.k}</div>
      <div class="v">{t.v}</div>
      <div class="s">{t.s}</div>
    </div>
  {/each}
</div>

<style lang="scss">
  .tiles {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(9.875rem, 1fr));
    gap: .625rem; margin-bottom: 1.625rem;
  }
  .tile {
    background: var(--theme-comp-header-color); border: 1px solid var(--theme-divider-color);
    border-radius: .625rem; padding: .8125rem .9375rem;
  }
  .tile .k { font-size: .625rem; color: var(--theme-dark-color); text-transform: uppercase; letter-spacing: .09em; }
  .tile .v {
    font-variant-numeric: tabular-nums; font-size: 1.5625rem; font-weight: 600;
    letter-spacing: -.02em; margin: .3125rem 0 .125rem; color: var(--theme-caption-color);
  }
  .tile .s { font-size: .6875rem; color: var(--theme-dark-color); }
</style>
