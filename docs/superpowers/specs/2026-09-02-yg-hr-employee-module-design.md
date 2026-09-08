# YG HR / Employee Module - Design Spec

- **Date:** 2026-09-02
- **Status:** Approved design (Phase 1), ready for implementation planning
- **Owner:** YG platform (yg-huly fork)
- **Related:** `plugins/yg-timesheet/*` (existing WorkProfile, attendance, timesheet), `plugins/contact/*` (Employee identity)

## 1. Goal

Replace Huly's issue-style Contacts experience for staff with a proper, organization-grade
**Employee / HR module** modeled on OrangeHRM (the current `hr.youngglobe.com` system), with a
**super modern UI**. Employees become structured HR records with real sections (Personal, Contact,
Job, Emergency, and later Immigration, Dependents, Qualifications, Report-to, Memberships, Salary),
an admin-managed org taxonomy (Department, Designation), a clean read-only directory, and a strict
three-tier permission model.

This reuses the existing `Employee` identity (which links login, attendance, and timesheet) and is
built in our own packages so it does not fight upstream Huly.

## 2. Why revamp (current-state findings)

Huly models a person as a **collaborative document** (like an issue), which is wrong for HR:

- The coloured **role tags** (EMPLOYEE / WORKER / CUSTOMER / TALENT / UNDEFINED) are not a field.
  They are simply every *mixin* applied to the Person, rendered by a generic `RolePresenter`:
  Employee mixin, Huly's HR `Staff` mixin (label "Worker"), recruit's `Candidate` (Talent),
  lead's `Customer`, and our own `WorkProfile` mixin (no display label, so it leaks as
  "UNDEFINED").
- The right sidebar ("Person / Worker / Collaborators") is the same mixin mechanism, plus
  **Collaborators**, which Huly auto-adds to every doc (the notification-follow list, meaningless
  for an employee).
- The **activity feed, comment box, and Attachments** come from the generic doc panel
  (activity + chunter + attachment plugins), not from anything employee-specific.

None of this is HR. It is Huly's issue framing bleeding onto people.

### What already exists and is reused

`yg-timesheet` already added a **`WorkProfile`** mixin on employees carrying `designation`
(a fixed enum of ~24 titles including "HR Executive"), `department` (enum:
Development/Testing/SEO/Sales/HR), `employeeId` ("YGS0024"), and `shiftStart`, plus a "Team
Profiles" editor and the whole attendance/timesheet/late-permission stack keyed to the `Employee`.
"HR Executive" is already the HR-staff marker (`isHrDesignation()`). The new module **absorbs and
extends** `WorkProfile`, it does not duplicate it.

## 3. Decisions (agreed)

1. **Structure:** dedicated HR module reusing the `Employee` identity; new tabbed profile +
   directory in our own packages; upstream Contacts left alone (retired for staff).
2. **Scope:** phased, core first. Phase 1 = Personal, Contact, Job, Emergency Contacts + directory
   + permissions. Later phases add the rest, with Salary last.
3. **Department / Designation:** admin-managed lists (HR-editable, no code change). Department is a
   flat list for now (hierarchy can be added later without reworking the model).
4. **Data migration:** build first; a one-time importer from the OrangeHRM SQL dump is a later,
   separate phase.
5. **Work email:** the account's login email (social-id), shown read-only, never re-entered, so it
   cannot drift from the login credential.
6. **Employee ID:** auto-generated as `YGS` + zero-padded sequence (next `YGS0025`), HR can
   override.
7. **Edit rights:** workspace Owner/Maintainer **or** designation "HR Executive".
8. **Self-service:** an employee sees their own full profile read-only, editable **only** for the
   profile photo.

## 4. Architecture

New packages (mirroring the `yg-timesheet` layout so the build and CI already understand them):

- `plugins/yg-hr` - plugin ids, class/mixin refs, shared types, IntlStrings.
- `plugins/yg-hr-resources` - Svelte UI (profile, directory, admin lists, editors).
- `plugins/yg-hr-assets` - icons + `lang/*.json`.
- `models/yg-hr` - class/mixin models, viewlets, nav, access levels.
- `server-plugins/yg-hr` + `server-plugins/yg-hr-resources` - triggers (employee-ID assignment,
  permission enforcement, keeping the read-only work-email in sync).

The existing `Employee` mixin remains the anchor. HR data hangs off it.

### 4.1 Data model (Phase 1)

**Single-value sections = mixins on `contact.mixin.Employee`** (data nested on the person, matching
OrangeHRM's wide employee row). One mixin per tab keeps the JSONB namespaced and the editors
focused:

- **`EmployeePersonal`** (mixin): `middleName?`, `gender?` (M/F/Other), `dateOfBirth?`,
  `maritalStatus?` (Single/Married/Other), `nationality?`, `bloodGroup?`, `employeeId?`
  (auto-assigned).
- **`EmployeeContact`** (mixin): `street1?`, `street2?`, `city?`, `state?`, `zip?`, `country?`,
  `homePhone?`, `mobile?`, `workPhone?`, `otherEmail?`. Work email is derived from the login
  social-id (read-only, not stored here).
- **`EmployeeJob`** (mixin): `designation?` (ref to Designation list), `department?` (ref to
  Department list), `employmentStatus?` (ref to list), `joinedDate?`, `location?` (ref to list),
  `contractStart?`, `contractEnd?`. **Supersedes** the current `WorkProfile` enums; `WorkProfile`
  fields are migrated into `EmployeeJob` (designation/department) and `EmployeePersonal`
  (employeeId); `shiftStart` stays where attendance already reads it (or moves with a compatibility
  shim - resolved in the plan).

**Multi-value section = child collection** (`AttachedDoc`, one-to-many, matching OrangeHRM child
tables):

- **`EmergencyContact`** (attached to Employee): `name`, `relationship?`, `homePhone?`, `mobile?`,
  `workPhone?`.

Future multi-value sections (Dependents, Immigration records, Work Experience, Education, Skills,
Languages, Licenses, Memberships, Salary components, Report-to edges) follow this same child-collection
shape - see the roadmap and the OrangeHRM mapping appendix.

### 4.2 Admin-managed lists

Simple config documents in an HR-settings space, editable by HR/admin, seeded from the current
enums so nothing is lost:

- **`Department`**: `name` (flat list; seed Development/Testing/SEO/Sales/HR).
- **`Designation`**: `name`, `isHr` (flag). Seed the ~24 current titles; mark "HR Executive"
  `isHr: true` so HR-staff detection continues to work off the flag instead of a hardcoded string.
- **`EmploymentStatus`**: `name` (seed Full Time / Part Time / Freelancer / Intern).
- **`Location`**: `name` (seed "Young Globes - Coimbatore").

`isHrDesignation()` is reworked to check the `Designation.isHr` flag (fallback to the legacy
"HR Executive" name during migration).

### 4.3 Employee ID

A server trigger assigns `YGS` + zero-padded sequence on employee creation (next `YGS0025`), using a
sequence doc so concurrent creates do not collide. HR can override the value in the Personal tab.
Prefix and width are configurable.

### 4.4 Permissions (three-tier, server-enforced)

| Capability | Who |
|---|---|
| View directory + everyone's **basic** fields (photo, name, designation, department, work email) | all workspace members |
| View a colleague's full profile | HR/admin only (others see basic only) |
| View **own** full profile (read-only except photo) | the employee |
| Create / edit / delete any employee record | workspace Owner/Maintainer **or** designation `isHr` |

Enforcement is **server-side** (triggers / TxAccessLevel), not just client gating - this is
mandatory before Salary (later phase) exists. Client gating drives the UI (hide Edit, lock fields),
server rules are the real guard. Sensitive sections get their own stricter access level.

### 4.5 UI - super modern

The profile **replaces** the issue-style panel for employees. Design direction (applied during
implementation, likely with the frontend-design skill):

- **A clean, card-based, tabbed profile.** Header: large avatar, name, designation, department,
  work email, employee ID as a compact identity band. Below it, tabs: **Personal / Contact / Job /
  Emergency** (more tabs appear as later phases land).
- **No** activity feed, **no** comment box, **no** Collaborators sidebar, **no** attachments-as-social,
  **no** coloured kind-tags.
- **Read-only by default**, rendered as calm labeled field groups inside cards - not input boxes. An
  **Edit** button (HR/admin only) flips a section into an inline editor; save/cancel per section.
- Employees see their own profile read-only with a single affordance: change photo.
- **Modern aesthetic:** generous spacing, subtle borders, strong typographic hierarchy, status
  chips, smooth section transitions, fully **responsive** and **theme-aware** (honors Huly
  light/dark). Explicitly *not* the legacy orange OrangeHRM look - closer to a modern HRIS
  (clean, quiet, content-first).
- **Directory:** a modern list/grid - photo, name, designation, department, work email - read-only
  for everyone, with **+ Employee** (create) and row edit for HR/admin only. Replaces the old
  Location/Files/Role/kind-tag table. Fast search and filter by department/designation.

### 4.6 Placement

Lives in the existing **YG Human Resource** app as an **Employees** area (directory + profile). The
old Contacts "Employee" kind-list is retired for staff; Contacts remains only for genuine external
persons/companies (or is hidden from the nav). The "Team Profiles" editor is folded into the new
Job tab.

### 4.7 Deploy

This is a **model change** (new classes/mixins/migrations) - full build + `upgrade-workspace`,
**beta first, then prod**. It ships independently of the staged invite/workspace-lockdown changes
(which are front + account only).

## 5. Roadmap (later phases)

- **Phase 2 - Immigration & Dependents:** child collections; document type, numbers, dates,
  country, comments; dependent name/relationship/DOB.
- **Phase 3 - Qualifications:** Work Experience, Education (level list), Skills (skill list),
  Languages, Licenses (type list) - all child collections + their admin lists.
- **Phase 4 - Report-to:** supervisor/subordinate edges with reporting method (Direct/Indirect);
  an org/reporting view.
- **Phase 5 - Memberships:** membership list, subscription owner/amount/currency/dates.
- **Phase 6 - Salary:** components, pay grade, currency, frequency, amount - **strictest access**
  (HR/finance only), server-enforced.
- **Phase 7 - OrangeHRM import:** one-time migration from the SQL dump into the settled model.

## 6. OrangeHRM field mapping (reference appendix)

Full source enumeration retained for later phases. Section -> key fields -> OrangeHRM table:

- **Personal** -> `hs_hr_employee`: first/middle/last, employee_id, other_id, driver's license
  (+ expiry), nationality (`ohrm_nationality`), marital status, DOB, gender, custom1..10.
- **Contact** -> `hs_hr_employee`: street1/2, city, state, zip, country (`hs_hr_country`), home/mobile/work
  phone, work email, other email.
- **Emergency Contacts** -> `hs_hr_emp_emergency_contacts`: name, relationship, home/mobile/work.
- **Dependents** -> `hs_hr_emp_dependents`: name, relationship (child/other), DOB.
- **Immigration** -> `hs_hr_emp_passport`: type (passport/visa), number, issued/expiry, country,
  comments.
- **Job** -> `hs_hr_employee` + config: job title (`ohrm_job_title`), employment status
  (`ohrm_employment_status`), job category (`ohrm_job_category`), joined date, sub-unit/department
  (`ohrm_subunit`, NestedSet tree), location (`ohrm_location`); contract start/end
  (`hs_hr_emp_contract_extend`); termination (`ohrm_emp_termination` + reason).
- **Salary** -> `hs_hr_emp_basicsalary`: component, pay grade (`ohrm_pay_grade`), frequency
  (`hs_hr_payperiod`), currency (`hs_hr_currency_type`), amount, notes.
- **Report-to** -> `hs_hr_emp_reportto`: supervisor/subordinate + method
  (`ohrm_emp_reporting_method`: Direct/Indirect).
- **Qualifications** -> Work Experience (`hs_hr_emp_work_experience`), Education (`ohrm_emp_education`
  + `ohrm_education`), Skills (`hs_hr_emp_skill` + `ohrm_skill`), Languages (`hs_hr_emp_language`
  + `ohrm_language`), Licenses (`ohrm_emp_license` + `ohrm_license`).
- **Memberships** -> `hs_hr_emp_member_detail` + `ohrm_membership`.
- **Org structure:** `ohrm_subunit` (nested-set tree; YG root "Young Globes"). Employee ID scheme:
  visible `employee_id` = `YGS` + emp_number padded to 4.

## 7. Risks / open items

- **`WorkProfile` migration:** attendance/late-permission read `shiftStart` and the designation from
  `WorkProfile`. The migration must keep those reads working (either keep `shiftStart` on
  `WorkProfile` or migrate readers). Resolved in the implementation plan.
- **Two department concepts:** Huly's built-in `hr.class.Department` (tree) vs. our list. We use our
  own list and do not adopt `hr.mixin.Staff`; the "Worker" tag is retired.
- **Directory visibility of basic fields** relies on those fields being world-readable while full
  profiles are gated - the access-level split must be modeled carefully (basic fields on a
  low-access mixin, sensitive fields on higher-access mixins).
- **Retiring Contacts kinds** must not break recruit/lead if those apps are used elsewhere; scope the
  retirement to the employee views only.
