<!--
// Copyright © 2026 YoungGlobes
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<!--
  Qualifications tab (sub-phase 2, Task 8): five child collections on the Employee (Work
  Experience, Education, Skills, Languages, Licenses - ygHr.class.WorkExperience/Education/
  EmployeeSkill/EmployeeLanguage/EmployeeLicense, all attachedTo the Employee), each its own
  SectionCard using the exact same add/edit/remove idiom as EmergencyTab.svelte: a plain read-only
  list; while the profile-wide `editing` flag is on, an "Add" control, per-row Edit/Remove, and an
  inline add/edit form with its own Save/Cancel (the inherent commit step for a brand-new
  collection item, not a competing whole-card edit toggle). Four fields (Education.level,
  EmployeeSkill.skill, EmployeeLanguage.language, EmployeeLicense.licenseType) are refs into the
  admin-managed lists (educationLevels/skillTypes/languageTypes/licenseTypes), passed down by the
  shell (EmployeeProfile.svelte) exactly like Job tab's designation/department/etc; fluency and
  competency are fixed enums, not admin lists. The server-side OnEmployeeHrGuard trigger is the
  real authorization boundary - this UI gate just keeps the affordance out of casual reach, same as
  every other tab.
-->
<script lang="ts">
  import type { Employee } from '@hcengineering/contact'
  import contact from '@hcengineering/contact'
  import type { AttachedData, Ref } from '@hcengineering/core'
  import { translate, type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygHr, {
    type Education,
    type EducationLevel,
    type EmployeeLanguage,
    type EmployeeLicense,
    type EmployeeSkill,
    type LanguageCompetency,
    type LanguageFluency,
    type LanguageType,
    type LicenseType,
    type SkillType,
    type WorkExperience
  } from '@hcengineering/yg-hr'
  import SectionCard from '../SectionCard.svelte'
  import { dateToInput, formatDisplayDate, inputToDate } from '../../utils/profile'

  export let employee: Employee
  export let editing: boolean
  export let educationLevels: EducationLevel[]
  export let skillTypes: SkillType[]
  export let languageTypes: LanguageType[]
  export let licenseTypes: LicenseType[]

  const client = getClient()

  let workExperiences: WorkExperience[] = []
  const weQuery = createQuery()
  $: weQuery.query(ygHr.class.WorkExperience, { attachedTo: employee._id }, (res) => { workExperiences = res })

  let educations: Education[] = []
  const eduQuery = createQuery()
  $: eduQuery.query(ygHr.class.Education, { attachedTo: employee._id }, (res) => { educations = res })

  let skills: EmployeeSkill[] = []
  const skillQuery = createQuery()
  $: skillQuery.query(ygHr.class.EmployeeSkill, { attachedTo: employee._id }, (res) => { skills = res })

  let languages: EmployeeLanguage[] = []
  const langQuery = createQuery()
  $: langQuery.query(ygHr.class.EmployeeLanguage, { attachedTo: employee._id }, (res) => { languages = res })

  let licenses: EmployeeLicense[] = []
  const licQuery = createQuery()
  $: licQuery.query(ygHr.class.EmployeeLicense, { attachedTo: employee._id }, (res) => { licenses = res })

  // Shared save-time coercion: blank text -> undefined, blank numeric text -> undefined (NaN also
  // treated as unset - a stray non-numeric paste shouldn't wedge the save).
  function strOrUndef (v: string): string | undefined {
    const t = v.trim()
    return t === '' ? undefined : t
  }
  function numOrUndef (v: string, parser: (s: string) => number): number | undefined {
    const t = v.trim()
    if (t === '') return undefined
    const n = parser(t)
    return Number.isNaN(n) ? undefined : n
  }

  // <input placeholder> can't bind a <Label> component directly - resolve once, same idiom
  // EmergencyTab.svelte / HrLists.svelte use for their own add-form placeholders.
  let employerPlaceholder = ''
  let jobTitlePlaceholder = ''
  let commentsPlaceholder = ''
  let levelPlaceholder = ''
  let institutePlaceholder = ''
  let majorPlaceholder = ''
  let yearPlaceholder = ''
  let scorePlaceholder = ''
  let skillPlaceholder = ''
  let yearsOfExperiencePlaceholder = ''
  let languagePlaceholder = ''
  let fluencyPlaceholder = ''
  let competencyPlaceholder = ''
  let licenseTypePlaceholder = ''
  let licenseNoPlaceholder = ''
  void translate(ygHr.string.Employer, {}).then((r) => { employerPlaceholder = r })
  void translate(ygHr.string.JobTitle, {}).then((r) => { jobTitlePlaceholder = r })
  void translate(ygHr.string.Comments, {}).then((r) => { commentsPlaceholder = r })
  void translate(ygHr.string.Level, {}).then((r) => { levelPlaceholder = r })
  void translate(ygHr.string.Institute, {}).then((r) => { institutePlaceholder = r })
  void translate(ygHr.string.Major, {}).then((r) => { majorPlaceholder = r })
  void translate(ygHr.string.Year, {}).then((r) => { yearPlaceholder = r })
  void translate(ygHr.string.Score, {}).then((r) => { scorePlaceholder = r })
  void translate(ygHr.string.Skill, {}).then((r) => { skillPlaceholder = r })
  void translate(ygHr.string.YearsOfExperience, {}).then((r) => { yearsOfExperiencePlaceholder = r })
  void translate(ygHr.string.Language, {}).then((r) => { languagePlaceholder = r })
  void translate(ygHr.string.Fluency, {}).then((r) => { fluencyPlaceholder = r })
  void translate(ygHr.string.Competency, {}).then((r) => { competencyPlaceholder = r })
  void translate(ygHr.string.LicenseType, {}).then((r) => { licenseTypePlaceholder = r })
  void translate(ygHr.string.LicenseNo, {}).then((r) => { licenseNoPlaceholder = r })

  // Fluency/competency are fixed enums (not admin lists) - their <option> labels need the same
  // one-shot translate-to-string idiom, since a <select>'s <option> can't host a <Label>.
  let fluencySpeakingLabel = ''
  let fluencyWritingLabel = ''
  let fluencyReadingLabel = ''
  let competencyPoorLabel = ''
  let competencyBasicLabel = ''
  let competencyGoodLabel = ''
  let competencyMotherTongueLabel = ''
  void translate(ygHr.string.FluencySpeaking, {}).then((r) => { fluencySpeakingLabel = r })
  void translate(ygHr.string.FluencyWriting, {}).then((r) => { fluencyWritingLabel = r })
  void translate(ygHr.string.FluencyReading, {}).then((r) => { fluencyReadingLabel = r })
  void translate(ygHr.string.CompetencyPoor, {}).then((r) => { competencyPoorLabel = r })
  void translate(ygHr.string.CompetencyBasic, {}).then((r) => { competencyBasicLabel = r })
  void translate(ygHr.string.CompetencyGood, {}).then((r) => { competencyGoodLabel = r })
  void translate(ygHr.string.CompetencyMotherTongue, {}).then((r) => { competencyMotherTongueLabel = r })

  function fluencyLabel (v: LanguageFluency | undefined): string | undefined {
    if (v === 'speaking') return fluencySpeakingLabel
    if (v === 'writing') return fluencyWritingLabel
    if (v === 'reading') return fluencyReadingLabel
    return undefined
  }
  function competencyLabel (v: LanguageCompetency | undefined): string | undefined {
    if (v === 'poor') return competencyPoorLabel
    if (v === 'basic') return competencyBasicLabel
    if (v === 'good') return competencyGoodLabel
    if (v === 'mothertongue') return competencyMotherTongueLabel
    return undefined
  }

  // Read-only row rendering: each row's set fields, label + resolved display value, in field order.
  // Refs resolve to their list's name; enums resolve to their translated label; unset fields are
  // simply omitted from the row (matching FieldRow's "omit rather than show empty" spirit without
  // pulling in FieldGroup's two-column layout, which doesn't fit a variable-length row).
  interface QField { label: IntlString, value: string, mono?: boolean }

  function weFields (row: WorkExperience): QField[] {
    const out: QField[] = []
    if (row.jobTitle != null && row.jobTitle !== '') out.push({ label: ygHr.string.JobTitle, value: row.jobTitle })
    if (row.employer != null && row.employer !== '') out.push({ label: ygHr.string.Employer, value: row.employer })
    const from = formatDisplayDate(row.fromDate)
    const to = formatDisplayDate(row.toDate)
    if (from !== undefined) out.push({ label: ygHr.string.FromDate, value: from, mono: true })
    if (to !== undefined) out.push({ label: ygHr.string.ToDate, value: to, mono: true })
    if (row.comments != null && row.comments !== '') out.push({ label: ygHr.string.Comments, value: row.comments })
    return out
  }

  function eduFields (row: Education): QField[] {
    const out: QField[] = []
    const levelName = educationLevels.find((l) => l._id === row.level)?.name
    if (levelName !== undefined) out.push({ label: ygHr.string.Level, value: levelName })
    if (row.institute != null && row.institute !== '') out.push({ label: ygHr.string.Institute, value: row.institute })
    if (row.major != null && row.major !== '') out.push({ label: ygHr.string.Major, value: row.major })
    if (row.year != null) out.push({ label: ygHr.string.Year, value: String(row.year), mono: true })
    if (row.score != null && row.score !== '') out.push({ label: ygHr.string.Score, value: row.score })
    const start = formatDisplayDate(row.startDate)
    const end = formatDisplayDate(row.endDate)
    if (start !== undefined) out.push({ label: ygHr.string.StartDate, value: start, mono: true })
    if (end !== undefined) out.push({ label: ygHr.string.EndDate, value: end, mono: true })
    return out
  }

  function skillFields (row: EmployeeSkill): QField[] {
    const out: QField[] = []
    const skillName = skillTypes.find((t) => t._id === row.skill)?.name
    if (skillName !== undefined) out.push({ label: ygHr.string.Skill, value: skillName })
    if (row.yearsOfExperience != null) {
      out.push({ label: ygHr.string.YearsOfExperience, value: String(row.yearsOfExperience), mono: true })
    }
    if (row.comments != null && row.comments !== '') out.push({ label: ygHr.string.Comments, value: row.comments })
    return out
  }

  function langFields (row: EmployeeLanguage): QField[] {
    const out: QField[] = []
    const languageName = languageTypes.find((t) => t._id === row.language)?.name
    if (languageName !== undefined) out.push({ label: ygHr.string.Language, value: languageName })
    const fluency = fluencyLabel(row.fluency)
    if (fluency !== undefined) out.push({ label: ygHr.string.Fluency, value: fluency })
    const competency = competencyLabel(row.competency)
    if (competency !== undefined) out.push({ label: ygHr.string.Competency, value: competency })
    if (row.comments != null && row.comments !== '') out.push({ label: ygHr.string.Comments, value: row.comments })
    return out
  }

  function licFields (row: EmployeeLicense): QField[] {
    const out: QField[] = []
    const typeName = licenseTypes.find((t) => t._id === row.licenseType)?.name
    if (typeName !== undefined) out.push({ label: ygHr.string.LicenseType, value: typeName })
    if (row.licenseNo != null && row.licenseNo !== '') out.push({ label: ygHr.string.LicenseNo, value: row.licenseNo })
    const issued = formatDisplayDate(row.issuedDate)
    const expiry = formatDisplayDate(row.expiryDate)
    if (issued !== undefined) out.push({ label: ygHr.string.IssuedDate, value: issued, mono: true })
    if (expiry !== undefined) out.push({ label: ygHr.string.ExpiryDate, value: expiry, mono: true })
    return out
  }

  // --- Work Experience ---------------------------------------------------
  let weAdding = false
  let weEditingId: string | undefined
  let fWeEmployer = ''
  let fWeJobTitle = ''
  let fWeFromDate = ''
  let fWeToDate = ''
  let fWeComments = ''

  function resetWeForm (): void {
    fWeEmployer = ''
    fWeJobTitle = ''
    fWeFromDate = ''
    fWeToDate = ''
    fWeComments = ''
  }
  function beginAddWe (): void {
    resetWeForm()
    weEditingId = undefined
    weAdding = true
  }
  function beginEditWe (row: WorkExperience): void {
    fWeEmployer = row.employer ?? ''
    fWeJobTitle = row.jobTitle ?? ''
    fWeFromDate = dateToInput(row.fromDate)
    fWeToDate = dateToInput(row.toDate)
    fWeComments = row.comments ?? ''
    weEditingId = row._id
    weAdding = false
  }
  function cancelWe (): void {
    weAdding = false
    weEditingId = undefined
  }
  async function submitAddWe (): Promise<void> {
    const data: AttachedData<WorkExperience> = {
      employer: strOrUndef(fWeEmployer),
      jobTitle: strOrUndef(fWeJobTitle),
      fromDate: inputToDate(fWeFromDate),
      toDate: inputToDate(fWeToDate),
      comments: strOrUndef(fWeComments)
    }
    await client.addCollection(
      ygHr.class.WorkExperience,
      employee.space,
      employee._id,
      contact.mixin.Employee,
      'workExperience',
      data
    )
    weAdding = false
    resetWeForm()
  }
  async function submitEditWe (row: WorkExperience): Promise<void> {
    await client.update(row, {
      employer: strOrUndef(fWeEmployer),
      jobTitle: strOrUndef(fWeJobTitle),
      fromDate: inputToDate(fWeFromDate),
      toDate: inputToDate(fWeToDate),
      comments: strOrUndef(fWeComments)
    })
    weEditingId = undefined
    resetWeForm()
  }
  async function removeWe (row: WorkExperience): Promise<void> {
    await client.remove(row)
  }

  // --- Education -----------------------------------------------------------
  let eduAdding = false
  let eduEditingId: string | undefined
  let fEduLevel = ''
  let fEduInstitute = ''
  let fEduMajor = ''
  let fEduYear = ''
  let fEduScore = ''
  let fEduStartDate = ''
  let fEduEndDate = ''

  function resetEduForm (): void {
    fEduLevel = ''
    fEduInstitute = ''
    fEduMajor = ''
    fEduYear = ''
    fEduScore = ''
    fEduStartDate = ''
    fEduEndDate = ''
  }
  function beginAddEdu (): void {
    resetEduForm()
    eduEditingId = undefined
    eduAdding = true
  }
  function beginEditEdu (row: Education): void {
    fEduLevel = row.level ?? ''
    fEduInstitute = row.institute ?? ''
    fEduMajor = row.major ?? ''
    fEduYear = row.year != null ? String(row.year) : ''
    fEduScore = row.score ?? ''
    fEduStartDate = dateToInput(row.startDate)
    fEduEndDate = dateToInput(row.endDate)
    eduEditingId = row._id
    eduAdding = false
  }
  function cancelEdu (): void {
    eduAdding = false
    eduEditingId = undefined
  }
  async function submitAddEdu (): Promise<void> {
    const data: AttachedData<Education> = {
      level: fEduLevel === '' ? undefined : (fEduLevel as Ref<EducationLevel>),
      institute: strOrUndef(fEduInstitute),
      major: strOrUndef(fEduMajor),
      year: numOrUndef(fEduYear, (str) => Number.parseInt(str, 10)),
      score: strOrUndef(fEduScore),
      startDate: inputToDate(fEduStartDate),
      endDate: inputToDate(fEduEndDate)
    }
    await client.addCollection(
      ygHr.class.Education,
      employee.space,
      employee._id,
      contact.mixin.Employee,
      'educations',
      data
    )
    eduAdding = false
    resetEduForm()
  }
  async function submitEditEdu (row: Education): Promise<void> {
    await client.update(row, {
      level: fEduLevel === '' ? undefined : (fEduLevel as Ref<EducationLevel>),
      institute: strOrUndef(fEduInstitute),
      major: strOrUndef(fEduMajor),
      year: numOrUndef(fEduYear, (str) => Number.parseInt(str, 10)),
      score: strOrUndef(fEduScore),
      startDate: inputToDate(fEduStartDate),
      endDate: inputToDate(fEduEndDate)
    })
    eduEditingId = undefined
    resetEduForm()
  }
  async function removeEdu (row: Education): Promise<void> {
    await client.remove(row)
  }

  // --- Skills ----------------------------------------------------------------
  let skAdding = false
  let skEditingId: string | undefined
  let fSkSkill = ''
  let fSkYears = ''
  let fSkComments = ''

  function resetSkForm (): void {
    fSkSkill = ''
    fSkYears = ''
    fSkComments = ''
  }
  function beginAddSk (): void {
    resetSkForm()
    skEditingId = undefined
    skAdding = true
  }
  function beginEditSk (row: EmployeeSkill): void {
    fSkSkill = row.skill ?? ''
    fSkYears = row.yearsOfExperience != null ? String(row.yearsOfExperience) : ''
    fSkComments = row.comments ?? ''
    skEditingId = row._id
    skAdding = false
  }
  function cancelSk (): void {
    skAdding = false
    skEditingId = undefined
  }
  async function submitAddSk (): Promise<void> {
    const data: AttachedData<EmployeeSkill> = {
      skill: fSkSkill === '' ? undefined : (fSkSkill as Ref<SkillType>),
      yearsOfExperience: numOrUndef(fSkYears, (str) => Number.parseFloat(str)),
      comments: strOrUndef(fSkComments)
    }
    await client.addCollection(
      ygHr.class.EmployeeSkill,
      employee.space,
      employee._id,
      contact.mixin.Employee,
      'skills',
      data
    )
    skAdding = false
    resetSkForm()
  }
  async function submitEditSk (row: EmployeeSkill): Promise<void> {
    await client.update(row, {
      skill: fSkSkill === '' ? undefined : (fSkSkill as Ref<SkillType>),
      yearsOfExperience: numOrUndef(fSkYears, (str) => Number.parseFloat(str)),
      comments: strOrUndef(fSkComments)
    })
    skEditingId = undefined
    resetSkForm()
  }
  async function removeSk (row: EmployeeSkill): Promise<void> {
    await client.remove(row)
  }

  // --- Languages -----------------------------------------------------------
  let lgAdding = false
  let lgEditingId: string | undefined
  let fLgLanguage = ''
  let fLgFluency = ''
  let fLgCompetency = ''
  let fLgComments = ''

  function resetLgForm (): void {
    fLgLanguage = ''
    fLgFluency = ''
    fLgCompetency = ''
    fLgComments = ''
  }
  function beginAddLg (): void {
    resetLgForm()
    lgEditingId = undefined
    lgAdding = true
  }
  function beginEditLg (row: EmployeeLanguage): void {
    fLgLanguage = row.language ?? ''
    fLgFluency = row.fluency ?? ''
    fLgCompetency = row.competency ?? ''
    fLgComments = row.comments ?? ''
    lgEditingId = row._id
    lgAdding = false
  }
  function cancelLg (): void {
    lgAdding = false
    lgEditingId = undefined
  }
  async function submitAddLg (): Promise<void> {
    const data: AttachedData<EmployeeLanguage> = {
      language: fLgLanguage === '' ? undefined : (fLgLanguage as Ref<LanguageType>),
      fluency: fLgFluency === '' ? undefined : (fLgFluency as LanguageFluency),
      competency: fLgCompetency === '' ? undefined : (fLgCompetency as LanguageCompetency),
      comments: strOrUndef(fLgComments)
    }
    await client.addCollection(
      ygHr.class.EmployeeLanguage,
      employee.space,
      employee._id,
      contact.mixin.Employee,
      'languages',
      data
    )
    lgAdding = false
    resetLgForm()
  }
  async function submitEditLg (row: EmployeeLanguage): Promise<void> {
    await client.update(row, {
      language: fLgLanguage === '' ? undefined : (fLgLanguage as Ref<LanguageType>),
      fluency: fLgFluency === '' ? undefined : (fLgFluency as LanguageFluency),
      competency: fLgCompetency === '' ? undefined : (fLgCompetency as LanguageCompetency),
      comments: strOrUndef(fLgComments)
    })
    lgEditingId = undefined
    resetLgForm()
  }
  async function removeLg (row: EmployeeLanguage): Promise<void> {
    await client.remove(row)
  }

  // --- Licenses --------------------------------------------------------------
  let licAdding = false
  let licEditingId: string | undefined
  let fLicType = ''
  let fLicNo = ''
  let fLicIssued = ''
  let fLicExpiry = ''

  function resetLicForm (): void {
    fLicType = ''
    fLicNo = ''
    fLicIssued = ''
    fLicExpiry = ''
  }
  function beginAddLic (): void {
    resetLicForm()
    licEditingId = undefined
    licAdding = true
  }
  function beginEditLic (row: EmployeeLicense): void {
    fLicType = row.licenseType ?? ''
    fLicNo = row.licenseNo ?? ''
    fLicIssued = dateToInput(row.issuedDate)
    fLicExpiry = dateToInput(row.expiryDate)
    licEditingId = row._id
    licAdding = false
  }
  function cancelLic (): void {
    licAdding = false
    licEditingId = undefined
  }
  async function submitAddLic (): Promise<void> {
    const data: AttachedData<EmployeeLicense> = {
      licenseType: fLicType === '' ? undefined : (fLicType as Ref<LicenseType>),
      licenseNo: strOrUndef(fLicNo),
      issuedDate: inputToDate(fLicIssued),
      expiryDate: inputToDate(fLicExpiry)
    }
    await client.addCollection(
      ygHr.class.EmployeeLicense,
      employee.space,
      employee._id,
      contact.mixin.Employee,
      'licenses',
      data
    )
    licAdding = false
    resetLicForm()
  }
  async function submitEditLic (row: EmployeeLicense): Promise<void> {
    await client.update(row, {
      licenseType: fLicType === '' ? undefined : (fLicType as Ref<LicenseType>),
      licenseNo: strOrUndef(fLicNo),
      issuedDate: inputToDate(fLicIssued),
      expiryDate: inputToDate(fLicExpiry)
    })
    licEditingId = undefined
    resetLicForm()
  }
  async function removeLic (row: EmployeeLicense): Promise<void> {
    await client.remove(row)
  }

  // Header "Done" ends edit mode - drop any in-progress add/edit row in every section rather than
  // leaving one dangling (and inaccessible) behind the now-read-only view. Same idiom as
  // EmergencyTab.svelte.
  $: if (!editing) {
    cancelWe()
    cancelEdu()
    cancelSk()
    cancelLg()
    cancelLic()
  }
</script>

<div class="yg-cards">
  <SectionCard label={ygHr.string.WorkExperience} full>
    <svelte:fragment slot="actions">
      {#if editing && !weAdding}
        <button class="yg-iconbtn" on:click={beginAddWe}><Label label={ygHr.string.AddItem} /></button>
      {/if}
    </svelte:fragment>

    <div class="yg-q-list">
      {#each workExperiences as row (row._id)}
        {#if weEditingId === row._id}
          <div class="yg-q-form">
            <input class="yg-input" type="text" placeholder={jobTitlePlaceholder} bind:value={fWeJobTitle} />
            <input class="yg-input" type="text" placeholder={employerPlaceholder} bind:value={fWeEmployer} />
            <input class="yg-input" type="date" bind:value={fWeFromDate} />
            <input class="yg-input" type="date" bind:value={fWeToDate} />
            <input class="yg-input" type="text" placeholder={commentsPlaceholder} bind:value={fWeComments} />
            <div class="yg-q-form__actions">
              <button class="yg-linkbtn" on:click={cancelWe}><Label label={ygHr.string.Cancel} /></button>
              <button class="yg-linkbtn yg-linkbtn--accent" on:click={() => submitEditWe(row)}><Label label={ygHr.string.Save} /></button>
            </div>
          </div>
        {:else}
          <div class="yg-q-row">
            <div class="yg-q-row__fields">
              {#each weFields(row) as f}
                <div class="yg-q-f">
                  <span class="yg-q-f__label"><Label label={f.label} /></span>
                  <span class="yg-q-f__value" class:mono={f.mono}>{f.value}</span>
                </div>
              {/each}
            </div>
            {#if editing}
              <div class="yg-q-row__actions">
                <button class="yg-iconbtn" on:click={() => { beginEditWe(row) }}><Label label={ygHr.string.Edit} /></button>
                <button class="yg-iconbtn" on:click={() => { void removeWe(row) }}><Label label={ygHr.string.RemoveItem} /></button>
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        {#if !weAdding}
          <div class="yg-q-empty"><Label label={ygHr.string.NoItemsYet} /></div>
        {/if}
      {/each}

      {#if weAdding}
        <div class="yg-q-form">
          <input class="yg-input" type="text" placeholder={jobTitlePlaceholder} bind:value={fWeJobTitle} />
          <input class="yg-input" type="text" placeholder={employerPlaceholder} bind:value={fWeEmployer} />
          <input class="yg-input" type="date" bind:value={fWeFromDate} />
          <input class="yg-input" type="date" bind:value={fWeToDate} />
          <input class="yg-input" type="text" placeholder={commentsPlaceholder} bind:value={fWeComments} />
          <div class="yg-q-form__actions">
            <button class="yg-linkbtn" on:click={cancelWe}><Label label={ygHr.string.Cancel} /></button>
            <button class="yg-linkbtn yg-linkbtn--accent" on:click={submitAddWe}><Label label={ygHr.string.Save} /></button>
          </div>
        </div>
      {/if}
    </div>
  </SectionCard>

  <SectionCard label={ygHr.string.Educations} full>
    <svelte:fragment slot="actions">
      {#if editing && !eduAdding}
        <button class="yg-iconbtn" on:click={beginAddEdu}><Label label={ygHr.string.AddItem} /></button>
      {/if}
    </svelte:fragment>

    <div class="yg-q-list">
      {#each educations as row (row._id)}
        {#if eduEditingId === row._id}
          <div class="yg-q-form">
            <select class="yg-input" bind:value={fEduLevel}>
              <option value="">{levelPlaceholder}</option>
              {#each educationLevels as l (l._id)}<option value={l._id}>{l.name}</option>{/each}
            </select>
            <input class="yg-input" type="text" placeholder={institutePlaceholder} bind:value={fEduInstitute} />
            <input class="yg-input" type="text" placeholder={majorPlaceholder} bind:value={fEduMajor} />
            <input
              class="yg-input"
              type="number"
              placeholder={yearPlaceholder}
              value={fEduYear}
              on:input={(e) => { fEduYear = (e.currentTarget as HTMLInputElement).value }}
            />
            <input class="yg-input" type="text" placeholder={scorePlaceholder} bind:value={fEduScore} />
            <input class="yg-input" type="date" bind:value={fEduStartDate} />
            <input class="yg-input" type="date" bind:value={fEduEndDate} />
            <div class="yg-q-form__actions">
              <button class="yg-linkbtn" on:click={cancelEdu}><Label label={ygHr.string.Cancel} /></button>
              <button class="yg-linkbtn yg-linkbtn--accent" on:click={() => submitEditEdu(row)}><Label label={ygHr.string.Save} /></button>
            </div>
          </div>
        {:else}
          <div class="yg-q-row">
            <div class="yg-q-row__fields">
              {#each eduFields(row) as f}
                <div class="yg-q-f">
                  <span class="yg-q-f__label"><Label label={f.label} /></span>
                  <span class="yg-q-f__value" class:mono={f.mono}>{f.value}</span>
                </div>
              {/each}
            </div>
            {#if editing}
              <div class="yg-q-row__actions">
                <button class="yg-iconbtn" on:click={() => { beginEditEdu(row) }}><Label label={ygHr.string.Edit} /></button>
                <button class="yg-iconbtn" on:click={() => { void removeEdu(row) }}><Label label={ygHr.string.RemoveItem} /></button>
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        {#if !eduAdding}
          <div class="yg-q-empty"><Label label={ygHr.string.NoItemsYet} /></div>
        {/if}
      {/each}

      {#if eduAdding}
        <div class="yg-q-form">
          <select class="yg-input" bind:value={fEduLevel}>
            <option value="">{levelPlaceholder}</option>
            {#each educationLevels as l (l._id)}<option value={l._id}>{l.name}</option>{/each}
          </select>
          <input class="yg-input" type="text" placeholder={institutePlaceholder} bind:value={fEduInstitute} />
          <input class="yg-input" type="text" placeholder={majorPlaceholder} bind:value={fEduMajor} />
          <input
            class="yg-input"
            type="number"
            placeholder={yearPlaceholder}
            value={fEduYear}
            on:input={(e) => { fEduYear = (e.currentTarget as HTMLInputElement).value }}
          />
          <input class="yg-input" type="text" placeholder={scorePlaceholder} bind:value={fEduScore} />
          <input class="yg-input" type="date" bind:value={fEduStartDate} />
          <input class="yg-input" type="date" bind:value={fEduEndDate} />
          <div class="yg-q-form__actions">
            <button class="yg-linkbtn" on:click={cancelEdu}><Label label={ygHr.string.Cancel} /></button>
            <button class="yg-linkbtn yg-linkbtn--accent" on:click={submitAddEdu}><Label label={ygHr.string.Save} /></button>
          </div>
        </div>
      {/if}
    </div>
  </SectionCard>

  <SectionCard label={ygHr.string.Skills} full>
    <svelte:fragment slot="actions">
      {#if editing && !skAdding}
        <button class="yg-iconbtn" on:click={beginAddSk}><Label label={ygHr.string.AddItem} /></button>
      {/if}
    </svelte:fragment>

    <div class="yg-q-list">
      {#each skills as row (row._id)}
        {#if skEditingId === row._id}
          <div class="yg-q-form">
            <select class="yg-input" bind:value={fSkSkill}>
              <option value="">{skillPlaceholder}</option>
              {#each skillTypes as t (t._id)}<option value={t._id}>{t.name}</option>{/each}
            </select>
            <input
              class="yg-input"
              type="number"
              placeholder={yearsOfExperiencePlaceholder}
              value={fSkYears}
              on:input={(e) => { fSkYears = (e.currentTarget as HTMLInputElement).value }}
            />
            <input class="yg-input" type="text" placeholder={commentsPlaceholder} bind:value={fSkComments} />
            <div class="yg-q-form__actions">
              <button class="yg-linkbtn" on:click={cancelSk}><Label label={ygHr.string.Cancel} /></button>
              <button class="yg-linkbtn yg-linkbtn--accent" on:click={() => submitEditSk(row)}><Label label={ygHr.string.Save} /></button>
            </div>
          </div>
        {:else}
          <div class="yg-q-row">
            <div class="yg-q-row__fields">
              {#each skillFields(row) as f}
                <div class="yg-q-f">
                  <span class="yg-q-f__label"><Label label={f.label} /></span>
                  <span class="yg-q-f__value" class:mono={f.mono}>{f.value}</span>
                </div>
              {/each}
            </div>
            {#if editing}
              <div class="yg-q-row__actions">
                <button class="yg-iconbtn" on:click={() => { beginEditSk(row) }}><Label label={ygHr.string.Edit} /></button>
                <button class="yg-iconbtn" on:click={() => { void removeSk(row) }}><Label label={ygHr.string.RemoveItem} /></button>
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        {#if !skAdding}
          <div class="yg-q-empty"><Label label={ygHr.string.NoItemsYet} /></div>
        {/if}
      {/each}

      {#if skAdding}
        <div class="yg-q-form">
          <select class="yg-input" bind:value={fSkSkill}>
            <option value="">{skillPlaceholder}</option>
            {#each skillTypes as t (t._id)}<option value={t._id}>{t.name}</option>{/each}
          </select>
          <input
            class="yg-input"
            type="number"
            placeholder={yearsOfExperiencePlaceholder}
            value={fSkYears}
            on:input={(e) => { fSkYears = (e.currentTarget as HTMLInputElement).value }}
          />
          <input class="yg-input" type="text" placeholder={commentsPlaceholder} bind:value={fSkComments} />
          <div class="yg-q-form__actions">
            <button class="yg-linkbtn" on:click={cancelSk}><Label label={ygHr.string.Cancel} /></button>
            <button class="yg-linkbtn yg-linkbtn--accent" on:click={submitAddSk}><Label label={ygHr.string.Save} /></button>
          </div>
        </div>
      {/if}
    </div>
  </SectionCard>

  <SectionCard label={ygHr.string.Languages} full>
    <svelte:fragment slot="actions">
      {#if editing && !lgAdding}
        <button class="yg-iconbtn" on:click={beginAddLg}><Label label={ygHr.string.AddItem} /></button>
      {/if}
    </svelte:fragment>

    <div class="yg-q-list">
      {#each languages as row (row._id)}
        {#if lgEditingId === row._id}
          <div class="yg-q-form">
            <select class="yg-input" bind:value={fLgLanguage}>
              <option value="">{languagePlaceholder}</option>
              {#each languageTypes as t (t._id)}<option value={t._id}>{t.name}</option>{/each}
            </select>
            <select class="yg-input" bind:value={fLgFluency}>
              <option value="">{fluencyPlaceholder}</option>
              <option value="speaking">{fluencySpeakingLabel}</option>
              <option value="writing">{fluencyWritingLabel}</option>
              <option value="reading">{fluencyReadingLabel}</option>
            </select>
            <select class="yg-input" bind:value={fLgCompetency}>
              <option value="">{competencyPlaceholder}</option>
              <option value="poor">{competencyPoorLabel}</option>
              <option value="basic">{competencyBasicLabel}</option>
              <option value="good">{competencyGoodLabel}</option>
              <option value="mothertongue">{competencyMotherTongueLabel}</option>
            </select>
            <input class="yg-input" type="text" placeholder={commentsPlaceholder} bind:value={fLgComments} />
            <div class="yg-q-form__actions">
              <button class="yg-linkbtn" on:click={cancelLg}><Label label={ygHr.string.Cancel} /></button>
              <button class="yg-linkbtn yg-linkbtn--accent" on:click={() => submitEditLg(row)}><Label label={ygHr.string.Save} /></button>
            </div>
          </div>
        {:else}
          <div class="yg-q-row">
            <div class="yg-q-row__fields">
              {#each langFields(row) as f}
                <div class="yg-q-f">
                  <span class="yg-q-f__label"><Label label={f.label} /></span>
                  <span class="yg-q-f__value" class:mono={f.mono}>{f.value}</span>
                </div>
              {/each}
            </div>
            {#if editing}
              <div class="yg-q-row__actions">
                <button class="yg-iconbtn" on:click={() => { beginEditLg(row) }}><Label label={ygHr.string.Edit} /></button>
                <button class="yg-iconbtn" on:click={() => { void removeLg(row) }}><Label label={ygHr.string.RemoveItem} /></button>
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        {#if !lgAdding}
          <div class="yg-q-empty"><Label label={ygHr.string.NoItemsYet} /></div>
        {/if}
      {/each}

      {#if lgAdding}
        <div class="yg-q-form">
          <select class="yg-input" bind:value={fLgLanguage}>
            <option value="">{languagePlaceholder}</option>
            {#each languageTypes as t (t._id)}<option value={t._id}>{t.name}</option>{/each}
          </select>
          <select class="yg-input" bind:value={fLgFluency}>
            <option value="">{fluencyPlaceholder}</option>
            <option value="speaking">{fluencySpeakingLabel}</option>
            <option value="writing">{fluencyWritingLabel}</option>
            <option value="reading">{fluencyReadingLabel}</option>
          </select>
          <select class="yg-input" bind:value={fLgCompetency}>
            <option value="">{competencyPlaceholder}</option>
            <option value="poor">{competencyPoorLabel}</option>
            <option value="basic">{competencyBasicLabel}</option>
            <option value="good">{competencyGoodLabel}</option>
            <option value="mothertongue">{competencyMotherTongueLabel}</option>
          </select>
          <input class="yg-input" type="text" placeholder={commentsPlaceholder} bind:value={fLgComments} />
          <div class="yg-q-form__actions">
            <button class="yg-linkbtn" on:click={cancelLg}><Label label={ygHr.string.Cancel} /></button>
            <button class="yg-linkbtn yg-linkbtn--accent" on:click={submitAddLg}><Label label={ygHr.string.Save} /></button>
          </div>
        </div>
      {/if}
    </div>
  </SectionCard>

  <SectionCard label={ygHr.string.Licenses} full>
    <svelte:fragment slot="actions">
      {#if editing && !licAdding}
        <button class="yg-iconbtn" on:click={beginAddLic}><Label label={ygHr.string.AddItem} /></button>
      {/if}
    </svelte:fragment>

    <div class="yg-q-list">
      {#each licenses as row (row._id)}
        {#if licEditingId === row._id}
          <div class="yg-q-form">
            <select class="yg-input" bind:value={fLicType}>
              <option value="">{licenseTypePlaceholder}</option>
              {#each licenseTypes as t (t._id)}<option value={t._id}>{t.name}</option>{/each}
            </select>
            <input class="yg-input" type="text" placeholder={licenseNoPlaceholder} bind:value={fLicNo} />
            <input class="yg-input" type="date" bind:value={fLicIssued} />
            <input class="yg-input" type="date" bind:value={fLicExpiry} />
            <div class="yg-q-form__actions">
              <button class="yg-linkbtn" on:click={cancelLic}><Label label={ygHr.string.Cancel} /></button>
              <button class="yg-linkbtn yg-linkbtn--accent" on:click={() => submitEditLic(row)}><Label label={ygHr.string.Save} /></button>
            </div>
          </div>
        {:else}
          <div class="yg-q-row">
            <div class="yg-q-row__fields">
              {#each licFields(row) as f}
                <div class="yg-q-f">
                  <span class="yg-q-f__label"><Label label={f.label} /></span>
                  <span class="yg-q-f__value" class:mono={f.mono}>{f.value}</span>
                </div>
              {/each}
            </div>
            {#if editing}
              <div class="yg-q-row__actions">
                <button class="yg-iconbtn" on:click={() => { beginEditLic(row) }}><Label label={ygHr.string.Edit} /></button>
                <button class="yg-iconbtn" on:click={() => { void removeLic(row) }}><Label label={ygHr.string.RemoveItem} /></button>
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        {#if !licAdding}
          <div class="yg-q-empty"><Label label={ygHr.string.NoItemsYet} /></div>
        {/if}
      {/each}

      {#if licAdding}
        <div class="yg-q-form">
          <select class="yg-input" bind:value={fLicType}>
            <option value="">{licenseTypePlaceholder}</option>
            {#each licenseTypes as t (t._id)}<option value={t._id}>{t.name}</option>{/each}
          </select>
          <input class="yg-input" type="text" placeholder={licenseNoPlaceholder} bind:value={fLicNo} />
          <input class="yg-input" type="date" bind:value={fLicIssued} />
          <input class="yg-input" type="date" bind:value={fLicExpiry} />
          <div class="yg-q-form__actions">
            <button class="yg-linkbtn" on:click={cancelLic}><Label label={ygHr.string.Cancel} /></button>
            <button class="yg-linkbtn yg-linkbtn--accent" on:click={submitAddLic}><Label label={ygHr.string.Save} /></button>
          </div>
        </div>
      {/if}
    </div>
  </SectionCard>
</div>

<style lang="scss">
  @use '../yg-profile' as *;

  .yg-q-list {
    display: flex;
    flex-direction: column;
  }
  .yg-q-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 13px;
    padding: 13px 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .yg-q-row:last-child {
    border-bottom: none;
  }
  .yg-q-row__fields {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 24px;
    min-width: 0;
  }
  .yg-q-f {
    display: flex;
    flex-direction: column;
  }
  .yg-q-f__label {
    font-size: 11px;
    color: var(--theme-trans-color);
  }
  .yg-q-f__value {
    font-size: 13.5px;
    color: var(--theme-content-color);
    font-weight: 500;
  }
  .yg-q-f__value.mono {
    font-family: var(--theme-font-mono, ui-monospace, monospace);
    font-variant-numeric: tabular-nums;
  }
  .yg-q-row__actions {
    display: flex;
    gap: 6px;
    flex: none;
  }
  .yg-q-empty {
    font-size: 13px;
    color: var(--theme-trans-color);
    padding: 10px 0;
  }
  .yg-q-form {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  @media (max-width: 640px) {
    .yg-q-form {
      grid-template-columns: 1fr 1fr;
    }
  }
  .yg-q-form__actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
</style>
