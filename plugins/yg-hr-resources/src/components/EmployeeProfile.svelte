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
  Modern tabbed employee profile (Task 10) - the shell: identity header + tab bar + active tab pane.
  Self-contained: takes just an employee `_id` (the standard panel prop shape) and does its own
  queries, same as every other yg-hr-resources component. NOT wired as the platform's
  view.mixin.ObjectEditor for contact.mixin.Employee/Person - see the file-header note in
  models/yg-hr/src/index.ts for why (blast radius across every other Employee panel in the app);
  Task 11's directory opens this directly instead.

  Read-only by default. `canEdit` (HR/admin) unlocks every card's own Edit/Save/Cancel; a self
  viewer who isn't HR gets ONLY the avatar as an editable affordance - everything else stays
  FieldRow read-only. No activity feed, comments, Collaborators, or attachments anywhere here.
-->
<script lang="ts">
  import contact, { formatName, getCurrentEmployee, type Employee } from '@hcengineering/contact'
  import { Avatar, EditableAvatar } from '@hcengineering/contact-resources'
  import { AccountRole, SocialIdType, getCurrentAccount, hasAccountRole, type Ref } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { closePanel, IconArrowLeft, Label } from '@hcengineering/ui'
  import ygHr, {
    isHrDesignationByFlag,
    type Department,
    type Designation,
    type EmploymentStatus,
    type Location
  } from '@hcengineering/yg-hr'
  import ContactTab from './tabs/ContactTab.svelte'
  import EmergencyTab from './tabs/EmergencyTab.svelte'
  import JobTab from './tabs/JobTab.svelte'
  import PersonalTab from './tabs/PersonalTab.svelte'

  export let _id: Ref<Employee>
  export let readonly: boolean = false

  const client = getClient()
  const h = client.getHierarchy()

  let employee: Employee | undefined
  const empQuery = createQuery()
  $: empQuery.query(contact.mixin.Employee, { _id }, (res) => { employee = res[0] })

  const me = getCurrentEmployee()
  const isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  let myEmployee: Employee | undefined
  const myQuery = createQuery()
  myQuery.query(contact.mixin.Employee, { _id: me }, (res) => { myEmployee = res[0] })

  let designations: Designation[] = []
  let departments: Department[] = []
  let employmentStatuses: EmploymentStatus[] = []
  let locations: Location[] = []
  const desigQuery = createQuery()
  desigQuery.query(ygHr.class.Designation, {}, (res) => { designations = res })
  const depQuery = createQuery()
  depQuery.query(ygHr.class.Department, {}, (res) => { departments = res })
  const statusQuery = createQuery()
  statusQuery.query(ygHr.class.EmploymentStatus, {}, (res) => { employmentStatuses = res })
  const locQuery = createQuery()
  locQuery.query(ygHr.class.Location, {}, (res) => { locations = res })

  $: myDesignationRef = myEmployee !== undefined && h.hasMixin(myEmployee, ygHr.mixin.EmployeeJob)
    ? h.as(myEmployee, ygHr.mixin.EmployeeJob).designation
    : undefined
  $: myDesignation = designations.find((d) => d._id === myDesignationRef)
  $: canEdit = !readonly && (isAdmin || isHrDesignationByFlag(myDesignation))
  $: isSelf = employee !== undefined && employee._id === me
  $: canEditPhoto = !readonly && (canEdit || isSelf)

  $: profilePersonal = employee !== undefined && h.hasMixin(employee, ygHr.mixin.EmployeePersonal)
    ? h.as(employee, ygHr.mixin.EmployeePersonal)
    : undefined
  $: profileJob = employee !== undefined && h.hasMixin(employee, ygHr.mixin.EmployeeJob)
    ? h.as(employee, ygHr.mixin.EmployeeJob)
    : undefined
  $: profileDesignation = designations.find((d) => d._id === profileJob?.designation)
  $: profileDepartmentName = departments.find((d) => d._id === profileJob?.department)?.name
  $: profileLocationName = locations.find((d) => d._id === profileJob?.location)?.name
  $: profileIsHr = isHrDesignationByFlag(profileDesignation)

  let workEmail: string | undefined
  const emailQuery = createQuery()
  $: if (employee !== undefined) {
    emailQuery.query(
      contact.class.SocialIdentity,
      { attachedTo: employee._id, type: SocialIdType.EMAIL },
      (res) => { workEmail = res[0]?.value }
    )
  } else {
    emailQuery.unsubscribe()
    workEmail = undefined
  }

  let avatarEditor: EditableAvatar
  async function onAvatarDone (): Promise<void> {
    if (employee === undefined) return
    if (employee.avatar != null) {
      await avatarEditor.removeAvatar(employee.avatar)
    }
    const avatar = await avatarEditor.createAvatar()
    await client.diffUpdate(employee, avatar)
  }

  type TabKey = 'personal' | 'contact' | 'job' | 'emergency'
  let activeTab: TabKey = 'personal'
  const TABS: Array<{ key: TabKey, label: IntlString }> = [
    { key: 'personal', label: ygHr.string.Personal },
    { key: 'contact', label: ygHr.string.Contact },
    { key: 'job', label: ygHr.string.Job },
    { key: 'emergency', label: ygHr.string.Emergency }
  ]

  // The header's own Edit affordance jumps to the Personal tab, where the name/photo actually live
  // - each SectionCard still owns its own Edit/Save/Cancel (see PersonalTab.svelte), so this is a
  // shortcut into the editable surface rather than a second, competing edit-mode toggle.
  function headerEditClick (): void {
    activeTab = 'personal'
  }

  // Task 11 opens this component in a platform panel (showPanel) rather than a Panel-chrome
  // component, so there is otherwise no visible way back to the directory besides Escape/
  // click-outside - this mirrors the approved mockup's own "< Employees" back link exactly.
  // Harmless no-op if this component is ever rendered outside a panel (closePanel just clears an
  // already-empty panel store).
  function backClick (): void {
    closePanel()
  }
</script>

<div class="yg-profile">
  {#if employee !== undefined}
    <button class="yg-back" on:click={backClick}>
      <IconArrowLeft size={'small'} />
      <Label label={ygHr.string.Employees} />
    </button>
    <div class="yg-idcard">
      <div class="yg-idcard__rail" />
      <div class="yg-idcard__avatar">
        {#if canEditPhoto}
          <EditableAvatar person={employee} size={'x-large'} name={employee.name} bind:this={avatarEditor} on:done={onAvatarDone} />
        {:else}
          <Avatar person={employee} size={'x-large'} name={employee.name} />
        {/if}
      </div>
      <div class="yg-idcard__who">
        <h2 class="yg-idcard__name">{formatName(employee.name)}</h2>
        <div class="yg-idcard__role">
          {#if profileDesignation?.name !== undefined}<span>{profileDesignation.name}</span>{/if}
          {#if profileDesignation?.name !== undefined && profileDepartmentName !== undefined}<span class="yg-sep" />{/if}
          {#if profileDepartmentName !== undefined}<span>{profileDepartmentName}</span>{/if}
          {#if (profileDesignation?.name !== undefined || profileDepartmentName !== undefined) && workEmail !== undefined}<span class="yg-sep" />{/if}
          {#if workEmail !== undefined}<span>{workEmail}</span>{/if}
        </div>
        <div class="yg-idcard__meta">
          {#if profilePersonal?.employeeId !== undefined && profilePersonal.employeeId !== ''}
            <span class="yg-badge yg-badge--accent mono">{profilePersonal.employeeId}</span>
          {/if}
          {#if profileIsHr}
            <span class="yg-badge yg-badge--amber yg-badge--dot"><Label label={ygHr.string.IsHr} /></span>
          {:else}
            <span class="yg-badge yg-badge--good yg-badge--dot">
              <Label label={employee.active ? ygHr.string.Active : ygHr.string.Inactive} />
            </span>
          {/if}
          {#if profileLocationName !== undefined}<span class="yg-badge">{profileLocationName}</span>{/if}
        </div>
      </div>
      {#if canEdit}
        <div class="yg-idcard__actions">
          <button class="yg-editbtn" on:click={headerEditClick}><Label label={ygHr.string.Edit} /></button>
        </div>
      {/if}
    </div>

    <div class="yg-tabs">
      {#each TABS as t (t.key)}
        <button class="yg-tab" class:yg-tab--on={activeTab === t.key} on:click={() => { activeTab = t.key }}>
          <Label label={t.label} />
        </button>
      {/each}
    </div>

    <div class="yg-tabpane">
      {#if activeTab === 'personal'}
        <PersonalTab {employee} {canEdit} />
      {:else if activeTab === 'contact'}
        <ContactTab {employee} {canEdit} {workEmail} />
      {:else if activeTab === 'job'}
        <JobTab {employee} {canEdit} {designations} {departments} {employmentStatuses} {locations} />
      {:else}
        <EmergencyTab {employee} {canEdit} />
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  @use './yg-profile' as *;

  // Local accent (petrol-teal), matching the approved mockup's --accent token - same idiom
  // HrLists.svelte uses. Defined once here; every descendant (SectionCard/FieldRow/tab panes)
  // reads it via normal CSS custom-property inheritance.
  .yg-profile {
    --yg-accent: #0f766e;
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 28px 32px;
    background: var(--theme-bg-color);
  }
  :global(.theme-dark) .yg-profile {
    --yg-accent: #2dd4bf;
  }

  .yg-back {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font: inherit;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--theme-dark-color);
    background: none;
    border: 0;
    padding: 0;
    margin-bottom: 16px;
    cursor: pointer;
  }
  .yg-back:hover {
    color: var(--theme-caption-color);
  }

  .yg-idcard {
    position: relative;
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 22px 24px;
    background: var(--theme-panel-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 14px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    overflow: hidden;
  }
  .yg-idcard__rail {
    position: absolute;
    inset: 0 auto 0 0;
    width: 4px;
    background: var(--yg-accent);
  }
  .yg-idcard__avatar {
    flex: none;
  }
  .yg-idcard__who {
    min-width: 0;
    flex: 1;
  }
  .yg-idcard__name {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--theme-caption-color);
  }
  .yg-idcard__role {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
    font-size: 14px;
    color: var(--theme-dark-color);
  }
  .yg-sep {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--theme-trans-color);
    flex: none;
  }
  .yg-idcard__meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 12px;
  }
  .yg-idcard__meta .mono {
    font-family: var(--theme-font-mono, ui-monospace, monospace);
    font-variant-numeric: tabular-nums;
  }
  .yg-idcard__actions {
    flex: none;
    align-self: flex-start;
  }

  .yg-editbtn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font: inherit;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--theme-content-color);
    background: var(--theme-panel-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 10px;
    padding: 8px 14px;
    cursor: pointer;
  }
  .yg-editbtn:hover {
    border-color: var(--theme-trans-color);
  }

  .yg-tabs {
    display: flex;
    gap: 3px;
    margin: 22px 0 18px;
    border-bottom: 1px solid var(--theme-divider-color);
    overflow-x: auto;
  }
  .yg-tab {
    font: inherit;
    font-weight: 600;
    font-size: 14px;
    color: var(--theme-dark-color);
    background: none;
    border: 0;
    padding: 11px 15px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;
  }
  .yg-tab:hover {
    color: var(--theme-caption-color);
  }
  .yg-tab--on {
    color: var(--yg-accent);
    border-bottom-color: var(--yg-accent);
  }

  .yg-tabpane {
    animation: yg-fade 0.2s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .yg-tabpane {
      animation: none;
    }
  }
  @keyframes yg-fade {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (max-width: 720px) {
    .yg-profile {
      padding: 18px;
    }
    .yg-idcard {
      flex-direction: column;
      align-items: flex-start;
    }
    .yg-idcard__actions {
      align-self: stretch;
    }
  }
</style>
