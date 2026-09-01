<script lang="ts">
  import { Scroller } from '@hcengineering/ui'
  import { usageGet } from '../utils/ai-usage-api'
  import { filterReport, type Filters, type UsageReport } from '../utils/ai-usage'
  import FilterBar from './aiusage/FilterBar.svelte'
  import Tiles from './aiusage/Tiles.svelte'
  import ProjectLedger from './aiusage/ProjectLedger.svelte'
  import Blocks from './aiusage/Blocks.svelte'
  import Surfaces from './aiusage/Surfaces.svelte'
  import Models from './aiusage/Models.svelte'

  let filters: Filters = { account: '*', device: '*', project: '*', person: '*', model: '*', days: 14 }
  let report: UsageReport | undefined
  let error: string | undefined
  // Set instead of `error` for a 401: this is an expected, everyday outcome now that the app
  // icon is visible to every workspace User (not just admins), so it gets a calm, distinct
  // treatment rather than the red error banner.
  let forbidden: string | undefined
  let loading = true
  let loadedDays = -1

  // Only `days` hits the network. Account, device, project, person and model are applied in
  // filterReport over the rows already in hand, so changing a filter is instant.
  $: if (filters.days !== loadedDays) { void load(filters.days) }

  // The sidecar attaches the real HTTP status to err.status (see ai-usage-api.ts). Branch on
  // that status, never on the error message text, since that prose can change.
  async function load (days: number): Promise<void> {
    loadedDays = days
    loading = true
    error = undefined
    forbidden = undefined
    try {
      const r = await usageGet(`/report?days=${days}`)
      // Loud on drift: a future sidecar change to the envelope shape must fail here, not render
      // silent undefined values further down the page.
      if (r?.report_schema !== 1) throw new Error(`Unsupported report schema: ${String(r?.report_schema)}`)
      report = r
    } catch (e: any) {
      if (e?.status === 401) {
        forbidden = 'You do not have access to AI Usage. Ask a workspace owner to add you as a viewer.'
      } else {
        error = e?.message ?? 'Could not reach the usage service.'
      }
      report = undefined
    } finally {
      loading = false
    }
  }

  $: view = report === undefined ? undefined : filterReport(report, filters)
  $: stale = report?.stats?.stale_devices ?? []
  $: duplicates = report?.stats?.duplicate_devices ?? []
</script>

<Scroller>
  <div class="ai-usage">
    <h1>AI Usage</h1>
    <p class="lede">Where the shared Max plan actually goes, by device, project and model.
      Tokens are deduplicated by message and request id; active hours partition the timeline,
      so per-project time sums to real wall-clock and can be invoiced as-is.</p>

    {#if loading}
      <div class="state">Loading usage...</div>
    {:else if forbidden !== undefined}
      <div class="state">{forbidden}</div>
    {:else if error !== undefined}
      <div class="state err">{error}</div>
    {:else if report !== undefined && view !== undefined}
      {#if duplicates.length > 0}
        <div class="state warn">
          {duplicates.join(', ')} reported by more than one enrolled device.
          Usage for that machine is being counted twice. Revoke the duplicate in Configuration.
        </div>
      {/if}

      {#if stale.length > 0}
        <div class="state warn">
          No usage received from {stale.join(', ')} in over 24 hours.
          Check that machine's scheduled task.
        </div>
      {/if}

      <FilterBar {report} bind:filters />

      {#if view.tok.length === 0 && view.act.length === 0}
        <div class="state">No usage matches these filters.</div>
      {:else}
        <Tiles {report} {view} {filters} />
        <ProjectLedger {report} {view} {filters} />
        <Blocks {report} {view} {filters} />
        <Surfaces {view} />
        <Models {report} {view} {filters} />
      {/if}

      <p class="foot">
        {#if filters.model !== '*'}
          <b>Model filter is on.</b> Active hours and sessions have no per-model dimension in the
          logs, so those two columns show the buckets in which {filters.model} ran, not time spent
          on that model alone. Tokens, weighted and cost are exact.
        {/if}
        Tokens and active time are read from Claude Code's own logs, deduplicated by
        (message.id, requestId), because the raw logs replay every message that survives a session
        resume or compaction, which inflates a naive count about 2 times.
        <b>Weighted</b> prices tokens at published list rates; on a Max plan you pay nothing per
        token, so it is a relative measure of who burned the shared limit, not a bill.
        <b>Cost</b> divides the plan fee by that share. Times shown in {report.tz}.
      </p>
    {/if}
  </div>
</Scroller>

<style lang="scss">
  .ai-usage { padding: 1.5rem 1.25rem 4rem; max-width: 72rem; margin: 0 auto; }
  h1 { font-size: 1.3rem; font-weight: 700; margin: 0 0 .25rem; }
  .lede { color: var(--theme-dark-color); font-size: .85rem; margin: 0 0 1.25rem; max-width: 68ch; }
  .state { padding: 1.75rem 1rem; text-align: center; color: var(--theme-dark-color);
    border: 1px solid var(--theme-divider-color); border-radius: .5rem; margin-bottom: 1rem; }
  .state.err { color: var(--theme-error-color); }
  .state.warn { color: var(--theme-warning-color); text-align: left; }
  .foot { color: var(--theme-dark-color); font-size: .75rem; line-height: 1.65;
    border-top: 1px solid var(--theme-divider-color); padding-top: .9rem; margin-top: 2.25rem;
    max-width: 82ch; }
  .foot :global(b) { color: var(--theme-content-color); font-weight: 600; }
</style>
