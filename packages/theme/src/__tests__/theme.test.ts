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
  function fakeDoc (hasTimer: boolean): {
    doc: Document
    el: { style: { opacity: string } }
    fireTimer: () => void
    delay: () => number | undefined
  } {
    let cb: (() => void) | undefined
    let delay: number | undefined
    const el = { style: { opacity: '' } }
    const doc = {
      documentElement: el,
      defaultView: hasTimer
        ? {
            setTimeout: (fn: () => void, d: number) => {
              cb = fn
              delay = d
            }
          }
        : {}
    } as unknown as Document
    return { doc, el, fireTimer: () => cb?.(), delay: () => delay }
  }

  it('applies a transient opacity layer on the root, then restores it after a real frame', () => {
    const { doc, el, fireTimer, delay } = fakeDoc(true)
    forceThemeRepaint(doc)
    // Applied synchronously so the browser re-composites with the already-updated theme variables.
    expect(el.style.opacity).toBe('0.9999')
    // Cleared via a timer (not same-frame), so the nudge actually survives to a paint.
    expect(delay()).toBeGreaterThan(0)
    fireTimer()
    expect(el.style.opacity).toBe('')
  })

  it('preserves and restores any pre-existing root opacity', () => {
    const { doc, el, fireTimer } = fakeDoc(true)
    el.style.opacity = '0.5'
    forceThemeRepaint(doc)
    expect(el.style.opacity).toBe('0.9999')
    fireTimer()
    expect(el.style.opacity).toBe('0.5')
  })

  it('restores immediately when no timer is available', () => {
    const { doc, el } = fakeDoc(false)
    el.style.opacity = '1'
    forceThemeRepaint(doc)
    expect(el.style.opacity).toBe('1')
  })

  it('is a no-op (no throw) when there is no documentElement', () => {
    const doc = { documentElement: null } as unknown as Document
    expect(() => forceThemeRepaint(doc)).not.toThrow()
  })
})
