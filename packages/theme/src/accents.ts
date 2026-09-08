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

import { forceThemeRepaint } from './apply'

// Slack-style quick accent switch. The whole product derives its accent from six brand tokens
// declared in packages/theme/styles/_colors.scss under a `* {}` block (--yg-brand and family).
// To re-accent live we inject a single <style> whose `* {}` rule re-declares those six tokens;
// because it is appended after the bundled CSS and carries the same `*` specificity, source order
// makes it win on every element (a :root override would be shadowed by the base `* {}` rule on
// descendants). The default preset ships no override, so it renders exactly as the base stylesheet.

export interface AccentVars {
  brand: string
  brandRgb: string
  brandHover: string
  brandActive: string
  brandInk: string
  brandInkDark: string
  /**
   * Text colour on a filled accent (primary buttons). Optional: bright accents (yellow/amber/...)
   * keep the shipped dark on-accent text, but a dark/neutral accent needs light text, so the
   * neutral preset sets this to white.
   */
  onAccent?: string
  /**
   * Slack-style sidebar tint: a darker tinted-dark shade for the app rail and a slightly lighter
   * one for the navigator/submenu, both dark enough for the light rail text. Optional - presets
   * that omit these keep the shipped near-black rail/nav (good for yellow/neutral, whose dark tint
   * would read as muddy olive/grey).
   */
  railBg?: string
  navBg?: string
}

export interface AccentPreset {
  id: string
  label: string
  /** The dot shown in the picker (the base accent colour). */
  swatch: string
  /** The six brand tokens. Omitted for the default preset, which uses the shipped stylesheet. */
  vars?: AccentVars
}

export const defaultAccentId = 'yellow'

// Each preset defines its own full token family (base / lighter hover / deeper active / rgb triplet
// / ink readable on LIGHT / ink readable on DARK) so contrast stays correct in both themes. The
// default 'yellow' carries no vars: it removes the override and falls back to the base stylesheet.
export const accentPresets: AccentPreset[] = [
  { id: 'yellow', label: 'YoungGlobes', swatch: '#F6C500' },
  {
    // True neutral: a fully desaturated, monochrome accent (no colour pop). Primary buttons and the
    // active nav become slate-grey with white text; links/tints go neutral. Matches the artifact's
    // "True neutral" flavour while fitting the single-brand override system.
    id: 'neutral',
    label: 'Neutral',
    swatch: '#52525B',
    vars: {
      brand: '#52525B',
      brandRgb: '82, 82, 91',
      brandHover: '#63636D',
      brandActive: '#3F3F46',
      brandInk: '#52525B',
      brandInkDark: '#B4B4BD',
      onAccent: '#FFFFFF'
    }
  },
  {
    id: 'amber',
    label: 'Amber',
    swatch: '#F5820A',
    vars: {
      brand: '#F5820A',
      brandRgb: '245, 130, 10',
      brandHover: '#FF9E33',
      brandActive: '#D26800',
      brandInk: '#9A4E00',
      brandInkDark: '#F3B267',
      railBg: '#241a0e',
      navBg: '#31240f'
    }
  },
  {
    id: 'teal',
    label: 'Teal',
    swatch: '#12B5A5',
    vars: {
      brand: '#12B5A5',
      brandRgb: '18, 181, 165',
      brandHover: '#3FD1C2',
      brandActive: '#0E9284',
      brandInk: '#0A6F65',
      brandInkDark: '#6FE0D4',
      railBg: '#0b2723',
      navBg: '#123833'
    }
  },
  {
    id: 'violet',
    label: 'Violet',
    swatch: '#7C5CFF',
    vars: {
      brand: '#7C5CFF',
      brandRgb: '124, 92, 255',
      brandHover: '#9A80FF',
      brandActive: '#5F3FE0',
      brandInk: '#5636C4',
      brandInkDark: '#B7A5FF',
      railBg: '#191233',
      navBg: '#221a45'
    }
  },
  {
    id: 'coral',
    label: 'Coral',
    swatch: '#F0473E',
    vars: {
      brand: '#F0473E',
      brandRgb: '240, 71, 62',
      brandHover: '#FF6A62',
      brandActive: '#CE3229',
      brandInk: '#9E2A24',
      brandInkDark: '#FF9089',
      railBg: '#2a1512',
      navBg: '#38201d'
    }
  }
]

const STORAGE_KEY = 'yg-accent'
const STYLE_ID = 'yg-accent-override'

const resolvePreset = (id: string): AccentPreset =>
  accentPresets.find((p) => p.id === id) ?? accentPresets.find((p) => p.id === defaultAccentId) ?? accentPresets[0]

/** The persisted accent id, or the default when none is stored or storage is unavailable. */
export const getStoredAccent = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? defaultAccentId
  } catch {
    return defaultAccentId
  }
}

/** Build the `* {}` override CSS for a preset. The default preset (no vars) yields an empty string. */
export const buildAccentCss = (preset: AccentPreset): string => {
  const v = preset.vars
  if (v == null) return ''
  // When a preset sets onAccent, also flip the text-on-accent tokens (primary-button text) so a
  // dark/neutral accent stays readable; bright accents omit it and keep the shipped dark text.
  const onAccent =
    v.onAccent != null
      ? `--global-on-accent-TextColor:${v.onAccent};--primary-button-color:${v.onAccent};`
      : ''
  // Optional Slack-style tinted sidebar (darker rail + lighter submenu of the accent hue).
  const sidebar =
    v.railBg != null && v.navBg != null ? `--yg-rail-bg:${v.railBg};--yg-nav-bg:${v.navBg};` : ''
  return (
    '* {' +
    `--yg-brand:${v.brand};` +
    `--yg-brand-rgb:${v.brandRgb};` +
    `--yg-brand-hover:${v.brandHover};` +
    `--yg-brand-active:${v.brandActive};` +
    `--yg-brand-ink:${v.brandInk};` +
    `--yg-brand-ink-dark:${v.brandInkDark};` +
    onAccent +
    sidebar +
    '}'
  )
}

/**
 * Apply an accent by (re)writing the injected override stylesheet. Side-effect free beyond the DOM
 * it is handed, so it is unit-testable with a fake document. Does not touch storage or repaint.
 */
export const applyAccent = (id: string, doc: Document = document): void => {
  const head = doc?.head ?? doc?.documentElement
  if (head == null) return
  const css = buildAccentCss(resolvePreset(id))
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (css === '') {
    // Default preset: clear any prior override so the base stylesheet shows through.
    if (style != null) style.textContent = ''
    return
  }
  if (style == null) {
    style = doc.createElement('style') as HTMLStyleElement
    style.id = STYLE_ID
    head.appendChild(style)
  }
  style.textContent = css
}

/** User picked an accent: persist it, apply it, and force a live repaint (same fix the theme uses). */
export const setAccent = (id: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // storage unavailable (private mode); the accent still applies for this session
  }
  applyAccent(id)
  forceThemeRepaint()
}

/** Apply the stored accent on load. Called once from Theme.svelte's onMount. */
export const initAccent = (): void => {
  applyAccent(getStoredAccent())
}
