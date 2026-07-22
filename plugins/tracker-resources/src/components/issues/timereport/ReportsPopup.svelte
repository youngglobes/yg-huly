<!--
// Copyright © 2022 Hardcore Engineering Inc.
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
  import contact from '@hcengineering/contact'
  import { FindOptions } from '@hcengineering/core'
  import presentation, { Card } from '@hcengineering/presentation'
  import { Issue, Project, TimeSpendReport } from '@hcengineering/tracker'
  import { Button, IconAdd, Scroller, showPopup, tableSP } from '@hcengineering/ui'
  import { TableBrowser } from '@hcengineering/view-resources'
  import tracker from '../../../plugin'
  import IssuePresenter from '../IssuePresenter.svelte'
  import TimeSpendReportPopup from './TimeSpendReportPopup.svelte'
  import { onMount } from 'svelte'
  export let issue: Issue
  export let currentProject: Project | undefined

  // Card's `width` prop only offers small/medium/large, and this is already 'large' (45rem) —
  // too narrow once Description carries a real note. Rather than restyle every large dialog in
  // the app, tag this one card and widen only what we tagged.
  let marker: HTMLElement | undefined
  onMount(() => {
    const card = marker?.closest('.antiCard')
    card?.classList.add('yg-wide-card')
  })

  $: defaultTimeReportDay = currentProject?.defaultTimeReportDay

  export function canClose (): boolean {
    return true
  }
  const options: FindOptions<TimeSpendReport> = {
    lookup: {
      attachedTo: tracker.class.Issue,
      employee: contact.mixin.Employee
    }
  }
  function addReport (): void {
    showPopup(
      TimeSpendReportPopup,
      {
        issue,
        issueId: issue._id,
        issueClass: issue._class,
        space: issue.space,
        assignee: issue.assignee,
        defaultTimeReportDay
      },
      'center'
    )
  }
</script>

<Card
  label={tracker.string.TimeSpendReports}
  canSave={true}
  on:close
  okAction={() => {}}
  okLabel={presentation.string.Ok}
  on:changeContent
>
  <svelte:fragment slot="header">
    <IssuePresenter value={issue} disabled />
  </svelte:fragment>
  <div bind:this={marker} class="card-marker" />
  <div class="reports-table">
    <Scroller fade={tableSP}>
      <!--
        Columns: Issue, Date, Time, Employee, Description.
        The old "Title" column (ParentNamesPresenter) is dropped — it renders the parent-issue
        chain, which is empty for every report that isn't on a sub-issue, yet it reserved
        maxWidth 20rem and squeezed Description down to almost nothing.
      -->
      <TableBrowser
        _class={tracker.class.TimeSpendReport}
        query={{ attachedTo: { $in: [issue._id, ...(issue.childInfo?.map((it) => it.childId) ?? [])] } }}
        config={['$lookup.attachedTo', 'date', '', 'employee', 'description']}
        {options}
      />
    </Scroller>
  </div>
  <svelte:fragment slot="buttons">
    <Button id="ReportsPopupAddButton" icon={IconAdd} size={'large'} on:click={addReport} />
  </svelte:fragment>
</Card>

<style lang="scss">
  .card-marker {
    display: none;
  }
  .reports-table {
    // Was a fixed h-50, which kept a long list scrolling inside a short box.
    height: 100%;
    min-height: 20rem;
    max-height: 70vh;
  }
  // :global is required because the element belongs to <Card>, not to this component's
  // template. It is scoped by the yg-wide-card class, which only the onMount above applies,
  // so no other dialog in the app is affected.
  :global(.antiCard.yg-wide-card) {
    width: min(72rem, calc(100vw - 4rem)) !important;
    max-width: min(72rem, calc(100vw - 4rem)) !important;
  }
</style>
