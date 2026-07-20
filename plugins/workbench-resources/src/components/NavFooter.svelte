<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import { Component, navFooterExtensions } from '@hcengineering/ui'

  export let split: boolean = false

  $: extensions = [...$navFooterExtensions].sort((a, b) => a.order - b.order)
  $: hasContent = extensions.length > 0 || split || $$slots.default
</script>

{#if hasContent}
  <div class="antiNav-footer-line" />
  <div class="antiNav-footer-grower" />
  <div class="antiNav-footer">
    <slot />
    {#each extensions as ext (ext.id)}
      <Component is={ext.component} props={ext.props ?? {}} />
    {/each}
    {#if split}<div class="antiNav-space" />{/if}
  </div>
{/if}
