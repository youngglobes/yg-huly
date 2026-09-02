//
// YoungGlobes: server-yg-hr-resources - triggers for the yg-hr module.
//
import core, {
  AccountRole,
  hasAccountRole,
  TxProcessor,
  type PersonId,
  type Tx,
  type TxCUD,
  type TxMixin
} from '@hcengineering/core'
import contact, { type Employee, type Person } from '@hcengineering/contact'
import { type TriggerControl } from '@hcengineering/server-core'
import { getEmployee } from '@hcengineering/server-contact'
import ygHr, {
  EMPLOYEE_SEQ_ID,
  formatEmployeeId,
  isHrDesignationByFlag,
  type Designation,
  type EmergencyContact,
  type EmployeeSeq
} from '@hcengineering/yg-hr'

//
// Auto-assign the next YGS#### employee id (Task 7). Fires whenever a write touches
// contact.mixin.Employee or a mixin extending it - EmployeePersonal / EmployeeContact /
// EmployeeJob (yg-hr) and WorkProfile (yg-timesheet) are all written with
// objectClass: contact.mixin.Employee (see models/yg-hr/src/migration.ts's updateMixin calls,
// and this trigger's registration comment in models/yg-hr/src/index.ts) - so this single
// objectClass-only txMatch catches every one of those writes, mirroring how
// server-yg-timesheet's OnAttendancePunch is registered (objectClass-only, no `_class` filter).
//
// Idempotent: only assigns when EmployeePersonal.employeeId is still empty, so it is safe to
// fire repeatedly for the same employee (e.g. once on the Employee mixin add, again later when
// EmployeeJob/EmployeeContact get filled in during onboarding).
//
// Loop-safety: the only write this trigger issues is the System-authored updateMixin below,
// which itself carries objectClass: contact.mixin.Employee and therefore matches this trigger's
// own txMatch - it WOULD re-enter without a guard. Skipping any tx already authored by
// core.account.System breaks that loop, matching the idiom in
// server-plugins/yg-timesheet-resources' OnAttendancePunch/OnTimesheetDayUpdate.
//
export async function OnEmployeeCreate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    // Loop-safety guard - see file header. Must stay first.
    if (tx.modifiedBy === core.account.System) continue
    if (tx._class !== core.class.TxMixin) continue

    const mtx = tx as TxMixin<Person, Employee>

    const person = (
      await control.findAll(control.ctx, contact.class.Person, { _id: mtx.objectId }, { limit: 1 })
    )[0]
    if (person === undefined) continue
    if (!control.hierarchy.hasMixin(person, contact.mixin.Employee)) continue

    const personal = control.hierarchy.as(person, ygHr.mixin.EmployeePersonal)
    // Already assigned (by this trigger earlier, or by the migration backfill) - idempotent no-op.
    if (personal.employeeId != null && personal.employeeId !== '') continue

    const next = await nextEmployeeSeq(control)
    const employeeId = formatEmployeeId(next)

    await control.apply(
      control.ctx,
      [
        control.txFactory.createTxMixin(
          person._id,
          contact.mixin.Employee,
          person.space,
          ygHr.mixin.EmployeePersonal,
          { employeeId } as any,
          Date.now(),
          core.account.System
        )
      ]
    )

    control.ctx.info('yg-hr: auto-assigned employee id', { employee: person._id, employeeId })
  }
  return []
}

//
// Atomically bump the single per-workspace EmployeeSeq counter and return the new value.
//
// Atomicity for the steady state (the counter doc already exists): the $inc is issued with
// `retrieve: true` (createTxUpdateDoc's 5th arg) and control.apply's `needResult: true`, which
// routes the write through the SAME synchronous tx-apply path TxOperations.updateDoc(..., true)
// uses client-side (see plugins/tracker-resources/src/utils.ts's sequence $inc for the identical
// pattern) - the incremented value comes back from that one atomic write, never from a separate
// read, so two concurrent employee creates cannot collide on the same id.
//
// The counter always lives at the fixed id EMPLOYEE_SEQ_ID (never a generated one) and is
// pre-seeded there at `last: 24` by the migration (models/yg-hr/src/migration.ts's
// ensureEmployeeSeq), so the first assigned id is YGS0025, continuing the series after the
// existing YGS0024, and there is only ever ONE counter doc for the whole workspace. Reviewed fix:
// an earlier version of this trigger created the counter lazily under a GENERATED id on first use,
// which let two concurrent employee-mixin writes on a fresh workspace each see "no doc", each
// create their OWN singleton, and both $inc to 25 - two employees could get the same YGS0025. A
// fixed id closes that: even the fallback create below (not expected in normal operation, since
// the migration seeds it ahead of time) always targets this same _id, so a concurrent fallback
// create can never diverge into a second counter.
async function nextEmployeeSeq (control: TriggerControl): Promise<number> {
  let seq = (
    await control.findAll(control.ctx, ygHr.class.EmployeeSeq, { _id: EMPLOYEE_SEQ_ID }, { limit: 1 })
  )[0]

  if (seq === undefined) {
    // Fallback only - see the doc comment above. Always the fixed id, never generated.
    await control.apply(
      control.ctx,
      [
        control.txFactory.createTxCreateDoc(
          ygHr.class.EmployeeSeq,
          core.space.Workspace,
          { last: 24 },
          EMPLOYEE_SEQ_ID,
          Date.now(),
          core.account.System
        )
      ],
      true
    )
    seq = { _id: EMPLOYEE_SEQ_ID, space: core.space.Workspace } as EmployeeSeq
  }

  const result = await control.apply(
    control.ctx,
    [
      control.txFactory.createTxUpdateDoc(
        ygHr.class.EmployeeSeq,
        seq.space,
        seq._id,
        { $inc: { last: 1 } } as any,
        true,
        Date.now(),
        core.account.System
      )
    ],
    true
  )

  return ((result as any).object as EmployeeSeq).last
}

//
// Task 8: server-enforced write permissions on the HR mixins + EmergencyContact.
//
// "HR" is a DESIGNATION (Designation.isHr, resolved off the actor's OWN EmployeeJob.designation),
// not an AccountRole - Huly's TxAccessLevel only gates by AccountRole, so it cannot express
// "Owner/Maintainer OR HR-designated" and this has to be a trigger. Authorization mirrors
// OnLatePermissionUpdate in server-plugins/yg-timesheet-resources: Owner/Maintainer/Admin
// (hasAccountRole Maintainer - roleOrder puts Owner and Admin above Maintainer, so this one check
// covers all three break-glass roles) OR the actor's own EmployeeJob.designation is flagged isHr.
// Unlike OnLatePermissionUpdate there is no self-exclusion: an HR-designated actor (or admin) is
// authorized to write ANY employee's record, including their own - that is the intended model
// ("HR maintains the profile", not "you maintain your own").
//
// A person editing only their OWN avatar is NOT a mixin write at all - Person.avatar/avatarType/
// avatarProps live on contact.class.Person itself, a different objectClass entirely - so it never
// reaches this trigger and needs no carve-out here.
//
// Loop-safety: every revert this trigger issues is System-authored (core.account.System), and the
// top-of-loop guard below skips any tx already authored by System, so a revert can never re-enter
// and re-revert itself - same idiom as every other trigger in this file and in
// server-plugins/yg-timesheet-resources.
//

// Own fields of each guarded mixin (Omit<M, keyof Employee> - i.e. exactly what a TxMixin's
// `attributes` can ever contain for that mixin). Reverting the FULL field set (not just whatever
// this tx's operations touched) means a revert is correct regardless of which fields, or which
// operators ($push/$inc/etc, MixinUpdate allows them), the unauthorized tx used - same "restore
// everything" approach OnProjectApproversMixinGuard (above) takes for ProjectApprovers.
const GUARDED_MIXIN_FIELDS: Record<string, readonly string[]> = {
  [ygHr.mixin.EmployeePersonal]: [
    'middleName', 'gender', 'dateOfBirth', 'maritalStatus', 'nationality', 'bloodGroup',
    'employeeId', 'emergencyContacts'
  ],
  [ygHr.mixin.EmployeeContact]: [
    'street1', 'street2', 'addressCity', 'state', 'zip', 'country', 'homePhone', 'mobile',
    'workPhone', 'otherEmail'
  ],
  [ygHr.mixin.EmployeeJob]: [
    'designation', 'department', 'employmentStatus', 'joinedDate', 'location', 'contractStart',
    'contractEnd'
  ]
}

const EMERGENCY_CONTACT_FIELDS = ['name', 'relationship', 'homePhone', 'mobile', 'workPhone'] as const

async function isHrAuthorized (control: TriggerControl, actorId: PersonId): Promise<boolean> {
  if (hasAccountRole(control.ctx.contextData.account, AccountRole.Maintainer)) return true

  const actor = await getEmployee(control, actorId)
  if (actor === undefined) return false

  const job = (
    await control.findAll(control.ctx, ygHr.mixin.EmployeeJob, { _id: actor._id }, { limit: 1 })
  )[0]
  const designation: Designation | undefined =
    job?.designation === undefined
      ? undefined
      : (await control.findAll(control.ctx, ygHr.class.Designation, { _id: job.designation }, { limit: 1 }))[0]

  return isHrDesignationByFlag(designation)
}

// Reverts an unauthorized write to one of the three guarded Employee mixins. Triggers only see
// POST-APPLY state (control.findAll returns the doc with this tx's changes already merged in), so
// the prior state is reconstructed by replaying the object's own tx log EXCLUDING this tx - the
// same TxProcessor.buildDoc2Doc idiom OnProjectApproversMixinGuard (above) uses.
//
// Verified against this codebase's postgres adapter (foundations/server/packages/postgres/src/
// storage.ts, txMixin()): a TxMixin write always fetches the current doc, merges `attributes` into
// it in memory, and rewrites the WHOLE `data` column from that merged object - never a partial
// jsonb merge. That is what makes reverting a field to `undefined` here actually clear it (the
// merged mixin object's key is simply absent when serialized), unlike a plain TxUpdateDoc (see
// guardEmergencyContactWrite below, which needs a different trick for exactly that reason).
async function guardMixinWrite (mtx: TxMixin<Person, Employee>, control: TriggerControl): Promise<void> {
  const fields = GUARDED_MIXIN_FIELDS[mtx.mixin]
  if (fields === undefined) return // not one of the three guarded HR mixins

  if (await isHrAuthorized(control, mtx.modifiedBy)) return

  const logTxes = Array.from(
    await control.findAll(control.ctx, core.class.TxCUD, { objectId: mtx.objectId })
  ).filter((it) => it._id !== mtx._id)
  const prevDoc = TxProcessor.buildDoc2Doc<Person>(logTxes)
  const prevMixin: any =
    prevDoc !== undefined && prevDoc !== null ? control.hierarchy.as(prevDoc, mtx.mixin) : undefined

  const revertAttrs: Record<string, any> = {}
  for (const field of fields) {
    revertAttrs[field] = prevMixin?.[field]
  }

  control.ctx.warn('yg-hr: unauthorized HR mixin write reverted', {
    employee: mtx.objectId, mixin: mtx.mixin, actor: mtx.modifiedBy
  })

  const revert = control.txFactory.createTxMixin(
    mtx.objectId, mtx.objectClass, mtx.objectSpace, mtx.mixin, revertAttrs as any, Date.now(), core.account.System
  )
  await control.apply(control.ctx, [revert])
}

// Reverts an unauthorized create/update/remove of an EmergencyContact. Same authorization rule as
// guardMixinWrite above (no self-exclusion - HR/admin may write anyone's, including their own).
async function guardEmergencyContactWrite (cud: TxCUD<EmergencyContact>, control: TriggerControl): Promise<void> {
  if (await isHrAuthorized(control, cud.modifiedBy)) return

  control.ctx.warn('yg-hr: unauthorized EmergencyContact write reverted', {
    emergencyContact: cud.objectId, actor: cud.modifiedBy, txClass: cud._class
  })

  // Wrap a create/remove the same way TxOperations.addCollection/removeCollection do (attachedTo/
  // attachedToClass/collection carried on the SAME flat tx - this schema version has no separate
  // TxCollectionCUD class, see the TimeSpendReport note above) so the platform's generic
  // collection-count middleware increments/decrements EmployeePersonal.emergencyContacts exactly
  // as it would for a legitimate create/delete.
  const wrap = (base: TxCUD<EmergencyContact>): Tx =>
    cud.attachedTo !== undefined && cud.attachedToClass !== undefined && cud.collection !== undefined
      ? control.txFactory.createTxCollectionCUD(
        cud.attachedToClass, cud.attachedTo, cud.objectSpace, cud.collection, base, Date.now(), core.account.System
      )
      : base

  if (cud._class === core.class.TxCreateDoc) {
    // Unauthorized create: delete it. No prior state to reconstruct.
    const base = control.txFactory.createTxRemoveDoc(
      cud.objectClass, cud.objectSpace, cud.objectId, Date.now(), core.account.System
    )
    await control.apply(control.ctx, [wrap(base)])
    return
  }

  // Update/remove: reconstruct the pre-tx state (see guardMixinWrite for why POST-APPLY state
  // alone is not enough).
  const logTxes = Array.from(
    await control.findAll(control.ctx, core.class.TxCUD, { objectId: cud.objectId })
  ).filter((it) => it._id !== cud._id)
  const prevDoc = TxProcessor.buildDoc2Doc<EmergencyContact>(logTxes)

  if (prevDoc === undefined || prevDoc === null) {
    // An update/remove implies a prior create exists earlier in this object's own tx log - this
    // should never happen. Fail loud rather than guess at a revert.
    control.ctx.error(
      'yg-hr: cannot reconstruct EmergencyContact prior state - unauthorized write NOT reverted',
      { emergencyContact: cud.objectId, actor: cud.modifiedBy, txClass: cud._class }
    )
    return
  }

  if (cud._class === core.class.TxRemoveDoc) {
    // Unauthorized delete: recreate it from the replayed state.
    const { _id, _class, space, modifiedBy, modifiedOn, createdBy, createdOn, ...attrs } = prevDoc as any
    const base = control.txFactory.createTxCreateDoc(
      prevDoc._class, prevDoc.space, attrs, prevDoc._id, Date.now(), core.account.System
    )
    await control.apply(control.ctx, [wrap(base)])
    return
  }

  // Update: restore every own field to its pre-tx value. Split into a plain field-set (safe for
  // concrete values) and a $unset-only tx (for any field whose pre-tx value was itself unset).
  // Verified against the postgres adapter's operator-less update path (updateDoc(), the
  // `data = COALESCE(data || $jsonb)` branch): it merges rather than replaces, and explicitly
  // skips any key whose value is `undefined` - so setting a plain field to `undefined` would
  // silently leave the CURRENT (unauthorized) value in place instead of clearing it. A pure
  // $unset operations object (isOperator() requires every key to start with `$`) takes the OTHER,
  // full-rewrite code path instead (same mechanism guardMixinWrite relies on for TxMixin), which
  // is what actually clears the key.
  const setOps: Record<string, any> = {}
  const unsetOps: Record<string, ''> = {}
  for (const field of EMERGENCY_CONTACT_FIELDS) {
    const val = (prevDoc as any)[field]
    if (val === undefined) unsetOps[field] = ''
    else setOps[field] = val
  }

  const reverts: Tx[] = []
  if (Object.keys(setOps).length > 0) {
    reverts.push(control.txFactory.createTxUpdateDoc(
      cud.objectClass, cud.objectSpace, cud.objectId, setOps as any, false, Date.now(), core.account.System
    ))
  }
  if (Object.keys(unsetOps).length > 0) {
    reverts.push(control.txFactory.createTxUpdateDoc(
      cud.objectClass, cud.objectSpace, cud.objectId, { $unset: unsetOps } as any, false, Date.now(),
      core.account.System
    ))
  }
  if (reverts.length > 0) await control.apply(control.ctx, reverts)
}

export async function OnEmployeeHrGuard (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  for (const tx of txes) {
    // Loop-safety guard - see file header above. Must stay first.
    if (tx.modifiedBy === core.account.System) continue

    if (tx._class === core.class.TxMixin) {
      await guardMixinWrite(tx as TxMixin<Person, Employee>, control)
      continue
    }

    if (
      tx._class === core.class.TxCreateDoc ||
      tx._class === core.class.TxUpdateDoc ||
      tx._class === core.class.TxRemoveDoc
    ) {
      const cud = tx as TxCUD<EmergencyContact>
      if (cud.objectClass !== ygHr.class.EmergencyContact) continue
      await guardEmergencyContactWrite(cud, control)
    }
  }
  return []
}

export default async () => ({
  trigger: {
    OnEmployeeCreate,
    OnEmployeeHrGuard
  }
})
