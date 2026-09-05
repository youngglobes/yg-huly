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
  const body = doc?.body
  if (body == null) return
  const prev = body.style.filter
  body.style.filter = 'opacity(0.99999)'
  const raf = doc.defaultView?.requestAnimationFrame
  if (typeof raf === 'function') {
    raf(() => {
      body.style.filter = prev
    })
  } else {
    body.style.filter = prev
  }
}
