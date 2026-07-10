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

import { mergeAttributes, Node } from '@tiptap/core'

import { getDataAttribute } from './utils'

/**
 * Notion-style callout: a highlighted container with an emoji icon.
 *
 * Rendered statically as
 *   <div data-type="callout" data-emoji="…"><div class="proseCallout-content">…</div></div>
 * the icon is emitted by CSS/client from the data attribute so the emoji is not
 * duplicated into the editable content.
 */
export const CalloutNode = Node.create({
  name: 'callout',

  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes () {
    return {
      emoji: getDataAttribute('emoji', { default: '💡' }),
      color: getDataAttribute('color', { default: null })
    }
  },

  parseHTML () {
    return [{ tag: `div[data-type="${this.name}"]` }]
  },

  renderHTML ({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-type': this.name, class: 'proseCallout' }, HTMLAttributes),
      ['div', { class: 'proseCallout-content' }, 0]
    ]
  }
})

/**
 * Notion-style toggle (collapsible section): a summary line plus hideable content.
 *
 * Rendered statically as native <details><summary>…</summary><div>…</div></details>,
 * which stays collapsible in read-only HTML without any client code.
 */
export const ToggleNode = Node.create({
  name: 'toggle',

  group: 'block',
  content: 'toggleSummary toggleContent',
  defining: true,
  isolating: true,

  addAttributes () {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute('open') !== null,
        renderHTML: (attributes) => (attributes.open === true ? { open: 'open' } : {})
      }
    }
  },

  parseHTML () {
    return [{ tag: 'details' }]
  },

  renderHTML ({ HTMLAttributes }) {
    return ['details', mergeAttributes({ class: 'proseToggle' }, HTMLAttributes), 0]
  }
})

export const ToggleSummaryNode = Node.create({
  name: 'toggleSummary',

  content: 'inline*',
  defining: true,
  isolating: true,

  parseHTML () {
    return [{ tag: 'summary' }]
  },

  renderHTML ({ HTMLAttributes }) {
    return ['summary', mergeAttributes({ class: 'proseToggle-summary' }, HTMLAttributes), 0]
  }
})

export const ToggleContentNode = Node.create({
  name: 'toggleContent',

  content: 'block+',
  defining: true,

  parseHTML () {
    return [{ tag: `div[data-type="${this.name}"]` }]
  },

  renderHTML ({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': this.name, class: 'proseToggle-content' }, HTMLAttributes), 0]
  }
})

/**
 * Notion-style columns: a row of 2-4 equal-width columns, each holding blocks.
 * Rendered as flex containers; small screens stack them via CSS.
 */
export const ColumnListNode = Node.create({
  name: 'columnList',

  group: 'block',
  content: 'column{2,4}',
  defining: true,
  isolating: true,

  parseHTML () {
    return [{ tag: `div[data-type="${this.name}"]` }]
  },

  renderHTML ({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': this.name, class: 'proseColumnList' }, HTMLAttributes), 0]
  }
})

export const ColumnNode = Node.create({
  name: 'column',

  content: 'block+',
  isolating: true,

  parseHTML () {
    return [{ tag: `div[data-type="${this.name}"]` }]
  },

  renderHTML ({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': this.name, class: 'proseColumn' }, HTMLAttributes), 0]
  }
})
