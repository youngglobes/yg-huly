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
  Job tab (Task 10): the EmployeeJob mixin. Designation/department/employmentStatus/location are
  refs into the admin-managed HrConfig lists (see HrLists.svelte) - the shell queries all four and
  passes them down here so both the read-only badges and the edit-mode <select>s resolve against
  the same data. Contract end shows "Open" (not "Not set") when unset, matching the mockup.
-->
<script lang="ts">
  import type { Employee } from '@hcengineering/contact'
  import type { Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygHr, {
    type Department,
    type Designation,
    type EmployeeJob,
    type EmploymentStatus,
    type Location
  } from '@hcengineering/yg-hr'
  import FieldGroup from '../FieldGroup.svelte'
  import FieldRow from '../FieldRow.svelte'
  import SectionCard from '../SectionCard.svelte'
  import { dateToInput, formatDisplayDate, inputToDate, saveEmployeeMixin } from '../../utils/profile'

  export let employee: Employee
  export let canEdit: boolean
  export let designations: Designation[]
  export let departments: Department[]
  export let employmentStatuses: EmploymentStatus[]
  export let locations: Location[]

  const client = getClient()
  const h = client.getHierarchy()

  $: job = h.hasMixin(employee, ygHr.mixin.EmployeeJob) ? h.as(employee, ygHr.mixin.EmployeeJob) : undefined
  $: designationName = designations.find((d) => d._id === job?.designation)?.name
  $: departmentName = departments.find((d) => d._id === job?.department)?.name
  $: employmentStatusName = employmentStatuses.find((d) => d._id === job?.employmentStatus)?.name
  $: locationName = locations.find((d) => d._id === job?.location)?.name

  let editingRole = false
  let fDesignation = ''
  let fDepartment = ''
  let fEmploymentStatus = ''
  let fLocation = ''

  function beginRole (): void {
    fDesignation = job?.designation ?? ''
    fDepartment = job?.department ?? ''
    fEmploymentStatus = job?.employmentStatus ?? ''
    fLocation = job?.location ?? ''
    editingRole = true
  }

  async function saveRole (): Promise<void> {
    const upd: Partial<EmployeeJob> = {
      designation: fDesignation === '' ? undefined : (fDesignation as Ref<Designation>),
      department: fDepartment === '' ? undefined : (fDepartment as Ref<Department>),
      employmentStatus: fEmploymentStatus === '' ? undefined : (fEmploymentStatus as Ref<EmploymentStatus>),
      location: fLocation === '' ? undefined : (fLocation as Ref<Location>)
    }
    await saveEmployeeMixin(client, h, employee, ygHr.mixin.EmployeeJob, upd)
    editingRole = false
  }

  let editingDates = false
  let fJoined = ''
  let fContractStart = ''
  let fContractEnd = ''

  function beginDates (): void {
    fJoined = dateToInput(job?.joinedDate)
    fContractStart = dateToInput(job?.contractStart)
    fContractEnd = dateToInput(job?.contractEnd)
    editingDates = true
  }

  async function saveDates (): Promise<void> {
    const upd: Partial<EmployeeJob> = {
      joinedDate: inputToDate(fJoined),
      contractStart: inputToDate(fContractStart),
      contractEnd: inputToDate(fContractEnd)
    }
    await saveEmployeeMixin(client, h, employee, ygHr.mixin.EmployeeJob, upd)
    editingDates = false
  }
</script>

<div class="yg-cards">
  <SectionCard label={ygHr.string.Role}>
    <svelte:fragment slot="actions">
      {#if canEdit && !editingRole}
        <button class="yg-iconbtn" on:click={beginRole}><Label label={ygHr.string.Edit} /></button>
      {:else if editingRole}
        <button class="yg-linkbtn" on:click={() => { editingRole = false }}><Label label={ygHr.string.Cancel} /></button>
        <button class="yg-linkbtn yg-linkbtn--accent" on:click={saveRole}><Label label={ygHr.string.Save} /></button>
      {/if}
    </svelte:fragment>

    {#if editingRole}
      <FieldGroup>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Designation} /></span>
          <select class="yg-input" bind:value={fDesignation}>
            <option value="">-</option>
            {#each designations as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Department} /></span>
          <select class="yg-input" bind:value={fDepartment}>
            <option value="">-</option>
            {#each departments as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.EmploymentStatus} /></span>
          <select class="yg-input" bind:value={fEmploymentStatus}>
            <option value="">-</option>
            {#each employmentStatuses as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Location} /></span>
          <select class="yg-input" bind:value={fLocation}>
            <option value="">-</option>
            {#each locations as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
        </label>
      </FieldGroup>
    {:else}
      <FieldGroup>
        <FieldRow label={ygHr.string.Designation} empty={designationName === undefined}>
          <span class="yg-badge yg-badge--accent">{designationName}</span>
        </FieldRow>
        <FieldRow label={ygHr.string.Department} empty={departmentName === undefined}>
          <span class="yg-badge">{departmentName}</span>
        </FieldRow>
        <FieldRow label={ygHr.string.EmploymentStatus} value={employmentStatusName} />
        <FieldRow label={ygHr.string.Location} value={locationName} />
      </FieldGroup>
    {/if}
  </SectionCard>

  <SectionCard label={ygHr.string.Dates}>
    <svelte:fragment slot="actions">
      {#if canEdit && !editingDates}
        <button class="yg-iconbtn" on:click={beginDates}><Label label={ygHr.string.Edit} /></button>
      {:else if editingDates}
        <button class="yg-linkbtn" on:click={() => { editingDates = false }}><Label label={ygHr.string.Cancel} /></button>
        <button class="yg-linkbtn yg-linkbtn--accent" on:click={saveDates}><Label label={ygHr.string.Save} /></button>
      {/if}
    </svelte:fragment>

    {#if editingDates}
      <FieldGroup>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.JoinedDate} /></span>
          <input class="yg-input" type="date" bind:value={fJoined} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.ContractStart} /></span>
          <input class="yg-input" type="date" bind:value={fContractStart} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.ContractEnd} /></span>
          <input class="yg-input" type="date" bind:value={fContractEnd} />
        </label>
      </FieldGroup>
    {:else}
      <FieldGroup>
        <FieldRow label={ygHr.string.JoinedDate} value={formatDisplayDate(job?.joinedDate)} mono />
        <FieldRow label={ygHr.string.ContractStart} value={formatDisplayDate(job?.contractStart)} mono />
        <FieldRow
          label={ygHr.string.ContractEnd}
          value={formatDisplayDate(job?.contractEnd)}
          mono
          emptyLabel={ygHr.string.OpenEnded}
        />
      </FieldGroup>
    {/if}
  </SectionCard>
</div>

<style lang="scss">
  @use '../yg-profile' as *;
</style>
