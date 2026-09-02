//
// YoungGlobes: yg-hr model.
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
  TypeRef,
  TypeString,
  UX
} from '@hcengineering/model'
import contact, { TEmployee } from '@hcengineering/model-contact'
import core, { TAttachedDoc, TDoc } from '@hcengineering/model-core'
import type {
  Department,
  Designation,
  EmergencyContact,
  EmployeeContact,
  EmployeeJob,
  EmployeePersonal,
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
  @Prop(TypeString(), ygHr.string.City) city?: string
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
    TEmergencyContact
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
}
