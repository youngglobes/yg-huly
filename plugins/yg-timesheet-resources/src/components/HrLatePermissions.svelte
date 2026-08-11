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
  //
  // HR "Late Permissions" special: every LatePermission (org-wide, world-readable in
  // core.space.Workspace), newest first, with HR-gated Approve/Reject. Mirrors Approvals.svelte's
  // role gate and RejectTaskPopup wiring, and Performance.svelte's table styling.
  //
  import { AccountRole, getCurrentAccount, hasAccountRole, SortingOrder, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label, showPopup } from '@hcengineering/ui'
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import ygTimesheet, { type LatePermission } from '@hcengineering/yg-timesheet'
  import { approveLatePermission, rejectLatePermission } from '../utils/attendance-write'
  import RejectLatePopup from './RejectLatePopup.svelte'

  const client = getClient()
  const isHr = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  let rows: LatePermission[] = []
  const q = createQuery()
  q.query(
    ygTimesheet.class.LatePermission,
    {},
    (res) => { rows = res },
    { sort: { date: SortingOrder.Descending } }
  )

  let nameById = new Map<Ref<Employee>, string>()
  const empQuery = createQuery()
  empQuery.query(contact.mixin.Employee, {}, (emps) => {
    nameById = new Map(emps.map((e) => [e._id, formatName(e.name)]))
  })

  function onApprove (r: LatePermission): void {
    void approveLatePermission(client, r._id)
  }

  function onReject (r: LatePermission): void {
    showPopup(RejectLatePopup, {}, undefined, (res?: { reason: string }) => {
      if (res !== undefined) void rejectLatePermission(client, r._id, res.reason)
    })
  }

  function tagClass (status: LatePermission['status']): string {
    if (status === 'Approved') return 'yg-tag--approved'
    if (status === 'Rejected') return 'yg-tag--rejected'
    return 'yg-tag--submitted' // Pending - no dedicated variant, amber reads as "awaiting review"
  }

  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
</script>

<div class="dash yg-page">
  <div class="yg-head">
    <h1 class="yg-title"><Label label={ygTimesheet.string.LatePermissions} /></h1>
    <p class="lp-note"><Label label={ygTimesheet.string.LatePermissionsIntro} /></p>
  </div>

  <div class="yg-scroll">
    <table class="yg-table">
      <thead>
        <tr>
          <th class="left"><Label label={ygTimesheet.string.Employee} /></th>
          <th class="left"><Label label={ygTimesheet.string.Date} /></th>
          <th class="yg-num"><Label label={ygTimesheet.string.MinutesLate} /></th>
          <th class="left"><Label label={ygTimesheet.string.Reason} /></th>
          <th class="left"><Label label={ygTimesheet.string.Status} /></th>
          {#if isHr}<th class="left" />{/if}
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r._id)}
          <tr class="yg-row">
            <td class="left bold">{nameById.get(r.employee) ?? r.employee}</td>
            <td class="left">{dateFmt.format(r.date)}</td>
            <td class="yg-num">{r.minutesLate} <Label label={ygTimesheet.string.MinutesLate} /></td>
            <td class="left">{r.reason}</td>
            <td class="left">
              <span class="yg-tag {tagClass(r.status)}"><span class="tick" />{r.status}</span>
            </td>
            {#if isHr}
              <td class="left">
                <span class="lp-actions">
                  {#if r.status !== 'Approved'}
                    <button class="yg-btn yg-btn--primary" on:click={() => { onApprove(r) }}>
                      <Label label={ygTimesheet.string.ApproveLate} />
                    </button>
                  {/if}
                  {#if r.status !== 'Rejected'}
                    <button class="yg-btn yg-btn--danger" on:click={() => { onReject(r) }}>
                      <Label label={ygTimesheet.string.RejectLate} />
                    </button>
                  {/if}
                </span>
              </td>
            {/if}
          </tr>
        {:else}
          <tr><td colspan={isHr ? 6 : 5} class="yg-empty"><Label label={ygTimesheet.string.NoLatePermissions} /></td></tr>
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
  .lp-note {
    margin: 0 0 18px;
    font-size: 13px;
    color: var(--yg-text-dim);
  }
  .lp-actions { display: inline-flex; gap: 8px; }
</style>
