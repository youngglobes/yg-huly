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
<!--
  Modern profile primitive (Task 10): a single read-only label+value pair. An empty value renders
  the muted `emptyLabel` (defaults to "Not set", as the mockup's `.v.empty` rows do; a field can
  override it - e.g. Job's Contract end shows "Open" instead). The default slot, when used, replaces
  the auto value rendering entirely (badges/chips in the Job tab); `labelSuffix` adds a small badge
  next to the label itself (the Contact tab's "from login" lock on Work email).
-->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  import ygHr from '@hcengineering/yg-hr'

  export let label: IntlString
  export let value: string | undefined | null = undefined
  export let mono: boolean = false
  export let full: boolean = false
  export let emptyLabel: IntlString = ygHr.string.NotSet
  // Slot content (badges/chips) can be passed even when there's nothing to show, so presence of
  // the default slot alone can't decide emptiness - callers using the slot pass this explicitly.
  export let empty: boolean | undefined = undefined

  $: isEmpty = empty ?? (!$$slots.default && (value === undefined || value === null || value === ''))
</script>

<div class="yg-field" class:yg-field--full={full}>
  <div class="yg-field__label">
    <Label {label} />
    <slot name="labelSuffix" />
  </div>
  {#if isEmpty}
    <div class="yg-field__value yg-field__value--empty"><Label label={emptyLabel} /></div>
  {:else if $$slots.default}
    <div class="yg-field__value" class:mono><slot /></div>
  {:else}
    <div class="yg-field__value" class:mono>{value}</div>
  {/if}
</div>

<style lang="scss">
  .yg-field--full {
    grid-column: 1 / -1;
  }
  .yg-field__label {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: var(--theme-trans-color);
    margin-bottom: 2px;
  }
  .yg-field__value {
    font-size: 14.5px;
    color: var(--theme-content-color);
    font-weight: 500;
  }
  .yg-field__value.mono {
    font-family: var(--theme-font-mono, ui-monospace, monospace);
    font-variant-numeric: tabular-nums;
  }
  .yg-field__value--empty {
    color: var(--theme-trans-color);
    font-weight: 400;
  }
</style>
