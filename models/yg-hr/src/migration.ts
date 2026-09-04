//
// YoungGlobes: yg-hr migrations - seed the admin-managed lists, migrate WorkProfile data into
// the new Personal/Job mixins, flag the HR Executive designation.
//
import { AccountRole, TxOperations, type Class, type Data, type Ref } from '@hcengineering/core'
import {
  tryUpgrade,
  type MigrateMode,
  type MigrateOperation,
  type MigrationClient,
  type MigrationUpgradeClient
} from '@hcengineering/model'
import core from '@hcengineering/model-core'
import contact from '@hcengineering/contact'
import setting from '@hcengineering/setting'
import workbench from '@hcengineering/model-workbench'
import type { Application } from '@hcengineering/workbench'
import ygTimesheet, { type WorkDepartment, type WorkDesignation } from '@hcengineering/yg-timesheet'
import ygHr, {
  ygHrId,
  HR_DESIGNATION_FALLBACK,
  EMPLOYEE_SEQ_ID,
  type Department,
  type Designation,
  type EducationLevel,
  type EmploymentStatus,
  type Location,
  type HrListItem,
  type LanguageType,
  type LicenseType,
  type TerminationReason
} from '@hcengineering/yg-hr'
import { DOMAIN_YG_HR } from '.'

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

// Seeded from ohrm_emp_termination_reason in the OrangeHRM dump (hr.youngglobe.com). Hyphens are
// intentional (source values), not dashes.
const TERMINATION_REASONS = [
  'Other', 'Retired', 'Contract Not Renewed', 'Resigned', 'Resigned - Company Requested',
  'Resigned - Self Proposed', 'Deceased', 'Physically Disabled/Compensated', 'Laid-off', 'Dismissed'
]

// Seeded from ohrm_education / ohrm_language / ohrm_license in the OrangeHRM dump. Hyphens intentional.
const EDUCATION_LEVELS = ['UG - Under Graduate', 'PG - Post Graduate', 'Diploma', 'SSLC', 'HSC']
const LANGUAGE_TYPES = ['English', 'Tamil', 'Malayalam']
const LICENSE_TYPES = ['Driving License']
// SkillType is intentionally NOT seeded (HR populates it).

// The admin lists live in core.space.Workspace (a mainSpace), NOT a custom space. The server's
// SpaceSecurityMiddleware IGNORES public spaces for data-domain reads (spaceSecurity.ts: a public
// space grants read of its own space-doc, but a member-less public space grants no read of the DATA
// docs inside it), so the four lists in the old memberless HrConfig space came back empty for every
// user ("No items yet"). core.space.Workspace is unconditionally in every account's allowed set for
// data reads (it is a mainSpace), so the lists are readable by all. moveListsToWorkspace (below,
// MIGRATE phase) relocates any rows an earlier migration seeded into HrConfig.
const HR_LIST_SPACE = core.space.Workspace

// Seed one admin-managed list (Department/Designation/EmploymentStatus/Location), keyed by `name`.
// Idempotent: skips any name already present, so it is safe to re-run.
async function seedNames<T extends HrListItem> (
  ops: TxOperations,
  _class: Ref<Class<T>>,
  names: readonly string[]
): Promise<void> {
  const existing = new Set((await ops.findAll(_class, {})).map((d) => d.name))
  for (const name of names) {
    if (existing.has(name)) continue // idempotent, keyed by name
    await ops.createDoc(_class, HR_LIST_SPACE, { name } as Data<T>)
  }
}

// Mark the seeded 'HR Executive' Designation as the flag-based HR-staff marker (isHrDesignationByFlag
// reads this). Idempotent: no-op once already flagged.
async function flagHrExecutiveDesignation (ops: TxOperations): Promise<void> {
  const doc = await ops.findOne(ygHr.class.Designation, { name: HR_DESIGNATION_FALLBACK })
  if (doc === undefined || doc.isHr === true) return // idempotent: nothing to flag, or already flagged
  await ops.updateDoc(ygHr.class.Designation, doc.space, doc._id, { isHr: true })
}

// For each Person carrying ygTimesheet.mixin.WorkProfile, copy its designation/department/employeeId/
// shiftStart into the new EmployeeJob/EmployeePersonal mixins, resolving designation/department to
// the matching seeded list doc by name. Read-only on WorkProfile - never writes it here (a runtime
// sync trigger, OnEmployeeJobSync, keeps WorkProfile mirrored FROM EmployeeJob going forward so the
// attendance/role flows read it unchanged). Idempotent: skips a field that already has a value on the
// target mixin, so re-running never clobbers a manual edit made after a previous migration run.
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
    const jobUpdate: { designation?: Ref<Designation>, department?: Ref<Department>, shiftStart?: number } = {}
    if (job?.designation === undefined && profile.designation !== undefined) {
      const ref = designationByName.get(profile.designation)
      if (ref !== undefined) jobUpdate.designation = ref
    }
    if (job?.department === undefined && profile.department !== undefined) {
      const ref = departmentByName.get(profile.department)
      if (ref !== undefined) jobUpdate.department = ref
    }
    if (job?.shiftStart === undefined && profile.shiftStart !== undefined) {
      jobUpdate.shiftStart = profile.shiftStart
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

// Trailing-digits shape of a YGS-series employee id, e.g. 'YGS0024' -> 24. Ids that don't match
// (blank, hand-entered, or from some other series) are ignored by maxEmployeeIdSuffix below.
const EMPLOYEE_ID_SUFFIX = /^YGS(\d+)$/

// Highest numeric suffix across the given employee ids, or `undefined` if none match the YGS####
// shape. Used to seed EmployeeSeq at a value that can never collide with an id migrateWorkProfiles
// already copied in - hardcoding this (the previous `last: 24`) only worked for a workspace whose
// highest existing id happened to be YGS0024; any workspace with a higher id would let
// OnEmployeeCreate mint a duplicate on the next new hire.
function maxEmployeeIdSuffix (ids: Iterable<string>): number | undefined {
  let max: number | undefined
  for (const id of ids) {
    const m = EMPLOYEE_ID_SUFFIX.exec(id)
    if (m === null) continue
    const n = Number.parseInt(m[1], 10)
    if (max === undefined || n > max) max = n
  }
  return max
}

// Pre-seed the single EmployeeSeq counter doc at its fixed id (EMPLOYEE_SEQ_ID), so the first id
// the OnEmployeeCreate trigger (server-plugins/yg-hr-resources) ever assigns continues the series
// after the highest existing employee id, whatever that happens to be in this workspace. Reads
// EmployeePersonal.employeeId - migrateWorkProfiles (which runs first in migrateYgHr, immediately
// before this) has already copied every WorkProfile.employeeId into that mixin, so the mixin is
// the complete, already-resolved source at this point. Seed is the max parsed suffix across all
// employees, falling back to 24 (the prior hardcoded floor) if none match the YGS#### shape, so
// the first new hire is never assigned below YGS0025. Runs before any employee can be created
// against this workspace, so the counter always exists at one well-known _id and can never
// diverge into two competing counters (which would let two employees get the same id - see the
// trigger's own fixed-id fallback for the same reasoning). Idempotent: no-op if already seeded -
// the doc may already have advanced past this seed, so an existing doc is never overwritten.
async function ensureEmployeeSeq (ops: TxOperations): Promise<void> {
  const existing = await ops.findOne(ygHr.class.EmployeeSeq, { _id: EMPLOYEE_SEQ_ID })
  if (existing !== undefined) return
  const h = ops.getHierarchy()
  const employees = await ops.findAll(contact.mixin.Employee, {})
  const ids: string[] = []
  for (const emp of employees) {
    if (!h.hasMixin(emp, ygHr.mixin.EmployeePersonal)) continue
    const id = h.as(emp, ygHr.mixin.EmployeePersonal).employeeId
    if (id !== undefined && id !== '') ids.push(id)
  }
  const seed = maxEmployeeIdSuffix(ids) ?? 24
  await ops.createDoc(ygHr.class.EmployeeSeq, core.space.Workspace, { last: seed }, EMPLOYEE_SEQ_ID)
}

// Add the "HR Settings" special (Task 9) to the existing Human Resource app's navigator model.
// The app doc itself is created by models/yg-timesheet's createModel (builder.createDoc), and the
// Builder has no updateDoc for extending an already-committed array - only a TxOperations client
// (this migration) can append to navigatorModel.specials, same idiom as setHrAppIcon /
// hideStockHrApp (models/yg-timesheet/src/migration.ts). Best-effort: never fail the workspace
// provision if the app doc is missing or the update doesn't stick on some backend.
//
// accessLevel: DocGuest, same as every other special in this app (Overview, Timesheets,
// Team Profiles, ...) - the app itself is already hidden from non-HR/non-owner accounts (see
// models/yg-timesheet/src/index.ts's OnHrMembershipChange-driven HiddenApplication trigger), so
// DocGuest here just means "visible to whoever can already see the app". The finer HR-or-Maintainer
// gate (and the edit surface itself) lives in HrLists.svelte, same caveat as HrLatePermissions.
async function addHrSettingsSpecial (ops: TxOperations): Promise<void> {
  try {
    // ygTimesheet.app.HumanResource is typed as the widened `Ref<Doc>` (plugins/yg-timesheet/src/
    // index.ts), not `Ref<Application>`, so it needs an explicit cast here to keep findOne/updateDoc
    // inferring T = Application instead of falling back to their shared Doc supertype.
    const appId = ygTimesheet.app.HumanResource as Ref<Application>
    const app = await ops.findOne(workbench.class.Application, { _id: appId })
    if (app === undefined) return
    const specials = app.navigatorModel?.specials ?? []
    if (specials.some((s) => s.id === 'hr-settings')) return // idempotent
    await ops.updateDoc<Application>(workbench.class.Application, core.space.Model, appId, {
      navigatorModel: {
        spaces: app.navigatorModel?.spaces ?? [],
        groups: app.navigatorModel?.groups,
        hideStarred: app.navigatorModel?.hideStarred,
        specials: [
          ...specials,
          {
            id: 'hr-settings',
            label: ygHr.string.HrSettings,
            icon: setting.icon.Setting,
            component: ygHr.component.HrLists,
            accessLevel: AccountRole.DocGuest,
            position: 'bottom'
          }
        ]
      }
    })
  } catch (err) {
    console.error('yg-hr: could not add HR Settings nav special (non-fatal)', err)
  }
}

// Add the "Employees" special (Task 11) to the Human Resource app's navigator model - the
// directory landing page. Same idiom as addHrSettingsSpecial above: only a TxOperations client
// can append to an already-committed navigatorModel.specials array. Placed first (position
// unset, defaults above 'bottom'-pinned specials like HR Settings) so it's the app's default
// landing entry, matching the approved mockup's nav order.
//
// accessLevel: DocGuest, same reasoning as addHrSettingsSpecial - the app itself is already
// hidden from non-HR/non-owner accounts, so DocGuest here just means "visible to whoever can
// already see the app" (i.e. everyone who can see Human Resource, per the brief: "visible to all
// workspace members"). The finer HR-or-admin gate on the Add-employee action lives in
// EmployeeDirectory.svelte itself, same UI-only caveat as HrLists.svelte's edit gate.
async function addEmployeesDirectorySpecial (ops: TxOperations): Promise<void> {
  try {
    const appId = ygTimesheet.app.HumanResource as Ref<Application>
    const app = await ops.findOne(workbench.class.Application, { _id: appId })
    if (app === undefined) return
    const specials = app.navigatorModel?.specials ?? []
    if (specials.some((s) => s.id === 'employees')) return // idempotent
    await ops.updateDoc<Application>(workbench.class.Application, core.space.Model, appId, {
      navigatorModel: {
        spaces: app.navigatorModel?.spaces ?? [],
        groups: app.navigatorModel?.groups,
        hideStarred: app.navigatorModel?.hideStarred,
        specials: [
          {
            id: 'employees',
            label: ygHr.string.Employees,
            icon: contact.icon.Person,
            component: ygHr.component.EmployeeDirectory,
            accessLevel: AccountRole.DocGuest
          },
          ...specials
        ]
      }
    })
  } catch (err) {
    console.error('yg-hr: could not add Employees nav special (non-fatal)', err)
  }
}

// Retire the stock Contacts app's "Employee" kind-list special (Task 12) - the SpecialView that
// renders contact.viewlet.TableEmployee (the EMPLOYEE/WORKER/CUSTOMER/TALENT/UNDEFINED coloured
// role tags, plus Location/Files/Role columns) for contact.mixin.Employee docs with role != GUEST
// (models/contact/src/index.ts, the 'employees' special on contact.app.Contacts). Staff now reach
// employees through the yg-hr "Employees" directory instead (addEmployeesDirectorySpecial above).
// Same idiom as addHrSettingsSpecial/addEmployeesDirectorySpecial: only a TxOperations client can
// rewrite an already-committed navigatorModel.specials array. Removes ONLY the special whose id is
// 'employees' - 'guests', 'persons' and 'companies' (and anything from recruit/lead, which don't
// touch this app doc at all) are left untouched. Best-effort: never fail the workspace upgrade if
// the app doc is missing or the update doesn't stick on some backend.
async function removeContactsEmployeeSpecial (ops: TxOperations): Promise<void> {
  try {
    // contact.app.Contacts is typed as the widened `Ref<Doc>` (plugins/contact/src/index.ts), not
    // `Ref<Application>`, so it needs the same explicit cast used for ygTimesheet.app.HumanResource
    // above to keep findOne/updateDoc inferring T = Application.
    const appId = contact.app.Contacts as Ref<Application>
    const app = await ops.findOne(workbench.class.Application, { _id: appId })
    if (app === undefined) return
    const specials = app.navigatorModel?.specials ?? []
    if (!specials.some((s) => s.id === 'employees')) return // idempotent: already removed
    await ops.updateDoc<Application>(workbench.class.Application, core.space.Model, appId, {
      navigatorModel: {
        spaces: app.navigatorModel?.spaces ?? [],
        groups: app.navigatorModel?.groups,
        hideStarred: app.navigatorModel?.hideStarred,
        specials: specials.filter((s) => s.id !== 'employees')
      }
    })
  } catch (err) {
    console.error('yg-hr: could not remove Contacts Employee nav special (non-fatal)', err)
  }
}

// Its own tryUpgrade state so it also runs on the existing yg workspace, which already completed the
// earlier seed state (tryUpgrade skips a state once recorded done).
async function migrateSeedTerminationReasons (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await seedNames<TerminationReason>(ops, ygHr.class.TerminationReason, TERMINATION_REASONS)
}

async function migrateSeedQualificationLists (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await seedNames<EducationLevel>(ops, ygHr.class.EducationLevel, EDUCATION_LEVELS)
  await seedNames<LanguageType>(ops, ygHr.class.LanguageType, LANGUAGE_TYPES)
  await seedNames<LicenseType>(ops, ygHr.class.LicenseType, LICENSE_TYPES)
}

async function migrateYgHr (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await seedNames<Designation>(ops, ygHr.class.Designation, DESIGNATIONS)
  await seedNames<Department>(ops, ygHr.class.Department, DEPARTMENTS)
  await seedNames<EmploymentStatus>(ops, ygHr.class.EmploymentStatus, EMPLOYMENT_STATUSES)
  await seedNames<Location>(ops, ygHr.class.Location, LOCATIONS)
  await flagHrExecutiveDesignation(ops)
  await migrateWorkProfiles(ops)
  await ensureEmployeeSeq(ops)
}

// Hide the stock Contacts app from the left navigation for EVERY user (user decision: Contacts
// becomes the invisible identity/backing store; people are reached only through the yg-hr
// "Employees" directory). workbench.class.Application carries a `hidden` boolean; flipping it on the
// model doc removes the app from the switcher globally without touching any Person/Employee data.
// Best-effort + idempotent (no-op once already hidden), same cast caveat as the nav helpers above.
async function hideContactsApp (ops: TxOperations): Promise<void> {
  try {
    const appId = contact.app.Contacts as Ref<Application>
    const app = await ops.findOne(workbench.class.Application, { _id: appId })
    if (app === undefined || app.hidden === true) return // idempotent
    await ops.updateDoc<Application>(workbench.class.Application, core.space.Model, appId, { hidden: true })
  } catch (err) {
    console.error('yg-hr: could not hide Contacts app (non-fatal)', err)
  }
}

// Backfill the new EmployeePersonal.status lifecycle field on existing employees. Derived from the
// native contact.mixin.Employee.active flag that already governed visibility: an employee currently
// active:false (e.g. an ex-employee HR already hid, like Melsiya) becomes 'deactivated'; everyone
// else becomes 'active'. On-hold has no historical source, so it is never inferred here - HR sets it
// going forward. Idempotent: skips any employee that already carries a status. Never revokes login
// here (backfill only labels; the OnEmployeeStatusChange trigger only acts on an actual status
// CHANGE), so simply recording an already-inactive ex-employee as 'deactivated' does not evict them.
async function backfillEmployeeStatus (ops: TxOperations): Promise<void> {
  const h = ops.getHierarchy()
  const employees = await ops.findAll(contact.mixin.Employee, {})
  for (const emp of employees) {
    const personal = h.hasMixin(emp, ygHr.mixin.EmployeePersonal) ? h.as(emp, ygHr.mixin.EmployeePersonal) : undefined
    if (personal?.status !== undefined) continue // idempotent
    const status = emp.active === false ? 'deactivated' : 'active'
    await ops.updateMixin(emp._id, contact.mixin.Employee, emp.space, ygHr.mixin.EmployeePersonal, { status })
  }
}

// Relocate any admin-list rows an earlier migration seeded into the old memberless HrConfig space
// into core.space.Workspace, where data-domain reads are actually permitted (see HR_LIST_SPACE).
// Raw MIGRATE-phase domain update (a hoisted `space` column, the same shape yg-timesheet's
// openApprovalsSpaceRaw uses) - a TxOperations.updateDoc cannot move a doc between spaces. Idempotent:
// matches only rows still pointing at HrConfig, so re-running is a no-op once they are moved.
async function moveListsToWorkspace (client: MigrationClient): Promise<void> {
  await client.update(
    DOMAIN_YG_HR,
    { space: ygHr.space.HrConfig },
    { space: core.space.Workspace }
  )
}

// Separate tryUpgrade state (not folded into migrateYgHr above) so it also runs against
// workspaces that already completed the earlier 'seed-lists-and-migrate-workprofile-0001' state -
// tryUpgrade skips a state entirely once recorded done, so a workspace migrated before Task 9
// would otherwise never get the nav special added.
async function migrateHrSettingsNav (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await addHrSettingsSpecial(ops)
}

// Separate tryUpgrade state (Task 11), same reasoning as migrateHrSettingsNav above - so it also
// runs against workspaces that already completed the earlier states.
async function migrateEmployeesDirectoryNav (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await addEmployeesDirectorySpecial(ops)
}

// Separate tryUpgrade state (Task 12), same reasoning as migrateHrSettingsNav /
// migrateEmployeesDirectoryNav above - so it also runs against workspaces that already completed
// the earlier states.
async function migrateRemoveContactsEmployeeNav (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await removeContactsEmployeeSpecial(ops)
}

async function migrateHideContactsApp (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await hideContactsApp(ops)
}

// Remove the "Team Profiles" special (WorkProfileEditor) from the Human Resource app nav - its job
// (designation/department/employeeId/shiftStart) is now the yg-hr employee profile's, and WorkProfile
// is kept in sync server-side (OnEmployeeJobSync). Same idiom as removeContactsEmployeeSpecial:
// only a TxOperations client can rewrite an already-committed navigatorModel.specials. Best-effort +
// idempotent (no-op once the special is gone).
async function removeTeamProfilesSpecial (ops: TxOperations): Promise<void> {
  try {
    const appId = ygTimesheet.app.HumanResource as Ref<Application>
    const app = await ops.findOne(workbench.class.Application, { _id: appId })
    if (app === undefined) return
    const specials = app.navigatorModel?.specials ?? []
    if (!specials.some((s) => s.id === 'team-profiles')) return // idempotent
    await ops.updateDoc<Application>(workbench.class.Application, core.space.Model, appId, {
      navigatorModel: {
        spaces: app.navigatorModel?.spaces ?? [],
        groups: app.navigatorModel?.groups,
        hideStarred: app.navigatorModel?.hideStarred,
        specials: specials.filter((s) => s.id !== 'team-profiles')
      }
    })
  } catch (err) {
    console.error('yg-hr: could not remove Team Profiles nav special (non-fatal)', err)
  }
}

async function migrateRemoveTeamProfilesNav (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await removeTeamProfilesSpecial(ops)
}

async function migrateBackfillEmployeeStatus (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await backfillEmployeeStatus(ops)
}

// Repair: copy WorkProfile.shiftStart into EmployeeJob.shiftStart on workspaces that ran the seed
// state before shiftStart was unified into EmployeeJob. Its own tryUpgrade state so it runs on the
// existing yg workspace (the seed state is skipped once recorded done). Idempotent: skips an
// employee whose EmployeeJob already has a shiftStart.
async function migrateShiftStart (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  const h = ops.getHierarchy()
  const profiles = await ops.findAll(ygTimesheet.mixin.WorkProfile, {})
  for (const profile of profiles) {
    if (profile.shiftStart === undefined) continue
    const job = h.hasMixin(profile, ygHr.mixin.EmployeeJob) ? h.as(profile, ygHr.mixin.EmployeeJob) : undefined
    if (job?.shiftStart !== undefined) continue
    await ops.updateMixin(profile._id, contact.mixin.Employee, profile.space, ygHr.mixin.EmployeeJob, {
      shiftStart: profile.shiftStart
    })
  }
}

export const ygHrOperation: MigrateOperation = {
  async migrate (client: MigrationClient, mode: MigrateMode): Promise<void> {
    // Raw domain relocation of the admin lists out of the old HrConfig space - idempotent, so it
    // runs every upgrade but is a no-op once the rows are in core.space.Workspace.
    await moveListsToWorkspace(client)
  },
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
      },
      {
        // Task 9: add the "HR Settings" special to the Human Resource app nav.
        state: 'add-hr-settings-nav-special-0001',
        func: migrateHrSettingsNav
      },
      {
        // Task 11: add the "Employees" directory special to the Human Resource app nav.
        state: 'add-employees-directory-nav-special-0001',
        func: migrateEmployeesDirectoryNav
      },
      {
        // Task 12: retire the stock Contacts app's "Employee" kind-list special.
        state: 'remove-contacts-employee-nav-special-0001',
        func: migrateRemoveContactsEmployeeNav
      },
      {
        // Hide the whole Contacts app from the nav (Contacts becomes the invisible backing store).
        state: 'hide-contacts-app-0001',
        func: migrateHideContactsApp
      },
      {
        // Backfill EmployeePersonal.status on existing employees (active flag -> active/deactivated).
        state: 'backfill-employee-status-0001',
        func: migrateBackfillEmployeeStatus
      },
      {
        // Unify shiftStart: copy WorkProfile.shiftStart -> EmployeeJob.shiftStart on existing employees.
        state: 'migrate-shiftstart-0001',
        func: migrateShiftStart
      },
      {
        // Remove the Team Profiles special from the HR app nav (unified into the employee profile).
        state: 'remove-team-profiles-nav-0001',
        func: migrateRemoveTeamProfilesNav
      },
      {
        // Seed the TerminationReason admin list (Job tab termination reason).
        state: 'seed-termination-reasons-0001',
        func: migrateSeedTerminationReasons
      },
      {
        // Seed the Qualifications admin lists (EducationLevel / LanguageType / LicenseType; Skills empty).
        state: 'seed-qualification-lists-0001',
        func: migrateSeedQualificationLists
      }
    ])
  }
}
