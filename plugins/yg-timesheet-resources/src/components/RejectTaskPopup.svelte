<script lang="ts">
  //
  // Reject one task with a REQUIRED reason — the employee needs to know what to fix. Only this
  // task returns to Draft; sibling tasks already approved by another lead are untouched.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Button, Label, EditBox } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  export let identifier: string
  export let title: string

  const dispatch = createEventDispatcher()
  let reason: string = ''

  $: valid = reason.trim().length > 0
</script>

<div class="reject-popup">
  <div class="title">{identifier} — {title}</div>
  <div class="row">
    <span class="lbl"><Label label={ygTimesheet.string.RejectReason} /></span>
    <EditBox bind:value={reason} placeholder={ygTimesheet.string.RejectReason} />
  </div>
  <div class="row actions">
    <Button label={ui.string.Cancel} on:click={() => dispatch('close', undefined)} />
    <Button
      kind="dangerous"
      label={ygTimesheet.string.RejectTask}
      disabled={!valid}
      on:click={() => dispatch('close', { reason: reason.trim() })}
    />
  </div>
</div>

<style lang="scss">
  .reject-popup {
    display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; min-width: 24rem;
    background: var(--theme-popup-color); border-radius: 0.75rem;
  }
  .title { font-weight: 500; }
  .row { display: flex; align-items: center; gap: 0.75rem; }
  .lbl { min-width: 5rem; color: var(--theme-dark-color); }
  .actions { justify-content: flex-end; }
</style>
