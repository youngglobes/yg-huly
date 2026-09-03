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
  Custom full-page "New employee" form, shown in place of the directory (EmployeeDirectory.svelte's
  `creating` toggle) instead of the stock CreateEmployee popup. It runs the SAME account-linking
  sequence the stock component uses (plugins/contact-resources/src/components/CreateEmployee.svelte)
  so login/OTP and identity mapping keep working - ensurePerson (creates the global account +
  returns its uuid/socialId), a contact.class.Person, the contact.mixin.Employee mixin, and the
  login-email SocialIdentity - with two differences:
    1. NO invitation is sent on create (user decision: HR onboards later via the profile's Send
       invitation button). The new hire has an account but no workspace access until invited.
    2. It additionally stamps EmployeePersonal (status: active - which also fires OnEmployeeCreate to
       assign the YGS#### id) and, when chosen, EmployeeJob.designation/department.
  Stamping EmployeePersonal/EmployeeJob uses objectClass contact.mixin.Employee (not Person): those
  mixins DESCEND from Employee, and the id trigger's txMatch only expands to Employee's descendants -
  same reasoning as models/yg-hr/src/index.ts's trigger-registration note.
-->
<script lang="ts">
  import contact, {
    AvatarType,
    combineName,
    type Employee,
    type Person,
    type SocialIdentityRef
  } from '@hcengineering/contact'
  import {
    AccountRole,
    buildSocialIdString,
    generateId,
    SocialIdType,
    type Data,
    type Ref
  } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { EditableAvatar, getAccountClient } from '@hcengineering/contact-resources'
  import { translate } from '@hcengineering/platform'
  import { IconArrowLeft, Label, Spinner, addNotification, NotificationSeverity } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import ygHr, { type Department, type Designation, type EmployeeJob } from '@hcengineering/yg-hr'
  import YgToast from './YgToast.svelte'

  export let designations: Designation[] = []
  export let departments: Department[] = []

  const dispatch = createEventDispatcher<{ created: Ref<Employee>, back: void }>()
  const client = getClient()
  const h = client.getHierarchy()
  const accountClient = getAccountClient()

  const id: Ref<Employee> = generateId()
  const person: Data<Person> = { name: '', city: '', avatarType: AvatarType.COLOR }

  let avatarEditor: EditableAvatar
  let firstName = ''
  let lastName = ''
  let email = ''
  let fDesignation = ''
  let fDepartment = ''
  let saving = false
  let exists = false

  $: sortedDesignations = [...designations].sort((a, b) => a.name.localeCompare(b.name))
  $: sortedDepartments = [...departments].sort((a, b) => a.name.localeCompare(b.name))
  $: canSave =
    firstName.trim().length > 0 && lastName.trim().length > 0 && email.trim().length > 0 && !exists && !saving

  async function create (): Promise<void> {
    if (!canSave) return
    saving = true
    exists = false
    try {
      const mail = email.trim()
      const socialString = buildSocialIdString({ type: SocialIdType.EMAIL, value: mail })

      const existingId = await client.findOne(contact.class.SocialIdentity, { key: socialString })
      const existingPerson =
        existingId !== undefined ? await client.findOne(contact.class.Person, { _id: existingId.attachedTo }) : undefined
      if (existingPerson !== undefined && h.hasMixin(existingPerson, contact.mixin.Employee)) {
        exists = true
        return
      }

      // Creates the global account + returns its uuid and the login social id - the step that makes
      // OTP login and account-to-employee linking work. Same call the stock create uses.
      const { uuid, socialId } = await accountClient.ensurePerson(
        SocialIdType.EMAIL,
        mail,
        firstName.trim(),
        lastName.trim()
      )

      const info = await avatarEditor.createAvatar()
      person.name = combineName(firstName.trim(), lastName.trim())
      person.personUuid = uuid
      person.avatar = info.avatar
      person.avatarType = info.avatarType
      person.avatarProps = info.avatarProps

      if (existingPerson === undefined) {
        await client.createDoc(contact.class.Person, contact.space.Contacts, person, id)
      } else {
        await client.update(existingPerson, person)
      }
      const employeeRef = (existingPerson?._id as Ref<Employee>) ?? id

      await client.createMixin(employeeRef, contact.class.Person, contact.space.Contacts, contact.mixin.Employee, {
        active: true,
        role: AccountRole.User
      })

      await client.addCollection(
        contact.class.SocialIdentity,
        contact.space.Contacts,
        employeeRef,
        contact.class.Person,
        'socialIds',
        { type: SocialIdType.EMAIL, value: mail, key: socialString },
        socialId as SocialIdentityRef
      )

      // Stamp EmployeePersonal (status Active) - also triggers OnEmployeeCreate to assign the YGS id.
      await client.createMixin(employeeRef, contact.mixin.Employee, contact.space.Contacts, ygHr.mixin.EmployeePersonal, {
        status: 'active'
      })

      const jobAttrs: Partial<EmployeeJob> = {}
      if (fDesignation !== '') jobAttrs.designation = fDesignation as Ref<Designation>
      if (fDepartment !== '') jobAttrs.department = fDepartment as Ref<Department>
      if (Object.keys(jobAttrs).length > 0) {
        await client.createMixin(employeeRef, contact.mixin.Employee, contact.space.Contacts, ygHr.mixin.EmployeeJob, jobAttrs)
      }

      const toastTitle = await translate(ygHr.string.EmployeeCreated, {})
      addNotification(toastTitle, person.name, YgToast, undefined, NotificationSeverity.Success)
      dispatch('created', employeeRef)
    } finally {
      saving = false
    }
  }

  function back (): void {
    dispatch('back')
  }
</script>

<div class="yg-create">
  <button class="yg-back" on:click={back}>
    <IconArrowLeft size={'small'} />
    <Label label={ygHr.string.Employees} />
  </button>

  <div class="yg-create-head">
    <h1 class="yg-create-title"><Label label={ygHr.string.CreateEmployeeTitle} /></h1>
    <p class="yg-create-intro"><Label label={ygHr.string.CreateEmployeeIntro} /></p>
  </div>

  <div class="yg-create-card">
    <div class="yg-create-avatar">
      <EditableAvatar {person} name={combineName(firstName, lastName)} {email} size={'large'} bind:this={avatarEditor} />
    </div>

    <div class="yg-create-form">
      <div class="yg-create-grid">
        <label class="yg-input-f">
          <span><Label label={ygHr.string.FirstName} /></span>
          <input class="yg-input" type="text" bind:value={firstName} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.LastName} /></span>
          <input class="yg-input" type="text" bind:value={lastName} />
        </label>
        <label class="yg-input-f yg-input-f--full">
          <span><Label label={ygHr.string.WorkEmail} /></span>
          <input class="yg-input" type="email" bind:value={email} on:input={() => { exists = false }} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Designation} /></span>
          <select class="yg-input" bind:value={fDesignation}>
            <option value="">-</option>
            {#each sortedDesignations as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Department} /></span>
          <select class="yg-input" bind:value={fDepartment}>
            <option value="">-</option>
            {#each sortedDepartments as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
        </label>
      </div>

      {#if exists}
        <div class="yg-create-err"><Label label={contact.string.PersonAlreadyExists} /></div>
      {/if}

      <div class="yg-create-actions">
        <button class="yg-btn-dark" disabled={!canSave} on:click={create}>
          {#if saving}<span class="yg-btn-spin"><Spinner size={'small'} /></span>{/if}
          <Label label={saving ? ygHr.string.Creating : ygHr.string.CreateAndReturn} />
        </button>
      </div>
    </div>
  </div>
</div>

<style lang="scss">
  @use './yg-profile' as *;

  .yg-create {
    --yg-accent: #0f766e;
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 28px 32px;
    background: var(--theme-bg-color);
  }
  :global(.theme-dark) .yg-create {
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

  .yg-create-head {
    margin-bottom: 20px;
  }
  .yg-create-title {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--theme-caption-color);
  }
  .yg-create-intro {
    margin: 6px 0 0;
    font-size: 13.5px;
    color: var(--theme-dark-color);
    max-width: 560px;
  }

  .yg-create-card {
    display: flex;
    gap: 26px;
    align-items: flex-start;
    max-width: 760px;
    background: var(--theme-panel-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 14px;
    padding: 26px 28px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  .yg-create-avatar {
    flex: none;
    padding-top: 4px;
  }
  .yg-create-form {
    flex: 1;
    min-width: 0;
  }
  .yg-create-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
  }
  @media (max-width: 640px) {
    .yg-create-card {
      flex-direction: column;
      align-items: stretch;
    }
    .yg-create-grid {
      grid-template-columns: 1fr;
    }
  }

  .yg-create-err {
    margin-top: 12px;
    font-size: 13px;
    color: var(--theme-error-color, #d3455b);
  }

  .yg-create-actions {
    margin-top: 20px;
    display: flex;
    justify-content: flex-end;
  }
  .yg-btn-dark[disabled] {
    opacity: 0.6;
    cursor: progress;
  }
  .yg-btn-spin {
    display: inline-flex;
    align-items: center;
  }
</style>
