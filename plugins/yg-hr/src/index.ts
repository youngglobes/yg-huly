//
// YoungGlobes: yg-hr plugin ids.
//
import type { Employee } from '@hcengineering/contact'
import type { AttachedDoc, Class, Doc, Mixin, Ref, Space, Timestamp } from '@hcengineering/core'
import type { IntlString, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'

export type Gender = 'male' | 'female' | 'other'
export type MaritalStatus = 'single' | 'married' | 'other'

// Admin-managed list item (Department / Designation / EmploymentStatus / Location)
export interface HrListItem extends Doc {
  name: string
}

// Department, EmploymentStatus and Location carry no fields beyond HrListItem's; named aliases
// keep the class-ref keys and the interfaces they point at readable by the same name.
export type Department = HrListItem
export type EmploymentStatus = HrListItem
export type Location = HrListItem

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

// Monotonic per-workspace counter for employee ids (single doc).
export interface EmployeeSeq extends Doc {
  last: number
}

export interface EmployeePersonal extends Employee {
  middleName?: string
  gender?: Gender
  dateOfBirth?: Timestamp
  maritalStatus?: MaritalStatus
  nationality?: string
  bloodGroup?: string
  employeeId?: string
  emergencyContacts?: number
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
}

export const HR_DESIGNATION_FALLBACK = 'HR Executive'

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

export const ygHrId = 'yg-hr' as Plugin

export default plugin(ygHrId, {
  class: {
    Department: '' as Ref<Class<Department>>,
    Designation: '' as Ref<Class<Designation>>,
    EmploymentStatus: '' as Ref<Class<EmploymentStatus>>,
    Location: '' as Ref<Class<Location>>,
    EmergencyContact: '' as Ref<Class<EmergencyContact>>,
    EmployeeSeq: '' as Ref<Class<EmployeeSeq>>
  },
  mixin: {
    EmployeePersonal: '' as Ref<Mixin<EmployeePersonal>>,
    EmployeeContact: '' as Ref<Mixin<EmployeeContact>>,
    EmployeeJob: '' as Ref<Mixin<EmployeeJob>>
  },
  space: {
    HrConfig: '' as Ref<Space>
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
    ContractStart: '' as IntlString,
    ContractEnd: '' as IntlString,
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
    IsHr: '' as IntlString
  }
})
