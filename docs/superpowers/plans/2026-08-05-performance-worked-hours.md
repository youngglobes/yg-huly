# Performance report: worked hours from punch sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute the report's worked hours from the sum of each punch session's duration (excludes break gaps), falling back to self-logged timesheet hours on days with no punch data.

**Architecture:** Extend the pure `performanceRows` lib's per-day accumulator with a session-duration sum; the per-day rollup derives `workedHours` (session-sum when the day has punch data, else the logged fallback) and every signal keys off it. Rename `FlaggedDay.hoursLogged` -> `workedHours`; the drill-down panel reads the renamed field. Client-only.

**Tech Stack:** TypeScript, Svelte 3, jest + ts-jest.

## Global Constraints

- **Repo / branch:** `youngglobes/yg-huly`, branch `yg_beta`. Client-only (front-only build; no `upgrade-workspace`). NEVER merge to `yg_develop`.
- **Worked hours rule:** if a day has ANY punch session, `workedHours = sum over sessions of (sessionEnd - punchIn)` in hours; else `workedHours = summed HrTimeEntry hours` for that day.
- **sessionEnd** = `punchOut` when closed; else (open) `now` only if the punch-in day is today (`localMidnight(punchIn) === localMidnight(now)`), otherwise `punchIn` (past open session contributes 0). The same `sessionEnd` feeds the late-night 22:00 check.
- **Signals (all use `workedHours`):** off-day = non-working day with `workedHours > 0`; overtime = working day `max(0, workedHours - 8)`, overtime day iff `> 8`; late-night = a session past 22:00 AND `workedHours > 8`. Thresholds (8h, 22:00) and the working-day calendar are unchanged.
- **No em-dashes** in code, comments, commits. No new i18n.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugins/yg-timesheet-resources/src/utils/performance.ts` | **Modify.** Session-sum worked hours + fallback; rename `FlaggedDay.hoursLogged` -> `workedHours`. |
| `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts` | **Modify.** Rewrite tests for the new source of truth. |
| `plugins/yg-timesheet-resources/src/components/Performance.svelte` | **Modify.** Panel reads `d.workedHours` (one line). |

---

## Task 1: Worked-hours from punch sessions (lib + panel)

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/performance.ts`
- Modify: `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts`
- Modify: `plugins/yg-timesheet-resources/src/components/Performance.svelte`

**Interfaces:**
- `FlaggedDay` field `hoursLogged` is renamed to `workedHours` (summed punch-session hours, or logged fallback). All other `FlaggedDay`/`PerfRow` fields unchanged.

- [ ] **Step 1: Rewrite the tests (RED)**

Replace the ENTIRE body of `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts` with:

```ts
import { performanceRows, type PerfEmp, type PerfHours, type PerfAtt } from '../utils/performance'

// Aug 2026: Aug 1 = Sat (1st, odd -> WORKING), Aug 2 = Sun (off), Aug 3 = Mon (working),
// Aug 4 = Tue (working, and = NOW's day), Aug 6 = Thu (working), Aug 8 = Sat (2nd, even -> OFF).
const D = (y: number, m: number, d: number, h = 10): number => new Date(y, m, d, h).getTime()
const MIN = 60_000
const NOW = D(2026, 7, 4, 12) // today = Aug 4
const emps: PerfEmp[] = [
  { id: 'e1', name: 'Alice A', category: 'junior-dev' },
  { id: 'e2', name: 'Bob B', category: 'senior-dev' },
  { id: 'sx', name: 'Sam Sales', category: 'sales' },   // excluded
  { id: 'ut', name: 'Un Tagged', category: undefined }  // excluded
]

describe('performanceRows', () => {
  it('includes only dev/senior-dev, excludes sales + untagged', () => {
    expect(performanceRows(emps, [], [], NOW).map((r) => r.employee)).toEqual(['e1', 'e2'])
  })

  // --- fallback: no punch data -> worked hours = self-logged timesheet hours ---
  it('off-day work (fallback): logged hours on non-working days when no punch data', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 5, date: D(2026, 7, 2) }, // Sun -> off-day
      { employee: 'e1', hours: 3, date: D(2026, 7, 8) }, // 2nd Sat -> off-day
      { employee: 'e1', hours: 6, date: D(2026, 7, 3) }  // Mon -> working, <=8, no OT
    ]
    const r = performanceRows(emps, hours, [], NOW).find((x) => x.employee === 'e1')!
    expect(r.offDayDays).toBe(2)
    expect(r.offDayHours).toBe(8)
    expect(r.overtimeHours).toBe(0)
    expect(r.totalExtraHours).toBe(8)
  })

  it('overtime (fallback): logged hours beyond 8 on working days when no punch data', () => {
    const hours: PerfHours[] = [
      { employee: 'e2', hours: 11, date: D(2026, 7, 3) }, // Mon -> 3h OT
      { employee: 'e2', hours: 9, date: D(2026, 7, 1) },  // odd Sat (working) -> 1h OT
      { employee: 'e2', hours: 12, date: D(2026, 7, 2) }  // Sun -> off-day (12h), NOT OT
    ]
    const r = performanceRows(emps, hours, [], NOW).find((x) => x.employee === 'e2')!
    expect(r.overtimeHours).toBe(4)
    expect(r.overtimeDays).toBe(2)
    expect(r.offDayDays).toBe(1)
    expect(r.offDayHours).toBe(12)
    expect(r.totalExtraHours).toBe(16)
  })

  // --- punch sessions are the source when present ---
  it('worked hours = summed punch sessions (break gaps excluded), not the span, and logged is ignored', () => {
    const hours: PerfHours[] = [{ employee: 'e2', hours: 20, date: D(2026, 7, 3) }] // ignored (day has punch)
    const atts: PerfAtt[] = [
      { employee: 'e2', punchIn: D(2026, 7, 3, 9), punchOut: D(2026, 7, 3, 13) },        // 4h
      { employee: 'e2', punchIn: D(2026, 7, 3, 14), punchOut: D(2026, 7, 3, 19) + 30 * MIN } // 5.5h (14:00-19:30)
    ]
    const r = performanceRows(emps, hours, atts, NOW).find((x) => x.employee === 'e2')!
    expect(r.overtimeHours).toBe(1.5)   // 9.5h worked - 8; NOT 2.5 (10.5h span) and NOT 12 (20h logged)
    expect(r.overtimeDays).toBe(1)
    expect(r.days[0].workedHours).toBe(9.5)
  })

  it('under-8h once break gaps are removed -> no overtime', () => {
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 9), punchOut: D(2026, 7, 3, 12) },  // 3h
      { employee: 'e1', punchIn: D(2026, 7, 3, 13), punchOut: D(2026, 7, 3, 18) }  // 5h  => 8h worked, span 9h
    ]
    const r = performanceRows(emps, [], atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.overtimeHours).toBe(0) // 8h worked is not > 8, even though the span is 9h
    expect(r.days).toHaveLength(0)
  })

  it('fallback per day: a day with no punch uses logged hours even if other days have punch', () => {
    const hours: PerfHours[] = [{ employee: 'e1', hours: 10, date: D(2026, 7, 3) }] // Mon, no punch -> fallback
    const atts: PerfAtt[] = [{ employee: 'e1', punchIn: D(2026, 7, 4, 9), punchOut: D(2026, 7, 4, 11) }] // Tue, 2h
    const r = performanceRows(emps, hours, atts, NOW).find((x) => x.employee === 'e1')!
    const mon = r.days.find((d) => d.date === D(2026, 7, 3, 0))!
    expect(mon.workedHours).toBe(10) // fallback
    expect(mon.overtimeHours).toBe(2)
  })

  it('open session: today counts to now; a past open session contributes 0', () => {
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 4, 0) + 30 * MIN }, // today (Aug 4) open, now=12:00 -> 11.5h
      { employee: 'e1', punchIn: D(2026, 7, 3, 9) }             // past (Aug 3) open -> 0h, not flagged
    ]
    const r = performanceRows(emps, [], atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.overtimeHours).toBe(3.5) // only Aug 4: 11.5h - 8
    expect(r.days.map((d) => d.date)).toEqual([D(2026, 7, 4, 0)]) // Aug 3 (past open, 0h) excluded
    expect(r.days[0].workedHours).toBe(11.5)
    expect(r.days[0].lateNight).toBe(false) // latestEnd = now (12:00) is not past 22:00
  })

  it('late-night = summed sessions > 8 AND a session past 22:00 (both gates)', () => {
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 13), punchOut: D(2026, 7, 3, 23) }, // 10h, out 23:00 -> LATE
      { employee: 'e1', punchIn: D(2026, 7, 6, 9), punchOut: D(2026, 7, 6, 21) },  // 12h, out 21:00 -> not late (time)
      { employee: 'e1', punchIn: D(2026, 7, 1, 20), punchOut: D(2026, 7, 1, 23) }  // 3h, out 23:00 -> not late (hours)
    ]
    const r = performanceRows(emps, [], atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.lateNightDays).toBe(1) // only Aug 3
  })

  it('days = flagged only, newest first, workedHours field, multi-signal once', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 6, date: D(2026, 7, 2) }, // Sun off, no punch -> fallback 6h off-day
      { employee: 'e1', hours: 5, date: D(2026, 7, 4) }  // Tue working, 5h, no punch -> not flagged
    ]
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 13), punchOut: D(2026, 7, 3, 23) } // Mon: 10h worked, out 23:00
    ]
    const r = performanceRows(emps, hours, atts, NOW).find((x) => x.employee === 'e1')!
    expect(r.days.map((d) => d.date)).toEqual([D(2026, 7, 3, 0), D(2026, 7, 2, 0)]) // newest first, Tue excluded
    const mon = r.days[0]
    expect(mon.offDay).toBe(false)
    expect(mon.overtimeHours).toBe(2)   // 10 - 8
    expect(mon.lateNight).toBe(true)
    expect(mon.workedHours).toBe(10)
    expect(mon.punchIn).toBe(D(2026, 7, 3, 13))
    expect(mon.punchOut).toBe(D(2026, 7, 3, 23))
    const sun = r.days[1]
    expect(sun.offDay).toBe(true)
    expect(sun.overtimeHours).toBe(0)
    expect(sun.lateNight).toBe(false)
    expect(sun.workedHours).toBe(6) // fallback
    expect(sun.punchIn).toBeUndefined()
    expect(sun.punchOut).toBeUndefined()
  })

  it('merges multiple sessions per day (earliest in / latest out) incl cross-midnight', () => {
    const atts: PerfAtt[] = [
      { employee: 'e1', punchIn: D(2026, 7, 3, 9), punchOut: D(2026, 7, 3, 13) },        // 4h
      { employee: 'e1', punchIn: D(2026, 7, 3, 20), punchOut: D(2026, 7, 4, 0) + 30 * MIN } // 4.5h, cross-midnight
    ]
    const r = performanceRows(emps, [], atts, NOW).find((x) => x.employee === 'e1')!
    const mon = r.days.find((d) => d.date === D(2026, 7, 3, 0))!
    expect(mon.workedHours).toBe(8.5)                             // 4 + 4.5, gap 13:00-20:00 excluded
    expect(mon.punchIn).toBe(D(2026, 7, 3, 9))                    // earliest in
    expect(mon.punchOut).toBe(D(2026, 7, 4, 0) + 30 * MIN)        // latest out (past midnight)
    expect(mon.overtimeHours).toBe(0.5)                          // 8.5 - 8
    expect(mon.lateNight).toBe(true)                            // 8.5 > 8 AND a session ended past 22:00
    expect(r.lateNightDays).toBe(1)
  })

  it('sorts by totalExtraHours desc then name', () => {
    const hours: PerfHours[] = [
      { employee: 'e1', hours: 10, date: D(2026, 7, 3) },
      { employee: 'e2', hours: 13, date: D(2026, 7, 3) }
    ]
    expect(performanceRows(emps, hours, [], NOW).map((r) => r.employee)).toEqual(['e2', 'e1'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test 2>&1 | grep -A3 performance.test`
Expected: FAIL — the current lib uses `hoursLogged` (session data doesn't override logged) and `FlaggedDay` has no `workedHours`.

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
  offDay: boolean       // non-working day with workedHours > 0
  overtimeHours: number // working day: max(0, workedHours - 8); 0 otherwise
  lateNight: boolean    // workedHours > 8 AND a session that day ran past 22:00
  workedHours: number   // summed punch-session hours that day, or logged-hours fallback
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
// 9 PM is minor overtime. Late-night ALSO requires > 8 worked hours that day.
const LATE_NIGHT_HOUR = 22
const HOUR_MS = 3_600_000

interface DayAcc {
  loggedHours: number // summed HrTimeEntry hours (fallback source when no punch)
  sessionMs: number   // summed punch-session durations (primary source when hasSession)
  hasSession: boolean
  punchIn?: number    // earliest in
  punchOut?: number   // latest closed out
  latestEnd: number   // max sessionEnd across the day's sessions; 0 if no session
}

export function performanceRows (emps: PerfEmp[], hours: PerfHours[], atts: PerfAtt[], now: number): PerfRow[] {
  const included = emps.filter((e) => isTracked(e.category))
  const ids = new Set(included.map((e) => e.id))
  const todayMid = localMidnight(now)

  // Per-employee, per-day accumulator merging logged hours with that day's punch sessions.
  const byEmp = new Map<string, Map<number, DayAcc>>()
  const acc = (emp: string, day: number): DayAcc => {
    let m = byEmp.get(emp)
    if (m === undefined) { m = new Map(); byEmp.set(emp, m) }
    let d = m.get(day)
    if (d === undefined) { d = { loggedHours: 0, sessionMs: 0, hasSession: false, latestEnd: 0 }; m.set(day, d) }
    return d
  }

  for (const hh of hours) {
    if (!ids.has(hh.employee)) continue
    const d = acc(hh.employee, localMidnight(hh.date))
    d.loggedHours = round2(d.loggedHours + hh.hours)
  }

  for (const a of atts) {
    if (!ids.has(a.employee)) continue
    const day = localMidnight(a.punchIn)
    const d = acc(a.employee, day)
    d.hasSession = true
    d.punchIn = d.punchIn === undefined ? a.punchIn : Math.min(d.punchIn, a.punchIn)
    if (a.punchOut !== undefined) {
      d.punchOut = d.punchOut === undefined ? a.punchOut : Math.max(d.punchOut, a.punchOut)
    }
    // Open session: count to `now` only when punched in today; a past open session (forgotten
    // punch-out) ends at punchIn (0 duration) rather than a runaway now - punchIn.
    const end = a.punchOut ?? (day === todayMid ? now : a.punchIn)
    d.sessionMs += Math.max(0, end - a.punchIn)
    if (end > d.latestEnd) d.latestEnd = end
  }

  const rows = included.map((e): PerfRow => {
    const dayMap = byEmp.get(e.id) ?? new Map<number, DayAcc>()
    let offDayDays = 0; let offDayHours = 0; let overtimeHours = 0; let overtimeDays = 0
    const days: FlaggedDay[] = []

    for (const [day, d] of dayMap) {
      // Worked hours = summed punch sessions when the day has punch data (excludes break gaps),
      // else the self-logged timesheet hours (fallback for pre-attendance history).
      const workedHours = d.hasSession ? round2(d.sessionMs / HOUR_MS) : d.loggedHours
      const working = isWorkingDay(day)
      const offDay = !working && workedHours > 0
      const ot = working && workedHours > STD_HOURS ? round2(workedHours - STD_HOURS) : 0
      const lateNight = workedHours > STD_HOURS && d.latestEnd > day + LATE_NIGHT_HOUR * HOUR_MS

      if (offDay) { offDayDays++; offDayHours = round2(offDayHours + workedHours) }
      if (ot > 0) { overtimeHours = round2(overtimeHours + ot); overtimeDays++ }

      if (offDay || ot > 0 || lateNight) {
        days.push({
          date: day,
          offDay,
          overtimeHours: ot,
          lateNight,
          workedHours,
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test`
Expected: all suites PASS, output pristine.

- [ ] **Step 5: Update the drill-down panel field**

In `plugins/yg-timesheet-resources/src/components/Performance.svelte` (~line 188), change the panel's hours cell from `d.hoursLogged` to `d.workedHours`:

```svelte
                {#if d.workedHours > 0}<span class="perf-day__hrs">{formatHours(d.workedHours)}</span>{/if}
```

- [ ] **Step 6: Type-check the package**

Run:
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources
node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "Performance.svelte|performance.ts" || echo "no errors in changed files"
```
Expected: no errors on the changed files (the `hoursLogged` -> `workedHours` rename is fully propagated; a leftover reference would surface here).

- [ ] **Step 7: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/utils/performance.ts \
        plugins/yg-timesheet-resources/src/__tests__/performance.test.ts \
        plugins/yg-timesheet-resources/src/components/Performance.svelte
git commit -m "feat(performance): worked hours from summed punch sessions (timesheet fallback)"
```

---

## Task 2: Seed tune, batched build, deploy, smoke

**Files:** none (test-data + build/deploy). **Do NOT start without the user's go-ahead.**

- [ ] **Step 1: Re-tune K2's seed to show a multi-session day**

In the migration repo (`notes/seed-perf-k2-cleanup.sql` tracks the seed ids), replace K2's single Mon 08-03 attendance session (13:00-21:15) with TWO sessions that sum to under the span, e.g. 13:00-17:00 (4h) + 17:30-21:15 (3.75h) = 7.75h worked (span 8h15m). Under the new rule Mon 08-03 then reads 7.75h worked -> NO overtime (was 1.5h), demonstrating break exclusion. Recompute and record K2's expected row before deploying: Tue 08-04 still has its single session (13:00-22:30 = 9.5h worked -> 1.5h OT + late-night); off-days (Sat 07-25, Sun 08-02) fall back to logged hours (no punch) unchanged. Note the new totals.

- [ ] **Step 2: Front-only build**

Run the front build (`yg-local/front:beta`), e.g. the scratchpad `build-front.sh`. Spot-check the bundle carries the change (`docker run --rm yg-local/front:beta sh -c "grep -o 'workedHours' /app/dist/*.js | head -1"`).

- [ ] **Step 3: Deploy**

```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d front
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
```
Expected: `front` recreated; `curl -s -o /dev/null -w "%{http_code}" http://localhost:8087/` = 200.

- [ ] **Step 4: Smoke test (manual, HR login, hard-refresh browser)**

1. K2's Overtime now reflects **session sums, not punch spans**: the multi-session Mon 08-03 shows no overtime (7.75h worked); Tue 08-04 still shows 1.5h OT (single 9.5h session).
2. Open K2's drill-down: the hours per flagged day equal the session sums (punch days) or logged hours (fallback days, blank punch); the Mon multi-session day is absent (7.75h, not flagged).
3. A pre-August day (no punch) still shows its logged-hours-based off-day/overtime (fallback intact).

Record each result. If any fails, STOP and debug before claiming done.

---

## Self-Review

**Spec coverage** (`2026-08-05-performance-worked-hours.md`):
- workedHours = session-sum when punch present, else logged fallback -> Task 1 Step 3 (`d.hasSession ? sessionMs/HOUR_MS : loggedHours`). ✓
- sessionEnd open-session rule (today -> now, past -> punchIn) feeding both sessionMs and latestEnd -> Task 1 Step 3. ✓
- All signals use workedHours; thresholds unchanged -> Task 1 Step 3. ✓
- `FlaggedDay.hoursLogged` -> `workedHours`, panel updated -> Task 1 Steps 3, 5. ✓
- Fallback keeps history; precedence (punch wins) -> tested in Task 1 Step 1. ✓
- Seed multi-session demonstration -> Task 2 Step 1. ✓

**Placeholder scan:** no TBD/TODO; full code in every code step. ✓

**Type consistency:** `FlaggedDay.workedHours` is the only renamed field; it is written in `performance.ts`, asserted in every relevant test, and read in `Performance.svelte:188` — no `hoursLogged` reference remains. `performanceRows` signature unchanged. ✓
