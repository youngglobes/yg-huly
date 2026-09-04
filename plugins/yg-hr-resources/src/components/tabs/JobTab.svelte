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
  the same data. Contract end shows "Open" (not "Not set") when unset, matching the mockup. Both
  cards render read-only FieldRows or, while the profile-wide `editing` flag (PO UI refinement -
  the header's single Edit/Done toggle, EmployeeProfile.svelte) is on, plain inputs that live-save
  on change.
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
    type Location,
    type TerminationReason
  } from '@hcengineering/yg-hr'
  import FieldGroup from '../FieldGroup.svelte'
  import FieldRow from '../FieldRow.svelte'
  import SectionCard from '../SectionCard.svelte'
  import { dateToInput, formatDisplayDate, inputToDate, saveEmployeeMixin } from '../../utils/profile'

  export let employee: Employee
  export let editing: boolean
  export let designations: Designation[]
  export let departments: Department[]
  export let employmentStatuses: EmploymentStatus[]
  export let locations: Location[]
  export let terminationReasons: TerminationReason[]

  const client = getClient()
  const h = client.getHierarchy()

  $: job = h.hasMixin(employee, ygHr.mixin.EmployeeJob) ? h.as(employee, ygHr.mixin.EmployeeJob) : undefined
  $: designationName = designations.find((d) => d._id === job?.designation)?.name
  $: departmentName = departments.find((d) => d._id === job?.department)?.name
  $: employmentStatusName = employmentStatuses.find((d) => d._id === job?.employmentStatus)?.name
  $: locationName = locations.find((d) => d._id === job?.location)?.name
  $: shiftStartDisplay = minutesToTime(job?.shiftStart)

  // shiftStart is stored as minutes since local midnight (540 = 09:00), unified from WorkProfile. The
  // <input type="time"> uses a "HH:MM" string, so convert both ways.
  function minutesToTime (m: number | undefined): string | undefined {
    if (m === undefined || m === null) return undefined
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    return `${hh}:${mm}`
  }
  function timeToMinutes (s: string): number | undefined {
    if (s === '') return undefined
    const [hh, mm] = s.split(':').map((p) => Number.parseInt(p, 10))
    if (Number.isNaN(hh) || Number.isNaN(mm)) return undefined
    return hh * 60 + mm
  }

  let fDesignation = ''
  let fDepartment = ''
  let fEmploymentStatus = ''
  let fLocation = ''
  let fShiftStart = ''

  $: if (editing) {
    fDesignation = job?.designation ?? ''
    fDepartment = job?.department ?? ''
    fEmploymentStatus = job?.employmentStatus ?? ''
    fLocation = job?.location ?? ''
    fShiftStart = minutesToTime(job?.shiftStart) ?? ''
  }

  async function saveRole (): Promise<void> {
    const upd: Partial<EmployeeJob> = {
      designation: fDesignation === '' ? undefined : (fDesignation as Ref<Designation>),
      department: fDepartment === '' ? undefined : (fDepartment as Ref<Department>),
      employmentStatus: fEmploymentStatus === '' ? undefined : (fEmploymentStatus as Ref<EmploymentStatus>),
      location: fLocation === '' ? undefined : (fLocation as Ref<Location>),
      shiftStart: timeToMinutes(fShiftStart)
    }
    await saveEmployeeMixin(client, h, employee, ygHr.mixin.EmployeeJob, upd)
  }

  let fJoined = ''
  let fContractStart = ''
  let fContractEnd = ''

  $: if (editing) {
    fJoined = dateToInput(job?.joinedDate)
    fContractStart = dateToInput(job?.contractStart)
    fContractEnd = dateToInput(job?.contractEnd)
  }

  async function saveDates (): Promise<void> {
    const upd: Partial<EmployeeJob> = {
      joinedDate: inputToDate(fJoined),
      contractStart: inputToDate(fContractStart),
      contractEnd: inputToDate(fContractEnd)
    }
    await saveEmployeeMixin(client, h, employee, ygHr.mixin.EmployeeJob, upd)
  }

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
</script>

<div class="yg-cards">
  <SectionCard label={ygHr.string.Role}>
    {#if editing}
      <FieldGroup>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Designation} /></span>
          <select class="yg-input" bind:value={fDesignation} on:change={saveRole}>
            <option value="">-</option>
            {#each designations as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Department} /></span>
          <select class="yg-input" bind:value={fDepartment} on:change={saveRole}>
            <option value="">-</option>
            {#each departments as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.EmploymentStatus} /></span>
          <select class="yg-input" bind:value={fEmploymentStatus} on:change={saveRole}>
            <option value="">-</option>
            {#each employmentStatuses as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Location} /></span>
          <select class="yg-input" bind:value={fLocation} on:change={saveRole}>
            <option value="">-</option>
            {#each locations as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.ShiftStart} /></span>
          <input class="yg-input" type="time" bind:value={fShiftStart} on:change={saveRole} />
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
        <FieldRow label={ygHr.string.ShiftStart} value={shiftStartDisplay} mono />
      </FieldGroup>
    {/if}
  </SectionCard>

  <SectionCard label={ygHr.string.Dates}>
    {#if editing}
      <FieldGroup>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.JoinedDate} /></span>
          <input class="yg-input" type="date" bind:value={fJoined} on:change={saveDates} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.ContractStart} /></span>
          <input class="yg-input" type="date" bind:value={fContractStart} on:change={saveDates} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.ContractEnd} /></span>
          <input class="yg-input" type="date" bind:value={fContractEnd} on:change={saveDates} />
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

  <SectionCard label={ygHr.string.Termination}>
    {#if editing}
      <FieldGroup>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.TerminationDate} /></span>
          <input class="yg-input" type="date" bind:value={fTerminationDate} on:change={saveTermination} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.TerminationReason} /></span>
          <select class="yg-input" bind:value={fTerminationReason} on:change={saveTermination}>
            <option value="">-</option>
            {#each terminationReasons as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
        </label>
      </FieldGroup>
    {:else}
      <FieldGroup>
        <FieldRow label={ygHr.string.TerminationDate} value={formatDisplayDate(job?.terminationDate)} mono />
        <FieldRow label={ygHr.string.TerminationReason} value={terminationReasonName} />
      </FieldGroup>
    {/if}
  </SectionCard>
</div>

<style lang="scss">
  @use '../yg-profile' as *;
</style>
