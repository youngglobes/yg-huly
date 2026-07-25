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
  import contact, { formatName, getCurrentEmployee, type Employee } from '@hcengineering/contact'
  import core, { AccountRole, getCurrentAccount, hasAccountRole, SortingOrder, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import { Label, getPanelURI, showPopup } from '@hcengineering/ui'
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

  // Display names for the group headers, same Map<ref, formatted-name> idiom as Reports.svelte's
  // employeeNames (Person.name is stored "Last,First"; formatName renders display order).
  const empQuery = createQuery()
  let employeeNames: Map<string, string> = new Map()
  empQuery.query(contact.mixin.Employee, {}, (res: Employee[]) => {
    const m = new Map<string, string>()
    for (const e of res) m.set(e._id, formatName(e.name))
    employeeNames = m
  })

  interface ApprovalGroup {
    employee: Ref<Employee> | undefined
    name: string
    tasks: TimesheetTask[]
    date: number
    hours: number
  }

  // Group the flat, already-fetched queue by employee — the ONE allowed logic addition (pure
  // presentation grouping; does not touch the query/gate/handlers above). Unresolved-employee
  // tasks (lookup miss) fall into a single "Unknown" bucket rather than being dropped, so an
  // approval task never silently disappears from the queue.
  $: groups = ((): ApprovalGroup[] => {
    const byEmployee = new Map<string, ApprovalGroup>()
    for (const task of queue) {
      const employee = employeeOf(task)
      const key = employee ?? '__unknown__'
      let g = byEmployee.get(key)
      if (g === undefined) {
        g = {
          employee,
          name: employee !== undefined ? employeeNames.get(employee) ?? employee : 'Unknown',
          tasks: [],
          date: task.date,
          hours: 0
        }
        byEmployee.set(key, g)
      }
      g.tasks.push(task)
      g.hours += task.submittedHours
      if (task.date < g.date) g.date = task.date
    }
    return [...byEmployee.values()]
  })()

  $: totalTasks = queue.length
  $: totalPeople = groups.length
  $: totalHours = groups.reduce((sum, g) => sum + g.hours, 0)

  // Avatar initials from a display name, e.g. "Oliver User" -> "OU", "Cher" -> "CH".
  function initials (name: string): string {
    const parts = name.trim().split(/\s+/).filter((p) => p.length > 0)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
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

  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
</script>

<div class="ap-root">
  {#if !canApprove}
    <div class="yg-empty">Restricted</div>
  {:else if queue.length === 0}
    <div class="yg-empty"><Label label={ygTimesheet.string.NothingToApprove} /></div>
  {:else}
    <div class="ap-head">
      <span class="ap-summary">
        <b>{totalTasks}</b> task{totalTasks === 1 ? '' : 's'} from <b>{totalPeople}</b>
        {totalPeople === 1 ? 'person' : 'people'} · <b>{formatHours(totalHours)}</b> awaiting your review
      </span>
    </div>
    <div class="groups">
      {#each groups as g, i (g.employee ?? i)}
        <div class="group">
          <div class="group__head">
            <span class="yg-avatar yg-av{(i % 4) + 1}">{initials(g.name)}</span>
            <span class="group__who">
              <span class="group__name">{g.name}</span>
              <span class="group__meta">Submitted {dayFmt.format(g.date)}</span>
            </span>
            <span class="spacer" />
            <span class="group__count">{g.tasks.length} task{g.tasks.length === 1 ? '' : 's'}</span>
            <span class="group__hrs">{formatHours(g.hours)}</span>
          </div>
          {#each g.tasks as task (task._id)}
            <div class="approw">
              <span class="approw__date">{dayFmt.format(task.date)}</span>
              <span class="yg-idbadge">{task.identifier}</span>
              <a
                class="approw__title"
                href="#{getPanelURI(tracker.component.EditIssue, task.issue, tracker.class.Issue, 'content')}"
              >
                {task.title}
                <span class="go">↗</span>
              </a>
              <span class="approw__hrs">{formatHours(task.submittedHours)}</span>
              <span class="ap-actions">
                <button class="yg-btn yg-btn--primary" on:click={() => onApprove(task)}>
                  <Label label={ygTimesheet.string.Approve} />
                </button>
                <button class="yg-btn yg-btn--danger" on:click={() => onReject(task)}>
                  <Label label={ygTimesheet.string.Reject} />
                </button>
              </span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  @use './yg-table' as *;

  .ap-root { padding: 1rem 1.25rem 1.5rem; overflow: auto; }

  .ap-head { display: flex; align-items: baseline; margin-bottom: 1rem; }
  .ap-summary { font-size: 0.8125rem; color: var(--yg-text-dim); }
  .ap-summary b { color: var(--yg-text); font-weight: 650; font-variant-numeric: tabular-nums; }

  .groups { display: flex; flex-direction: column; gap: 14px; }

  .group {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    overflow: hidden;
  }
  .group__head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
    border-bottom: 1px solid var(--yg-border);
    background: var(--yg-panel-soft);
  }
  .group__who { display: flex; flex-direction: column; }
  .group__name { font-weight: 650; font-size: 14px; letter-spacing: -0.01em; }
  .group__meta { font-size: 12px; color: var(--yg-text-faint); }
  .spacer { flex: 1; }
  .group__count {
    font-size: 12px;
    color: var(--yg-text-dim);
    background: var(--yg-grey-bg);
    border-radius: 999px;
    padding: 3px 10px;
    font-weight: 600;
  }
  .group__hrs { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 15px; min-width: 44px; text-align: right; }

  .approw {
    display: grid;
    grid-template-columns: 92px 96px 1fr auto auto;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
  }
  .approw + .approw { border-top: 1px solid var(--yg-border); }
  .approw__date { font-size: 12px; color: var(--yg-text-faint); font-variant-numeric: tabular-nums; }
  .approw__title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--yg-text);
    text-decoration: none;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .approw__title:hover { text-decoration: underline; text-underline-offset: 2px; }
  .approw__title .go { color: var(--yg-text-faint); font-size: 12px; }
  .approw__hrs { font-variant-numeric: tabular-nums; font-weight: 650; min-width: 40px; text-align: right; }

  .ap-actions { display: inline-flex; gap: 8px; }

  @media (max-width: 660px) {
    .approw { grid-template-columns: 1fr auto; grid-auto-rows: min-content; row-gap: 8px; }
    .approw__date { grid-column: 1; }
    .yg-idbadge { grid-column: 2; justify-self: end; }
    .approw__title { grid-column: 1 / -1; }
    .approw__hrs { grid-column: 1; }
    .ap-actions { grid-column: 2; justify-self: end; }
  }
</style>
