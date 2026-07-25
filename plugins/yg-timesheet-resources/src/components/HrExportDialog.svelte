<script lang="ts">
  //
  // Period chooser for the HR Overview export. Defaults to the week currently on screen, so the
  // common case (export what I'm looking at) is Export -> Export: two clicks.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { weekPeriod, monthPeriod, type Period } from '../utils/period'

  /** The week currently displayed by HrOverview — used to seed both pickers. */
  export let anchorMs: number

  const dispatch = createEventDispatcher()

  let kind: 'week' | 'month' = 'week'

  // Week picker: a date input that snaps to its containing Mon-Sun week.
  let weekDate: string = weekPeriod(anchorMs).days[0]

  // Month picker, seeded from the anchor.
  const anchor = new Date(anchorMs)
  let year: number = anchor.getFullYear()
  let month0: number = anchor.getMonth()

  // Locale-aware month names — NOT a hardcoded English array. Same Intl approach HrOverview.svelte
  // already uses for its weekday/range headers, so the dialog follows the UI language.
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long' })
  const MONTHS = Array.from({ length: 12 }, (_, i) => monthFmt.format(new Date(2000, i, 1)))
  const YEARS = [anchor.getFullYear() - 1, anchor.getFullYear(), anchor.getFullYear() + 1]

  function parseDay (k: string): number {
    if (!k) return NaN
    const parts = k.split('-').map((n) => parseInt(n, 10))
    if (parts.length !== 3 || !parts.every(isFinite)) return NaN
    const [y, m, d] = parts
    return new Date(y, m - 1, d).getTime()
  }

  $: weekMs = parseDay(weekDate)
  $: selected = kind === 'week' ? (isFinite(weekMs) ? weekPeriod(weekMs) : null) : monthPeriod(year, month0)
  $: rangeLabel = selected ? `${selected.days[0]} → ${selected.days[selected.days.length - 1]}` : ''

  function confirm (): void {
    dispatch('close', selected as Period)
  }
  function cancel (): void {
    dispatch('close', undefined)
  }
</script>

<div class="yg-dialog">
  <div class="yg-dialog__title"><Label label={ygTimesheet.string.ExportPeriod} /></div>

  <div class="yg-seg">
    <button class="yg-seg__opt" class:yg-seg__opt--on={kind === 'week'} on:click={() => { kind = 'week' }}>
      <Label label={ygTimesheet.string.PeriodWeekly} />
    </button>
    <button class="yg-seg__opt" class:yg-seg__opt--on={kind === 'month'} on:click={() => { kind = 'month' }}>
      <Label label={ygTimesheet.string.PeriodMonthly} />
    </button>
  </div>

  {#if kind === 'week'}
    <div class="yg-dialog__row">
      <span class="yg-dialog__label"><Label label={ygTimesheet.string.SelectWeek} /></span>
      <input class="yg-input" type="date" bind:value={weekDate} />
    </div>
  {:else}
    <div class="yg-dialog__row">
      <span class="yg-dialog__label"><Label label={ygTimesheet.string.SelectMonth} /></span>
      <select class="yg-input" bind:value={month0}>
        {#each MONTHS as m, i}<option value={i}>{m}</option>{/each}
      </select>
      <select class="yg-input" bind:value={year}>
        {#each YEARS as y}<option value={y}>{y}</option>{/each}
      </select>
    </div>
  {/if}

  <!-- Always show the resolved range: the week picker snaps, and the user must see what they get. -->
  <div class="yg-dialog__range">{rangeLabel}</div>

  <div class="yg-dialog__actions">
    <button class="yg-btn yg-btn--ghost" on:click={cancel}><Label label={ui.string.Cancel} /></button>
    <button class="yg-btn yg-btn--primary" on:click={confirm} disabled={kind === 'week' && !isFinite(weekMs)}>
      <Label label={ygTimesheet.string.Export} />
    </button>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;
</style>
