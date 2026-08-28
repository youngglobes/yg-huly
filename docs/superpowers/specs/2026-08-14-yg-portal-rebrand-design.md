# "YG Portal" rebrand (remove "Huly" from emails + UI) - design

Date: 2026-08-14
Status: approved (brainstorming), ready for implementation
Area: yg-huly account email templates + yg-timesheet onboarding strings; huly-migration build/compose (beta)

## Problem

The product is being rebranded from "Huly" to "YG Portal". The front-end chrome is already
"YG Portal" (page title, login, workbench header all resolve through the branding `title` /
`PlatformTitle`, whose fallback the fork already set to "YG Portal"). The remaining visible "Huly"
lives almost entirely in outbound emails, plus one onboarding string. This pass removes "Huly" from
the emails users actually receive (English) and the last UI string, text/name only.

## Scope decisions (from brainstorming)

1. Brand string is literally **"YG Portal"** everywhere.
2. **Full** email de-brand: config (From + product variable) AND a custom account image to fix the
   hardcoded "Huly" in the email HTML.
3. **English only** (`server/account/lang/en.json`). Other locale files are left as-is (users are on
   `DEFAULT_LANGUAGE=en`).
4. Text/name only. The favicon/app-icon asset (currently a black "y." mark, not a clear YG logo) and
   any header logo image are a separate asset task, out of scope here.
5. Beta first. Prod follows later via `yg_develop` merge + the prod compose (same steps).

## Why a custom account image is required

The OTP / invite / confirmation / recovery / password-setup emails are sent by the **account
service**, and its templates (`server/account/lang/en.json`) are bundled into the account pod at
build time (not read from disk). The beta deployment runs the stock upstream
`hardcoreeng/account:${HULY_VERSION}` image, which `build-beta.sh` does not build. So the hardcoded
"Huly" in the email HTML cannot be changed by config alone; it needs a locally built
`yg-local/account:beta` (5th image), overridden in compose. Feasibility confirmed: `pods/account`
(`@hcengineering/pod-account`) has the same `bundle` (esbuild) + `docker:build` scripts as
front/workspace/server.

## Where "Huly" is, and how each is fixed

### Config only (no source edit)
- **From name/address:** the mail service `SOURCE` env (there is no from-name parameter in the mail
  pod; `SOURCE` is the whole identity). Set `SOURCE=YG Portal <no-reply@youngglobes.com>`.
  Server-only (`.mail.env` / the out-of-band mail compose), not in the huly-migration repo.
  Precondition: `youngglobes.com` must be verified in Resend (SPF/DKIM). Verify current `SOURCE` and
  Resend's verified domains before flipping; if not verified, keep the current sender and defer.
- **Product name in subjects + plain-text bodies** (`{app}` in OtpText/OtpSubject, `{name}` in
  Confirmation): resolves from `branding.title ?? PRODUCT_NAME`. Neither is set today, so `{app}`
  renders blank. Set `PRODUCT_NAME=YG Portal` on the account service.

### Source edit + rebuild (yg-huly, branch yg_beta)
- `server/account/lang/en.json` - replace every literal `Huly` with `YG Portal`. All occurrences are
  brand references; none are inside a `{app}`/`{name}`/`{ws}`/`{link}` variable, so a whole-file
  `Huly` -> `YG Portal` replacement is correct and complete. Specifically:
  - HTML header logo `>Huly</span>` (Confirmation, Recovery, Invite, Otp, ResendInvite,
    PasswordSetup HTML) -> `>YG Portal</span>`.
  - Footer `&copy; Huly &mdash; All rights reserved` (same six) -> `&copy; YG Portal &mdash; ...`.
    (The `&mdash;` separator is existing template design and is left unchanged; only the word is
    replaced.)
  - Invite body `workspace on Huly` (InviteText, InviteHTML, ResendInviteText, ResendInviteHTML) ->
    `workspace on YG Portal`. (Invite emails do not use `{app}`, so this literal is the only lever.)
  - `PasswordSetupSubject`: `Set a password for your Huly account` -> `... your YG Portal account`.
- `server-plugins/notification-resources/src/index.ts:220` - `control.branding?.title ?? 'Huly'` ->
  `?? 'YG Portal'` (fallback for the "View in {app}" link text in mention/assignment emails; belt
  and suspenders alongside PRODUCT_NAME). This lives in the transactor bundle, already built by
  `build-beta.sh`.
- `plugins/onboard-assets/lang/en.json` and `plugins/login-assets/lang/en.json` -
  `"StartUsingHuly": "Start using Huly"` -> `"Start using YG Portal"` (the one remaining visible UI
  string, shown on the onboarding form). This lives in the front bundle.

## Deployment (huly-migration, beta)

- `build-beta.sh` - add a 5th image to the full-build path: `build_image pods/account account`.
- `compose.override.beta.yml` - add `account: image: yg-local/account:beta`.
- Account service env (compose.yml or the override) - add `PRODUCT_NAME=YG Portal`.
- This is a backend + front change but **not a model change**, so **no `upgrade-workspace`**.
  Build is a **full build** (front + workspace + transactor + tool + account). Recreate the changed
  services: `front transactor account`, then **restart nginx** (it proxies `_accounts` and front;
  ops rule after any recreate). Run the build with the stop-stack + `RUSH_PARALLELISM=2` recipe
  (12GB WSL box).

## Verification

1. Rebuilt bundles contain no user-facing "Huly": grep the running `account`, `transactor`, and
   `front` containers for the changed strings (e.g. account bundle has `YG Portal` and no
   `>Huly</span>` / `&copy; Huly`), same technique used to verify the location banner.
2. Send a real OTP to `karthikeyan@youngglobes.com` and read the delivered email (or the local DB /
   mail log): subject `YG Portal confirmation code: ...`, header `YG Portal`, footer
   `© YG Portal ...`, zero "Huly".
3. Front onboarding form shows "Start using YG Portal".
4. Front HTTP 200 at localhost:8087.

## Out of scope / follow-ups

- Favicon / app-icon asset swap to a real YG mark (separate asset task).
- Non-English locale email templates.
- Prod rollout: merge to `yg_develop`, build the account image in the prod pipeline, set
  `PRODUCT_NAME` + `SOURCE` on prod, and verify the prod Resend sender domain.
- The `/huly/...` asset folder path (cosmetic, invisible) is left unchanged.

## Risks

- **Resend domain verification** for `youngglobes.com` gates the `SOURCE` change. Check first; a
  wrong/unverified sender bounces mail. If unverified, ship everything else and defer `SOURCE`.
- The account image must build cleanly from the fork (feasibility confirmed; verify the built bundle
  actually embeds the new strings before declaring done).
- Recreating `account` changes its container IP; nginx must be restarted after (proxies `_accounts`).
