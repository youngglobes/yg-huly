//
// YoungGlobes: yg-hr model.
//
// Task 10 (modern tabbed employee profile, ygHr.component.EmployeeProfile in yg-hr-resources) is
// deliberately NOT registered here as the view.mixin.ObjectEditor for contact.mixin.Employee.
// contact.class.Person already owns that mixin (pinned, models/contact/src/index.ts), and
// EditDoc.svelte resolves the editor off Hierarchy.mixinOrClass(object) - which class wins depends
// on whatever `_class` the CALLER opened the panel with (contact.mixin.Employee vs the base
// contact.class.Person), not on anything this model controls. Overriding it here would apply
// globally to every Employee panel across the whole app - native Contacts "Employees" list, the
// built-in HR module's team view, Recruit's hired-candidate view, AccountBox/Members popups - none
// of which this task audited. Task 11 (the yg-hr directory) instead opens EmployeeProfile directly
// by employee id, sidestepping that blast radius entirely. Revisit registering it here only after
// confirming every _class-passing call site that can reach an Employee panel.
//
import { type Domain, type Ref, type Timestamp } from '@hcengineering/core'
import {
  type Builder,
  Collection,
  Mixin,
  Model,
  Prop,
  TypeBoolean,
  TypeDate,
  TypeNumber,
  TypeRef,
  TypeString,
  UX
} from '@hcengineering/model'
import contact, { TEmployee } from '@hcengineering/model-contact'
import core, { TAttachedDoc, TDoc } from '@hcengineering/model-core'
import serverCore from '@hcengineering/server-core'
import serverYgHr from '@hcengineering/server-yg-hr'
import type {
  Department,
  Designation,
  EmergencyContact,
  EmployeeContact,
  EmployeeJob,
  EmployeePersonal,
  EmployeeSeq,
  EmploymentStatus,
  Gender,
  Location,
  MaritalStatus
} from '@hcengineering/yg-hr'
import ygHr from './plugin'

export { ygHrId } from '@hcengineering/yg-hr'
export { ygHrOperation } from './migration'

export const DOMAIN_YG_HR = 'yg_hr' as Domain

@Model(ygHr.class.Department, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.Department)
export class TDepartment extends TDoc {
  @Prop(TypeString(), ygHr.string.Department) name!: string
}

@Model(ygHr.class.Designation, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.Designation)
export class TDesignation extends TDoc {
  @Prop(TypeString(), ygHr.string.Designation) name!: string
  @Prop(TypeBoolean(), ygHr.string.IsHr) isHr?: boolean
}

@Model(ygHr.class.EmploymentStatus, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.EmploymentStatus)
export class TEmploymentStatus extends TDoc {
  @Prop(TypeString(), ygHr.string.EmploymentStatus) name!: string
}

@Model(ygHr.class.Location, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.Location)
export class TLocation extends TDoc {
  @Prop(TypeString(), ygHr.string.Location) name!: string
}

// Monotonic per-workspace counter for employee ids (single doc, no UX label - internal only).
// Seeded at 24 and incremented atomically by OnEmployeeCreate (server-plugins/yg-hr-resources)
// so the next assigned id continues the YGS series after the existing YGS0024.
@Model(ygHr.class.EmployeeSeq, core.class.Doc, DOMAIN_YG_HR)
export class TEmployeeSeq extends TDoc implements EmployeeSeq {
  @Prop(TypeNumber(), ygHr.string.EmployeeSeqLast) last!: number
}

@Mixin(ygHr.mixin.EmployeePersonal, contact.mixin.Employee)
export class TEmployeePersonal extends TEmployee implements EmployeePersonal {
  @Prop(TypeString(), ygHr.string.MiddleName) middleName?: string
  @Prop(TypeString(), ygHr.string.Gender) gender?: Gender
  @Prop(TypeDate(), ygHr.string.DateOfBirth) dateOfBirth?: Timestamp
  @Prop(TypeString(), ygHr.string.MaritalStatus) maritalStatus?: MaritalStatus
  @Prop(TypeString(), ygHr.string.Nationality) nationality?: string
  @Prop(TypeString(), ygHr.string.BloodGroup) bloodGroup?: string
  @Prop(TypeString(), ygHr.string.EmployeeId) employeeId?: string

  @Prop(Collection(ygHr.class.EmergencyContact), ygHr.string.EmergencyContacts)
    emergencyContacts?: number
}

@Mixin(ygHr.mixin.EmployeeContact, contact.mixin.Employee)
export class TEmployeeContact extends TEmployee implements EmployeeContact {
  @Prop(TypeString(), ygHr.string.Street1) street1?: string
  @Prop(TypeString(), ygHr.string.Street2) street2?: string
  @Prop(TypeString(), ygHr.string.City) addressCity?: string
  @Prop(TypeString(), ygHr.string.State) state?: string
  @Prop(TypeString(), ygHr.string.Zip) zip?: string
  @Prop(TypeString(), ygHr.string.Country) country?: string
  @Prop(TypeString(), ygHr.string.HomePhone) homePhone?: string
  @Prop(TypeString(), ygHr.string.Mobile) mobile?: string
  @Prop(TypeString(), ygHr.string.WorkPhone) workPhone?: string
  @Prop(TypeString(), ygHr.string.OtherEmail) otherEmail?: string
}

@Mixin(ygHr.mixin.EmployeeJob, contact.mixin.Employee)
export class TEmployeeJob extends TEmployee implements EmployeeJob {
  @Prop(TypeRef(ygHr.class.Designation), ygHr.string.Designation) designation?: Ref<Designation>
  @Prop(TypeRef(ygHr.class.Department), ygHr.string.Department) department?: Ref<Department>
  @Prop(TypeRef(ygHr.class.EmploymentStatus), ygHr.string.EmploymentStatus) employmentStatus?: Ref<EmploymentStatus>
  @Prop(TypeDate(), ygHr.string.JoinedDate) joinedDate?: Timestamp
  @Prop(TypeRef(ygHr.class.Location), ygHr.string.Location) location?: Ref<Location>
  @Prop(TypeDate(), ygHr.string.ContractStart) contractStart?: Timestamp
  @Prop(TypeDate(), ygHr.string.ContractEnd) contractEnd?: Timestamp
}

@Model(ygHr.class.EmergencyContact, core.class.AttachedDoc, DOMAIN_YG_HR)
@UX(ygHr.string.EmergencyContact)
export class TEmergencyContact extends TAttachedDoc implements EmergencyContact {
  @Prop(TypeString(), ygHr.string.Name) name!: string
  @Prop(TypeString(), ygHr.string.Relationship) relationship?: string
  @Prop(TypeString(), ygHr.string.HomePhone) homePhone?: string
  @Prop(TypeString(), ygHr.string.Mobile) mobile?: string
  @Prop(TypeString(), ygHr.string.WorkPhone) workPhone?: string
}

export function createModel (builder: Builder): void {
  builder.createModel(
    TDepartment,
    TDesignation,
    TEmploymentStatus,
    TLocation,
    TEmployeePersonal,
    TEmployeeContact,
    TEmployeeJob,
    TEmergencyContact,
    TEmployeeSeq
  )

  // Shared space holding the admin-managed list items (Department / Designation /
  // EmploymentStatus / Location). Not private so every workspace user can read the lists
  // for their profile/dropdowns; not autoJoin since only HR/admins add members via the UI.
  builder.createDoc(
    core.class.Space,
    core.space.Model,
    {
      name: 'HR Configuration',
      description: 'Department / Designation / Employment status / Location',
      private: false,
      archived: false,
      autoJoin: false,
      members: []
    },
    ygHr.space.HrConfig
  )

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
