<script lang="ts">
  //
  // Small popup for a clicked calendar day: add a holiday (name it) or remove the existing one.
  //
  import { getClient } from '@hcengineering/presentation'
  import { EditBox, Button, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import core, { type Ref } from '@hcengineering/core'
  import ygTimesheet, { type Holiday } from '@hcengineering/yg-timesheet'

  export let date: number            // local midnight ms of the clicked day
  export let existing: Holiday | undefined = undefined

  const client = getClient()
  const dispatch = createEventDispatcher()
  let name = existing?.name ?? ''

  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date)

  async function add (): Promise<void> {
    const trimmed = name.trim()
    if (trimmed === '') return
    await client.createDoc(ygTimesheet.class.Holiday, core.space.Workspace, { date, name: trimmed })
    dispatch('close')
  }
  async function remove (): Promise<void> {
    if (existing !== undefined) await client.remove(existing)
    dispatch('close')
  }
</script>

<div class="antiPopup" style="padding:12px;min-width:16rem;display:flex;flex-direction:column;gap:10px">
  <div style="font-weight:600">{dateLabel}</div>
  {#if existing === undefined}
    <EditBox bind:value={name} placeholder={ygTimesheet.string.HolidayName} focusIndex={1} autoFocus />
    <Button kind="primary" label={ygTimesheet.string.AddHoliday} on:click={add} />
  {:else}
    <div>{existing.name}</div>
    <Button kind="dangerous" label={ygTimesheet.string.RemoveHoliday} on:click={remove} />
  {/if}
</div>
