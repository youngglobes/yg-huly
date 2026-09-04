# YG HR - Qualifications tab (sub-phase 2)

- **Date:** 2026-09-04
- **Status:** Approved design, ready for implementation planning
- **Owner:** YG platform (yg-huly fork), branch `feat/yg-hr-module`
- **Parent:** `2026-09-02-yg-hr-employee-module-design.md`; follows sub-phase 1
  (`2026-09-04-yg-hr-personal-job-fields-attachments-design.md`)
- **Portal source of truth:** the live OrangeHRM dump at
  `client-projects/hr.youngglobe.com/hryoungg_OrangeHRM-02-05-26.sql` (tables `hs_hr_emp_work_experience`,
  `ohrm_emp_education`+`ohrm_education`, `hs_hr_emp_skill`+`ohrm_skill`, `hs_hr_emp_language`+`ohrm_language`,
  `ohrm_emp_license`+`ohrm_license`).

## 1. Goal

Add the HR portal's **Qualifications** tab: five repeatable child-collection sections on an employee
(Work Experience, Education, Skills, Languages, Licenses) plus their four admin-managed reference lists.
Reuses the established `EmergencyContact` child-collection pattern and the admin-list machinery, so this
is the same shapes as the rest of the module, five sections wide.

## 2. Scope decisions (agreed)

- **Field set = YG-used subset.** Skip the Work Experience `internal` flag and the `ohrm_skill.description`
  column (unused). Keep the practical fields below.
- **Fluency / competency are fixed enums**, not admin lists (matches OrangeHRM):
  - fluency: Speaking / Writing / Reading
  - competency: Poor / Basic / Good / Mother Tongue
- **SkillType list ships empty**; HR populates it (the portal's skill list is large and malformed).
- **No file attachments** on Qualifications rows this sub-phase.

## 3. Data model - five child-collection classes

New `AttachedDoc` classes in `DOMAIN_YG_HR`, attached to `contact.mixin.Employee` (same shape as
`EmergencyContact`: `TAttachedDoc`, `attachedTo = employee._id`, one collection name each). All fields
optional so a partial row is valid. Collection names in parentheses:

- **`WorkExperience`** (`workExperience`): `employer?`, `jobTitle?`, `fromDate?: Timestamp`,
  `toDate?: Timestamp`, `comments?`.
- **`Education`** (`educations`): `level?: Ref<EducationLevel>`, `institute?`, `major?`, `year?: number`,
  `score?`, `startDate?: Timestamp`, `endDate?: Timestamp`.
- **`EmployeeSkill`** (`skills`): `skill?: Ref<SkillType>`, `yearsOfExperience?: number`, `comments?`.
- **`EmployeeLanguage`** (`languages`): `language?: Ref<LanguageType>`, `fluency?: LanguageFluency`,
  `competency?: LanguageCompetency`, `comments?`.
- **`EmployeeLicense`** (`licenses`): `licenseType?: Ref<LicenseType>`, `licenseNo?`,
  `issuedDate?: Timestamp`, `expiryDate?: Timestamp`.

Enums (string unions, stored as the value, shown as the label):
- `LanguageFluency = 'speaking' | 'writing' | 'reading'`
- `LanguageCompetency = 'poor' | 'basic' | 'good' | 'mothertongue'` (label "Mother Tongue")

The child-collection counter props follow the `EmergencyContact` idiom: a `@Prop(Collection(...))`
counter for each, declared on a new `EmployeeQualifications` mixin on `contact.mixin.Employee` (keeps the
five counters namespaced to this tab rather than swelling `EmployeePersonal`). The implementation plan
confirms this against the exact `EmergencyContact` registration.

## 4. Admin-managed lists (four)

Modeled and seeded exactly like `Department` / `EmploymentStatus` (config-doc classes in
`core.space.Workspace`, HR-editable in `HrLists.svelte`, seeded idempotently, guarded server-side):

- **`EducationLevel`** - seed: UG - Under Graduate, PG - Post Graduate, Diploma, SSLC, HSC
- **`LanguageType`** - seed: English, Tamil, Malayalam
- **`LicenseType`** - seed: Driving License
- **`SkillType`** - seed: (none; HR adds)

## 5. Server-side guards (parity with the rest of the module)

Both guard layers, matching sub-phase 1's lesson:
- **Child collections:** a revert-on-unauthorized-write guard for each of the five new `AttachedDoc`
  classes (same rule as `guardEmergencyContactWrite`: HR/admin only), and each class added to the guard
  trigger's `txMatch` (the `EmergencyContact` registration in `models/server-yg-hr/src/index.ts` becomes
  an `$in` over all six child classes).
- **Admin lists:** each of the four new list classes added to `HR_CONFIG_FIELDS` AND to the HrConfig
  trigger `txMatch` `$in` in `models/server-yg-hr/src/index.ts` (the same two-layer wiring that the
  sub-phase 1 review caught as easy to miss).

## 6. UI

- **New `Qualifications` tab** added to `EmployeeProfile.svelte`'s tab bar and pane (after Emergency).
- **`QualificationsTab.svelte`**: five `SectionCard`s, each a repeatable child-collection editor built on
  the existing `EmergencyTab.svelte` pattern (a list of rows; when `editing`, each row is inline-editable
  and there is an add-row control and a per-row remove). Ref fields render as `<select>`s over the admin
  lists; enum fields as fixed `<select>`s; dates as `type="date"`; numbers as `type="number"`.
- Admin-list data (EducationLevel/SkillType/LanguageType/LicenseType) is queried in the shell (like the
  Job tab's lists) and passed to the tab, or queried in the tab directly - resolved in the plan.
- Read-only rendering (calm `FieldRow`-style rows) when not editing, matching the other tabs.

## 7. Model change, migration, deploy

- New classes (5 child + 4 list + 1 mixin) => **model change** => build + `upgrade-workspace`.
- All new => **no per-employee data migration**; migration only **seeds the three non-empty lists** in a
  new idempotent `tryUpgrade` state.
- Packages: `plugins/yg-hr`, `plugins/yg-hr-assets`, `plugins/yg-hr-resources`, `models/yg-hr`,
  `server-plugins/yg-hr-resources`, `models/server-yg-hr`.
- **Deploy note:** this sub-phase ships together with sub-phase 1 in ONE beta build + `upgrade-workspace`
  (user decision), then both are tested together.

## 8. Testing (beta, after build + upgrade-workspace)

1. HR Settings shows the four new lists; the three seeded ones carry their values, SkillType is empty and
   HR can add to it.
2. On an employee, Qualifications tab: add a row in each of the five sections (using seeded refs where
   applicable), save, reload -> all persist.
3. Ref selects resolve to names read-only; enum selects (fluency/competency) show the labels.
4. Remove a row -> gone after reload.
5. A non-HR viewer sees the rows read-only with no add/edit/remove controls; a direct API write by a
   non-HR member is reverted (guard).

## 9. Out of scope / follow-ups

- File attachments on Qualifications rows.
- The remaining sub-phases (Dependents, Immigration, Memberships, Salary).
- OrangeHRM bulk data import (roadmap phase 7).
