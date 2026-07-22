<script lang="ts">
  //
  // Period chooser for the HR Overview export. Defaults to the week currently on screen, so the
  // common case (export what I'm looking at) is Export -> Export: two clicks.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Button, Label } from '@hcengineering/ui'
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
    const [y, m, d] = k.split('-').map((n) => parseInt(n, 10))
    return new Date(y, m - 1, d).getTime()
  }

  $: selected = kind === 'week' ? weekPeriod(parseDay(weekDate)) : monthPeriod(year, month0)
  $: rangeLabel = `${selected.days[0]} → ${selected.days[selected.days.length - 1]}`

  function confirm (): void {
    dispatch('close', selected as Period)
  }
  function cancel (): void {
    dispatch('close', undefined)
  }
</script>

<div class="hr-export-dialog">
  <div class="title"><Label label={ygTimesheet.string.ExportPeriod} /></div>

  <div class="row">
    <Button
      kind={kind === 'week' ? 'primary' : 'regular'}
      label={ygTimesheet.string.PeriodWeekly}
      on:click={() => { kind = 'week' }}
    />
    <Button
      kind={kind === 'month' ? 'primary' : 'regular'}
      label={ygTimesheet.string.PeriodMonthly}
      on:click={() => { kind = 'month' }}
    />
  </div>

  {#if kind === 'week'}
    <div class="row">
      <span class="lbl"><Label label={ygTimesheet.string.SelectWeek} /></span>
      <input type="date" bind:value={weekDate} />
    </div>
  {:else}
    <div class="row">
      <span class="lbl"><Label label={ygTimesheet.string.SelectMonth} /></span>
      <select bind:value={month0}>
        {#each MONTHS as m, i}<option value={i}>{m}</option>{/each}
      </select>
      <select bind:value={year}>
        {#each YEARS as y}<option value={y}>{y}</option>{/each}
      </select>
    </div>
  {/if}

  <!-- Always show the resolved range: the week picker snaps, and the user must see what they get. -->
  <div class="range">{rangeLabel}</div>

  <div class="row actions">
    <Button label={ui.string.Cancel} on:click={cancel} />
    <Button kind="primary" label={ygTimesheet.string.Export} on:click={confirm} />
  </div>
</div>

<style lang="scss">
  .hr-export-dialog {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    min-width: 22rem;
    background: var(--theme-popup-color);
    border-radius: 0.75rem;
  }
  .title { font-weight: 500; }
  .row { display: flex; align-items: center; gap: 0.75rem; }
  .lbl { min-width: 4rem; color: var(--theme-dark-color); }
  .range { color: var(--theme-dark-color); font-size: 0.8125rem; }
  .actions { justify-content: flex-end; }
</style>
