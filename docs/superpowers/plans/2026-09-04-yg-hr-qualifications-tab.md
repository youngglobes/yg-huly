# YG HR Qualifications tab - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Qualifications tab with five repeatable child-collection sections (Work Experience, Education, Skills, Languages, Licenses) and four admin reference lists, guarded HR-only.

**Architecture:** Five new `AttachedDoc` classes attached to `contact.mixin.Employee` (same shape as `EmergencyContact`), with per-section collection counters on `EmployeePersonal`. Four admin-list classes modeled/seeded/guarded like `Department`. A generalized child-collection write guard covers all six child classes; both guard layers (guard map + trigger `txMatch`) are wired. A new `QualificationsTab.svelte` reuses the `EmergencyTab.svelte` add/edit/remove pattern, five sections wide.

**Tech Stack:** Huly platform (TypeScript, Svelte 3, `@hcengineering/model` decorators, Rush monorepo), CockroachDB.

**Spec:** `docs/superpowers/specs/2026-09-04-yg-hr-qualifications-tab-design.md`

## Global Constraints

- **No em/en dashes anywhere** (code, comments, strings, commits). Hyphens fine. Banned: em dash, en dash, horizontal bar, figure dash, minus-as-punctuation.
- **TS/Svelte style:** no semicolons, 2-space indent, single quotes. Match surrounding code.
- **Validate:** `node common/scripts/install-run-rush.js validate --only <pkg>` (NEVER `--to model-all`). Packages: `@hcengineering/yg-hr`, `@hcengineering/yg-hr-assets`, `@hcengineering/yg-hr-resources`, `@hcengineering/model-yg-hr`, `@hcengineering/server-yg-hr-resources`, `@hcengineering/model-server-yg-hr`.
- **Model check after any `models/` change:** `cd models/all && rushx bundle`.
- All child/list fields optional => no per-employee data migration; migration only seeds three lists.
- **Enums (fixed, not admin lists):** `LanguageFluency = 'speaking' | 'writing' | 'reading'`; `LanguageCompetency = 'poor' | 'basic' | 'good' | 'mothertongue'` (label "Mother Tongue").
- **Collection names (exact):** `workExperience`, `educations`, `skills`, `languages`, `licenses`.
- **Two-layer guard rule (from sub-phase 1):** every new child class and every new list class must be BOTH in the server guard AND in the trigger `txMatch` registration in `models/server-yg-hr/src/index.ts`. A class missing from the `txMatch` never reaches the guard (dead code).
- Branch `feat/yg-hr-module`, repo root `/home/karthi_0008/dev/client-projects/yg-huly`.

Reference files to read before editing (do not re-derive their patterns):
`plugins/yg-hr/src/index.ts` (contract), `models/yg-hr/src/index.ts` (model incl. `TEmergencyContact`), `models/yg-hr/src/migration.ts` (`seedNames`, `tryUpgrade`), `plugins/yg-hr-resources/src/components/HrLists.svelte` (list card idiom), `plugins/yg-hr-resources/src/components/tabs/EmergencyTab.svelte` (child-collection editor idiom), `plugins/yg-hr-resources/src/components/tabs/JobTab.svelte` (ref `<select>` idiom), `server-plugins/yg-hr-resources/src/index.ts` (`guardEmergencyContactWrite`, `OnEmployeeHrGuard`, `GUARDED_MIXIN_FIELDS`, `HR_CONFIG_FIELDS`), `models/server-yg-hr/src/index.ts` (trigger `txMatch` registrations).

---

### Task 1: Plugin contract - enums, child + list types, collection counters, class + string ids

**Files:** Modify `plugins/yg-hr/src/index.ts`

**Interfaces produced:** the enums, the 5 child `AttachedDoc` interfaces, the 4 list type aliases, the 5 `EmployeePersonal` counters, `ygHr.class.{WorkExperience,Education,EmployeeSkill,EmployeeLanguage,EmployeeLicense,EducationLevel,SkillType,LanguageType,LicenseType}`, and the string ids used by Tasks 2/3/7/8.

- [ ] **Step 1: Enums + list aliases + child interfaces** (place near the other list aliases / `EmergencyContact`):
```ts
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
```
Ensure `AttachedDoc` is imported from `@hcengineering/core` (it is already used by `EmergencyContact` - confirm the import list includes it).

- [ ] **Step 2: Collection counters on `EmployeePersonal`** (add to the `EmployeePersonal` interface, next to `emergencyContacts?`):
```ts
  workExperience?: number
  educations?: number
  skills?: number
  languages?: number
  licenses?: number
```

- [ ] **Step 3: Class ids** (in the `class:` map, after `EmergencyContact`):
```ts
    WorkExperience: '' as Ref<Class<WorkExperience>>,
    Education: '' as Ref<Class<Education>>,
    EmployeeSkill: '' as Ref<Class<EmployeeSkill>>,
    EmployeeLanguage: '' as Ref<Class<EmployeeLanguage>>,
    EmployeeLicense: '' as Ref<Class<EmployeeLicense>>,
    EducationLevel: '' as Ref<Class<EducationLevel>>,
    SkillType: '' as Ref<Class<SkillType>>,
    LanguageType: '' as Ref<Class<LanguageType>>,
    LicenseType: '' as Ref<Class<LicenseType>>,
```

- [ ] **Step 4: String ids** (in the `string:` map):
```ts
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
    CompetencyMotherTongue: '' as IntlString,
```
Note: `LicenseType` is both a class id and a string id (different maps) - that is fine.

- [ ] **Step 5: Validate** `--only @hcengineering/yg-hr`. **Step 6: Commit** `feat(yg-hr): plugin contract for Qualifications sections + lists`.

---

### Task 2: Assets - English strings

**Files:** Modify `plugins/yg-hr-assets/lang/en.json`

- [ ] **Step 1:** add these keys (valid JSON, mind commas):
```json
    "Qualifications": "Qualifications",
    "WorkExperience": "Work Experience",
    "Educations": "Education",
    "Skills": "Skills",
    "Languages": "Languages",
    "Licenses": "Licenses",
    "Employer": "Employer",
    "JobTitle": "Job title",
    "FromDate": "From",
    "ToDate": "To",
    "Comments": "Comments",
    "Level": "Level",
    "Institute": "Institute",
    "Major": "Major/specialization",
    "Year": "Year",
    "Score": "Score",
    "StartDate": "Start date",
    "EndDate": "End date",
    "Skill": "Skill",
    "YearsOfExperience": "Years of experience",
    "Language": "Language",
    "Fluency": "Fluency",
    "Competency": "Competency",
    "LicenseType": "License type",
    "LicenseNo": "License no",
    "IssuedDate": "Issued date",
    "ExpiryDate": "Expiry date",
    "EducationLevels": "Education levels",
    "SkillTypes": "Skills",
    "LanguageTypes": "Languages",
    "LicenseTypes": "License types",
    "FluencySpeaking": "Speaking",
    "FluencyWriting": "Writing",
    "FluencyReading": "Reading",
    "CompetencyPoor": "Poor",
    "CompetencyBasic": "Basic",
    "CompetencyGood": "Good",
    "CompetencyMotherTongue": "Mother Tongue",
```
- [ ] **Step 2:** Validate `--only @hcengineering/yg-hr-assets`. **Step 3: Commit** `feat(yg-hr): en strings for Qualifications`.

---

### Task 3: Model - child + list classes, counters, registration

**Files:** Modify `models/yg-hr/src/index.ts`

- [ ] **Step 1:** import the new types (`WorkExperience, Education, EmployeeSkill, EmployeeLanguage, EmployeeLicense, EducationLevel, SkillType, LanguageType, LicenseType, LanguageFluency, LanguageCompetency`) in the `import type { ... } from '@hcengineering/yg-hr'` block.

- [ ] **Step 2:** add the four list classes (mirror `TLocation`):
```ts
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
```

- [ ] **Step 3:** add the five child `AttachedDoc` classes (mirror `TEmergencyContact`; `year`/`yearsOfExperience` use `TypeNumber()`, dates `TypeDate()`, refs `TypeRef()`, enums `TypeString()`):
```ts
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
```

- [ ] **Step 4:** add the five collection counters to `TEmployeePersonal` (after the `emergencyContacts` `@Prop`):
```ts
  @Prop(Collection(ygHr.class.WorkExperience), ygHr.string.WorkExperience) workExperience?: number
  @Prop(Collection(ygHr.class.Education), ygHr.string.Educations) educations?: number
  @Prop(Collection(ygHr.class.EmployeeSkill), ygHr.string.Skills) skills?: number
  @Prop(Collection(ygHr.class.EmployeeLanguage), ygHr.string.Languages) languages?: number
  @Prop(Collection(ygHr.class.EmployeeLicense), ygHr.string.Licenses) licenses?: number
```

- [ ] **Step 5:** register all 9 new classes in `createModel(builder)`'s `builder.createModel(...)` list (add `TWorkExperience, TEducation, TEmployeeSkill, TEmployeeLanguage, TEmployeeLicense, TEducationLevel, TSkillType, TLanguageType, TLicenseType`).

- [ ] **Step 6:** `cd models/all && rushx bundle` (must build) + validate `--only @hcengineering/model-yg-hr`. **Step 7: Commit** `feat(yg-hr): model Qualifications child collections + lists`.

---

### Task 4: Migration - seed the three non-empty lists

**Files:** Modify `models/yg-hr/src/migration.ts`

- [ ] **Step 1:** add type imports (`EducationLevel, LanguageType, LicenseType`) and seed constants:
```ts
// Seeded from ohrm_education / ohrm_language / ohrm_license in the OrangeHRM dump. Hyphens intentional.
const EDUCATION_LEVELS = ['UG - Under Graduate', 'PG - Post Graduate', 'Diploma', 'SSLC', 'HSC']
const LANGUAGE_TYPES = ['English', 'Tamil', 'Malayalam']
const LICENSE_TYPES = ['Driving License']
// SkillType is intentionally NOT seeded (HR populates it).
```

- [ ] **Step 2:** add the migration function:
```ts
async function migrateSeedQualificationLists (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await seedNames<EducationLevel>(ops, ygHr.class.EducationLevel, EDUCATION_LEVELS)
  await seedNames<LanguageType>(ops, ygHr.class.LanguageType, LANGUAGE_TYPES)
  await seedNames<LicenseType>(ops, ygHr.class.LicenseType, LICENSE_TYPES)
}
```

- [ ] **Step 3:** register a NEW `tryUpgrade` state at the end of the array:
```ts
      {
        // Seed the Qualifications admin lists (EducationLevel / LanguageType / LicenseType; Skills empty).
        state: 'seed-qualification-lists-0001',
        func: migrateSeedQualificationLists
      }
```

- [ ] **Step 4:** `cd models/all && rushx bundle`. **Step 5: Commit** `feat(yg-hr): seed Qualifications admin lists`.

---

### Task 5: Server guard - generalize the child guard + guard the four lists

**Files:** Modify `server-plugins/yg-hr-resources/src/index.ts`

- [ ] **Step 1:** import the new class types where `EmergencyContact` is imported (`WorkExperience` etc are not needed as types; the guard is generic over `AttachedDoc`). Add a guarded-child-class set near `GUARDED_MIXIN_FIELDS`:
```ts
// Every Employee child-collection class whose writes are HR-only (reverted for non-HR). All six route
// to the same generic child guard below.
const GUARDED_CHILD_CLASSES = new Set<Ref<Class<Doc>>>([
  ygHr.class.EmergencyContact,
  ygHr.class.WorkExperience,
  ygHr.class.Education,
  ygHr.class.EmployeeSkill,
  ygHr.class.EmployeeLanguage,
  ygHr.class.EmployeeLicense
])
```

- [ ] **Step 2:** generalize `guardEmergencyContactWrite` to `guardChildDocWrite` - change its signature to `async function guardChildDocWrite (cud: TxCUD<AttachedDoc>, control: TriggerControl): Promise<void>` and its two log messages from "EmergencyContact" to "child doc". The body is already generic (it only reads `cud` fields). Keep the existing behavior exactly. (Confirm `AttachedDoc` is imported from `@hcengineering/core`.)

- [ ] **Step 3:** route in `OnEmployeeHrGuard` - replace the EmergencyContact-only branch:
```ts
      if (GUARDED_CHILD_CLASSES.has(cud.objectClass)) {
        await guardChildDocWrite(cud as TxCUD<AttachedDoc>, control)
        continue
      }
```
(This replaces the `if (cud.objectClass === ygHr.class.EmergencyContact) { await guardEmergencyContactWrite(...) ; continue }` block.)

- [ ] **Step 4:** add the four list classes to `HR_CONFIG_FIELDS` (after the `TerminationReason` entry):
```ts
  [ygHr.class.EducationLevel]: ['name'],
  [ygHr.class.SkillType]: ['name'],
  [ygHr.class.LanguageType]: ['name'],
  [ygHr.class.LicenseType]: ['name']
```

- [ ] **Step 5:** add the five new counter fields to the `EmployeePersonal` entry of `GUARDED_MIXIN_FIELDS` (parity with `emergencyContacts`, which is already there): `'workExperience', 'educations', 'skills', 'languages', 'licenses'`.

- [ ] **Step 6:** Validate `--only @hcengineering/server-yg-hr-resources`. **Step 7: Commit** `feat(yg-hr): guard Qualifications child collections + admin lists`.

---

### Task 6: Server trigger registration - route the new classes to the guard

**Files:** Modify `models/server-yg-hr/src/index.ts`

**Why:** the guard only fires for classes registered in the trigger `txMatch`. This is the second layer sub-phase 1's review flagged; do it now for both the child classes and the list classes.

- [ ] **Step 1:** the child-collection registration currently is `txMatch: { objectClass: ygHr.class.EmergencyContact }`. Change it to an `$in` over all six child classes:
```ts
    txMatch: {
      objectClass: {
        $in: [
          ygHr.class.EmergencyContact,
          ygHr.class.WorkExperience,
          ygHr.class.Education,
          ygHr.class.EmployeeSkill,
          ygHr.class.EmployeeLanguage,
          ygHr.class.EmployeeLicense
        ]
      }
    }
```
Update the comment above it to say it covers all six Employee child-collection classes.

- [ ] **Step 2:** add the four new list classes to the HrConfig registration `$in` (the array that currently holds Department/Designation/EmploymentStatus/Location/TerminationReason): append `ygHr.class.EducationLevel, ygHr.class.SkillType, ygHr.class.LanguageType, ygHr.class.LicenseType`. Update the "five ... list classes" comment to nine.

- [ ] **Step 3:** `cd models/all && rushx bundle` + validate `--only @hcengineering/model-server-yg-hr`. **Step 4: Commit** `fix(yg-hr): register Qualifications classes with the guard triggers`.

---

### Task 7: HR Settings - manage the four Qualification lists

**Files:** Modify `plugins/yg-hr-resources/src/components/HrLists.svelte`

- [ ] **Step 1:** for EACH of `EducationLevel`, `SkillType`, `LanguageType`, `LicenseType`, add (mirroring the existing Location card exactly, per the file's established idiom): the `type` import, a `createQuery` + state array, a `$: sortedX = byName(...)`, a placeholder resolved via `translate`, a `newX` string, a `submitX` calling `addItem(ygHr.class.X, newX)`, and an `hs-card` block placed in `.hs-grid` after the TerminationReason card. Card titles: `ygHr.string.EducationLevels`, `SkillTypes`, `LanguageTypes`, `LicenseTypes`. No system-locked rows.

- [ ] **Step 2:** Validate `--only @hcengineering/yg-hr-resources`. **Step 3: Commit** `feat(yg-hr): manage Qualification lists in HR Settings`.

---

### Task 8: Qualifications tab UI + shell wiring

**Files:** Create `plugins/yg-hr-resources/src/components/tabs/QualificationsTab.svelte`; Modify `plugins/yg-hr-resources/src/components/EmployeeProfile.svelte`

**Pattern:** replicate `EmergencyTab.svelte`'s child-collection editor (per-row read view; when `editing`, an add-row control, per-row Edit/Remove, and an inline add/edit form with Save/Cancel using `client.addCollection(...)`, `client.update(doc, {...})`, `client.remove(doc)`). Reuse `ygHr.string.AddItem/RemoveItem/Edit/Save/Cancel/NoItemsYet`. Each section is its own `SectionCard ... full` inside one `.yg-cards`.

- [ ] **Step 1: shell** - in `EmployeeProfile.svelte`: import the four list types; add four `createQuery`s for `ygHr.class.EducationLevel/SkillType/LanguageType/LicenseType` into arrays; add `{ key: 'qualifications', label: ygHr.string.Qualifications }` to `TABS` and the `TabKey` union; add an `{:else if activeTab === 'qualifications'}` branch rendering `<QualificationsTab {employee} {editing} {educationLevels} {skillTypes} {languageTypes} {licenseTypes} />`; import `QualificationsTab`.

- [ ] **Step 2: QualificationsTab.svelte** - props `employee: Employee`, `editing: boolean`, and the four list arrays (`educationLevels: EducationLevel[]`, `skillTypes: SkillType[]`, `languageTypes: LanguageType[]`, `licenseTypes: LicenseType[]`). Query each child collection via `createQuery(ygHr.class.X, { attachedTo: employee._id }, cb)`. Build five sections. Each section follows EmergencyTab's add/edit/remove exactly, with these fields (all inputs use the `yg-input` class; ref/enum are `<select>`; dates `type="date"` with `dateToInput`/`inputToDate` from `utils/profile`; numbers `type="number"`; on read-only show `FieldRow`-style rows or a compact line, matching EmergencyTab's read row):

  - **Work Experience** (`ygHr.class.WorkExperience`, collection `'workExperience'`): employer (text), jobTitle (text), fromDate (date), toDate (date), comments (text).
  - **Education** (`ygHr.class.Education`, collection `'educations'`): level (`<select>` over `educationLevels`, `value=""` clears), institute (text), major (text), year (number), score (text), startDate (date), endDate (date).
  - **Skills** (`ygHr.class.EmployeeSkill`, collection `'skills'`): skill (`<select>` over `skillTypes`), yearsOfExperience (number), comments (text).
  - **Languages** (`ygHr.class.EmployeeLanguage`, collection `'languages'`): language (`<select>` over `languageTypes`), fluency (`<select>` fixed options: `speaking`/`writing`/`reading` -> `ygHr.string.FluencySpeaking/Writing/Reading`), competency (`<select>` fixed options: `poor`/`basic`/`good`/`mothertongue` -> `ygHr.string.CompetencyPoor/Basic/Good/MotherTongue`), comments (text).
  - **Licenses** (`ygHr.class.EmployeeLicense`, collection `'licenses'`): licenseType (`<select>` over `licenseTypes`), licenseNo (text), issuedDate (date), expiryDate (date).

  For each save, build the `AttachedData<T>` / update object trimming empty strings to `undefined` and mapping `''` selects to `undefined` (same idiom as EmergencyTab's `submitAdd` and JobTab's `saveRole`). Ref values cast `as Ref<...>`. `addCollection` uses `attachedToClass = contact.mixin.Employee` and the exact collection name.

  Enum/ref read-only display: resolve the ref to its list name (`list.find(x => x._id === row.level)?.name`) and the enum to its label string; render nothing / a muted dash when unset.

- [ ] **Step 3:** Validate `--only @hcengineering/yg-hr-resources` (must pass eslint too: no unused imports). **Step 4: Commit** `feat(yg-hr): Qualifications tab with five child-collection sections`.

---

### Task 9: (Deploy - combined with sub-phase 1, HELD)

Deploy is a single combined beta build + `upgrade-workspace` covering BOTH sub-phase 1 and this sub-phase, then manual test of both. HELD for explicit user go-ahead; do NOT run it as part of this plan's automated execution. When authorized, follow the deploy + test steps in the sub-phase 1 plan plus this spec's section 8.

---

## Notes for the executor

- After every `models/` edit run `cd models/all && rushx bundle`.
- Never `rush validate --to model-all`; use `--only <pkg>`.
- Follow the exact idioms in `EmergencyTab.svelte` / `HrLists.svelte` / `JobTab.svelte` - do not invent new field-rendering styles.
- Both guard layers (Tasks 5 and 6) are required for the guard to actually fire - neither alone is sufficient.
