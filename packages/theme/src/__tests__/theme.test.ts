//
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
//

import { forceThemeRepaint } from '../apply'

describe('forceThemeRepaint (live theme-switch repaint fix)', () => {
  function fakeDoc (hasRaf: boolean): { doc: Document, body: { style: { filter: string } }, fireRaf: () => void } {
    let cb: (() => void) | undefined
    const body = { style: { filter: '' } }
    const doc = {
      body,
      defaultView: hasRaf
        ? {
            requestAnimationFrame: (fn: () => void) => {
              cb = fn
            }
          }
        : {}
    } as unknown as Document
    return { doc, body, fireRaf: () => cb?.() }
  }

  it('applies a transient composite nudge on <body>, then restores it next frame', () => {
    const { doc, body, fireRaf } = fakeDoc(true)
    forceThemeRepaint(doc)
    // Applied synchronously so the browser re-composites with the already-updated theme variables.
    expect(body.style.filter).toBe('opacity(0.99999)')
    // Cleared on the next frame so the nudge never lingers.
    fireRaf()
    expect(body.style.filter).toBe('')
  })

  it('preserves and restores any pre-existing body filter', () => {
    const { doc, body, fireRaf } = fakeDoc(true)
    body.style.filter = 'blur(2px)'
    forceThemeRepaint(doc)
    expect(body.style.filter).toBe('opacity(0.99999)')
    fireRaf()
    expect(body.style.filter).toBe('blur(2px)')
  })

  it('restores immediately when requestAnimationFrame is unavailable', () => {
    const { doc, body } = fakeDoc(false)
    body.style.filter = 'none'
    forceThemeRepaint(doc)
    expect(body.style.filter).toBe('none')
  })

  it('is a no-op (no throw) when there is no body', () => {
    const doc = { body: null } as unknown as Document
    expect(() => forceThemeRepaint(doc)).not.toThrow()
  })
})
