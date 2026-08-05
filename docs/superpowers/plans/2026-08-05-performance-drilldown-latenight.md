# Performance report: late-night refinement + drill-down panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the Performance report's late-night rule (past 10 PM AND >8h logged) and add a click-to-open slide-in panel that lists each person's flagged days.

**Architecture:** All the math lives in the pure lib `utils/performance.ts`, which already ingests every `HrTimeEntry` and `AttendanceSession` in range. Extend it to (a) gate late-night on production hours and (b) attach a per-employee `days: FlaggedDay[]` breakdown to each `PerfRow`. `Performance.svelte` renders the unchanged table plus a lightweight slide-in `<aside>` bound to the clicked row's `days`. No model change, no new queries, no server work.

**Tech Stack:** TypeScript, Svelte 3, jest + ts-jest, Huly `@hcengineering/yg-timesheet` plugin.

## Global Constraints

- **Repo / branch:** `youngglobes/yg-huly`, branch `yg_beta`. Client-only change; deploys as a front-only build (`yg-local/front:beta`), no `upgrade-workspace`. NEVER merge to `yg_develop`.
- **Late-night rule (exact):** a day is late-night iff `dayLoggedHours > 8` AND some session that day has `end > localMidnight(day) + 22h`, where `end = punchOut ?? now`. "Production hours" = logged `HrTimeEntry` hours (NOT attendance presence). Applies on any day regardless of working/off classification.
- **Overtime (unchanged):** working day only, `max(0, dayLoggedHours - 8)`; overtime day iff working AND `dayLoggedHours > 8`.
- **Off-day (unchanged):** non-working day (`!isWorkingDay(day)`) with `dayLoggedHours > 0`; off-day hours = the day's logged hours.
- **Flagged day** = `offDay || overtimeHours > 0 || lateNight`. Panel lists flagged days only, **newest first**.
- **Do NOT deploy per task.** The build/deploy/smoke is one gated step at the end (batched with the already-committed 10 PM threshold change `c17ecd47a`).
- **No em-dashes** in code comments, commit messages, or UI copy. Compact chip labels are plain text (precedent: `Timesheet.svelte`); no new i18n strings.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugins/yg-timesheet-resources/src/utils/performance.ts` | **Modify.** Add `FlaggedDay`, `PerfRow.days`; gate late-night on >8h; build per-day breakdown. |
| `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts` | **Modify.** Rework the late-night test for the >8h gate; add `days` breakdown tests. |
| `plugins/yg-timesheet-resources/src/components/Performance.svelte` | **Modify.** Clickable rows + slide-in drill-down panel. |

---

## Task 1: Pure lib — late-night gate + per-day breakdown

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/performance.ts`
- Modify: `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts`

**Interfaces:**
- Produces: `FlaggedDay { date: number; offDay: boolean; overtimeHours: number; lateNight: boolean; hoursLogged: number; punchIn?: number; punchOut?: number }`; `PerfRow` gains `days: FlaggedDay[]` (flagged only, newest first). Aggregate columns keep their existing meaning; `lateNightDays` is now the count of `days` with `lateNight === true`. Consumed by Task 2.

- [ ] **Step 1: Rewrite the late-night test + add the breakdown tests (RED)**

In `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts`, replace the existing `it('late-night = distinct days with a session past 22:00 ...')` block with the two blocks below (keep every other test as-is). `D(y, m, d, h = 10)` and `NOW = D(2026, 7, 4, 12)` already exist; month is 0-indexed so `D(2026, 7, …)` is August (Aug 1 = Sat odd/working, Aug 2 = Sun, Aug 3 = Mon, Aug 6 = Thu).

```ts
  it('late-night = day with >8h logged AND a session past 22:00 (both gates required)', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 11, date: D(2026, 7, 3) }, // Mon: 11h logged
      { employee: 'e1', hours: 6, date: D(2026, 7, 1) },  // Sat (odd, working): 6h logged (<=8)
      { employee: 'e1', hours: 12, date: D(2026, 7, 6) }  // Thu: 12h logged
    ]
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 13), punchOut: D(2026, 7, 3, 23) }, // Mon out 11pm + 11h -> LATE
      { employee: 'e1', punchIn: D(2026, 7, 1, 15), punchOut: D(2026, 7, 2, 0) },  // Sat past 10pm but only 6h -> NOT late
      { employee: 'e1', punchIn: D(2026, 7, 6, 9), punchOut: D(2026, 7, 6, 21) }   // Thu 12h but out 9pm -> NOT late
    ]
    const r = performanceRows(emps, hours, atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.lateNightDays).toBe(1) // only Mon Aug 3
  })

  it('days = flagged days only, newest first, merged hours + punches, multi-signal once', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 11, date: D(2026, 7, 3) }, // Mon working: OT +3, plus late punch -> late-night
      { employee: 'e1', hours: 6, date: D(2026, 7, 2) },  // Sun off: off-day 6h
      { employee: 'e1', hours: 5, date: D(2026, 7, 4) }   // Tue working, 5h, no session -> NOT flagged
    ]
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 13), punchOut: D(2026, 7, 3, 23) } // Mon 1pm -> 11pm
    ]
    const r = performanceRows(emps, hours, atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.days.map((d) => d.date)).toEqual([D(2026, 7, 3, 0), D(2026, 7, 2, 0)]) // newest first, Tue excluded
    const mon = r.days[0]
    expect(mon.offDay).toBe(false)
    expect(mon.overtimeHours).toBe(3)
    expect(mon.lateNight).toBe(true)
    expect(mon.hoursLogged).toBe(11)
    expect(mon.punchIn).toBe(D(2026, 7, 3, 13))
    expect(mon.punchOut).toBe(D(2026, 7, 3, 23))
    const sun = r.days[1]
    expect(sun.offDay).toBe(true)
    expect(sun.overtimeHours).toBe(0)
    expect(sun.lateNight).toBe(false)
    expect(sun.hoursLogged).toBe(6)
    expect(sun.punchIn).toBeUndefined()
    expect(sun.punchOut).toBeUndefined()
  })
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test 2>&1 | grep -A3 performance`
Expected: `performance.test.ts` FAILS — `r.days` is undefined and `lateNightDays` is 2 under the old attendance-only rule.

- [ ] **Step 3: Rewrite `performance.ts` (GREEN)**

Replace the whole body of `plugins/yg-timesheet-resources/src/utils/performance.ts` with:

```ts
import { type WorkProfileCategory } from '@hcengineering/yg-timesheet'
import { isTracked } from './work-profile'
import { isWorkingDay } from './week'
import { localMidnight } from './attendance'

export interface PerfEmp { id: string; name: string; category?: WorkProfileCategory }
export interface PerfHours { employee: string; hours: number; date: number }
export interface PerfAtt { employee: string; punchIn: number; punchOut?: number }

/** One flagged day in an employee's drill-down (only days that fired a signal are kept). */
export interface FlaggedDay {
  date: number          // localMidnight (ms) of the day
  offDay: boolean       // non-working day with hoursLogged > 0
  overtimeHours: number // working day: max(0, hoursLogged - 8); 0 otherwise
  lateNight: boolean    // hoursLogged > 8 AND a session that day ran past 22:00
  hoursLogged: number   // summed logged hours that day
  punchIn?: number      // earliest punch-in of the day (if any session)
  punchOut?: number     // latest punch-out of the day (undefined if none closed / no session)
}

export interface PerfRow {
  employee: string; name: string; category: WorkProfileCategory
  offDayDays: number; offDayHours: number
  overtimeHours: number; overtimeDays: number
  lateNightDays: number; totalExtraHours: number
  days: FlaggedDay[] // flagged days only, newest first
}

const STD_HOURS = 8
// Late-night threshold, local time. 22:00 (10 PM): tracked devs finish by ~8:30 PM, so work past
// 9 PM is just minor overtime. Late-night ALSO requires > 8 production (logged) hours that day, so a
// normal 8h day that merely ends late does not count - only genuine heavy work that ran late does.
const LATE_NIGHT_HOUR = 22
const HOUR_MS = 3_600_000

interface DayAcc {
  hoursLogged: number
  punchIn?: number  // earliest in
  punchOut?: number // latest closed out
  latestEnd: number // max(punchOut ?? now) across the day's sessions; 0 if no session
}

export function performanceRows (emps: PerfEmp[], hours: PerfHours[], atts: PerfAtt[], now: number): PerfRow[] {
  const included = emps.filter((e) => isTracked(e.category))
  const ids = new Set(included.map((e) => e.id))

  // Per-employee, per-day accumulator merging logged hours with that day's attendance.
  const byEmp = new Map<string, Map<number, DayAcc>>()
  const acc = (emp: string, day: number): DayAcc => {
    let m = byEmp.get(emp)
    if (m === undefined) { m = new Map(); byEmp.set(emp, m) }
    let d = m.get(day)
    if (d === undefined) { d = { hoursLogged: 0, latestEnd: 0 }; m.set(day, d) }
    return d
  }

  for (const hh of hours) {
    if (!ids.has(hh.employee)) continue
    const d = acc(hh.employee, localMidnight(hh.date))
    d.hoursLogged = round2(d.hoursLogged + hh.hours)
  }

  for (const a of atts) {
    if (!ids.has(a.employee)) continue
    const day = localMidnight(a.punchIn)
    const d = acc(a.employee, day)
    d.punchIn = d.punchIn === undefined ? a.punchIn : Math.min(d.punchIn, a.punchIn)
    if (a.punchOut !== undefined) {
      d.punchOut = d.punchOut === undefined ? a.punchOut : Math.max(d.punchOut, a.punchOut)
    }
    const end = a.punchOut ?? now
    if (end > d.latestEnd) d.latestEnd = end
  }

  const rows = included.map((e): PerfRow => {
    const dayMap = byEmp.get(e.id) ?? new Map<number, DayAcc>()
    let offDayDays = 0; let offDayHours = 0; let overtimeHours = 0; let overtimeDays = 0
    const days: FlaggedDay[] = []

    for (const [day, d] of dayMap) {
      const working = isWorkingDay(day)
      const offDay = !working && d.hoursLogged > 0
      const ot = working && d.hoursLogged > STD_HOURS ? round2(d.hoursLogged - STD_HOURS) : 0
      const lateNight = d.hoursLogged > STD_HOURS && d.latestEnd > day + LATE_NIGHT_HOUR * HOUR_MS

      if (offDay) { offDayDays++; offDayHours = round2(offDayHours + d.hoursLogged) }
      if (ot > 0) { overtimeHours = round2(overtimeHours + ot); overtimeDays++ }

      if (offDay || ot > 0 || lateNight) {
        days.push({
          date: day,
          offDay,
          overtimeHours: ot,
          lateNight,
          hoursLogged: d.hoursLogged,
          punchIn: d.punchIn,
          punchOut: d.punchOut
        })
      }
    }

    days.sort((a, b) => b.date - a.date) // newest first
    return {
      employee: e.id, name: e.name, category: e.category as WorkProfileCategory,
      offDayDays, offDayHours, overtimeHours, overtimeDays,
      lateNightDays: days.filter((x) => x.lateNight).length,
      totalExtraHours: round2(offDayHours + overtimeHours),
      days
    }
  })
  return rows.sort((a, b) => b.totalExtraHours - a.totalExtraHours || a.name.localeCompare(b.name))
}

function round2 (n: number): number { return Math.round(n * 100) / 100 }
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test`
Expected: all suites PASS (203+ tests), `performance.test.ts` green, output pristine.

- [ ] **Step 5: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/utils/performance.ts \
        plugins/yg-timesheet-resources/src/__tests__/performance.test.ts
git commit -m "feat(performance): late-night requires >8h logged; per-day flagged breakdown"
```

---

## Task 2: Drill-down panel in Performance.svelte

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Performance.svelte`

**Interfaces:**
- Consumes: `PerfRow.days` / `FlaggedDay` from Task 1; existing `formatHours` from `../utils/week`.

- [ ] **Step 1: Add panel state + formatters to the script**

In `plugins/yg-timesheet-resources/src/components/Performance.svelte`, after the `$: rows = performanceRows(emps, hours, atts, now)` line, add:

```ts
  // Drill-down: the row whose flagged days are shown in the slide-in panel. Tracked by id so it
  // survives a rows recompute (date-range change) and auto-closes if the person drops out.
  let selectedId: string | undefined
  $: selected = selectedId !== undefined ? rows.find((r) => r.employee === selectedId) : undefined

  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  function fmtPunch (inMs: number | undefined, outMs: number | undefined): string {
    if (inMs === undefined) return ''
    return outMs === undefined ? `${timeFmt.format(inMs)} -> ...` : `${timeFmt.format(inMs)} -> ${timeFmt.format(outMs)}`
  }
```

- [ ] **Step 2: Make table rows clickable**

In the same file, change the row element in the `{#each rows as r (r.employee)}` loop from `<tr class="yg-row">` to:

```svelte
          <tr class="yg-row perf-clickable" class:is-sel={r.employee === selectedId} on:click={() => (selectedId = r.employee)}>
```

(Leave the row's `<td>` cells unchanged.)

- [ ] **Step 3: Add the slide-in panel markup**

In the same file, immediately AFTER the closing `</div>` of `<div class="yg-scroll">...</div>` and BEFORE the closing `</div>` of `.dash`, add:

```svelte
  {#if selected}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="perf-backdrop" on:click={() => (selectedId = undefined)} />
    <aside class="perf-panel">
      <div class="perf-panel__head">
        <span class="perf-panel__name">{selected.name}</span>
        <button class="perf-panel__close" aria-label="Close" on:click={() => (selectedId = undefined)}>x</button>
      </div>
      {#if selected.days.length === 0}
        <div class="perf-panel__empty">No off-day, overtime, or late-night days in this range.</div>
      {:else}
        <div class="perf-panel__list">
          {#each selected.days as d (d.date)}
            <div class="perf-day">
              <div class="perf-day__date">{dayFmt.format(d.date)}</div>
              <div class="perf-day__chips">
                {#if d.offDay}<span class="perf-chip perf-chip--off">Off-day</span>{/if}
                {#if d.overtimeHours > 0}<span class="perf-chip perf-chip--ot">OT +{formatHours(d.overtimeHours)}</span>{/if}
                {#if d.lateNight}<span class="perf-chip perf-chip--late">Late</span>{/if}
              </div>
              <div class="perf-day__meta">
                {#if d.hoursLogged > 0}<span class="perf-day__hrs">{formatHours(d.hoursLogged)}</span>{/if}
                {#if d.punchIn !== undefined}<span class="perf-day__punch">{fmtPunch(d.punchIn, d.punchOut)}</span>{/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </aside>
  {/if}
```

- [ ] **Step 4: Add the panel styles**

In the same file's `<style lang="scss">` block, after the existing `.perf-range__sep` rule, add:

```scss
  .perf-clickable { cursor: pointer; }
  .perf-clickable.is-sel { background: var(--yg-panel-soft); }

  .perf-backdrop {
    position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.18);
  }
  .perf-panel {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 41; width: 360px; max-width: 92vw;
    display: flex; flex-direction: column;
    background: var(--yg-panel); border-left: 1px solid var(--yg-border); box-shadow: var(--yg-shadow);
    overflow: hidden;
  }
  .perf-panel__head {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 16px; border-bottom: 1px solid var(--yg-border);
  }
  .perf-panel__name { font-weight: 660; font-size: 15px; color: var(--yg-text); flex: 1; }
  .perf-panel__close {
    border: 1px solid var(--yg-border); background: var(--yg-panel); color: var(--yg-text-dim);
    width: 26px; height: 26px; border-radius: 7px; cursor: pointer; line-height: 1;
  }
  .perf-panel__close:hover { color: var(--yg-text); }
  .perf-panel__empty { padding: 18px 16px; color: var(--yg-text-faint); font-size: 13px; }
  .perf-panel__list { overflow: auto; padding: 8px 0; }

  .perf-day { padding: 10px 16px; border-bottom: 1px solid var(--yg-border); }
  .perf-day__date { font-weight: 600; font-size: 13px; color: var(--yg-text); }
  .perf-day__chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 4px; }
  .perf-chip {
    font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
    border: 1px solid var(--yg-border); color: var(--yg-text-dim);
  }
  .perf-chip--off { background: var(--yg-amber-bg, transparent); }
  .perf-chip--ot { background: var(--yg-panel-soft); }
  .perf-chip--late { background: var(--yg-red-bg, transparent); color: var(--yg-text); }
  .perf-day__meta { display: flex; gap: 12px; font-size: 12px; color: var(--yg-text-dim); font-variant-numeric: tabular-nums; }
```

(If svelte-check flags an unknown SCSS var, fall back to `var(--yg-panel-soft)` for the chip backgrounds — the `--yg-amber-bg` / `--yg-red-bg` are used with a `transparent` fallback already, so an undefined var degrades gracefully.)

- [ ] **Step 5: Type-check tracker-resources' sibling — validate the component**

Run (this package's `rushx build` is a compile-only no-op; use svelte-check + `_phase:validate` for real signal):
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources
node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "Performance.svelte|performance.ts" || echo "no errors in changed files"
node ../../common/scripts/install-run-rushx.js _phase:validate 2>&1 | tail -5
```
Expected: no errors referencing `Performance.svelte`; `_phase:validate` exits clean. Pre-existing warnings in other files are fine — only new errors in the changed files count.

- [ ] **Step 6: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/components/Performance.svelte
git commit -m "feat(performance): slide-in drill-down panel of a person's flagged days"
```

---

## Task 3: Batched front build, seed tuning, deploy, smoke

**Files:** none (build/deploy + test-data tuning). **Do NOT start without the user's go-ahead** — this is the one build for the batch (also carries the already-committed 10 PM threshold change).

- [ ] **Step 1: Front-only build**

Run the front build (`rush build` -> `dev/prod` package -> `pods/front` bundle+package+docker build, tagged `yg-local/front:beta`), e.g. reuse the scratchpad `build-front.sh`. Expected: `docker images | grep yg-local/front` shows a fresh timestamp; the new bundle contains the panel (spot check: `docker run --rm yg-local/front:beta sh -c "grep -rl 'perf-panel' /app/dist | head -1"`).

- [ ] **Step 2: Tune the seed data to demonstrate all three late-night outcomes**

Under the new rule the existing K2 seed gives late-night = 1 (Tue Aug 4). Adjust the seed (migration repo, `notes/seed-perf-k2-cleanup.sql` tracks the ids) so K2 shows:
- a genuine late-night: >8h logged AND a session past 10 PM (Tue Aug 4 already qualifies: 11h + out 22:30),
- a past-10 PM-but-<=8h day that is excluded (add a small `HrTimeEntry`, e.g. 6h, on Sat Aug 1 whose session ends 23:45 -> not late),
- a >8h-but-before-10 PM day that is excluded (Mon Aug 3 already: 9.5h + out 21:15).

Record the exact expected panel + aggregate numbers for K2 before deploying so the smoke test can reconcile.

- [ ] **Step 3: Deploy the new front**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d front
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
```
Expected: `front` recreated on the new image; `curl -s -o /dev/null -w "%{http_code}" http://localhost:8087/` returns 200. No `upgrade-workspace` (client-only).

- [ ] **Step 4: Smoke test (manual, HR login)**

Open Performance as HR/owner:
1. K2's **Late-night** column matches the tuned seed (genuine late-night days only; the past-10 PM-but-<=8h and the >8h-but-before-10 PM days are NOT counted).
2. Click K2's row -> the panel slides in from the right listing the flagged days, newest first, each with the right chip(s), hours, and punch in -> out; the past-10 PM-but-<=8h day does NOT appear (not flagged); a multi-signal day (e.g. Tue Aug 4: `OT +3h` + `Late`) shows both chips once.
3. Click another person -> panel switches; close button / backdrop dismisses; changing the date range keeps the table and closes/refreshes the panel correctly.

Record the result of each check. If any fails, STOP and debug before claiming done.

---

## Self-Review

**Spec coverage** (`2026-08-05-performance-drilldown-latenight.md`):
- Late-night = past 10 PM AND >8h logged -> Task 1 `lateNight = d.hoursLogged > STD_HOURS && d.latestEnd > day + 22h`. ✓
- Per-day `FlaggedDay` breakdown attached to `PerfRow.days`, flagged-only, newest first -> Task 1. ✓
- Multi-signal day appears once with both flags; hours + punch merge; unflagged excluded -> Task 1 tests. ✓
- `lateNightDays` = count of late-night flagged days -> Task 1. ✓
- Slide-in panel, single person, compact rows (date, chips, hours, punch in->out), empty state, newest first -> Task 2. ✓
- No new queries / model change; front-only deploy -> Tasks 2-3. ✓
- Out of scope (issue-level detail, Excel, holiday calendar) -> not touched. ✓

**Placeholder scan:** no TBD/TODO; full code in every code step. ✓

**Type consistency:** `FlaggedDay` fields (`date/offDay/overtimeHours/lateNight/hoursLogged/punchIn?/punchOut?`) identical in the interface, the lib construction, the tests, and the Svelte template. `selectedId`/`selected` names consistent across Task 2 steps. `performanceRows` signature unchanged. ✓
