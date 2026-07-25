# YG Portal Timesheet Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Redesign the three timesheet data views (My Timesheet, Approvals, Reports) to the approved "YG portal" design (black primary, day-grouped cards, avatar grouping, semantic status), fix the blank approved-by, move submit errors to a toast, give the sidebar distinct icons, and rename Projects → Configuration.

**Architecture:** A shared `--yg-*` design-token + component layer (extends the existing `yg-table.scss`) keyed to Huly's `.theme-light`/`.theme-dark`; the view components are re-marked-up to the mockups using those tokens while their data/query/action logic is preserved. One model change for icons + the rename. One `day.ts` logic fix for attribution.

**Tech Stack:** Huly (Rush monorepo, Svelte, TS), `@hcengineering/{ui,contact,tracker,core,presentation}`. Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`).

## Global Constraints

- **Branch:** commits on `yg_beta`. **Never merge to `yg_develop`** (CI auto-deploys to prod).
- **Design source of truth:** the committed mockups — `docs/superpowers/specs/mockups/{my-timesheet,approvals,reports}.html`. Open the relevant one; match its layout, spacing, pills, buttons, avatars, and copy. It is a static mockup with hardcoded hex — in Svelte use the `--yg-*` tokens from Task 1 (NOT hardcoded hex).
- **Brand:** primary is **black** (`--yg-ink`), which **flips to near-white in Huly dark theme** so buttons stay legible. Semantic status colors (green/amber/red) are NOT the brand and never turn black.
- **Behavior is frozen:** do NOT change any data query, reactive block, role gate, `showPopup` wiring, CSV logic, or the approval/derived-status semantics unless a task explicitly says so. These are restyle + markup tasks. The one logic change is Task 5 (attribution).
- **Never show approved hours in My Timesheet** (only submitted hours) — unchanged rule.
- **No em-dashes (`—`) in any UI copy or user-facing text** — they read as AI-generated. Use commas, colons, or restructured sentences. (Applies to labels, toasts, empty states, dialog notes, everything a user sees.)
- `svelte-check` mandatory on `.svelte`; known baseline is not yours (the `$lookup` typing lines). No NEW non-`$lookup` errors on touched files. Unit suite is **114** and must not regress.
- Theme: Huly sets `.theme-light`/`.theme-dark` on an ancestor (`packages/theme/src/variants.ts`) and provides flipping `--theme-*` vars. Define `--yg-*` under those classes; reuse `--theme-*` where it already flips correctly.
- `@hcengineering/yg-timesheet`'s generated types are gitignored/can go stale — rebuild that package first on spurious type errors.

---

### Task 1: YG portal design tokens + shared component classes

Extend the shared style layer so every view draws from one token system. Everything after this consumes it.

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/yg-table.scss` (add the `--yg-*` token blocks + new component classes; keep the existing `.yg-table`/`.yg-pill--*`/`.yg-num`/`.yg-amber` etc. working)

**Interfaces (produced — used by Tasks 2-4,7):**
- Tokens (defined under BOTH `:global(.theme-light)` and `:global(.theme-dark)` so they flip): `--yg-ink`, `--yg-ink-fg`, `--yg-bg`, `--yg-panel`, `--yg-panel-soft`, `--yg-border`, `--yg-border-strong`, `--yg-text`, `--yg-text-dim`, `--yg-text-faint`, `--yg-green/-bg/-line`, `--yg-amber/-bg/-line`, `--yg-red/-bg/-line`, `--yg-grey/-bg`, `--yg-radius`, `--yg-shadow`, and avatar palette `--yg-av1..--yg-av4`.
- Component classes: `.yg-btn` (+ `.yg-btn--primary` = ink bg/ink-fg, `.yg-btn--ghost`, `.yg-btn--danger` = red outline), `.yg-idbadge` (mono id chip), `.yg-avatar` (+ `.yg-avatar--sm`, `.yg-av1..4`), `.yg-tag--{approved,submitted,rejected,draft}` (dot + label, task-level), and keep the existing `.yg-pill--{status}` (day-level). Values come straight from the mockups' `:root` / `.dialog`/`.btn`/`.avatar`/`.tag`/`.pill` rules — copy the light values into `.theme-light`, the dark values into `.theme-dark`.

- [ ] **Step 1: Add the token blocks**

At the top of `yg-table.scss`, add two blocks (mirror the mockup palettes exactly — light hexes from the mockup `:root`, dark hexes from the mockup `@media dark`):
```scss
:global(.theme-light) {
  --yg-ink:#17181f; --yg-ink-fg:#fff; --yg-bg:#f4f5f8; --yg-panel:#fff; --yg-panel-soft:#fafbfd;
  --yg-border:#e7e8ef; --yg-border-strong:#dcdde6; --yg-text:#191a23; --yg-text-dim:#63657a; --yg-text-faint:#9a9caf;
  --yg-green:#1f9d55; --yg-green-bg:#e8f6ee; --yg-green-line:#bfe6cd;
  --yg-amber:#b7770a; --yg-amber-bg:#fbf1dc; --yg-amber-line:#eed9ab;
  --yg-red:#d1434e; --yg-red-bg:#fbe9eb; --yg-red-line:#f2c4c8;
  --yg-grey:#7c7e92; --yg-grey-bg:#eef0f4;
  --yg-radius:12px; --yg-shadow:0 1px 2px rgba(20,22,40,.04),0 1px 3px rgba(20,22,40,.06);
  --yg-av1:#2f9b8e; --yg-av2:#c65f8e; --yg-av3:#5566c4; --yg-av4:#c67f2f;
}
:global(.theme-dark) {
  --yg-ink:#f2f3f8; --yg-ink-fg:#16171c; --yg-bg:#131419; --yg-panel:#1c1d25; --yg-panel-soft:#191a21;
  --yg-border:#2a2c37; --yg-border-strong:#363845; --yg-text:#e8e9f1; --yg-text-dim:#a2a4b6; --yg-text-faint:#6f7183;
  --yg-green:#4cc981; --yg-green-bg:#16281e; --yg-green-line:#244b34;
  --yg-amber:#e0a441; --yg-amber-bg:#2a2213; --yg-amber-line:#4d3d1c;
  --yg-red:#ec6b74; --yg-red-bg:#2c1619; --yg-red-line:#522a2f;
  --yg-grey:#9092a6; --yg-grey-bg:#24262f;
  --yg-radius:12px; --yg-shadow:0 1px 2px rgba(0,0,0,.3),0 1px 3px rgba(0,0,0,.35);
  --yg-av1:#37b3a4; --yg-av2:#d873a1; --yg-av3:#7d8bec; --yg-av4:#d99a4a;
}
```

- [ ] **Step 2: Add the shared component classes**

Add (all selectors `:global(...)` since this partial is `@use`d and consumed cross-component — follow the existing yg-table.scss `:global` convention): `.yg-btn`, `.yg-btn--primary/--ghost/--danger`, `.yg-idbadge`, `.yg-avatar`(+`--sm`,`.yg-av1..4`), `.yg-tag`(+`--approved/--submitted/--rejected/--draft`). Copy each rule's properties verbatim from the mockups' `.btn`/`.avatar`/`.tag`/`.id` rules, swapping hardcoded hex for the matching `--yg-*` token. Keep the existing classes intact.

- [ ] **Step 3: Build + svelte-check**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet-resources
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check
```
No NEW errors (the partial has no markup, so no unused-selector warnings from it directly).

- [ ] **Step 4: Commit**
```bash
git add plugins/yg-timesheet-resources/src/components/yg-table.scss
git commit -m "yg-timesheet: YG portal design tokens + shared button/avatar/tag classes"
```

---

### Task 2: My Timesheet redesign (day-grouped cards) + submit-error toast

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Timesheet.svelte`

**Design:** `docs/superpowers/specs/mockups/my-timesheet.html` — day-grouped cards with a status accent rail, header (weekday·date · day-status pill · total · Submit/Recall), task rows (id badge · title link · hours · task-status `.yg-tag`), and a reason callout for rejected.

**Preserve exactly (do NOT alter the `<script>`):** the week query + nav, the per-employee `TimesheetTask` reactive query and `tasksByKey`, `deriveDayStatus`, the Submit/Recall gates and handlers (`submitDay`/`recallDay` calls), per-task status + `rejectReason`, and the rule that **approved hours are never shown** (render `task.submittedHours` only).

- [ ] **Step 1: Re-mark-up the weekly view to the mockup**

Replace the current `.ts-*` table markup with the day-grouped structure from the mockup, using Task 1 tokens/classes:
- Each day → a `.day` card; add a status class (`is-draft/is-submitted/is-partial/is-approved/is-rejected`) driving the accent rail (`::before`), derived from the day's `deriveDayStatus`.
- Day header: weekday + date, the day-level `.yg-pill--{status}`, total hours (tabular), and the Submit (`.yg-btn--primary`, black) / Recall (`.yg-btn--ghost`) button under the same gates as today.
- Task rows: `.yg-idbadge` for the identifier, the title as an **`<a>` linking to the issue detail** (see Step 2), hours right-aligned, and the per-task `.yg-tag--{status}`.
- Empty days: the quiet "No time logged yet" variant, no accent.
- Rejected day: the reason callout (from the mockup `.reason`) rendering the task's `rejectReason` with the copy `Rejected: "<reason>." Open the task, fix it, then resubmit the day.` (colon, no em-dash). Keep whichever reason source the component already uses (per-task `rejectReason`).

- [ ] **Step 2: Link each task to its Huly issue (#4b)**

Make the task title/id a link to the issue's detail panel. Use Huly's location navigation — check how another yg-timesheet or tracker component opens an issue (grep for `getPanelURI`/`getClient` + `tracker.component.EditIssue`, or `navigate`/`Location` with the issue `_id`). The task row already has `task.issue` (a `Ref<Issue>`). Implement the minimal correct navigation (an `<a href>` built via `getPanelURI(tracker.component.EditIssue, issueId, ...)` or an `on:click` calling the panel opener). If the exact opener is unclear, grep `plugins/tracker-resources` for how an issue id is turned into a clickable link and mirror it. Report the mechanism used.

- [ ] **Step 3: Route the "no approver" submit error to a toast (#2)**

Where `submitDay` returns the `NO_APPROVER` result today, the component renders it inline in the table. Instead, show a **toast** and render nothing inline. Use Huly's notification API — grep `packages/ui/src` for the toast/notification helper (e.g. `addNotification` / `NotificationSeverity` from `@hcengineering/ui`). Toast copy: title "Can't submit <weekday>", body "No approver set for <project names>. Ask an admin to assign a PM or Team Lead on that project, then submit." Remove the inline error element. Report the exact API used.

- [ ] **Step 4: Build + svelte-check + test**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet-resources
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check && node ../../common/scripts/install-run-rushx.js test
```
Expect 114 tests. Report every `Timesheet.svelte` svelte-check line; no NEW non-`$lookup` error. Do NOT add a local `.yg-table td/th` override that stomps `td.yg-num` (the known cascade bug) — this design uses `.day` cards, not `.yg-table`, so it shouldn't arise; confirm.

- [ ] **Step 5: Commit**
```bash
git add plugins/yg-timesheet-resources/src/components/Timesheet.svelte
git commit -m "yg-timesheet: My Timesheet day-grouped redesign; task links; submit-error toast"
```

---

### Task 3: Approvals redesign (grouped by person)

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Approvals.svelte`
- Modify: `plugins/yg-timesheet-resources/src/components/ApproveTaskPopup.svelte` (restyle to the YG dialog + new copy)
- Modify: `plugins/yg-timesheet-resources/src/components/RejectTaskPopup.svelte` (restyle to the YG dialog)

**Design:** `docs/superpowers/specs/mockups/approvals.html` — a summary line, then one card per submitter (`.yg-avatar` + name + submitted date + task count + pending hours), with per-task rows (date · id · title link · hours · Approve `.yg-btn--primary` / Reject `.yg-btn--danger`). The mockup's centered `.dialog` is the target for the Approve/Reject popups.

**Preserve exactly:** the `canApprove` role gate + `{:else}` Restricted state, the reactive `TimesheetTask {status:'Submitted'}` query with the nested `$lookup`, the employee resolution, and the `onApprove`/`onReject` handlers with their existing `showPopup(ApproveTaskPopup/RejectTaskPopup,…)` wiring. This is a presentation change.

- [ ] **Step 1: Group the flat task list by employee**

In the `<script>` (this is the ONE allowed logic addition here): derive a grouped structure from the existing task list — `Map<employeeRef, { name, tasks[] }>` (name via the existing employee resolution/`employeeNames`-style lookup, or the `EmployeeRefPresenter` already used). Do NOT change the query/gate/handlers. If grouping needs the employee name and only a ref is resolvable, keep using `EmployeeRefPresenter` for display and group by the ref.

- [ ] **Step 2: Re-mark-up to the mockup**

Render the summary ("<N> tasks from <M> people · <H>h awaiting your review", computed from the grouped data), then a `.group` card per employee (avatar initials via a small helper on the name, name, submitted date = min task date, count, pending-hours total), then each task as a row with the id badge, title link (same issue-link approach as Task 2 Step 2), submitted hours, and the Approve/Reject `.yg-btn`s calling the unchanged handlers. Empty state: the "Nothing to approve — you're all caught up." `.yg-empty` variant. Use Task 1 tokens/classes.

- [ ] **Step 3: Restyle the Approve/Reject dialogs**

Restyle `ApproveTaskPopup.svelte` and `RejectTaskPopup.svelte` to the mockup's `.dialog` using Task 1 tokens. Keep their existing props and the `dispatch('close', …)` payloads UNCHANGED (Approve returns `{ approvedHours }`, Reject returns `{ reason }`). For ApproveTaskPopup:
- Title "Approve time"; sub line `<identifier> · <title> · <employee>` (use `·`, no em-dash) if the employee is available as a prop, else `<identifier> · <title>`.
- Fields: "Submitted <n>h" (read-only) and an editable "Approve hours" input defaulting to the submitted hours.
- Note copy (exact): `Set the hours you're approving for this task. This won't change the employee's logged time.`
- Buttons: Cancel (`.yg-btn--ghost`) and Approve (`.yg-btn--primary`, black), label "Approve <n>h".
For RejectTaskPopup: title "Reject time", a required multi-line reason field with placeholder "What needs fixing before this can be approved?", Cancel + Reject (`.yg-btn--danger`); keep the existing required-reason validation.

- [ ] **Step 4: Build + svelte-check + test** (same commands as Task 2 Step 4; expect 114; report Approvals/ApproveTaskPopup/RejectTaskPopup lines)

- [ ] **Step 5: Commit**
```bash
git add plugins/yg-timesheet-resources/src/components/Approvals.svelte \
        plugins/yg-timesheet-resources/src/components/ApproveTaskPopup.svelte \
        plugins/yg-timesheet-resources/src/components/RejectTaskPopup.svelte
git commit -m "yg-timesheet: Approvals redesign grouped by person; YG approve/reject dialogs"
```

---

### Task 4: Reports redesign (toolbar + scannable table)

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Reports.svelte`

**Design:** `docs/superpowers/specs/mockups/reports.html` — header with summary + **Export CSV** (`.yg-btn--primary`), a filter toolbar (From→To · Project · Person · Status), the scannable `.yg-table` (Date · Person avatar · Task id+link · Project · Spent · Approved · Approved by avatar+name · Status chip), totals `tfoot`, and pager.

**Preserve exactly:** the `canApprove` gate, all data queries (`reportQuery`, `projectQuery`, `empQuery`, `statusQuery`, `approvalQuery`), `allRows`/`filterRows`, the CSV `toCSV`/export, and the approval-overlay join. Only the filter-control markup and the table markup/classes change. The existing filter state variables (from/to/project/member/status) stay; only their rendered controls get the `.ctrl` styling from the mockup (keep the real `<select>`/date inputs functional — style them, don't replace with static spans).

- [ ] **Step 1: Restyle header + toolbar** — summary line, Export button (`.yg-btn--primary` with the download icon), and the filter controls styled per the mockup `.ctrl` (wrap the existing selects/date pickers; keep them interactive).

- [ ] **Step 2: Restyle the table** — apply `.yg-table` shared classes; Person and Approved-by cells use `.yg-avatar--sm` + name (Approved-by shows the resolved approver name, or "Pending" when no approval — this is the column the Task 5 fix populates); id badge + title link; Spent/Approved `.yg-num`; issue Status as a `.schip` (from the mockup). Keep totals `tfoot` and the pager.

- [ ] **Step 3: Build + svelte-check + test** (same commands; expect 114; report Reports.svelte lines — a benign nested-`$lookup` line is allowed)

- [ ] **Step 4: Commit**
```bash
git add plugins/yg-timesheet-resources/src/components/Reports.svelte
git commit -m "yg-timesheet: Reports redesign — toolbar, scannable table, approver column"
```

---

### Task 5: Fix blank "Approved by" — stamp the approver at approve time (#8)

The CSV/report shows Approved Hours but a blank Approved By because `approveTask` creates the `TimesheetApproval` with only `{task, approvedHours}`; the server trigger meant to stamp `approvedBy` runs before the row exists and never fills it (the known attribution race). Beta fix: stamp the approver on the client at approve time.

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/day.ts` (`approveTask`)

- [ ] **Step 1: Stamp approvedBy/approvedOn in approveTask**

In `approveTask`, when creating OR updating the `TimesheetApproval`, also set `approvedBy: getCurrentEmployee()` and `approvedOn: Date.now()`. Import `getCurrentEmployee` from `@hcengineering/contact` if not already imported. (Rationale: the "server-stamps it" purity belongs to the deferred security fix; for beta this is correct and the forgery gap is already accepted-for-beta.) Confirm `rejectTask` still removes the approval row unchanged.

- [ ] **Step 2: Build + test**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet-resources
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test
```
Expect 114 (no unit test covers this I/O function; verified at the manual e2e). Report the build result.

- [ ] **Step 3: Commit**
```bash
git add plugins/yg-timesheet-resources/src/utils/day.ts
git commit -m "yg-timesheet: stamp approvedBy/approvedOn at approve time (fix blank Approved By)"
```

---

### Task 6: Distinct sidebar icons (#6)

**Files:**
- Modify: `models/yg-timesheet/src/index.ts` (the four `navigatorModel.specials` icons on the `ygTimesheet.app.Timesheet` app)

- [ ] **Step 1: Give each special its own icon**

The four specials currently all use `ygTimesheet.icon.Timesheet`. Assign distinct, meaning-appropriate icons from already-imported icon sets (the model file already imports `hr`, `contact`, `tracker`/`view` — grep the file's imports and pick real existing assets): e.g. My Timesheet → a clock/time icon, Approvals → a check/approve icon, Reports → a list/table/chart icon, Configuration → a settings/gear icon. Use only asset ids that exist (verify against the imported plugin's icon block); if unsure an icon exists, pick one you can confirm is imported. Report the four icons chosen.

- [ ] **Step 2: Build + commit**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-timesheet
git add models/yg-timesheet/src/index.ts
git commit -m "yg-timesheet: distinct sidebar icons per menu item"
```

---

### Task 7: Rename Projects → Configuration (#7) + restyle the config page

**Files:**
- Modify: `plugins/yg-timesheet-assets/lang/en.json`, `ru.json` (add a `Configuration` string, or repurpose)
- Modify: `plugins/yg-timesheet/src/index.ts` (declare `Configuration` string id if adding one)
- Modify: `models/yg-timesheet/src/index.ts` (the `projects` special's `label`)
- Modify: `plugins/yg-timesheet-resources/src/components/ProjectApproversList.svelte` and `ProjectApprovers.svelte` (YG restyle)

- [ ] **Step 1: Rename the menu item**

Add a `Configuration` IntlString (id in `plugins/yg-timesheet/src/index.ts`, value "Configuration" in `en.json` + `ru.json`) and set the `projects` special's `label` to `ygTimesheet.string.Configuration` in `models/yg-timesheet/src/index.ts`. (Keep the special `id: 'projects'` so existing URLs still resolve; only the label changes.)

- [ ] **Step 2: Restyle the config page**

Give `ProjectApproversList.svelte` / `ProjectApprovers.svelte` the YG treatment using Task 1 tokens: a titled section ("Approvers per project" with a one-line description of what assigning a PM/Team Lead does), each project as a clean `.yg`-styled row/card with its two `EmployeeBox` pickers (PM, Team Lead) clearly labelled, on `--yg-panel`/`--yg-border`. Keep the existing mixin-write behavior (`createMixin`/`updateMixin`) and the Maintainer gate untouched — presentation only.

- [ ] **Step 3: Build + svelte-check + commit**
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly && source ~/.nvm/nvm.sh && nvm use 22
node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-timesheet --to @hcengineering/yg-timesheet-resources
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js svelte-check
git add plugins/yg-timesheet-assets/lang/ plugins/yg-timesheet/src/index.ts models/yg-timesheet/src/index.ts plugins/yg-timesheet-resources/src/components/ProjectApproversList.svelte plugins/yg-timesheet-resources/src/components/ProjectApprovers.svelte
git commit -m "yg-timesheet: rename Projects -> Configuration; restyle the approver config page"
```

---

## Post-implementation (operator)
Rebuild front + workspace images + `upgrade-workspace testws` (one batched rebuild) to see it live. Manual check: My Timesheet day cards + status rail + task links + rejection callout; submit-with-no-approver shows a toast; Approvals grouped by person; Reports shows approver names; distinct sidebar icons; the menu reads "Configuration".
