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
  A clickable sort header cell for the shared .yg-table. Renders a <th> with the reusable
  .yg-th-sort / .yg-hcell / .yg-sortarrow classes (defined in yg-table.scss). Forwards the click
  to the parent, which owns the sort state. The chevron is an inline SVG (font-independent) shown
  only when this column is active, pointing down for descending and up for ascending.
-->
<script lang="ts">
  export let active: boolean = false
  export let asc: boolean = false
  export let numeric: boolean = false
</script>

<th class="{numeric ? 'yg-num' : 'left'} yg-th-sort" class:is-sorted={active} on:click>
  <span class="yg-hcell" class:yg-hcell--num={numeric}>
    <slot />
    <svg
      class="yg-sortarrow"
      class:up={active && asc}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 4.5 6 7.5 9 4.5" />
    </svg>
  </span>
</th>
