//
// YoungGlobes: model-server-yg-hr - trigger registration (Phase 1).
//
// The yg-hr triggers are registered here, in a SERVER-ONLY model package, rather than in
// models/yg-hr. serverCore.class.Trigger is a server-only class: registering Trigger docs in the
// client model (models/yg-hr) orphans them in the browser's model (ancestors not found:
// server-core:class:Trigger), so the workspace fails to load. model-server-yg-timesheet does the
// same for its triggers.
//
import { type Builder } from '@hcengineering/model'
import core from '@hcengineering/core'
import contact from '@hcengineering/contact'
import serverCore from '@hcengineering/server-core'
import ygHr from '@hcengineering/yg-hr'
import serverYgHr from '@hcengineering/server-yg-hr'

export { serverYgHrId } from '@hcengineering/server-yg-hr'

export function createModel (builder: Builder): void {
  // Auto-assign employee id on Employee-mixin creation (server trigger, Task 7). objectClass-only
  // txMatch (same idiom as models/server-yg-timesheet's OnAttendancePunch registration) so it fires
  // on any write to contact.mixin.Employee OR one of its descendant mixins - EmployeePersonal,
  // EmployeeContact, EmployeeJob (and ygTimesheet.mixin.WorkProfile) - all of which are written with
  // objectClass: contact.mixin.Employee (see models/yg-hr/src/migration.ts's updateMixin calls). The
  // trigger itself (server-plugins/yg-hr-resources) is idempotent and loop-safe: it only acts when
  // EmployeePersonal.employeeId is still empty, and its own compensating write is System-authored so
  // the top-of-loop guard there skips it on re-entry.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgHr.trigger.OnEmployeeCreate,
    isAsync: true,
    txMatch: { objectClass: contact.mixin.Employee }
  })

  // Task 8: server-enforced write permissions on the HR mixins + EmergencyContact. Registered as
  // TWO Trigger docs (one txMatch shape per tx kind), both routed to the same OnEmployeeHrGuard
  // function - same "narrow, separate registrations per tx shape" idiom
  // models/server-yg-timesheet uses throughout. See OnEmployeeHrGuard's file-header comment
  // (server-plugins/yg-hr-resources) for the authorization rule and the revert mechanism.
  //
  // Mixin writes: matched on the `mixin` field (NOT objectClass - a TxMixin's objectClass is the
  // underlying Employee doc's class, contact.mixin.Employee, the same for every one of these three
  // mixins as well as ygTimesheet.mixin.WorkProfile; only `mixin` tells them apart - same idiom
  // models/server-yg-timesheet uses for ProjectApprovers: `{ _class: core.class.TxMixin, mixin: ... }`).
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgHr.trigger.OnEmployeeHrGuard,
    isAsync: true,
    txMatch: {
      _class: core.class.TxMixin,
      mixin: { $in: [ygHr.mixin.EmployeePersonal, ygHr.mixin.EmployeeContact, ygHr.mixin.EmployeeJob] }
    }
  })

  // EmergencyContact create/update/remove: a flat CUD tx (this schema version has no separate
  // TxCollectionCUD class - see the guard's own comment), so an objectClass-only match covers all
  // three tx kinds, same as e.g. OnTimeSpendReportChange's registration.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgHr.trigger.OnEmployeeHrGuard,
    isAsync: true,
    txMatch: { objectClass: ygHr.class.EmergencyContact }
  })

  // The four admin-managed HrConfig list classes (Department/Designation/EmploymentStatus/
  // Location, all in ygHr.space.HrConfig) had no server-side write guard - the UI gate on
  // HrLists.svelte does not stop a direct API call, and since HR-status is decided off
  // Designation.isHr, an unguarded Designation write let any member self-elevate
  // (updateDoc(Designation, ..., theirOwnDesignationId, { isHr: true })), after which the mixin/
  // EmergencyContact guards above would treat them as authorized. objectClass `$in` covers all
  // four classes and all three tx kinds in one registration, same idiom as the EmergencyContact
  // match above.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverYgHr.trigger.OnEmployeeHrGuard,
    isAsync: true,
    txMatch: {
      objectClass: {
        $in: [ygHr.class.Department, ygHr.class.Designation, ygHr.class.EmploymentStatus, ygHr.class.Location]
      }
    }
  })
}
