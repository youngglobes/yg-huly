<!--
// Copyright © 2026 YoungGlobes
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  //
  // Approve one task, confirming the hours the approver actually agrees to. Defaults to the
  // submitted hours so the common case (agree as logged) is a single click. Reducing this does
  // NOT rewrite the employee's logged time — it is the approver's overlay.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Label } from '@hcengineering/ui'
  import { formatHours } from '../utils/week'

  export let identifier: string
  export let title: string
  export let submittedHours: number
  // Not currently passed by Approvals.svelte's showPopup call (its wiring is unchanged) — kept
  // optional so the sub-line can include the employee whenever a future caller provides it.
  export let employee: string | undefined = undefined
  // Context for setting approved hours (2026-07-29): the issue's estimation (hours) and the
  // employee's spent-time notes for this task. Both optional so older callers still work.
  export let estimation: number | undefined = undefined
  export let notes: string[] = []

  const dispatch = createEventDispatcher()
  let hours: number = submittedHours

  $: valid = Number.isFinite(hours) && hours >= 0
  $: sub = employee !== undefined ? `${identifier} · ${title} · ${employee}` : `${identifier} · ${title}`
  // Guard against a mid-edit invalid/empty numeric input — formatHours(NaN) would otherwise
  // print "NaNm" on the (disabled) button for a moment while the field is being cleared.
  $: approveLabel = valid ? `Approve ${formatHours(hours)}` : 'Approve'
</script>

<div class="dialog">
  <div class="dialog__head">
    <div class="dialog__title">Approve time</div>
    <div class="dialog__sub">{sub}</div>
  </div>
  <div class="dialog__body">
    <div class="field">
      <span class="lbl">Submitted</span>
      <span class="val">{formatHours(submittedHours)}</span>
    </div>
    {#if estimation !== undefined}
      <div class="field">
        <span class="lbl">Estimated</span>
        <span class="val">{formatHours(estimation)}</span>
      </div>
    {/if}
    {#if notes.length > 0}
      <div class="notes">
        <span class="notes__lbl">Spent-time notes</span>
        <ul class="notes__list">
          {#each notes as n}<li>{n}</li>{/each}
        </ul>
      </div>
    {/if}
    <div class="field">
      <span class="lbl">Approve hours</span>
      <span class="hours-input">
        <input type="number" min="0" step="0.25" bind:value={hours} aria-label="Approved hours" />
        <span class="unit">h</span>
      </span>
    </div>
  </div>
  <div class="dialog__note">
    Set the hours you're approving for this task. This won't change the employee's logged time.
  </div>
  <div class="dialog__foot">
    <button class="yg-btn yg-btn--ghost" on:click={() => dispatch('close', undefined)}>
      <Label label={ui.string.Cancel} />
    </button>
    <button
      class="yg-btn yg-btn--primary"
      disabled={!valid}
      on:click={() => dispatch('close', { approvedHours: hours })}
    >
      {approveLabel}
    </button>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;

  .dialog {
    width: 380px;
    background: var(--yg-panel);
    border: 1px solid var(--yg-border-strong);
    border-radius: 14px;
    box-shadow: 0 24px 60px rgba(10, 12, 25, 0.32);
    overflow: hidden;
  }
  .dialog__head { padding: 16px 18px 6px; }
  .dialog__title { font-weight: 660; font-size: 15px; letter-spacing: -0.01em; }
  .dialog__sub { font-size: 12.5px; color: var(--yg-text-faint); margin-top: 2px; }
  .dialog__body { padding: 12px 18px 4px; display: flex; flex-direction: column; gap: 12px; }
  .field { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .field .lbl { font-size: 13px; color: var(--yg-text-dim); }
  .field .val { font-variant-numeric: tabular-nums; font-weight: 600; }
  .notes { display: flex; flex-direction: column; gap: 5px; }
  .notes__lbl { font-size: 13px; color: var(--yg-text-dim); }
  .notes__list {
    margin: 0; padding: 8px 10px 8px 24px; list-style: disc;
    background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 8px;
    max-height: 120px; overflow-y: auto;
  }
  .notes__list li { font-size: 13px; color: var(--yg-text); margin: 2px 0; }
  .hours-input {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--yg-border-strong);
    border-radius: 8px;
    overflow: hidden;
  }
  .hours-input input {
    width: 56px;
    border: 0;
    background: transparent;
    color: var(--yg-text);
    font: inherit;
    font-weight: 650;
    text-align: right;
    padding: 7px 4px;
    font-variant-numeric: tabular-nums;
  }
  .hours-input .unit { padding: 0 10px 0 2px; color: var(--yg-text-faint); font-size: 13px; }
  .dialog__note { font-size: 12px; color: var(--yg-text-faint); padding: 10px 18px 0; }
  .dialog__foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 18px; }
</style>
