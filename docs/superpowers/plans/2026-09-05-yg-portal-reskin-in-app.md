# YG Portal In-App Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the whole product's in-app look to the YoungGlobes identity (monochrome + yellow `#F6C500`, Space Grotesk / DM Sans) by rewriting the central theme tokens, fonts, nav shell, and two hardcoded-color spots - so every app (HR, Tracker, Timesheet, Attendance, Chat) changes at once.

**Architecture:** The UI is ~99% driven by CSS custom-property tokens in `packages/theme/styles/` plus token-driven global stylesheets. We change the tokens (two systems - legacy `--theme-*` and newer Lumia `--global-*`/`--button-*`, each with a light + dark block), swap the fonts in `global.scss`, force the nav rail dark in both themes, and de-hardcode `Navigator.svelte` + `Logo.svelte`. No model/server change - front build only.

**Tech Stack:** SCSS custom properties, Svelte 3, webpack (front bundle), Rush monorepo. Fonts self-hosted as woff2 under `packages/theme/fonts/`.

**Spec:** `docs/superpowers/specs/2026-09-05-yg-portal-reskin-design.md`

## Global Constraints

- **Scope = in-app only.** De-Huly branding (favicon, logo artwork, login/loading splash, `dev/branding.json`, external links) is a DEFERRED later pass - NOT in this plan.
- **Keep the two-tier nav** (app-icon rail + per-app navigator). Do not merge into one rail.
- **Palette (verbatim):** ink `#16161A`; accent yellow `#F6C500`; accent-hover `#FFD84D`; accent-active/deeper gold `#D8AC00`; readable gold text (light) `#8A6D00`, (dark) `#E8CF6A`; on-accent text `#16161A`; muted text `#5D5D66`; hairline border `#ECE7DA`; warm surface `#FAF6EA`; pale chip `#FBF3D5`; white `#FFFFFF`. Dark grounds: ground `#0E0E10`, surface `#17171B`, rail `#16161A`, text `#F3F2EE`.
- **Accent discipline:** yellow is a FILL behind dark text (buttons, active-nav bar, selected tints, focus) - NEVER used as text or icon color on light (fails contrast). Links use the readable gold, not `#F6C500`.
- **Both themes always.** Every token edit touches BOTH the light and dark block. Status/priority semantic colors are left as-is (out of scope).
- **Fonts:** Space Grotesk (display/headings) + DM Sans (body/UI); keep IBM Plex Mono for numeric/mono.
- **No unit tests.** This is a visual reskin; the verification gate is: the front bundle builds, and a beta screenshot in BOTH themes across HR + one non-HR app (Tracker) looks right. Do not write jest tests.
- **Branch:** `feat/yg-portal-reskin`. Commit after each task.
- **No em dashes** in any code, comment, or copy (use `-` or restructure).

**Build + verify (used by the verification steps):**
```bash
# from the migration ops dir
cd ~/dev/client-projects/huly-migration/huly-selfhost
./build-beta.sh --front-only        # ~9 min; rebuilds the front image
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d front
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
# then load http://localhost:8087 in both light and dark, on HR + Tracker
```
Builds are expensive (~9 min), so the plan batches verification at the END of each wave, not per task.

---

## WAVE 1 - Tokens + Typography

### Task 1: Self-host the YG fonts and set them as the app font

**Files:**
- Create: `packages/theme/fonts/space-grotesk/SpaceGrotesk-{Medium,SemiBold,Bold}.woff2`
- Create: `packages/theme/fonts/dm-sans/DMSans-{Regular,Medium,SemiBold,Bold}.woff2`
- Modify: `packages/theme/styles/global.scss` (the `@font-face` block ~lines 39-103, and `--font-family` at ~line 112)

**Interfaces:**
- Produces: CSS vars `--font-family` (DM Sans stack) and `--font-family-display` (Space Grotesk stack), consumed by later tasks' heading rules.

- [ ] **Step 1: Download the woff2 files.** Fetch the exact static woff2 files Google serves. Run:
```bash
cd ~/dev/client-projects/yg-huly/packages/theme/fonts
mkdir -p space-grotesk dm-sans
# Space Grotesk 500/600/700 and DM Sans 400/500/600/700 - resolve the woff2 URLs from the css2 API
# with a browser UA (returns woff2 in the @font-face src), then curl each file:
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=DM+Sans:wght@400;500;600;700" \
  | grep -oE "https://fonts.gstatic.com/[^)]+\.woff2" | sort -u
```
Then `curl -o space-grotesk/SpaceGrotesk-Medium.woff2 <url>` etc. for each weight (Space Grotesk: 500=Medium, 600=SemiBold, 700=Bold; DM Sans: 400=Regular, 500=Medium, 600=SemiBold, 700=Bold). Verify each file is > 10 KB (`ls -la`).

- [ ] **Step 2: Register `@font-face` in `global.scss`.** After the existing Inter/IBM Plex `@font-face` blocks (around line 103), add:
```scss
@font-face { font-family: 'DM Sans'; font-style: normal; font-weight: 400; font-display: swap; src: url('../fonts/dm-sans/DMSans-Regular.woff2') format('woff2'); }
@font-face { font-family: 'DM Sans'; font-style: normal; font-weight: 500; font-display: swap; src: url('../fonts/dm-sans/DMSans-Medium.woff2') format('woff2'); }
@font-face { font-family: 'DM Sans'; font-style: normal; font-weight: 600; font-display: swap; src: url('../fonts/dm-sans/DMSans-SemiBold.woff2') format('woff2'); }
@font-face { font-family: 'DM Sans'; font-style: normal; font-weight: 700; font-display: swap; src: url('../fonts/dm-sans/DMSans-Bold.woff2') format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-style: normal; font-weight: 500; font-display: swap; src: url('../fonts/space-grotesk/SpaceGrotesk-Medium.woff2') format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-style: normal; font-weight: 600; font-display: swap; src: url('../fonts/space-grotesk/SpaceGrotesk-SemiBold.woff2') format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-style: normal; font-weight: 700; font-display: swap; src: url('../fonts/space-grotesk/SpaceGrotesk-Bold.woff2') format('woff2'); }
```

- [ ] **Step 3: Point the app font vars at the new families.** In `global.scss` replace the `--font-family` line (~112) and add a display var:
```scss
--font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
--font-family-display: 'Space Grotesk', 'DM Sans', -apple-system, sans-serif;
```

- [ ] **Step 4: Commit.**
```bash
git add packages/theme/fonts packages/theme/styles/global.scss
git commit -m "feat(reskin): self-host Space Grotesk + DM Sans and set as app fonts"
```

### Task 2: Flip the Lumia (`--global-*` / `--button-*`) tokens to YG

**Files:**
- Modify: `packages/theme/styles/_lumia-colors.scss` (the `*` block lines 7-42; `.theme-dark` 45-139; `.theme-light` 142-236)

**Interfaces:**
- Consumes: palette from Global Constraints.
- Produces: yellow primary buttons + gold accent/links + ink checkboxes + warm neutrals across all Lumia-based components (hulyButton, NavItem, ModernEditbox, popups).

- [ ] **Step 1: `*` common block (lines 7-42) - set these exact values (leave all others):**
```scss
--global-accent-IconColor: #8A6D00;
--global-on-accent-TextColor: #16161A;
--button-accent-LabelColor: #16161A;
--button-accent-IconColor: #16161A;
--button-primary-BackgroundColor: #F6C500;
--button-primary-BorderColor: #D8AC001A;
--button-primary-hover-BackgroundColor: #FFD84D;
--button-primary-active-BackgroundColor: #D8AC00;
--button-primary-loading-LabelColor: #8A6D00;
--selector-active-BackgroundColor: #16161A;
--global-ui-hover-OverlayColor: #16161A14;
--global-ui-active-OverlayColor: #16161A1F;
```

- [ ] **Step 2: `.theme-light` block - set these exact values:**
```scss
--global-primary-LinkColor: #8A6D00;
--global-accent-TextColor: #8A6D00;
--global-accent-BackgroundColor: #F6C500;
--global-focus-BorderColor: #D8AC00;
--global-primary-TextColor: #16161A;
--global-primary-IconColor: #16161A;
--global-secondary-TextColor: #5D5D66;
--global-surface-01-BackgroundColor: #FAF6EA;
--global-surface-01-BorderColor: #ECE7DA;
--global-surface-02-BorderColor: #ECE7DA;
--global-ui-BorderColor: #16161A1A;
--global-ui-highlight-BackgroundColor: #F6C50022;
--global-ui-hover-highlight-BackgroundColor: #16161A0D;
--global-ui-hover-BackgroundColor: #16161A0D;
--global-ui-active-BackgroundColor: #F6C50026;
--button-menu-active-BorderColor: #16161A;
--input-search-IconColor: #16161A;
```

- [ ] **Step 3: `.theme-dark` block - set these exact values:**
```scss
--global-primary-LinkColor: #E8CF6A;
--global-accent-TextColor: #E8CF6A;
--global-accent-BackgroundColor: #F6C500;
--global-focus-BorderColor: #D8AC00;
--global-surface-02-BorderColor: #2A2A2F;
--global-surface-01-BorderColor: #2A2A2F;
--global-ui-highlight-BackgroundColor: #F6C50014;
--global-ui-hover-highlight-BackgroundColor: #FFFFFF14;
--global-ui-hover-BackgroundColor: #FFFFFF12;
--global-ui-active-BackgroundColor: #F6C50022;
```

- [ ] **Step 4: Commit.**
```bash
git add packages/theme/styles/_lumia-colors.scss
git commit -m "feat(reskin): YG yellow accent + warm neutrals in Lumia tokens (both themes)"
```

### Task 3: Retune the legacy (`--theme-*`) tokens - kill remaining blue/coral, warm neutrals

**Files:**
- Modify: `packages/theme/styles/_colors.scss` (`*` block ~17-150; `.theme-dark` ~105-447; `.theme-light` ~450-803)

**Interfaces:**
- Consumes: palette. Produces: no blue focus rings / coral accents anywhere; dark neutral secondary button kept as a "dark button" style.

- [ ] **Step 1: `*` common block - set these exact values (leave the rest):**
```scss
--primary-button-outline: #D8AC00;   /* was #5190EC (focus ring) */
--primary-button-default: #16161A;   /* was #1A1A1A (dark neutral button) */
--primary-button-hovered: #2A2A2A;   /* was #333333 */
--highlight-blue-01: #8A6D00;        /* was #0084FF */
```

- [ ] **Step 2: `.theme-dark` block - set these exact values:**
```scss
--theme-editbox-focus-border: #D8AC00;   /* was #5190EC */
--theme-list-header-color: #B8B6AD;      /* was #C88C65 (coral) */
```

- [ ] **Step 3: `.theme-light` block - set these exact values:**
```scss
--theme-editbox-focus-border: #D8AC00;   /* was #5190EC */
--theme-list-header-color: #8A6D00;      /* was `red` placeholder - real bug, now gold */
--theme-bg-color: #F4F2EC;               /* was #F1F1F4 - slightly warm */
```

- [ ] **Step 4: Commit.**
```bash
git add packages/theme/styles/_colors.scss
git commit -m "feat(reskin): retune legacy theme tokens - gold focus, warm bg, drop coral/blue"
```

### Task 4: Apply the display font to headings

**Files:**
- Modify: `packages/theme/styles/global.scss` (heading rules) and `packages/theme/styles/common.scss` (any `.fs-title` / heading utility classes that set font)

**Interfaces:**
- Consumes: `--font-family-display` from Task 1.

- [ ] **Step 1: Find heading rules.** Run `grep -nE "h1,|h2,| h3|font-family" packages/theme/styles/common.scss | head` and `grep -nE "\.fs-title|\.heading" packages/theme/styles/*.scss`.

- [ ] **Step 2: Set headings to the display face.** In `global.scss` add (near the body rule ~line 177):
```scss
h1, h2, h3, h4, .fs-title { font-family: var(--font-family-display); letter-spacing: -0.01em; }
```
(If `common.scss` already sets `font-family` on `.fs-title`, change it there to `var(--font-family-display)` instead of adding a duplicate.)

- [ ] **Step 3: Commit.**
```bash
git add packages/theme/styles/global.scss packages/theme/styles/common.scss
git commit -m "feat(reskin): Space Grotesk on headings"
```

### Task 5: WAVE 1 verification (build + beta + screenshots)

- [ ] **Step 1: Build + deploy front** using the Build + verify block at the top.
- [ ] **Step 2: Verify in browser (both themes).** Load `http://localhost:8087`, sign in, check in LIGHT and DARK:
  - Primary buttons are yellow with dark text; hover lightens.
  - Fonts are Space Grotesk headings / DM Sans body (not Inter).
  - No blue accents/links/focus rings remain (links are gold, focus rings gold).
  - Checkboxes/radios are ink, not blue.
  - HR directory + a Tracker board both look coherent; text is readable (no yellow-on-white text).
- [ ] **Step 3: Note any wrong/hardcoded colors** for Wave 2's sweep (Task 8). If a critical color is broken, fix the offending token and rebuild.

---

## WAVE 2 - Nav shell + de-hardcode

### Task 6: Dark nav rail + yellow active-nav in both themes

**Files:**
- Modify: `packages/theme/styles/common.scss` (`.antiPanel-application` ~line 105 and the nav classes)
- Modify: `packages/theme/styles/panel.scss` (`.hulyNavPanel-header` ~line 48)
- Reference pattern: `packages/theme/styles/_notion-nav.scss` (per-app scoped token overrides)

**Interfaces:**
- Consumes: palette. Produces: the app-icon rail + navigator panel render dark (`#16161A`) with light text in BOTH light and dark themes, active item carries a yellow left-bar + subtle yellow tint.

- [ ] **Step 1: Force the nav surfaces dark regardless of theme.** In `common.scss`, in the `.antiPanel-application` rule (and the navigator panel `.antiPanel-navigator` / `.hulyNavPanel` container), set the background to a fixed ink and text to light, e.g.:
```scss
.antiPanel-application { background-color: #16161A; }
.antiPanel-navigator, .hulyNavPanel { background-color: #16161A; }
.hulyNavPanel-header, .antiNav-header { color: #F3F2EE; }
```
(Confirm the exact container class names with `grep -nE "antiPanel-application|antiPanel-navigator|hulyNavPanel" packages/theme/styles/*.scss` before editing; adjust selectors to match.)

- [ ] **Step 2: Nav item text + active state on the dark rail.** Find the nav item class (`grep -n "NavItem" packages/ui/src/components/NavItem.svelte` and its styles; also `common.scss` `.antiNav-element`). Set idle text to `#A3A2A9`, hover/selected text to `#F3F2EE`, selected background to `rgba(246,197,0,.15)`, and add a 3px yellow left-bar on the selected item:
```scss
.antiNav-element { color: #A3A2A9; }
.antiNav-element:hover { color: #F3F2EE; background-color: rgba(255,255,255,.06); }
.antiNav-element.selected { color: #F3F2EE; background-color: rgba(246,197,0,.15); }
.antiNav-element.selected::before { content:""; position:absolute; left:0; top:6px; bottom:6px; width:3px; border-radius:0 3px 3px 0; background:#F6C500; }
```
(Match the real selected-state class - it may be `.selected`, `.hovered`, or an `active` prop; verify in `NavItem.svelte`/`SpecialElement.svelte`. Ensure the element is `position: relative` for the `::before`.)

- [ ] **Step 3: Commit.**
```bash
git add packages/theme/styles/common.scss packages/theme/styles/panel.scss packages/ui/src/components/NavItem.svelte
git commit -m "feat(reskin): dark YG nav rail with yellow active item, both themes"
```

### Task 7: De-hardcode `Navigator.svelte` and `Logo.svelte`

**Files:**
- Modify: `plugins/workbench-resources/src/components/Navigator.svelte` (~lines 231-239)
- Modify: `plugins/workbench-resources/src/components/Logo.svelte` (~line 61)

**Interfaces:**
- Produces: the navigator search box and the workspace-logo fallback use tokens, not Huly literals; both work in dark mode.

- [ ] **Step 1: Navigator search input.** Replace the hardcoded `background-color: #ffffff` and `box-shadow: inset 0 0 0 1px #000000` in `.project-search .searchInput-wrapper` (all states) with tokens:
```scss
background-color: var(--theme-navcard-BackgroundColor);
box-shadow: inset 0 0 0 1px var(--theme-divider-color);
```
(Confirm the exact selector/lines with `grep -n "#ffffff\|#000000\|searchInput-wrapper" plugins/workbench-resources/src/components/Navigator.svelte`.)

- [ ] **Step 2: Logo fallback color.** In `Logo.svelte` change the initial-box `background-color: rgb(246, 105, 77)` (Huly coral) to the YG mark - yellow with dark text:
```scss
background-color: #F6C500;
color: #16161A;
```
(Confirm the color line with `grep -n "246, 105, 77\|background-color" plugins/workbench-resources/src/components/Logo.svelte`; if the text color is set elsewhere, set it to `#16161A`.)

- [ ] **Step 3: Commit.**
```bash
git add plugins/workbench-resources/src/components/Navigator.svelte plugins/workbench-resources/src/components/Logo.svelte
git commit -m "feat(reskin): de-hardcode navigator search + logo fallback to YG tokens"
```

### Task 8: Sweep remaining hardcoded brand colors on visible surfaces

**Files:**
- Modify: whichever `plugins/*/src/**/*.svelte` the sweep flags (visible-surface hardcoded colors only)

**Interfaces:**
- Produces: no stray Huly-blue/coral literals on common surfaces.

- [ ] **Step 1: Find candidates.** Run:
```bash
cd ~/dev/client-projects/yg-huly
grep -rniE "#3364e2|#3566e2|#5190ec|#6796ff|#0084ff|246, ?105, ?77|f6694d" plugins/*/src packages/*/src --include=*.svelte --include=*.scss | grep -v node_modules
```
- [ ] **Step 2: Token-ise the hits that render on visible chrome** (nav, headers, buttons, panels). For each, replace the literal with the nearest token (`var(--global-accent-BackgroundColor)` for an accent fill, `var(--theme-caption-color)` for ink text, etc.). Leave literals inside app-specific illustrations, avatars-by-hash, and semantic status/priority code (those are intentional).
- [ ] **Step 3: Commit.**
```bash
git add -A
git commit -m "feat(reskin): token-ise stray hardcoded brand colors on shared surfaces"
```

### Task 9: WAVE 2 verification (build + beta + screenshots)

- [ ] **Step 1: Build + deploy front** (Build + verify block).
- [ ] **Step 2: Verify in browser (both themes, HR + Tracker):**
  - The left app-rail and the navigator panel are dark ink `#16161A` in BOTH light and dark themes, with light text.
  - The active/selected nav item has a yellow left-bar and subtle yellow tint; idle items are muted grey, hover lightens.
  - The navigator search box is readable in dark mode (no white-on-dark box).
  - The workspace logo initial is yellow/ink, not coral.
  - No stray blue/coral remains on shared chrome.
- [ ] **Step 3: Final commit / branch is ready for review.** The de-Huly branding pass (favicon, logo artwork, login/loading, branding.json, external links) is the separate deferred W3 - not done here.

---

## Self-review notes

- **Spec coverage:** §2 palette -> Tasks 2,3,6,7. §3 typography -> Tasks 1,4. §4 central token lever -> Tasks 2,3. §4 shell + de-hardcode -> Tasks 6,7,8. §6 keep two-tier nav -> Task 6 restyles, does not merge. §5 de-Huly -> explicitly DEFERRED (Global Constraints + Task 9 step 3). §7 W1/W2 -> the two waves. §8 risks (two systems/both themes, contrast, cross-app) -> Global Constraints + verification steps check both themes + Tracker.
- **No unit tests** by design (visual reskin) - stated in Global Constraints so the executor does not fabricate jest tests.
- **Font self-hosting** is the one step that fetches external files (Task 1 step 1); if the download is blocked, the fallback is a `<link>` to fonts.googleapis.com in `dev/prod/src/index.ejs` (note only - prefer self-hosting to match the existing Inter/IBM Plex pattern).
