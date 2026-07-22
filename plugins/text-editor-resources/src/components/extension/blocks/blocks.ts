//
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
//

import { CalloutNode, ColumnListNode, ColumnNode, ToggleContentNode, ToggleNode, ToggleSummaryNode } from '@hcengineering/text'
import { TextSelection } from '@tiptap/pm/state'

import { SvelteNodeViewRenderer } from '../../node-view'
import CalloutNodeView from './CalloutNodeView.svelte'
import ToggleNodeView from './ToggleNodeView.svelte'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    notionBlocks: {
      insertCallout: (pos: number) => ReturnType
      insertToggle: (pos: number) => ReturnType
      insertColumnList: (pos: number, cols: number) => ReturnType
    }
  }
}

export const CalloutExtension = CalloutNode.extend({
  addCommands () {
    return {
      insertCallout:
        (pos: number) =>
          ({ chain }) => {
            return chain()
              .insertContentAt(pos, { type: this.name, content: [{ type: 'paragraph' }] })
              .focus(pos + 2)
              .run()
          }
    }
  },

  addNodeView () {
    return SvelteNodeViewRenderer(CalloutNodeView, {
      contentAs: 'div',
      contentClass: 'callout-node-view'
    })
  }
})

export const ToggleExtension = ToggleNode.extend({
  addCommands () {
    return {
      insertToggle:
        (pos: number) =>
          ({ chain }) => {
            return chain()
              .insertContentAt(pos, {
                type: this.name,
                attrs: { open: true },
                content: [
                  { type: 'toggleSummary' },
                  { type: 'toggleContent', content: [{ type: 'paragraph' }] }
                ]
              })
              .focus(pos + 2)
              .run()
          }
    }
  },

  addKeyboardShortcuts () {
    return {
      // Enter in the summary line moves the caret into the (opened) content
      // instead of splitting the summary
      Enter: () => {
        const { state, view } = this.editor
        const { $from } = state.selection
        if ($from.parent.type.name !== 'toggleSummary') return false

        const toggleDepth = $from.depth - 1
        if (toggleDepth < 0 || $from.node(toggleDepth).type.name !== 'toggle') return false

        const togglePos = $from.before(toggleDepth)
        const toggleNode = state.doc.nodeAt(togglePos)
        if (toggleNode === null || toggleNode.type.name !== 'toggle') return false

        let tr = state.tr
        if (toggleNode.attrs.open !== true) {
          tr = tr.setNodeMarkup(togglePos, undefined, { ...toggleNode.attrs, open: true })
        }

        const contentPos = togglePos + 1 + toggleNode.child(0).nodeSize
        tr = tr.setSelection(TextSelection.near(tr.doc.resolve(contentPos + 2))).scrollIntoView()
        view.dispatch(tr)
        return true
      }
    }
  },

  addNodeView () {
    return SvelteNodeViewRenderer(ToggleNodeView, {
      contentAs: 'div',
      contentClass: 'toggle-node-view'
    })
  }
})

export const ToggleSummaryExtension = ToggleSummaryNode
export const ToggleContentExtension = ToggleContentNode

export const ColumnListExtension = ColumnListNode.extend({
  addCommands () {
    return {
      insertColumnList:
        (pos: number, cols: number) =>
          ({ chain }) => {
            const count = Math.max(2, Math.min(4, cols))
            return chain()
              .insertContentAt(pos, {
                type: this.name,
                content: Array.from({ length: count }, () => ({
                  type: 'column',
                  content: [{ type: 'paragraph' }]
                }))
              })
              .focus(pos + 3)
              .run()
          }
    }
  }
})

export const ColumnExtension = ColumnNode
