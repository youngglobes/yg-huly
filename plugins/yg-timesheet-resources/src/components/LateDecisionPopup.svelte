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
  // Approve or reject one late permission with an OPTIONAL HR reason. One popup for both decisions
  // (the `approve` prop flips the title, the confirm label, and the button style). Used ONLY via a
  // direct showPopup() from HrLatePermissions.svelte - no component ref, no resources registration.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  export let approve: boolean = false

  const dispatch = createEventDispatcher()
  let reason: string = ''
  $: action = approve ? ygTimesheet.string.ApproveLate : ygTimesheet.string.RejectLate
</script>

<div class="dialog">
  <div class="dialog__head">
    <div class="dialog__title"><Label label={action} /></div>
  </div>
  <div class="dialog__body">
    <div class="field field--stack">
      <span class="lbl"><Label label={ygTimesheet.string.HrReason} /></span>
      <textarea class="reason-input" rows="3" bind:value={reason} />
    </div>
  </div>
  <div class="dialog__foot">
    <button class="yg-btn yg-btn--ghost" on:click={() => dispatch('close', undefined)}>
      <Label label={ui.string.Cancel} />
    </button>
    <button
      class="yg-btn {approve ? 'yg-btn--primary' : 'yg-btn--danger'}"
      on:click={() => dispatch('close', { reason: reason.trim() })}
    >
      <Label label={action} />
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
