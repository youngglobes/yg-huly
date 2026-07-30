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
  // Reject one task with a REQUIRED reason — the employee needs to know what to fix. Only this
  // task returns to Draft; sibling tasks already approved by another lead are untouched.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  export let identifier: string
  export let title: string
  // Not currently passed by Approvals.svelte's showPopup call (its wiring is unchanged) — kept
  // optional so the sub-line can include the employee whenever a future caller provides it.
  export let employee: string | undefined = undefined

  const dispatch = createEventDispatcher()
  let reason: string = ''

  $: valid = reason.trim().length > 0
  $: sub = employee !== undefined ? `${identifier} · ${title} · ${employee}` : `${identifier} · ${title}`
</script>

<div class="dialog">
  <div class="dialog__head">
    <div class="dialog__title">Reject time</div>
    <div class="dialog__sub">{sub}</div>
  </div>
  <div class="dialog__body">
    <div class="field field--stack">
      <span class="lbl"><Label label={ygTimesheet.string.RejectReason} /></span>
      <textarea
        class="reason-input"
        rows="3"
        placeholder="What needs fixing before this can be approved?"
        bind:value={reason}
      />
    </div>
  </div>
  <div class="dialog__foot">
    <button class="yg-btn yg-btn--ghost" on:click={() => dispatch('close', undefined)}>
      <Label label={ui.string.Cancel} />
    </button>
    <button
      class="yg-btn yg-btn--danger"
      disabled={!valid}
      on:click={() => dispatch('close', { reason: reason.trim() })}
    >
      <Label label={ygTimesheet.string.Reject} />
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
  .field--stack { display: flex; flex-direction: column; align-items: stretch; gap: 6px; }
  .field--stack .lbl { font-size: 13px; color: var(--yg-text-dim); }
  .reason-input {
    resize: vertical;
    min-height: 4.5rem;
    border: 1px solid var(--yg-border-strong);
    border-radius: 8px;
    background: var(--yg-panel-soft);
    color: var(--yg-text);
    font: inherit;
    font-size: 13px;
    padding: 8px 10px;
  }
  .reason-input:focus { outline: none; border-color: var(--yg-text-faint); }
  .dialog__foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 18px; }
</style>
