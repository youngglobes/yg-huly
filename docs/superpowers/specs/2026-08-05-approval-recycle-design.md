# Approval Re-Cycle Design: Rejection History, Resubmit Notes, Re-Labels

**Backlog items covered:** #2 (rejection reason maintained/shown on the approval screen), #3 (button
text Resubmit / Reapprove), #4 (employee can add a note when resubmitting). See
`2026-08-04-yg-portal-backlog.md`.

**Repo / branch:** `youngglobes/yg-huly`, branch `yg_beta`. NEVER merge to `yg_develop` (auto-deploys)
as part of this work. Local build and verify only.

---

## Why these three are one change

Items 2, 3 and 4 look like three small UI tweaks. They are not. All three depend on the same
missing capability, and none of them can be built without it.

Two facts about the current code decide the whole design:

1. **The approver never sees a rejected task again.** `Approvals.svelte:53` queries
   `{ status: 'Submitted' }`. Once a task is rejected it leaves the queue permanently. There is no
   screen on which a rejection reason could be shown to an approver.

2. **Resubmit destroys the rejection.** `submitDay` (`utils/day.ts:124-127`) removes every task row
   that is not `Approved`, then creates a fresh row with `status: 'Submitted'` and no
   `rejectReason`. After a resubmit there is no record in the database that the task was ever
   rejected.

So item 3's "Reapprove" label needs to know the task was rejected before, and item 4's resubmit
note needs somewhere to live that survives the same wipe. **All three need rejection state that
outlives a resubmit.** That shared substrate is the bulk of this design; the three visible features
are thin layers on top.

### Relationship to the open approval security gap

CLAUDE.md tracks an open forgery and read-exposure gap on `TimesheetApproval` in what it calls the
private `ygTimesheet.space.Approvals`. **This bundle does not sit on that surface.** It touches
`TimesheetTask` (world-readable, `core.space.Workspace`) and `rejectReason`, which already lives
there. The agreed server-materialization fix should not invalidate this design.

> ⚠️ **Stale documentation found while writing this spec (2026-08-05).** The Approvals space is
> **no longer private**. `createApprovalsSpace` (`models/yg-timesheet/src/migration.ts:53`) creates
> it with `private: false`, and `openApprovalsSpaceRaw` (same file, line 75) does a raw
> `DOMAIN_SPACE` update flipping any still-private space to public. That change is dated 2026-07-27
> and was made so approvers and admins could read approved hours in Reports and the CSV export.
>
> Two places still describe it as private and should be corrected as a separate change, not as part
> of this bundle:
> - `CLAUDE.md`, the timesheet-approval security section
> - the `TimesheetApproval` doc comment at `plugins/yg-timesheet/src/index.ts:63-65`
>
> This does not change the present design; it strengthens the read-scope argument below, since
> approval records are already public by deliberate decision. It does mean the "read-exposure"
> half of the documented gap is now a design choice rather than a bug, while the forgery half
> stands. Worth confirming that was the intent before any real payroll use.

---

## Decisions taken (brainstorm 2026-08-05)

| Question | Decision |
|---|---|
| What does the approver see after rejecting? | Nothing while waiting. Context appears **on the resubmitted task** when it returns to the queue. No separate "rejected" section. |
| How much history? | **Full history, all cycles.** Every reject/resubmit round is retained. |
| Resubmit note scope | **One note per rejected task, optional.** Employee may leave any or all blank. |
| Approver button copy | **"Reapprove"**, literally as the team asked. Popup title follows. |
| Employee view | **Reason per task row, with expandable history.** Replaces the current day-level display. |
| Where history lives | **Durable `TimesheetRejectCycle` records**, keyed by employee + issue + date. |

### Why durable records and not an array on the task

An embedded `cycles?: RejectCycle[]` on `TimesheetTask`, copied forward during `submitDay`, was the
initial proposal. It is simpler and it does block the naive wipe. It was rejected because of a
two-step path that erases history entirely through normal UI actions:

1. Employee's task is rejected.
2. Employee deletes the time entry for that issue and resubmits the day without it. The `Rejected`
   row is removed at `day.ts:126` and there is no new row to copy the array onto. History gone.
3. Employee re-adds the issue and submits again. A clean task arrives in the approver's queue with
   no reason, no badge, no round count. The approver cannot tell it was ever rejected.

No API access is needed. An array cannot survive this, because the array only exists on a row the
submit path is designed to delete. Records keyed by employee + issue + date, written by the
approver and never touched by any submit path, do survive it.

**Scope of that claim.** Durable records close the UI-reachable path. They do **not** close the API
path: any client can remove a doc it can see, and these records are world-readable. That is the
same class of gap CLAUDE.md already tracks and is the server-materialization work, not this bundle.
This is an audit trail against ordinary use, not against a determined attacker.

---

## Data model

New class `TimesheetRejectCycle`, domain `DOMAIN_YG_TIMESHEET`, space `core.space.Workspace`.

```ts
/**
 * One reject/resubmit round for a single (employee, issue, date) unit of work.
 *
 * Deliberately NOT keyed by Ref<TimesheetTask>: submitDay deletes and recreates task rows on every
 * resubmit (utils/day.ts:124-127), so a task ref would orphan the history. The employee+issue+date
 * triple is stable across that churn, which is the entire reason this is a separate doc rather than
 * an array on the task.
 */
export interface TimesheetRejectCycle extends Doc {
  employee: Ref<Employee>
  issue: Ref<Issue>
  date: Timestamp          // local midnight, same convention as TimesheetTask.date
  rejectReason: string
  rejectedBy?: Ref<Employee>   // optional: backfilled historical rows have no attribution
  rejectedOn: Timestamp
  resubmitNote?: string        // employee's reply, optional by design
  resubmittedOn?: Timestamp    // absent = cycle still open
}
```

**No stored round number.** The round is derived at display time by sorting a key's cycles by
`rejectedOn` and taking the index; the count shown as "rejected 2x" is the array length. A stored
counter would add drift risk (a failed create renumbers subsequent rounds) for no read benefit.

**Model registration** follows the existing pattern in `models/yg-timesheet/src/index.ts`, alongside
`TTimesheetTask` and `TTimesheetApproval`. All fields are simple scalars and refs, so each takes an
ordinary `@Prop`; no opaque-array handling is needed (contrast `TimesheetDay.snapshot`).

### Read scope, stated deliberately

These records live in `core.space.Workspace` and are therefore readable by every workspace member,
including reasons and replies about other people's hours. This **matches the status quo**:
`rejectReason` already sits on the world-readable `TimesheetTask`. It is not a regression, but it is
a conscious choice. If replies must be approver-only, the records move to the private Approvals
space and the employee loses their own history view. That trade was considered and declined.

---

## Write points

Two, both narrow. Existing behaviour at both sites is preserved.

### 1. `rejectTask` (`utils/day.ts:288`) gains a create

It currently sets `status: 'Rejected'` and `rejectReason` on the task and removes any stale
`TimesheetApproval`. It additionally creates a `TimesheetRejectCycle` for the task's
employee + issue + date with `rejectReason`, `rejectedBy` (current employee) and `rejectedOn`.

**Resolving the employee.** `TimesheetTask` has no `employee` field: it is reachable only via
`attachedTo` → `TimesheetDay` → `attachedTo` → `Timesheet` → `employee`. `rejectTask` therefore
gains an `employee: Ref<Employee>` parameter. `Approvals.svelte` already computes this with its
`employeeOf(task)` helper (line 74) and passes it through. That helper returns `undefined` on a
lookup miss (the "Unknown" bucket at line 111), so `rejectTask` falls back to resolving the
day → timesheet chain with `client.findOne` when the caller passes `undefined`. **If the employee
still cannot be resolved, the task is still rejected but no cycle is written**. A task whose owner
is unknown cannot be keyed, and silently writing a mis-keyed record would corrupt another
employee's history.

`task.rejectReason` **stays** as the current-round fast path. This redundancy is bought
deliberately: it keeps the diff off `Timesheet.svelte`'s existing reason read and off the server
trigger at `server-plugins/yg-timesheet-resources/src/index.ts:508`, which reads `task.rejectReason`
to compose the inbox ping. Cycle records are the durable history; the task field is the live value.

**Ordering: update the task first, then create the cycle.** These are separate docs with no
cross-doc transaction, so ordering determines the failure mode. Task-first degrades to a rejected
task with no history, which is exactly today's behaviour and is repairable by the backfill.
Cycle-first would leave a record asserting a rejection that never happened, and a false entry in an
audit trail is worse than a missing one.

### 2. `submitDay` (`utils/day.ts:97`) gains a close

Before writing task rows, for each **open** cycle whose issue is present in the day's units, stamp:

- `resubmittedOn`: always, because the resubmit closes the round whether or not a note was written.
- `resubmitNote`: only when the employee's reply is non-blank.

`submitDay` **deletes nothing new**. The remove-and-recreate at `day.ts:121-128` and its invariant
that `Approved` siblings are preserved are untouched.

`SubmitArgs` gains `resubmitNotes?: Map<Ref<Issue>, string>`, optional so every existing caller and
the plain Draft path compile and behave unchanged.

**Dropped-issue case falls out for free.** If the employee removed a rejected issue from the day, it
is not in the units, so its cycle is never stamped and stays open. Nothing was resubmitted, so
nothing is recorded as resubmitted. No special handling.

**Rejected then approved without a resubmit.** The cycle stays open with no `resubmitNote` and no
`resubmittedOn`. `approveTask` does not close or delete cycles. This is the honest record: the task
was rejected, then approved anyway.

---

## Screens

### Approver: `Approvals.svelte`

The `{ status: 'Submitted' }` query at line 53 is **unchanged**. Rejected tasks still leave the
queue. What changes is that a resubmitted task now arrives carrying context.

A second live query fetches cycles for the issues currently in the queue,
`{ issue: { $in: uniqueQueueIssues } }`, filtered to the matching employee and date client-side.
Bounded by queue size, not by total history.

> ⚠️ **Reactive-loop trap.** `Approvals.svelte:62-71` carries a hard-won comment: a reactive
> statement that both reads and reassigns its own query variable self-triggers forever. The cycles
> query must follow the same discipline: a stable query instance, `unsubscribe()` rather than
> reassignment, results written to a separate variable.

A task with cycles gains a rejection line and a relabelled button:

```
Karthik
  YG-98   Refactor auth guard              4.5h
    ⟲ previously rejected: "Hours look high for the scope, please split."
      Karthik replied: "Split into 98a/98b, this is 98a only."
      rejected 2x ▾
                                    [Reapprove]  [Reject]
```

Expanding shows each earlier round: reason, who rejected it, and the reply. A task with **no**
cycles renders exactly as it does today, with no line and the button reads `Approve`.

### Employee: `Timesheet.svelte`

The day-level block is **removed**: line 268 picks one rejected task per day and lines 320-325 print
its reason on the day card. That is the source of a live bug: with two rejected tasks in a day, one
reason is silently dropped and never reaches the employee.

The reason moves inside the existing per-issue loop (lines 298-317), rendered on any row whose task
status is `Rejected`:

```
Wed 5 Aug                    [Rejected]   6.5h   [Resubmit]
  YG-98    Refactor auth guard    4.5h  [Rejected]
    ⤷ "Hours look high for the scope, please split."
      Priya, 2 days ago              rejected 2x ▾
  YG-104   Fix login redirect      2.0h  [Rejected]
    ⤷ "Wrong project."
      Priya, 2 days ago
```

Both reasons now reach the employee. Expanding gives the same round-by-round view the approver sees,
including the employee's own past replies, so neither side holds information the other lacks.

The current reason text still comes from `task.rejectReason` (already working). Attribution and
timestamp come from the open cycle record (new). Expansion state is component-local (a `Set` of
keys), nothing persisted.

### Resubmit dialog: new `ResubmitDayPopup.svelte`

`onSubmit(day)` (`Timesheet.svelte:211`) currently calls `submitDay` directly. It gains one branch,
keyed on the **derived day status** that already gates the button at line 286
(`status === 'Draft' || status === 'Rejected'`):

- derived status `Rejected` → show the dialog first, then submit with the collected notes
- derived status `Draft` → submit directly, exactly as today

These are the only two states in which the button renders, and `Rejected` implies at least one
rejected task, so the condition needs no separate "has rejected tasks" check.
**The Draft path stays untouched**, keeping the common case at zero added friction.

The dialog lists only rejected issues still present in the day's time entries. Each gets its reason
and an optional reply box. Cancel writes nothing.

```
RESUBMIT   Wed 5 Aug

YG-98   Refactor auth guard                  4.5h
  Rejected by Priya: "Hours look high for the
  scope, please split."
  Your reply (optional)
  [ Split into 98a/98b, this is 98a only.   ]

YG-104  Fix login redirect                   2.0h
  Rejected by Priya: "Wrong project."
  Your reply (optional)
  [                                          ]

                          [Cancel]  [Resubmit]
```

Styling follows `RejectTaskPopup.svelte` (the `.dialog` / `yg-btn` idiom, `yg-table.scss`).

---

## Labels

Three sites, two new strings.

| Site | Today | Becomes |
|---|---|---|
| `Timesheet.svelte:288` | `Submit` | `Resubmit` when the day's derived status is `Rejected` |
| `Approvals.svelte:220` | `Approve` | `Reapprove` when the task has cycles |
| `ApproveTaskPopup` title | `Approve task` | `Reapprove task`, same condition, flag passed in |

New `IntlString`s `Resubmit` and `ReapproveTask` are added to the string map in
`plugins/yg-timesheet/src/index.ts` and to `plugins/yg-timesheet-assets/lang/en.json`. Per the
established convention, `ru.json` is left alone and falls back to English on purpose.

`Recall` and `Reject` do not change. `RejectTaskPopup` is deliberately left alone: an approver
rejecting round three already sees the full history on the queue row behind the popup, so
duplicating it inside the dialog is scope not worth adding.

---

## Migration: backfill

Tasks already sitting at `Rejected` have a `rejectReason` and no cycle record, so without a backfill
they would display as never-rejected.

A new named state in `models/yg-timesheet/src/migration.ts`, following the existing pattern
(alongside `hr-timeentry-backfill-0002`), writes one cycle per existing `Rejected` task from its
`rejectReason`, `date`, `issue` and owning employee.

`rejectedBy` is **not recoverable** for historical rows, because the task never stored it. Backfilled
records carry the reason and date with the approver left unset, and the UI renders them as
"rejected" without attribution. This is why `rejectedBy` is optional in the model.

> This is called out loudly because this codebase has been bitten by exactly this before: the HR
> projection shipped without backfilling `HrTimeEntry` and showed empty history until it was patched
> (commit `da3a61c9e`).

---

## Testing

`plugins/yg-timesheet-resources` already has jest wired (`jest.config.js`, ten test files under
`src/__tests__` and `src/utils/__tests__`). This work follows that; **no new test infrastructure**.

Pure logic lives in `utils/` and is unit tested:

- grouping cycles by the employee + issue + date triple
- deriving round ordering and the display count from `rejectedOn`
- selecting which open cycles a given resubmit should close
- open versus closed classification

Svelte rendering is not unit tested, matching how the rest of this codebase is tested.

### Manual smoke tests (after the build)

1. Reject a task. The employee sees the reason **on that task row**, not on the day card.
2. Reject **two** tasks in one day with different reasons. Both reach the employee. *(This is the
   current bug.)*
3. Resubmit with a reply on one task and blank on the other. The approver sees the reply and the
   `Reapprove` label.
4. Reject, resubmit, reject, resubmit. "rejected 2x" expands to both rounds on **both** screens.
5. **The wipe attempt.** Reject a task, delete its time entry, resubmit the day without it, then
   re-add the issue and submit again. History is still there and the approver still sees
   `Reapprove`. *This is the case that drove the storage decision, so it must pass.*
6. Approve a never-rejected task. The screen is unchanged from today.

---

## Deployment

New model class plus a migration means the **full four-image build** and `upgrade-workspace yg`, not
a front-only build. Same shape as the estimate gate (`2026-08-05-estimate-before-start.md`).

Per the 2026-07-23 ops rule, restart nginx after force-recreating any service it proxies to.

---

## Out of scope

- Rejection analytics (rate by approver, time-to-resolve). The records support it; no UI is built.
- Pruning or archiving old cycle records. They accumulate. Revisit if volume becomes a problem.
- Showing history inside `RejectTaskPopup` (see Labels).
- Closing the API-level delete path. That is the server-materialization work already on the books.
- Any change to `TimesheetApproval` or the private Approvals space.
