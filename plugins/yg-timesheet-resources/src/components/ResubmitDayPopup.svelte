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
  // Shown before a resubmit of a day that has rejected tasks (backlog item 4). One optional reply
  // per rejected task: the employee may leave any or all blank and still resubmit. Only issues
  // still present in the day are listed - one the employee dropped is not being resubmitted, so
  // there is nothing to reply to and its cycle stays open (see utils/day.ts submitDay).
  //
  import { createEventDispatcher } from 'svelte'
  import ui, { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  // Local (not `export`): in Svelte `export` on a script declaration means "prop".
  interface RejectedRow {
    issue: string
    identifier: string
    title: string
    hours: string
    reason: string
    rejectedBy: string
  }

  export let dayLabel: string
  export let rows: RejectedRow[] = []

  const dispatch = createEventDispatcher()
  const notes: Record<string, string> = {}

  function confirm (): void {
    const out = new Map<string, string>()
    for (const row of rows) {
      const note = (notes[row.issue] ?? '').trim()
      if (note !== '') out.set(row.issue, note)
    }
    dispatch('close', { notes: out })
  }
</script>

<div class="dialog">
  <div class="dialog__head">
    <div class="dialog__title"><Label label={ygTimesheet.string.Resubmit} /></div>
    <div class="dialog__sub">{dayLabel}</div>
  </div>
  <div class="dialog__body">
    {#each rows as row (row.issue)}
      <div class="row">
        <div class="row__head">
          <span class="yg-idbadge">{row.identifier}</span>
          <span class="row__title">{row.title}</span>
          <span class="spacer" />
          <span class="row__hrs">{row.hours}</span>
        </div>
        <div class="row__reason">
          {#if row.rejectedBy !== ''}
            Rejected by {row.rejectedBy}: "{row.reason}"
          {:else}
            Rejected: "{row.reason}"
          {/if}
        </div>
        <span class="lbl">Your reply (optional)</span>
        <textarea
          class="reason-input"
          rows="2"
          placeholder="What did you change?"
          bind:value={notes[row.issue]}
        />
      </div>
    {/each}
  </div>
  <div class="dialog__foot">
    <button class="yg-btn yg-btn--ghost" on:click={() => dispatch('close', undefined)}>
      <Label label={ui.string.Cancel} />
    </button>
    <button class="yg-btn yg-btn--primary" on:click={confirm}>
      <Label label={ygTimesheet.string.Resubmit} />
    </button>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;

  .dialog {
    width: 440px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--yg-panel);
    border: 1px solid var(--yg-border-strong);
    border-radius: 14px;
    box-shadow: 0 24px 60px rgba(10, 12, 25, 0.32);
    overflow: hidden;
  }
  .dialog__head { padding: 16px 18px 6px; flex: none; }
  .dialog__title { font-weight: 660; font-size: 15px; letter-spacing: -0.01em; }
  .dialog__sub { font-size: 12.5px; color: var(--yg-text-faint); margin-top: 2px; }
  .dialog__body {
    padding: 12px 18px 4px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
  }
  .row { display: flex; flex-direction: column; gap: 6px; }
  .row__head { display: flex; align-items: center; gap: 8px; }
  .row__title { font-size: 13px; color: var(--yg-text); }
  .row__hrs { font-size: 12.5px; color: var(--yg-text-dim); }
  .row__reason { font-size: 12.5px; color: var(--yg-text-dim); }
  .lbl { font-size: 12.5px; color: var(--yg-text-faint); }
  .spacer { flex: 1; }
  .reason-input {
    resize: vertical;
    min-height: 3rem;
    border: 1px solid var(--yg-border-strong);
    border-radius: 8px;
    background: var(--yg-panel-soft);
    color: var(--yg-text);
    font: inherit;
    font-size: 13px;
    padding: 8px 10px;
  }
  .reason-input:focus { outline: none; border-color: var(--yg-text-faint); }
  .dialog__foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 18px; flex: none; }
</style>
