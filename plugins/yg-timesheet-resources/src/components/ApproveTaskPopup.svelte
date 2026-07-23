<script lang="ts">
  //
  // Approve one task, confirming the hours the approver actually agrees to. Defaults to the
  // submitted hours so the common case (agree as logged) is a single click. Reducing this does
  // NOT rewrite the employee's logged time — it is the approver's overlay.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Button, Label, EditBox } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  export let identifier: string
  export let title: string
  export let submittedHours: number

  const dispatch = createEventDispatcher()
  let hours: number = submittedHours

  $: valid = Number.isFinite(hours) && hours >= 0
</script>

<div class="approve-popup">
  <div class="title">{identifier} — {title}</div>
  <div class="row">
    <span class="lbl"><Label label={ygTimesheet.string.SubmittedHours} /></span>
    <span>{submittedHours}</span>
  </div>
  <div class="row">
    <span class="lbl"><Label label={ygTimesheet.string.ApprovedHours} /></span>
    <EditBox bind:value={hours} format={'number'} />
  </div>
  <div class="row actions">
    <Button label={ui.string.Cancel} on:click={() => dispatch('close', undefined)} />
    <Button
      kind="primary"
      label={ygTimesheet.string.ApproveTask}
      disabled={!valid}
      on:click={() => dispatch('close', { approvedHours: hours })}
    />
  </div>
</div>

<style lang="scss">
  .approve-popup {
    display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; min-width: 22rem;
    background: var(--theme-popup-color); border-radius: 0.75rem;
  }
  .title { font-weight: 500; }
  .row { display: flex; align-items: center; gap: 0.75rem; }
  .lbl { min-width: 9rem; color: var(--theme-dark-color); }
  .actions { justify-content: flex-end; }
</style>
