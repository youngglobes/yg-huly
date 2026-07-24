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
  import { getCurrentEmployee, type Employee } from '@hcengineering/contact'
  import { EmployeeRefPresenter } from '@hcengineering/contact-resources'
  import core, { AccountRole, getCurrentAccount, hasAccountRole, SortingOrder, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import { Button, Label, showPopup } from '@hcengineering/ui'
  import ygTimesheet, { type Timesheet, type TimesheetDay, type TimesheetTask, type ProjectApprovers } from '@hcengineering/yg-timesheet'
  import { formatHours } from '../utils/week'
  import { approveTask, rejectTask } from '../utils/day'
  import ApproveTaskPopup from './ApproveTaskPopup.svelte'
  import RejectTaskPopup from './RejectTaskPopup.svelte'

  const me = getCurrentEmployee()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  // Role gate — mirrors ygTimesheet.function.CanApprove EXACTLY (UI convenience only; the server
  // trigger is the real enforcement). Any PM/TL on ANY project, or an HR admin (Maintainer), can
  // approve.
  const isHRAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)
  let isApprover = false
  const projQuery = createQuery()
  projQuery.query(tracker.class.Project, {}, (projects: Project[]) => {
    isApprover = projects.some((p) => {
      if (!hierarchy.hasMixin(p, ygTimesheet.mixin.ProjectApprovers)) return false
      const a = hierarchy.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers
      return a.pm === me || a.teamLead === me
    })
  })
  $: canApprove = isHRAdmin || isApprover

  // Submitted tasks, cross-project — ANY assigned PM/TL sees EVERY submitted task (covering for
  // an absent lead is the point). Nested $lookup resolves the employee via task → day → timesheet.
  let query = createQuery()
  let queue: TimesheetTask[] = []
  $: if (canApprove) {
    query.query(
      ygTimesheet.class.TimesheetTask,
      { space: core.space.Workspace, status: 'Submitted' },
      (res: TimesheetTask[]) => {
        queue = res
      },
      {
        sort: { date: SortingOrder.Ascending, identifier: SortingOrder.Ascending },
        lookup: { attachedTo: [ygTimesheet.class.TimesheetDay, { attachedTo: ygTimesheet.class.Timesheet }] }
      }
    )
  } else {
    // Do NOT reassign `query` here. `query` is read inside this same reactive statement (via
    // .query()/.unsubscribe()), so an assignment to it inside the statement makes Svelte
    // re-run the statement every time it runs — an unbounded self-triggering loop. A bare
    // .unsubscribe() is sufficient: LiveQuery's unsubscribe() clears its remembered
    // class/query/callback/options (see packages/presentation/src/utils.ts), so a later
    // .query() call on this SAME instance always sees needUpdate() = true and correctly
    // resubscribes when canApprove flips back to true.
    query.unsubscribe()
    queue = []
  }

  function employeeOf (task: TimesheetTask): Ref<Employee> | undefined {
    const day = task.$lookup?.attachedTo as TimesheetDay | undefined
    const timesheet = day?.$lookup?.attachedTo as Timesheet | undefined
    return timesheet?.employee
  }

  function onApprove (task: TimesheetTask): void {
    showPopup(
      ApproveTaskPopup,
      { identifier: task.identifier, title: task.title, submittedHours: task.submittedHours },
      undefined,
      (res?: { approvedHours: number }) => {
        if (res !== undefined) void approveTask(client, task._id, res.approvedHours)
      }
    )
  }

  function onReject (task: TimesheetTask): void {
    showPopup(
      RejectTaskPopup,
      { identifier: task.identifier, title: task.title },
      undefined,
      (res?: { reason: string }) => {
        if (res !== undefined) void rejectTask(client, task._id, res.reason)
      }
    )
  }

  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
</script>

<div class="ap-root">
  {#if !canApprove}
    <div class="ap-empty">Restricted</div>
  {:else if queue.length === 0}
    <div class="ap-empty"><Label label={ygTimesheet.string.NothingToApprove} /></div>
  {:else}
    {#each queue as task (task._id)}
      {@const employee = employeeOf(task)}
      <div class="ap-day">
        <div class="ap-day__head">
          <span class="ap-owner">
            {#if employee !== undefined}
              <EmployeeRefPresenter value={employee} readonly />
            {:else}
              <span>—</span>
            {/if}
          </span>
          <span class="ap-date">{dayFmt.format(task.date)}</span>
          <span class="ap-line__id">{task.identifier}</span>
          <span class="ap-line__title">{task.title}</span>
          <span class="ap-total">{formatHours(task.submittedHours)}</span>
        </div>

        <div class="ap-actions">
          <Button kind="primary" size="small" label={ygTimesheet.string.Approve} on:click={() => onApprove(task)} />
          <Button kind="regular" size="small" label={ygTimesheet.string.Reject} on:click={() => onReject(task)} />
        </div>
      </div>
    {/each}
  {/if}
</div>

<style lang="scss">
  .ap-root { padding: 1rem; overflow: auto; display: flex; flex-direction: column; gap: 0.5rem; }
  .ap-empty { color: var(--theme-darker-color); padding: 1rem; text-align: center; }
  .ap-day { border: 1px solid var(--theme-divider-color); border-radius: 0.5rem; padding: 0.75rem; }
  .ap-day__head { display: flex; align-items: center; gap: 0.75rem; }
  .ap-owner { min-width: 10rem; }
  .ap-date { color: var(--theme-content-color); }
  .ap-line__id { color: var(--theme-dark-color); }
  .ap-line__title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ap-total { font-weight: 600; font-variant-numeric: tabular-nums; margin-left: auto; }
  .ap-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap; }
</style>
