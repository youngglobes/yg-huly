<script lang="ts">
  import core from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import ui, { Label } from '@hcengineering/ui'
  import ygTimesheet, { type AttendanceReminderSettings } from '@hcengineering/yg-timesheet'
  import { DEFAULT_REMINDER_CONFIG } from '../utils/reminder'

  const client = getClient()
  const query = createQuery()
  let doc: AttendanceReminderSettings | undefined
  let form = { ...DEFAULT_REMINDER_CONFIG }
  query.query(ygTimesheet.class.AttendanceReminderSettings, {}, (res) => {
    doc = res[0]
    if (doc !== undefined) {
      form = {
        enabled: doc.enabled,
        windowStartMin: doc.windowStartMin,
        windowEndMin: doc.windowEndMin,
        days: [...doc.days],
        punchInDelayMin: doc.punchInDelayMin,
        repeatMin: doc.repeatMin,
        punchOutIdleMin: doc.punchOutIdleMin
      }
    }
  })

  const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  const toMin = (v: string): number => {
    const [h, m] = v.split(':').map((n) => parseInt(n, 10))
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)
  }
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  function toggleDay (d: number): void {
    form.days = form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d].sort((a, b) => a - b)
  }

  let saving = false
  async function save (): Promise<void> {
    saving = true
    try {
      if (doc !== undefined) {
        await client.updateDoc(ygTimesheet.class.AttendanceReminderSettings, core.space.Workspace, doc._id, { ...form })
      } else {
        await client.createDoc(ygTimesheet.class.AttendanceReminderSettings, core.space.Workspace, { ...form })
      }
    } finally {
      saving = false
    }
  }
</script>

<div class="yg-page">
  <div class="yg-head"><h1 class="yg-title"><Label label={ygTimesheet.string.ReminderSettings} /></h1></div>
  <div class="rs-form">
    <label class="rs-row"><span><Label label={ygTimesheet.string.Enabled} /></span>
      <input type="checkbox" bind:checked={form.enabled} /></label>
    <label class="rs-row"><span><Label label={ygTimesheet.string.WorkWindow} /></span>
      <span><input class="yg-input" type="time" value={hhmm(form.windowStartMin)} on:change={(e) => (form.windowStartMin = toMin(e.currentTarget.value))} />
        -
        <input class="yg-input" type="time" value={hhmm(form.windowEndMin)} on:change={(e) => (form.windowEndMin = toMin(e.currentTarget.value))} /></span></label>
    <div class="rs-row"><span><Label label={ygTimesheet.string.WorkDays} /></span>
      <span class="rs-days">{#each DOW as name, d}
        <button class="rs-day" class:on={form.days.includes(d)} on:click={() => toggleDay(d)}>{name}</button>
      {/each}</span></div>
    <label class="rs-row"><span><Label label={ygTimesheet.string.PunchInDelay} /></span>
      <input class="yg-input rs-num" type="number" min="1" bind:value={form.punchInDelayMin} /></label>
    <label class="rs-row"><span><Label label={ygTimesheet.string.RepeatEvery} /></span>
      <input class="yg-input rs-num" type="number" min="1" bind:value={form.repeatMin} /></label>
    <label class="rs-row"><span><Label label={ygTimesheet.string.PunchOutIdle} /></span>
      <input class="yg-input rs-num" type="number" min="1" bind:value={form.punchOutIdleMin} /></label>
    <div class="rs-actions">
      <button class="yg-btn yg-btn--primary" disabled={saving} on:click={save}><Label label={ui.string.Save} /></button>
    </div>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;
  .rs-form { display: flex; flex-direction: column; gap: 14px; max-width: 520px; padding: 1rem 1.25rem; }
  .rs-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .rs-row > span:first-child { color: var(--yg-text-dim); font-size: 13px; }
  .rs-num { width: 80px; }
  .rs-days { display: inline-flex; gap: 4px; }
  .rs-day { appearance: none; border: 1px solid var(--yg-border); background: var(--yg-panel-soft); color: var(--yg-text-dim); border-radius: 7px; padding: 5px 9px; font: inherit; font-size: 12px; cursor: pointer; }
  .rs-day.on { background: var(--yg-ink); color: var(--yg-ink-fg); border-color: transparent; }
  .rs-actions { margin-top: 6px; }
</style>
