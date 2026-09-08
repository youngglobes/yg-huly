<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
<script lang="ts">
  import { Employee, Person, getWorkspaceMemberStatusSubtitle } from '@hcengineering/contact'
  import { AccountUuid, Doc, Mixin, Ref, SocialIdType } from '@hcengineering/core'
  import { ComponentExtensions, createQuery, getClient, hasResource } from '@hcengineering/presentation'
  import { Component } from '@hcengineering/ui'

  import rating, { type PersonRating } from '@hcengineering/rating'
  import { EmployeePresenter, getPersonByPersonRefStore } from '../../index'
  import contact from '../../plugin'
  import { employeeByIdStore } from '../../utils'
  import { workspaceMemberStatusByAccountStore } from '../../workspaceMemberStatus'
  import Avatar from '../Avatar.svelte'
  import DeactivatedHeader from './DeactivatedHeader.svelte'
  import ModernProfilePopup from './ModernProfilePopup.svelte'
  import TimePresenter from './TimePresenter.svelte'

  export let _id: Ref<Employee>
  export let disabled: boolean = false

  const hasRating = hasResource(rating.component.RatingRing)

  const client = getClient()
  const hierarchy = client.getHierarchy()

  let employee: Employee | Person | undefined = undefined
  let isEmployee: boolean = false

  $: personByRefStore = getPersonByPersonRefStore([_id])
  $: employee = $employeeByIdStore.get(_id) ?? $personByRefStore.get(_id)
  $: isEmployee = $employeeByIdStore.has(_id)
  $: timezone = isEmployee ? (employee as Employee | undefined)?.timezone : undefined

  const levelQuery = createQuery()

  let personRating: PersonRating | undefined

  $: if (employee?.personUuid != null) {
    levelQuery.query(rating.class.PersonRating, { accountId: employee?.personUuid as AccountUuid }, (res) => {
      personRating = res[0]
    })
  } else {
    personRating = undefined
    levelQuery.unsubscribe()
  }

  // YG: the standalone contact page is retired, so the card no longer links to it. Show the
  // designation + work email instead, and keep only the chat action.
  //
  // Designation lives on the yg-timesheet WorkProfile mixin. contact-resources cannot depend on
  // yg-timesheet (that would be circular), so read it generically by the mixin's id string - the
  // mixin is registered in the model, so the hierarchy resolves it fine.
  const WORK_PROFILE_MIXIN = 'yg-timesheet:mixin:WorkProfile' as Ref<Mixin<Doc>>
  $: designation =
    employee != null && hierarchy.hasMixin(employee, WORK_PROFILE_MIXIN)
      ? ((hierarchy.as(employee, WORK_PROFILE_MIXIN) as unknown as { designation?: string }).designation ?? undefined)
      : undefined

  let email: string | undefined = undefined
  const emailQuery = createQuery()
  $: emailQuery.query(
    contact.class.SocialIdentity,
    { type: SocialIdType.EMAIL, attachedTo: _id, attachedToClass: contact.class.Person },
    (res) => {
      email = res[0]?.value
    }
  )

  $: statusSubtitle =
    employee?.personUuid !== undefined
      ? getWorkspaceMemberStatusSubtitle($workspaceMemberStatusByAccountStore.get(employee.personUuid as AccountUuid))
      : undefined
</script>

<ModernProfilePopup {disabled}>
  <div slot="header">
    {#if disabled}
      <div class="flex-presenter">
        <DeactivatedHeader>
          <div slot="actions">
            <div class="flex-presenter flex-gap-2 flex-center">
              <ComponentExtensions
                extension={contact.extension.EmployeePopupActions}
                props={{ employee, icon: contact.icon.Chat, type: 'type-button-icon' }}
              />
            </div>
          </div>
        </DeactivatedHeader>
      </div>
    {/if}
  </div>
  <div slot="content">
    {#if !disabled}
      <div class="flex-presenter cursor-default flex-gap-2 p-3">
        <Avatar
          size="large"
          person={employee}
          name={employee?.name}
          {disabled}
          showStatus={isEmployee}
          statusSize="medium"
          style="modern"
        />
        <div class="flex-col flex-gap-0-5 pl-1">
          {#if statusSubtitle}
            <div class="status-container max-w-60">
              <div class="status-container__text text-normal font-normal content-color overflow-label">
                {statusSubtitle}
              </div>
            </div>
          {/if}
          <EmployeePresenter
            value={employee}
            shouldShowAvatar={false}
            showPopup={false}
            compact
            accent
            showWorkspaceStatusEmoji={false}
          />
          {#if designation}
            <span class="pp-designation overflow-label">{designation}</span>
          {/if}
          {#if email}
            <a class="pp-email overflow-label" href={`mailto:${email}`}>{email}</a>
          {/if}
          {#if hasRating}
            <div class="flex-row-center text-sm">
              <Component
                is={rating.component.RatingRing}
                props={{ rating: personRating?.rating ?? 0, showValues: false }}
              />
            </div>
          {/if}
          <span class="flex-presenter cursor-default">
            <TimePresenter {timezone} />
          </span>
        </div>
      </div>
      <!-- Hide achievements for now, as achievmment service is not yet implemented
      {#if isEmployee}
        <div class="py-1">
          <ComponentExtensions
            extension={contact.extension.PersonAchievementsPresenter}
            props={{
              personId: _id
            }}
          />
        </div>
      {/if}
      -->
    {:else}
      <div class="flex-presenter flex-gap-2 p-2">
        <div class="flex-presenter">
          <Avatar size="large" person={employee} name={employee?.name} {disabled} style="modern" />
        </div>
        <div class="flex-col">
          <EmployeePresenter value={employee} shouldShowAvatar={false} showPopup={false} compact accent />
        </div>
      </div>
    {/if}
  </div>
  <div slot="actions">
    {#if !disabled}
      <div class="flex-presenter flex-gap-2 flex-center">
        <ComponentExtensions
          extension={contact.extension.EmployeePopupActions}
          props={{ employee, icon: contact.icon.Chat, type: 'type-button-icon', class: 'button-container' }}
        />
      </div>
    {/if}
  </div>
</ModernProfilePopup>

<style lang="scss">
  .button-container {
    border-radius: var(--small-BorderRadius);
    display: flex;
    background-color: var(--theme-button-container-color);
  }
  .status-container {
    display: inline-flex;
    align-items: center;
    min-height: 1.25rem;
    padding: 0.125rem 0.5rem;
    border-radius: var(--medium-BorderRadius);
    background: color-mix(in srgb, var(--theme-popup-color) 72%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--theme-popup-color) 55%, var(--theme-divider-color));
  }

  .status-container__text {
    line-height: 1.25;
  }
  .pp-designation {
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
    max-width: 15rem;
  }
  .pp-email {
    font-size: 0.8125rem;
    color: var(--theme-content-color);
    text-decoration: none;
    max-width: 15rem;
    &:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  }
</style>
