<!--
// Copyright © 2026 YoungGlobes.
-->
<script lang="ts">
  import { EditBox, Label } from '@hcengineering/ui'
  import tracker from '../../../plugin'
  import { toHoursMinutes, fromHoursMinutes, normalizeHoursMinutes } from './timeEntryUtils'

  export let value: number | undefined = undefined
  export let disabled: boolean = false
  export let autoFocus: boolean = false

  let hours: number = 0
  let minutes: number = 0
  // Guards against the reactive statement below clobbering the fields while the user types.
  let syncedFrom: number | undefined

  // Pull: decompose an externally-set `value` (edit mode, or a preset chip) into the fields.
  $: if (value !== syncedFrom) {
    const parts = toHoursMinutes(value)
    hours = parts.hours
    minutes = parts.minutes
    syncedFrom = value
  }

  // Push: recompose the fields into `value`, carrying minutes >= 60 into hours.
  function commit (): void {
    const normalized = normalizeHoursMinutes(hours, minutes)
    hours = normalized.hours
    minutes = normalized.minutes
    const next = fromHoursMinutes(hours, minutes)
    syncedFrom = next
    value = next
  }

  // Native number inputs step by 1. Minutes are far more useful stepped by 5.
  function onMinutesKeydown (event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const delta = event.key === 'ArrowUp' ? 5 : -5
    minutes = Math.max(0, (Number.isFinite(minutes) ? minutes : 0) + delta)
    commit()
  }
</script>

<div class="duration-input flex-row-center">
  <EditBox
    bind:value={hours}
    format={'number'}
    minValue={0}
    maxWidth={'3.5rem'}
    kind={'editbox'}
    {disabled}
    {autoFocus}
    on:change={commit}
    on:blur={commit}
  />
  <span class="unit" class:disabled><Label label={tracker.string.HourLabel} /></span>

  <EditBox
    bind:value={minutes}
    format={'number'}
    minValue={0}
    maxWidth={'3.5rem'}
    kind={'editbox'}
    {disabled}
    on:change={commit}
    on:blur={commit}
    on:keydown={onMinutesKeydown}
  />
  <span class="unit" class:disabled><Label label={tracker.string.MinuteLabel} /></span>
</div>

<style lang="scss">
  .duration-input {
    gap: 0.375rem;
  }
  .unit {
    margin-right: 0.75rem;
    color: var(--theme-dark-color);
    font-size: 0.8125rem;

    &.disabled {
      opacity: 0.4;
    }
  }
</style>
