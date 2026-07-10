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
  import emojiPlugin from '@hcengineering/emoji'
  import { getEventPositionElement, showPopup } from '@hcengineering/ui'
  import { NodeViewProps } from '../../node-view'
  import NodeViewContent from '../../node-view/NodeViewContent.svelte'
  import NodeViewWrapper from '../../node-view/NodeViewWrapper.svelte'

  export let node: NodeViewProps['node']
  export let editor: NodeViewProps['editor']
  export let updateAttributes: NodeViewProps['updateAttributes']

  $: emoji = (node.attrs.emoji as string) ?? '💡'

  function selectEmoji (event: MouseEvent): void {
    if (!editor.isEditable) return
    showPopup(emojiPlugin.component.EmojiPopup, {}, getEventPositionElement(event), (result) => {
      if (result?.text != null && result.text !== '') {
        updateAttributes({ emoji: result.text })
      }
    })
  }
</script>

<NodeViewWrapper data-type="callout" class="proseCallout" data-emoji={emoji}>
  <button
    class="proseCallout-emoji"
    contenteditable="false"
    tabindex="-1"
    title=""
    on:click|preventDefault|stopPropagation={selectEmoji}
  >
    {emoji}
  </button>
  <NodeViewContent class="proseCallout-content" />
</NodeViewWrapper>
