# Attendance calendar + mandatory mode + notification fix + "Late night" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only holiday calendar on My Attendance; Office/WFH mandatory on every punch-in; reminder notification stops auto-punching; rename the performance chip "Late" -> "Late night".

**Architecture:** All client-only, component-level. New read-only `HolidayCalendarView.svelte` reused on Attendance; `MyAttendance.svelte` relayout + mode gating; `AttendanceReminder.svelte` opens the app instead of writing; a one-word label change in `Performance.svelte`.

**Tech Stack:** Svelte 3, Huly `@hcengineering/{ui,yg-timesheet,presentation}`.

## Global Constraints

- **Repo / branch:** `youngglobes/yg-huly`, branch `yg_beta`. Client-only -> front-only build; no `upgrade-workspace`. NEVER merge to `yg_develop`.
- **No model change** (the `Holiday` doc already exists). No em-dashes in code/comments/commits/UI copy.
- **Mode is required per punch-in:** no sticky default; punch-in blocked until Office or WFH is chosen; re-chosen each time.
- **Notification never auto-punches IN** (opens My Attendance); punch-OUT auto-close stays.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugins/yg-timesheet-resources/src/components/HolidayCalendarView.svelte` | **Create.** Read-only month calendar (holidays + today). |
| `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte` | **Modify.** Mandatory mode; right-column relayout (calendar + glance). |
| `plugins/yg-timesheet-resources/src/components/AttendanceReminder.svelte` | **Modify.** No auto punch-in; open app instead. |
| `plugins/yg-timesheet-resources/src/utils/attendance.ts` (+ its test) | **Modify.** Remove `nextMode` if it becomes unused. |
| `plugins/yg-timesheet-resources/src/components/Performance.svelte` | **Modify.** Chip "Late" -> "Late night". |

---

## Task 1: Mandatory Office/WFH on every punch-in

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte`

**Interfaces:** none exported.

- [ ] **Step 1: Start with no mode selected; remove the sticky seed**

In `MyAttendance.svelte`, replace the mode declaration + seed block (currently):
```ts
  // The Office/WFH selection for the NEXT punch-in. Seeded from today's most recent session's
  // mode (else office), sticky within the day. Re-seed only when the day rolls over or a punch
  // closes - not on every tick - so a manual toggle is not clobbered each second.
  let mode: AttendanceMode = 'office'
  let modeSeedKey = ''
  $: {
    const seed = `${todayMid}:${todays.length}:${punchedIn}`
    if (seed !== modeSeedKey) {
      modeSeedKey = seed
      if (!punchedIn) mode = nextMode(todays)
    }
  }
```
with:
```ts
  // Office/WFH must be chosen explicitly for EVERY punch-in (no sticky default). Starts unset; the
  // Punch In button is disabled until one is picked, and it resets after each punch-out.
  let mode: AttendanceMode | undefined = undefined
```

- [ ] **Step 2: Guard the punch-in handler**

In the `punchIn` function, change:
```ts
  async function punchIn (): Promise<void> {
    if (punchedIn || busy) return
    busy = true
    pending = 'in'
    try {
      await createPunchIn(client, me, mode, note)
```
to (capture the mode into a narrowed local so it is defined at the call):
```ts
  async function punchIn (): Promise<void> {
    if (punchedIn || busy) return
    const m = mode
    if (m === undefined) return // must pick Office or WFH first
    busy = true
    pending = 'in'
    try {
      await createPunchIn(client, me, m, note)
```

- [ ] **Step 3: Reset mode after punch-out**

Change the punch-out release reactive from:
```ts
  $: if (busy && pending === 'out' && openSession === undefined) { busy = false; pending = null }
```
to:
```ts
  $: if (busy && pending === 'out' && openSession === undefined) { busy = false; pending = null; mode = undefined }
```

- [ ] **Step 4: Disable Punch In until a mode is picked**

The Office/WFH toggle (lines with `class:is-on={mode === 'office'}` / `'wfh'`) needs NO change - `mode === undefined` leaves both un-highlighted. Change the punch-IN button's `disabled`:
```svelte
          <button class="att-cta att-cta--in" on:click={punchIn} disabled={busy}>
```
to:
```svelte
          <button class="att-cta att-cta--in" on:click={punchIn} disabled={busy || mode === undefined}>
```

- [ ] **Step 5: Type-check**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "MyAttendance.svelte" || echo "no MyAttendance errors"`
Expected: no errors. (If it flags a stale yg-timesheet `.d.ts`, first run `cd ../yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:validate`, then re-check.)

- [ ] **Step 6: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/components/MyAttendance.svelte
git commit -m "feat(attendance): require Office/WFH choice on every punch-in (no sticky default)"
```

---

## Task 2: Notification/banner stops auto-punching IN

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/AttendanceReminder.svelte`
- Modify: `plugins/yg-timesheet-resources/src/utils/attendance.ts` and its test (only if `nextMode` becomes unused)

**Interfaces:** none exported.

- [ ] **Step 1: Open the app instead of auto-punching IN**

In `AttendanceReminder.svelte`, replace `doPunch`:
```ts
  async function doPunch (): Promise<void> {
    const todayMid = localMidnight(Date.now())
    const todays = mySessions.filter((s) => s.date === todayMid)
    if (punchedIn && openSession !== undefined) await closePunchOut(client, openSession._id)
    else if (!punchedIn) await createPunchIn(client, me, nextMode(todays))
    bannerKind = 'none'
    goToMyAttendance()
  }
```
with (punch-OUT still auto-closes; punch-IN just opens My Attendance so the employee picks Office/WFH):
```ts
  async function doPunch (): Promise<void> {
    // Punch-out has no mode -> keep the one-tap close. Punch-in must NOT auto-punch (it would skip the
    // mandatory Office/WFH choice), so just open My Attendance and let them pick the mode + punch there.
    if (punchedIn && openSession !== undefined) await closePunchOut(client, openSession._id)
    bannerKind = 'none'
    goToMyAttendance()
  }
```

- [ ] **Step 2: Drop now-unused imports; remove `nextMode` if orphaned**

In `AttendanceReminder.svelte`, remove `nextMode` (and `localMidnight` if no longer used - check) from its import from `../utils/attendance`. Then check whether `nextMode` has any remaining caller:

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly && grep -rn "nextMode" plugins/yg-timesheet-resources/src`
- If the ONLY matches are its definition in `utils/attendance.ts` and its test: delete `export function nextMode` from `utils/attendance.ts` and its test case(s) in the attendance test file (`__tests__/*attendance*`).
- If any other caller remains: leave `nextMode` in place; just remove the two edited call sites' usage.

(Verify `localMidnight` is still used in `AttendanceReminder.svelte` before removing it - it may be used elsewhere in the file; keep the import if so.)

- [ ] **Step 3: Type-check + tests**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources
node ../../common/scripts/install-run-rushx.js test 2>&1 | tail -4
node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "AttendanceReminder.svelte|attendance.ts" || echo "no errors in changed files"
```
Expected: tests pass (if `nextMode`'s test was removed, the suite count drops by that test and stays green); no new errors on the changed files.

- [ ] **Step 4: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/components/AttendanceReminder.svelte plugins/yg-timesheet-resources/src/utils/attendance.ts
git add plugins/yg-timesheet-resources/src/__tests__/ 2>/dev/null
git commit -m "feat(attendance): reminder opens My Attendance instead of auto punching-in"
```

---

## Task 3: Read-only holiday calendar + Attendance relayout

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/HolidayCalendarView.svelte`
- Modify: `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte`

**Interfaces:**
- Consumes: `ygTimesheet.class.Holiday` (read-only). Produces: `HolidayCalendarView` (a self-contained read-only calendar component).

- [ ] **Step 1: Create the read-only calendar component**

Create `plugins/yg-timesheet-resources/src/components/HolidayCalendarView.svelte`:

```svelte
<script lang="ts">
  //
  // Read-only month calendar of org holidays (marked + named) with today highlighted. Employees view it
  // on My Attendance; HR manages holidays via HrHolidays.svelte. Reuses the MonthCalendar + midOf idiom.
  //
  import { MonthCalendar } from '@hcengineering/ui'
  import { createQuery } from '@hcengineering/presentation'
  import ygTimesheet, { type Holiday } from '@hcengineering/yg-timesheet'

  const query = createQuery()
  let holidays: Holiday[] = []
  query.query(ygTimesheet.class.Holiday, {}, (res) => { holidays = res })

  $: byDay = new Map<number, Holiday>(holidays.map((h) => [h.date, h]))
  const midOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

  let current = new Date()
  function shiftMonth (delta: number): void {
    current = new Date(current.getFullYear(), current.getMonth() + delta, 1)
  }
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
</script>

<div class="holcal">
  <div class="holcal__bar">
    <button class="holcal__nav" on:click={() => shiftMonth(-1)} aria-label="Previous month">{'<'}</button>
    <span class="holcal__month">{monthFmt.format(current)}</span>
    <button class="holcal__nav" on:click={() => shiftMonth(1)} aria-label="Next month">{'>'}</button>
  </div>
  <MonthCalendar currentDate={current} selectedDate={current}>
    <svelte:fragment slot="cell" let:date let:today let:wrongMonth>
      {@const h = byDay.get(midOf(date))}
      <div class="holcal__cell" class:today class:wrong={wrongMonth} class:is-hol={h !== undefined}>
        <span class="holcal__num">{date.getDate()}</span>
        {#if h !== undefined}<span class="holcal__name">{h.name}</span>{/if}
      </div>
    </svelte:fragment>
  </MonthCalendar>
</div>

<style lang="scss">
  .holcal { border: 1px solid var(--theme-divider-color); border-radius: 12px; overflow: hidden; background: var(--theme-comp-header-color); }
  .holcal__bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--theme-divider-color); }
  .holcal__month { font-weight: 620; color: var(--theme-caption-color); }
  .holcal__nav { border: 1px solid var(--theme-divider-color); background: var(--theme-button-default); color: var(--theme-content-color); width: 26px; height: 26px; border-radius: 7px; cursor: pointer; line-height: 1; }
  .holcal__nav:hover { color: var(--theme-caption-color); }
  .holcal__cell { position: relative; width: 100%; height: 100%; min-height: 40px; display: flex; flex-direction: column; align-items: flex-start; padding: 3px 5px; }
  .holcal__cell.wrong { color: var(--theme-trans-color); }
  .holcal__cell.today .holcal__num { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; border-radius: 999px; background: var(--primary-color-skyblue); color: #fff; font-weight: 700; }
  .holcal__cell.is-hol { background: var(--theme-won-color, var(--theme-button-default)); }
  .holcal__num { font-size: 12px; }
  .holcal__name { font-size: 9px; font-weight: 600; color: var(--theme-caption-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
</style>
```

- [ ] **Step 2: Relayout the Attendance hero right column**

In `MyAttendance.svelte`, add the import near the other component imports:
```ts
  import HolidayCalendarView from './HolidayCalendarView.svelte'
```
Wrap the existing `.att-glance` panel so the right column stacks the calendar on top and the glance below. Replace the opening of the glance panel:
```svelte
      <div class="att-panel att-glance">
```
with:
```svelte
      <div class="att-right">
        <HolidayCalendarView />
        <div class="att-panel att-glance">
```
and add the matching closing `</div>` after the glance panel's existing closing `</div>` (i.e. the `.att-glance` div gets one extra wrapper `</div>` after it, closing `.att-right`).

- [ ] **Step 3: Add the right-column style**

In `MyAttendance.svelte`'s `<style>`, add:
```scss
  .att-right { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
```
(The `.att-hero` grid's second column now holds `.att-right`; on the existing `@media (max-width: 900px)` single-column collapse it simply stacks, no change needed.)

- [ ] **Step 4: Type-check**

Run:
```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources
node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "HolidayCalendarView.svelte|MyAttendance.svelte" || echo "no errors in changed files"
```
Expected: no errors on the new/changed files.

- [ ] **Step 5: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/components/HolidayCalendarView.svelte plugins/yg-timesheet-resources/src/components/MyAttendance.svelte
git commit -m "feat(attendance): read-only holiday calendar on My Attendance (right column)"
```

---

## Task 4: Rename "Late" -> "Late night" in the performance chip

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Performance.svelte`

- [ ] **Step 1: Change the chip text**

In `Performance.svelte`, change the drill-down late-night chip:
```svelte
                {#if d.lateNight}<span class="perf-chip perf-chip--late">Late</span>{/if}
```
to:
```svelte
                {#if d.lateNight}<span class="perf-chip perf-chip--late">Late night</span>{/if}
```

- [ ] **Step 2: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/components/Performance.svelte
git commit -m "feat(performance): drill-down chip reads 'Late night' not 'Late'"
```

---

## Task 5: Front build, deploy, smoke (gated)

**Files:** none. **Do NOT start without the user's go-ahead.** Front-only.

- [ ] **Step 1: Front-only build** (`yg-local/front:beta`), e.g. the scratchpad `build-front.sh`. Spot-check: `docker run --rm yg-local/front:beta sh -c "grep -rlo 'holcal' /app/dist | head -1"`.
- [ ] **Step 2: Deploy.**
```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d front
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
```
Expected: front recreated; `curl -s -o /dev/null -w "%{http_code}" http://localhost:8087/` = 200.
- [ ] **Step 3: Smoke (manual, hard-refresh).**
  1. My Attendance: right column shows the **holiday calendar** (today ringed, any HR-marked holiday highlighted with its name) on top, "Today at a glance" below; punch panel on the left.
  2. Punch In is **disabled** until Office or WFH is picked; after a full punch-in/out cycle, the next punch-in again requires picking a mode.
  3. The reminder banner / notification "Punch in" **opens My Attendance without punching**; punch-out from the banner still closes the session.
  4. Performance drill-down chip reads **"Late night"**.

Record each result; STOP and debug on any failure.

---

## Self-Review

**Spec coverage** (`2026-08-06-attendance-calendar-mandatory-mode.md`):
- Read-only holiday calendar on Attendance + relayout (calendar top, glance below, punch left) -> Task 3. ✓
- Mandatory Office/WFH each punch-in (unset default, disabled button, guard, reset after out, seed removed) -> Task 1. ✓
- Notification no auto punch-in (opens app); punch-out auto-close kept; banner shares it -> Task 2. ✓
- `nextMode` cleanup if orphaned -> Task 2. ✓
- "Late" -> "Late night" -> Task 4. ✓
- Front-only deploy -> Task 5. ✓

**Placeholder scan:** no TBD/TODO; full code in every code step. ✓

**Type consistency:** `mode: AttendanceMode | undefined` is narrowed to `AttendanceMode` via the `const m` local before `createPunchIn(client, me, m, note)` (which requires `AttendanceMode`). `HolidayCalendarView` reads only `Holiday.date`/`.name`. No signatures changed. ✓
