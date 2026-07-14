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
  import { TabList, type TabItem } from '@hcengineering/ui'
  import { getCurrentAccount, hasAccountRole, AccountRole } from '@hcengineering/core'
  import { getCurrentEmployee } from '@hcengineering/contact'
  import { createQuery } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import ygTimesheet, { type ProjectApprovers } from '@hcengineering/yg-timesheet'
  import { getClient } from '@hcengineering/presentation'
  import Timesheet from './Timesheet.svelte'
  import ProjectApproversList from './ProjectApproversList.svelte'
  import Approvals from './Approvals.svelte'
  import Reports from './Reports.svelte'

  const me = getCurrentEmployee()
  const isHRAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)
  const h = getClient().getHierarchy()

  // isApprover = pm or teamLead on ≥1 project
  let isApprover = false
  const projQuery = createQuery()
  projQuery.query(tracker.class.Project, {}, (projects: Project[]) => {
    isApprover = projects.some((p) => {
      if (!h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers)) return false
      const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers
      return a.pm === me || a.teamLead === me
    })
  })

  $: canApprove = isHRAdmin || isApprover
  $: tabs = ([
    { id: 'my', labelIntl: ygTimesheet.string.Timesheet },
    ...(canApprove ? [{ id: 'approvals', labelIntl: ygTimesheet.string.Approvals }] : []),
    ...(canApprove ? [{ id: 'reports', labelIntl: ygTimesheet.string.Reports }] : []),
    ...(isHRAdmin ? [{ id: 'projects', labelIntl: ygTimesheet.string.Projects }] : [])
  ] as TabItem[])

  let selected: string | number = 'my'
  // if the selected tab is no longer visible, fall back to My Timesheet
  $: if (!tabs.some((t) => t.id === selected)) selected = 'my'
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
    {#if selected === 'my'}
      <Timesheet />
    {:else if selected === 'approvals'}
      <Approvals />
    {:else if selected === 'reports'}
      <Reports />
    {:else if selected === 'projects'}
      <ProjectApproversList />
    {/if}
  </div>
</div>
