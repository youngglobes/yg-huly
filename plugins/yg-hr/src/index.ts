//
// YoungGlobes: yg-hr plugin ids.
//
import type { AttachedDoc, Class, Doc, Mixin, Ref, Space, Timestamp } from '@hcengineering/core'
import type { Employee } from '@hcengineering/contact'
import type { IntlString, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'

export type Gender = 'male' | 'female' | 'other'
export type MaritalStatus = 'single' | 'married' | 'other'

// Admin-managed list item (Department / Designation / EmploymentStatus / Location)
export interface HrListItem extends Doc {
  name: string
}

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

export const ygHrId = 'yg-hr' as Plugin

export default plugin(ygHrId, {
  class: {
    Department: '' as Ref<Class<HrListItem>>,
    Designation: '' as Ref<Class<Designation>>,
    EmploymentStatus: '' as Ref<Class<HrListItem>>,
    Location: '' as Ref<Class<HrListItem>>,
    EmergencyContact: '' as Ref<Class<EmergencyContact>>,
    EmployeeSeq: '' as Ref<Class<EmployeeSeq>>
  },
  mixin: {
    EmployeePersonal: '' as Ref<Mixin<Employee>>,
    EmployeeContact: '' as Ref<Mixin<Employee>>,
    EmployeeJob: '' as Ref<Mixin<Employee>>
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
