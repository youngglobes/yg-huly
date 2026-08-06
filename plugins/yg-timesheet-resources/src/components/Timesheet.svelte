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
  import core, { type Ref } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Issue, type Project, type TimeSpendReport } from '@hcengineering/tracker'
  import { Label, IconForward, IconBack, addNotification, NotificationSeverity, getPanelURI, showPopup } from '@hcengineering/ui'
  import ygTimesheet, { type Timesheet, type TimesheetDay, type TimesheetTask, type TimesheetRejectCycle } from '@hcengineering/yg-timesheet'
  import { cycleKey, groupCycles, closedCycles, openCycle } from '../utils/reject-cycle'
  import { weekRange, groupByDay, formatHours, localDayKey, type ReportLike, type DayGroup } from '../utils/week'
  import {
    submitDay,
    recallDay,
    loadProjectApprovers,
    issuesMissingEstimation,
    NO_APPROVER,
    type DayReportLike,
    type ProjectApproverLike
  } from '../utils/day'
  import { deriveDayStatus, type DerivedDayStatus } from '../utils/task-approval'
  import { ensureHrMembership } from '../utils/hrMembership'
  import SubmitErrorNotification from './SubmitErrorNotification.svelte'
  import ResubmitDayPopup from './ResubmitDayPopup.svelte'

  // Owner bootstrap (fallback to Dashboard's call): self-add an Owner to HrData so the server
  // un-hides the HR app for them and they can reach the roster editor. No-op for non-owners.
  void ensureHrMembership()

  const me = getCurrentEmployee()
  const client = getClient()
  let anchor = Date.now()
  $: week = weekRange(anchor)

  // Project name map, so a blocked submit can name the offending projects rather than just
  // showing the generic ygTimesheet.string.NoApprover message.
  const projectQuery = createQuery()
  let projectNames: Map<string, string> = new Map()
  projectQuery.query(tracker.class.Project, {}, (res: Project[]) => {
    const m = new Map<string, string>()
    for (const p of res) m.set(p._id, p.name)
    projectNames = m
  })

  const query = createQuery()
  let days: DayGroup[] = []
  let weekTotal = 0
  // Raw day reports (shaped for the workflow logic) + the approvers for their projects.
  let reportsByKey: Map<string, DayReportLike[]> = new Map()
  let approversByProject: Map<string, ProjectApproverLike> = new Map()
  // issue id -> estimation (hours), from the Issue lookup - a submit is blocked if any task's issue is 0/unset.
  let estimationByIssue: Map<string, number> = new Map()

  $: query.query(
    tracker.class.TimeSpendReport,
    { employee: me, date: { $gte: week.start, $lt: week.end } },
    (res: TimeSpendReport[]) => {
      const reports: ReportLike[] = []
      const rbk = new Map<string, DayReportLike[]>()
      const projSet = new Set<string>()
      const ebi = new Map<string, number>()
      for (const r of res) {
        const issue = r.$lookup?.attachedTo as Issue | undefined
        if (issue !== undefined) ebi.set(issue._id, issue.estimation ?? 0)
        reports.push({
          employee: r.employee as Ref<any> | null,
          date: r.date,
          value: r.value,
          issueId: (issue?._id ?? r.attachedTo) as string,
          issueIdentifier: issue?.identifier ?? '-',
          issueTitle: issue?.title ?? '(unknown issue)',
          project: (issue?.space ?? '') as string
        })
        if (r.employee == null || r.date == null) continue
        const project = (issue?.space ?? '') as string
        const key = localDayKey(r.date)
        const arr = rbk.get(key) ?? []
        arr.push({
          project,
          employee: r.employee as string,
          issue: (issue?._id ?? r.attachedTo) as string,
          identifier: issue?.identifier ?? '-',
          title: issue?.title ?? '(unknown issue)',
          value: r.value,
          note: r.description ?? ''
        })
        rbk.set(key, arr)
        if (project !== '') projSet.add(project)
      }
      const g = groupByDay(reports, week)
      days = g.days
      weekTotal = g.weekTotal
      reportsByKey = rbk
      estimationByIssue = ebi
      void loadProjectApprovers(client, [...projSet]).then((m) => {
        approversByProject = m
      })
    },
    { lookup: { attachedTo: tracker.class.Issue } }
  )

  // My persisted Timesheet for the visible week (may not exist until first submit).
  const tsQuery = createQuery()
  let myTs: Timesheet | undefined
  $: tsQuery.query(
    ygTimesheet.class.Timesheet,
    { space: core.space.Workspace, employee: me, weekStart: week.start },
    (r: Timesheet[]) => {
      myTs = r[0]
    }
  )

  // The persisted TimesheetDay docs for that Timesheet, joined to the grid by local day key.
  const dayQuery = createQuery()
  let dayByKey: Map<string, TimesheetDay> = new Map()
  $: if (myTs !== undefined) {
    dayQuery.query(
      ygTimesheet.class.TimesheetDay,
      { space: core.space.Workspace, attachedTo: myTs._id },
      (r: TimesheetDay[]) => {
        const m = new Map<string, TimesheetDay>()
        for (const d of r) m.set(localDayKey(d.date), d)
        dayByKey = m
      }
    )
  } else {
    dayQuery.unsubscribe()
    dayByKey = new Map()
  }

  // The employee-scoped TimesheetTask rows, grouped by local day key (submitDay stamps
  // task.date = the day's date, so localDayKey(task.date) matches day.key exactly).
  // Scoped through dayIds (this employee's own TimesheetDay ids) — NOT a bare date-range query —
  // because TimesheetTask lives in the shared core.space.Workspace and is not employee-scoped; a
  // date-range-only query would mix in OTHER employees' tasks for the same week.
  const taskQuery = createQuery()
  let tasksByKey: Map<string, TimesheetTask[]> = new Map()
  $: dayIds = [...dayByKey.values()].map((d) => d._id)
  $: taskQuery.query(
    ygTimesheet.class.TimesheetTask,
    { space: core.space.Workspace, attachedTo: { $in: dayIds } },
    (res: TimesheetTask[]) => {
      const m = new Map<string, TimesheetTask[]>()
      for (const t of res) {
        const key = localDayKey(t.date)
        const arr = m.get(key) ?? []
        arr.push(t)
        m.set(key, arr)
      }
      tasksByKey = m
    }
  )

  //
  // The employee's own rejection history for the visible week (backlog item 2, employee side).
  // Scoped to `me` and the week window so it stays small.
  //
  const cycleQuery = createQuery()
  let cycles: TimesheetRejectCycle[] = []
  $: cycleQuery.query(
    ygTimesheet.class.TimesheetRejectCycle,
    { employee: me, date: { $gte: week.start, $lt: week.end } },
    (res: TimesheetRejectCycle[]) => {
      cycles = res
    }
  )
  $: cyclesByKey = groupCycles(cycles)

  // Approver display names, for attributing the open round. Same idiom as Approvals.svelte.
  const empNameQuery = createQuery()
  let approverNames: Map<string, string> = new Map()
  empNameQuery.query(contact.mixin.Employee, {}, (res: Employee[]) => {
    const m = new Map<string, string>()
    for (const e of res) m.set(e._id, formatName(e.name))
    approverNames = m
  })

  /**
   * Rounds for a task, oldest first.
   *
   * `byKey` is a PARAMETER, not read from the closure, and callers in the template MUST pass
   * `cyclesByKey` explicitly. Svelte derives a template expression's dependencies from the
   * identifiers it REFERENCES; state read inside a function body is invisible to the compiler.
   * When this read cyclesByKey from the closure, the {#each} never re-rendered as the cycles
   * live-query resolved, so the history vanished on every cold load and reappeared only when some
   * unrelated change forced a redraw (found 2026-08-06).
   */
  function cyclesFor (
    task: TimesheetTask, byKey: Map<string, TimesheetRejectCycle[]>
  ): TimesheetRejectCycle[] {
    return byKey.get(cycleKey(me, task.issue, task.date)) ?? []
  }

  /**
   * Who rejected the current open round, formatted for display. Empty when unattributed.
   * Both maps are parameters for the same reactivity reason as cyclesFor above. The TEMPLATE does
   * not call this: it derives the name from the already-reactive `open` const instead. This exists
   * for the imperative call in onSubmit, which runs at click time and needs a one-shot value.
   */
  function rejectedByName (
    task: TimesheetTask,
    byKey: Map<string, TimesheetRejectCycle[]>,
    names: Map<string, string>
  ): string {
    const open = openCycle(cyclesFor(task, byKey))
    if (open?.rejectedBy == null) return ''
    return names.get(open.rejectedBy) ?? ''
  }

  let expanded = new Set<string>()
  function toggle (id: string): void {
    if (expanded.has(id)) expanded.delete(id)
    else expanded.add(id)
    expanded = expanded
  }

  const agoFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

  function statusString (s: DerivedDayStatus): IntlString {
    switch (s) {
      case 'Submitted':
        return ygTimesheet.string.Submitted
      case 'PartiallyApproved':
        return ygTimesheet.string.PartiallyApproved
      case 'Approved':
        return ygTimesheet.string.Approved
      case 'Rejected':
        return ygTimesheet.string.Rejected
      default:
        return ygTimesheet.string.Draft
    }
  }

  // Status accent-rail class for a day card (mockup `.day.is-{status}`), a pure display mapping
  // off the already-derived DerivedDayStatus, same spirit as statusString above.
  function railClass (s: DerivedDayStatus): string {
    switch (s) {
      case 'Submitted':
        return 'is-submitted'
      case 'PartiallyApproved':
        return 'is-partial'
      case 'Approved':
        return 'is-approved'
      case 'Rejected':
        return 'is-rejected'
      default:
        return 'is-draft'
    }
  }

  async function onSubmit (day: DayGroup): Promise<void> {
    const reports = reportsByKey.get(day.key) ?? []
    // Block the whole submit until every task's issue has an estimation (user decision 2026-07-29).
    const noEstimate = issuesMissingEstimation(reports, estimationByIssue)
    if (noEstimate.length > 0) {
      addNotification(
        `Can't submit ${weekdayLongFmt.format(day.date)}`,
        `Set an estimation on ${noEstimate.join(', ')} first. Every task needs an estimate before it can be submitted for approval.`,
        SubmitErrorNotification,
        undefined,
        NotificationSeverity.Error
      )
      return
    }
    // Backlog item 4: a day whose derived status is Rejected collects one optional reply per
    // rejected task before it goes back. deriveDayStatus returns 'Rejected' iff at least one task
    // is rejected, and the Submit button only renders for Draft or Rejected, so this single check
    // is sufficient. The Draft path is untouched: no dialog, zero added friction.
    const dayTasksNow = tasksByKey.get(day.key) ?? []
    const isResubmit = deriveDayStatus(dayTasksNow.map((t) => t.status)) === 'Rejected'
    let resubmitNotes: Map<string, string> | undefined
    if (isResubmit) {
      const rows = dayTasksNow
        .filter((t) => t.status === 'Rejected')
        .filter((t) => reports.some((r) => r.issue === t.issue))
        .map((t) => ({
          issue: t.issue as string,
          identifier: t.identifier,
          title: t.title,
          hours: formatHours(t.submittedHours),
          reason: t.rejectReason ?? '',
          rejectedBy: rejectedByName(t, cyclesByKey, approverNames)
        }))
      if (rows.length > 0) {
        const answered = await new Promise<Map<string, string> | undefined>((resolve) => {
          showPopup(
            ResubmitDayPopup,
            { dayLabel: weekdayLongFmt.format(day.date), rows },
            undefined,
            (out?: { notes: Map<string, string> }) => {
              resolve(out?.notes)
            }
          )
        })
        // Cancel (undefined) aborts the resubmit entirely; an empty map means "no replies, proceed".
        if (answered === undefined) return
        resubmitNotes = answered
      }
    }

    const res = await submitDay(client, {
      employee: me,
      date: day.date,
      reports,
      approversByProject,
      resubmitNotes: resubmitNotes as Map<Ref<Issue>, string> | undefined
    })
    if (typeof res === 'object' && 'kind' in res && res.kind === NO_APPROVER) {
      // No inline error element (#2): surface the block as a toast instead of breaking the day card.
      const projects = res.projects.map((p) => projectNames.get(p) ?? p).join(', ')
      addNotification(
        `Can't submit ${weekdayLongFmt.format(day.date)}`,
        `No approver set for ${projects}. Ask an admin to assign a PM or Team Lead on that project, then submit.`,
        SubmitErrorNotification,
        undefined,
        NotificationSeverity.Error
      )
    }
  }

  async function onRecall (day: DayGroup): Promise<void> {
    const persisted = dayByKey.get(day.key)
    if (persisted !== undefined) await recallDay(client, persisted._id)
  }

  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  // Day-card formatters (mockup `.day__dow` / `.day__day`) + the full weekday name for the toast title.
  const dowFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
  const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
  const weekdayLongFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
  const todayKey = localDayKey(Date.now())
  function shift (deltaWeeks: number): void {
    // Calendar-based shift (DST-safe): step whole days from this week's Monday.
    const d = new Date(week.start)
    d.setDate(d.getDate() + deltaWeeks * 7)
    anchor = d.getTime()
  }
</script>

<div class="ts-head">
  <h1 class="ts-title"><Label label={ygTimesheet.string.MyTimesheet} /></h1>
  <div class="weekbar">
    <button class="weekbar__nav" aria-label="Previous week" on:click={() => shift(-1)}>
      <IconBack size="small" />
    </button>
    <span class="weekbar__range">{weekdayFmt.format(week.days[0].date)} to {weekdayFmt.format(week.days[6].date)}</span>
    <button class="weekbar__nav" aria-label="Next week" on:click={() => shift(1)}>
      <IconForward size="small" />
    </button>
    <span class="spacer" />
    <span class="weekbar__total">
      <span class="weekbar__total-label">This week</span>
      <span class="weekbar__total-val">{formatHours(weekTotal)}</span>
    </span>
  </div>
</div>

<div class="ts-days-wrap">
  <div class="days">
    {#each days as day (day.key)}
      {@const dayTasks = tasksByKey.get(day.key) ?? []}
      {@const status = deriveDayStatus(dayTasks.map((t) => t.status))}
      {@const hasTasks = day.issues.length > 0}
      <div
        class="day {railClass(status)}"
        class:has-tasks={hasTasks}
        class:is-empty={!hasTasks}
        class:is-today={day.key === todayKey}
      >
        <div class="day__head">
          <div class="day__date">
            <span class="day__dow">{dowFmt.format(day.date)}{day.key === todayKey ? ' · Today' : ''}</span>
            <span class="day__day">{dateFmt.format(day.date)}</span>
          </div>
          {#if !hasTasks}
            <span class="day__empty">No time logged yet</span>
          {/if}
          <span class="spacer" />
          <span class="yg-pill yg-pill--{status.toLowerCase()}"><Label label={statusString(status)} /></span>
          <span class="day__hours" class:zero={day.total === 0}>{formatHours(day.total)}</span>
          {#if (status === 'Draft' || status === 'Rejected') && hasTasks}
            <button class="yg-btn yg-btn--primary" on:click={() => onSubmit(day)}>
              <Label label={status === 'Rejected' ? ygTimesheet.string.Resubmit : ygTimesheet.string.Submit} />
            </button>
          {:else if status === 'Submitted'}
            <button class="yg-btn yg-btn--ghost" on:click={() => onRecall(day)}>
              <Label label={ygTimesheet.string.Recall} />
            </button>
          {/if}
        </div>
        {#if hasTasks}
          <div class="tasks">
            {#each day.issues as it (it.issueId)}
              {@const task = dayTasks.find((t) => t.issue === it.issueId)}
              {@const rounds = task !== undefined ? cyclesFor(task, cyclesByKey) : []}
              {@const open = openCycle(rounds)}
              {@const past = closedCycles(rounds)}
              {@const rejectedBy = open?.rejectedBy != null ? (approverNames.get(open.rejectedBy) ?? '') : ''}
              <div class="task">
                <span class="yg-idbadge">{it.identifier}</span>
                <a
                  class="task__title"
                  href="#{getPanelURI(tracker.component.EditIssue, it.issueId, tracker.class.Issue, 'content')}"
                >
                  {it.title}
                  <span class="go">↗</span>
                </a>
                <span class="task__hrs">{formatHours(it.hours)}</span>
                {#if task !== undefined}
                  <span class="yg-tag yg-tag--{task.status.toLowerCase()}">
                    <span class="tick" />
                    <Label label={statusString(task.status)} />
                  </span>
                {/if}
              </div>
              {#if task !== undefined && task.status === 'Rejected' && (task.rejectReason ?? '') !== ''}
                <div class="reason">
                  <div class="reason__text">⤷ "{task.rejectReason}"</div>
                  <div class="reason__meta">
                    {#if open !== undefined}
                      <span>
                        {#if rejectedBy !== ''}{rejectedBy}, {/if}{agoFmt.format(open.rejectedOn)}
                      </span>
                    {/if}
                    {#if past.length > 0}
                      <button class="reason__more" on:click={() => toggle(task._id)}>
                        rejected {past.length + 1}x {expanded.has(task._id) ? '▴' : '▾'}
                      </button>
                    {/if}
                  </div>
                  {#if past.length > 0 && expanded.has(task._id)}
                    {#each past as round, ri (round._id)}
                      <div class="reason__round">
                        <b>round {ri + 1}:</b> "{round.rejectReason}"
                        {#if (round.resubmitNote ?? '') !== ''}
                          <span class="reason__reply">you replied: "{round.resubmitNote}"</span>
                        {/if}
                      </div>
                    {/each}
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;

  // This design uses `.day` cards (not `.yg-table`), so none of the classes below shadow
  // `.yg-table th`/`td` or the `td.yg-num` numeric rule from yg-table.scss (Task 3's cascade
  // lesson doesn't apply here): every selector is local to this component's own `.day` markup.
  .ts-days-wrap { padding: 1rem; overflow: auto; }

  // Header: page title + weekbar, from the mockup (docs/superpowers/specs/mockups/my-timesheet.html)
  // `.title` / `.weekbar`. Replaces the old stacked ac-header ("<" / ">" / Today / Total:) with a
  // single clean row: chevron, week range, chevron, spacer, total-hours pill.
  .ts-head { flex: none; padding: 1rem 1.25rem 0; }

  .ts-title {
    font-size: 1.375rem;
    font-weight: 680;
    letter-spacing: -0.01em;
    margin: 0 0 18px;
    color: var(--yg-text);
  }

  .weekbar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 4px 18px;
  }

  .weekbar__nav {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--yg-border);
    background: var(--yg-panel);
    color: var(--yg-text-dim);
    cursor: pointer;
    box-shadow: var(--yg-shadow);
  }
  .weekbar__nav:hover { color: var(--yg-text); }

  .weekbar__range {
    font-size: 15px;
    font-weight: 620;
    letter-spacing: -0.01em;
    color: var(--yg-text);
  }

  .weekbar .spacer { flex: 1; }

  .weekbar__total {
    display: flex;
    align-items: baseline;
    gap: 7px;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    box-shadow: var(--yg-shadow);
  }
  .weekbar__total-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--yg-text-faint);
  }
  .weekbar__total-val {
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--yg-text);
  }

  .days { display: flex; flex-direction: column; gap: 12px; }

  .day {
    position: relative;
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    overflow: hidden;
  }
  // Status accent rail, from the mockup's `.day::before`.
  .day::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: transparent;
  }
  .day.is-approved::before { background: var(--yg-green); }
  .day.is-submitted::before { background: var(--yg-amber); }
  .day.is-partial::before { background: linear-gradient(var(--yg-green) 50%, var(--yg-amber) 50%); }
  .day.is-rejected::before { background: var(--yg-red); }

  .day.is-empty { background: var(--yg-panel-soft); }
  .day.is-empty .day__head { padding-top: 12px; padding-bottom: 12px; }

  .day__head {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px 14px 20px;
  }
  .day.has-tasks .day__head { border-bottom: 1px solid var(--yg-border); }

  .day__date { display: flex; flex-direction: column; min-width: 116px; }
  .day__dow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--yg-text-faint); font-weight: 600; }
  .day__day { font-size: 15px; font-weight: 660; letter-spacing: -0.01em; margin-top: 1px; }
  .day.is-today .day__dow { color: var(--yg-ink); font-weight: 700; }

  .spacer { flex: 1; }
  .day__hours { font-variant-numeric: tabular-nums; font-weight: 680; font-size: 15px; min-width: 44px; text-align: right; }
  .day__hours.zero { color: var(--yg-text-faint); font-weight: 500; }
  .day__empty { color: var(--yg-text-faint); font-size: 13px; }

  .tasks { display: flex; flex-direction: column; }
  .task {
    display: grid;
    grid-template-columns: 88px 1fr auto auto;
    align-items: center;
    gap: 14px;
    padding: 11px 18px 11px 20px;
  }
  .task + .task { border-top: 1px solid var(--yg-border); }
  .task__title {
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
  .task__title:hover { text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
  .task__title .go { color: var(--yg-text-faint); font-size: 12px; transition: transform 0.12s; }
  .task__title:hover .go { color: var(--yg-text); transform: translate(1px, -1px); }
  .task__hrs { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--yg-text-dim); min-width: 40px; text-align: right; }

  // Rejection reason, now rendered PER REJECTED TASK rather than once per day. The old day-level
  // callout showed only the first rejected task's reason, so a second rejected task in the same day
  // silently lost its reason (backlog item 2). Indented to sit under its task row.
  .reason {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 18px 10px 20px;
    padding: 8px 12px;
    background: var(--yg-red-bg);
    border: 1px solid var(--yg-red-line);
    border-radius: 9px;
    color: var(--yg-text);
  }
  .reason__text { font-size: 13px; }
  .reason__meta {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    color: var(--yg-text-faint);
  }
  .reason__more {
    padding: 0;
    border: none;
    background: none;
    color: var(--yg-text-faint);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .reason__more:hover { color: var(--yg-text-dim); }
  .reason__round { font-size: 12.5px; color: var(--yg-text-dim); padding-left: 10px; }
  .reason__round b { font-weight: 650; }
  .reason__reply { color: var(--yg-text-faint); }
</style>
