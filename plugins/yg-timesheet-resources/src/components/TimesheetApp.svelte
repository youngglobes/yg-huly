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
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import Timesheet from './Timesheet.svelte'
  import ProjectApproversList from './ProjectApproversList.svelte'

  // Leave room to add an "Approvals" tab in Task 7 (a third entry here).
  const tabs: TabItem[] = [
    { id: 'my', labelIntl: ygTimesheet.string.Timesheet },
    { id: 'projects', labelIntl: ygTimesheet.string.Projects }
  ]

  let selected: string | number = 'my'
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
    {:else if selected === 'projects'}
      <ProjectApproversList />
    {/if}
  </div>
</div>
