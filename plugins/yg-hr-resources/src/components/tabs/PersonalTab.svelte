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
  Personal tab (Task 10): the EmployeePersonal mixin plus the Person's own first/last name.
  Identity card (name, middle name, employee id, gender, DOB) and Details card (marital status,
  nationality, blood group) render read-only FieldRows or, while the profile-wide `editing` flag
  (PO UI refinement - the header's single Edit/Done toggle, EmployeeProfile.svelte) is on, plain
  inputs that live-save on change - no per-card Edit/Save/Cancel here anymore. Employee id is
  HR/admin-editable like every other field here; nothing auto-reassigns it once the
  OnEmployeeCreate trigger has set it once.
-->
<script lang="ts">
  import { combineName, getFirstName, getLastName, type Employee } from '@hcengineering/contact'
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygHr, { type EmployeePersonal, type Gender, type MaritalStatus } from '@hcengineering/yg-hr'
  import FieldGroup from '../FieldGroup.svelte'
  import FieldRow from '../FieldRow.svelte'
  import SectionAttachments from '../SectionAttachments.svelte'
  import SectionCard from '../SectionCard.svelte'
  import { capitalize, dateToInput, formatDisplayDate, inputToDate, saveEmployeeMixin } from '../../utils/profile'

  export let employee: Employee
  export let editing: boolean

  const client = getClient()
  const h = client.getHierarchy()

  $: personal = h.hasMixin(employee, ygHr.mixin.EmployeePersonal) ? h.as(employee, ygHr.mixin.EmployeePersonal) : undefined

  const GENDERS: Gender[] = ['male', 'female', 'other']
  const MARITAL: MaritalStatus[] = ['single', 'married', 'other']

  let fFirstName = ''
  let fLastName = ''
  let fMiddleName = ''
  let fEmployeeId = ''
  let fGender: Gender | '' = ''
  let fDob = ''
  let fNickname = ''

  // Re-seed the edit-mode fields from the live doc whenever edit mode turns on (and keep them in
  // sync with our own just-saved values afterwards) - there is no separate "begin edit" step now
  // that editing is a single profile-wide toggle instead of a per-card one.
  $: if (editing) {
    fFirstName = getFirstName(employee.name)
    fLastName = getLastName(employee.name)
    fMiddleName = personal?.middleName ?? ''
    fEmployeeId = personal?.employeeId ?? ''
    fGender = personal?.gender ?? ''
    fDob = dateToInput(personal?.dateOfBirth)
    fNickname = personal?.nickname ?? ''
  }

  async function saveIdentity (): Promise<void> {
    const name = combineName(fFirstName.trim(), fLastName.trim())
    if (name !== employee.name) {
      await client.update(employee, { name })
    }
    const upd: Partial<EmployeePersonal> = {
      middleName: fMiddleName.trim() === '' ? undefined : fMiddleName.trim(),
      employeeId: fEmployeeId.trim() === '' ? undefined : fEmployeeId.trim(),
      gender: fGender === '' ? undefined : fGender,
      dateOfBirth: inputToDate(fDob),
      nickname: fNickname.trim() === '' ? undefined : fNickname.trim()
    }
    await saveEmployeeMixin(client, h, employee, ygHr.mixin.EmployeePersonal, upd)
  }

  let fMarital: MaritalStatus | '' = ''
  let fNationality = ''
  let fBloodGroup = ''
  let fOtherId = ''
  let fDriverLicenseNo = ''
  let fDriverLicenseExpiry = ''

  $: if (editing) {
    fMarital = personal?.maritalStatus ?? ''
    fNationality = personal?.nationality ?? ''
    fBloodGroup = personal?.bloodGroup ?? ''
    fOtherId = personal?.otherId ?? ''
    fDriverLicenseNo = personal?.driverLicenseNo ?? ''
    fDriverLicenseExpiry = dateToInput(personal?.driverLicenseExpiry)
  }

  async function saveDetails (): Promise<void> {
    const upd: Partial<EmployeePersonal> = {
      maritalStatus: fMarital === '' ? undefined : fMarital,
      nationality: fNationality.trim() === '' ? undefined : fNationality.trim(),
      bloodGroup: fBloodGroup.trim() === '' ? undefined : fBloodGroup.trim(),
      otherId: fOtherId.trim() === '' ? undefined : fOtherId.trim(),
      driverLicenseNo: fDriverLicenseNo.trim() === '' ? undefined : fDriverLicenseNo.trim(),
      driverLicenseExpiry: inputToDate(fDriverLicenseExpiry)
    }
    await saveEmployeeMixin(client, h, employee, ygHr.mixin.EmployeePersonal, upd)
  }
</script>

<div class="yg-cards">
  <SectionCard label={ygHr.string.Identity}>
    {#if editing}
      <FieldGroup>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.FirstName} /></span>
          <input class="yg-input" type="text" bind:value={fFirstName} on:change={saveIdentity} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.LastName} /></span>
          <input class="yg-input" type="text" bind:value={fLastName} on:change={saveIdentity} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.MiddleName} /></span>
          <input class="yg-input" type="text" bind:value={fMiddleName} on:change={saveIdentity} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.EmployeeId} /></span>
          <input class="yg-input" type="text" placeholder="YGS0000" bind:value={fEmployeeId} on:change={saveIdentity} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Gender} /></span>
          <select class="yg-input" bind:value={fGender} on:change={saveIdentity}>
            <option value="">-</option>
            {#each GENDERS as g (g)}<option value={g}>{capitalize(g)}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.DateOfBirth} /></span>
          <input class="yg-input" type="date" bind:value={fDob} on:change={saveIdentity} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Nickname} /></span>
          <input class="yg-input" type="text" bind:value={fNickname} on:change={saveIdentity} />
        </label>
      </FieldGroup>
    {:else}
      <FieldGroup>
        <FieldRow label={ygHr.string.FirstName} value={getFirstName(employee.name)} />
        <FieldRow label={ygHr.string.LastName} value={getLastName(employee.name)} />
        <FieldRow label={ygHr.string.MiddleName} value={personal?.middleName} />
        <FieldRow label={ygHr.string.EmployeeId} value={personal?.employeeId} mono />
        <FieldRow label={ygHr.string.Gender} value={capitalize(personal?.gender)} />
        <FieldRow label={ygHr.string.DateOfBirth} value={formatDisplayDate(personal?.dateOfBirth)} mono />
        <FieldRow label={ygHr.string.Nickname} value={personal?.nickname} />
      </FieldGroup>
    {/if}
  </SectionCard>

  <SectionCard label={ygHr.string.Details}>
    {#if editing}
      <FieldGroup>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.MaritalStatus} /></span>
          <select class="yg-input" bind:value={fMarital} on:change={saveDetails}>
            <option value="">-</option>
            {#each MARITAL as m (m)}<option value={m}>{capitalize(m)}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Nationality} /></span>
          <input class="yg-input" type="text" bind:value={fNationality} on:change={saveDetails} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.BloodGroup} /></span>
          <input class="yg-input" type="text" placeholder="O+" bind:value={fBloodGroup} on:change={saveDetails} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.OtherId} /></span>
          <input class="yg-input" type="text" bind:value={fOtherId} on:change={saveDetails} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.DriverLicenseNo} /></span>
          <input class="yg-input" type="text" bind:value={fDriverLicenseNo} on:change={saveDetails} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.DriverLicenseExpiry} /></span>
          <input class="yg-input" type="date" bind:value={fDriverLicenseExpiry} on:change={saveDetails} />
        </label>
      </FieldGroup>
    {:else}
      <FieldGroup>
        <FieldRow label={ygHr.string.MaritalStatus} value={capitalize(personal?.maritalStatus)} />
        <FieldRow label={ygHr.string.Nationality} value={personal?.nationality} />
        <FieldRow label={ygHr.string.BloodGroup} value={personal?.bloodGroup} />
        <FieldRow label={ygHr.string.OtherId} value={personal?.otherId} />
        <FieldRow label={ygHr.string.DriverLicenseNo} value={personal?.driverLicenseNo} mono />
        <FieldRow label={ygHr.string.DriverLicenseExpiry} value={formatDisplayDate(personal?.driverLicenseExpiry)} mono />
      </FieldGroup>
    {/if}
  </SectionCard>

  <SectionAttachments {employee} collection={'personalFiles'} canEdit={editing} />
</div>

<style lang="scss">
  @use '../yg-profile' as *;
</style>
