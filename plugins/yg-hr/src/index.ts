//
// YoungGlobes: yg-hr plugin ids.
//
import type { Employee } from '@hcengineering/contact'
import type { AttachedDoc, Class, Doc, Mixin, Ref, Space, Timestamp } from '@hcengineering/core'
import type { IntlString, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'

export type Gender = 'male' | 'female' | 'other'
export type MaritalStatus = 'single' | 'married' | 'other'

// Employee lifecycle state (distinct from the EmploymentStatus list, which is the contract type -
// Full Time / Part Time / ...). Only 'active' people appear in the regular directory and assignee
// pickers; every other state is hidden there.
//  - 'pending'     created but has not logged in yet (system default on create; auto-flips to
//                  'active' on their first login - see SelfActivate.svelte). Whether an invite has
//                  been sent is shown by the Send/Resend button, NOT the status.
//  - 'active'      logged in and working.
//  - 'onhold'      an active employee temporarily away (on leave, will rejoin).
//  - 'deactivated' ex-employee; additionally has their workspace membership removed server-side so
//                  they cannot log in (Person record + work history untouched - OnEmployeeStatusChange).
export type EmployeeStatus = 'pending' | 'active' | 'onhold' | 'deactivated'

// Admin-managed list item (Department / Designation / EmploymentStatus / Location)
export interface HrListItem extends Doc {
  name: string
}

// Department, EmploymentStatus and Location carry no fields beyond HrListItem's; named aliases
// keep the class-ref keys and the interfaces they point at readable by the same name.
export type Department = HrListItem
export type EmploymentStatus = HrListItem
export type Location = HrListItem
export type TerminationReason = HrListItem

export interface Designation extends HrListItem {
  isHr?: boolean
}

export interface EmergencyContact extends AttachedDoc {
  name: string
  relationship?: string
  homePhone?: string
  mobile?: string
  workPhone?: string
}

export type LanguageFluency = 'speaking' | 'writing' | 'reading'
export type LanguageCompetency = 'poor' | 'basic' | 'good' | 'mothertongue'

export type EducationLevel = HrListItem
export type SkillType = HrListItem
export type LanguageType = HrListItem
export type LicenseType = HrListItem

export interface WorkExperience extends AttachedDoc {
  employer?: string
  jobTitle?: string
  fromDate?: Timestamp
  toDate?: Timestamp
  comments?: string
}
export interface Education extends AttachedDoc {
  level?: Ref<EducationLevel>
  institute?: string
  major?: string
  year?: number
  score?: string
  startDate?: Timestamp
  endDate?: Timestamp
}
export interface EmployeeSkill extends AttachedDoc {
  skill?: Ref<SkillType>
  yearsOfExperience?: number
  comments?: string
}
export interface EmployeeLanguage extends AttachedDoc {
  language?: Ref<LanguageType>
  fluency?: LanguageFluency
  competency?: LanguageCompetency
  comments?: string
}
export interface EmployeeLicense extends AttachedDoc {
  licenseType?: Ref<LicenseType>
  licenseNo?: string
  issuedDate?: Timestamp
  expiryDate?: Timestamp
}

// Monotonic per-workspace counter for employee ids (single doc).
export interface EmployeeSeq extends Doc {
  last: number
}

// Fixed, well-known id for the single EmployeeSeq counter doc, so it can never diverge into two
// competing counters (a race between concurrent creates keyed off a generated id could otherwise
// produce two singletons, each independently counting - and duplicate YGS#### ids). Seeded at
// migration time (models/yg-hr/src/migration.ts) and read/created by this fixed id in the
// OnEmployeeCreate trigger (server-plugins/yg-hr-resources).
export const EMPLOYEE_SEQ_ID = 'yg-hr-employee-seq' as Ref<EmployeeSeq>

export interface EmployeePersonal extends Employee {
  middleName?: string
  gender?: Gender
  dateOfBirth?: Timestamp
  maritalStatus?: MaritalStatus
  nationality?: string
  bloodGroup?: string
  employeeId?: string
  nickname?: string
  otherId?: string
  driverLicenseNo?: string
  driverLicenseExpiry?: Timestamp
  status?: EmployeeStatus
  emergencyContacts?: number
  workExperience?: number
  educations?: number
  skills?: number
  languages?: number
  licenses?: number
}

export interface EmployeeContact extends Employee {
  street1?: string
  street2?: string
  addressCity?: string
  state?: string
  zip?: string
  country?: string
  homePhone?: string
  mobile?: string
  workPhone?: string
  otherEmail?: string
}

export interface EmployeeJob extends Employee {
  designation?: Ref<Designation>
  department?: Ref<Department>
  employmentStatus?: Ref<EmploymentStatus>
  joinedDate?: Timestamp
  location?: Ref<Location>
  contractStart?: Timestamp
  contractEnd?: Timestamp
  terminationDate?: Timestamp
  terminationReason?: Ref<TerminationReason>
  // Local time-of-day the employee is expected to start, in minutes since midnight (540 = 09:00).
  // Unified here from ygTimesheet.mixin.WorkProfile.shiftStart; a server sync mirrors it back to
  // WorkProfile so the attendance flows read it unchanged (OnEmployeeJobSync, server-plugins/yg-hr-resources).
  shiftStart?: number
}

export const HR_DESIGNATION_FALLBACK = 'HR Executive'

// Designations whose EXACT name drives role logic in the timesheet module (dashboard role routing,
// HR/late-permission detection, leadership project-creation). Those flows compare the designation
// name as a string (=== 'Team Leader', isHrDesignation('HR Executive'), a leadership set), so these
// names must never change. HR Settings makes them read-only and undeletable, and the server guard
// (guardHrConfigWrite) reverts any rename/remove of them. Non-role designations stay freely editable.
export const SYSTEM_DESIGNATIONS: readonly string[] = [
  'Team Leader', 'Project Manager', 'HR Executive', 'CEO', 'CTO', 'COO'
]

export function isSystemDesignation (name: string | undefined): boolean {
  return name !== undefined && SYSTEM_DESIGNATIONS.includes(name)
}

export function formatEmployeeId (seq: number, prefix = 'YGS', width = 4): string {
  return `${prefix}${String(seq).padStart(width, '0')}`
}

// Flag-based HR-staff detection: the seeded Designation carrying isHr=true is authoritative;
// the legacy 'HR Executive' name is kept as a fallback so a workspace whose migration has not
// yet flagged a designation (or whose admin renamed it) still resolves correctly. Single source
// of truth for both the yg-hr client and the ygTimesheet.isHrDesignation delegation (see
// plugins/yg-timesheet/src/index.ts).
export function isHrDesignationByFlag (designation?: { isHr?: boolean, name?: string }): boolean {
  if (designation == null) return false
  return designation.isHr === true || designation.name === HR_DESIGNATION_FALLBACK
}

// The native contact.mixin.Employee.active flag derived from our lifecycle status. Only a fully
// 'active' employee is active in the platform sense (shows in assignee pickers, the regular
// directory). Anyone on hold or deactivated is inactive. An employee with no status yet (created
// before this field existed) is treated as active, matching the migration's backfill default.
export function employeeActiveFromStatus (status?: EmployeeStatus): boolean {
  return status === undefined || status === 'active'
}

export const ygHrId = 'yg-hr' as Plugin

export default plugin(ygHrId, {
  class: {
    Department: '' as Ref<Class<Department>>,
    Designation: '' as Ref<Class<Designation>>,
    EmploymentStatus: '' as Ref<Class<EmploymentStatus>>,
    Location: '' as Ref<Class<Location>>,
    TerminationReason: '' as Ref<Class<TerminationReason>>,
    EmergencyContact: '' as Ref<Class<EmergencyContact>>,
    EmployeeSeq: '' as Ref<Class<EmployeeSeq>>,
    WorkExperience: '' as Ref<Class<WorkExperience>>,
    Education: '' as Ref<Class<Education>>,
    EmployeeSkill: '' as Ref<Class<EmployeeSkill>>,
    EmployeeLanguage: '' as Ref<Class<EmployeeLanguage>>,
    EmployeeLicense: '' as Ref<Class<EmployeeLicense>>,
    EducationLevel: '' as Ref<Class<EducationLevel>>,
    SkillType: '' as Ref<Class<SkillType>>,
    LanguageType: '' as Ref<Class<LanguageType>>,
    LicenseType: '' as Ref<Class<LicenseType>>
  },
  mixin: {
    EmployeePersonal: '' as Ref<Mixin<EmployeePersonal>>,
    EmployeeContact: '' as Ref<Mixin<EmployeeContact>>,
    EmployeeJob: '' as Ref<Mixin<EmployeeJob>>
  },
  space: {
    HrConfig: '' as Ref<Space>
  },
  component: {
    HrLists: '' as AnyComponent,
    EmployeeProfile: '' as AnyComponent,
    EmployeeDirectory: '' as AnyComponent,
    SelfActivate: '' as AnyComponent
  },
  string: {
    Personal: '' as IntlString,
    Contact: '' as IntlString,
    Job: '' as IntlString,
    Emergency: '' as IntlString,
    MiddleName: '' as IntlString,
    Gender: '' as IntlString,
    DateOfBirth: '' as IntlString,
    MaritalStatus: '' as IntlString,
    Nationality: '' as IntlString,
    BloodGroup: '' as IntlString,
    EmployeeId: '' as IntlString,
    Nickname: '' as IntlString,
    OtherId: '' as IntlString,
    DriverLicenseNo: '' as IntlString,
    DriverLicenseExpiry: '' as IntlString,
    Street1: '' as IntlString,
    Street2: '' as IntlString,
    City: '' as IntlString,
    State: '' as IntlString,
    Zip: '' as IntlString,
    Country: '' as IntlString,
    HomePhone: '' as IntlString,
    Mobile: '' as IntlString,
    WorkPhone: '' as IntlString,
    WorkEmail: '' as IntlString,
    OtherEmail: '' as IntlString,
    Designation: '' as IntlString,
    Department: '' as IntlString,
    EmploymentStatus: '' as IntlString,
    JoinedDate: '' as IntlString,
    Location: '' as IntlString,
    ShiftStart: '' as IntlString,
    ContractStart: '' as IntlString,
    ContractEnd: '' as IntlString,
    Termination: '' as IntlString,
    TerminationDate: '' as IntlString,
    TerminationReason: '' as IntlString,
    TerminationReasons: '' as IntlString,
    EmployeeSeqLast: '' as IntlString,
    Relationship: '' as IntlString,
    Departments: '' as IntlString,
    Designations: '' as IntlString,
    EmergencyContacts: '' as IntlString,
    AddEmergencyContact: '' as IntlString,
    Employees: '' as IntlString,
    EmployeeDirectory: '' as IntlString,
    EditProfile: '' as IntlString,
    Name: '' as IntlString,
    EmergencyContact: '' as IntlString,
    IsHr: '' as IntlString,
    HrSettings: '' as IntlString,
    HrSettingsIntro: '' as IntlString,
    EmploymentStatuses: '' as IntlString,
    Locations: '' as IntlString,
    AddItem: '' as IntlString,
    NoItemsYet: '' as IntlString,
    RemoveItem: '' as IntlString,
    SystemDesignationHint: '' as IntlString,
    HrSettingsRestricted: '' as IntlString,
    NotSet: '' as IntlString,
    OpenEnded: '' as IntlString,
    Active: '' as IntlString,
    Inactive: '' as IntlString,
    FromLogin: '' as IntlString,
    Edit: '' as IntlString,
    Done: '' as IntlString,
    Identity: '' as IntlString,
    Details: '' as IntlString,
    Address: '' as IntlString,
    Reach: '' as IntlString,
    Role: '' as IntlString,
    Dates: '' as IntlString,
    FirstName: '' as IntlString,
    LastName: '' as IntlString,
    Save: '' as IntlString,
    Cancel: '' as IntlString,
    AddEmployee: '' as IntlString,
    SearchEmployeesPlaceholder: '' as IntlString,
    AllDepartments: '' as IntlString,
    DirectoryNote: '' as IntlString,
    EmployeeColumn: '' as IntlString,
    StatusColumn: '' as IntlString,
    Status: '' as IntlString,
    StatusPending: '' as IntlString,
    StatusActive: '' as IntlString,
    StatusOnHold: '' as IntlString,
    StatusDeactivated: '' as IntlString,
    AllStatuses: '' as IntlString,
    SendInvitation: '' as IntlString,
    ResendInvitation: '' as IntlString,
    InvitationSent: '' as IntlString,
    EmployeeCreated: '' as IntlString,
    CreateEmployeeTitle: '' as IntlString,
    CreateEmployeeIntro: '' as IntlString,
    CreateAndReturn: '' as IntlString,
    Creating: '' as IntlString,
    Qualifications: '' as IntlString,
    WorkExperience: '' as IntlString,
    Educations: '' as IntlString,
    Skills: '' as IntlString,
    Languages: '' as IntlString,
    Licenses: '' as IntlString,
    Employer: '' as IntlString,
    JobTitle: '' as IntlString,
    FromDate: '' as IntlString,
    ToDate: '' as IntlString,
    Comments: '' as IntlString,
    Level: '' as IntlString,
    Institute: '' as IntlString,
    Major: '' as IntlString,
    Year: '' as IntlString,
    Score: '' as IntlString,
    StartDate: '' as IntlString,
    EndDate: '' as IntlString,
    Skill: '' as IntlString,
    YearsOfExperience: '' as IntlString,
    Language: '' as IntlString,
    Fluency: '' as IntlString,
    Competency: '' as IntlString,
    LicenseType: '' as IntlString,
    LicenseNo: '' as IntlString,
    IssuedDate: '' as IntlString,
    ExpiryDate: '' as IntlString,
    EducationLevels: '' as IntlString,
    SkillTypes: '' as IntlString,
    LanguageTypes: '' as IntlString,
    LicenseTypes: '' as IntlString,
    FluencySpeaking: '' as IntlString,
    FluencyWriting: '' as IntlString,
    FluencyReading: '' as IntlString,
    CompetencyPoor: '' as IntlString,
    CompetencyBasic: '' as IntlString,
    CompetencyGood: '' as IntlString,
    CompetencyMotherTongue: '' as IntlString
  }
})
