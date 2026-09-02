//
// YoungGlobes: server-yg-hr-resources - triggers for the yg-hr module.
//
import core, {
  generateId,
  type Tx,
  type TxMixin
} from '@hcengineering/core'
import contact, { type Employee, type Person } from '@hcengineering/contact'
import { type TriggerControl } from '@hcengineering/server-core'
import ygHr, { formatEmployeeId, type EmployeeSeq } from '@hcengineering/yg-hr'

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
// First-run seeding: if no EmployeeSeq doc exists yet, one is created at `last: 24` (so the next
// assigned id is YGS0025, continuing the series after the existing YGS0024) before the $inc. That
// create-if-absent check is NOT itself atomic - a doc-creation race is possible if two employees
// were created in the very same instant on a workspace that has never had one before - but it
// only matters once, at most, per workspace; this accepts the same tradeoff
// server-yg-timesheet-resources' OnAttendancePunch makes for LatePermission's idempotent create.
//
async function nextEmployeeSeq (control: TriggerControl): Promise<number> {
  let seq = (await control.findAll(control.ctx, ygHr.class.EmployeeSeq, {}, { limit: 1 }))[0]

  if (seq === undefined) {
    const objectId = generateId<EmployeeSeq>()
    await control.apply(
      control.ctx,
      [
        control.txFactory.createTxCreateDoc(
          ygHr.class.EmployeeSeq,
          core.space.Workspace,
          { last: 24 },
          objectId,
          Date.now(),
          core.account.System
        )
      ],
      true
    )
    seq = { _id: objectId, space: core.space.Workspace } as EmployeeSeq
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

export default async () => ({
  trigger: {
    OnEmployeeCreate
  }
})
