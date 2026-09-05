# YG Portal reskin - full product visual identity

- **Date:** 2026-09-05
- **Status:** Design chosen (YoungGlobes brand), spec for review
- **Owner:** YG platform, branch `feat/yg-portal-reskin` (off `yg_beta`)
- **Decision:** YG owns this design going forward - no more upstream Huly merges - so changing shared core
  theme files is acceptable (no merge-friction constraint).

## 1. Goal

Reskin the entire product so it reads as **YoungGlobes**, not Huly: new palette, typography, nav, buttons,
tables, panels, and de-branded chrome (favicon, logo, login, loading, external links). Achieved centrally
through the theme token layer so the change propagates across every app, not per-component.

**Visual reference (approved):** artifact "YG Theme Directions", flavor = *YoungGlobes* -
https://claude.ai/code/artifact/34878e7b-6eb1-41b0-a6c0-5df2a92f9396

## 2. Identity (from youngglobes.com)

Monochrome (black + white) with a single yellow accent. Source: youngglobes.com theme CSS.

| Role | Value |
|---|---|
| Ink / primary text / rail | `#16161A` |
| Brand accent (the one pop) | yellow `#F6C500` |
| Accent hover / deeper gold | `#D8AC00` |
| Pale accent / chip | `#FBF3D5` |
| Warm soft surface | `#FAF6EA` |
| Body text (muted) | `#5D5D66` |
| Hairline border | `#ECE7DA` |
| Surface / white | `#FFFFFF` |

Dark theme: near-black grounds (`#0E0E10` ground, `#17171B` surface, `#0A0A0C` rail), same yellow accent,
text `#F3F2EE`.

**Accent discipline (important):** yellow is spent ONLY on the primary button, the active-nav bar/pill, the
brand mark, and focus rings. **Never as text or icons on light** - `#F6C500` on white fails contrast; it is
only ever a fill behind dark text, or a thin bar. Links and body stay ink/grey.

**Status colors** stay a small, separate semantic set (not the accent): success `#3f7d52`, warning `#9a6b1f`,
danger `#a33a30` (lifted in dark: `#7db894` / `#d3a24e` / `#d98078`). Used only on status dots/badges and
validation.

**Signature:** solid-yellow primary button (dark text) + a yellow left-bar on the active nav row.

## 3. Typography

YoungGlobes' own faces, self-hosted:
- **Space Grotesk** - headings / display (weights 500/600/700).
- **DM Sans** - body / UI (400/500/600/700).
- **IBM Plex Mono** (already shipped) or JetBrains Mono - numeric/IDs/dates.

Add the woff2 files under `packages/theme/fonts/` and register `@font-face` in `global.scss`; set
`--font-family: 'DM Sans', ...` and a `--font-family-display: 'Space Grotesk', ...` used by headings.

## 4. Where the change lives (central, token-first)

The look is ~99% theme tokens + global stylesheets, so most of the reskin is editing shared files:

1. `packages/theme/styles/_colors.scss` - legacy `--theme-*` tokens. Rewrite BOTH `.theme-dark` and
   `.theme-light` blocks (and the shared `*` block) to the palette above.
2. `packages/theme/styles/_lumia-colors.scss` - the newer `--global-*` / `--button-*` / `--input-*` /
   `--selector-*` tokens. Same palette, BOTH themes. (Two token systems - keep visually identical.)
   Set `--button-primary-BackgroundColor` to the yellow with dark text, accent tokens to `#F6C500`.
3. `packages/theme/styles/global.scss` - fonts (`@font-face`, `--font-family`, base size).
4. `packages/theme/styles/_vars.scss` - spacing/radius scale if we adjust roundness.
5. Token-driven global sheets inherit automatically and need little/no direct edits: `button.scss`,
   `tables.scss`, `panel.scss`, `popups.scss`, `components.scss`, `common.scss`.

**Shell + de-hardcode (a token pass misses these):**
6. Nav rail / navigator look: `common.scss` (`.antiPanel-application`, nav classes), `panel.scss`
   (`.hulyNavPanel-header`), `_notion-nav.scss` (per-app scoped overrides pattern), and
   `plugins/workbench-resources/src/components/Workbench.svelte` (shell composition, already YG-customized).
7. **De-hardcode:** `Navigator.svelte` search input (hardcoded `#ffffff` / `#000000`, lines ~231-239 - also
   breaks dark mode) -> tokens. `Logo.svelte` fallback initial color `rgb(246,105,77)` (Huly coral) -> ink/accent.
8. Broader sweep: `grep -rE '#([0-9a-fA-F]{3,6})' plugins/*/src` for other per-plugin hardcoded colors and
   token-ise the ones on visible surfaces.

## 5. De-Huly (branding surfaces)

- `dev/branding.json` - per-host titles still say "Huly"/"TraceX"; set to "YG Portal".
- Favicon: replace `dev/prod/public/huly/favicon.ico` + `.svg` with YG artwork; bump `?v=` in `index.ejs`.
- Workspace logo mark (`Logo.svelte`) - YG mark / ink+yellow initial, not coral.
- Login + loading: apply the new tokens/fonts; add a minimal YG splash if desired (currently none).
- `dev/prod/src/platform.ts` external links default to Huly (signup `https://huly.io/signup`, support/docs,
  telegram bot) - repoint or remove.
- Remove residual "Huly" strings in visible UI copy.

## 6. Decisions (resolved 2026-09-05)

- **Nav structure: reskin the existing TWO-TIER nav** (app-icon rail + per-app navigator). YG uses all the
  Huly apps (Tracker, Attendance, HR, Timesheet, ...), so the app switcher must stay for cross-app
  navigation. The single merged rail (artifact layout) is NOT adopted - keep the rail; restyle it to the
  dark YG look.
- **Sequence: in-app look FIRST, de-Huly branding LATER.** W1 + W2 (tokens, typography, nav/shell,
  de-hardcode) are this effort. W3 (§5 branding: favicon, logo, login, loading, external links, copy) is a
  deferred follow-up pass, not part of the first plan.

## 7. Phased rollout (each phase: build on beta + screenshots before the next)

- **W1 - Tokens + typography.** `_colors.scss`, `_lumia-colors.scss`, `global.scss` (fonts), `_vars.scss`.
  Pure retheme; biggest visual impact, lowest structural risk. Verify light+dark across HR, Tracker, Chat.
- **W2 - Nav / shell + de-hardcode.** Rail + navigator to the dark YG look; de-hardcode `Navigator.svelte`
  + `Logo.svelte`; sweep remaining hardcoded colors.
- **W3 - De-Huly branding (DEFERRED, later pass).** branding.json, favicon/logo, login/loading, external
  links, copy. Not part of this plan; scheduled after the in-app reskin (W1+W2) ships and is accepted.

## 8. Risks

- **Two token systems, two themes** = four blocks to keep in sync; a missed block yields one theme's text on
  the other's ground. Change them together.
- **Contrast:** never use `#F6C500` as text/icon on white; fills-with-dark-text only. Check WCAG on muted greys.
- **Hardcoded colors** beyond the two known spots - the grep sweep is part of W2.
- **Cross-app regressions:** the tokens drive every app; screenshot Tracker/Chat/Documents too, not just HR.
- **Icons:** Huly's icon set stays; only colors change. A full icon replacement is out of scope here.

## 9. Testing

Per phase: full front build (model unaffected), deploy to beta, and capture before/after screenshots of the
directory, a profile, a timesheet grid, and one non-HR app (Tracker), in both light and dark. The live beta is
the review surface.
