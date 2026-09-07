<!--
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
-->
<!--
  Quick light/dark toggle for the top status bar, sitting beside the clock and settings. Flips
  between an explicit theme-light and theme-dark via the shared 'theme' context (the same setTheme
  Settings uses, so it goes through forceThemeRepaint and applies live). Shows a sun when dark
  (tap to go light) and a moon when light (tap to go dark). Styled with the top-bar ghost-button
  convention so it matches the clock and back/forward controls in both themes.
-->
<script lang="ts">
  import { getContext } from 'svelte'
  import type { Readable } from 'svelte/store'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { tooltip } from '@hcengineering/ui'

  const { currentTheme, setTheme } = getContext<{ currentTheme: Readable<string>, setTheme: (theme: string) => void }>(
    'theme'
  )

  // Resolve 'theme-system' against the OS preference, same rule as theme's isThemeDark (kept inline
  // so this component needs no dependency on @hcengineering/theme).
  $: dark =
    $currentTheme === 'theme-dark' ||
    ($currentTheme === 'theme-system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  function toggle (): void {
    setTheme(dark ? 'theme-light' : 'theme-dark')
  }
</script>

<button
  class="antiButton ghost jf-center bs-none no-focus resetIconSize statusButton square yg-theme-toggle"
  style:color={'var(--theme-dark-color)'}
  on:click={toggle}
  use:tooltip={{ label: getEmbeddedLabel(dark ? 'Light mode' : 'Dark mode') }}
  aria-label="Toggle light and dark mode"
>
  {#if dark}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5Z" />
    </svg>
  {/if}
</button>

<style lang="scss">
  .yg-theme-toggle {
    svg {
      width: 1.15rem;
      height: 1.15rem;
    }
    &:hover {
      color: var(--theme-caption-color);
    }
  }
</style>
