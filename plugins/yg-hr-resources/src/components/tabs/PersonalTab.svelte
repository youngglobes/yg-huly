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
  nationality, blood group) each carry their own Edit/Save/Cancel - read-only FieldRows by default,
  plain inputs while editing. Employee id is HR/admin-editable like every other field here; nothing
  auto-reassigns it once the OnEmployeeCreate trigger has set it once.
-->
<script lang="ts">
  import { combineName, getFirstName, getLastName, type Employee } from '@hcengineering/contact'
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygHr, { type EmployeePersonal, type Gender, type MaritalStatus } from '@hcengineering/yg-hr'
  import FieldGroup from '../FieldGroup.svelte'
  import FieldRow from '../FieldRow.svelte'
  import SectionCard from '../SectionCard.svelte'
  import { capitalize, dateToInput, formatDisplayDate, inputToDate, saveEmployeeMixin } from '../../utils/profile'

  export let employee: Employee
  export let canEdit: boolean

  const client = getClient()
  const h = client.getHierarchy()

  $: personal = h.hasMixin(employee, ygHr.mixin.EmployeePersonal) ? h.as(employee, ygHr.mixin.EmployeePersonal) : undefined

  const GENDERS: Gender[] = ['male', 'female', 'other']
  const MARITAL: MaritalStatus[] = ['single', 'married', 'other']

  let editingIdentity = false
  let fFirstName = ''
  let fLastName = ''
  let fMiddleName = ''
  let fEmployeeId = ''
  let fGender: Gender | '' = ''
  let fDob = ''

  function beginIdentity (): void {
    fFirstName = getFirstName(employee.name)
    fLastName = getLastName(employee.name)
    fMiddleName = personal?.middleName ?? ''
    fEmployeeId = personal?.employeeId ?? ''
    fGender = personal?.gender ?? ''
    fDob = dateToInput(personal?.dateOfBirth)
    editingIdentity = true
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
      dateOfBirth: inputToDate(fDob)
    }
    await saveEmployeeMixin(client, h, employee, ygHr.mixin.EmployeePersonal, upd)
    editingIdentity = false
  }

  let editingDetails = false
  let fMarital: MaritalStatus | '' = ''
  let fNationality = ''
  let fBloodGroup = ''

  function beginDetails (): void {
    fMarital = personal?.maritalStatus ?? ''
    fNationality = personal?.nationality ?? ''
    fBloodGroup = personal?.bloodGroup ?? ''
    editingDetails = true
  }

  async function saveDetails (): Promise<void> {
    const upd: Partial<EmployeePersonal> = {
      maritalStatus: fMarital === '' ? undefined : fMarital,
      nationality: fNationality.trim() === '' ? undefined : fNationality.trim(),
      bloodGroup: fBloodGroup.trim() === '' ? undefined : fBloodGroup.trim()
    }
    await saveEmployeeMixin(client, h, employee, ygHr.mixin.EmployeePersonal, upd)
    editingDetails = false
  }
</script>

<div class="yg-cards">
  <SectionCard label={ygHr.string.Identity}>
    <svelte:fragment slot="actions">
      {#if canEdit && !editingIdentity}
        <button class="yg-iconbtn" on:click={beginIdentity}><Label label={ygHr.string.Edit} /></button>
      {:else if editingIdentity}
        <button class="yg-linkbtn" on:click={() => { editingIdentity = false }}><Label label={ygHr.string.Cancel} /></button>
        <button class="yg-linkbtn yg-linkbtn--accent" on:click={saveIdentity}><Label label={ygHr.string.Save} /></button>
      {/if}
    </svelte:fragment>

    {#if editingIdentity}
      <FieldGroup>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.FirstName} /></span>
          <input class="yg-input" type="text" bind:value={fFirstName} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.LastName} /></span>
          <input class="yg-input" type="text" bind:value={fLastName} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.MiddleName} /></span>
          <input class="yg-input" type="text" bind:value={fMiddleName} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.EmployeeId} /></span>
          <input class="yg-input" type="text" placeholder="YGS0000" bind:value={fEmployeeId} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Gender} /></span>
          <select class="yg-input" bind:value={fGender}>
            <option value="">-</option>
            {#each GENDERS as g (g)}<option value={g}>{capitalize(g)}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.DateOfBirth} /></span>
          <input class="yg-input" type="date" bind:value={fDob} />
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
      </FieldGroup>
    {/if}
  </SectionCard>

  <SectionCard label={ygHr.string.Details}>
    <svelte:fragment slot="actions">
      {#if canEdit && !editingDetails}
        <button class="yg-iconbtn" on:click={beginDetails}><Label label={ygHr.string.Edit} /></button>
      {:else if editingDetails}
        <button class="yg-linkbtn" on:click={() => { editingDetails = false }}><Label label={ygHr.string.Cancel} /></button>
        <button class="yg-linkbtn yg-linkbtn--accent" on:click={saveDetails}><Label label={ygHr.string.Save} /></button>
      {/if}
    </svelte:fragment>

    {#if editingDetails}
      <FieldGroup>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.MaritalStatus} /></span>
          <select class="yg-input" bind:value={fMarital}>
            <option value="">-</option>
            {#each MARITAL as m (m)}<option value={m}>{capitalize(m)}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Nationality} /></span>
          <input class="yg-input" type="text" bind:value={fNationality} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.BloodGroup} /></span>
          <input class="yg-input" type="text" placeholder="O+" bind:value={fBloodGroup} />
        </label>
      </FieldGroup>
    {:else}
      <FieldGroup>
        <FieldRow label={ygHr.string.MaritalStatus} value={capitalize(personal?.maritalStatus)} />
        <FieldRow label={ygHr.string.Nationality} value={personal?.nationality} />
        <FieldRow label={ygHr.string.BloodGroup} value={personal?.bloodGroup} />
      </FieldGroup>
    {/if}
  </SectionCard>
</div>

<style lang="scss">
  @use '../yg-profile' as *;
</style>
