# Holidays calendar (HR portal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let HR mark org-wide holidays (name + date) on a month calendar; a holiday becomes a non-working day, so work on it shows as off-day effort in the Performance report.

**Architecture:** New lightweight `Holiday` doc (world-readable, HR-only via a new HR-app "Holidays" special using Huly's `MonthCalendar`). The pure `isWorkingDay` gains an optional holidays set; the Performance report loads holidays and threads them in. All working-day math stays in the unit-tested libs.

**Tech Stack:** Huly platform (model + plugins), Svelte 3, jest + ts-jest.

## Global Constraints

- **Repo / branch:** `youngglobes/yg-huly`, branch `yg_beta`. NEVER merge to `yg_develop`.
- **MODEL CHANGE** (new doc class + new HR special) -> deploy is the full 4-image build + `upgrade-workspace yg`, NOT a front-only build.
- **Holiday model:** `Holiday extends Doc { date: Timestamp (local midnight); name: string }`, domain `DOMAIN_YG_TIMESHEET`, space `core.space.Workspace` (world-readable). One entry per day; org-wide; no ranges/type/recurring/department. Write is HR-only via the UI (no server guard — attendance precedent).
- **Access:** the "Holidays" special is `AccountRole.DocGuest` (visible to HR-app users), `position: 'top'`.
- **Holidays keyed by local midnight** everywhere: `new Date(y, m, d).getTime()`.
- **i18n:** add strings to BOTH `plugins/yg-timesheet-assets/lang/en.json` and `ru.json` (ru may mirror English — the repo convention). **No em-dashes** in code/comments/commit/UI copy.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugins/yg-timesheet-resources/src/utils/week.ts` | **Modify.** `isWorkingDay`/`lastWorkingDay` gain an optional holidays set. |
| `plugins/yg-timesheet-resources/src/utils/performance.ts` | **Modify.** `performanceRows` gains an optional holidays set, threaded to `isWorkingDay`. |
| `plugins/yg-timesheet-resources/src/__tests__/week.test.ts` | **Modify.** Holiday cases for `isWorkingDay`. |
| `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts` | **Modify.** Holiday makes a working day off-day. |
| `plugins/yg-timesheet/src/index.ts` | **Modify.** `Holiday` interface + class/component/string ids. |
| `models/yg-timesheet/src/index.ts` | **Modify.** `THoliday` model + createModel + "Holidays" special. |
| `plugins/yg-timesheet-assets/lang/en.json` + `ru.json` | **Modify.** Holiday strings. |
| `plugins/yg-timesheet-resources/src/index.ts` | **Modify.** Register the `HrHolidays` component. |
| `plugins/yg-timesheet-resources/src/components/HrHolidays.svelte` | **Create.** Month-calendar holiday manager. |
| `plugins/yg-timesheet-resources/src/components/HolidayEditPopup.svelte` | **Create.** Small add/remove popup for a clicked day. |
| `plugins/yg-timesheet-resources/src/components/Performance.svelte` | **Modify.** Load holidays; pass to `performanceRows`. |

---

## Task 1: Holidays in the pure libs (TDD)

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/week.ts`
- Modify: `plugins/yg-timesheet-resources/src/utils/performance.ts`
- Modify: `plugins/yg-timesheet-resources/src/__tests__/week.test.ts`
- Modify: `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts`

**Interfaces:**
- Produces: `isWorkingDay(dateMs: number, holidays?: ReadonlySet<number>): boolean` and `lastWorkingDay(nowMs: number, holidays?: ReadonlySet<number>): number` (holidays keyed by local midnight). `performanceRows(emps, hours, atts, now, holidays?: ReadonlySet<number>)`. All args optional -> existing callers unaffected. Consumed by Task 3.

- [ ] **Step 1: Add failing tests**

In `plugins/yg-timesheet-resources/src/__tests__/week.test.ts`, add inside the `describe('isWorkingDay', ...)` block (the `D` helper exists there):

```ts
  it('treats a holiday as a non-working day (keyed by local midnight)', () => {
    const mon = D(2026, 7, 3)                      // Mon = normally working
    const holidays = new Set<number>([new Date(2026, 7, 3).getTime()]) // Aug 3 local midnight
    expect(isWorkingDay(mon)).toBe(true)           // no set -> unchanged
    expect(isWorkingDay(mon, holidays)).toBe(false) // holiday -> off
    expect(isWorkingDay(D(2026, 7, 3, 15), holidays)).toBe(false) // any time that day matches
    expect(isWorkingDay(D(2026, 7, 4), holidays)).toBe(true)  // a different day is unaffected
  })
```

In `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts`, add a test (uses the file's existing `D`/`NOW`/`emps`):

```ts
  it('a holiday makes a working day count as off-day effort (not overtime)', () => {
    const hours: PerfHours[] = [{ employee: 'e2', hours: 10, date: D(2026, 7, 3) }] // Mon, 10h logged
    const holidays = new Set<number>([new Date(2026, 7, 3).getTime()])              // Aug 3 is a holiday
    const r = performanceRows(emps, hours, [], NOW, holidays).find((x) => x.employee === 'e2')!
    expect(r.offDayDays).toBe(1)        // holiday -> non-working -> off-day
    expect(r.offDayHours).toBe(10)
    expect(r.overtimeHours).toBe(0)     // not overtime (it is not a working day)
    expect(r.days[0].offDay).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test 2>&1 | grep -A2 -E "week.test|performance.test"`
Expected: FAIL (`isWorkingDay`/`performanceRows` do not yet accept a holidays arg).

- [ ] **Step 3: Add the holidays arg in `week.ts`**

In `plugins/yg-timesheet-resources/src/utils/week.ts`, replace `isWorkingDay` and `lastWorkingDay` with:

```ts
export function isWorkingDay (dateMs: number, holidays?: ReadonlySet<number>): boolean {
  if (holidays !== undefined) {
    const d = new Date(dateMs)
    const mid = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    if (holidays.has(mid)) return false // HR-marked holiday: non-working
  }
  const dow = new Date(dateMs).getDay() // 0 Sun .. 6 Sat
  if (dow === 0) return false // Sunday off
  if (dow === 6) return isOddSaturday(dateMs) // Saturday: only odd ones
  return true // Mon-Fri
}

// The most recent completed working day STRICTLY before today (today excluded). Walks back day by day.
export function lastWorkingDay (nowMs: number, holidays?: ReadonlySet<number>): number {
  const t = new Date(nowMs)
  const midnight = new Date(t.getFullYear(), t.getMonth(), t.getDate())
  for (let i = 1; i <= 14; i++) {
    const d = new Date(midnight)
    d.setDate(midnight.getDate() - i)
    if (isWorkingDay(d.getTime(), holidays)) return d.getTime()
  }
  return midnight.getTime()
}
```

- [ ] **Step 4: Thread holidays through `performance.ts`**

In `plugins/yg-timesheet-resources/src/utils/performance.ts`, change the `performanceRows` signature and the single `isWorkingDay` call:

- Signature: `export function performanceRows (emps: PerfEmp[], hours: PerfHours[], atts: PerfAtt[], now: number, holidays?: ReadonlySet<number>): PerfRow[] {`
- The line `const working = isWorkingDay(day)` becomes `const working = isWorkingDay(day, holidays)`.

(No other change; `day` is already a local-midnight value.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node ../../common/scripts/install-run-rushx.js test`
Expected: all PASS (existing week/performance tests still green — the arg is optional).

- [ ] **Step 6: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/utils/week.ts plugins/yg-timesheet-resources/src/utils/performance.ts \
        plugins/yg-timesheet-resources/src/__tests__/week.test.ts plugins/yg-timesheet-resources/src/__tests__/performance.test.ts
git commit -m "feat(holidays): isWorkingDay + performanceRows accept an optional holidays set"
```

---

## Task 2: Holiday doc model + HR special + calendar UI

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts`
- Modify: `models/yg-timesheet/src/index.ts`
- Modify: `plugins/yg-timesheet-assets/lang/en.json`, `plugins/yg-timesheet-assets/lang/ru.json`
- Modify: `plugins/yg-timesheet-resources/src/index.ts`
- Create: `plugins/yg-timesheet-resources/src/components/HrHolidays.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/HolidayEditPopup.svelte`

**Interfaces:**
- Produces: `ygTimesheet.class.Holiday` (doc `{date, name}`), `ygTimesheet.component.HrHolidays`, and the "Holidays" HR special. Consumed by Task 3 (Performance loads `Holiday` docs).

- [ ] **Step 1: Plugin ids + interface**

In `plugins/yg-timesheet/src/index.ts`:
- Add the interface near `AttendanceSession` (after its block, ~line 120):
```ts
/** An org-wide holiday (one per day). Non-working everywhere via isWorkingDay. */
export interface Holiday extends Doc {
  date: Timestamp // local midnight (ms) of the holiday day
  name: string    // e.g. "Diwali"
}
```
- In the `class:` block, after `AttendanceReminderSettings: ...`:
```ts
    Holiday: '' as Ref<Class<Holiday>>,
```
- In the `component:` block, after `Performance: '' as AnyComponent`:
```ts
    ,HrHolidays: '' as AnyComponent
```
  (or add `HrHolidays: '' as AnyComponent` as a new line with correct comma placement).
- In the `string:` block, after `Performance: '' as IntlString`, add:
```ts
    Holidays: '' as IntlString,
    AddHoliday: '' as IntlString,
    HolidayName: '' as IntlString,
    RemoveHoliday: '' as IntlString,
```

- [ ] **Step 2: Model — doc class + createModel + special**

In `models/yg-timesheet/src/index.ts`:
- Add the model class after `TAttendanceReminderSettings` (before `createModel`):
```ts
@Model(ygTimesheet.class.Holiday, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class THoliday extends TDoc implements Holiday {
  @Prop(TypeDate(), core.string.Object) date!: Timestamp
  @Prop(TypeString(), core.string.Object) name!: string
}
```
- Add `Holiday` to the `Holiday` type import at the top (the `import ... { type AttendanceSession, ... }` from `@hcengineering/yg-timesheet`): add `type Holiday,`.
- In `builder.createModel(...)`, append `THoliday` to the argument list.
- In the HR `specials` array, add (top position, before `roster`):
```ts
          {
            id: 'holidays',
            label: ygTimesheet.string.Holidays,
            icon: ygTimesheet.icon.Timesheet,
            component: ygTimesheet.component.HrHolidays,
            accessLevel: AccountRole.DocGuest,
            position: 'top'
          },
```

- [ ] **Step 3: Strings (en + ru)**

In `plugins/yg-timesheet-assets/lang/en.json`, add (near the `Performance` string):
```json
    "Holidays": "Holidays",
    "AddHoliday": "Add holiday",
    "HolidayName": "Holiday name",
    "RemoveHoliday": "Remove",
```
Add the SAME four keys to `plugins/yg-timesheet-assets/lang/ru.json` (English values are the accepted fallback convention in this repo).

- [ ] **Step 4: The add/remove popup**

Create `plugins/yg-timesheet-resources/src/components/HolidayEditPopup.svelte`:

```svelte
<script lang="ts">
  //
  // Small popup for a clicked calendar day: add a holiday (name it) or remove the existing one.
  //
  import { getClient } from '@hcengineering/presentation'
  import { EditBox, Button, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import core, { type Ref } from '@hcengineering/core'
  import ygTimesheet, { type Holiday } from '@hcengineering/yg-timesheet'

  export let date: number            // local midnight ms of the clicked day
  export let existing: Holiday | undefined = undefined

  const client = getClient()
  const dispatch = createEventDispatcher()
  let name = existing?.name ?? ''

  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date)

  async function add (): Promise<void> {
    const trimmed = name.trim()
    if (trimmed === '') return
    await client.createDoc(ygTimesheet.class.Holiday, core.space.Workspace, { date, name: trimmed })
    dispatch('close')
  }
  async function remove (): Promise<void> {
    if (existing !== undefined) await client.remove(existing)
    dispatch('close')
  }
</script>

<div class="antiPopup" style="padding:12px;min-width:16rem;display:flex;flex-direction:column;gap:10px">
  <div style="font-weight:600">{dateLabel}</div>
  {#if existing === undefined}
    <EditBox bind:value={name} placeholder={ygTimesheet.string.HolidayName} focusIndex={1} autoFocus />
    <Button kind="primary" label={ygTimesheet.string.AddHoliday} on:click={add} />
  {:else}
    <div>{existing.name}</div>
    <Button kind="dangerous" label={ygTimesheet.string.RemoveHoliday} on:click={remove} />
  {/if}
</div>
```

- [ ] **Step 5: The Holidays page**

Create `plugins/yg-timesheet-resources/src/components/HrHolidays.svelte`:

```svelte
<script lang="ts">
  //
  // HR "Holidays" special: a month calendar to mark org-wide holidays (one per day) + a list of the
  // year's holidays. Writes ygTimesheet.class.Holiday in core.space.Workspace (world-readable). Feeds
  // isWorkingDay everywhere (a holiday is a non-working day).
  //
  import { Label, MonthCalendar, showPopup, eventToHTMLElement } from '@hcengineering/ui'
  import { createQuery } from '@hcengineering/presentation'
  import ygTimesheet, { type Holiday } from '@hcengineering/yg-timesheet'
  import HolidayEditPopup from './HolidayEditPopup.svelte'

  const query = createQuery()
  let holidays: Holiday[] = []
  query.query(ygTimesheet.class.Holiday, {}, (res) => { holidays = res })

  // date (local midnight ms) -> Holiday, for O(1) calendar lookups.
  $: byDay = new Map<number, Holiday>(holidays.map((h) => [h.date, h]))
  const midOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

  let current = new Date() // month shown
  function shiftMonth (delta: number): void {
    current = new Date(current.getFullYear(), current.getMonth() + delta, 1)
  }

  function onDay (d: Date, ev: MouseEvent): void {
    const mid = midOf(d)
    showPopup(HolidayEditPopup, { date: mid, existing: byDay.get(mid) }, eventToHTMLElement(ev))
  }

  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
  const listFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  $: sorted = [...holidays].sort((a, b) => a.date - b.date)
</script>

<div class="dash yg-page">
  <div class="yg-head">
    <h1 class="yg-title"><Label label={ygTimesheet.string.Holidays} /></h1>
  </div>
  <div class="hol-body">
    <div class="hol-cal">
      <div class="hol-monthbar">
        <button class="yg-btn yg-btn--ghost" on:click={() => shiftMonth(-1)}>{'<'}</button>
        <span class="hol-month">{monthFmt.format(current)}</span>
        <button class="yg-btn yg-btn--ghost" on:click={() => shiftMonth(1)}>{'>'}</button>
      </div>
      <MonthCalendar currentDate={current} selectedDate={current} on:change={() => {}}>
        <svelte:fragment slot="cell" let:date let:today let:wrongMonth>
          {@const h = byDay.get(midOf(date))}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="hol-cell" class:today class:wrong={wrongMonth} class:is-hol={h !== undefined} on:click={(ev) => onDay(date, ev)}>
            <span class="hol-num">{date.getDate()}</span>
            {#if h !== undefined}<span class="hol-name">{h.name}</span>{/if}
          </div>
        </svelte:fragment>
      </MonthCalendar>
    </div>
    <div class="hol-list">
      <div class="hol-list__head"><Label label={ygTimesheet.string.Holidays} /></div>
      {#each sorted as h (h._id)}
        <div class="hol-item">
          <span class="hol-item__date">{listFmt.format(h.date)}</span>
          <span class="hol-item__name">{h.name}</span>
        </div>
      {:else}
        <div class="hol-empty">No holidays yet. Click a day to add one.</div>
      {/each}
    </div>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;
  .dash { flex: 1; min-width: 0; }
  .hol-body { display: flex; gap: 16px; padding: 1rem; align-items: flex-start; flex-wrap: wrap; }
  .hol-cal { flex: 1; min-width: 320px; max-width: 640px; border: 1px solid var(--yg-border); border-radius: var(--yg-radius); overflow: hidden; background: var(--yg-panel); }
  .hol-monthbar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--yg-border); }
  .hol-month { font-weight: 640; }
  .hol-cell { position: relative; width: 100%; height: 100%; min-height: 56px; display: flex; flex-direction: column; align-items: flex-start; padding: 4px 6px; cursor: pointer; }
  .hol-cell.wrong { color: var(--yg-text-faint); }
  .hol-cell.today .hol-num { font-weight: 800; color: var(--yg-ink); }
  .hol-cell.is-hol { background: var(--yg-red-bg, var(--yg-panel-soft)); }
  .hol-num { font-size: 12px; }
  .hol-name { font-size: 10px; font-weight: 600; color: var(--yg-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .hol-list { flex: 0 0 260px; }
  .hol-list__head { font-weight: 640; margin-bottom: 8px; }
  .hol-item { display: flex; justify-content: space-between; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--yg-border); font-size: 13px; }
  .hol-item__name { font-weight: 600; }
  .hol-empty { color: var(--yg-text-faint); font-size: 13px; padding: 8px 4px; }
</style>
```

- [ ] **Step 6: Register the component**

In `plugins/yg-timesheet-resources/src/index.ts`: add `import HrHolidays from './components/HrHolidays.svelte'` alongside the other component imports, and add `HrHolidays` to the exported `component` map (next to `Performance`).

- [ ] **Step 7: Type-check model + resources**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build 2>&1 | tail -3
cd /home/karthi_0008/dev/client-projects/yg-huly/models/yg-timesheet && node ../../common/scripts/install-run-rushx.js _phase:build 2>&1 | tail -3
cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "HrHolidays.svelte|HolidayEditPopup.svelte" || echo "no errors in new components"
```
Expected: model packages build clean; no errors on the new components. (If `EditBox`/`MonthCalendar`/`eventToHTMLElement` are not exported from `@hcengineering/ui`, adjust the import — they are standard `@hcengineering/ui` exports; confirm via `grep "export .* EditBox\|MonthCalendar\|eventToHTMLElement" packages/ui/src/index.ts`.)

- [ ] **Step 8: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet/src/index.ts models/yg-timesheet/src/index.ts \
        plugins/yg-timesheet-assets/lang/en.json plugins/yg-timesheet-assets/lang/ru.json \
        plugins/yg-timesheet-resources/src/index.ts \
        plugins/yg-timesheet-resources/src/components/HrHolidays.svelte \
        plugins/yg-timesheet-resources/src/components/HolidayEditPopup.svelte
git commit -m "feat(holidays): Holiday doc + HR Holidays special (month-calendar manager)"
```

---

## Task 3: Performance report applies holidays

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/Performance.svelte`

**Interfaces:**
- Consumes: `ygTimesheet.class.Holiday` (Task 2), `performanceRows(..., holidays)` (Task 1).

- [ ] **Step 1: Load holidays + pass to performanceRows**

In `plugins/yg-timesheet-resources/src/components/Performance.svelte`:
- Add a query near the other `createQuery()` blocks:
```ts
  const holQuery = createQuery()
  let holidayDates: number[] = []
  holQuery.query(ygTimesheet.class.Holiday, {}, (res) => { holidayDates = res.map((h) => h.date) })
  $: holidays = new Set<number>(holidayDates)
```
(`ygTimesheet` and `createQuery` are already imported in this file.)
- Change the rows line from `$: rows = performanceRows(emps, hours, atts, now)` to:
```ts
  $: rows = performanceRows(emps, hours, atts, now, holidays)
```

- [ ] **Step 2: Type-check**

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly/plugins/yg-timesheet-resources && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "Performance.svelte" || echo "no Performance.svelte errors"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/karthi_0008/dev/client-projects/yg-huly
git add plugins/yg-timesheet-resources/src/components/Performance.svelte
git commit -m "feat(holidays): Performance report treats holidays as off-day"
```

---

## Task 4: Build, deploy, smoke (model change — gated)

**Files:** none. **Do NOT start without the user's go-ahead.** MODEL change -> full 4-image build.

- [ ] **Step 1: Full 4-image build** (`yg-local/*:beta`), e.g. the scratchpad `build-beta.sh`. Spot-check the model bundle has the class: `grep -o "yg-timesheet:class:Holiday" pods/server/bundle/model.json`.
- [ ] **Step 2: Deploy + upgrade.**
```bash
cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d --force-recreate front workspace transactor
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
./run-tool-beta.sh upgrade-workspace yg
```
Expected: services healthy; `upgrade-workspace yg` completes; front 200. (Ensure redpanda is up first; WS-probe per ops rules.)
- [ ] **Step 3: Smoke (manual, HR login).**
  1. HR app shows the new **Holidays** special; a non-HR user does not.
  2. Click a day -> name it -> it highlights + appears in the year list; click it -> Remove -> gone.
  3. Mark a normal working day (e.g. a Monday) as a holiday; in the **Performance** report, an employee with hours/punch on that day now shows it as **off-day** (not overtime).
  4. Remove the holiday -> the report reverts.

Record each result; STOP and debug on any failure.

---

## Self-Review

**Spec coverage** (`2026-08-05-holidays-calendar-design.md`):
- `Holiday {date, name}`, world-readable, one-per-day, org-wide -> Task 2. ✓
- HR-only "Holidays" special (DocGuest), MonthCalendar add/remove -> Task 2. ✓
- `isWorkingDay(day, holidays?)` optional + backward compatible; performance report adopts -> Tasks 1, 3. ✓
- Holiday -> non-working -> off-day effort -> Tasks 1, 3 (+ test). ✓
- `lastWorkingDay` made holiday-ready, consumers not wired (out of scope) -> Task 1. ✓
- No ranges/type/recurring/department; no server guard -> not built. ✓
- Model change deploy -> Task 4. ✓

**Placeholder scan:** no TBD/TODO; full code in every code step. ✓

**Type consistency:** `Holiday { date: number; name: string }` identical across the plugin interface, the model `@Prop`s, the popup/page components, and the Performance query. `isWorkingDay`/`performanceRows` holidays arg is `ReadonlySet<number>` everywhere and passed by callers as `Set<number>` (assignable). `ygTimesheet.component.HrHolidays` id matches the registered `HrHolidays` component and the special. ✓
