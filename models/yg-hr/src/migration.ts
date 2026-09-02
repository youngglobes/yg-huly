//
// YoungGlobes: yg-hr migrations - seed the admin-managed lists, migrate WorkProfile data into
// the new Personal/Job mixins, flag the HR Executive designation.
//
import { TxOperations, type Class, type Data, type Ref } from '@hcengineering/core'
import {
  tryUpgrade,
  type MigrateMode,
  type MigrateOperation,
  type MigrationClient,
  type MigrationUpgradeClient
} from '@hcengineering/model'
import core from '@hcengineering/model-core'
import contact from '@hcengineering/contact'
import ygTimesheet, { type WorkDepartment, type WorkDesignation } from '@hcengineering/yg-timesheet'
import ygHr, {
  ygHrId,
  HR_DESIGNATION_FALLBACK,
  type Department,
  type Designation,
  type EmploymentStatus,
  type Location,
  type HrListItem
} from '@hcengineering/yg-hr'

// Same ~24 titles as the ygTimesheet.WorkDesignation union (plugins/yg-timesheet/src/index.ts) -
// the admin-managed Designation list is seeded from these so existing WorkProfile data resolves
// to a matching list doc.
const DESIGNATIONS: WorkDesignation[] = [
  'Software Engineer Trainee', 'Associate Software Engineer', 'Senior Software Engineer',
  'Team Leader', 'Project Manager', 'Software Test Engineer', 'Senior Software Tester',
  'Web Designer', 'Front End Developer', 'Senior Front End Developer',
  'SEO Analyst Trainee', 'SEO Analyst', 'Senior SEO Analyst',
  'Business Development Executive', 'Senior Business Development Executive',
  'Business Development Manager', 'Salesforce Developer', 'Senior Salesforce Developer',
  'Lead Generation Executive', 'CEO', 'CTO', 'COO', 'HR Executive', 'Intern'
]

// Same 5 values as the ygTimesheet.WorkDepartment union.
const DEPARTMENTS: WorkDepartment[] = ['Development', 'Testing', 'SEO', 'Sales', 'HR']

// yg-hr has no existing enum for these - seeded with the values agreed in the phase-1 brief.
const EMPLOYMENT_STATUSES = ['Full Time', 'Part Time', 'Freelancer', 'Intern']
const LOCATIONS = ['Young Globes - Coimbatore']

// Seed one admin-managed list (Department/Designation/EmploymentStatus/Location) into HrConfig,
// keyed by `name`. Idempotent: skips any name already present, so it is safe to re-run.
async function seedNames<T extends HrListItem> (
  ops: TxOperations,
  _class: Ref<Class<T>>,
  names: readonly string[]
): Promise<void> {
  const existing = new Set((await ops.findAll(_class, {})).map((d) => d.name))
  for (const name of names) {
    if (existing.has(name)) continue // idempotent, keyed by name
    await ops.createDoc(_class, ygHr.space.HrConfig, { name } as Data<T>)
  }
}

// Mark the seeded 'HR Executive' Designation as the flag-based HR-staff marker (isHrDesignationByFlag
// reads this). Idempotent: no-op once already flagged.
async function flagHrExecutiveDesignation (ops: TxOperations): Promise<void> {
  const doc = await ops.findOne(ygHr.class.Designation, { name: HR_DESIGNATION_FALLBACK })
  if (doc === undefined || doc.isHr === true) return // idempotent: nothing to flag, or already flagged
  await ops.updateDoc(ygHr.class.Designation, doc.space, doc._id, { isHr: true })
}

// For each Person carrying ygTimesheet.mixin.WorkProfile, copy its designation/department/employeeId
// into the new EmployeeJob/EmployeePersonal mixins, resolving designation/department to the matching
// seeded list doc by name. Read-only on WorkProfile - never touches it (shiftStart and the rest of
// WorkProfile must survive intact; attendance and late-permission code still read WorkProfile
// directly). Idempotent: skips a field that already has a value on the target mixin, so re-running
// never clobbers a manual edit made after a previous migration run.
async function migrateWorkProfiles (ops: TxOperations): Promise<void> {
  const h = ops.getHierarchy()
  const profiles = await ops.findAll(ygTimesheet.mixin.WorkProfile, {})
  if (profiles.length === 0) return

  const designationByName = new Map<string, Ref<Designation>>(
    (await ops.findAll(ygHr.class.Designation, {})).map((d) => [d.name, d._id])
  )
  const departmentByName = new Map<string, Ref<Department>>(
    (await ops.findAll(ygHr.class.Department, {})).map((d) => [d.name, d._id])
  )

  for (const profile of profiles) {
    const job = h.hasMixin(profile, ygHr.mixin.EmployeeJob) ? h.as(profile, ygHr.mixin.EmployeeJob) : undefined
    const jobUpdate: { designation?: Ref<Designation>, department?: Ref<Department> } = {}
    if (job?.designation === undefined && profile.designation !== undefined) {
      const ref = designationByName.get(profile.designation)
      if (ref !== undefined) jobUpdate.designation = ref
    }
    if (job?.department === undefined && profile.department !== undefined) {
      const ref = departmentByName.get(profile.department)
      if (ref !== undefined) jobUpdate.department = ref
    }
    if (Object.keys(jobUpdate).length > 0) {
      await ops.updateMixin(profile._id, contact.mixin.Employee, profile.space, ygHr.mixin.EmployeeJob, jobUpdate)
    }

    const personal = h.hasMixin(profile, ygHr.mixin.EmployeePersonal)
      ? h.as(profile, ygHr.mixin.EmployeePersonal)
      : undefined
    if (personal?.employeeId === undefined && profile.employeeId !== undefined && profile.employeeId !== '') {
      await ops.updateMixin(profile._id, contact.mixin.Employee, profile.space, ygHr.mixin.EmployeePersonal, {
        employeeId: profile.employeeId
      })
    }
  }
}

async function migrateYgHr (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await seedNames<Designation>(ops, ygHr.class.Designation, DESIGNATIONS)
  await seedNames<Department>(ops, ygHr.class.Department, DEPARTMENTS)
  await seedNames<EmploymentStatus>(ops, ygHr.class.EmploymentStatus, EMPLOYMENT_STATUSES)
  await seedNames<Location>(ops, ygHr.class.Location, LOCATIONS)
  await flagHrExecutiveDesignation(ops)
  await migrateWorkProfiles(ops)
}

export const ygHrOperation: MigrateOperation = {
  async migrate (client: MigrationClient, mode: MigrateMode): Promise<void> {},
  async upgrade (
    state: Map<string, Set<string>>,
    client: () => Promise<MigrationUpgradeClient>,
    mode: MigrateMode
  ): Promise<void> {
    await tryUpgrade(mode, state, client, ygHrId, [
      {
        // Seed the four admin-managed lists, flag 'HR Executive', and migrate each WorkProfile's
        // designation/department/employeeId into the new EmployeeJob/EmployeePersonal mixins.
        state: 'seed-lists-and-migrate-workprofile-0001',
        func: migrateYgHr
      }
    ])
  }
}
