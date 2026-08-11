# Late Punch-In Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a punch-in later than the employee's shift start, capture a required reason, let HR approve or reject it, and surface late/excused status to the employee and an un-excused "Late arrivals" count to HR.

**Architecture:** A new `LatePermission` doc (one per late day, world-readable like `AttendanceSession`) records the late punch with snapshots + a reason + a status. The My Attendance punch flow detects late (exact `shiftStart`, no grace) and blocks the punch behind a required-reason popup. An HR-only "Late Permissions" view approves/rejects; a server trigger reverts unauthorized status writes. Pure helpers (detection, per-day status, un-excused count) are unit-tested in isolation.

**Tech Stack:** Huly platform (TypeScript, Svelte), yg-timesheet plugin, jest, CockroachDB via the Huly model layer.

## Global Constraints

- **No em-dashes** anywhere (code, comments, commits, UI copy). Use hyphens or commas.
- **No semicolons** in TypeScript; 2-space indent; follow existing file style.
- **`shiftStart`** is minutes since local midnight (540 = 09:00), a `WorkProfile` mixin field on Employee, optional.
- **`LatePermission` docs** live in `core.space.Workspace` (world-readable), matching `AttendanceSession`.
- **Late = exact**: first punch of the day with local time-of-day strictly greater than `shiftStart`. Unset `shiftStart` = exempt. Second+ punches never trigger.
- **HR only** approves. "HR admin" server/client signal is `AccountRole.Maintainer` (matches the existing `isHRAdmin` in `Approvals.svelte:36`).
- **Status enum**: `'Pending' | 'Approved' | 'Rejected'`. Approved = excused; Pending/Rejected = un-excused.
- **This touches the model + a server trigger**, so deployment is a FULL build + `upgrade-workspace` (not front-only). See the final section.

## File Structure

- `plugins/yg-timesheet/src/index.ts` - add `LatePermission` interface, `LatePermissionStatus` type, class ref, strings, icon ref, component ref.
- `models/yg-timesheet/src/index.ts` - add `TLatePermission` `@Model`, register in `createModel`, add the "Late Permissions" HR menu special.
- `plugins/yg-timesheet-assets/lang/en.json`, `.../ru.json` - new strings.
- `plugins/yg-timesheet-resources/src/utils/late.ts` (new) - pure helpers: `isLate`, `minutesLateOf`, `dayLateStatus`, `countUnexcusedLate`, `localTimeOfDayMin`.
- `plugins/yg-timesheet-resources/src/__tests__/late.test.ts` (new) - unit tests for the above.
- `plugins/yg-timesheet-resources/src/utils/attendance-write.ts` - add `createLatePermission`, `approveLatePermission`, `rejectLatePermission`.
- `plugins/yg-timesheet-resources/src/components/LateReasonPopup.svelte` (new) - required-reason dialog at punch-in.
- `plugins/yg-timesheet-resources/src/components/RejectLatePopup.svelte` (new) - HR reject-reason dialog.
- `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte` - late detection + reason prompt in `punchIn()`; per-day status in history.
- `plugins/yg-timesheet-resources/src/components/HrLatePermissions.svelte` (new) - HR review list.
- `plugins/yg-timesheet-resources/src/utils/performance.ts` - add `lateArrivals` to `PerfRow`, compute in `performanceRows`.
- `plugins/yg-timesheet-resources/src/components/Performance.svelte` - "Late arrivals" column.
- `plugins/yg-timesheet-resources/src/utils/performance-xlsx.ts` - "Late arrivals" xlsx cells.
- `plugins/yg-timesheet/src/index.ts` (plugin descriptor) + `server-plugins/yg-timesheet/src/index.ts` - `OnLatePermissionUpdate` trigger resource ref.
- `server-plugins/yg-timesheet-resources/src/index.ts` - `OnLatePermissionUpdate` implementation + default-export entry.
- `models/server-yg-timesheet/src/index.ts` - register the trigger.
- `plugins/yg-timesheet-resources/src/__tests__/*` and component registration in `plugins/yg-timesheet-resources/src/index.ts`.

Register components in `plugins/yg-timesheet-resources/src/index.ts` (the resources bundle) the same way existing components are registered.

---

### Task 1: Model - `LatePermission` class, strings, refs

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts`
- Modify: `models/yg-timesheet/src/index.ts:150-193`
- Modify: `plugins/yg-timesheet-assets/lang/en.json`, `plugins/yg-timesheet-assets/lang/ru.json`

**Interfaces:**
- Produces: `LatePermission` interface, `LatePermissionStatus` type, `ygTimesheet.class.LatePermission`, `ygTimesheet.component.HrLatePermissions`, and strings `LatePermissions`, `LateArrivals`, `LateStatusLate`, `LateStatusExcused`, `LateStatusPending`, `LateReasonLabel`, `LateReasonPlaceholder`, `ApproveLate`, `RejectLate`, `MinutesLate`, `NoLatePermissions`, `LatePermissionsIntro`.

- [ ] **Step 1: Add the interface + status type + class ref (plugin index)**

In `plugins/yg-timesheet/src/index.ts`, next to the `Holiday` interface (near line 163), add:

```ts
export type LatePermissionStatus = 'Pending' | 'Approved' | 'Rejected'

/** One per late day: a punch-in after the employee's shiftStart, with a reason HR approves/rejects. */
export interface LatePermission extends Doc {
  employee: Ref<Employee>
  date: Timestamp            // local midnight of the late day (same key as AttendanceSession.date)
  punchIn: Timestamp         // full ms of the triggering first punch-in
  shiftStartSnapshot: number // minutes since midnight, snapshot at creation
  minutesLate: number        // snapshot: punch-in time-of-day minus shiftStartSnapshot
  reason: string
  status: LatePermissionStatus
  approvedBy?: Ref<Employee>
  approvedOn?: Timestamp
  rejectReason?: string
}
```

In the `class:` block (near line 191 where `Holiday` is), add:

```ts
    LatePermission: '' as Ref<Class<LatePermission>>
```

In the `component:` block (near line 228 `HrHolidays`), add:

```ts
    HrLatePermissions: '' as AnyComponent
```

In the `string:` block (near line 407 where the Holiday strings are), add:

```ts
    LatePermissions: '' as IntlString,
    LateArrivals: '' as IntlString,
    LateStatusLate: '' as IntlString,
    LateStatusExcused: '' as IntlString,
    LateStatusPending: '' as IntlString,
    LateReasonLabel: '' as IntlString,
    LateReasonPlaceholder: '' as IntlString,
    ApproveLate: '' as IntlString,
    RejectLate: '' as IntlString,
    MinutesLate: '' as IntlString,
    NoLatePermissions: '' as IntlString,
    LatePermissionsIntro: '' as IntlString
```

- [ ] **Step 2: Add the model class (model index)**

In `models/yg-timesheet/src/index.ts`, after `THoliday` (line 190), add:

```ts
@Model(ygTimesheet.class.LatePermission, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TLatePermission extends TDoc implements LatePermission {
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) employee!: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) date!: Timestamp
  @Prop(TypeDate(), core.string.Object) punchIn!: Timestamp
  @Prop(TypeNumber(), core.string.Object) shiftStartSnapshot!: number
  @Prop(TypeNumber(), core.string.Object) minutesLate!: number
  @Prop(TypeString(), core.string.Object) reason!: string
  @Prop(TypeString(), core.string.Object) status!: LatePermissionStatus
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) approvedBy?: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) approvedOn?: Timestamp
  @Prop(TypeString(), core.string.Object) rejectReason?: string
}
```

Add the import of `type LatePermission, type LatePermissionStatus` to the existing `@hcengineering/yg-timesheet` import block (near line 35 where `type Holiday` is imported).

Register in `createModel` (line 193) by appending `TLatePermission` to the `builder.createModel(...)` argument list.

- [ ] **Step 3: Add translations**

In `plugins/yg-timesheet-assets/lang/en.json`, next to the Holiday strings, add:

```json
    "LatePermissions": "Late permissions",
    "LateArrivals": "Late arrivals",
    "LateStatusLate": "Late",
    "LateStatusExcused": "Excused",
    "LateStatusPending": "Pending",
    "LateReasonLabel": "You are punching in late",
    "LateReasonPlaceholder": "Reason for arriving late (required)",
    "ApproveLate": "Approve",
    "RejectLate": "Reject",
    "MinutesLate": "min late",
    "NoLatePermissions": "No late permissions in this view.",
    "LatePermissionsIntro": "Late punch-ins awaiting HR review."
```

Add the matching keys to `ru.json` (reuse the English value if no translation is available; the model requires the key to exist).

- [ ] **Step 4: Verify it compiles**

Run: `cd plugins/yg-timesheet-resources && npx --no-install jest --passWithNoTests` (sanity that the workspace resolves), then confirm the two edited packages typecheck as part of the full build later. There is no unit test for a model class.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet/src/index.ts models/yg-timesheet/src/index.ts plugins/yg-timesheet-assets/lang/en.json plugins/yg-timesheet-assets/lang/ru.json
git commit -m "feat(yg-timesheet): LatePermission model + strings (late punch-in #9)"
```

---

### Task 2: Pure helpers - detection, per-day status, un-excused count

**Files:**
- Create: `plugins/yg-timesheet-resources/src/utils/late.ts`
- Test: `plugins/yg-timesheet-resources/src/__tests__/late.test.ts`

**Interfaces:**
- Consumes: `LatePermissionStatus` from `@hcengineering/yg-timesheet`.
- Produces:
  - `localTimeOfDayMin(ms: number): number`
  - `isLate(punchInMs: number, shiftStartMin: number): boolean`
  - `minutesLateOf(punchInMs: number, shiftStartMin: number): number`
  - `type LateDayStatus = 'none' | 'pending' | 'late' | 'excused'`
  - `dayLateStatus(status: LatePermissionStatus | undefined): LateDayStatus`
  - `countUnexcusedLate(statuses: LatePermissionStatus[]): number`

- [ ] **Step 1: Write the failing test**

Create `plugins/yg-timesheet-resources/src/__tests__/late.test.ts`:

```ts
import { isLate, minutesLateOf, dayLateStatus, countUnexcusedLate, localTimeOfDayMin } from '../utils/late'

// 2026-08-11 09:30 local == 570 minutes of day. Build via Date so the test is tz-agnostic.
const at = (h: number, m: number): number => new Date(2026, 7, 11, h, m, 0, 0).getTime()

describe('localTimeOfDayMin', () => {
  it('returns minutes since local midnight', () => {
    expect(localTimeOfDayMin(at(9, 0))).toBe(540)
    expect(localTimeOfDayMin(at(9, 30))).toBe(570)
    expect(localTimeOfDayMin(at(0, 0))).toBe(0)
  })
})

describe('isLate', () => {
  it('is late strictly after shiftStart, not at or before', () => {
    expect(isLate(at(9, 1), 540)).toBe(true)
    expect(isLate(at(9, 0), 540)).toBe(false) // exactly on time is not late
    expect(isLate(at(8, 59), 540)).toBe(false)
  })
})

describe('minutesLateOf', () => {
  it('is the positive delta, 0 when on time or early', () => {
    expect(minutesLateOf(at(9, 45), 540)).toBe(45)
    expect(minutesLateOf(at(9, 0), 540)).toBe(0)
    expect(minutesLateOf(at(8, 30), 540)).toBe(0)
  })
})

describe('dayLateStatus', () => {
  it('maps permission status to a per-day label', () => {
    expect(dayLateStatus(undefined)).toBe('none')
    expect(dayLateStatus('Pending')).toBe('pending')
    expect(dayLateStatus('Rejected')).toBe('late')
    expect(dayLateStatus('Approved')).toBe('excused')
  })
})

describe('countUnexcusedLate', () => {
  it('counts Pending and Rejected, excludes Approved', () => {
    expect(countUnexcusedLate(['Pending', 'Approved', 'Rejected', 'Approved'])).toBe(2)
    expect(countUnexcusedLate([])).toBe(0)
    expect(countUnexcusedLate(['Approved'])).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/yg-timesheet-resources && npx --no-install jest late.test -c jest.config.js`
Expected: FAIL, cannot find module `../utils/late`.

- [ ] **Step 3: Write the implementation**

Create `plugins/yg-timesheet-resources/src/utils/late.ts`:

```ts
//
// YoungGlobes: pure late-arrival rules. No platform deps, so trivially unit-testable - same idiom
// as approval-drift.ts / performance.ts. "Late" = punch-in local time-of-day strictly after the
// employee's shiftStart (minutes since midnight). Snapshots are taken at record time so a later
// shiftStart edit never rewrites history.
//
import type { LatePermissionStatus } from '@hcengineering/yg-timesheet'

/** Minutes elapsed since local midnight for the instant `ms`. */
export function localTimeOfDayMin (ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/** Strictly-after: on-time (equal) is NOT late. */
export function isLate (punchInMs: number, shiftStartMin: number): boolean {
  return localTimeOfDayMin(punchInMs) > shiftStartMin
}

/** Positive minutes late, 0 when on time or early. */
export function minutesLateOf (punchInMs: number, shiftStartMin: number): number {
  return Math.max(0, localTimeOfDayMin(punchInMs) - shiftStartMin)
}

export type LateDayStatus = 'none' | 'pending' | 'late' | 'excused'

/** Per-day display status derived from the day's LatePermission (if any). */
export function dayLateStatus (status: LatePermissionStatus | undefined): LateDayStatus {
  if (status === undefined) return 'none'
  if (status === 'Approved') return 'excused'
  if (status === 'Pending') return 'pending'
  return 'late' // Rejected
}

/** Late days that count against the employee: everything not Approved. */
export function countUnexcusedLate (statuses: LatePermissionStatus[]): number {
  return statuses.filter((s) => s !== 'Approved').length
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugins/yg-timesheet-resources && npx --no-install jest late.test -c jest.config.js`
Expected: PASS (5 suites).

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/late.ts plugins/yg-timesheet-resources/src/__tests__/late.test.ts
git commit -m "feat(yg-timesheet): pure late-arrival helpers + tests"
```

---

### Task 3: Write helpers - create/approve/reject `LatePermission`

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/attendance-write.ts`

**Interfaces:**
- Consumes: `minutesLateOf` (Task 2), `localMidnight` (existing in `./attendance`), `LatePermission` class (Task 1).
- Produces:
  - `createLatePermission(client: TxOperations, employee: Ref<Employee>, punchInMs: number, shiftStartMin: number, reason: string): Promise<void>`
  - `approveLatePermission(client: TxOperations, id: Ref<LatePermission>): Promise<void>`
  - `rejectLatePermission(client: TxOperations, id: Ref<LatePermission>, reason: string): Promise<void>`

- [ ] **Step 1: Add the three writers**

Append to `plugins/yg-timesheet-resources/src/utils/attendance-write.ts` (add `type LatePermission` to the existing `@hcengineering/yg-timesheet` import, and import `getCurrentEmployee` from `@hcengineering/contact`, `minutesLateOf` from `./late`):

```ts
export async function createLatePermission (
  client: TxOperations, employee: Ref<Employee>, punchInMs: number, shiftStartMin: number, reason: string
): Promise<void> {
  const date = localMidnight(punchInMs)
  // Idempotency: at most one per (employee, day). First-of-day is also enforced by the caller, but
  // guard here too so a retry cannot create a duplicate.
  const existing = await client.findAll(
    ygTimesheet.class.LatePermission, { employee, date }, { limit: 1 }
  )
  if (existing.length > 0) return
  await client.createDoc(ygTimesheet.class.LatePermission, core.space.Workspace, {
    employee,
    date,
    punchIn: punchInMs,
    shiftStartSnapshot: shiftStartMin,
    minutesLate: minutesLateOf(punchInMs, shiftStartMin),
    reason: reason.trim(),
    status: 'Pending'
  })
}

export async function approveLatePermission (
  client: TxOperations, id: Ref<LatePermission>
): Promise<void> {
  await client.updateDoc(ygTimesheet.class.LatePermission, core.space.Workspace, id, {
    status: 'Approved',
    approvedBy: getCurrentEmployee(),
    approvedOn: Date.now(),
    $unset: { rejectReason: '' }
  })
}

export async function rejectLatePermission (
  client: TxOperations, id: Ref<LatePermission>, reason: string
): Promise<void> {
  await client.updateDoc(ygTimesheet.class.LatePermission, core.space.Workspace, id, {
    status: 'Rejected',
    rejectReason: reason.trim(),
    $unset: { approvedBy: '', approvedOn: '' }
  })
}
```

- [ ] **Step 2: Verify it compiles (typecheck via the resources package build)**

Run: `cd plugins/yg-timesheet-resources && npx --no-install jest late.test -c jest.config.js`
Expected: still PASS (this confirms the package still resolves; the writers are exercised end-to-end in manual testing since they need a live client).

- [ ] **Step 3: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/attendance-write.ts
git commit -m "feat(yg-timesheet): create/approve/reject LatePermission writers"
```

---

### Task 4: Late detection + required-reason popup at punch-in

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/LateReasonPopup.svelte`
- Modify: `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte:123-138`

**Interfaces:**
- Consumes: `isLate` (Task 2), `createPunchIn` + `createLatePermission` (Task 3), `localMidnight` (existing).
- Produces: a late-aware `punchIn()` that blocks on a required reason.

- [ ] **Step 1: Build the required-reason popup**

Create `LateReasonPopup.svelte` modeled on `RejectTaskPopup.svelte` (required textarea, `valid = reason.trim().length > 0`, dispatches `close` with `{ reason }` or `undefined`):

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Label } from '@hcengineering/ui'
  import ui from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  export let minutesLate: number

  const dispatch = createEventDispatcher()
  let reason = ''
  $: valid = reason.trim().length > 0
</script>

<div class="dialog">
  <div class="dialog__head"><Label label={ygTimesheet.string.LateReasonLabel} /> ({minutesLate} <Label label={ygTimesheet.string.MinutesLate} />)</div>
  <textarea class="dialog__area" rows="3" bind:value={reason} placeholder="" aria-label="late reason" />
  <div class="dialog__foot">
    <button class="yg-btn yg-btn--ghost" on:click={() => dispatch('close', undefined)}>
      <Label label={ui.string.Cancel} />
    </button>
    <button class="yg-btn" disabled={!valid} on:click={() => dispatch('close', { reason: reason.trim() })}>
      <Label label={ygTimesheet.string.PunchIn} />
    </button>
  </div>
</div>
```

(Use the placeholder from `ygTimesheet.string.LateReasonPlaceholder` if you prefer a `<Label>`-driven placeholder; match the styling classes already used by `RejectTaskPopup.svelte`.)

- [ ] **Step 2: Add late detection to `punchIn()`**

In `MyAttendance.svelte`, add imports: `showPopup` from `@hcengineering/ui`, `LateReasonPopup`, `isLate` + `minutesLateOf` from `../utils/late`, `createLatePermission` from `../utils/attendance-write`, `localMidnight` from `../utils/attendance` (if not already imported). Add a reactive read of the current employee's `shiftStart`:

```svelte
  // Current employee's shift start (minutes since midnight), or undefined = exempt from late flow.
  let shiftStart: number | undefined = undefined
  const profQuery = createQuery()
  $: profQuery.query(ygTimesheet.mixin.WorkProfile, { _id: me }, (res) => { shiftStart = res[0]?.shiftStart })
```

Replace `punchIn()` (lines 123-138) with:

```svelte
  async function punchIn (): Promise<void> {
    if (punchedIn || busy) return
    const m = mode
    if (m === undefined) return // must pick Office or WFH first
    const at = Date.now()

    // Late check only on the FIRST punch of the day, and only when a shiftStart is set.
    let lateReason: string | undefined
    if (shiftStart !== undefined && isLate(at, shiftStart)) {
      const priorToday = await client.findAll(
        ygTimesheet.class.AttendanceSession, { employee: me, date: localMidnight(at) }, { limit: 1 }
      )
      if (priorToday.length === 0) {
        const res = await new Promise<{ reason: string } | undefined>((resolve) => {
          showPopup(LateReasonPopup, { minutesLate: minutesLateOf(at, shiftStart as number) }, undefined, resolve)
        })
        if (res === undefined) return // cancelled: do not punch
        lateReason = res.reason
      }
    }

    busy = true
    pending = 'in'
    try {
      await createPunchIn(client, me, m, note)
      if (lateReason !== undefined) {
        await createLatePermission(client, me, at, shiftStart as number, lateReason)
      }
      note = ''
    } catch (err) {
      console.error('punch in failed', err)
      busy = false
      pending = null
    }
  }
```

Note: the late `at` snapshot is taken before the popup so the recorded `punchIn`/`minutesLate` match what the employee was shown. `createPunchIn` still stamps its own `at`; the small difference (popup dwell time) is acceptable and the LatePermission is the source of truth for lateness.

- [ ] **Step 3: Register the components**

In `plugins/yg-timesheet-resources/src/index.ts`, register `LateReasonPopup` and (Task 5) `HrLatePermissions` following how the other components in that file are registered.

- [ ] **Step 4: Manual verification (after deploy)**

Deferred to the Deployment section: set a shiftStart in Team Profiles, punch in after it, confirm the reason is required and a `Pending` LatePermission row appears; punch on-time and confirm no prompt.

- [ ] **Step 5: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/LateReasonPopup.svelte plugins/yg-timesheet-resources/src/components/MyAttendance.svelte plugins/yg-timesheet-resources/src/index.ts
git commit -m "feat(yg-timesheet): require a reason on a late punch-in"
```

---

### Task 5: HR "Late Permissions" review view + menu

**Files:**
- Create: `plugins/yg-timesheet-resources/src/components/HrLatePermissions.svelte`
- Create: `plugins/yg-timesheet-resources/src/components/RejectLatePopup.svelte`
- Modify: `models/yg-timesheet/src/index.ts:345` (HR menu specials)
- Modify: `plugins/yg-timesheet-resources/src/index.ts` (register `HrLatePermissions`)

**Interfaces:**
- Consumes: `approveLatePermission` + `rejectLatePermission` (Task 3), the HR-admin gate `hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)` (from `Approvals.svelte:36`).
- Produces: `ygTimesheet.component.HrLatePermissions` wired as an HR menu special.

- [ ] **Step 1: Reject-reason popup**

Create `RejectLatePopup.svelte` as a near-copy of `RejectTaskPopup.svelte` (required textarea, dispatches `{ reason }`), labelled with `ygTimesheet.string.RejectLate`.

- [ ] **Step 2: HR list component**

Create `HrLatePermissions.svelte`. Query `ygTimesheet.class.LatePermission` (a `createQuery`), resolve employee names via a `contact.mixin.Employee` query, gate actions behind the HR-admin role, and render a table with Approve / Reject:

```svelte
<script lang="ts">
  import { AccountRole, getCurrentAccount, hasAccountRole, SortingOrder, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label, showPopup } from '@hcengineering/ui'
  import contact, { type Employee } from '@hcengineering/contact'
  import ygTimesheet, { type LatePermission } from '@hcengineering/yg-timesheet'
  import { approveLatePermission, rejectLatePermission } from '../utils/attendance-write'
  import RejectLatePopup from './RejectLatePopup.svelte'

  const client = getClient()
  const isHr = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  let rows: LatePermission[] = []
  const q = createQuery()
  q.query(ygTimesheet.class.LatePermission, {}, (res) => { rows = res }, { sort: { date: SortingOrder.Descending } })

  let nameById = new Map<Ref<Employee>, string>()
  const empQuery = createQuery()
  empQuery.query(contact.mixin.Employee, {}, (emps) => { nameById = new Map(emps.map((e) => [e._id, e.name])) })

  function onApprove (r: LatePermission): void { void approveLatePermission(client, r._id) }
  function onReject (r: LatePermission): void {
    showPopup(RejectLatePopup, {}, undefined, (res?: { reason: string }) => {
      if (res !== undefined) void rejectLatePermission(client, r._id, res.reason)
    })
  }
</script>
```

Render a table: Employee (`nameById.get(r.employee)`), date, `{r.minutesLate}` + `<Label label={ygTimesheet.string.MinutesLate} />`, reason, status. Show Approve/Reject buttons only `{#if isHr && r.status !== 'Approved'}` (Reject) / `{#if isHr && r.status !== 'Rejected'}` (Approve). Empty state uses `ygTimesheet.string.NoLatePermissions`. Follow the table styling of an existing HR component (e.g. `Performance.svelte`).

- [ ] **Step 3: Register the HR menu special**

In `models/yg-timesheet/src/index.ts`, in the HR app `specials` array (after the `holidays` special, line 345), add:

```ts
          {
            id: 'late-permissions',
            label: ygTimesheet.string.LatePermissions,
            icon: hr.icon.Attention,
            component: ygTimesheet.component.HrLatePermissions,
            accessLevel: AccountRole.DocGuest,
            position: 'top'
          },
```

(Use whatever HR icon reads best; `hr.icon.Attention` if it exists, otherwise reuse `hr.icon.Overtime`.)

- [ ] **Step 4: Register the component**

Add `HrLatePermissions` to `plugins/yg-timesheet-resources/src/index.ts` component registration.

- [ ] **Step 5: Manual verification (after deploy)** - deferred to the Deployment section.

- [ ] **Step 6: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/HrLatePermissions.svelte plugins/yg-timesheet-resources/src/components/RejectLatePopup.svelte models/yg-timesheet/src/index.ts plugins/yg-timesheet-resources/src/index.ts
git commit -m "feat(yg-timesheet): HR Late Permissions review view"
```

---

### Task 6: Server guard - revert unauthorized status writes

**Files:**
- Modify: `plugins/yg-timesheet/src/index.ts` (add `serverYgTimesheet` trigger ref is in the server descriptor, below)
- Modify: `server-plugins/yg-timesheet/src/index.ts` (add `OnLatePermissionUpdate: '' as Resource<TriggerFunc>`)
- Modify: `server-plugins/yg-timesheet-resources/src/index.ts` (implement + default-export)
- Modify: `models/server-yg-timesheet/src/index.ts` (register the trigger)

**Interfaces:**
- Consumes: `hasAccountRole` + `control.ctx.contextData.account`, `getEmployee` (from `@hcengineering/server-contact`), the System-skip idiom.
- Produces: `serverYgTimesheet.trigger.OnLatePermissionUpdate`.

- [ ] **Step 1: Declare the trigger resource**

In `server-plugins/yg-timesheet/src/index.ts`, next to `OnTimesheetTaskUpdate` (line 20), add:

```ts
    OnLatePermissionUpdate: '' as Resource<TriggerFunc>,
```

- [ ] **Step 2: Implement the trigger**

In `server-plugins/yg-timesheet-resources/src/index.ts`, add (mirrors `OnTimesheetTaskUpdate`'s revert idiom at lines 420-556):

```ts
// Late-permission integrity: only an HR admin (Maintainer), and never the employee themselves, may
// move a LatePermission to Approved/Rejected. An unauthorized status write is reverted to Pending
// with stamps cleared. System-authored writes (this revert) are skipped so it cannot loop.
export async function OnLatePermissionUpdate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx.modifiedBy === core.account.System) continue
    if (tx._class !== core.class.TxUpdateDoc) continue
    const utx = tx as TxUpdateDoc<LatePermission>
    if (utx.objectClass !== ygTimesheet.class.LatePermission) continue
    const next = utx.operations.status
    if (next !== 'Approved' && next !== 'Rejected') continue

    const perm = (
      await control.findAll(control.ctx, ygTimesheet.class.LatePermission, { _id: utx.objectId }, { limit: 1 })
    )[0]
    if (perm === undefined) continue

    const isAdmin = hasAccountRole(control.ctx.contextData.account, AccountRole.Maintainer)
    const actor = await getEmployee(control, utx.modifiedBy)
    const isSelf = actor !== undefined && actor._id === perm.employee
    if (isAdmin && !isSelf) continue // authorized

    const revert = control.txFactory.createTxUpdateDoc(
      perm._class, perm.space, perm._id,
      { status: 'Pending', $unset: { approvedBy: '', approvedOn: '', rejectReason: '' } } as any,
      false, Date.now(), core.account.System
    )
    await control.apply(control.ctx, [revert])
  }
  return []
}
```

Ensure `LatePermission`, `TxUpdateDoc`, `AccountRole`, `hasAccountRole`, `getEmployee` are imported (all already used elsewhere in this file except possibly `LatePermission` - add it to the `@hcengineering/yg-timesheet` import).

- [ ] **Step 3: Add to the default-export trigger map**

In the `export default async () => ({ trigger: { ... } })` block (line 1320), add `OnLatePermissionUpdate,`.

- [ ] **Step 4: Register the trigger**

In `models/server-yg-timesheet/src/index.ts`, add:

```ts
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgTimesheet.trigger.OnLatePermissionUpdate,
    isAsync: true,
    txMatch: { _class: core.class.TxUpdateDoc, objectClass: ygTimesheet.class.LatePermission }
  })
```

- [ ] **Step 5: Manual verification (after deploy)** - as a non-HR user, try to approve your own late permission via the client; confirm the server reverts it to Pending. Deferred to the Deployment section.

- [ ] **Step 6: Commit**

```bash
git add server-plugins/yg-timesheet/src/index.ts server-plugins/yg-timesheet-resources/src/index.ts models/server-yg-timesheet/src/index.ts
git commit -m "feat(yg-timesheet): server guard for LatePermission approval (HR-only, no self)"
```

---

### Task 7: Per-day Late/Excused/Pending status on My Attendance

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/components/MyAttendance.svelte`

**Interfaces:**
- Consumes: `dayLateStatus` (Task 2), the day grouping already present in the history section.

- [ ] **Step 1: Query this employee's late permissions, keyed by day**

In `MyAttendance.svelte` add:

```svelte
  import { dayLateStatus } from '../utils/late'
  let lateByDay = new Map<number, LatePermission>()
  const lateQuery = createQuery()
  $: lateQuery.query(ygTimesheet.class.LatePermission, { employee: me }, (res) => {
    lateByDay = new Map(res.map((p) => [p.date, p]))
  })
```

(Import `type LatePermission` from `@hcengineering/yg-timesheet`.)

- [ ] **Step 2: Render the badge in the day header**

In the attendance history where each day is rendered (the `groupByDay` output), add a badge derived from `dayLateStatus(lateByDay.get(day.date)?.status)`:

```svelte
  {@const ls = dayLateStatus(lateByDay.get(day.date)?.status)}
  {#if ls === 'excused'}<span class="yg-badge yg-badge--ok"><Label label={ygTimesheet.string.LateStatusExcused} /></span>
  {:else if ls === 'pending'}<span class="yg-badge yg-badge--warn"><Label label={ygTimesheet.string.LateStatusPending} /></span>
  {:else if ls === 'late'}<span class="yg-badge yg-badge--bad"><Label label={ygTimesheet.string.LateStatusLate} /></span>
  {/if}
```

Use the badge classes already present in the component (match whatever the file uses for status chips; if none exist, add a minimal `.yg-badge` style in the component `<style>`).

- [ ] **Step 3: Manual verification (after deploy)** - deferred to the Deployment section.

- [ ] **Step 4: Commit**

```bash
git add plugins/yg-timesheet-resources/src/components/MyAttendance.svelte
git commit -m "feat(yg-timesheet): show Late/Excused/Pending per day on My Attendance"
```

---

### Task 8: HR "Late arrivals" count in the Performance report + xlsx

**Files:**
- Modify: `plugins/yg-timesheet-resources/src/utils/performance.ts:21-118`
- Test: `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts`
- Modify: `plugins/yg-timesheet-resources/src/components/Performance.svelte:88,133-159`
- Modify: `plugins/yg-timesheet-resources/src/utils/performance-xlsx.ts:34-53`

**Interfaces:**
- Consumes: `countUnexcusedLate` (Task 2).
- Produces: `PerfRow.lateArrivals: number`; `performanceRows(..., lates?: PerfLate[])` where `PerfLate = { employee: string, date: number, status: LatePermissionStatus }`.

- [ ] **Step 1: Write the failing test**

Add to `plugins/yg-timesheet-resources/src/__tests__/performance.test.ts`:

```ts
it('counts un-excused late arrivals per employee (Approved excluded)', () => {
  const lates = [
    { employee: 'e1', date: 0, status: 'Pending' as const },
    { employee: 'e1', date: 0, status: 'Rejected' as const },
    { employee: 'e1', date: 0, status: 'Approved' as const }
  ]
  const r = performanceRows(emps, [], [], NOW, undefined, lates).find((x) => x.employee === 'e1')!
  expect(r.lateArrivals).toBe(2)
})
```

(`emps`, `NOW` are already defined in this file. Confirm the `performanceRows` positional arg order - `holidays` is the 5th param; `lates` is the new 6th.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/yg-timesheet-resources && npx --no-install jest performance.test -c jest.config.js`
Expected: FAIL (`lateArrivals` undefined / arg not accepted).

- [ ] **Step 3: Implement**

In `performance.ts`:

- Add to `PerfRow` (line 25): `lateArrivals: number`.
- Add near the top: `import { countUnexcusedLate } from './late'` and `import type { LatePermissionStatus } from '@hcengineering/yg-timesheet'`, plus `export interface PerfLate { employee: string, date: number, status: LatePermissionStatus }`.
- Change the signature to accept `lates: PerfLate[] = []` as the 6th param.
- In the per-employee loop, compute `const lateArrivals = countUnexcusedLate(lates.filter((l) => l.employee === emp.employee).map((l) => l.status))` and include `lateArrivals` in the returned row object.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugins/yg-timesheet-resources && npx --no-install jest performance.test -c jest.config.js`
Expected: PASS.

- [ ] **Step 5: Wire the report component**

In `Performance.svelte`:
- Add a `LatePermission` query and map to `PerfLate[]`:
```svelte
  let lates: { employee: string, date: number, status: LatePermissionStatus }[] = []
  const lateQuery = createQuery()
  lateQuery.query(ygTimesheet.class.LatePermission, {}, (res) => {
    lates = res.map((p) => ({ employee: p.employee, date: p.date, status: p.status }))
  })
```
- Update the call (line 88): `$: rows = performanceRows(emps, hours, atts, now, holidays, lates)`.
- Add the header cell after "Late-night" (line 141):
```svelte
          <th class="yg-num"><Label label={ygTimesheet.string.LateArrivals} /></th>
```
- Add the row cell (after line 154):
```svelte
            <td class="yg-num">{r.lateArrivals}</td>
```
- Bump the empty-row `colspan={8}` to `colspan={9}` (line 158).

- [ ] **Step 6: Wire the xlsx export**

In `performance-xlsx.ts`, add to the `header` array (after "Late-night days", line 41):
```ts
    { value: 'Late arrivals', type: String, fontWeight: 'bold' },
```
and to the `body` row (after `num(r.lateNightDays, 0)`, line 51):
```ts
    num(r.lateArrivals, 0),
```
Keep both arrays positionally aligned.

- [ ] **Step 7: Run the perf tests again**

Run: `cd plugins/yg-timesheet-resources && npx --no-install jest performance.test -c jest.config.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugins/yg-timesheet-resources/src/utils/performance.ts plugins/yg-timesheet-resources/src/__tests__/performance.test.ts plugins/yg-timesheet-resources/src/components/Performance.svelte plugins/yg-timesheet-resources/src/utils/performance-xlsx.ts
git commit -m "feat(yg-timesheet): Late arrivals count in Performance report + xlsx"
```

---

## Deployment and manual verification

This changes the MODEL (new `LatePermission` class) and adds a SERVER trigger, so it is a FULL build, not front-only. From `huly-migration/huly-selfhost`:

```bash
./build-beta.sh                       # full 4-image build
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d --force-recreate transactor account front
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
./run-tool-beta.sh upgrade-workspace yg
```

Then verify at `http://localhost:8087` (HTTP 200 check first):

1. **Setup:** In HR -> Team Profiles, set a `shiftStart` (e.g. 09:00) for a test employee.
2. **Late punch:** As that employee, punch in after 09:00 -> the reason popup appears and is required; on submit, the punch completes and a `Pending` `LatePermission` exists. Confirm the day shows a "Pending" badge on My Attendance.
3. **On-time punch:** Punch in before/at 09:00 (or as an employee with no `shiftStart`) -> no popup, no record.
4. **Second punch:** A second punch the same day -> no popup.
5. **HR review:** As HR (Maintainer), open HR -> Late permissions, Approve the request -> the employee's day flips to "Excused". Reject another -> stays "Late", reason recorded.
6. **Guard:** As a non-HR user, try to approve your own late permission via the client (e.g. devtools) -> the server reverts it to `Pending`.
7. **Performance:** HR -> Performance shows a "Late arrivals" count equal to the employee's un-excused late days; Approved days are excluded; xlsx export has the column.

Local OTP for test logins: read from the DB (no mail service) - `global_account.otp` joined to `social_id`.

## Notes

- Read privacy: `LatePermission` (with the reason text) is world-readable like `AttendanceSession`; per-employee read privacy is deferred with the rest of the attendance/approval hardening.
- The `lates`/`PerfLate` param defaults to `[]`, so the existing `performanceRows` unit tests and any other callers keep working unchanged.
