# YG HR Personal/Job extra fields + attachments - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the YG-used subset of HR-portal fields to the Personal and Job profile tabs (nickname, other id, driver's license no + expiry; termination date + reason), a TerminationReason admin list, and a reusable per-section file-attachment capability.

**Architecture:** Extend the existing `EmployeePersonal` / `EmployeeJob` mixins with optional fields (no new mixin, no data migration). Add one admin list class `TerminationReason` modeled and seeded exactly like `EmploymentStatus`. Attachments reuse Huly's `@hcengineering/attachment` plugin (the `Attachment` AttachedDoc + blob storage + `AttachmentPresenter`), attached to the Employee under distinct per-section collection names. New mixin fields and the new list class are added to the existing server-side guard so only HR/admin can write them.

**Tech Stack:** Huly platform (TypeScript, Svelte 3, `@hcengineering/model` decorators, Rush monorepo), CockroachDB-backed transactor.

**Spec:** `docs/superpowers/specs/2026-09-04-yg-hr-personal-job-fields-attachments-design.md`

## Global Constraints

- **No em/en dashes anywhere** (code, comments, strings, commits). Use hyphens, commas, colons, parentheses. Numeric ranges use a hyphen.
- **TS style:** no semicolons, 2-space indent, single quotes. Match surrounding code.
- **Validate a package:** `node common/scripts/install-run-rush.js validate --only <pkg>` (NEVER `--to model-all`). Package names: `@hcengineering/yg-hr`, `@hcengineering/yg-hr-assets`, `@hcengineering/yg-hr-resources`, `@hcengineering/model-yg-hr`, `@hcengineering/server-yg-hr-resources`.
- **Model check after any models/ change:** `cd models/all && rushx bundle`.
- **All new fields are optional** => no per-employee data migration; migration only seeds the new list.
- **Field set = YG-used subset.** Do NOT add SSN/SIN/smoker/ethnicity/military/jobCategory.
- **Termination is record-keeping only** - never couple it to `EmployeePersonal.status` or login revocation.
- Work from repo root `/home/karthi_0008/dev/client-projects/yg-huly`, branch `feat/yg-hr-module`.

---

### Task 1: Plugin contract - new fields, TerminationReason type, class + string ids

**Files:**
- Modify: `plugins/yg-hr/src/index.ts`

**Interfaces:**
- Produces: `EmployeePersonal.nickname?`, `.otherId?`, `.driverLicenseNo?: string`, `.driverLicenseExpiry?: Timestamp`; `EmployeeJob.terminationDate?: Timestamp`, `.terminationReason?: Ref<TerminationReason>`; `type TerminationReason = HrListItem`; `ygHr.class.TerminationReason: Ref<Class<TerminationReason>>`; strings `Nickname`, `OtherId`, `DriverLicenseNo`, `DriverLicenseExpiry`, `TerminationDate`, `TerminationReason`, `TerminationReasons` (plural, for the HrLists card title), `Termination` (card label).

- [ ] **Step 1: Add fields to the two mixin interfaces**

In `EmployeePersonal` (after `employeeId?: string`, before `status?`):
```ts
  nickname?: string
  otherId?: string
  driverLicenseNo?: string
  driverLicenseExpiry?: Timestamp
```
In `EmployeeJob` (after `contractEnd?: Timestamp`):
```ts
  terminationDate?: Timestamp
  terminationReason?: Ref<TerminationReason>
```

- [ ] **Step 2: Add the TerminationReason type alias**

Next to the other list aliases (`export type Location = HrListItem`):
```ts
export type TerminationReason = HrListItem
```

- [ ] **Step 3: Add the class id**

In the `class:` map (after `Location: ...`):
```ts
    TerminationReason: '' as Ref<Class<TerminationReason>>,
```

- [ ] **Step 4: Add the string ids**

In the `string:` map (group them near the Job/Personal strings):
```ts
    Nickname: '' as IntlString,
    OtherId: '' as IntlString,
    DriverLicenseNo: '' as IntlString,
    DriverLicenseExpiry: '' as IntlString,
    Termination: '' as IntlString,
    TerminationDate: '' as IntlString,
    TerminationReason: '' as IntlString,
    TerminationReasons: '' as IntlString,
```

- [ ] **Step 5: Validate**

Run: `node common/scripts/install-run-rush.js validate --only @hcengineering/yg-hr`
Expected: SUCCESS.

- [ ] **Step 6: Commit**
```bash
git add plugins/yg-hr/src/index.ts
git commit -m "feat(yg-hr): plugin contract for Personal/Job extra fields + TerminationReason"
```

---

### Task 2: Assets - English strings

**Files:**
- Modify: `plugins/yg-hr-assets/lang/en.json`

**Interfaces:**
- Consumes: the string ids declared in Task 1.
- Produces: display copy for each.

- [ ] **Step 1: Add the strings**

Add these keys to the yg-hr string object in `en.json` (mind trailing commas / valid JSON):
```json
    "Nickname": "Nickname",
    "OtherId": "Other id",
    "DriverLicenseNo": "Driver's license no",
    "DriverLicenseExpiry": "License expiry",
    "Termination": "Termination",
    "TerminationDate": "Termination date",
    "TerminationReason": "Termination reason",
    "TerminationReasons": "Termination reasons",
```

- [ ] **Step 2: Validate**

Run: `node common/scripts/install-run-rush.js validate --only @hcengineering/yg-hr-assets`
Expected: SUCCESS (valid JSON, keys resolve).

- [ ] **Step 3: Commit**
```bash
git add plugins/yg-hr-assets/lang/en.json
git commit -m "feat(yg-hr): en strings for Personal/Job extra fields + TerminationReason"
```

---

### Task 3: Model - new mixin fields + TerminationReason class

**Files:**
- Modify: `models/yg-hr/src/index.ts`

**Interfaces:**
- Consumes: Task 1 ids (`ygHr.class.TerminationReason`, `ygHr.string.*`), the `TerminationReason` type.
- Produces: `TTerminationReason` model class registered; the new `@Prop`s on `TEmployeePersonal` / `TEmployeeJob`.

- [ ] **Step 1: Import the TerminationReason type**

Add `TerminationReason` to the `import type { ... } from '@hcengineering/yg-hr'` list.

- [ ] **Step 2: Add the model class** (next to `TLocation`)
```ts
@Model(ygHr.class.TerminationReason, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.TerminationReason)
export class TTerminationReason extends TDoc {
  @Prop(TypeString(), ygHr.string.TerminationReason) name!: string
}
```

- [ ] **Step 3: Add the Personal fields** to `TEmployeePersonal` (after `employeeId`, before `status`)
```ts
  @Prop(TypeString(), ygHr.string.Nickname) nickname?: string
  @Prop(TypeString(), ygHr.string.OtherId) otherId?: string
  @Prop(TypeString(), ygHr.string.DriverLicenseNo) driverLicenseNo?: string
  @Prop(TypeDate(), ygHr.string.DriverLicenseExpiry) driverLicenseExpiry?: Timestamp
```

- [ ] **Step 4: Add the Job fields** to `TEmployeeJob` (after `contractEnd`)
```ts
  @Prop(TypeDate(), ygHr.string.TerminationDate) terminationDate?: Timestamp
  @Prop(TypeRef(ygHr.class.TerminationReason), ygHr.string.TerminationReason) terminationReason?: Ref<TerminationReason>
```

- [ ] **Step 5: Register the class** in `createModel(builder)` `builder.createModel(...)` list (add `TTerminationReason` next to `TLocation`).

- [ ] **Step 6: Model bundle + validate**

Run: `cd models/all && rushx bundle` -> Expected: builds with no error.
Run: `node common/scripts/install-run-rush.js validate --only @hcengineering/model-yg-hr` -> Expected: SUCCESS.

- [ ] **Step 7: Commit**
```bash
git add models/yg-hr/src/index.ts
git commit -m "feat(yg-hr): model new Personal/Job fields + TerminationReason list class"
```

---

### Task 4: Migration - seed TerminationReason

**Files:**
- Modify: `models/yg-hr/src/migration.ts`

**Interfaces:**
- Consumes: `seedNames`, `ygHr.class.TerminationReason`, `TerminationReason` type, `tryUpgrade`.
- Produces: a new upgrade state `seed-termination-reasons-0001`.

- [ ] **Step 1: Add the type import + seed constant**

Add `type TerminationReason` to the `@hcengineering/yg-hr` import. Add near the other seed constants:
```ts
// Seeded from ohrm_emp_termination_reason in the OrangeHRM dump (hr.youngglobe.com). Hyphens are
// intentional (source values), not dashes.
const TERMINATION_REASONS = [
  'Other', 'Retired', 'Contract Not Renewed', 'Resigned', 'Resigned - Company Requested',
  'Resigned - Self Proposed', 'Deceased', 'Physically Disabled/Compensated', 'Laid-off', 'Dismissed'
]
```

- [ ] **Step 2: Add the migration function** (near `migrateYgHr`)
```ts
// Its own tryUpgrade state so it also runs on the existing yg workspace, which already completed the
// earlier seed state (tryUpgrade skips a state once recorded done).
async function migrateSeedTerminationReasons (client: MigrationUpgradeClient): Promise<void> {
  const ops = new TxOperations(client, core.account.System)
  await seedNames<TerminationReason>(ops, ygHr.class.TerminationReason, TERMINATION_REASONS)
}
```

- [ ] **Step 3: Register the state** in the `tryUpgrade(...)` array (append at the end):
```ts
      {
        // Seed the TerminationReason admin list (Job tab termination reason).
        state: 'seed-termination-reasons-0001',
        func: migrateSeedTerminationReasons
      }
```

- [ ] **Step 4: Model bundle**

Run: `cd models/all && rushx bundle` -> Expected: builds with no error.

- [ ] **Step 5: Commit**
```bash
git add models/yg-hr/src/migration.ts
git commit -m "feat(yg-hr): seed TerminationReason admin list"
```

---

### Task 5: Server guard - protect new fields + the new list

**Files:**
- Modify: `server-plugins/yg-hr-resources/src/index.ts:187-212`

**Interfaces:**
- Consumes: `GUARDED_MIXIN_FIELDS`, `HR_CONFIG_FIELDS`, `ygHr.class.TerminationReason`.
- Produces: the new fields and list class are reverted for non-HR writers, exactly like the existing ones.

**Why:** `guardMixinWrite` only reverts fields listed in `GUARDED_MIXIN_FIELDS`; a field NOT listed would be writable by any member. So new mixin fields MUST be added here, and the new list class to `HR_CONFIG_FIELDS`, for parity with the existing lists.

- [ ] **Step 1: Extend `GUARDED_MIXIN_FIELDS`**

Add to the `EmployeePersonal` array: `'nickname', 'otherId', 'driverLicenseNo', 'driverLicenseExpiry'`.
Add to the `EmployeeJob` array: `'terminationDate', 'terminationReason'`.

- [ ] **Step 2: Extend `HR_CONFIG_FIELDS`**

Add after the `Location` entry:
```ts
  [ygHr.class.TerminationReason]: ['name']
```

- [ ] **Step 3: Validate**

Run: `node common/scripts/install-run-rush.js validate --only @hcengineering/server-yg-hr-resources`
Expected: SUCCESS.

- [ ] **Step 4: Commit**
```bash
git add server-plugins/yg-hr-resources/src/index.ts
git commit -m "feat(yg-hr): guard new Personal/Job fields + TerminationReason writes"
```

---

### Task 6: HR Settings - manage the TerminationReason list

**Files:**
- Modify: `plugins/yg-hr-resources/src/components/HrLists.svelte`

**Interfaces:**
- Consumes: `ygHr.class.TerminationReason`, `ygHr.string.TerminationReasons`, `type TerminationReason`.
- Produces: an add/rename/remove card for TerminationReason (no system-locked rows).

- [ ] **Step 1: Import + query**

Add `type TerminationReason` to the `@hcengineering/yg-hr` import. Add alongside the other list state/queries:
```ts
  let terminationReasons: TerminationReason[] = []
  const termQuery = createQuery()
  termQuery.query(ygHr.class.TerminationReason, {}, (res) => { terminationReasons = res })
```
Add the sorted derived + placeholder + new-value state + submit fn (mirror `submitLocation`):
```ts
  $: sortedTerminationReasons = byName(terminationReasons)
  let terminationReasonPlaceholder = ''
  void translate(ygHr.string.TerminationReason, {}).then((r) => { terminationReasonPlaceholder = `+ ${r}` })
  let newTerminationReason = ''
  function submitTerminationReason (): void {
    void addItem(ygHr.class.TerminationReason, newTerminationReason)
    newTerminationReason = ''
  }
```

- [ ] **Step 2: Add the card** (copy the Location `hs-card` block, swap the label to `ygHr.string.TerminationReasons`, list `sortedTerminationReasons`, submit `submitTerminationReason`, bind `newTerminationReason`, placeholder `terminationReasonPlaceholder`). Place it after the Locations card, inside `.hs-grid`.

- [ ] **Step 3: Validate**

Run: `node common/scripts/install-run-rush.js validate --only @hcengineering/yg-hr-resources`
Expected: SUCCESS.

- [ ] **Step 4: Commit**
```bash
git add plugins/yg-hr-resources/src/components/HrLists.svelte
git commit -m "feat(yg-hr): manage TerminationReason list in HR Settings"
```

---

### Task 7: Personal tab - nickname, other id, driver's license

**Files:**
- Modify: `plugins/yg-hr-resources/src/components/tabs/PersonalTab.svelte`

**Interfaces:**
- Consumes: the new `EmployeePersonal` fields, `ygHr.string.Nickname/OtherId/DriverLicenseNo/DriverLicenseExpiry`, existing `saveEmployeeMixin/dateToInput/inputToDate/formatDisplayDate`.
- Produces: editable + read-only rendering of the four new fields.

- [ ] **Step 1: Add edit-field state** (near the other `let f*`)
```ts
  let fNickname = ''
  let fOtherId = ''
  let fDriverLicenseNo = ''
  let fDriverLicenseExpiry = ''
```

- [ ] **Step 2: Seed them on edit** - inside the Identity `$: if (editing) { ... }` add `fNickname = personal?.nickname ?? ''`; inside the Details `$: if (editing) { ... }` add:
```ts
    fOtherId = personal?.otherId ?? ''
    fDriverLicenseNo = personal?.driverLicenseNo ?? ''
    fDriverLicenseExpiry = dateToInput(personal?.driverLicenseExpiry)
```

- [ ] **Step 3: Persist them** - in `saveIdentity`'s `upd` add `nickname: fNickname.trim() === '' ? undefined : fNickname.trim()`. In `saveDetails`'s `upd` add:
```ts
      otherId: fOtherId.trim() === '' ? undefined : fOtherId.trim(),
      driverLicenseNo: fDriverLicenseNo.trim() === '' ? undefined : fDriverLicenseNo.trim(),
      driverLicenseExpiry: inputToDate(fDriverLicenseExpiry)
```

- [ ] **Step 4: Render** - in the Identity card add a Nickname text input (editing) / `FieldRow` (read-only) using `ygHr.string.Nickname` and `personal?.nickname`. In the Details card add Other id (text), Driver's license no (text), and License expiry (`type="date"` editing / `formatDisplayDate(personal?.driverLicenseExpiry)` read-only, `mono`). Follow the exact `yg-input-f` / `FieldRow` idiom already in the file.

- [ ] **Step 5: Validate**

Run: `node common/scripts/install-run-rush.js validate --only @hcengineering/yg-hr-resources`
Expected: SUCCESS.

- [ ] **Step 6: Commit**
```bash
git add plugins/yg-hr-resources/src/components/tabs/PersonalTab.svelte
git commit -m "feat(yg-hr): Personal tab nickname, other id, driver's license fields"
```

---

### Task 8: Job tab - Termination card + shell wiring

**Files:**
- Modify: `plugins/yg-hr-resources/src/components/tabs/JobTab.svelte`
- Modify: `plugins/yg-hr-resources/src/components/EmployeeProfile.svelte`

**Interfaces:**
- Consumes: `EmployeeJob.terminationDate/terminationReason`, `ygHr.class.TerminationReason`, `ygHr.string.Termination/TerminationDate/TerminationReason`.
- Produces: JobTab gains a `terminationReasons: TerminationReason[]` prop and a Termination card; the shell queries the list and passes it down.

- [ ] **Step 1: Shell query + prop** - in `EmployeeProfile.svelte` add a `terminationReasons` query next to `designations/departments/...`:
```ts
  let terminationReasons: TerminationReason[] = []
  const termReasonQuery = createQuery()
  termReasonQuery.query(ygHr.class.TerminationReason, {}, (res) => { terminationReasons = res })
```
Add `TerminationReason` to the `@hcengineering/yg-hr` import. Pass it to JobTab:
```svelte
          <JobTab {employee} {editing} {designations} {departments} {employmentStatuses} {locations} {terminationReasons} />
```

- [ ] **Step 2: JobTab prop + derived** - add `export let terminationReasons: TerminationReason[]` and the import of `type TerminationReason`. Add:
```ts
  $: terminationReasonName = terminationReasons.find((d) => d._id === job?.terminationReason)?.name
  let fTerminationDate = ''
  let fTerminationReason = ''
  $: if (editing) {
    fTerminationDate = dateToInput(job?.terminationDate)
    fTerminationReason = job?.terminationReason ?? ''
  }
  async function saveTermination (): Promise<void> {
    const upd: Partial<EmployeeJob> = {
      terminationDate: inputToDate(fTerminationDate),
      terminationReason: fTerminationReason === '' ? undefined : (fTerminationReason as Ref<TerminationReason>)
    }
    await saveEmployeeMixin(client, h, employee, ygHr.mixin.EmployeeJob, upd)
  }
```

- [ ] **Step 3: Termination card** - add a third `SectionCard label={ygHr.string.Termination}` after the Dates card: a `type="date"` input bound to `fTerminationDate` (editing) and a `<select>` over `terminationReasons` bound to `fTerminationReason`, both `on:change={saveTermination}`; read-only `FieldRow`s using `formatDisplayDate(job?.terminationDate)` and `terminationReasonName`.

- [ ] **Step 4: Validate**

Run: `node common/scripts/install-run-rush.js validate --only @hcengineering/yg-hr-resources`
Expected: SUCCESS.

- [ ] **Step 5: Commit**
```bash
git add plugins/yg-hr-resources/src/components/tabs/JobTab.svelte plugins/yg-hr-resources/src/components/EmployeeProfile.svelte
git commit -m "feat(yg-hr): Job tab termination (date + reason)"
```

---

### Task 9: SectionAttachments component + wire into Personal & Job

**Files:**
- Create: `plugins/yg-hr-resources/src/components/SectionAttachments.svelte`
- Modify: `plugins/yg-hr-resources/src/components/tabs/PersonalTab.svelte`
- Modify: `plugins/yg-hr-resources/src/components/tabs/JobTab.svelte`

**Interfaces:**
- Consumes: `@hcengineering/attachment` (`attachment` default export + `type Attachment`; also `attachment.class.Attachment`, `attachment.string.Attachments`), `@hcengineering/presentation` (`getClient`, `createQuery`, `uploadFile`, `getFileUrl`, `deleteFile`), `contact.mixin.Employee`, the tab's `editing` state as `canEdit`.
- Produces: `SectionAttachments` with props `{ employee: Employee, collection: string, canEdit: boolean }`.

**Verified API (attachment-API investigation):**
- `uploadFile(file)` returns `{ uuid: Ref<Blob>, metadata }` - store `uuid` in `Attachment.file`.
- Add: `client.addCollection(attachment.class.Attachment, space, objectId, objectClass, collectionName, { name, file: uuid, type, size, lastModified, metadata })`.
- List: `query.query(attachment.class.Attachment, { attachedTo, collection }, cb)` - `collection` is a real stored field.
- Download: `getFileUrl(att.file, att.name)` in an `<a href download>`.
- Remove: `client.removeCollection(att._class, att.space, att._id, att.attachedTo, att.attachedToClass, collection)`, then optional `deleteFile(att.file)` to purge the blob.

- [ ] **Step 1: Create `SectionAttachments.svelte`** with this exact script:
```svelte
<script lang="ts">
  import contact, { type Employee } from '@hcengineering/contact'
  import attachment, { type Attachment } from '@hcengineering/attachment'
  import { createQuery, deleteFile, getClient, getFileUrl, uploadFile } from '@hcengineering/presentation'
  import { Label, Spinner } from '@hcengineering/ui'
  import SectionCard from './SectionCard.svelte'

  export let employee: Employee
  export let collection: string
  export let canEdit: boolean

  const client = getClient()
  let files: Attachment[] = []
  const q = createQuery()
  $: q.query(attachment.class.Attachment, { attachedTo: employee._id, collection }, (res) => { files = res })

  let uploading = false
  let input: HTMLInputElement

  async function onSelected (e: Event): Promise<void> {
    const list = (e.currentTarget as HTMLInputElement).files
    if (list === null || list.length === 0) return
    uploading = true
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list.item(i)
        if (file === null) continue
        const { uuid, metadata } = await uploadFile(file)
        await client.addCollection(
          attachment.class.Attachment, employee.space, employee._id, contact.mixin.Employee, collection,
          { name: file.name, file: uuid, type: file.type, size: file.size, lastModified: file.lastModified, metadata }
        )
      }
    } finally {
      uploading = false
      if (input !== undefined) input.value = ''
    }
  }

  async function remove (att: Attachment): Promise<void> {
    await client.removeCollection(att._class, att.space, att._id, att.attachedTo, att.attachedToClass, collection)
    await deleteFile(att.file)
  }

  function fmtSize (n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }
</script>
```
Template (a `SectionCard` reusing `attachment.string.Attachments`): a list of rows, each a download `<a href={getFileUrl(att.file, att.name)} download={att.name}>{att.name}</a>` plus `{fmtSize(att.size)}` and, when `canEdit`, a remove button `on:click={() => remove(att)}`; when `canEdit`, an "Add file" button that does `input.click()` plus a hidden `<input type="file" multiple bind:this={input} on:change={onSelected} style="display:none" />` and a `{#if uploading}<Spinner size={'small'} />{/if}`. Style with the file's own `<style lang="scss">@use '../yg-profile' as *;</style>` idiom (SectionAttachments sits at `components/`, so use `'./yg-profile'`). Keep it read-only-friendly: when `files` is empty and not `canEdit`, render a muted "None" line.

- [ ] **Step 2: Wire into PersonalTab** - render `<SectionAttachments employee={employee} collection={'personalFiles'} canEdit={editing} />` at the bottom of the cards.

- [ ] **Step 3: Wire into JobTab** - render `<SectionAttachments employee={employee} collection={'jobFiles'} canEdit={editing} />` at the bottom of the cards.

- [ ] **Step 4: Validate**

Run: `node common/scripts/install-run-rush.js validate --only @hcengineering/yg-hr-resources`
Expected: SUCCESS.

- [ ] **Step 5: Commit**
```bash
git add plugins/yg-hr-resources/src/components/SectionAttachments.svelte plugins/yg-hr-resources/src/components/tabs/PersonalTab.svelte plugins/yg-hr-resources/src/components/tabs/JobTab.svelte
git commit -m "feat(yg-hr): per-section file attachments on Personal & Job tabs"
```

---

### Task 10: Deploy to beta + manual verification

**Files:** none (ops).

- [ ] **Step 1: Build + upgrade** (in `~/dev/client-projects/huly-migration/huly-selfhost`, stack stopped first for RAM):
```bash
./build-beta.sh
# stop stack -> cold-start redpanda FIRST -> up -d
./run-tool-beta.sh upgrade-workspace yg
# restart transactor + nginx
```
This is a model change, so `upgrade-workspace` is required (runs `seed-termination-reasons-0001`).

- [ ] **Step 2: Manual test** (beta `yg`, log in as an HR/admin; read OTP from `global_account.otp`):
  1. Edit an employee -> Personal: fill nickname, other id, driver's license no + expiry -> save -> reload -> persists.
  2. HR Settings -> Termination reasons list shows the 10 seeded values; add/rename/remove works.
  3. Job tab -> Termination: pick a reason + date -> save -> reload -> persists; confirm employee status is unchanged.
  4. Upload a file on Personal and a different file on Job -> reload -> both persist and stay in their own section.
  5. As a non-HR viewer: files are downloadable; add/remove controls are absent; the new fields are read-only.

- [ ] **Step 3: Report** results (screenshots/notes). Do NOT deploy to prod in this sub-phase.

---

## Notes for the executor

- After every `models/` edit, run the model bundle (`cd models/all && rushx bundle`) - a model that fails to bundle breaks the whole workspace boot.
- Do not run `rush validate --to model-all` (it rebuilds the world). Use `--only <pkg>`.
- Follow the exact Svelte idioms already in each file (the `yg-input-f` label wrapper, `FieldRow`, `SectionCard`, `FieldGroup`) - do not introduce a new field-rendering style.
