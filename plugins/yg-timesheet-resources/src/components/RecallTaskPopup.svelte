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
  // Confirm before recalling an approval or rejection: the task goes back to pending approval.
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  export let identifier: string
  export let employeeName: string
  export let dateLabel: string
  export let wasApproved: boolean

  const dispatch = createEventDispatcher()
  $: params = { identifier, employee: employeeName, date: dateLabel }
</script>

<div class="dialog">
  <div class="dialog__head">
    <div class="dialog__title"><Label label={ygTimesheet.string.Recall} /></div>
    <div class="dialog__sub">{identifier} · {employeeName} · {dateLabel}</div>
  </div>
  <div class="dialog__body">
    <Label
      label={wasApproved ? ygTimesheet.string.RecallApprovalConfirm : ygTimesheet.string.RecallRejectionConfirm}
      {params}
    />
  </div>
  <div class="dialog__foot">
    <button class="yg-btn yg-btn--ghost" on:click={() => dispatch('close', undefined)}>
      <Label label={ui.string.Cancel} />
    </button>
    <button class="yg-btn yg-btn--danger" on:click={() => dispatch('close', { confirmed: true })}>
      <Label label={ygTimesheet.string.Recall} />
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
  .dialog__foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 18px; }
</style>
