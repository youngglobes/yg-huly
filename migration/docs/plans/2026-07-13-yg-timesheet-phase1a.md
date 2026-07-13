# YG Timesheet — Phase 1a Implementation Plan (My Timesheet read-only week view)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "My Timesheet" workbench app that shows the signed-in employee their own week of already-logged time (Huly `TimeSpendReport`s) grouped by day → issue, with day/week totals and week navigation. Read-only — no new persisted docs, no workflow yet.

**Architecture:** Reuse the spike's `@hcengineering/yg-timesheet` (ids) and `@hcengineering/model-yg-timesheet` (model) packages; add two new packages — `yg-timesheet-resources` (Svelte + a pure grouping lib) and `yg-timesheet-assets` (icon + en strings) — and register a `workbench.class.Application`. The view is a live query over `tracker.class.TimeSpendReport` filtered by current employee + week range, `$lookup`ing the attached `Issue`; all non-trivial grouping/date logic lives in a pure, unit-tested lib module.

**Tech Stack:** Huly platform monorepo (rush + pnpm, TypeScript, esbuild, Svelte), jest/ts-jest for the pure logic. Local-only — no CI, no deploy.

## Global Constraints

- Repo `/home/karthi_0008/dev/client-projects/yg-huly`, branch **`yg_beta`** (local-only). Commit only here; **never push** (pushing does nothing — CI is gated to `yg_develop` — but keep it local per project decision).
- Version pins: every new package `"version": "0.7.426"`; all workspace deps `"workspace:^0.7.426"`.
- Package/id naming (exact, consumed across tasks): plugin `@hcengineering/yg-timesheet`, id `ygTimesheetId = 'yg-timesheet'`; new packages `@hcengineering/yg-timesheet-resources`, `@hcengineering/yg-timesheet-assets`; app id `ygTimesheet.app.Timesheet`; main component id `ygTimesheet.component.Timesheet`; icon id `ygTimesheet.icon.Timesheet`.
- Rush wrappers from repo root: `node common/scripts/install-run-rush.js <cmd>`. Use node 22 first: `source ~/.nvm/nvm.sh && nvm use`. `rush update` after adding a package/dep (fast, cached).
- Follow existing upstream patterns verbatim — the `hr` plugin quartet (`plugins/hr`, `plugins/hr-resources`, `plugins/hr-assets`, `models/hr`) is the reference; copy its config files (tsconfig/.eslintrc/jest.config/rig) into new packages rather than hand-writing them.
- TDD reality for this codebase: plugin/model/resources packages run `jest --passWithNoTests` (Huly does not unit-test Svelte/model wiring). So **genuine unit tests go on the pure logic (Task 1)**; wiring/UI tasks are verified by `rush build` (compilation) and the Task 7 local-stack render. Do not fabricate assertion-free tests for wiring.
- The spike already created `plugins/yg-timesheet/{src/index.ts,...}` and `models/yg-timesheet/{src/index.ts,...}` with a single `Timesheet` class. This plan EXTENDS those files; it does not recreate them.

---

### Task 1: Pure week/grouping lib (real TDD) + the resources package skeleton

**Files:**
- Create: `plugins/yg-timesheet-resources/package.json`
- Create: `plugins/yg-timesheet-resources/tsconfig.json`, `.eslintrc.js`, `jest.config.js`, `config/rig.json` (copy from `plugins/hr-resources`)
- Create: `plugins/yg-timesheet-resources/src/lib/week.ts`
- Test: `plugins/yg-timesheet-resources/src/__tests__/week.test.ts`
- Modify: `rush.json` (one project entry)

**Interfaces:**
- Produces (Task 4 consumes): from `./lib/week`:
  - `type DayKey = string` (ISO `YYYY-MM-DD` in local time)
  - `interface WeekRange { start: number, end: number, days: { key: DayKey, date: number }[] }`
  - `weekRange(dateMs: number): WeekRange` — Monday 00:00 (local) through the following Monday 00:00 exclusive; `days` has 7 entries Mon→Sun.
  - `interface ReportLike { employee: string | null, date: number | null, value: number, issueId: string, issueIdentifier: string, issueTitle: string, project: string }`
  - `interface DayGroup { key: DayKey, date: number, total: number, issues: { issueId: string, identifier: string, title: string, project: string, hours: number }[] }`
  - `groupByDay(reports: ReportLike[], week: WeekRange): { days: DayGroup[], weekTotal: number }` — buckets reports into the 7 days by local date, sums `value` per issue within a day (multiple reports on same issue/day collapse), each day's `issues` sorted by identifier, `total` per day and `weekTotal` overall. Reports with null date/employee are ignored.
  - `formatHours(n: number): string` — e.g. `0 → '0h'`, `1 → '1h'`, `1.5 → '1h 30m'`, `0.25 → '15m'`, `8 → '8h'`.

- [ ] **Step 1: Create branch check + resources package scaffold**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git branch --show-current   # must print yg_beta; if not: git switch yg_beta
mkdir -p plugins/yg-timesheet-resources/src/lib plugins/yg-timesheet-resources/src/__tests__ plugins/yg-timesheet-resources/config
cp plugins/hr-resources/tsconfig.json plugins/yg-timesheet-resources/tsconfig.json
cp plugins/hr-resources/.eslintrc.js  plugins/yg-timesheet-resources/.eslintrc.js
cp plugins/hr-resources/jest.config.js plugins/yg-timesheet-resources/jest.config.js
cp plugins/hr-resources/config/rig.json plugins/yg-timesheet-resources/config/rig.json
```

Write `plugins/yg-timesheet-resources/package.json` (mirror `plugins/hr-resources/package.json`'s scripts/devDeps; deps trimmed to what Phase 1a uses):

```json
{
  "name": "@hcengineering/yg-timesheet-resources",
  "version": "0.7.426",
  "main": "src/index.ts",
  "author": "YoungGlobes",
  "template": "@hcengineering/webpack-package",
  "license": "EPL-2.0",
  "scripts": {
    "build": "compile ui",
    "build:watch": "compile ui",
    "format": "format src",
    "svelte-check": "do-svelte-check",
    "_phase:build": "compile ui",
    "_phase:format": "format src",
    "_phase:validate": "compile validate",
    "_phase:test": "jest --passWithNoTests --silent --forceExit",
    "test": "jest --passWithNoTests --silent --forceExit"
  },
  "devDependencies": {
    "@hcengineering/platform-rig": "workspace:^0.7.426",
    "@typescript-eslint/eslint-plugin": "^6.21.0",
    "eslint-plugin-import": "^2.26.0",
    "eslint-plugin-promise": "^6.1.1",
    "eslint-plugin-n": "^15.4.0",
    "eslint": "^8.54.0",
    "@typescript-eslint/parser": "^6.21.0",
    "eslint-config-standard-with-typescript": "^40.0.0",
    "prettier": "^3.6.2",
    "typescript": "^5.9.3",
    "@types/node": "^22.18.1",
    "svelte-loader": "^3.2.4",
    "svelte-preprocess": "^6.0.3",
    "svelte-eslint-parser": "^0.41.1",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.5",
    "ts-jest": "^29.1.1"
  },
  "dependencies": {
    "@hcengineering/core": "workspace:^0.7.426",
    "@hcengineering/platform": "workspace:^0.7.426",
    "@hcengineering/presentation": "workspace:^0.7.426",
    "@hcengineering/ui": "workspace:^0.7.426",
    "@hcengineering/view-resources": "workspace:^0.7.426",
    "@hcengineering/contact": "workspace:^0.7.426",
    "@hcengineering/tracker": "workspace:^0.7.426",
    "@hcengineering/yg-timesheet": "workspace:^0.7.426",
    "svelte": "^4.2.19"
  }
}
```

> Copy the exact `devDependencies`/`template`/scripts from `plugins/hr-resources/package.json` if any value above differs from the repo's current rig — the repo's real values win. Check with `sed -n '1,40p' plugins/hr-resources/package.json`.

Add to `rush.json` after the `@hcengineering/yg-timesheet` entry:

```json
    {
      "packageName": "@hcengineering/yg-timesheet-resources",
      "projectFolder": "plugins/yg-timesheet-resources",
      "shouldPublish": false
    },
```

- [ ] **Step 2: Write the failing tests** — `plugins/yg-timesheet-resources/src/__tests__/week.test.ts`

```ts
import { weekRange, groupByDay, formatHours, type ReportLike } from '../lib/week'

// A fixed Wednesday: 2026-07-15 10:00 local
const wed = new Date(2026, 6, 15, 10, 0, 0).getTime()

describe('weekRange', () => {
  it('spans Monday 00:00 to next Monday 00:00 with 7 day buckets', () => {
    const w = weekRange(wed)
    const start = new Date(w.start)
    expect(start.getDay()).toBe(1) // Monday
    expect(start.getHours()).toBe(0)
    expect(w.days).toHaveLength(7)
    expect(new Date(w.days[0].date).getDay()).toBe(1) // Mon
    expect(new Date(w.days[6].date).getDay()).toBe(0) // Sun
    expect(w.end).toBeGreaterThan(w.start)
  })
})

describe('formatHours', () => {
  it.each([
    [0, '0h'], [1, '1h'], [8, '8h'], [1.5, '1h 30m'], [0.25, '15m'], [2.75, '2h 45m']
  ])('formats %p as %p', (n, expected) => {
    expect(formatHours(n as number)).toBe(expected)
  })
})

describe('groupByDay', () => {
  const mk = (dayOffset: number, issueId: string, value: number, ident = issueId): ReportLike => {
    const w = weekRange(wed)
    return {
      employee: 'e1', date: w.days[dayOffset].date + 3600_000, value,
      issueId, issueIdentifier: ident, issueTitle: 't-' + issueId, project: 'P'
    }
  }
  it('buckets by day, sums same-issue reports, computes totals', () => {
    const w = weekRange(wed)
    const { days, weekTotal } = groupByDay([mk(0, 'A', 2), mk(0, 'A', 1), mk(0, 'B', 3), mk(2, 'C', 4)], w)
    expect(days).toHaveLength(7)
    expect(days[0].total).toBe(6)                 // Mon: A(2+1)+B(3)
    expect(days[0].issues.find(i => i.identifier === 'A')?.hours).toBe(3) // collapsed
    expect(days[2].total).toBe(4)                 // Wed
    expect(days[1].total).toBe(0)                 // Tue empty
    expect(weekTotal).toBe(10)
  })
  it('ignores reports with null date or employee', () => {
    const w = weekRange(wed)
    const bad: ReportLike = { employee: null, date: null, value: 5, issueId: 'X', issueIdentifier: 'X', issueTitle: 'x', project: 'P' }
    expect(groupByDay([bad], w).weekTotal).toBe(0)
  })
})
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
source ~/.nvm/nvm.sh && nvm use
node common/scripts/install-run-rush.js update
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test 2>&1 | tail -20; cd ../..
```
Expected: FAIL — `Cannot find module '../lib/week'`.

- [ ] **Step 4: Implement** — `plugins/yg-timesheet-resources/src/lib/week.ts`

```ts
//
// Pure week/grouping helpers for the timesheet view. No platform deps → unit-testable.
//
export type DayKey = string // YYYY-MM-DD (local)

export interface WeekRange {
  start: number
  end: number
  days: { key: DayKey, date: number }[]
}

export interface ReportLike {
  employee: string | null
  date: number | null
  value: number
  issueId: string
  issueIdentifier: string
  issueTitle: string
  project: string
}

export interface DayGroup {
  key: DayKey
  date: number
  total: number
  issues: { issueId: string, identifier: string, title: string, project: string, hours: number }[]
}

function localDayKey (ms: number): DayKey {
  const d = new Date(ms)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function weekRange (dateMs: number): WeekRange {
  const d = new Date(dateMs)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() // 0 Sun .. 6 Sat
  const backToMonday = dow === 0 ? 6 : dow - 1
  const monday = new Date(d)
  monday.setDate(d.getDate() - backToMonday)
  const days: { key: DayKey, date: number }[] = []
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday)
    dd.setDate(monday.getDate() + i)
    days.push({ key: localDayKey(dd.getTime()), date: dd.getTime() })
  }
  const end = new Date(monday)
  end.setDate(monday.getDate() + 7)
  return { start: monday.getTime(), end: end.getTime(), days }
}

export function groupByDay (reports: ReportLike[], week: WeekRange): { days: DayGroup[], weekTotal: number } {
  const byKey = new Map<DayKey, DayGroup>()
  for (const d of week.days) {
    byKey.set(d.key, { key: d.key, date: d.date, total: 0, issues: [] })
  }
  let weekTotal = 0
  for (const r of reports) {
    if (r.employee == null || r.date == null) continue
    const key = localDayKey(r.date)
    const grp = byKey.get(key)
    if (grp === undefined) continue // outside the week
    let issue = grp.issues.find((i) => i.issueId === r.issueId)
    if (issue === undefined) {
      issue = { issueId: r.issueId, identifier: r.issueIdentifier, title: r.issueTitle, project: r.project, hours: 0 }
      grp.issues.push(issue)
    }
    issue.hours += r.value
    grp.total += r.value
    weekTotal += r.value
  }
  const days = week.days.map((d) => {
    const g = byKey.get(d.key) as DayGroup
    g.issues.sort((a, b) => a.identifier.localeCompare(b.identifier))
    return g
  })
  return { days, weekTotal }
}

export function formatHours (n: number): string {
  if (n === 0) return '0h'
  const h = Math.floor(n)
  const m = Math.round((n - h) * 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}
```

- [ ] **Step 5: Run tests — verify pass**

```bash
cd plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test 2>&1 | tail -20; cd ../..
```
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add plugins/yg-timesheet-resources rush.json common/config/rush/pnpm-lock.yaml
git commit -m "feat(yg-timesheet): pure week/grouping lib + resources package skeleton"
```

---

### Task 2: Add app/component/icon ids to the plugin

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ygTimesheet.app.Timesheet: Ref<Doc>`, `ygTimesheet.component.Timesheet: AnyComponent`, `ygTimesheet.icon.Timesheet: Asset`, `ygTimesheet.string.Timesheet: IntlString` — used by Tasks 3/4/5.

- [ ] **Step 1: Extend the plugin definition**

Open `plugins/yg-timesheet/src/index.ts` (created by the spike; currently exports the `Timesheet` interface + `plugin(ygTimesheetId, { class: { Timesheet } })`). Add the imports and the new id groups. The final `plugin(...)` call must read:

```ts
import type { Asset, IntlString, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'
import type { Class, Doc, Ref, Timestamp } from '@hcengineering/core'
import type { Employee } from '@hcengineering/contact'

// (existing) export interface Timesheet extends Doc { employee: Ref<Employee>, weekStart: Timestamp }

export const ygTimesheetId = 'yg-timesheet' as Plugin

export default plugin(ygTimesheetId, {
  class: {
    Timesheet: '' as Ref<Class<Timesheet>>
  },
  app: {
    Timesheet: '' as Ref<Doc>
  },
  component: {
    Timesheet: '' as AnyComponent
  },
  icon: {
    Timesheet: '' as Asset
  },
  string: {
    Timesheet: '' as IntlString
  }
})
```

> Keep the existing `Timesheet` interface exactly as the spike wrote it. Only add `Asset/IntlString/AnyComponent` imports and the `app/component/icon/string` groups. `@hcengineering/ui` must be a dependency of `plugins/yg-timesheet/package.json` — add `"@hcengineering/ui": "workspace:^0.7.426"` if missing (check first).

- [ ] **Step 2: Build to verify types resolve**

```bash
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet
```
Expected: SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add plugins/yg-timesheet rush.json common/config/rush/pnpm-lock.yaml
git commit -m "feat(yg-timesheet): declare app/component/icon/string ids"
```

---

### Task 3: Assets package (icon + English strings + locale test)

**Files:**
- Create: `plugins/yg-timesheet-assets/package.json`, `tsconfig.json`, `.eslintrc.js`, `jest.config.js`, `config/rig.json` (copy from `plugins/hr-assets`)
- Create: `plugins/yg-timesheet-assets/src/index.ts`
- Create: `plugins/yg-timesheet-assets/assets/icons.svg`
- Create: `plugins/yg-timesheet-assets/lang/en.json`
- Test: `plugins/yg-timesheet-assets/src/__tests__/lang.test.ts`
- Modify: `rush.json`

**Interfaces:**
- Consumes: `ygTimesheet.icon.Timesheet`, `ygTimesheet.string.*` ids (Task 2).
- Produces: runtime metadata loader + `lang/en.json` (loaded by the platform wiring in Task 6).

- [ ] **Step 1: Scaffold from hr-assets**

```bash
mkdir -p plugins/yg-timesheet-assets/src/__tests__ plugins/yg-timesheet-assets/assets plugins/yg-timesheet-assets/lang plugins/yg-timesheet-assets/config
cp plugins/hr-assets/tsconfig.json plugins/yg-timesheet-assets/tsconfig.json
cp plugins/hr-assets/.eslintrc.js  plugins/yg-timesheet-assets/.eslintrc.js
cp plugins/hr-assets/jest.config.js plugins/yg-timesheet-assets/jest.config.js
cp plugins/hr-assets/config/rig.json plugins/yg-timesheet-assets/config/rig.json
sed -n '1,60p' plugins/hr-assets/package.json   # read to mirror name/template/exports exactly
```

Write `plugins/yg-timesheet-assets/package.json` mirroring `plugins/hr-assets/package.json` (same `"template": "@hcengineering/assets-package"`, same scripts/devDeps, same `exports` map for `./lang/*.json` and `./assets/*.svg`), with:
- `"name": "@hcengineering/yg-timesheet-assets"`, `"version": "0.7.426"`
- dependency `"@hcengineering/yg-timesheet": "workspace:^0.7.426"` and `"@hcengineering/platform": "workspace:^0.7.426"`.

- [ ] **Step 2: Icon sprite** — `plugins/yg-timesheet-assets/assets/icons.svg` (one simple clock/calendar glyph; viewBox must match hr's sprite convention — open `plugins/hr-assets/assets/icons.svg` to match the `<svg><symbol>` wrapper exactly):

```svg
<svg xmlns="http://www.w3.org/2000/svg">
  <symbol id="timesheet" viewBox="0 0 24 24">
    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
  </symbol>
</svg>
```

- [ ] **Step 3: English strings** — `plugins/yg-timesheet-assets/lang/en.json`

```json
{
  "string": {
    "Timesheet": "My Timesheet",
    "Week": "Week",
    "Today": "Today",
    "Total": "Total",
    "NoTimeLogged": "No time logged this week",
    "Hours": "Hours"
  }
}
```

- [ ] **Step 4: Metadata loader** — `plugins/yg-timesheet-assets/src/index.ts`

```ts
import ygTimesheet from '@hcengineering/yg-timesheet'
import { loadMetadata } from '@hcengineering/platform'

const icons = require('../assets/icons.svg') as string // eslint-disable-line
loadMetadata(ygTimesheet.icon, {
  Timesheet: `${icons}#timesheet`
})
```

- [ ] **Step 5: Locale test** — `plugins/yg-timesheet-assets/src/__tests__/lang.test.ts`

```ts
import { makeLocalesTest } from '@hcengineering/platform'
it('Locales are equal', makeLocalesTest(async (lang) => await import(`../../lang/${lang}.json`)))
```

- [ ] **Step 6: Register in rush.json + build + test**

Add the `@hcengineering/yg-timesheet-assets` entry to `rush.json` (projectFolder `plugins/yg-timesheet-assets`, `shouldPublish: false`). Then:

```bash
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet-assets
cd plugins/yg-timesheet-assets && node ../../common/scripts/install-run-rushx.js test 2>&1 | tail -12; cd ../..
```
Expected: build SUCCESS; lang test PASS (only `en` present → trivially consistent).

- [ ] **Step 7: Commit**

```bash
git add plugins/yg-timesheet-assets rush.json common/config/rush/pnpm-lock.yaml
git commit -m "feat(yg-timesheet): assets package (icon + en strings)"
```

---

### Task 4: My Timesheet Svelte view + Resources registration

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/Timesheet.svelte`
- Create: `plugins/yg-timesheet-resources/src/plugin.ts`
- Create: `plugins/yg-timesheet-resources/src/index.ts`

**Interfaces:**
- Consumes: `./lib/week` (Task 1); `ygTimesheet.component.Timesheet` (Task 2); `tracker.class.TimeSpendReport`/`tracker.class.Issue`; `getCurrentEmployee`.
- Produces: the default `Resources` mapping `component.Timesheet → Timesheet.svelte` (Task 6's `addLocation` loads it; Task 5's model `createDoc` references the id).

- [ ] **Step 1: Resources id merge** — `plugins/yg-timesheet-resources/src/plugin.ts`

```ts
import { ygTimesheetId } from '@hcengineering/yg-timesheet'
import ygTimesheet from '@hcengineering/yg-timesheet'
import { mergeIds } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'

export default mergeIds(ygTimesheetId, ygTimesheet, {
  component: {
    Timesheet: '' as AnyComponent
  }
})
```

- [ ] **Step 2: Resources export** — `plugins/yg-timesheet-resources/src/index.ts`

```ts
import { type Resources } from '@hcengineering/platform'
import Timesheet from './components/Timesheet.svelte'

export default async (): Promise<Resources> => ({
  component: {
    Timesheet
  }
})
```

- [ ] **Step 3: The week view** — `plugins/yg-timesheet-resources/src/components/Timesheet.svelte`

```svelte
<script lang="ts">
  import { getCurrentEmployee } from '@hcengineering/contact'
  import { type Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import tracker, { type Issue, type TimeSpendReport } from '@hcengineering/tracker'
  import { Label, Button, IconForward, IconBack } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { weekRange, groupByDay, formatHours, type ReportLike, type DayGroup } from '../lib/week'

  const me = getCurrentEmployee()
  let anchor = Date.now()
  $: week = weekRange(anchor)

  const query = createQuery()
  let days: DayGroup[] = []
  let weekTotal = 0

  $: query.query(
    tracker.class.TimeSpendReport,
    { employee: me, date: { $gte: week.start, $lt: week.end } },
    (res: TimeSpendReport[]) => {
      const reports: ReportLike[] = res.map((r) => {
        const issue = r.$lookup?.attachedTo as Issue | undefined
        return {
          employee: r.employee as Ref<any> | null,
          date: r.date,
          value: r.value,
          issueId: (issue?._id ?? r.attachedTo) as string,
          issueIdentifier: issue?.identifier ?? '—',
          issueTitle: issue?.title ?? '(unknown issue)',
          project: (issue?.space ?? '') as string
        }
      })
      const g = groupByDay(reports, week)
      days = g.days
      weekTotal = g.weekTotal
    },
    { lookup: { attachedTo: tracker.class.Issue } }
  )

  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  function shift (deltaWeeks: number): void { anchor = anchor + deltaWeeks * 7 * 86400_000 }
</script>

<div class="ac-header full divide">
  <div class="ac-header__wrap-title">
    <span class="ac-header__title"><Label label={ygTimesheet.string.Timesheet} /></span>
  </div>
  <div class="ac-header-full">
    <Button icon={IconBack} kind="ghost" on:click={() => shift(-1)} />
    <span class="p-2">{weekdayFmt.format(week.start)} — {weekdayFmt.format(week.end - 86400_000)}</span>
    <Button icon={IconForward} kind="ghost" on:click={() => shift(1)} />
    <Button kind="ghost" label={ygTimesheet.string.Today} on:click={() => (anchor = Date.now())} />
    <div class="ml-4"><Label label={ygTimesheet.string.Total} />: <b>{formatHours(weekTotal)}</b></div>
  </div>
</div>

<div class="ts-grid">
  {#each days as day (day.key)}
    <div class="ts-day">
      <div class="ts-day__head">
        <span>{weekdayFmt.format(day.date)}</span>
        <span class="ts-day__total">{formatHours(day.total)}</span>
      </div>
      {#if day.issues.length === 0}
        <div class="ts-empty">—</div>
      {:else}
        {#each day.issues as it (it.issueId)}
          <div class="ts-line">
            <span class="ts-line__id">{it.identifier}</span>
            <span class="ts-line__title">{it.title}</span>
            <span class="ts-line__hrs">{formatHours(it.hours)}</span>
          </div>
        {/each}
      {/if}
    </div>
  {/each}
</div>

<style lang="scss">
  .ts-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; padding: 1rem; overflow: auto; }
  .ts-day { border: 1px solid var(--theme-divider-color); border-radius: 0.5rem; padding: 0.5rem; min-height: 6rem; }
  .ts-day__head { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 0.5rem; }
  .ts-day__total { color: var(--theme-content-color); }
  .ts-line { display: flex; gap: 0.25rem; font-size: 0.75rem; padding: 0.125rem 0; }
  .ts-line__id { color: var(--theme-dark-color); }
  .ts-line__title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ts-line__hrs { font-variant-numeric: tabular-nums; }
  .ts-empty { color: var(--theme-darker-color); text-align: center; }
</style>
```

> If `svelte-check`/`compile ui` reports that any imported name from `@hcengineering/ui` (`IconForward`, `IconBack`, `Button`, `Label`) or `@hcengineering/tracker` (`TimeSpendReport.$lookup`) has a different export name in this version, grep the referenced package's `src/index.ts` for the correct name and adjust — do NOT invent names. `createQuery` from `@hcengineering/presentation` and `getCurrentEmployee` from `@hcengineering/contact` are confirmed present (used by `plugins/hr-resources/src/components/ScheduleView.svelte`).

- [ ] **Step 2 (verify): Build the resources package (svelte compile is the check)**

```bash
node common/scripts/install-run-rush.js build --to @hcengineering/yg-timesheet-resources
```
Expected: SUCCESS (compiles the Svelte + TS). Fix any name-resolution errors per the note above, then rebuild.

- [ ] **Step 3: Commit**

```bash
git add plugins/yg-timesheet-resources/src
git commit -m "feat(yg-timesheet): My Timesheet week view + Resources"
```

---

### Task 5: Register the workbench Application in the model

**Files:**
- Modify: `models/yg-timesheet/src/index.ts`
- Create: `models/yg-timesheet/src/plugin.ts`
- Modify: `models/yg-timesheet/package.json`

**Interfaces:**
- Consumes: `ygTimesheet.app.Timesheet`, `.icon.Timesheet`, `.component.Timesheet`, `.string.Timesheet` (Tasks 2/4).
- Produces: an `Application` Doc so the app shows in the left rail.

- [ ] **Step 1: Add deps** to `models/yg-timesheet/package.json` dependencies:

```json
    "@hcengineering/model-workbench": "workspace:^0.7.426",
    "@hcengineering/workbench": "workspace:^0.7.426",
    "@hcengineering/ui": "workspace:^0.7.426",
    "@hcengineering/yg-timesheet-resources": "workspace:^0.7.426",
```

- [ ] **Step 2: Model-side strings** — `models/yg-timesheet/src/plugin.ts`

```ts
import { ygTimesheetId } from '@hcengineering/yg-timesheet'
import ygTimesheet from '@hcengineering/yg-timesheet'
import { mergeIds } from '@hcengineering/platform'
import type { IntlString } from '@hcengineering/platform'

export default mergeIds(ygTimesheetId, ygTimesheet, {
  string: {
    Timesheet: '' as IntlString
  }
})
```

- [ ] **Step 3: Register the Application** — append to `createModel(builder)` in `models/yg-timesheet/src/index.ts` (keep the existing `builder.createModel(TTimesheet)` call):

```ts
import workbench from '@hcengineering/model-workbench'
import core from '@hcengineering/model-core'
import ygTimesheet from './plugin'
// ... existing imports + TTimesheet ...

export function createModel (builder: Builder): void {
  builder.createModel(TTimesheet)

  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: ygTimesheet.string.Timesheet,
      icon: ygTimesheet.icon.Timesheet,
      alias: ygTimesheetId,
      hidden: false,
      position: 'top',
      component: ygTimesheet.component.Timesheet
    },
    ygTimesheet.app.Timesheet
  )
}
```

> Note the two `ygTimesheet` sources: the plugin ids come via `./plugin` (mergeIds re-export). Follow `models/hr/src/index.ts` exactly for the import shape (`import hr from './plugin'` there). `workbench.class.Application` and `core.space.Model` come from the model packages, matching the hr registration snippet.

- [ ] **Step 4: Build**

```bash
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-timesheet
```
Expected: SUCCESS.

- [ ] **Step 5: Commit**

```bash
git add models/yg-timesheet rush.json common/config/rush/pnpm-lock.yaml
git commit -m "feat(yg-timesheet): register My Timesheet workbench application"
```

---

### Task 6: Platform wiring (load the app + strings in front & desktop)

**Files:**
- Modify: `dev/prod/src/platform.ts`
- Modify: `desktop/src/ui/platform.ts`

**Interfaces:**
- Consumes: `ygTimesheetId`, `@hcengineering/yg-timesheet-assets`, `@hcengineering/yg-timesheet-resources`.
- Produces: the app is loadable in the running client. This is the last wiring before it renders.

- [ ] **Step 1: Add the four lines to `dev/prod/src/platform.ts`** (mirror the `hr` lines exactly — grep `hr` in that file to find the four insertion points):

```ts
// with the other plugin id imports:
import { ygTimesheetId } from '@hcengineering/yg-timesheet'
// with the other `import '@hcengineering/*-assets'` lines:
import '@hcengineering/yg-timesheet-assets'
// with the other addStringsLoader(...) calls:
addStringsLoader(ygTimesheetId, async (lang: string) => await import(`@hcengineering/yg-timesheet-assets/lang/${lang}.json`))
// with the other addLocation(...) calls:
addLocation(ygTimesheetId, async () => await import('@hcengineering/yg-timesheet-resources'))
```

Add `@hcengineering/yg-timesheet`, `@hcengineering/yg-timesheet-assets`, `@hcengineering/yg-timesheet-resources` to `dev/prod/package.json` dependencies (workspace:^0.7.426).

- [ ] **Step 2: Same four lines + deps in `desktop/src/ui/platform.ts`** and `desktop/package.json` (identical pattern).

- [ ] **Step 3: Build the front bundle end-to-end**

```bash
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js build --to @hcengineering/prod --to @hcengineering/model-all
```
Expected: SUCCESS — this compiles the whole client (dev/prod) including the new app, and the model. A failure here is the real integration check for the wiring.

- [ ] **Step 4: Commit**

```bash
git add dev/prod desktop rush.json common/config/rush/pnpm-lock.yaml
git commit -m "feat(yg-timesheet): wire My Timesheet app into front + desktop platform"
```

---

### Task 7: Local integration test — app renders with real data

**Files:** none (verification only). Runs on the LOCAL machine against the local stack at `/home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost` (already up on custom front + stock backend; this task rebuilds the images locally with a **local** tag so the new app is included).

- [ ] **Step 1: Build the four images locally with a non-prod tag**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
source ~/.nvm/nvm.sh && nvm use
node common/scripts/install-run-rush.js build --to @hcengineering/prod --to @hcengineering/pod-front --to @hcengineering/pod-workspace --to @hcengineering/pod-server --to @hcengineering/tool
( cd pods/front && node ../../common/scripts/install-run-rushx.js package && node ../../common/scripts/install-run-rushx.js bundle )
( cd pods/workspace && node ../../common/scripts/install-run-rushx.js bundle )
( cd pods/server && node ../../common/scripts/install-run-rushx.js bundle )
( cd dev/tool && node ../../common/scripts/install-run-rushx.js bundle )
docker build -t yg-local/front:beta      pods/front
docker build -t yg-local/workspace:beta  pods/workspace
docker build -t yg-local/transactor:beta pods/server
docker build -t yg-local/tool:beta       dev/tool
```
Expected: four images build. (If a pod's Dockerfile needs a step this omits, mirror `pods/front`'s `docker:build` inputs.)

- [ ] **Step 2: Point the local stack at the local images (all four, so the app model is applied) + fresh workspace**

Create `/home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost/compose.override.beta.yml`:
```yaml
services:
  front:      { image: yg-local/front:beta }
  workspace:  { image: yg-local/workspace:beta }
  transactor: { image: yg-local/transactor:beta }
```
Then (this REPLACES the earlier test override; a fresh workspace is needed because the app's model must be applied by the custom workspace image):
```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
rm -f compose.override.test.yml
docker compose -f compose.yml -f compose.override.beta.yml down -v
docker compose -f compose.yml -f compose.override.beta.yml up -d
sleep 45
source huly_v7.conf
# create workspace with the LOCAL tool image (carries the app model)
docker run --rm -t --network "${DOCKER_NAME}_huly_net" \
  -e SERVER_SECRET="$SECRET" -e DB_URL="$CR_DB_URL" -e ACCOUNT_DB_URL="$CR_DB_URL" \
  -e STORAGE_CONFIG="minio|minio?accessKey=minioadmin&secretKey=minioadmin" \
  -e QUEUE_CONFIG="redpanda:9092" \
  -e ACCOUNTS_URL="http://account:3000" -e TRANSACTOR_URL="ws://transactor:3333" \
  yg-local/tool:beta bundle.js create-account praja@yg.local -p Test1234 -f Praja -l Test
docker run --rm -t --network "${DOCKER_NAME}_huly_net" \
  -e SERVER_SECRET="$SECRET" -e DB_URL="$CR_DB_URL" -e ACCOUNT_DB_URL="$CR_DB_URL" \
  -e STORAGE_CONFIG="minio|minio?accessKey=minioadmin&secretKey=minioadmin" \
  -e QUEUE_CONFIG="redpanda:9092" \
  -e ACCOUNTS_URL="http://account:3000" -e TRANSACTOR_URL="ws://transactor:3333" \
  yg-local/tool:beta bundle.js create-workspace testws email:praja@yg.local
```

- [ ] **Step 3: Verify the app is registered + manual render check**

```bash
source huly_v7.conf
# the Application doc should exist in the workspace model tx/space:
docker compose exec -T cockroach cockroach sql --url "${CR_DB_URL}?sslmode=require" \
  -e "SELECT count(*) FROM public.tx WHERE data::STRING LIKE '%yg-timesheet:app:Timesheet%';" 2>/dev/null | tail -3
curl -s -o /dev/null -w "front: %{http_code}\n" http://localhost:8087/
```
Then manual (report in the task report): open `http://localhost:8087/`, log in `praja@yg.local` / `Test1234`, enter `testws`, create an issue and log time on it (spent), open the **My Timesheet** app in the left rail, confirm the logged time appears in the correct day cell with correct day/week totals and week nav works. Capture: app visible? time shows in right day? totals correct?

- [ ] **Step 4: Record results + keep stack up for dogfooding**

Write outcomes to `.superpowers/sdd/phase1a-integration.md` (app visible ✓/✗, data renders correctly ✓/✗, any console errors). Leave the stack running. Do NOT commit `compose.override.beta.yml` to yg-huly (it lives in the huly-migration repo).

---

## Self-review notes

- **Spec coverage (design §5-6):** Phase 1a delivers the "My Timesheet" app + the read-only week view over existing `TimeSpendReport`s (design §6 item 1, read-only portion). Deferred by design to later increments: persisted `Timesheet`/`TimesheetDay` docs, submit/approve, suggestions, reports, punch (1b–1d) — NOT gaps.
- **Testable-logic placement:** all non-trivial logic (week math, grouping, formatting) is in `lib/week.ts` with real jest tests (Task 1); UI/model/wiring verified by `rush build` (compilation) + Task 7 local render — honest for a codebase whose plugin packages use `--passWithNoTests`.
- **Name consistency:** `ygTimesheet.app.Timesheet` / `.component.Timesheet` / `.icon.Timesheet` / `.string.Timesheet` declared in Task 2, and consumed identically in Tasks 3 (icon), 4 (component), 5 (app/icon/component/string). `weekRange`/`groupByDay`/`formatHours`/`ReportLike`/`DayGroup` defined in Task 1, consumed in Task 4. Package names consistent with the spike (`yg-timesheet`, not `my-timesheet`).
- **Uncertainty handled with concrete fallbacks** (grep the real export name; mirror hr-assets/hr-resources config) rather than placeholders.
