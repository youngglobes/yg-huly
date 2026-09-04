# YG HR - Personal & Job extra fields + attachments (sub-phase 1)

- **Date:** 2026-09-04
- **Status:** Approved design, ready for implementation planning
- **Owner:** YG platform (yg-huly fork), branch `feat/yg-hr-module`
- **Parent:** `2026-09-02-yg-hr-employee-module-design.md` (the module this extends)
- **Portal source of truth:** the live OrangeHRM dump at
  `client-projects/hr.youngglobe.com/hryoungg_OrangeHRM-02-05-26.sql` (table `hs_hr_employee`
  and friends). This is what "check the fields in the HR portal" resolves to.

## 1. Goal

First of the "match the HR portal" sub-phases. Extend the two existing profile tabs (Personal, Job)
with the portal fields YG actually uses, and add a reusable per-section file-attachment capability.
Later sub-phases (Dependents, Immigration, Qualifications, Memberships, Salary) reuse the attachment
pattern this establishes and are out of scope here.

## 2. Scope decisions (agreed)

- **Field set = YG-used subset**, not a faithful 1:1 of the portal. Skip the US-centric leftovers in
  `hs_hr_employee` (SSN, SIN, smoker, ethnicity, military service) and the redundant ones.
- **`jobCategory` is dropped.** In the portal it is a separate list (`ohrm_job_category`), but for YG
  it duplicates Designation, so it is not added.
- **Termination is pure record-keeping.** Filling `terminationDate` / `terminationReason` does NOT
  change the employee's lifecycle status. Deactivation stays the existing, separate control (status
  -> deactivated revokes login). The portal also keeps termination separate from status.

## 3. New fields

Added to the existing mixins (all optional, so no data migration for existing employees):

- **`EmployeePersonal`** (`plugins/yg-hr/src/index.ts`):
  - `nickname?: string` (portal `emp_nick_name`)
  - `otherId?: string` (portal `emp_other_id`)
  - `driverLicenseNo?: string` (portal `emp_dri_lice_num`)
  - `driverLicenseExpiry?: Timestamp` (portal `emp_dri_lice_exp_date`)
- **`EmployeeJob`**:
  - `terminationDate?: Timestamp` (termination effective date; portal `ohrm_emp_termination.terminated_date`)
  - `terminationReason?: Ref<TerminationReason>` (portal `ohrm_emp_termination` + `ohrm_emp_termination_reason`)

## 4. New admin-managed list

One only (JobCategory is dropped): **`TerminationReason`**, modeled and seeded exactly like the
existing `Department` / `EmploymentStatus` / `Location` lists (a config doc class scoped to
`core.space.Workspace`, HR-editable in `HrLists.svelte`, seeded idempotently in
`models/yg-hr/src/migration.ts`).

- Class: `ygHr.class.TerminationReason` with `name: string`.
- Seed values (from `ohrm_emp_termination_reason` in the dump): Other, Retired, Contract Not Renewed,
  Resigned, Resigned - Company Requested, Resigned - Self Proposed, Deceased, Physically
  Disabled/Compensated, Laid-off, Dismissed.
- `HrLists.svelte` gains a section to add/rename/remove these (no system-locked entries, unlike
  Designation).

## 5. Attachments per section

**Reuse Huly's `@hcengineering/attachment`** (the `Attachment` AttachedDoc class, blob storage,
presenters, and the `TxAccessLevel` model already exist). Do NOT build a bespoke attachment class.

- Attachments hang off the `Employee` as `attachment.class.Attachment` AttachedDocs, separated per
  section by **distinct collection names**: `personalFiles` and `jobFiles`. Distinct collections
  keep Personal and Job files from bleeding into each other and let each tab query only its own.
- A new `SectionAttachments.svelte` in `plugins/yg-hr-resources` takes `{ employee, collection,
  canEdit }` and drives list / upload / download / remove for that one collection, reusing the
  shared blob upload helper (`@hcengineering/presentation`) and `AttachmentPresenter` for rendering.
  Rendered at the bottom of the Personal and Job tab panes.
- **Access:** HR/admin (the tab's existing `editing` + `canEdit` gate) can add and remove; anyone who
  can view the tab can download. This is client-gated for now. Server-side enforcement of attachment
  writes is a **tracked follow-up hardening** (the module's other sections are in the same posture),
  NOT silently skipped: noted here and to be closed before the module governs anything sensitive.

## 6. UI

- **Personal tab** (`tabs/PersonalTab.svelte`): `nickname` and `otherId` fold into the existing
  Identity/Details cards; driver's license (`driverLicenseNo` + `driverLicenseExpiry`) as a small
  paired group. A calm Attachments card at the bottom (`SectionAttachments collection="personalFiles"`).
- **Job tab** (`tabs/JobTab.svelte`): a Termination group (date + reason select from the new list),
  shown as normal editable fields. Attachments card at the bottom (`collection="jobFiles"`).
- Read-only FieldRow rendering when not editing, inline editors when `editing`, matching every other
  field in these tabs.

## 7. Model change, migration, deploy

- New classes/fields => **model change** => build + `upgrade-workspace` (beta first, then prod later).
- New fields optional => **no per-employee data migration**; migration only **seeds
  `TerminationReason`** (idempotent, same guard style as the current list seeds).
- Front + model packages: `plugins/yg-hr`, `plugins/yg-hr-resources`, `plugins/yg-hr-assets`,
  `models/yg-hr`. No server-plugin change (no new trigger; attachments reuse existing infra).

## 8. Testing

On beta after build + `upgrade-workspace`:

1. Edit an employee, fill nickname / other id / driver's license (+ expiry), save, reload -> persists.
2. Fill Job termination date + reason (from the seeded list), save, reload -> persists; confirm the
   employee's status is unchanged (record-keeping only).
3. Upload a file to Personal and a different file to Job; reload -> both persist and stay in their own
   sections (no cross-bleed).
4. As a non-HR viewer, confirm the files are downloadable but the add/remove controls are absent.

## 9. Out of scope / follow-ups

- Server-side enforcement of attachment add/remove (tracked hardening above).
- Dependents, Immigration, Qualifications, Memberships, Salary sub-phases (each its own spec/plan).
- The remaining faithful-1:1 portal fields (SSN/SIN/smoker/ethnicity/military) - intentionally omitted.
