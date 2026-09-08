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
  import contact, { formatName, getCurrentEmployee, type Employee } from '@hcengineering/contact'
  import { Avatar } from '@hcengineering/contact-resources'
  import SortableTh from './SortableTh.svelte'
  import ygTimesheet, { isHrDesignation, type LatePermission, type WorkDesignation } from '@hcengineering/yg-timesheet'
  import { approveLatePermission, rejectLatePermission } from '../utils/attendance-write'
  import LateDecisionPopup from './LateDecisionPopup.svelte'

  const client = getClient()

  // Who may approve/reject: HR staff (WorkProfile designation) plus admin break-glass. The server
  // guard (OnLatePermissionUpdate) enforces the same rule, so hiding the buttons is only UX, not the
  // security boundary. Reactive because the designation arrives from a live query.
  const isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)
  const me = getCurrentEmployee()
  let myDesignation: WorkDesignation | undefined
  const profQuery = createQuery()
  profQuery.query(ygTimesheet.mixin.WorkProfile, { _id: me }, (res) => { myDesignation = res[0]?.designation })
  $: isHr = isAdmin || isHrDesignation(myDesignation)

  let rows: LatePermission[] = []
  const q = createQuery()
  q.query(
    ygTimesheet.class.LatePermission,
    {},
    (res) => { rows = res },
    { sort: { date: SortingOrder.Descending } }
  )

  let nameById = new Map<Ref<Employee>, string>()
  let empById = new Map<Ref<Employee>, Employee>()
  const empQuery = createQuery()
  empQuery.query(contact.mixin.Employee, {}, (emps) => {
    nameById = new Map(emps.map((e) => [e._id, formatName(e.name)]))
    empById = new Map(emps.map((e) => [e._id, e]))
  })

  // Column sorting: Employee by name, Date/Minutes numeric, Status alphabetical. Date defaults to
  // newest first (matching the query), a Date tiebreak keeps ties stable.
  type SortKey = 'employee' | 'date' | 'minutesLate' | 'status'
  let sortKey: SortKey = 'date'
  let sortDir: 1 | -1 = -1
  function toggleSort (k: SortKey): void {
    if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1
    else { sortKey = k; sortDir = k === 'date' || k === 'minutesLate' ? -1 : 1 }
  }
  function compareRows (a: LatePermission, b: LatePermission): number {
    let r = 0
    switch (sortKey) {
      case 'employee': r = (nameById.get(a.employee) ?? '').localeCompare(nameById.get(b.employee) ?? ''); break
      case 'date': r = a.date - b.date; break
      case 'minutesLate': r = a.minutesLate - b.minutesLate; break
      case 'status': r = String(a.status).localeCompare(String(b.status)); break
    }
    return r !== 0 ? r * sortDir : b.date - a.date
  }
  $: sortedRows = [...rows].sort(compareRows)

  function onApprove (r: LatePermission): void {
    showPopup(LateDecisionPopup, { approve: true }, undefined, (res?: { reason: string }) => {
      if (res !== undefined) void approveLatePermission(client, r._id, res.reason)
    })
  }

  function onReject (r: LatePermission): void {
    showPopup(LateDecisionPopup, { approve: false }, undefined, (res?: { reason: string }) => {
      if (res !== undefined) void rejectLatePermission(client, r._id, res.reason)
    })
  }

  // The HR reason shown in the table: approve reason once Approved, reject reason once Rejected.
  function hrReasonOf (r: LatePermission): string {
    if (r.status === 'Approved') return r.approveReason ?? ''
    if (r.status === 'Rejected') return r.rejectReason ?? ''
    return ''
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
    <div class="yg-table-wrap">
      <table class="yg-table">
        <thead>
          <tr>
            <SortableTh active={sortKey === 'employee'} asc={sortDir === 1} on:click={() => toggleSort('employee')}>
              <Label label={ygTimesheet.string.Employee} />
            </SortableTh>
            <SortableTh active={sortKey === 'date'} asc={sortDir === 1} on:click={() => toggleSort('date')}>
              <Label label={ygTimesheet.string.Date} />
            </SortableTh>
            <SortableTh numeric active={sortKey === 'minutesLate'} asc={sortDir === 1} on:click={() => toggleSort('minutesLate')}>
              <Label label={ygTimesheet.string.MinutesLate} />
            </SortableTh>
            <th class="left"><Label label={ygTimesheet.string.Reason} /></th>
            <SortableTh active={sortKey === 'status'} asc={sortDir === 1} on:click={() => toggleSort('status')}>
              <Label label={ygTimesheet.string.Status} />
            </SortableTh>
            <th class="left"><Label label={ygTimesheet.string.HrReason} /></th>
            {#if isHr}<th class="left" />{/if}
          </tr>
        </thead>
        <tbody>
          {#each sortedRows as r (r._id)}
            <tr class="yg-row">
              <td class="left">
                <div class="yg-person">
                  <Avatar person={empById.get(r.employee)} name={nameById.get(r.employee)} size={'small'} />
                  <div class="yg-person__text">
                    <div class="yg-person__name">{nameById.get(r.employee) ?? r.employee}</div>
                  </div>
                </div>
              </td>
              <td class="left">{dateFmt.format(r.date)}</td>
              <td class="yg-num">{r.minutesLate} <Label label={ygTimesheet.string.MinutesLate} /></td>
              <td class="left yg-truncate" title={r.reason}>{r.reason}</td>
              <td class="left">
                <span class="yg-tag {tagClass(r.status)}"><span class="tick" />{r.status}</span>
              </td>
              <td class="left">{hrReasonOf(r) !== '' ? hrReasonOf(r) : '-'}</td>
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
            <tr><td colspan={isHr ? 7 : 6} class="yg-empty"><Label label={ygTimesheet.string.NoLatePermissions} /></td></tr>
          {/each}
        </tbody>
      </table>
    </div>
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
