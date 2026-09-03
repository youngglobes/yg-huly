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
  Modern employee directory (Task 11) - the "Employees" nav special. Read-only rows for everyone;
  the "+ Add employee" action is gated to HR/admin the same way HrLists.svelte gates its edit
  surface (isAdmin || isHrDesignationByFlag(myDesignation)). Rows open EmployeeProfile.svelte
  (Task 10) as a FULL-WIDTH page in place of this list (a `selectedEmployee` toggle, matching the
  approved mockup's directory/profile swap) rather than a platform panel - see
  models/yg-hr/src/index.ts's file-header comment for why the directory opens it directly instead
  of registering a global ObjectEditor.

  Only active employees are listed (contact.mixin.Employee, active: true) - matches the brief.
  Designation/department chips resolve the EmployeeJob mixin's refs against the same admin-managed
  HrConfig lists HrLists.svelte/EmployeeProfile.svelte read. Work email is read from the same
  login-email SocialIdentity EmployeeProfile.svelte's own header line uses, kept as the single
  source of truth for "work email" across the module.
-->
<script lang="ts">
  import contact, { formatName, getCurrentEmployee, type Employee, type Person } from '@hcengineering/contact'
  import { Avatar } from '@hcengineering/contact-resources'
  import { AccountRole, SocialIdType, getCurrentAccount, hasAccountRole, type Ref } from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygHr, {
    isHrDesignationByFlag,
    type Department,
    type Designation,
    type EmployeeJob,
    type EmployeeStatus
  } from '@hcengineering/yg-hr'
  import EmployeeProfile from './EmployeeProfile.svelte'
  import CreateEmployeePage from './CreateEmployeePage.svelte'

  const client = getClient()
  const h = client.getHierarchy()

  let employees: Employee[] = []
  let employeesLoaded = false
  const empQuery = createQuery()
  // Regular users only ever receive ACTIVE employees (the server never sends them on-hold or
  // deactivated people); HR/admin (canAdd) receive everyone so they can see and manage the full
  // roster. Reactive so it re-subscribes if canAdd flips true once the actor's HR designation loads.
  $: empQuery.query(contact.mixin.Employee, canAdd ? {} : { active: true }, (res) => {
    employees = res
    employeesLoaded = true
  })

  let designations: Designation[] = []
  let departments: Department[] = []
  let listsLoaded = false
  let designationsLoaded = false
  let departmentsLoaded = false
  const desigQuery = createQuery()
  desigQuery.query(ygHr.class.Designation, {}, (res) => { designations = res; designationsLoaded = true })
  const depQuery = createQuery()
  depQuery.query(ygHr.class.Department, {}, (res) => { departments = res; departmentsLoaded = true })
  $: listsLoaded = designationsLoaded && departmentsLoaded

  // Who may add: workspace Owner/Maintainer, or the current user's own designation is flagged HR -
  // same gate HrLists.svelte and EmployeeProfile.svelte use.
  const isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)
  const me = getCurrentEmployee()
  let myDesignationRef: Ref<Designation> | undefined
  let meLoaded = false
  const myQuery = createQuery()
  myQuery.query(contact.mixin.Employee, { _id: me }, (res) => {
    const emp = res[0]
    myDesignationRef = emp !== undefined && h.hasMixin(emp, ygHr.mixin.EmployeeJob)
      ? h.as(emp, ygHr.mixin.EmployeeJob).designation
      : undefined
    meLoaded = true
  })
  $: myDesignation = designations.find((d) => d._id === myDesignationRef)
  $: canAdd = isAdmin || isHrDesignationByFlag(myDesignation)

  $: ready = employeesLoaded && listsLoaded && meLoaded

  // Work email: the login-email SocialIdentity, same single source EmployeeProfile.svelte's
  // header line reads. One bulk query keyed by employee id (first match wins per employee).
  let emailByEmployee = new Map<Ref<Person>, string>()
  const emailQuery = createQuery()
  $: if (employees.length > 0) {
    emailQuery.query(
      contact.class.SocialIdentity,
      { attachedTo: { $in: employees.map((e) => e._id) }, type: SocialIdType.EMAIL },
      (res) => {
        const map = new Map<Ref<Person>, string>()
        for (const id of res) {
          if (!map.has(id.attachedTo)) map.set(id.attachedTo, id.value)
        }
        emailByEmployee = map
      }
    )
  } else {
    emailQuery.unsubscribe()
    emailByEmployee = new Map()
  }

  interface Row {
    employee: Employee
    job?: EmployeeJob
    designation?: Designation
    departmentName?: string
    email?: string
    isHr: boolean
    status: EmployeeStatus
  }

  $: designationById = new Map(designations.map((d) => [d._id, d]))
  $: departmentById = new Map(departments.map((d) => [d._id, d]))

  $: rows = employees
    .map((employee): Row => {
      const job = h.hasMixin(employee, ygHr.mixin.EmployeeJob) ? h.as(employee, ygHr.mixin.EmployeeJob) : undefined
      const designation = job?.designation !== undefined ? designationById.get(job.designation) : undefined
      const departmentName = job?.department !== undefined ? departmentById.get(job.department)?.name : undefined
      const personal = h.hasMixin(employee, ygHr.mixin.EmployeePersonal) ? h.as(employee, ygHr.mixin.EmployeePersonal) : undefined
      return {
        employee,
        job,
        designation,
        departmentName,
        email: emailByEmployee.get(employee._id),
        isHr: isHrDesignationByFlag(designation),
        status: personal?.status ?? 'active'
      }
    })
    .sort((a, b) => formatName(a.employee.name).localeCompare(formatName(b.employee.name)))

  let search = ''
  let departmentFilter: Ref<Department> | 'all' = 'all'
  // Status filter is only meaningful for HR/admin (they are the only ones who receive non-active
  // people); a regular user's list is always active-only regardless of this control.
  let statusFilter: EmployeeStatus | 'all' = 'all'
  $: sortedDepartments = [...departments].sort((a, b) => a.name.localeCompare(b.name))

  $: filteredRows = rows.filter((r) => {
    if (departmentFilter !== 'all' && r.job?.department !== departmentFilter) return false
    if (canAdd && statusFilter !== 'all' && r.status !== statusFilter) return false
    const q = search.trim().toLowerCase()
    if (q === '') return true
    const hay = `${formatName(r.employee.name)} ${r.designation?.name ?? ''} ${r.departmentName ?? ''}`.toLowerCase()
    return hay.includes(q)
  })

  const STATUS_FILTERS: Array<{ key: EmployeeStatus | 'all', label: typeof ygHr.string.AllStatuses }> = [
    { key: 'all', label: ygHr.string.AllStatuses },
    { key: 'active', label: ygHr.string.StatusActive },
    { key: 'onhold', label: ygHr.string.StatusOnHold },
    { key: 'deactivated', label: ygHr.string.StatusDeactivated }
  ]

  let searchPlaceholder = ''
  void translate(ygHr.string.SearchEmployeesPlaceholder, {}).then((r) => { searchPlaceholder = r })

  // Full-page swap (Task: PO UI refinement) - selecting a row hides this list and renders
  // EmployeeProfile in its place, matching the approved mockup's directory/profile toggle. The
  // profile's `back` event (its own "< Employees" link) returns here.
  let selectedEmployee: Employee | undefined
  // Full-page create form shown in place of this list (same swap pattern as the profile), replacing
  // the stock CreateEmployee popup.
  let creating = false

  function openEmployee (employee: Employee): void {
    selectedEmployee = employee
  }

  function openEmployeeKey (e: KeyboardEvent, employee: Employee): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openEmployee(employee)
    }
  }

  function backToDirectory (): void {
    selectedEmployee = undefined
  }

  function addEmployee (): void {
    creating = true
  }

  function onCreated (): void {
    creating = false
  }
</script>

{#if creating}
  <CreateEmployeePage {designations} {departments} on:created={onCreated} on:back={() => { creating = false }} />
{:else if selectedEmployee !== undefined}
  <EmployeeProfile _id={selectedEmployee._id} on:back={backToDirectory} />
{:else}
<div class="yg-directory">
  {#if ready}
    <div class="yg-dir-head">
      <h1 class="yg-dir-title"><Label label={ygHr.string.Employees} /></h1>
      <div class="yg-spacer" />
      {#if canAdd}
        <button class="yg-btn-dark" on:click={addEmployee}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
          <Label label={ygHr.string.AddEmployee} />
        </button>
      {/if}
    </div>

    <div class="yg-dir-toolbar">
      <div class="yg-dir-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
        <input type="text" placeholder={searchPlaceholder} bind:value={search} />
      </div>
      <div class="yg-dir-filters">
        <button class="yg-filter" class:yg-filter--on={departmentFilter === 'all'} on:click={() => { departmentFilter = 'all' }}>
          <Label label={ygHr.string.AllDepartments} />
        </button>
        {#each sortedDepartments as dep (dep._id)}
          <button class="yg-filter" class:yg-filter--on={departmentFilter === dep._id} on:click={() => { departmentFilter = dep._id }}>
            {dep.name}
          </button>
        {/each}
      </div>
    </div>

    {#if canAdd}
      <div class="yg-dir-filters yg-dir-statusfilter">
        {#each STATUS_FILTERS as sf (sf.key)}
          <button class="yg-filter" class:yg-filter--on={statusFilter === sf.key} on:click={() => { statusFilter = sf.key }}>
            <Label label={sf.label} />
          </button>
        {/each}
      </div>
    {/if}

    <div class="yg-dir-table-wrap">
      <table class="yg-dir-table">
        <thead>
          <tr>
            <th><Label label={ygHr.string.EmployeeColumn} /></th>
            <th class="yg-colhide"><Label label={ygHr.string.Designation} /></th>
            <th class="yg-colhide"><Label label={ygHr.string.Department} /></th>
            <th><Label label={ygHr.string.WorkEmail} /></th>
            <th><Label label={ygHr.string.StatusColumn} /></th>
          </tr>
        </thead>
        <tbody>
          {#each filteredRows as row (row.employee._id)}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
            <tr
              tabindex="0"
              on:click={() => { openEmployee(row.employee) }}
              on:keydown={(e) => { openEmployeeKey(e, row.employee) }}
            >
              <td>
                <div class="yg-dir-person">
                  <Avatar person={row.employee} size={'medium'} name={row.employee.name} />
                  <div class="yg-dir-person__text">
                    <div class="yg-dir-person__name">{formatName(row.employee.name)}</div>
                    <div class="yg-dir-person__sub">
                      {row.designation?.name ?? ''}{#if row.designation?.name !== undefined && row.departmentName !== undefined} - {/if}{row.departmentName ?? ''}
                    </div>
                  </div>
                </div>
              </td>
              <td class="yg-colhide">
                {#if row.designation?.name !== undefined}<span class="yg-badge yg-badge--accent">{row.designation.name}</span>{/if}
              </td>
              <td class="yg-colhide">
                {#if row.departmentName !== undefined}<span class="yg-badge">{row.departmentName}</span>{/if}
              </td>
              <td class="yg-dir-email">{row.email ?? ''}</td>
              <td>
                {#if row.status === 'active'}
                  <span class="yg-badge yg-badge--good yg-badge--dot"><Label label={ygHr.string.StatusActive} /></span>
                {:else if row.status === 'onhold'}
                  <span class="yg-badge yg-badge--amber yg-badge--dot"><Label label={ygHr.string.StatusOnHold} /></span>
                {:else}
                  <span class="yg-badge yg-badge--dot"><Label label={ygHr.string.StatusDeactivated} /></span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="yg-dir-note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
      <Label label={ygHr.string.DirectoryNote} />
    </div>
  {/if}
</div>
{/if}

<style lang="scss">
  @use './yg-profile' as *;

  // Local accent (petrol-teal), matching the approved mockup's --accent token - same idiom
  // EmployeeProfile.svelte/HrLists.svelte use.
  .yg-directory {
    --yg-accent: #0f766e;
    flex: 1;
    min-width: 0;
    padding: 28px 32px;
    overflow-y: auto;
    background: var(--theme-bg-color);
  }
  :global(.theme-dark) .yg-directory {
    --yg-accent: #2dd4bf;
  }

  .yg-dir-head {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    margin-bottom: 20px;
  }
  .yg-dir-title {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--theme-caption-color);
  }
  .yg-spacer {
    flex: 1;
  }

  .yg-dir-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }
  .yg-dir-search {
    flex: 1;
    min-width: 220px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 12px;
    background: var(--theme-panel-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 10px;
    color: var(--theme-trans-color);
  }
  .yg-dir-search svg {
    width: 16px;
    height: 16px;
    flex: none;
  }
  .yg-dir-search input {
    border: 0;
    background: transparent;
    font: inherit;
    color: var(--theme-content-color);
    width: 100%;
    outline: none;
  }
  .yg-dir-search input::placeholder {
    color: var(--theme-text-placeholder-color);
  }

  .yg-dir-filters {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
  }
  .yg-filter {
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid var(--theme-divider-color);
    background: var(--theme-panel-color);
    color: var(--theme-dark-color);
    cursor: pointer;
    white-space: nowrap;
  }
  .yg-filter--on {
    background: rgba(15, 118, 110, 0.12);
    color: #0b5b54;
    border-color: transparent;
  }
  :global(.theme-dark) .yg-filter--on {
    background: rgba(45, 212, 191, 0.13);
    color: #5eead4;
  }

  .yg-dir-table-wrap {
    background: var(--theme-panel-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  .yg-dir-table {
    width: 100%;
    border-collapse: collapse;
  }
  .yg-dir-table thead th {
    text-align: left;
    font-size: 11px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--theme-trans-color);
    font-weight: 600;
    padding: 12px 18px;
    border-bottom: 1px solid var(--theme-divider-color);
    background: var(--theme-comp-header-color);
  }
  .yg-dir-table tbody tr {
    cursor: pointer;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .yg-dir-table tbody tr:last-child {
    border-bottom: 0;
  }
  .yg-dir-table tbody tr:hover,
  .yg-dir-table tbody tr:focus-visible {
    background: var(--theme-comp-header-color);
    outline: none;
  }
  .yg-dir-table tbody td {
    padding: 12px 18px;
    vertical-align: middle;
  }

  .yg-dir-person {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .yg-dir-person__text {
    min-width: 0;
  }
  .yg-dir-person__name {
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .yg-dir-person__sub {
    font-size: 12.5px;
    color: var(--theme-trans-color);
  }
  .yg-dir-email {
    color: var(--theme-dark-color);
    font-size: 13.5px;
  }

  @media (max-width: 860px) {
    .yg-colhide {
      display: none;
    }
  }

  .yg-dir-note {
    margin-top: 20px;
    font-size: 12.5px;
    color: var(--theme-trans-color);
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .yg-dir-note svg {
    width: 14px;
    height: 14px;
    flex: none;
  }

  @media (max-width: 720px) {
    .yg-directory {
      padding: 18px;
    }
  }
</style>
