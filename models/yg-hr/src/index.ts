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
import presentation from '@hcengineering/model-presentation'
import workbench from '@hcengineering/workbench'
import type {
  Department,
  Designation,
  Education,
  EducationLevel,
  EmergencyContact,
  EmployeeContact,
  EmployeeJob,
  EmployeeLanguage,
  EmployeeLicense,
  EmployeePersonal,
  EmployeeSeq,
  EmployeeSkill,
  EmployeeStatus,
  EmploymentStatus,
  Gender,
  Location,
  LanguageCompetency,
  LanguageFluency,
  LanguageType,
  LicenseType,
  MaritalStatus,
  SkillType,
  TerminationReason,
  WorkExperience
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

@Model(ygHr.class.TerminationReason, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.TerminationReason)
export class TTerminationReason extends TDoc {
  @Prop(TypeString(), ygHr.string.TerminationReason) name!: string
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
  @Prop(TypeString(), ygHr.string.Nickname) nickname?: string
  @Prop(TypeString(), ygHr.string.OtherId) otherId?: string
  @Prop(TypeString(), ygHr.string.DriverLicenseNo) driverLicenseNo?: string
  @Prop(TypeDate(), ygHr.string.DriverLicenseExpiry) driverLicenseExpiry?: Timestamp
  @Prop(TypeString(), ygHr.string.Status) status?: EmployeeStatus

  @Prop(Collection(ygHr.class.EmergencyContact), ygHr.string.EmergencyContacts)
    emergencyContacts?: number

  @Prop(Collection(ygHr.class.WorkExperience), ygHr.string.WorkExperience) workExperience?: number
  @Prop(Collection(ygHr.class.Education), ygHr.string.Educations) educations?: number
  @Prop(Collection(ygHr.class.EmployeeSkill), ygHr.string.Skills) skills?: number
  @Prop(Collection(ygHr.class.EmployeeLanguage), ygHr.string.Languages) languages?: number
  @Prop(Collection(ygHr.class.EmployeeLicense), ygHr.string.Licenses) licenses?: number
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
  @Prop(TypeNumber(), ygHr.string.ShiftStart) shiftStart?: number
  @Prop(TypeDate(), ygHr.string.ContractStart) contractStart?: Timestamp
  @Prop(TypeDate(), ygHr.string.ContractEnd) contractEnd?: Timestamp
  @Prop(TypeDate(), ygHr.string.TerminationDate) terminationDate?: Timestamp
  @Prop(TypeRef(ygHr.class.TerminationReason), ygHr.string.TerminationReason) terminationReason?: Ref<TerminationReason>
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

@Model(ygHr.class.EducationLevel, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.Level)
export class TEducationLevel extends TDoc { @Prop(TypeString(), ygHr.string.Level) name!: string }

@Model(ygHr.class.SkillType, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.Skill)
export class TSkillType extends TDoc { @Prop(TypeString(), ygHr.string.Skill) name!: string }

@Model(ygHr.class.LanguageType, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.Language)
export class TLanguageType extends TDoc { @Prop(TypeString(), ygHr.string.Language) name!: string }

@Model(ygHr.class.LicenseType, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.LicenseType)
export class TLicenseType extends TDoc { @Prop(TypeString(), ygHr.string.LicenseType) name!: string }

@Model(ygHr.class.WorkExperience, core.class.AttachedDoc, DOMAIN_YG_HR)
@UX(ygHr.string.WorkExperience)
export class TWorkExperience extends TAttachedDoc implements WorkExperience {
  @Prop(TypeString(), ygHr.string.Employer) employer?: string
  @Prop(TypeString(), ygHr.string.JobTitle) jobTitle?: string
  @Prop(TypeDate(), ygHr.string.FromDate) fromDate?: Timestamp
  @Prop(TypeDate(), ygHr.string.ToDate) toDate?: Timestamp
  @Prop(TypeString(), ygHr.string.Comments) comments?: string
}
@Model(ygHr.class.Education, core.class.AttachedDoc, DOMAIN_YG_HR)
@UX(ygHr.string.Educations)
export class TEducation extends TAttachedDoc implements Education {
  @Prop(TypeRef(ygHr.class.EducationLevel), ygHr.string.Level) level?: Ref<EducationLevel>
  @Prop(TypeString(), ygHr.string.Institute) institute?: string
  @Prop(TypeString(), ygHr.string.Major) major?: string
  @Prop(TypeNumber(), ygHr.string.Year) year?: number
  @Prop(TypeString(), ygHr.string.Score) score?: string
  @Prop(TypeDate(), ygHr.string.StartDate) startDate?: Timestamp
  @Prop(TypeDate(), ygHr.string.EndDate) endDate?: Timestamp
}
@Model(ygHr.class.EmployeeSkill, core.class.AttachedDoc, DOMAIN_YG_HR)
@UX(ygHr.string.Skill)
export class TEmployeeSkill extends TAttachedDoc implements EmployeeSkill {
  @Prop(TypeRef(ygHr.class.SkillType), ygHr.string.Skill) skill?: Ref<SkillType>
  @Prop(TypeNumber(), ygHr.string.YearsOfExperience) yearsOfExperience?: number
  @Prop(TypeString(), ygHr.string.Comments) comments?: string
}
@Model(ygHr.class.EmployeeLanguage, core.class.AttachedDoc, DOMAIN_YG_HR)
@UX(ygHr.string.Language)
export class TEmployeeLanguage extends TAttachedDoc implements EmployeeLanguage {
  @Prop(TypeRef(ygHr.class.LanguageType), ygHr.string.Language) language?: Ref<LanguageType>
  @Prop(TypeString(), ygHr.string.Fluency) fluency?: LanguageFluency
  @Prop(TypeString(), ygHr.string.Competency) competency?: LanguageCompetency
  @Prop(TypeString(), ygHr.string.Comments) comments?: string
}
@Model(ygHr.class.EmployeeLicense, core.class.AttachedDoc, DOMAIN_YG_HR)
@UX(ygHr.string.LicenseType)
export class TEmployeeLicense extends TAttachedDoc implements EmployeeLicense {
  @Prop(TypeRef(ygHr.class.LicenseType), ygHr.string.LicenseType) licenseType?: Ref<LicenseType>
  @Prop(TypeString(), ygHr.string.LicenseNo) licenseNo?: string
  @Prop(TypeDate(), ygHr.string.IssuedDate) issuedDate?: Timestamp
  @Prop(TypeDate(), ygHr.string.ExpiryDate) expiryDate?: Timestamp
}

export function createModel (builder: Builder): void {
  builder.createModel(
    TDepartment,
    TDesignation,
    TEmploymentStatus,
    TLocation,
    TTerminationReason,
    TEmployeePersonal,
    TEmployeeContact,
    TEmployeeJob,
    TEmergencyContact,
    TEmployeeSeq,
    TWorkExperience,
    TEducation,
    TEmployeeSkill,
    TEmployeeLanguage,
    TEmployeeLicense,
    TEducationLevel,
    TSkillType,
    TLanguageType,
    TLicenseType
  )

  // First-login auto-activate: mount SelfActivate on every workbench page (the same global slot
  // presence/love/yg-timesheet use). It flips the current user's employee status from 'pending' to
  // 'active' on their first login. Renders nothing.
  builder.createDoc(presentation.class.ComponentPointExtension, core.space.Model, {
    extension: workbench.extensions.WorkbenchExtensions,
    component: ygHr.component.SelfActivate
  })

  // NOTE: the shared ygHr.space.HrConfig space (which holds the Department / Designation /
  // Employment status / Location list docs) is created in the MIGRATION as a real doc in the
  // DOMAIN_SPACE data table (TxOperations.createDoc into core.space.Space), NOT here as a
  // model-space doc. A space made with builder.createDoc(core.class.Space, core.space.Model, ...)
  // exists only in the in-memory model, never in the space domain the server's
  // SpaceSecurityMiddleware scans at init (it runs findAll(core.class.Space) against DOMAIN_SPACE).
  // Such a space is therefore never registered as public, so every read of its docs is filtered to
  // empty for every user - the "No items yet" bug. Creating it as data in the migration is the same
  // idiom the working yg-timesheet spaces use (models/yg-timesheet/src/migration.ts).
}
