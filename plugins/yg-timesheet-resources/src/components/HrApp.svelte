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
<script lang="ts">
  import core, { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { TabList, type TabItem } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import HrTimesheet from './HrTimesheet.svelte'
  import HrRoster from './HrRoster.svelte'

  const acct = getCurrentAccount()
  const isOwner = hasAccountRole(acct, AccountRole.Owner)

  // Owner self-add: ensure the current Owner is a member (and owner) of the private HR space so
  // their own client can read HrTimeEntry. Owners may modify a space they own even before membership.
  const client = getClient()
  async function ensureMembership (): Promise<void> {
    if (!isOwner) return
    const space = await client.findOne(core.class.Space, { _id: ygTimesheet.space.HrData })
    if (space === undefined) return
    if (!space.members.includes(acct.uuid)) await client.update(space, { $push: { members: acct.uuid } })
    if (!(space.owners ?? []).includes(acct.uuid)) await client.update(space, { $push: { owners: acct.uuid } })
  }
  void ensureMembership()

  $: tabs = ([
    { id: 'timesheets', labelIntl: ygTimesheet.string.HrTimesheets },
    ...(isOwner ? [{ id: 'roster', labelIntl: ygTimesheet.string.HrRoster }] : [])
  ] as TabItem[])

  let selected: string | number = 'timesheets'
  // if the selected tab is no longer visible, fall back to Timesheets
  $: if (!tabs.some((t) => t.id === selected)) selected = 'timesheets'
</script>

<div class="flex-col h-full">
  <div class="p-2">
    <TabList
      items={tabs}
      {selected}
      on:select={(e) => {
        selected = e.detail.id
      }}
    />
  </div>
  <div class="flex-grow clear-mins">
    {#if selected === 'timesheets'}
      <HrTimesheet />
    {:else if selected === 'roster'}
      <HrRoster />
    {/if}
  </div>
</div>
