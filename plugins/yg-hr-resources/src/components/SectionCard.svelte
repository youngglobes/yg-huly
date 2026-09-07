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
  Modern profile primitive (Task 10): a titled card with an uppercase label, matching the approved
  mockup's `.card h3` treatment. An optional `actions` slot holds the per-card Edit/Save/Cancel
  affordance - editing is gated per card, not globally, so each card owns its own edit state and
  just renders its actions here.
-->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'

  export let label: IntlString
  export let full: boolean = false
</script>

<div class="yg-card" class:yg-card--full={full}>
  <div class="yg-card__head">
    <h3 class="yg-card__title"><Label {label} /></h3>
    <div class="yg-card__actions"><slot name="actions" /></div>
  </div>
  <div class="yg-card__body"><slot /></div>
</div>

<style lang="scss">
  .yg-card {
    background: var(--theme-panel-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 14px;
    padding: 18px 20px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  .yg-card--full {
    grid-column: 1 / -1;
  }
  .yg-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .yg-card__title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--theme-halfcontent-color);
  }
  .yg-card__actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  .yg-card__body {
    margin-top: 12px;
  }
</style>
