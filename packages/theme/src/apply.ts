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

/**
 * Force a re-composite after a theme change.
 *
 * Chromium keeps stale pixels behind filter / backdrop-filter compositing layers when an inherited
 * CSS custom property changes on the root element: the theme variables DO re-resolve (computed
 * styles update to the new theme), but the page is not repainted until a reflow, so a live
 * light/dark toggle appears to do nothing until a manual refresh. Nudging a transient, imperceptible
 * filter on <body> re-composites the subtree with the already-updated variables, without destroying
 * layout (so scroll positions survive), then restores it on the next frame.
 *
 * Kept in its own module (free of side-effect imports) so it stays unit-testable with a mock document.
 * @public
 */
export const forceThemeRepaint = (doc: Document = document): void => {
  const el = doc?.documentElement
  if (el == null) return
  const prev = el.style.opacity
  // opacity < 1 forces the whole document into a temporary compositing layer, so Chromium
  // re-composites (repaints) the subtree with the already-updated theme variables. It is visually
  // imperceptible at 0.9999 and does not affect layout, so scroll positions survive. The layer must
  // survive to a real paint, so it is cleared via a timer (a same-frame rAF removal is coalesced
  // into a no-op).
  el.style.opacity = '0.9999'
  const restore = (): void => {
    el.style.opacity = prev
  }
  const setTimeoutFn = doc.defaultView?.setTimeout
  if (typeof setTimeoutFn === 'function') {
    setTimeoutFn(restore, 50)
  } else {
    restore()
  }
}
