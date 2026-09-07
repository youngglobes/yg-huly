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
<!--
  PM report: a flat, paginated table with one row per logged time entry (TimeSpendReport)
  enriched with its issue's fields - matching the team's Google-sheet tracking format.
  The all-employee / attendance views live in the (separate) HR report.
-->
<script lang="ts">
  import contact, { formatName, getCurrentEmployee, type Employee, type Person } from '@hcengineering/contact'
  import { UserBoxList } from '@hcengineering/contact-resources'
  import { AccountRole, getCurrentAccount, hasAccountRole, type Ref, type WithLookup } from '@hcengineering/core'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Issue, type IssueStatus, type Project, type TimeSpendReport } from '@hcengineering/tracker'
  import { DropdownLabels, getPanelURI, Label, type DropdownTextItem } from '@hcengineering/ui'
  import ygTimesheet, {
    type ProjectApprovers,
    type Timesheet,
    type TimesheetDay,
    type TimesheetTask
  } from '@hcengineering/yg-timesheet'
  import { filterRows, type ReportFilter, type ReportRow } from '../utils/reports'
  import { exportReportXlsx } from '../utils/report-xlsx'
  import { formatHours, localDayKey, weekRange, withinDay } from '../utils/week'
  import { asRefArray } from '../utils/workflow'

  const me = getCurrentEmployee()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  // Role gate - mirrors Approvals.svelte EXACTLY (UI convenience only; render-block for direct-URL
  // access, since the sidebar `visibleIf` only hides the menu item). Any PM/TL on ANY project, or
  // an HR admin (Maintainer), can view Reports.
  const isHRAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)
  let isApprover = false
  const approverProjQuery = createQuery()
  approverProjQuery.query(tracker.class.Project, {}, (projects: Project[]) => {
    isApprover = projects.some((p) => {
      if (!hierarchy.hasMixin(p, ygTimesheet.mixin.ProjectApprovers)) return false
      const a = hierarchy.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers
      return asRefArray(a.pm).includes(me) || asRefArray(a.teamLead).includes(me)
    })
  })
  $: canApprove = isHRAdmin || isApprover

  // --- Filter state (default = current week) -------------------------------
  const initialWeek = weekRange(Date.now())
  let fromStr = localDayKey(initialWeek.start)
  // The To picker is inclusive; the query/filter use an exclusive [from, to) window.
  let toStr = localDayKey(initialWeek.end - 1)

  // Project and Member are multi-select (empty = "All"); Status stays single-select.
  let members: Ref<Person>[] = []
  let projectSels: string[] = []
  let statusSel: string | undefined

  // Date range is chosen by a preset; "custom" reveals the From/To pickers. Labels are inline
  // (like pageSizeItems) - internal, English-primary.
  let preset: string = 'thisWeek'
  const presetItems: DropdownTextItem[] = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'thisWeek', label: 'This week' },
    { id: 'lastWeek', label: 'Last week' },
    { id: 'thisMonth', label: 'This month' },
    { id: 'lastMonth', label: 'Last month' },
    { id: 'custom', label: 'Custom' }
  ]

  function parseDay (s: string): number {
    const [y, m, d] = s.split('-').map((v) => Number(v))
    return new Date(y, m - 1, d).getTime()
  }
  function nextDayStart (s: string): number {
    // DST-safe exclusive end: start of the day AFTER the inclusive "to" date.
    const [y, m, d] = s.split('-').map((v) => Number(v))
    return new Date(y, m - 1, d + 1).getTime()
  }

  // Resolve the non-custom presets to a [from, to) window (to is exclusive). Today/yesterday are single
  // local days; this/last week reuse weekRange (Mon-Sun); this month = the 1st through today inclusive;
  // last month = the whole previous calendar month. All bounds use new Date(y, mo, d) local-midnight
  // constructors, so they are DST-safe.
  function rangeForPreset (p: string): { from: number, to: number } {
    const now = new Date()
    const y = now.getFullYear()
    const mo = now.getMonth()
    const d = now.getDate()
    if (p === 'today') return { from: new Date(y, mo, d).getTime(), to: new Date(y, mo, d + 1).getTime() }
    if (p === 'yesterday') return { from: new Date(y, mo, d - 1).getTime(), to: new Date(y, mo, d).getTime() }
    if (p === 'lastWeek') {
      const lw = new Date()
      lw.setDate(lw.getDate() - 7)
      const w = weekRange(lw.getTime())
      return { from: w.start, to: w.end }
    }
    if (p === 'thisMonth') return { from: new Date(y, mo, 1).getTime(), to: new Date(y, mo, d + 1).getTime() }
    if (p === 'lastMonth') return { from: new Date(y, mo - 1, 1).getTime(), to: new Date(y, mo, 1).getTime() }
    const w = weekRange(now.getTime()) // thisWeek (default)
    return { from: w.start, to: w.end }
  }

  // For a non-custom preset, mirror its window into fromStr/toStr - that feeds the read-out and
  // pre-seeds the From/To pickers when the user switches to "custom". Reads only `preset`, so its
  // own fromStr/toStr writes never loop it.
  $: if (preset !== 'custom') {
    const r = rangeForPreset(preset)
    fromStr = localDayKey(r.from)
    toStr = localDayKey(r.to - 1)
  }
  $: from = preset === 'custom' ? parseDay(fromStr) : rangeForPreset(preset).from
  $: to = preset === 'custom' ? nextDayStart(toStr) : rangeForPreset(preset).to

  // --- Queries -------------------------------------------------------------
  // Time entries for the window. Space-security auto-scopes to accessible projects.
  const reportQuery = createQuery()
  let reports: Array<WithLookup<TimeSpendReport>> = []
  $: reportQuery.query(
    tracker.class.TimeSpendReport,
    { date: { $gte: from, $lt: to } },
    (res: Array<WithLookup<TimeSpendReport>>) => {
      reports = res
    },
    { lookup: { attachedTo: tracker.class.Issue } }
  )

  // Project name map (+ options for the project filter).
  const projectQuery = createQuery()
  let projectNames: Map<string, string> = new Map()
  projectQuery.query(tracker.class.Project, {}, (res: Project[]) => {
    const m = new Map<string, string>()
    for (const p of res) m.set(p._id, p.name)
    projectNames = m
  })
  $: projectItems = [...projectNames]
    .map(([id, name]): DropdownTextItem => ({ id, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))

  // Employee name map.
  const empQuery = createQuery()
  let employeeNames: Map<string, string> = new Map()
  empQuery.query(contact.mixin.Employee, {}, (res: Employee[]) => {
    const m = new Map<string, string>()
    // Person.name is stored as "Last,First"; format to display order (e.g. "Praja Owner").
    for (const e of res) m.set(e._id, formatName(e.name))
    employeeNames = m
  })

  // Issue workflow-status name map (Todo / In Progress / …).
  const statusQuery = createQuery()
  let statusNames: Map<string, string> = new Map()
  statusQuery.query(tracker.class.IssueStatus, {}, (res: IssueStatus[]) => {
    const m = new Map<string, string>()
    for (const s of res) m.set(s._id, s.name)
    statusNames = m
  })

  // Per-task approval overlay - indexed by employee+issue+day so the row builder looks up approved
  // hours/approver per logged time entry WITHOUT crossing employees: two people can log the same
  // issue on the same calendar day, and without the employee in the key one's approval would bleed
  // onto the other's row (payroll misattribution). Reuses `employeeNames` (above) for the approver's
  // display name.
  //
  // approvedHours/approvedBy are read directly off TimesheetTask (denormalized there - see
  // ygTimesheet.class.TimesheetApproval's doc comment): the separate TimesheetApproval doc lives in
  // ygTimesheet.space.Approvals, which is not readable by the client, so an earlier version that
  // queried it came back UNRESOLVED on a fresh server query and every approval was dropped, blanking
  // the columns on refresh + in the CSV export (2026-07-27). Three flat live queries (each in a
  // world-readable space) feed one reactive join.
  const taskInfoQuery = createQuery()
  let taskInfo = new Map<string, { day: string, issue: string, date: number, approvedHours?: number, approvedBy?: string }>() // TimesheetTask._id
  taskInfoQuery.query(ygTimesheet.class.TimesheetTask, { status: 'Approved' }, (res: TimesheetTask[]) => {
    const m = new Map<string, { day: string, issue: string, date: number, approvedHours?: number, approvedBy?: string }>()
    for (const t of res) {
      m.set(t._id, {
        day: t.attachedTo as string,
        issue: t.issue as string,
        date: t.date,
        approvedHours: t.approvedHours,
        approvedBy: t.approvedBy as string | undefined
      })
    }
    taskInfo = m
  })

  const dayQuery = createQuery()
  let dayTimesheet = new Map<string, string>() // TimesheetDay._id -> Timesheet._id
  dayQuery.query(ygTimesheet.class.TimesheetDay, {}, (res: TimesheetDay[]) => {
    const m = new Map<string, string>()
    for (const d of res) m.set(d._id, d.attachedTo as string)
    dayTimesheet = m
  })

  const tsQuery = createQuery()
  let tsEmployee = new Map<string, string>() // Timesheet._id -> employee
  tsQuery.query(ygTimesheet.class.Timesheet, {}, (res: Timesheet[]) => {
    const m = new Map<string, string>()
    for (const t of res) m.set(t._id, t.employee as string)
    tsEmployee = m
  })

  // Join the three maps: task → day → timesheet → employee, keyed exactly like the row lookup
  // below. Fail SAFE: an unresolved chain yields no key, so the columns come out blank rather
  // than mis-attributed.
  // Index approved tasks by employee|issue, each carrying the task's day-start instant. The row
  // lookup below matches a report to its approval with an ABSOLUTE 24h window (withinDay), NOT a
  // localDayKey string: task.date is stored as local-midnight, an instant that a non-IST viewer's
  // browser bins onto the previous day, which silently blanked the Approved/Approved-by columns.
  // Only tasks that actually have approvedHours are included.
  $: approvedByEmpIssue = ((): Map<string, Array<{ start: number, approvedHours?: number, approvedBy?: string }>> => {
    const m = new Map<string, Array<{ start: number, approvedHours?: number, approvedBy?: string }>>()
    for (const info of taskInfo.values()) {
      if (info.approvedHours == null) continue
      const tsId = dayTimesheet.get(info.day)
      const emp = tsId != null ? tsEmployee.get(tsId) : undefined
      if (emp == null) continue
      const key = `${emp}|${info.issue}`
      const arr = m.get(key) ?? []
      arr.push({ start: info.date, approvedHours: info.approvedHours, approvedBy: info.approvedBy })
      m.set(key, arr)
    }
    return m
  })()

  // --- Build ReportRow[] ---------------------------------------------------
  $: allRows = reports.map((r): ReportRow => {
    const issue = r.$lookup?.attachedTo as Issue | undefined
    const project = (issue?.space ?? '') as string
    const employee = (r.employee ?? '') as string
    // date is non-null in practice (the query filters on a date range); coerce for typing.
    const date = r.date ?? 0
    const status = (issue?.status ?? '') as string
    const issueId = (issue?._id ?? r.attachedTo) as string
    const approved = approvedByEmpIssue.get(`${employee}|${issueId}`)?.find((c) => withinDay(c.start, date))
    return {
      date,
      employee,
      employeeName: employeeNames.get(employee) ?? employee,
      project,
      projectName: projectNames.get(project) ?? project,
      issue: issueId,
      identifier: issue?.identifier ?? '-',
      title: issue?.title ?? '(unknown issue)',
      estimation: issue?.estimation ?? 0,
      hours: r.value,
      statusName: statusNames.get(status) ?? '',
      priority: issue?.priority ?? 0,
      dueDate: issue?.dueDate ?? null,
      note: r.description ?? '',
      approvedHours: approved?.approvedHours,
      approvedByName: approved?.approvedBy != null ? (employeeNames.get(approved.approvedBy) ?? undefined) : undefined
    }
  })

  // Rows filtered by everything EXCEPT status - used both to build the Status dropdown options
  // (so selecting a status never empties its own choices) and as the base for the final filter.
  $: baseFilter = {
    from,
    to,
    projects: projectSels.length > 0 ? projectSels : undefined,
    members: members.length > 0 ? (members as string[]) : undefined
  } satisfies ReportFilter
  $: preStatusRows = filterRows(allRows, baseFilter)
  $: statusItems = [...new Set(preStatusRows.map((r) => r.statusName).filter((s) => s !== ''))]
    .sort((a, b) => a.localeCompare(b))
    .map((s): DropdownTextItem => ({ id: s, label: s }))
  // If the chosen status is no longer among the available options (e.g. after narrowing the
  // project), clear it - otherwise the dropdown reads as empty while the filter still hides
  // everything, and the table shows a misleading "No data".
  $: if (statusSel != null && !statusItems.some((i) => i.id === statusSel)) statusSel = undefined

  $: filter = { ...baseFilter, status: statusSel != null && statusSel !== '' ? statusSel : undefined }
  // Newest work first; ties broken by employee then issue id - stable & predictable across pages.
  $: rows = ((): ReportRow[] => {
    const sorted = filterRows(allRows, filter).sort(
      (a, b) =>
        b.date - a.date ||
        a.employeeName.localeCompare(b.employeeName) ||
        a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
    )
    // A task (employee+issue+day) has ONE approval but can span several TimeSpendReport rows (time
    // logged in more than one sitting). Keep the approved hours/approver on the FIRST row of each task
    // only and blank the rest, so the Approved column and its footer total sum the approval ONCE -
    // matching the per-task figure the PM dashboard shows (this was double-counting split-logged tasks).
    const seenTask = new Set<string>()
    return sorted.map((r) => {
      if (r.approvedHours == null) return r
      const key = `${r.employee}|${r.issue}|${localDayKey(r.date)}`
      if (seenTask.has(key)) return { ...r, approvedHours: undefined, approvedByName: undefined }
      seenTask.add(key)
      return r
    })
  })()
  $: totalSpent = rows.reduce((s, r) => s + r.hours, 0)
  $: totalApproved = rows.reduce((s, r) => s + (r.approvedHours ?? 0), 0)

  // --- Pagination ----------------------------------------------------------
  const pageSizeItems: DropdownTextItem[] = [
    { id: '10', label: '10' },
    { id: '25', label: '25' },
    { id: '50', label: '50' },
    { id: '100', label: '100' }
  ]
  let pageSizeSel = '25'
  $: pageSize = Number(pageSizeSel)
  let page = 1
  // Reset to page 1 whenever the filtered set or page size changes.
  $: filterSig = `${preset}|${fromStr}|${toStr}|${members.join(',')}|${projectSels.join(',')}|${statusSel ?? ''}|${pageSize}`
  $: {
    filterSig
    page = 1
  }
  $: totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  $: safePage = Math.min(Math.max(1, page), totalPages)
  $: pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize)
  $: firstIdx = rows.length === 0 ? 0 : (safePage - 1) * pageSize + 1
  $: lastIdx = Math.min(safePage * pageSize, rows.length)

  const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

  // --- Presentation-only helpers (no data/query impact) ---------------------
  // Avatar initials from a display name, e.g. "Oliver User" -> "OU" (mirrors Approvals.svelte).
  function initials (name: string): string {
    const parts = name.trim().split(/\s+/).filter((p) => p.length > 0)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }

  // Deterministic 1-4 avatar color bucket from an id/name string, so the same person always
  // gets the same color across rows (unlike Approvals.svelte's per-group `i % 4`, Reports has
  // many rows per person, so the bucket must be a function of identity, not row position).
  function avatarBucket (key: string): number {
    let h = 0
    for (let i = 0; i < key.length; i++) h = (h + key.charCodeAt(i)) % 4
    return h + 1
  }

  // Best-effort status-chip variant from the issue workflow status NAME (statusQuery/statusNames
  // is preserved as-is and only ever carries names, no category ref) - purely a display bucket,
  // same idiom as HrTimesheet's `deriveDayStatus`-driven pill classing. Unrecognized/custom
  // status names fall back to the neutral "back" (backlog-style) look.
  function statusChipVariant (name: string): 'done' | 'prog' | 'back' {
    const n = name.toLowerCase()
    if (n.includes('done') || n.includes('complet') || n.includes('closed') || n.includes('resolved')) return 'done'
    if (n.includes('progress') || n.includes('review') || n.includes('active') || n.includes('doing')) return 'prog'
    return 'back'
  }

  // Clears every filter back to its default (current week, All projects, All members, All statuses).
  function resetFilters (): void {
    preset = 'thisWeek' // the reactive above re-syncs fromStr/toStr to this week
    projectSels = []
    members = []
    statusSel = undefined
  }

  // Open the native date picker when the user clicks anywhere on the field, not just the calendar
  // icon. showPicker() must run from a user gesture (a click qualifies); guard for older browsers.
  function openDatePicker (e: MouseEvent): void {
    try {
      ;(e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()
    } catch {}
  }

  // Export ALL filtered rows (not just the current page) as .xlsx, with the full column set incl.
  // title. Real typed cells (see utils/report-xlsx) so dates sort and hour columns sum in Excel.
  let exporting = false
  async function exportXlsx (): Promise<void> {
    exporting = true
    try {
      await exportReportXlsx(rows)
    } catch (err: any) {
      await setPlatformStatus(unknownError(err))
    } finally {
      exporting = false
    }
  }
</script>

<div class="rp-root">
  {#if !canApprove}
    <div class="yg-empty">Restricted to approvers.</div>
  {:else}
    <!-- Header: title + summary + export -->
    <div class="rp-head">
      <h1 class="rp-title"><Label label={ygTimesheet.string.Reports} /></h1>
      <span class="rp-summary">
        <b>{rows.length}</b> {rows.length === 1 ? 'entry' : 'entries'} · <b>{formatHours(totalSpent)}</b> logged ·
        <b>{formatHours(totalApproved)}</b> approved
      </span>
      <span class="rp-spacer" />
      <button class="yg-btn yg-btn--primary" disabled={exporting || rows.length === 0} on:click={exportXlsx}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 2v8m0 0 3-3m-3 3L5 7"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path d="M2.5 11.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <Label label={ygTimesheet.string.Export} />
      </button>
    </div>

    <!-- Filter toolbar -->
    <div class="rp-toolbar">
      <span class="rp-ctrl">
        <span class="rp-ctrl__k"><Label label={ygTimesheet.string.Period} /></span>
        <DropdownLabels items={presetItems} bind:selected={preset} label={ygTimesheet.string.Period} autoSelect={false} kind="regular">
          <span slot="content" class="overflow-label">
            {presetItems.find((i) => i.id === preset)?.label ?? ''}
          </span>
        </DropdownLabels>
      </span>
      {#if preset === 'custom'}
        <span class="rp-ctrl rp-ctrl--range">
          <span class="rp-ctrl__k"><Label label={ygTimesheet.string.From} /></span>
          <input class="rp-date" type="date" bind:value={fromStr} on:click={openDatePicker} />
          <span class="rp-ctrl__sep">&rarr;</span>
          <span class="rp-ctrl__k"><Label label={ygTimesheet.string.To} /></span>
          <input class="rp-date" type="date" bind:value={toStr} on:click={openDatePicker} />
        </span>
      {:else}
        <span class="rp-ctrl rp-range-label">{dateFmt.format(from)} &rarr; {dateFmt.format(to - 1)}</span>
      {/if}
      <span class="rp-ctrl">
        <span class="rp-ctrl__k"><Label label={ygTimesheet.string.Project} /></span>
        <DropdownLabels items={projectItems} bind:selected={projectSels} label={ygTimesheet.string.Project} autoSelect={false} multiselect kind="regular">
          <span slot="content" class="overflow-label">
            {#if projectSels.length === 0}
              <Label label={ygTimesheet.string.AllProjects} />
            {:else if projectSels.length === 1}
              {projectNames.get(projectSels[0]) ?? projectSels[0]}
            {:else}
              <Label label={ygTimesheet.string.SelectedCount} params={{ count: projectSels.length }} />
            {/if}
          </span>
        </DropdownLabels>
      </span>
      <span class="rp-ctrl">
        <span class="rp-ctrl__k"><Label label={ygTimesheet.string.Member} /></span>
        <UserBoxList
          bind:items={members}
          _class={contact.mixin.Employee}
          label={ygTimesheet.string.Member}
          emptyLabel={ygTimesheet.string.AllMembers}
          kind="regular"
        />
      </span>
      <span class="rp-ctrl">
        <span class="rp-ctrl__k"><Label label={ygTimesheet.string.Status} /></span>
        <DropdownLabels
          items={statusItems}
          bind:selected={statusSel}
          label={ygTimesheet.string.Status}
          autoSelect={false}
          allowDeselect
          kind="regular"
        />
      </span>
      <span class="rp-spacer" />
      <button class="yg-btn yg-btn--ghost" on:click={resetFilters}>
        <Label label={ygTimesheet.string.Reset} />
      </button>
    </div>

    <!-- Results -->
    {#if rows.length === 0}
      <div class="yg-empty"><Label label={ygTimesheet.string.NoData} /></div>
    {:else}
      <div class="rp-table-wrap">
        <table class="yg-table">
          <thead>
            <tr>
              <th class="left"><Label label={ygTimesheet.string.Date} /></th>
              <th class="left">Person</th>
              <th class="left">Task</th>
              <th class="left"><Label label={ygTimesheet.string.Project} /></th>
              <th class="yg-num"><Label label={ygTimesheet.string.Spent} /></th>
              <th class="yg-num"><Label label={ygTimesheet.string.Approved} /></th>
              <th class="left">Approved by</th>
              <th class="left"><Label label={ygTimesheet.string.Status} /></th>
            </tr>
          </thead>
          <tbody>
            {#each pageRows as r, i (r.issue + '|' + r.date + '|' + r.employee + '|' + i)}
              <tr class="yg-row">
                <td class="left rp-date-cell">{dateFmt.format(r.date)}</td>
                <td class="left">
                  <span class="rp-who">
                    <span class="yg-avatar yg-av{avatarBucket(r.employee)}">{initials(r.employeeName)}</span>
                    {r.employeeName}
                  </span>
                </td>
                <td class="left yg-truncate">
                  <span class="rp-task">
                    <span class="yg-idbadge rp-idbadge">{r.identifier}</span>
                    {#if r.identifier !== '-'}
                      <a
                        class="rp-link"
                        href="#{getPanelURI(tracker.component.EditIssue, r.issue, tracker.class.Issue, 'content')}"
                      >
                        {r.title}
                      </a>
                    {:else}
                      <span class="rp-muted">-</span>
                    {/if}
                  </span>
                </td>
                <td class="left rp-proj yg-truncate">{r.projectName}</td>
                <td class="yg-num">{formatHours(r.hours)}</td>
                <td class="yg-num">
                  {#if r.approvedHours != null}
                    {formatHours(r.approvedHours)}
                  {:else}
                    <span class="rp-muted">-</span>
                  {/if}
                </td>
                <td class="left">
                  {#if r.approvedByName != null}
                    <span class="rp-who">
                      <span class="yg-avatar yg-avatar--sm yg-av{avatarBucket(r.approvedByName)}">
                        {initials(r.approvedByName)}
                      </span>
                      {r.approvedByName}
                    </span>
                  {:else}
                    <span class="rp-muted">Pending</span>
                  {/if}
                </td>
                <td class="left">
                  <span class="schip schip--{statusChipVariant(r.statusName)}">
                    <span class="schip__dot" />
                    {r.statusName}
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr class="yg-totals">
              <td colspan="4" class="left">
                <b><Label label={ygTimesheet.string.TotalHours} /> · {rows.length} {rows.length === 1 ? 'entry' : 'entries'}</b>
              </td>
              <td class="yg-num"><b>{formatHours(totalSpent)}</b></td>
              <td class="yg-num"><b>{formatHours(totalApproved)}</b></td>
              <td colspan="2" />
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Pager -->
      <div class="rp-pager">
        <div class="rp-pager__size">
          <span class="rp-field__label"><Label label={ygTimesheet.string.RowsPerPage} /></span>
          <DropdownLabels items={pageSizeItems} bind:selected={pageSizeSel} autoSelect={false} kind="regular" />
        </div>
        <div class="rp-pager__range">Showing {firstIdx}-{lastIdx} of {rows.length}</div>
        <div class="rp-pager__nav">
          <button class="rp-arrow" disabled={safePage <= 1} on:click={() => (page = safePage - 1)}>&lsaquo; Prev</button>
          <span class="rp-pager__page">{safePage} / {totalPages}</span>
          <button class="rp-arrow" disabled={safePage >= totalPages} on:click={() => (page = safePage + 1)}>Next &rsaquo;</button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style lang="scss">
  @use './yg-table' as *;

  .rp-root { display: flex; flex-direction: column; height: 100%; overflow: auto; padding: 1rem 1.25rem 1.5rem; }

  // --- Header: title + summary + export ------------------------------------
  .rp-head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 1rem; }
  .rp-title { font-size: 1.1rem; font-weight: 680; letter-spacing: -0.01em; margin: 0; color: var(--yg-text); }
  .rp-summary { font-size: 0.8125rem; color: var(--yg-text-dim); }
  .rp-summary b { color: var(--yg-text); font-weight: 650; font-variant-numeric: tabular-nums; }
  .rp-spacer { flex: 1; }

  // --- Filter toolbar --------------------------------------------------------
  // Each `.rp-ctrl` is a "pill" wrapper (mockup's `.ctrl`) around the REAL, functional Huly
  // control (native date input, DropdownLabels, EmployeeBox) - restyle-only, the controls
  // underneath stay interactive and bound to the existing filter state.
  .rp-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 1rem; }
  .rp-ctrl {
    display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 3px 11px;
    border-radius: 9px; background: var(--yg-panel); border: 1px solid var(--yg-border-strong);
    box-shadow: var(--yg-shadow); font-size: 13px; color: var(--yg-text);
  }
  .rp-ctrl__k { color: var(--yg-text-faint); font-size: 12px; white-space: nowrap; }
  .rp-ctrl__sep { color: var(--yg-text-faint); }
  // Read-only resolved range shown for non-custom presets (in place of the From/To pickers).
  .rp-range-label { color: var(--yg-text); font-weight: 600; font-size: 13px; white-space: nowrap; }
  .rp-date {
    padding: 0.1875rem 0.375rem; border: 1px solid var(--yg-border); border-radius: 0.25rem;
    background: var(--yg-panel-soft); color: var(--yg-text); font: inherit; font-size: 0.8125rem;
  }

  // --- Table -----------------------------------------------------------------
  .rp-table-wrap {
    overflow: auto; background: var(--yg-panel); border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius); box-shadow: var(--yg-shadow);
  }
  .rp-date-cell { color: var(--yg-text-dim); font-variant-numeric: tabular-nums; }
  .rp-who { display: inline-flex; align-items: center; gap: 8px; }
  // Flex row so the id badge stays fixed and the title link shrinks + ellipsizes inside the
  // truncating Task cell (yg-truncate), instead of the long title widening the whole table.
  .rp-task { display: flex; align-items: center; gap: 8px; min-width: 0; }
  // `.yg-idbadge` (Task 1) is sized for the roomier timesheet/approvals rows; a bit large for
  // this dense table, so a local size tweak only (the shared class itself is untouched).
  .rp-idbadge { font-size: 11px; padding: 1px 6px; flex: none; }
  .rp-link {
    color: var(--yg-text);
    text-decoration: none;
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rp-link:hover { text-decoration: underline; text-underline-offset: 2px; }
  .rp-proj { color: var(--yg-text-dim); }
  .rp-muted { color: var(--yg-text-faint); }

  // Issue workflow-status chip (dot + label). Not part of the shared `yg-table.scss` vocabulary
  // (that file has no `.schip`), so it is defined locally here - mirrors the mockup's
  // `.schip`/`.schip.done`/`.schip.prog`/`.schip.back` family 1:1.
  .schip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--yg-text-dim); font-weight: 500; }
  .schip__dot { width: 7px; height: 7px; border-radius: 2px; background: var(--yg-grey); flex: none; }
  .schip--done { color: var(--yg-green); }
  .schip--done .schip__dot { background: var(--yg-green); }
  .schip--prog .schip__dot { background: var(--yg-amber); }
  .schip--back .schip__dot { background: var(--yg-grey); }

  // --- Pager -------------------------------------------------------------------
  .rp-pager {
    display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1rem;
    border-top: 1px solid var(--yg-border); background: var(--yg-panel-soft);
  }
  .rp-pager__size { display: flex; align-items: center; gap: 0.5rem; }
  .rp-field__label { font-size: 0.6875rem; color: var(--yg-text-faint); text-transform: uppercase; }
  .rp-pager__range { color: var(--yg-text-faint); font-size: 0.78125rem; font-variant-numeric: tabular-nums; }
  .rp-pager__nav { margin-left: auto; display: flex; align-items: center; gap: 0.5rem; }
  .rp-pager__page { font-size: 0.8125rem; font-variant-numeric: tabular-nums; min-width: 3rem; text-align: center; }
  .rp-arrow {
    height: 1.875rem; padding: 0 0.625rem; display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid var(--yg-border-strong); border-radius: 0.5rem; cursor: pointer;
    background: var(--yg-panel); color: var(--yg-text-dim); font: inherit; font-size: 0.8125rem; font-weight: 600;
  }
  .rp-arrow:hover:not(:disabled) { background: var(--yg-panel-soft); }
  .rp-arrow:disabled { opacity: 0.45; cursor: default; }
</style>
