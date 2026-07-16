//
// YoungGlobes: server-yg-timesheet-resources — real workflow enforcement trigger (Phase 1b Task 4).
//
// OnTimesheetDayUpdate enforces authorization on the TimesheetDay state machine.
//
// Proven constraints (Task 1 spike):
//  - The trigger MUST be async (a sync trigger doing control.findAll deadlocks the tx).
//  - Triggers see POST-APPLY state: control.findAll returns the doc already carrying the
//    update's new values — you cannot read the "from" state. So we enforce on the new
//    state + who acted (getEmployee(control, tx.modifiedBy)).
//  - Compensating reverts / authoritative stamps are emitted via control.apply (not by
//    returning them); the trigger returns [].
//
// Division of labour: the client computes and SENDS approvers (on submit) and
// snapshot + totalHours (on approve). This server trigger does NOT recompute them — it
// only (a) validates authorization and reverts violations and (b) stamps approvedBy /
// approvedOn authoritatively on approve and clears them on reopen. The checks are inline
// ref comparisons (the resources package's pure functions are NOT imported server-side).
//
// Loop-safety: control.apply'd txes re-enter this async trigger. Every compensating write
// is attributed to the System account (createTxUpdateDoc's modifiedBy override), and the
// top-of-loop guard skips System-authored txes — so the trigger's own writes never
// re-enter and re-revert, regardless of the revert target.
//
import core, {
  AccountRole,
  hasAccountRole,
  type AccountUuid,
  type Data,
  type PersonId,
  type Ref,
  type Space,
  type Tx,
  type TxCreateDoc,
  type TxCUD,
  type TxUpdateDoc,
  TxProcessor
} from '@hcengineering/core'
import contact, { type Employee } from '@hcengineering/contact'
import { type TriggerControl } from '@hcengineering/server-core'
import { getEmployee, getSocialIdsByAccounts } from '@hcengineering/server-contact'
import ygTimesheet, { type DayStatus, type HrTimeEntry, type TimesheetDay } from '@hcengineering/yg-timesheet'
import tracker, { type Issue, type Project, type TimeSpendReport } from '@hcengineering/tracker'
import workbench, { type Application, type HiddenApplication } from '@hcengineering/workbench'

export async function OnTimesheetDayUpdate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    // Idempotence guard: our own compensating reverts / authoritative stamps are written
    // as the System account. Skip them so they never re-enter and re-revert.
    if (tx.modifiedBy === core.account.System) continue

    const utx = tx as TxUpdateDoc<TimesheetDay>
    if (utx.objectClass !== ygTimesheet.class.TimesheetDay) continue

    const day = (
      await control.findAll(control.ctx, ygTimesheet.class.TimesheetDay, { _id: utx.objectId }, { limit: 1 })
    )[0]
    if (day === undefined) continue

    // Parent Timesheet.employee is the day's owner (the person the timesheet belongs to).
    const parent = (
      await control.findAll(control.ctx, ygTimesheet.class.Timesheet, { _id: day.attachedTo }, { limit: 1 })
    )[0]
    const owner: Ref<Employee> | undefined = parent?.employee

    // Map the acting social-id -> Ref<Employee> (undefined for the System account / unknown actor).
    const actor: Employee | undefined = await getEmployee(control, utx.modifiedBy)
    const actorRef: Ref<Employee> | undefined = actor?._id

    // Admin break-glass: workspace Owner/Maintainer. contextData.account is the acting
    // session's account in the async trigger context (see contact-resources for the idiom).
    const isAdmin = hasAccountRole(control.ctx.contextData.account, AccountRole.Maintainer)

    const next = (utx.operations as Partial<TimesheetDay>).status as DayStatus | undefined

    // Compensating write — attributed to System (7th arg modifiedBy) so it doesn't re-trigger.
    const apply = async (ops: Partial<TimesheetDay>): Promise<void> => {
      const t = control.txFactory.createTxUpdateDoc(
        utx.objectClass,
        utx.objectSpace,
        utx.objectId,
        ops as any,
        undefined,
        undefined,
        core.account.System
      )
      await control.apply(control.ctx, [t])
    }

    // Rule A: approve / reject authorization + no-self-approve.
    if (next === 'Approved' || next === 'Rejected') {
      if (actorRef !== undefined && owner !== undefined && actorRef === owner) {
        // Self-approve/-reject — forbidden even for admin. Revert to Submitted, clear stamps.
        await apply({ status: 'Submitted', approvedBy: null, approvedOn: null, rejectReason: null } as any)
        continue
      }
      const isApprover = actorRef !== undefined && (day.approvers ?? []).includes(actorRef)
      if (!isAdmin && !isApprover) {
        // Actor is not an approver of this day. Revert to Submitted, clear stamps.
        await apply({ status: 'Submitted', approvedBy: null, approvedOn: null, rejectReason: null } as any)
        continue
      }
      // Authorized. On approve, stamp approvedBy/approvedOn authoritatively. Reject needs no
      // stamp (the client set rejectReason).
      if (next === 'Approved') {
        await apply({ approvedBy: actorRef ?? null, approvedOn: Date.now() } as any)
      }
      continue
    }

    // Rule B: reopen / recall authorization.
    if (next === 'Draft') {
      if (day.approvedBy != null) {
        // Day had been approved -> this is a REOPEN. Allow only the original approver or admin.
        const allowed = isAdmin || (actorRef !== undefined && actorRef === day.approvedBy)
        if (!allowed) {
          await apply({ status: 'Approved' } as any)
          continue
        }
        // Allowed reopen: clear approval stamps.
        await apply({ approvedBy: null, approvedOn: null } as any)
      } else {
        // Day was Submitted (not yet approved) -> this is a RECALL by the employee.
        const allowed = isAdmin || (actorRef !== undefined && owner !== undefined && actorRef === owner)
        if (!allowed) {
          await apply({ status: 'Submitted' } as any)
        }
      }
      continue
    }

    // Rule C: protect an approved day from other (non-status) edits. Defense-in-depth only.
    if (next === undefined && day.status === 'Approved') {
      if (!isAdmin && (actorRef === undefined || actorRef !== day.approvedBy)) {
        // We see post-apply state and cannot restore arbitrary prior field values, so we log
        // rather than revert unknown fields. Our UI gates edits to an approved day, so this
        // path is not expected in normal operation. (Rules A and B are the load-bearing ones.)
        control.ctx.warn('yg-timesheet: unauthorized non-status edit of approved TimesheetDay', {
          day: day._id,
          actor: actorRef,
          approvedBy: day.approvedBy
        })
      }
      continue
    }
  }
  return []
}

//
// Mirror every TimeSpendReport into a denormalized HrTimeEntry in the private HR space, so HR
// can read all employees' time without project membership. System-attributed; HrTimeEntry lives
// in a different class/space so these writes never re-enter this trigger.
//
// Verify note (resolved against this codebase, not assumed): TimeSpendReport is an AttachedDoc on
// Issue, but its CUD does NOT arrive wrapped in a TxCollectionCUD — that wrapper class was removed
// from this schema version (see models/core/src/migration.ts, state "remove-collection-txes", and
// core.class.TxCollectionCUD is not even registered — foundations/core/packages/core/src/component.ts).
// TxCreateDoc/TxUpdateDoc/TxRemoveDoc for an AttachedDoc are flat CUD txes carrying attachedTo /
// attachedToClass directly. This mirrors the real handling in
// server-plugins/tracker-resources/src/index.ts (OnIssueUpdate / doTimeReportUpdate), which reads
// `cud.attachedTo` straight off the CUD tx with no unwrapping step. There is also no
// `TxProcessor.extractTx` in this version of @hcengineering/core — only `TxProcessor.createDoc2Doc`
// (and updateDoc2Doc/buildDoc2Doc), used below to materialize the created report.
//
export async function OnTimeSpendReportChange (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (
      tx._class !== core.class.TxCreateDoc &&
      tx._class !== core.class.TxUpdateDoc &&
      tx._class !== core.class.TxRemoveDoc
    ) {
      continue
    }
    const cud = tx as TxCUD<TimeSpendReport>
    if (cud.objectClass !== tracker.class.TimeSpendReport) continue

    if (cud._class === core.class.TxCreateDoc) {
      const report = TxProcessor.createDoc2Doc(cud as TxCreateDoc<TimeSpendReport>)
      await upsertMirror(control, report)
    } else if (cud._class === core.class.TxUpdateDoc) {
      const report = (
        await control.findAll(control.ctx, tracker.class.TimeSpendReport, { _id: cud.objectId }, { limit: 1 })
      )[0]
      if (report !== undefined) await upsertMirror(control, report)
    } else if (cud._class === core.class.TxRemoveDoc) {
      await deleteMirror(control, cud.objectId)
    }
  }
  return []
}

// Remove any HrTimeEntry mirror(s) for a given TimeSpendReport (System-attributed). There should be
// at most one, but findAll without a limit is defensive against a stray duplicate.
async function deleteMirror (control: TriggerControl, source: Ref<TimeSpendReport>): Promise<void> {
  const mirrors = await control.findAll(control.ctx, ygTimesheet.class.HrTimeEntry, { source })
  const del = mirrors.map((m) =>
    control.txFactory.createTxRemoveDoc(m._class, m.space, m._id, undefined, core.account.System)
  )
  if (del.length > 0) await control.apply(control.ctx, del)
}

async function upsertMirror (control: TriggerControl, report: TimeSpendReport): Promise<void> {
  // No employee to attribute the hours to (shouldn't normally happen). If the report previously had
  // an employee and was cleared on update, a stale mirror would otherwise linger — so delete any
  // existing mirror to preserve the "one current mirror per report, or none" invariant, then bail.
  const employee = report.employee
  if (employee === null || employee === undefined) {
    await deleteMirror(control, report._id)
    return
  }

  const issue = (
    await control.findAll(control.ctx, tracker.class.Issue, { _id: report.attachedTo as Ref<Issue> }, { limit: 1 })
  )[0]
  const project = issue !== undefined
    ? (await control.findAll(control.ctx, tracker.class.Project, { _id: issue.space }, { limit: 1 }))[0]
    : undefined

  const data: Data<HrTimeEntry> = {
    source: report._id,
    employee,
    date: report.date ?? 0,
    hours: report.value,
    project: (issue?.space ?? '') as Ref<Project>,
    projectName: project?.name ?? '',
    issue: (issue?._id ?? report.attachedTo) as Ref<Issue>,
    identifier: issue?.identifier ?? '—',
    title: issue?.title ?? '(unknown issue)',
    note: report.description ?? ''
  }

  const existing = (
    await control.findAll(control.ctx, ygTimesheet.class.HrTimeEntry, { source: report._id }, { limit: 1 })
  )[0]

  if (existing === undefined) {
    const t = control.txFactory.createTxCreateDoc(
      ygTimesheet.class.HrTimeEntry,
      ygTimesheet.space.HrData,
      data,
      undefined,
      undefined,
      core.account.System
    )
    await control.apply(control.ctx, [t])
  } else {
    const t = control.txFactory.createTxUpdateDoc(
      ygTimesheet.class.HrTimeEntry,
      existing.space,
      existing._id,
      data,
      undefined,
      undefined,
      core.account.System
    )
    await control.apply(control.ctx, [t])
  }
}

//
// Privacy write-guard: only the workspace Owner may curate the HR roster (ygTimesheet.space.HrData
// membership). HrData is a plain core.class.Space, NOT a TypedSpace, so Huly's security pipeline does
// not permission-check writes to it — any workspace User could `$push` their own AccountUuid into
// HrData.members via a direct API call and thereby read every employee's HrTimeEntry. This trigger
// reverts any membership addition made by a non-Owner, server-side.
//
// Same idioms as OnTimesheetDayUpdate: async, POST-APPLY state, System-attributed compensating writes
// applied via control.apply (not returned), and the top-of-loop System loop-guard so our own $pull
// never re-enters and re-reverts.
//
// The revert is precise for `$push` (both the single-value `{ $push: { members: X } }` and the
// `{ $push: { members: { $each: [...] } } }` forms — we pull exactly what was added, so legitimate
// pre-existing members are untouched). A raw `{ members: [...] }` set by a non-Owner cannot be
// precisely reverted from post-apply state without destroying legitimate members, so for it the
// load-bearing guarantee is the BACKSTOP: we always also $pull the acting account's own uuid from
// members/owners — so no non-Owner code path can leave the actor (a non-Owner) inside HrData, which
// is the property that actually protects read-privacy.
//
export async function OnHrDataMembershipGuard (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    // Idempotence guard: our own compensating $pull is written as System. Skip it so it never
    // re-enters and re-reverts.
    if (tx.modifiedBy === core.account.System) continue

    const utx = tx as TxUpdateDoc<Space>
    if (utx.objectClass !== core.class.Space) continue
    if (utx.objectId !== ygTimesheet.space.HrData) continue

    // Owner is authorized to curate the roster — the only role allowed to. Anything else (undefined
    // account included) is treated as unauthorized and reverted (privacy-safe default).
    const account = control.ctx.contextData.account
    if (account !== undefined && hasAccountRole(account, AccountRole.Owner)) continue

    const ops = utx.operations as Record<string, any>

    // Collect exactly the AccountUuids the tx ADDED to each field via $push (both forms), so we can
    // pull precisely those back out without touching legitimate pre-existing members.
    const pullMembers = new Set<AccountUuid>()
    const pullOwners = new Set<AccountUuid>()

    const collectPush = (field: 'members' | 'owners', sink: Set<AccountUuid>): void => {
      const v = ops.$push?.[field]
      if (v === undefined || v === null) return
      if (typeof v === 'object' && Array.isArray(v.$each)) {
        for (const x of v.$each as AccountUuid[]) sink.add(x)
      } else {
        sink.add(v as AccountUuid)
      }
    }
    collectPush('members', pullMembers)
    collectPush('owners', pullOwners)

    // Backstop: always pull the acting (non-Owner) account's own uuid too — covers a raw
    // `{ members: [...] }` / `{ owners: [...] }` set, which we cannot precisely revert from
    // post-apply state, and guarantees the actor is never left inside the private HR space.
    const actorUuid = account?.uuid
    if (actorUuid !== undefined) {
      pullMembers.add(actorUuid)
      pullOwners.add(actorUuid)
    }

    if (pullMembers.size === 0 && pullOwners.size === 0) continue

    const pull: Record<string, any> = {}
    if (pullMembers.size > 0) pull.members = { $in: [...pullMembers] }
    if (pullOwners.size > 0) pull.owners = { $in: [...pullOwners] }

    // Compensating write — attributed to System (7th arg) so it doesn't re-trigger the guard.
    const t = control.txFactory.createTxUpdateDoc(
      utx.objectClass,
      utx.objectSpace,
      utx.objectId,
      { $pull: pull } as any,
      undefined,
      undefined,
      core.account.System
    )
    await control.apply(control.ctx, [t])
  }
  return []
}

//
// COSMETIC layer (best-effort): hide the "Human Resource" app icon from the left rail for every
// account that is NOT a member of the private HR space (ygTimesheet.space.HrData). The HrTimeEntry
// data is already server-private (PrivateMiddleware + OnHrDataMembershipGuard); this only removes the
// icon so non-HR users don't even see the app. If any part of this fails it must NOT block anything —
// worst case a non-member sees an icon that opens an empty/permission-denied view.
//
// MECHANISM (proven by the Task-7 spike, verified against this codebase — not assumed):
//  - The left rail (plugins/workbench-resources/src/components/Applications.svelte) hides any app whose
//    _id appears as a `workbench.class.HiddenApplication` the CURRENT user can see. HiddenApplication is
//    a `Preference` living in the SHARED `core.space.Workspace` — there is NO per-user space. Per-user
//    scoping is done by `createdBy`: the server's PrivateMiddleware (foundations/server/packages/
//    middleware/src/private.ts) rewrites every preference-domain read from a non-System account to
//    `createdBy: { $in: <that account's socialIds> }`. So a HiddenApplication only affects the user whose
//    social id is its `createdBy`.
//  - To hide the HR app for user X we therefore create a HiddenApplication whose `createdBy` is one of
//    X's social ids. `TxFactory.createTxCreateDoc` sets the tx's `createdBy = modifiedBy` (its 6th arg),
//    and `TxProcessor.createDoc2Doc` sets `doc.createdBy = tx.createdBy` — so passing X's social id as
//    the `modifiedBy` arg lands `doc.createdBy = X's social id`. No middleware overrides it.
//  - PrivateMiddleware's WRITE guard permits this: writing another user's preference is allowed when the
//    acting account is System OR an Owner. HrData membership can only be curated by an Owner (enforced by
//    OnHrDataMembershipGuard), so on the membership-edit path the acting account is always an Owner; the
//    backfill runs as System. Reads by System bypass the createdBy filter, so System can enumerate and
//    remove any user's HiddenApplication when they join HR.
//
// LOOP-SAFETY: this trigger matches TxUpdateDoc on objectId === HrData only. Its own writes are
// HiddenApplication creates/removes (different class + objectId), so they never re-enter this trigger.
// We deliberately do NOT skip System-authored HrData updates: when OnHrDataMembershipGuard $pulls a
// sneak-in non-Owner back out (a System write to HrData), we want to re-run and restore that user's hide.
// reconcile is idempotent and converges in one extra pass, then stops (no HrData tx is emitted).
//
const HR_APP = ygTimesheet.app.HumanResource as unknown as Ref<Application>

// Every human account in the workspace (canonical membership set = the Employee mixin's personUuid).
async function allWorkspaceAccounts (control: TriggerControl): Promise<AccountUuid[]> {
  const employees = await control.findAll(control.ctx, contact.mixin.Employee, {})
  const set = new Set<AccountUuid>()
  for (const e of employees) {
    if (e.personUuid != null) set.add(e.personUuid)
  }
  return [...set]
}

// Core reconcile: given the current HR members, ensure a HiddenApplication(HR) exists (createdBy = one
// of their social ids) for every NON-member, and none exists for any member. Idempotent. All writes go
// through control.apply. Shared by the trigger and the backfill. Never throws out — it best-effort logs.
async function reconcileHrHidden (control: TriggerControl, members: AccountUuid[]): Promise<void> {
  try {
    const memberSet = new Set(members)
    const nonMembers = (await allWorkspaceAccounts(control)).filter((a) => !memberSet.has(a))

    const nonMemberSocial = await getSocialIdsByAccounts(control, nonMembers)
    const memberSocial = members.length > 0 ? await getSocialIdsByAccounts(control, members) : {}

    // System read → PrivateMiddleware does not apply the createdBy filter, so we see EVERY user's hide.
    const existing = await control.findAll(control.ctx, workbench.class.HiddenApplication, {
      attachedTo: HR_APP,
      space: core.space.Workspace
    })
    const existingByCreator = new Map<PersonId, HiddenApplication>()
    for (const h of existing) {
      if (h.createdBy != null) existingByCreator.set(h.createdBy, h)
    }

    const txes: Tx[] = []

    // Seed a hide for each non-member that doesn't already have one under any of their social ids.
    for (const acc of nonMembers) {
      const socials = nonMemberSocial[acc] ?? []
      if (socials.length === 0) continue // no social id to scope a pref to — cannot hide, skip (harmless)
      if (socials.some((s) => existingByCreator.has(s))) continue // already hidden for this account
      txes.push(
        control.txFactory.createTxCreateDoc(
          workbench.class.HiddenApplication,
          core.space.Workspace,
          { attachedTo: HR_APP } as Data<HiddenApplication>,
          undefined,
          undefined,
          // 6th arg = modifiedBy → sets tx.createdBy → doc.createdBy = this account's social id.
          socials[0]
        )
      )
    }

    // Remove any hide belonging to a (now-)member so the app reappears for them. System-attributed remove.
    for (const acc of members) {
      for (const s of memberSocial[acc] ?? []) {
        const h = existingByCreator.get(s)
        if (h !== undefined) {
          txes.push(control.txFactory.createTxRemoveDoc(h._class, h.space, h._id, undefined, core.account.System))
        }
      }
    }

    if (txes.length > 0) await control.apply(control.ctx, txes)
  } catch (err: any) {
    // Best-effort cosmetic layer: never propagate. The data-privacy guarantee does not depend on this.
    control.ctx.warn('yg-timesheet: reconcileHrHidden failed (cosmetic, ignored)', { error: err?.message ?? String(err) })
  }
}

export async function OnHrMembershipChange (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    const utx = tx as TxUpdateDoc<Space>
    if (utx.objectClass !== core.class.Space) continue
    if (utx.objectId !== ygTimesheet.space.HrData) continue

    // Only react when membership actually changed (ignore unrelated HrData field edits).
    const ops = utx.operations as Record<string, any>
    const touchesMembers =
      ops.members !== undefined || ops.$push?.members !== undefined || ops.$pull?.members !== undefined
    if (!touchesMembers) continue

    // Read post-apply members off the space and reconcile every account's hide against it.
    const hr = (await control.findAll(control.ctx, core.class.Space, { _id: ygTimesheet.space.HrData }, { limit: 1 }))[0]
    if (hr === undefined) continue
    await reconcileHrHidden(control, hr.members ?? [])
  }
  return []
}

// One-shot seeding for existing installs (called once from the Task-8 migration). Hides the HR app for
// all current non-members. Idempotent — safe to run repeatedly.
export async function backfillHrHidden (control: TriggerControl): Promise<void> {
  const hr = (await control.findAll(control.ctx, core.class.Space, { _id: ygTimesheet.space.HrData }, { limit: 1 }))[0]
  await reconcileHrHidden(control, hr?.members ?? [])
}

export default async () => ({
  trigger: { OnTimesheetDayUpdate, OnTimeSpendReportChange, OnHrDataMembershipGuard, OnHrMembershipChange }
})
