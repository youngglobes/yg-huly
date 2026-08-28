<script lang="ts">
  //
  // Read-only month calendar of org holidays (marked + named) with today highlighted. Employees view it
  // on My Attendance; HR manages holidays via HrHolidays.svelte. Reuses the MonthCalendar + midOf idiom.
  //
  import { MonthCalendar } from '@hcengineering/ui'
  import { createQuery } from '@hcengineering/presentation'
  import ygTimesheet, { type Holiday } from '@hcengineering/yg-timesheet'

  const query = createQuery()
  let holidays: Holiday[] = []
  query.query(ygTimesheet.class.Holiday, {}, (res) => { holidays = res })

  $: byDay = new Map<number, Holiday>(holidays.map((h) => [h.date, h]))
  const midOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

  let current = new Date()
  function shiftMonth (delta: number): void {
    current = new Date(current.getFullYear(), current.getMonth() + delta, 1)
  }
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
</script>

<div class="holcal">
  <div class="holcal__bar">
    <button class="holcal__nav" on:click={() => shiftMonth(-1)} aria-label="Previous month">{'<'}</button>
    <span class="holcal__month">{monthFmt.format(current)}</span>
    <button class="holcal__nav" on:click={() => shiftMonth(1)} aria-label="Next month">{'>'}</button>
  </div>
  <MonthCalendar currentDate={current} selectedDate={current} weekFormat="short">
    <svelte:fragment slot="cell" let:date let:today let:wrongMonth>
      {@const h = byDay.get(midOf(date))}
      <div class="holcal__cell" class:today class:wrong={wrongMonth} class:is-hol={h !== undefined}>
        <span class="holcal__num">{date.getDate()}</span>
        {#if h !== undefined}<span class="holcal__name">{h.name}</span>{/if}
      </div>
    </svelte:fragment>
  </MonthCalendar>
</div>

<style lang="scss">
  .holcal { border: 1px solid var(--theme-divider-color); border-radius: 12px; overflow: hidden; background: var(--theme-comp-header-color); }
  .holcal__bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--theme-divider-color); }
  .holcal__month { font-weight: 620; color: var(--theme-caption-color); }
  .holcal__nav { border: 1px solid var(--theme-divider-color); background: var(--theme-button-default); color: var(--theme-content-color); width: 26px; height: 26px; border-radius: 7px; cursor: pointer; line-height: 1; }
  .holcal__nav:hover { color: var(--theme-caption-color); }
  .holcal__cell { position: relative; width: 100%; height: 100%; min-height: 40px; display: flex; flex-direction: column; align-items: flex-start; padding: 3px 5px; cursor: default; }
  .holcal__cell.wrong { color: var(--theme-trans-color); }
  .holcal__cell.today .holcal__num { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; border-radius: 999px; background: var(--primary-color-skyblue); color: #fff; font-weight: 700; }
  .holcal__cell.is-hol { background: var(--theme-won-color, var(--theme-button-default)); }
  .holcal__num { font-size: 12px; }
  .holcal__name { font-size: 9px; font-weight: 600; color: var(--theme-caption-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
</style>
