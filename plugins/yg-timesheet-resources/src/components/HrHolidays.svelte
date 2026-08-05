<script lang="ts">
  //
  // HR "Holidays" special: a month calendar to mark org-wide holidays (one per day) + a list of the
  // year's holidays. Writes ygTimesheet.class.Holiday in core.space.Workspace (world-readable). Feeds
  // isWorkingDay everywhere (a holiday is a non-working day).
  //
  import { Label, MonthCalendar, showPopup, eventToHTMLElement } from '@hcengineering/ui'
  import { createQuery } from '@hcengineering/presentation'
  import ygTimesheet, { type Holiday } from '@hcengineering/yg-timesheet'
  import HolidayEditPopup from './HolidayEditPopup.svelte'

  const query = createQuery()
  let holidays: Holiday[] = []
  query.query(ygTimesheet.class.Holiday, {}, (res) => { holidays = res })

  // date (local midnight ms) -> Holiday, for O(1) calendar lookups.
  $: byDay = new Map<number, Holiday>(holidays.map((h) => [h.date, h]))
  const midOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

  let current = new Date() // month shown
  function shiftMonth (delta: number): void {
    current = new Date(current.getFullYear(), current.getMonth() + delta, 1)
  }

  function onDay (d: Date, ev: MouseEvent): void {
    const mid = midOf(d)
    showPopup(HolidayEditPopup, { date: mid, existing: byDay.get(mid) }, eventToHTMLElement(ev))
  }

  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
  const listFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  $: sorted = [...holidays].sort((a, b) => a.date - b.date)
</script>

<div class="dash yg-page">
  <div class="yg-head">
    <h1 class="yg-title"><Label label={ygTimesheet.string.Holidays} /></h1>
  </div>
  <div class="hol-body">
    <div class="hol-cal">
      <div class="hol-monthbar">
        <button class="yg-btn yg-btn--ghost" on:click={() => shiftMonth(-1)}>{'<'}</button>
        <span class="hol-month">{monthFmt.format(current)}</span>
        <button class="yg-btn yg-btn--ghost" on:click={() => shiftMonth(1)}>{'>'}</button>
      </div>
      <!-- MonthCalendar's own cell click bubbles up as `change`; we handle day clicks on the inner
           .hol-cell instead, so on:change here is intentionally a no-op. -->
      <MonthCalendar currentDate={current} selectedDate={current} on:change={() => {}}>
        <svelte:fragment slot="cell" let:date let:today let:wrongMonth>
          {@const h = byDay.get(midOf(date))}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="hol-cell" class:today class:wrong={wrongMonth} class:is-hol={h !== undefined} on:click={(ev) => onDay(date, ev)}>
            <span class="hol-num">{date.getDate()}</span>
            {#if h !== undefined}<span class="hol-name">{h.name}</span>{/if}
          </div>
        </svelte:fragment>
      </MonthCalendar>
    </div>
    <div class="hol-list">
      <div class="hol-list__head"><Label label={ygTimesheet.string.Holidays} /></div>
      {#each sorted as h (h._id)}
        <div class="hol-item">
          <span class="hol-item__date">{listFmt.format(h.date)}</span>
          <span class="hol-item__name">{h.name}</span>
        </div>
      {:else}
        <div class="hol-empty"><Label label={ygTimesheet.string.EmptyHolidays} /></div>
      {/each}
    </div>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;
  .dash { flex: 1; min-width: 0; }
  .hol-body { display: flex; gap: 16px; padding: 1rem; align-items: flex-start; flex-wrap: wrap; }
  .hol-cal { flex: 1; min-width: 320px; max-width: 640px; border: 1px solid var(--yg-border); border-radius: var(--yg-radius); overflow: hidden; background: var(--yg-panel); }
  .hol-monthbar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--yg-border); }
  .hol-month { font-weight: 640; }
  .hol-cell { position: relative; width: 100%; height: 100%; min-height: 56px; display: flex; flex-direction: column; align-items: flex-start; padding: 4px 6px; cursor: pointer; }
  .hol-cell.wrong { color: var(--yg-text-faint); }
  .hol-cell.today .hol-num { font-weight: 800; color: var(--yg-ink); }
  .hol-cell.is-hol { background: var(--yg-red-bg, var(--yg-panel-soft)); }
  .hol-num { font-size: 12px; }
  .hol-name { font-size: 10px; font-weight: 600; color: var(--yg-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .hol-list { flex: 0 0 260px; }
  .hol-list__head { font-weight: 640; margin-bottom: 8px; }
  .hol-item { display: flex; justify-content: space-between; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--yg-border); font-size: 13px; }
  .hol-item__name { font-weight: 600; }
  .hol-empty { color: var(--yg-text-faint); font-size: 13px; padding: 8px 4px; }
</style>
