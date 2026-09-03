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
  the directory (EmployeeDirectory.svelte) renders this directly, full-width, in place of its own
  list - not via a platform panel - and handles the `back` event this dispatches.

  Read-only by default. `canEdit` (HR/admin) unlocks a SINGLE header Edit/Done toggle (`editing`)
  that every tab receives as a prop and renders its inline editors against, live-saving each field
  on change - there is no more per-card Edit/Save/Cancel. A self viewer who isn't HR gets ONLY the
  avatar as an editable affordance - everything else stays FieldRow read-only, and `editing` can
  never go true for them (no button to trigger it, and it self-resets if canEdit ever goes false).
  No activity feed, comments, Collaborators, or attachments anywhere here.
-->
<script lang="ts">
  import contact, { formatName, getCurrentEmployee, type Employee } from '@hcengineering/contact'
  import { Avatar, EditableAvatar } from '@hcengineering/contact-resources'
  import core, {
    AccountRole,
    SocialIdType,
    getCurrentAccount,
    hasAccountRole,
    type AccountUuid,
    type Ref
  } from '@hcengineering/core'
  import login from '@hcengineering/login'
  import { getResource, translate, type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { IconArrowLeft, Label, Spinner, addNotification, NotificationSeverity } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import YgToast from './YgToast.svelte'
  import ygHr, {
    type Department,
    type Designation,
    type EmployeeStatus,
    type EmploymentStatus,
    type Location
  } from '@hcengineering/yg-hr'
  import ContactTab from './tabs/ContactTab.svelte'
  import EmergencyTab from './tabs/EmergencyTab.svelte'
  import JobTab from './tabs/JobTab.svelte'
  import PersonalTab from './tabs/PersonalTab.svelte'

  const dispatch = createEventDispatcher<{ back: void }>()

  export let _id: Ref<Employee>
  export let readonly: boolean = false

  const client = getClient()
  const h = client.getHierarchy()

  let employee: Employee | undefined
  const empQuery = createQuery()
  $: empQuery.query(contact.mixin.Employee, { _id }, (res) => { employee = res[0] })

  const me = getCurrentEmployee()
  const isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  // "HR" = membership in the Roster-managed HR team (ygTimesheet.space.HrData), the same source the
  // timesheet features and the server guard use (replaces the old per-designation isHr flag).
  let hrMembers: AccountUuid[] = []
  const hrQuery = createQuery()
  hrQuery.query(core.class.Space, { _id: ygTimesheet.space.HrData }, (res) => { hrMembers = res[0]?.members ?? [] })
  $: isHrMember = hrMembers.includes(getCurrentAccount().uuid)

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

  $: canEdit = !readonly && (isAdmin || isHrMember)
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
  $: profileIsHr = employee?.personUuid !== undefined && hrMembers.includes(employee.personUuid)

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

  // The SINGLE profile-wide edit toggle (PO UI refinement) - every tab receives this as a prop and
  // renders its inline, live-saving editors against it instead of owning a per-card Edit/Save/
  // Cancel triad. Self-resets if canEdit ever goes false, so it can never read true for a viewer
  // the header button was never shown to.
  let editing = false
  $: if (!canEdit) editing = false

  function toggleEdit (): void {
    editing = !editing
  }

  $: profileStatus = (profilePersonal?.status ?? 'active') as EmployeeStatus

  // Set ONLY the lifecycle status. The server (OnEmployeeStatusChange) derives contact.mixin.
  // Employee.active from it and, on Deactivated, revokes the workspace membership - the client must
  // never write `active` or touch membership itself.
  async function changeStatus (e: Event): Promise<void> {
    if (employee === undefined) return
    const value = (e.currentTarget as HTMLSelectElement).value as EmployeeStatus
    if (value === profileStatus) return
    await client.updateMixin(employee._id, contact.mixin.Employee, employee.space, ygHr.mixin.EmployeePersonal, {
      status: value
    })
  }

  let inviting = false
  async function sendInvitation (): Promise<void> {
    if (workEmail === undefined || inviting) return
    inviting = true
    try {
      const sendInvite = await getResource(login.function.SendInvite)
      await sendInvite(workEmail, AccountRole.User)
      const title = await translate(ygHr.string.InvitationSent, {})
      addNotification(title, workEmail, YgToast, undefined, NotificationSeverity.Success)
    } finally {
      inviting = false
    }
  }

  // Pre-translated <option> labels (a <select>'s <option> cannot host a <Label> component).
  let statusActiveLabel = ''
  let statusOnHoldLabel = ''
  let statusDeactivatedLabel = ''
  void translate(ygHr.string.StatusActive, {}).then((r) => { statusActiveLabel = r })
  void translate(ygHr.string.StatusOnHold, {}).then((r) => { statusOnHoldLabel = r })
  void translate(ygHr.string.StatusDeactivated, {}).then((r) => { statusDeactivatedLabel = r })

  // The directory (EmployeeDirectory.svelte) renders this component directly, full-width, in
  // place of its own list rather than via a platform panel - this mirrors the approved mockup's
  // own "< Employees" back link, and the parent clears its `selectedEmployee` on the event.
  function backClick (): void {
    dispatch('back')
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
          {/if}
          {#if profileStatus === 'active'}
            <span class="yg-badge yg-badge--good yg-badge--dot"><Label label={ygHr.string.StatusActive} /></span>
          {:else if profileStatus === 'onhold'}
            <span class="yg-badge yg-badge--amber yg-badge--dot"><Label label={ygHr.string.StatusOnHold} /></span>
          {:else}
            <span class="yg-badge yg-badge--dot"><Label label={ygHr.string.StatusDeactivated} /></span>
          {/if}
          {#if profileLocationName !== undefined}<span class="yg-badge">{profileLocationName}</span>{/if}
        </div>
      </div>
      {#if canEdit}
        <div class="yg-idcard__actions">
          {#if editing}
            <label class="yg-status-edit">
              <span><Label label={ygHr.string.Status} /></span>
              <select class="yg-input yg-status-select" value={profileStatus} on:change={changeStatus}>
                <option value="active">{statusActiveLabel}</option>
                <option value="onhold">{statusOnHoldLabel}</option>
                <option value="deactivated">{statusDeactivatedLabel}</option>
              </select>
            </label>
          {/if}
          <div class="yg-idcard__btns">
            <button class="yg-ghostbtn" on:click={sendInvitation} disabled={workEmail === undefined || inviting}>
              {#if inviting}<span class="yg-btn-spin"><Spinner size={'small'} /></span>{/if}
              <Label label={ygHr.string.SendInvitation} />
            </button>
            <button class="yg-btn-dark" on:click={toggleEdit}>
              {#if editing}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5" /></svg>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 20h4l10-10-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
              {/if}
              <Label label={editing ? ygHr.string.Done : ygHr.string.Edit} />
            </button>
          </div>
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

    {#key activeTab}
      <div class="yg-tabpane">
        {#if activeTab === 'personal'}
          <PersonalTab {employee} {editing} />
        {:else if activeTab === 'contact'}
          <ContactTab {employee} {editing} {workEmail} />
        {:else if activeTab === 'job'}
          <JobTab {employee} {editing} {designations} {departments} {employmentStatuses} {locations} />
        {:else}
          <EmergencyTab {employee} {editing} />
        {/if}
      </div>
    {/key}
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
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
  }
  .yg-idcard__btns {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .yg-status-edit {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--theme-trans-color);
  }
  .yg-status-select {
    min-width: 150px;
  }
  .yg-btn-spin {
    display: inline-flex;
    align-items: center;
  }
  .yg-ghostbtn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-weight: 600;
    font-size: 13px;
    padding: 8px 13px;
    border-radius: 10px;
    border: 1px solid var(--theme-divider-color);
    background: var(--theme-button-default);
    color: var(--theme-content-color);
    cursor: pointer;
    white-space: nowrap;
  }
  .yg-ghostbtn:hover {
    border-color: var(--theme-trans-color);
  }
  .yg-ghostbtn[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
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
