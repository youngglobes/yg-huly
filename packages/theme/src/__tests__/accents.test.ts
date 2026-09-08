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

import { accentPresets, applyAccent, buildAccentCss, defaultAccentId } from '../accents'

// A minimal fake document that tracks a single injected <style> so applyAccent can be exercised
// without a DOM. createElement/appendChild/getElementById model just what applyAccent touches.
function fakeDoc (): { doc: Document, injected: () => { id: string, textContent: string } | undefined } {
  const elements: Array<{ id: string, textContent: string }> = []
  const head = {
    appendChild: (el: { id: string, textContent: string }) => {
      elements.push(el)
    }
  }
  const doc = {
    head,
    documentElement: {},
    createElement: () => ({ id: '', textContent: '' }),
    getElementById: (id: string) => elements.find((e) => e.id === id) ?? null
  } as unknown as Document
  return { doc, injected: () => elements.find((e) => e.id === 'yg-accent-override') }
}

describe('accent presets', () => {
  it('exposes the default preset first with no override vars', () => {
    const first = accentPresets[0]
    expect(first.id).toBe(defaultAccentId)
    expect(first.vars).toBeUndefined()
  })

  it('gives every non-default preset a full six-token family', () => {
    for (const p of accentPresets.filter((p) => p.id !== defaultAccentId)) {
      expect(p.vars).toBeDefined()
      const v = p.vars!
      expect(v.brand).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(v.brandRgb).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/)
      expect(v.brandHover).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(v.brandActive).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(v.brandInk).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(v.brandInkDark).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('has unique preset ids', () => {
    const ids = accentPresets.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('buildAccentCss', () => {
  it('returns an empty string for the default preset (no override)', () => {
    expect(buildAccentCss(accentPresets[0])).toBe('')
  })

  it('re-declares all six brand tokens under a * rule for a coloured preset', () => {
    const teal = accentPresets.find((p) => p.id === 'teal')!
    const css = buildAccentCss(teal)
    expect(css.startsWith('* {')).toBe(true)
    expect(css).toContain('--yg-brand:#12B5A5;')
    expect(css).toContain('--yg-brand-rgb:18, 181, 165;')
    expect(css).toContain('--yg-brand-hover:')
    expect(css).toContain('--yg-brand-active:')
    expect(css).toContain('--yg-brand-ink:')
    expect(css).toContain('--yg-brand-ink-dark:')
  })

  it('emits the on-accent text override only for a preset that sets onAccent (neutral), not others', () => {
    const neutral = accentPresets.find((p) => p.id === 'neutral')!
    const teal = accentPresets.find((p) => p.id === 'teal')!
    expect(buildAccentCss(neutral)).toContain('--global-on-accent-TextColor:#FFFFFF;')
    expect(buildAccentCss(neutral)).toContain('--primary-button-color:#FFFFFF;')
    expect(buildAccentCss(teal)).not.toContain('on-accent')
  })

  it('appends nav-scoped light-sidebar rules for the Classic preset after the base * block', () => {
    const classic = accentPresets.find((p) => p.id === 'classic')!
    const css = buildAccentCss(classic)
    // Base brand block still comes first, blue accent, white on-accent text.
    expect(css.startsWith('* {')).toBe(true)
    expect(css).toContain('--yg-brand:#3364E2;')
    expect(css).toContain('--global-on-accent-TextColor:#FFFFFF;')
    // Extra rules are scoped to the light-theme sidebar AND its descendants (the sidebar tokens are
    // declared under a bare `* {}`, so a direct descendant match is required to beat them), restoring
    // dark-on-light there, contained so the flip cannot leak into the content area.
    expect(css).toContain('.theme-light .antiPanel-application, .theme-light .antiPanel-application *{')
    expect(css).toContain('.theme-light .antiPanel-navigator, .theme-light .antiPanel-navigator *{')
    expect(css).toContain('--yg-nav-bg:#FBFBFC;')
    expect(css).toContain('--yg-rail-fg:#26262B;')
    expect(css).toContain('--global-primary-TextColor:#16161A;')
    // The scoped rules come after the closing brace of the base * block.
    expect(css.indexOf('.theme-light')).toBeGreaterThan(css.indexOf('}'))
  })

  it('omits extra rules for presets that declare none (teal)', () => {
    const teal = accentPresets.find((p) => p.id === 'teal')!
    expect(buildAccentCss(teal)).not.toContain('.theme-light')
  })
})

describe('applyAccent', () => {
  it('injects an override style element for a coloured preset', () => {
    const { doc, injected } = fakeDoc()
    applyAccent('violet', doc)
    const style = injected()
    expect(style).toBeDefined()
    expect(style!.textContent).toContain('--yg-brand:#7C5CFF;')
  })

  it('clears the override when switching back to the default preset', () => {
    const { doc, injected } = fakeDoc()
    applyAccent('violet', doc)
    expect(injected()!.textContent).not.toBe('')
    applyAccent(defaultAccentId, doc)
    expect(injected()!.textContent).toBe('')
  })

  it('falls back to the default (empty override) for an unknown id', () => {
    const { doc, injected } = fakeDoc()
    applyAccent('does-not-exist', doc)
    // No style is created because the resolved default yields an empty override.
    expect(injected()).toBeUndefined()
  })

  it('is a no-op (no throw) when the document has no head or documentElement', () => {
    const doc = { head: null, documentElement: null } as unknown as Document
    expect(() => applyAccent('teal', doc)).not.toThrow()
  })
})
