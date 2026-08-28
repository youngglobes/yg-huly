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
  // Late punch-in with a REQUIRED reason - the employee must explain the late arrival before the
  // punch-in is recorded. Modeled on RejectTaskPopup.svelte (same required-reason dialog shape).
  //
  import { createEventDispatcher } from 'svelte'
  import { translate } from '@hcengineering/platform'
  import ui, { Label, themeStore } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  export let minutesLate: number

  const dispatch = createEventDispatcher()
  let reason: string = ''

  $: valid = reason.trim().length > 0

  // Localized placeholder (also used as the accessible label), same pattern as MyAttendance's note.
  let placeholder = ''
  $: void translate(ygTimesheet.string.LateReasonPlaceholder, {}, $themeStore.language).then((p) => (placeholder = p))
</script>

<div class="dialog">
  <div class="dialog__head">
    <div class="dialog__title"><Label label={ygTimesheet.string.LateReasonLabel} /></div>
    <div class="dialog__sub">{minutesLate} <Label label={ygTimesheet.string.MinutesLate} /></div>
  </div>
  <div class="dialog__body">
    <div class="field field--stack">
      <textarea
        class="reason-input"
        rows="3"
        placeholder={placeholder}
        aria-label={placeholder}
        bind:value={reason}
      />
    </div>
  </div>
  <div class="dialog__foot">
    <button class="yg-btn yg-btn--ghost" on:click={() => dispatch('close', undefined)}>
      <Label label={ui.string.Cancel} />
    </button>
    <button
      class="yg-btn"
      disabled={!valid}
      on:click={() => dispatch('close', { reason: reason.trim() })}
    >
      <Label label={ygTimesheet.string.PunchIn} />
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
