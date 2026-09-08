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
  Modern profile primitive (Task 10): the two-column field grid inside a SectionCard, matching the
  approved mockup's `.fields` layout. Also doubles as the edit-mode input grid - a FieldRow's
  read-only display and a plain labeled <input>/<select> share the same grid rhythm.
-->
<script lang="ts">
  export let columns: 1 | 2 = 2
</script>

<div class="yg-fieldgroup" class:yg-fieldgroup--one={columns === 1}>
  <slot />
</div>

<style lang="scss">
  .yg-fieldgroup {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 18px;
  }
  .yg-fieldgroup--one {
    grid-template-columns: 1fr;
  }
</style>
