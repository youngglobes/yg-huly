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
  HR/Owner editor for the ygTimesheet.mixin.WorkProfile mixin: sets each active employee's
  employee ID, designation, and expected shift-start time. One row per employee, plain
  <input>/<select> + <input type="time">, written straight to the mixin on change (no separate
  save step). The designation <select> stores the option text itself (no per-title i18n).
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import { type MixinData } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet, { type WorkProfile, type WorkDesignation } from '@hcengineering/yg-timesheet'
  import { ensureHrMembership } from '../utils/hrMembership'
  import { DESIGNATIONS, hhmmToMinutes, minutesToHHMM } from '../utils/work-profile'

  onMount(() => { void ensureHrMembership() })

  const client = getClient()
  const h = client.getHierarchy()

  const empQuery = createQuery()
  let empDocs: Employee[] = []
  empQuery.query(contact.mixin.Employee, { active: true }, (res: Employee[]) => { empDocs = res })
  $: employees = [...empDocs].sort((a, b) => formatName(a.name).localeCompare(formatName(b.name)))

  const mixinOf = (emp: Employee): WorkProfile | undefined =>
    h.hasMixin(emp, ygTimesheet.mixin.WorkProfile) ? h.as(emp, ygTimesheet.mixin.WorkProfile) : undefined

  async function save (emp: Employee, upd: Partial<Pick<WorkProfile, 'designation' | 'employeeId' | 'shiftStart'>>): Promise<void> {
    if (h.hasMixin(emp, ygTimesheet.mixin.WorkProfile)) {
      await client.updateMixin(emp._id, contact.mixin.Employee, emp.space, ygTimesheet.mixin.WorkProfile, upd)
    } else {
      // All WorkProfile fields are optional, so a partial payload is a valid fresh mixin.
      await client.createMixin(
        emp._id,
        contact.mixin.Employee,
        emp.space,
        ygTimesheet.mixin.WorkProfile,
        upd as MixinData<Employee, WorkProfile>
      )
    }
  }

  function onDesignationChange (emp: Employee, value: string): void {
    if (value === '') return
    void save(emp, { designation: value as WorkDesignation })
  }

  function onEmployeeIdChange (emp: Employee, value: string): void {
    void save(emp, { employeeId: value.trim() })
  }

  function onShiftStartChange (emp: Employee, value: string): void {
    void save(emp, { shiftStart: value === '' ? undefined : hhmmToMinutes(value) })
  }
</script>

<div class="dash yg-page">
  <div class="yg-head">
    <h1 class="yg-title"><Label label={ygTimesheet.string.TeamProfiles} /></h1>
    <p class="wp-note">PMs are detected automatically and do not need a designation.</p>
  </div>
  <div class="yg-scroll">
    <table class="yg-table">
      <thead>
        <tr>
          <th class="left"><Label label={contact.string.Employee} /></th>
          <th class="left"><Label label={ygTimesheet.string.EmployeeId} /></th>
          <th class="left"><Label label={ygTimesheet.string.Designation} /></th>
          <th class="left"><Label label={ygTimesheet.string.ShiftStart} /></th>
        </tr>
      </thead>
      <tbody>
        {#each employees as emp (emp._id)}
          {@const mixin = mixinOf(emp)}
          <tr>
            <td class="left bold">{formatName(emp.name)}</td>
            <td class="left">
              <input
                class="yg-input"
                type="text"
                placeholder="YGS0024"
                value={mixin?.employeeId ?? ''}
                on:change={(e) => onEmployeeIdChange(emp, e.currentTarget.value)}
              />
            </td>
            <td class="left">
              <select
                class="yg-input"
                value={mixin?.designation ?? ''}
                on:change={(e) => onDesignationChange(emp, e.currentTarget.value)}
              >
                <option value="">-</option>
                {#each DESIGNATIONS as d (d)}
                  <option value={d}>{d}</option>
                {/each}
              </select>
            </td>
            <td class="left">
              <input
                class="yg-input"
                type="time"
                value={mixin?.shiftStart != null ? minutesToHHMM(mixin.shiftStart) : ''}
                on:change={(e) => onShiftStartChange(emp, e.currentTarget.value)}
              />
            </td>
          </tr>
        {:else}
          <tr><td colspan={4} class="yg-empty">No active employees.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;
  // See HrDashboard.svelte: this special has no navigator, so the page needs flex:1 to fill
  // the app pane instead of shrinking to content width.
  .dash { flex: 1; min-width: 0; }
  .wp-note {
    margin: 0 0 18px;
    font-size: 13px;
    color: var(--yg-text-dim);
  }
</style>
