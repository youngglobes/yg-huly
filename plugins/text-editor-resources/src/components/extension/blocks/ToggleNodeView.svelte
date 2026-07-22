<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
  import { NodeViewProps } from '../../node-view'
  import NodeViewContent from '../../node-view/NodeViewContent.svelte'
  import NodeViewWrapper from '../../node-view/NodeViewWrapper.svelte'

  export let node: NodeViewProps['node']
  export let editor: NodeViewProps['editor']
  export let updateAttributes: NodeViewProps['updateAttributes']

  // In read-only views the toggle still folds/unfolds, just without touching the document
  let localOpen: boolean | undefined = undefined
  $: open = localOpen ?? (node.attrs.open === true)

  function toggleOpen (): void {
    const next = !open
    localOpen = next
    if (editor.isEditable) {
      updateAttributes({ open: next })
    }
  }
</script>

<NodeViewWrapper class="proseToggle" data-open={open ? 'true' : 'false'}>
  <button
    class="proseToggle-chevron"
    contenteditable="false"
    tabindex="-1"
    aria-expanded={open}
    on:click|preventDefault|stopPropagation={toggleOpen}
  >
    <svg class="proseToggle-chevron-icon" viewBox="0 0 16 16" width="12" height="12">
      <path d="M6 3.5 L11 8 L6 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  </button>
  <NodeViewContent class="proseToggle-body" />
</NodeViewWrapper>
