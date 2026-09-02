# YG HR / Employee Module - Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the issue-style Contacts experience for staff with a dedicated, modern HR/Employee module - Phase 1 delivers Personal / Contact / Job sections plus Emergency Contacts, admin-managed Department/Designation lists, a read-only directory, a tabbed modern profile, and server-enforced three-tier permissions.

**Architecture:** A new `yg-hr` package set (plugin / resources / assets / model / server-plugins) mirroring the existing `yg-timesheet` layout. Employee HR data is stored as **mixins** on the existing `contact.mixin.Employee` (single-value sections) plus **child collections** (multi-value sections). Org taxonomy (Department, Designation, EmploymentStatus, Location) are admin-managed list docs in a YG HR settings space. The profile is a custom `ObjectEditor` that replaces the generic doc panel for employees; permissions are enforced by server triggers, not just client gating.

**Tech Stack:** TypeScript, Svelte, Huly platform (`@hcengineering/*`), CockroachDB (workspace domain tables), jest (unit tests for pure logic in `plugins/yg-hr/src`).

**Spec:** `docs/superpowers/specs/2026-09-02-yg-hr-employee-module-design.md`

## Global Constraints

- **Version pin:** `HULY_VERSION=v0.7.426`. All new packages use the same version and toolchain as `yg-timesheet`.
- **No em dashes** (or any long dash) anywhere - code, comments, copy, commits. Use commas, periods, parentheses, colons, or hyphens.
- **TypeScript style:** no semicolons, 2-space indent, single quotes - match the surrounding `yg-timesheet` files exactly.
- **Mixin storage is nested:** mixin attributes live under the namespaced mixin key in the data JSONB. Raw SQL migrations must use the namespaced key; model migrations use `TxOperations` which handles it. See project memory "mixin storage nested".
- **Migrations** are idempotent and run with `new TxOperations(client, core.account.System)` (System bypasses space-security).
- **Server triggers** are System-authored, loop-safe (guard against re-entrancy), and registered in `models/server-yg-hr`. The string `non-retriable` never matches - use `NonRetriable` where relevant (project memory "huly ops restart order").
- **This is a MODEL change.** Deploy = full `./build-beta.sh` + recreate + `./run-tool-beta.sh upgrade-workspace yg`. Ship on `yg_beta` first, verify, then merge to `yg_develop` for prod.
- **Template to copy:** every model/plugin/trigger pattern already exists in `models/yg-timesheet/src/index.ts`, `plugins/yg-timesheet/src/index.ts`, `server-plugins/yg-timesheet-resources/src/index.ts`, and `plugins/yg-timesheet-resources/src/components/WorkProfileEditor.svelte`. Copy those patterns rather than inventing APIs.
- **Reuse, do not duplicate:** the account login email (a `contact.class.SocialIdentity` of type EMAIL) is the source of truth for work email. Never store a second editable copy.

---

## File Structure

New package set (mirror `yg-timesheet`; register each in `rush.json` and the model bundle exactly as the yg-timesheet packages are registered):

- `plugins/yg-hr/src/index.ts` - plugin id `yg-hr`, class/mixin `Ref`s, shared TS types, IntlString ids, pure helpers (employee-id formatting, `isHrDesignation`).
- `plugins/yg-hr-assets/lang/*.json` + `assets/icons.svg` - strings and icons.
- `plugins/yg-hr-resources/src/index.ts` + `components/*` - profile, directory, admin-list UI, editors, presenters.
- `models/yg-hr/src/index.ts` + `migration.ts` + `plugin.ts` - class/mixin models, admin space, viewlets, nav, access levels, seed + WorkProfile migration.
- `server-plugins/yg-hr/src/index.ts` - server plugin id + trigger `Resource` refs.
- `server-plugins/yg-hr-resources/src/index.ts` - trigger implementations (employee-id assignment, permission enforcement, work-email sync).

Modified:

- `models/yg-timesheet/src/index.ts` - move the "Human Resource" app nav to host the new Employees area; retire the Contacts employee kind-list from the staff view.
- `plugins/yg-timesheet/src/index.ts` - `isHrDesignation` re-exported from / delegated to `yg-hr` (keep the old signature working during migration).
- `rush.json` and the model/all bundle entrypoints - add the five new packages.

---

## Task 1: Scaffold the `yg-hr` package set

**Files:**
- Create: `plugins/yg-hr/{package.json,tsconfig.json,src/index.ts}`
- Create: `plugins/yg-hr-assets/{package.json,tsconfig.json,src/index.ts,lang/en.json,assets/icons.svg}`
- Create: `plugins/yg-hr-resources/{package.json,tsconfig.json,src/index.ts,src/plugin.ts}`
- Create: `models/yg-hr/{package.json,tsconfig.json,src/index.ts,src/plugin.ts,src/migration.ts}`
- Create: `server-plugins/yg-hr/{package.json,tsconfig.json,src/index.ts}`
- Create: `server-plugins/yg-hr-resources/{package.json,tsconfig.json,src/index.ts}`
- Modify: `rush.json` (add 6 projects), the model bundle index that imports `@hcengineering/model-yg-timesheet` (add `model-yg-hr` beside it), and the server bundle that imports `@hcengineering/server-yg-timesheet-resources` (add the yg-hr server package beside it).

**Interfaces:**
- Produces: empty but buildable plugin ids `ygHr` (client) and `serverYgHrId` (server), so later tasks import real modules.

- [ ] **Step 1:** Copy each `yg-timesheet*` package's `package.json`/`tsconfig.json` to the matching `yg-hr*` package, renaming `yg-timesheet` to `yg-hr` throughout (name, deps that self-reference). Keep versions identical.

- [ ] **Step 2:** Write the minimal `plugins/yg-hr/src/index.ts`:

```ts
import type { Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'

export const ygHrId = 'yg-hr' as Plugin

export default plugin(ygHrId, {
  class: {},
  mixin: {},
  string: {}
})
```

- [ ] **Step 3:** Write the minimal `server-plugins/yg-hr/src/index.ts` mirroring `server-plugins/yg-timesheet/src/index.ts` (a `plugin(serverYgHrId, { trigger: {} })`).

- [ ] **Step 4:** Add the 6 packages to `rush.json` (copy the 6 `yg-timesheet*` entries, rename). Register `@hcengineering/model-yg-hr` in the same bundle file that imports `@hcengineering/model-yg-timesheet`, and the server-yg-hr-resources package where server-yg-timesheet-resources is imported.

- [ ] **Step 5:** Build only the changed workspace packages to prove the scaffold compiles:

Run: `cd /home/karthi_0008/dev/client-projects/yg-huly && node common/scripts/install-run-rush.js build --to @hcengineering/model-yg-hr`
Expected: builds green (empty modules compile).

- [ ] **Step 6: Commit**

```bash
git add plugins/yg-hr plugins/yg-hr-assets plugins/yg-hr-resources models/yg-hr server-plugins/yg-hr server-plugins/yg-hr-resources rush.json
git commit -m "feat(yg-hr): scaffold the HR module package set"
```

---

## Task 2: Shared types, plugin ids, and IntlStrings

**Files:**
- Modify: `plugins/yg-hr/src/index.ts`
- Modify: `plugins/yg-hr-assets/lang/en.json`

**Interfaces:**
- Produces: type aliases `Gender`, `MaritalStatus`; class refs `ygHr.class.Department`, `.Designation`, `.EmploymentStatus`, `.Location`, `.EmergencyContact`, `.EmployeeSeq`; mixin refs `ygHr.mixin.EmployeePersonal`, `.EmployeeContact`, `.EmployeeJob`; space ref `ygHr.space.HrConfig`; IntlString ids for every field label and tab title. Later tasks reference these exact names.

- [ ] **Step 1:** Add types and refs to `plugins/yg-hr/src/index.ts`:

```ts
import type { AttachedDoc, Class, Doc, Mixin, Ref, Space, Timestamp } from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import type { Employee } from '@hcengineering/contact'

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
```

- [ ] **Step 2:** Extend the `plugin(ygHrId, {...})` map with `class`, `mixin`, `space`, and `string` keys naming every ref above plus one IntlString per label (tab titles: `Personal`, `Contact`, `Job`, `Emergency`; fields: `MiddleName`, `Gender`, `DateOfBirth`, `MaritalStatus`, `Nationality`, `BloodGroup`, `EmployeeId`, `Street1`, `Street2`, `City`, `State`, `Zip`, `Country`, `HomePhone`, `Mobile`, `WorkPhone`, `WorkEmail`, `OtherEmail`, `Designation`, `Department`, `EmploymentStatus`, `JoinedDate`, `Location`, `ContractStart`, `ContractEnd`, `Relationship`; list mgmt: `Departments`, `Designations`, `EmergencyContacts`, `AddEmergencyContact`, `Employees`, `EmployeeDirectory`, `EditProfile`). Follow the exact shape of the `string:` block in `plugins/yg-timesheet/src/index.ts`.

- [ ] **Step 3:** Add every IntlString key with English copy to `plugins/yg-hr-assets/lang/en.json` (no em dashes). Mirror the structure of `plugins/yg-timesheet-assets/lang/en.json`.

- [ ] **Step 4:** Build `--to @hcengineering/yg-hr` and confirm green.

- [ ] **Step 5: Commit** `feat(yg-hr): shared types, refs, and strings`.

---

## Task 3: `isHrDesignation` helper + employee-id formatter (pure logic, unit-tested)

**Files:**
- Modify: `plugins/yg-hr/src/index.ts`
- Test: `plugins/yg-hr/src/__tests__/helpers.test.ts`

**Interfaces:**
- Produces: `formatEmployeeId(seq: number, prefix?: string, width?: number): string` and `HR_DESIGNATION_FALLBACK = 'HR Executive'`. Consumed by Task 7 (trigger) and Task 5 (migration).

- [ ] **Step 1: Write the failing test** `plugins/yg-hr/src/__tests__/helpers.test.ts`:

```ts
import { formatEmployeeId } from '..'

describe('formatEmployeeId', () => {
  it('pads to width 4 with the YGS prefix by default', () => {
    expect(formatEmployeeId(25)).toBe('YGS0025')
    expect(formatEmployeeId(1)).toBe('YGS0001')
  })
  it('does not truncate numbers wider than the pad width', () => {
    expect(formatEmployeeId(12345)).toBe('YGS12345')
  })
  it('honours a custom prefix and width', () => {
    expect(formatEmployeeId(7, 'EMP', 3)).toBe('EMP007')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd plugins/yg-hr && node ../../common/scripts/install-run-rushx.js test`
Expected: FAIL - `formatEmployeeId is not a function`.

- [ ] **Step 3: Implement** in `plugins/yg-hr/src/index.ts`:

```ts
export const HR_DESIGNATION_FALLBACK = 'HR Executive'

export function formatEmployeeId (seq: number, prefix = 'YGS', width = 4): string {
  return `${prefix}${String(seq).padStart(width, '0')}`
}
```

- [ ] **Step 4: Run to verify it passes** (same command). Expected: PASS.

- [ ] **Step 5: Commit** `feat(yg-hr): employee-id formatter with tests`.

---

## Task 4: Admin-managed list models + HR config space

**Files:**
- Modify: `models/yg-hr/src/index.ts`
- Modify: `models/yg-hr/src/plugin.ts` (re-export refs for the model layer via `mergeIds`, following `models/yg-timesheet/src/plugin.ts`)

**Interfaces:**
- Consumes: `ygHr.class.Department|Designation|EmploymentStatus|Location`, `ygHr.space.HrConfig` (Task 2).
- Produces: registered classes `TDepartment`, `TDesignation`, `TEmploymentStatus`, `TLocation` (all extend `TDoc`, domain `DOMAIN_YG_HR`), and a created config space. Later tasks reference `ygHr.space.HrConfig` as the space for list items.

- [ ] **Step 1:** Define the domain and classes in `models/yg-hr/src/index.ts` (copy decorator style from `models/yg-timesheet/src/index.ts`):

```ts
import { type Builder, Model, Prop, TypeString, TypeBoolean, UX } from '@hcengineering/model'
import core, { TDoc } from '@hcengineering/model-core'
import { type Domain } from '@hcengineering/core'
import ygHr from './plugin'

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
```

- [ ] **Step 2:** In the `createModel(builder: Builder)` function, register the classes with `builder.createModel(TDepartment, TDesignation, TEmploymentStatus, TLocation)` and create the config space by copying the `createDoc(core.class.SystemSpace ...)`/`createDefaultSpace` pattern used for the yg-timesheet spaces. Give it `ygHr.space.HrConfig`.

- [ ] **Step 3:** Add `IsHr` IntlString to Task 2's string map + en.json if not already present.

- [ ] **Step 4:** Build `--to @hcengineering/model-yg-hr`. Expected: green.

- [ ] **Step 5: Commit** `feat(yg-hr): admin-managed Department/Designation/Status/Location models`.

---

## Task 5: Employee HR mixins + EmergencyContact child model

**Files:**
- Modify: `models/yg-hr/src/index.ts`

**Interfaces:**
- Consumes: `contact.mixin.Employee` (`TEmployee` from `@hcengineering/model-contact`), the list classes (Task 4), `ygHr.mixin.*`, `ygHr.class.EmergencyContact`.
- Produces: mixins `TEmployeePersonal`, `TEmployeeContact`, `TEmployeeJob` on `contact.mixin.Employee`, and `TEmergencyContact` (`TAttachedDoc`, domain `DOMAIN_YG_HR`). Field names exactly as in the spec so the UI (Task 10) and migration (Task 6) can bind to them.

- [ ] **Step 1:** Define the mixins (copy `@Mixin(ygTimesheet.mixin.WorkProfile, contact.mixin.Employee)` from yg-timesheet). Use `TypeRef(...)` for list references and `TypeDate()` for dates:

```ts
import contact, { TEmployee } from '@hcengineering/model-contact'
import { TAttachedDoc } from '@hcengineering/model-core'
import { Mixin, TypeDate, TypeRef } from '@hcengineering/model'

@Mixin(ygHr.mixin.EmployeePersonal, contact.mixin.Employee)
export class TEmployeePersonal extends TEmployee {
  @Prop(TypeString(), ygHr.string.MiddleName) middleName?: string
  @Prop(TypeString(), ygHr.string.Gender) gender?: string
  @Prop(TypeDate(), ygHr.string.DateOfBirth) dateOfBirth?: number
  @Prop(TypeString(), ygHr.string.MaritalStatus) maritalStatus?: string
  @Prop(TypeString(), ygHr.string.Nationality) nationality?: string
  @Prop(TypeString(), ygHr.string.BloodGroup) bloodGroup?: string
  @Prop(TypeString(), ygHr.string.EmployeeId) employeeId?: string
}

@Mixin(ygHr.mixin.EmployeeContact, contact.mixin.Employee)
export class TEmployeeContact extends TEmployee {
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
export class TEmployeeJob extends TEmployee {
  @Prop(TypeRef(ygHr.class.Designation), ygHr.string.Designation) designation?: Ref<Designation>
  @Prop(TypeRef(ygHr.class.Department), ygHr.string.Department) department?: Ref<Department>
  @Prop(TypeRef(ygHr.class.EmploymentStatus), ygHr.string.EmploymentStatus) employmentStatus?: Ref<EmploymentStatus>
  @Prop(TypeDate(), ygHr.string.JoinedDate) joinedDate?: number
  @Prop(TypeRef(ygHr.class.Location), ygHr.string.Location) location?: Ref<Location>
  @Prop(TypeDate(), ygHr.string.ContractStart) contractStart?: number
  @Prop(TypeDate(), ygHr.string.ContractEnd) contractEnd?: number
}

@Model(ygHr.class.EmergencyContact, core.class.AttachedDoc, DOMAIN_YG_HR)
@UX(ygHr.string.EmergencyContact)
export class TEmergencyContact extends TAttachedDoc {
  @Prop(TypeString(), ygHr.string.Name) name!: string
  @Prop(TypeString(), ygHr.string.Relationship) relationship?: string
  @Prop(TypeString(), ygHr.string.HomePhone) homePhone?: string
  @Prop(TypeString(), ygHr.string.Mobile) mobile?: string
  @Prop(TypeString(), ygHr.string.WorkPhone) workPhone?: string
}
```

- [ ] **Step 2:** Register all in `builder.createModel(...)`. Add an `emergencyContacts` collection to the Employee via `Collection(ygHr.class.EmergencyContact)` on the `EmployeePersonal` mixin (follow how yg-timesheet attaches collections).

- [ ] **Step 3:** Build `--to @hcengineering/model-yg-hr`. Expected: green.

- [ ] **Step 4: Commit** `feat(yg-hr): employee Personal/Contact/Job mixins + EmergencyContact`.

---

## Task 6: Migration - seed lists, migrate WorkProfile, rework HR-staff detection

**Files:**
- Modify: `models/yg-hr/src/migration.ts`
- Modify: `plugins/yg-hr/src/index.ts` (add `isHrDesignationByFlag`)
- Modify: `plugins/yg-timesheet/src/index.ts` (delegate `isHrDesignation` to the flag-aware path with the legacy name fallback)

**Interfaces:**
- Consumes: the enums currently in `plugins/yg-timesheet/src/index.ts` (WorkDesignation ~24 titles, WorkDepartment 5 values), `ygTimesheet.mixin.WorkProfile` data.
- Produces: seeded `Department`/`Designation`/`EmploymentStatus`/`Location` docs; each employee's `WorkProfile.designation/department/employeeId` copied into `EmployeeJob`/`EmployeePersonal` (as list refs); `Designation` doc named "HR Executive" has `isHr: true`.

- [ ] **Step 1:** Write `migrateYgHr(client)` in `migration.ts` using the idempotent pattern from `models/yg-timesheet/src/migration.ts` (`const ops = new TxOperations(client, core.account.System)`; check-before-create keyed by `name`). Seed the four lists from the existing enum values; set `isHr: true` on the "HR Executive" designation.

- [ ] **Step 2:** For each `Person` carrying `ygTimesheet.mixin.WorkProfile`, read the nested mixin data (designation string, department string, employeeId), resolve the matching seeded `Designation`/`Department` doc by name, and `createMixin`/`updateMixin` the `EmployeeJob` (designation, department) and `EmployeePersonal` (employeeId). Idempotent: skip if the target mixin already has the value.

- [ ] **Step 3:** Register the migration in the model's `createModel`/migration export exactly as yg-timesheet registers `migrateApprovalRows` (the `MigrateOperation` export consumed by the tool's `upgrade-workspace`).

- [ ] **Step 4:** Add flag-aware detection to `plugins/yg-hr/src/index.ts`:

```ts
export function isHrDesignationByFlag (designation?: { isHr?: boolean, name?: string }): boolean {
  if (designation == null) return false
  return designation.isHr === true || designation.name === HR_DESIGNATION_FALLBACK
}
```

Update `plugins/yg-timesheet/src/index.ts` `isHrDesignation` to accept the resolved `Designation` doc and call this, keeping the old string-based signature working during migration (overload or wrapper) so attendance/late-permission code compiles unchanged.

- [ ] **Step 5: Unit test** the flag helper (`plugins/yg-hr/src/__tests__/helpers.test.ts`): flag true, legacy name true, other false. Run `rushx test`, expect PASS.

- [ ] **Step 6: Commit** `feat(yg-hr): seed lists + migrate WorkProfile + flag-based HR detection`.

---

## Task 7: Server trigger - assign employee id on employee creation

**Files:**
- Modify: `server-plugins/yg-hr/src/index.ts` (add `trigger.OnEmployeeCreate`)
- Modify: `server-plugins/yg-hr-resources/src/index.ts` (implement it)
- Modify: `models/yg-hr/src/index.ts` (register the trigger with a `txMatch` on `contact.mixin.Employee`)

**Interfaces:**
- Consumes: `formatEmployeeId` (Task 3), `ygHr.class.EmployeeSeq`, `ygHr.mixin.EmployeePersonal`.
- Produces: on Employee-mixin creation without an `employeeId`, assigns `YGS####` from a workspace `EmployeeSeq` counter (atomic `$inc`), loop-safe.

- [ ] **Step 1:** Copy the `OnAttendancePunch` trigger shape from `server-plugins/yg-timesheet-resources/src/index.ts`: System-authored `TxOperations`, guard against re-entrancy (bail if the tx already sets `employeeId`, or actor is System writing the id).

- [ ] **Step 2:** Implement: on Employee create/mixin-add, if `EmployeePersonal.employeeId` is empty, atomically `$inc` the single `EmployeeSeq.last` (create it at 24 on first run so the next id continues the YGS series after YGS0024), then `updateMixin(EmployeePersonal, { employeeId: formatEmployeeId(next) })`.

- [ ] **Step 3:** Register the trigger in `models/yg-hr/src/index.ts` with `txMatch: { objectClass: contact.mixin.Employee }`, mirroring how `models/server-yg-timesheet` registers `OnAttendancePunch` (this registration was the step missed in the past - do not skip it).

- [ ] **Step 4:** Verification is integration (Task 13): create an employee, confirm `employeeId` becomes the next `YGS####`. Add a `log()` in the trigger for the assigned id.

- [ ] **Step 5: Commit** `feat(yg-hr): auto-assign employee id on create (trigger + registration)`.

---

## Task 8: Permissions - access levels + server enforcement

**Files:**
- Modify: `models/yg-hr/src/index.ts` (TxAccessLevel on the mixins/classes)
- Modify: `server-plugins/yg-hr-resources/src/index.ts` (enforcement trigger)
- Modify: `server-plugins/yg-hr/src/index.ts` (trigger ref)

**Interfaces:**
- Consumes: `isHrDesignationByFlag`, the resolved actor's `EmployeeJob.designation`.
- Produces: server rule - writes to any HR mixin/EmergencyContact of an employee are allowed only when the actor is workspace Owner/Maintainer OR the actor's designation `isHr`, EXCEPT an employee editing **only** their own avatar fields. Reads of full-profile mixins are gated the same way; basic directory fields (name, avatar, designation, department, work email) stay world-readable.

- [ ] **Step 1:** Split fields by sensitivity so the directory can stay public while full profiles are gated: keep name/avatar on `Person` (already Guest-readable), designation/department on `EmployeeJob` at a **read** access level of `User` (directory needs them), and Personal/Contact/Emergency at a **read** level of the HR guard (self + HR). Model these with `core.mixin.TxAccessLevel` exactly as `models/contact/src/index.ts` sets `createAccessLevel`/`updateAccessLevel` on `Person`/`SocialIdentity`.

- [ ] **Step 2:** Implement the write-enforcement trigger (copy the authorization pattern from `OnLatePermissionUpdate` in yg-timesheet-resources: resolve the actor, resolve `actorProfile.designation`, allow if admin or `isHrDesignationByFlag`, else if the write targets the actor's own record and touches only avatar fields allow, else revert/throw). Loop-safe: System-authored guard reverts do not re-trigger.

- [ ] **Step 3:** Register the trigger with `txMatch` on the three mixins + `ygHr.class.EmergencyContact`.

- [ ] **Step 4:** Verification is integration (Task 13): as a non-HR user, attempt to edit another employee's Personal tab via the API and confirm the write is refused; confirm you can change your own photo.

- [ ] **Step 5: Commit** `feat(yg-hr): server-enforced three-tier employee permissions`.

---

## Task 9: Admin-list management UI (Departments, Designations, Status, Location)

**Files:**
- Create: `plugins/yg-hr-resources/src/components/HrLists.svelte`
- Modify: `plugins/yg-hr-resources/src/index.ts` (register component), `models/yg-hr/src/index.ts` (nav special "HR Settings", gated to HR/admin)

**Interfaces:**
- Consumes: the four list classes + `ygHr.space.HrConfig`.
- Produces: a screen where HR add/rename/remove list items (create `Doc` in `HrConfig`), and toggle a Designation's `isHr`.

- [ ] **Step 1:** Build `HrLists.svelte` as four simple editable lists (query each class in `HrConfig`, add/rename/delete). Copy the query/create idioms from `WorkProfileEditor.svelte`. Modern styling per Task 10's design tokens (cards, quiet borders, theme-aware).

- [ ] **Step 2:** Register as an "HR Settings" special in the Human Resource app, visible only to HR/admin (reuse the `accessLevel: DocGuest` + HR-designation check the "Team Profiles" special uses).

- [ ] **Step 3:** Verification (Task 13): add a department, confirm it appears in the Job tab dropdown.

- [ ] **Step 4: Commit** `feat(yg-hr): admin-managed list settings UI`.

---

## Task 10: Modern tabbed employee profile (ObjectEditor)

**Files:**
- Create: `plugins/yg-hr-resources/src/components/EmployeeProfile.svelte` (shell: identity header + tab bar + tab router)
- Create: `plugins/yg-hr-resources/src/components/tabs/{PersonalTab,ContactTab,JobTab,EmergencyTab}.svelte`
- Create: `plugins/yg-hr-resources/src/components/FieldGroup.svelte` (read-only labeled field group), `FieldRow.svelte`, `SectionCard.svelte` (shared modern primitives)
- Modify: `plugins/yg-hr-resources/src/index.ts` (register `EmployeeProfile`), `models/yg-hr/src/index.ts` (set `EmployeeProfile` as the `view.mixin.ObjectEditor` editor for `contact.mixin.Employee`, replacing the generic panel for employees)

**Interfaces:**
- Consumes: the three mixins + EmergencyContact collection + the four lists + the login email social-id + `isHrDesignationByFlag` + `formatEmployeeId`.
- Produces: `ygHr.component.EmployeeProfile`, the editor Huly opens for any Employee.

**Design contract (super modern, applied via the frontend-design skill):**
- **Identity header:** large avatar (change-photo affordance for self/HR), display name, designation, department, work email, employee-id chip. Calm, spacious, one clean band.
- **Tab bar:** Personal / Contact / Job / Emergency. Content in **SectionCard**s.
- **Read-only by default:** render values as `FieldGroup` label/value pairs (not inputs). An **Edit** button (HR/admin only, or self-photo-only) flips a card into inline editors with Save/Cancel per card.
- No activity feed, comment box, Collaborators, attachments, or kind-tags anywhere in this editor.
- Responsive; theme-aware (use `var(--theme-*)` tokens exactly like existing components); status chips; smooth section transitions. Not the legacy orange look.

- [ ] **Step 1:** Build `SectionCard.svelte`, `FieldGroup.svelte`, `FieldRow.svelte` primitives (theme-aware, using `--theme-*` CSS vars as in existing Svelte components).

- [ ] **Step 2:** Build `PersonalTab.svelte`: read `EmployeePersonal` mixin off the Employee; show middle name, gender, DOB, marital status, nationality, blood group, employee id (read-only display; id never hand-editable except by HR). Edit mode writes via `client.updateMixin(...)`. Gate edit on `canEdit` prop.

- [ ] **Step 3:** Build `ContactTab.svelte`: `EmployeeContact` fields + a **read-only Work Email** row sourced from the login email social-id (query `contact.class.SocialIdentity` type EMAIL for this person), never editable.

- [ ] **Step 4:** Build `JobTab.svelte`: designation/department/employmentStatus/location as dropdowns bound to the admin lists; joined date and contract dates. Edit writes `EmployeeJob` mixin.

- [ ] **Step 5:** Build `EmergencyTab.svelte`: list the `EmergencyContact` collection with add/edit/remove (HR/admin), read-only for others.

- [ ] **Step 6:** Build `EmployeeProfile.svelte` shell: compute `canEdit = isAdmin || actorIsHr` and `isSelf`; render header + tab bar + active tab; pass `canEdit`/`isSelf`. Self gets photo-only edit.

- [ ] **Step 7:** Register as the Employee `ObjectEditor` with `pinned: true` (replace `contact.component.EditPerson` binding for the Employee mixin in the HR views). Confirm the generic activity/comments panel is not used for this editor.

- [ ] **Step 8:** Verification (Task 13): open an employee, see the modern tabbed profile; HR edits, non-HR read-only, self edits photo only.

- [ ] **Step 9: Commit** `feat(yg-hr): modern tabbed employee profile editor`.

---

## Task 11: Employee directory list

**Files:**
- Create: `plugins/yg-hr-resources/src/components/EmployeeDirectory.svelte` (or a viewlet config if a table suffices)
- Modify: `models/yg-hr/src/index.ts` (directory viewlet/special + "+ Employee" create action)

**Interfaces:**
- Consumes: `contact.mixin.Employee` + `EmployeeJob` (designation/department) + login email + avatar.
- Produces: `ygHr.component.EmployeeDirectory` - columns Photo / Name / Designation / Department / Work Email; search + filter by department/designation; read-only rows; **+ Employee** and row-edit for HR/admin only.

- [ ] **Step 1:** Build the directory (a table viewlet attached to `contact.mixin.Employee` limited to the five columns, OR a custom grid component for the modern look - prefer the custom grid to match the profile's aesthetic). Rows open `EmployeeProfile`.

- [ ] **Step 2:** Wire **+ Employee** to the existing create-employee flow (which already creates the account); after create, the Task 7 trigger assigns the id. Gate the button to HR/admin.

- [ ] **Step 3:** Verification (Task 13): all users see the directory read-only; HR sees create/edit.

- [ ] **Step 4: Commit** `feat(yg-hr): modern read-only employee directory`.

---

## Task 12: Nav placement + retire the Contacts kind-list for staff

**Files:**
- Modify: `models/yg-timesheet/src/index.ts` (Human Resource app nav) and/or `models/yg-hr/src/index.ts`
- Modify: `models/contact/src/index.ts` (hide/relabel the Employee kind-list `TableEmployee` from the staff-facing nav) - scope strictly to the employee views; do not touch recruit/lead.

**Interfaces:**
- Produces: an **Employees** area in the Human Resource app hosting the directory + profile + HR Settings; the old Contacts "Employee" tab with Location/Files/Role kind-tags no longer the staff entry point.

- [ ] **Step 1:** Add the Employees / HR Settings specials to the Human Resource app navigator (copy the "Team Profiles" special block at `models/yg-timesheet/src/index.ts:388-398`).

- [ ] **Step 2:** Remove/hide the Contacts app's Employee kind-list from the staff nav (retire `contact.viewlet.TableEmployee` as the entry, or hide the Contacts "Employee" special). Leave Persons/Companies for genuine external contacts, or hide Contacts entirely per preference - confirm with the user at review.

- [ ] **Step 3:** Verification (Task 13): staff reach employees only through the modern HR area; no coloured kind-tags anywhere.

- [ ] **Step 4: Commit** `feat(yg-hr): host Employees in the HR app, retire the Contacts kind-list`.

---

## Task 13: Build, upgrade, and end-to-end verification on beta

**Files:** none (integration).

- [ ] **Step 1:** Full build:

Run: `cd /home/karthi_0008/dev/client-projects/huly-migration/huly-selfhost && docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml stop && ./build-beta.sh`
Expected: 5 images built, no TS errors.

- [ ] **Step 2:** Cold-start (redpanda first) and upgrade the workspace model:

```bash
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d redpanda cockroach minio elastic
# wait for: rpk cluster health -> Healthy: true
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml up -d
docker compose -p huly_v7 -f compose.yml -f compose.override.beta.yml restart nginx
./run-tool-beta.sh upgrade-workspace yg
```
Expected: upgrade exits 0; migration seeded lists and copied WorkProfile data.

- [ ] **Step 3: Manual checks** (record pass/fail for each):
  - Directory lists all employees read-only with Photo/Name/Designation/Department/Work Email; search + filter work.
  - Open an employee: modern tabbed profile, no activity/comments/collaborators/attachments/kind-tags.
  - As HR/admin: edit each tab, add an Emergency Contact, all save.
  - As a normal user: your own profile is read-only except photo; a colleague shows basic fields only.
  - Create a new employee: `employeeId` auto-assigns the next `YGS####`.
  - HR Settings: add a department, it appears in the Job tab dropdown.
  - Existing employees retain their designation/department/employeeId (migration worked).
  - Attendance/late-permission still function (HR-designation detection intact).

- [ ] **Step 4:** If all pass, this is the beta cutover point. Prod rollout (merge to `yg_develop` + `upgrade-workspace` on the server) is a separate, gated step - not part of this plan.

- [ ] **Step 5: Commit** any fixes found during verification with descriptive messages.

---

## Self-Review notes (author)

- **Spec coverage:** Personal/Contact/Job/Emergency (Tasks 5, 10), admin lists (Tasks 4, 9), employee-id (Tasks 3, 7), directory (Task 11), three-tier server permissions (Task 8), WorkProfile migration + HR-flag (Task 6), modern UI (Task 10 design contract), nav/retire kinds (Task 12), deploy (Task 13). All spec sections map to a task.
- **Deferred by design (later phases, not gaps):** Immigration, Dependents, Qualifications, Report-to, Memberships, Salary, OrangeHRM import.
- **Type consistency:** field names in Task 5 mixins are the same names read in Task 10 tabs and written in Task 6 migration; `formatEmployeeId`/`isHrDesignationByFlag` signatures are stable across Tasks 3, 6, 7, 8, 10.
- **Known follow-up:** Task 6 must keep `shiftStart` readable by attendance (leave it on `WorkProfile` or migrate readers) - called out in the spec's risks; resolve in Task 6 Step 4 if attendance reads break.
