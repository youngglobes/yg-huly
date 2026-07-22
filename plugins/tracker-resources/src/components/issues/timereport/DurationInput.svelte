<!--
// Copyright © 2026 YoungGlobes.
-->
<script lang="ts">
  import { EditBox, Label } from '@hcengineering/ui'
  import tracker from '../../../plugin'
  import { toHoursMinutes, fromHoursMinutes, normalizeHoursMinutes } from './timeEntryUtils'

  export let value: number | undefined = undefined
  export let disabled: boolean = false

  // Both fields are capped at two digits. 99 is deliberately above 59 for minutes so the
  // carry-into-hours still works (typing 90 must become 1h 30m). EditBox clamps to maxValue in
  // its own setValue() BEFORE it dispatches change/blur, so anything over 99 arrives here as 99
  // and is then normalised — e.g. 120 becomes 1h 39m rather than being silently accepted.
  const MAX_TWO_DIGITS = 99

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
  //
  // Only reassigns when the value actually changed, so tabbing through an untouched field
  // does not mark the form dirty (the consuming popup writes on `value.value !== data.value`).
  //
  // Known and accepted: a legacy value stored by the old decimal-only input (e.g. a hand-typed
  // 0.333) is not reproducible from this widget's canonical (h*60+m)/60 form, so the first blur
  // normalises it to exactly 20m. That matches what the widget already displays, and only
  // reaches the database if the user saves.
  function commit (): void {
    const normalized = normalizeHoursMinutes(hours, minutes)
    hours = normalized.hours
    minutes = normalized.minutes
    const next = fromHoursMinutes(hours, minutes)
    if (next !== value) {
      value = next
    }
    syncedFrom = value
  }

  /**
   * Block a third digit at the keystroke, so the field simply cannot hold more than two.
   *
   * `maxlength` does nothing on `<input type="number">`, and maxValue only clamps on
   * change/blur — i.e. after the user has already typed 3 digits and watched them appear.
   *
   * Only plain digit keys are blocked: Backspace, Delete, Tab, arrows and any modifier combo
   * (copy/paste/select-all) fall through untouched. If the caret has a selection, the digit
   * replaces it rather than extending, so it is allowed. `selectionStart` throws on number
   * inputs in some browsers, hence the try/catch.
   */
  function blockThirdDigit (event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key.length !== 1 || event.key < '0' || event.key > '9') return

    const input = event.target as HTMLInputElement
    const current = input.value ?? ''
    if (current.length < 2) return

    let hasSelection = false
    try {
      hasSelection = input.selectionStart !== input.selectionEnd
    } catch {
      hasSelection = false
    }
    if (!hasSelection) {
      event.preventDefault()
    }
  }

  // Native number inputs step by 1. Minutes are far more useful stepped by 5.
  function onMinutesKeydown (event: KeyboardEvent): void {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const delta = event.key === 'ArrowUp' ? 5 : -5
      minutes = Math.max(0, (Number.isFinite(minutes) ? minutes : 0) + delta)
      commit()
      return
    }
    blockThirdDigit(event)
  }
</script>

<div class="duration-input flex-row-center">
  <!--
    Each field is its own bordered box with the unit tucked inside, so "h" / "m" read as part
    of the control rather than floating off to the right. The input is sized to its content
    (2.25rem fits 3 digits) — a wider maxWidth reserves space even for a 1-digit value and
    pushes the unit away.
  -->
  <div class="field" class:disabled>
    <EditBox
      bind:value={hours}
      format={'number'}
      minValue={0}
      maxValue={MAX_TWO_DIGITS}
      maxWidth={'1.6rem'}
      kind={'editbox'}
      placeholder={tracker.string.DurationPlaceholder}
      {disabled}
      on:change={commit}
      on:blur={commit}
      on:keydown={blockThirdDigit}
    />
    <span class="unit"><Label label={tracker.string.HourLabel} /></span>
  </div>

  <div class="field" class:disabled>
    <EditBox
      bind:value={minutes}
      format={'number'}
      minValue={0}
      maxValue={MAX_TWO_DIGITS}
      maxWidth={'1.6rem'}
      kind={'editbox'}
      placeholder={tracker.string.DurationPlaceholder}
      {disabled}
      on:change={commit}
      on:blur={commit}
      on:keydown={onMinutesKeydown}
    />
    <span class="unit"><Label label={tracker.string.MinuteLabel} /></span>
  </div>
</div>

<style lang="scss">
  .duration-input {
    gap: 0.5rem;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.375rem;
    background-color: var(--theme-button-default);

    &:focus-within {
      border-color: var(--primary-edit-border-color);
    }
    &.disabled {
      opacity: 0.4;
    }
  }
  .unit {
    color: var(--theme-dark-color);
    font-size: 0.8125rem;
  }
</style>
