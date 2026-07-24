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
  enriched with its issue's fields — matching the team's Google-sheet tracking format.
  The all-employee / attendance views live in the (separate) HR report.
-->
<script lang="ts">
  import contact, { formatName, type Employee, type Person } from '@hcengineering/contact'
  import { EmployeeBox } from '@hcengineering/contact-resources'
  import { type Ref, type WithLookup } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import tracker, {
    trackerId,
    type Issue,
    type IssueStatus,
    type Project,
    type TimeSpendReport
  } from '@hcengineering/tracker'
  import {
    Button,
    DropdownLabels,
    getCurrentLocation,
    Label,
    navigate,
    type DropdownTextItem
  } from '@hcengineering/ui'
  import ygTimesheet, {
    type Timesheet,
    type TimesheetApproval,
    type TimesheetDay,
    type TimesheetTask
  } from '@hcengineering/yg-timesheet'
  import { filterRows, priorityLabel, toCSV, type ReportFilter, type ReportRow } from '../utils/reports'
  import { formatHours, localDayKey, weekRange } from '../utils/week'

  // --- Filter state (default = current week) -------------------------------
  const initialWeek = weekRange(Date.now())
  let fromStr = localDayKey(initialWeek.start)
  // The To picker is inclusive; the query/filter use an exclusive [from, to) window.
  let toStr = localDayKey(initialWeek.end - 1)

  let member: Ref<Person> | null | undefined
  let projectSel: string | undefined
  let statusSel: string | undefined

  function parseDay (s: string): number {
    const [y, m, d] = s.split('-').map((v) => Number(v))
    return new Date(y, m - 1, d).getTime()
  }
  function nextDayStart (s: string): number {
    // DST-safe exclusive end: start of the day AFTER the inclusive "to" date.
    const [y, m, d] = s.split('-').map((v) => Number(v))
    return new Date(y, m - 1, d + 1).getTime()
  }

  $: from = parseDay(fromStr)
  $: to = nextDayStart(toStr)

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

  // Per-task approval overlay (private ygTimesheet.space.Approvals — non-members get []). Indexed
  // by employee+issue+day so the row builder can look up approved hours/approver per logged time
  // entry WITHOUT crossing employees: two different employees can log the same issue on the same
  // calendar day, and without the employee in the key one's approval would bleed onto the other's
  // row (payroll misattribution). Nested $lookup resolves the employee via task → day → timesheet
  // (mirrors Approvals.svelte). Reuses `employeeNames` (above) for the approver's display name —
  // no second name lookup.
  const approvalQuery = createQuery()
  let approvedByKey: Map<string, WithLookup<TimesheetApproval>> = new Map()
  approvalQuery.query(
    ygTimesheet.class.TimesheetApproval,
    {},
    (res: Array<WithLookup<TimesheetApproval>>) => {
      const m = new Map<string, WithLookup<TimesheetApproval>>()
      for (const a of res) {
        const task = a.$lookup?.task as WithLookup<TimesheetTask> | undefined
        const day = task?.$lookup?.attachedTo as WithLookup<TimesheetDay> | undefined
        const ts = day?.$lookup?.attachedTo as Timesheet | undefined
        const emp = ts?.employee
        // Fail SAFE: an unresolved employee yields no key, so the row's approval columns come out
        // blank (never wrongly attributed to the wrong employee).
        if (task === undefined || emp == null) continue
        m.set(`${emp}|${task.issue}|${localDayKey(task.date)}`, a)
      }
      approvedByKey = m
    },
    {
      lookup: {
        task: [ygTimesheet.class.TimesheetTask, { attachedTo: [ygTimesheet.class.TimesheetDay, { attachedTo: ygTimesheet.class.Timesheet }] }]
      }
    }
  )

  // --- Build ReportRow[] ---------------------------------------------------
  $: allRows = reports.map((r): ReportRow => {
    const issue = r.$lookup?.attachedTo as Issue | undefined
    const project = (issue?.space ?? '') as string
    const employee = (r.employee ?? '') as string
    // date is non-null in practice (the query filters on a date range); coerce for typing.
    const date = r.date ?? 0
    const status = (issue?.status ?? '') as string
    const issueId = (issue?._id ?? r.attachedTo) as string
    const approved = approvedByKey.get(`${employee}|${issueId}|${localDayKey(date)}`)
    return {
      date,
      employee,
      employeeName: employeeNames.get(employee) ?? employee,
      project,
      projectName: projectNames.get(project) ?? project,
      issue: issueId,
      identifier: issue?.identifier ?? '—',
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

  // Rows filtered by everything EXCEPT status — used both to build the Status dropdown options
  // (so selecting a status never empties its own choices) and as the base for the final filter.
  $: baseFilter = {
    from,
    to,
    project: projectSel != null && projectSel !== '' ? projectSel : undefined,
    member: (member ?? undefined) as string | undefined
  } satisfies ReportFilter
  $: preStatusRows = filterRows(allRows, baseFilter)
  $: statusItems = [...new Set(preStatusRows.map((r) => r.statusName).filter((s) => s !== ''))]
    .sort((a, b) => a.localeCompare(b))
    .map((s): DropdownTextItem => ({ id: s, label: s }))
  // If the chosen status is no longer among the available options (e.g. after narrowing the
  // project), clear it — otherwise the dropdown reads as empty while the filter still hides
  // everything, and the table shows a misleading "No data".
  $: if (statusSel != null && !statusItems.some((i) => i.id === statusSel)) statusSel = undefined

  $: filter = { ...baseFilter, status: statusSel != null && statusSel !== '' ? statusSel : undefined }
  // Newest work first; ties broken by employee then issue id — stable & predictable across pages.
  $: rows = filterRows(allRows, filter).sort(
    (a, b) =>
      b.date - a.date ||
      a.employeeName.localeCompare(b.employeeName) ||
      a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
  )
  $: totalSpent = rows.reduce((s, r) => s + r.hours, 0)

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
  $: filterSig = `${fromStr}|${toStr}|${member ?? ''}|${projectSel ?? ''}|${statusSel ?? ''}|${pageSize}`
  $: {
    filterSig
    page = 1
  }
  $: totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  $: safePage = Math.min(Math.max(1, page), totalPages)
  $: pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize)
  $: firstIdx = rows.length === 0 ? 0 : (safePage - 1) * pageSize + 1
  $: lastIdx = Math.min(safePage * pageSize, rows.length)

  // --- Issue link ----------------------------------------------------------
  function issueHref (identifier: string): string {
    const loc = getCurrentLocation()
    return `/${loc.path[0]}/${loc.path[1]}/${trackerId}/${identifier}`
  }
  function openIssue (e: MouseEvent, identifier: string): void {
    // Let ctrl/cmd/middle-click fall through to the browser (open in a new tab).
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    const loc = getCurrentLocation()
    loc.path = [loc.path[0], loc.path[1], trackerId, identifier]
    loc.fragment = undefined
    loc.query = undefined
    navigate(loc)
  }

  const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

  // Export ALL filtered rows (not just the current page), with the full column set incl. title.
  // Prepend a UTF-8 BOM so Excel opens it with the right encoding (accented names render).
  function exportCsv (): void {
    const blob = new Blob(['\ufeff' + toCSV(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pm-timesheet-report.csv'
    a.click()
    URL.revokeObjectURL(url)
  }
</script>

<div class="rp-root">
  <div class="ac-header full divide">
    <div class="ac-header__wrap-title">
      <span class="ac-header__title"><Label label={ygTimesheet.string.Reports} /></span>
    </div>
  </div>

  <!-- Filter bar -->
  <div class="rp-filters">
    <label class="rp-field">
      <span class="rp-field__label"><Label label={ygTimesheet.string.From} /></span>
      <input class="rp-date" type="date" bind:value={fromStr} />
    </label>
    <label class="rp-field">
      <span class="rp-field__label"><Label label={ygTimesheet.string.To} /></span>
      <input class="rp-date" type="date" bind:value={toStr} />
    </label>
    <div class="rp-field">
      <span class="rp-field__label"><Label label={ygTimesheet.string.Member} /></span>
      <EmployeeBox
        label={ygTimesheet.string.Member}
        bind:value={member}
        allowDeselect
        titleDeselect={ygTimesheet.string.All}
        kind="regular"
      />
    </div>
    <div class="rp-field">
      <span class="rp-field__label"><Label label={ygTimesheet.string.Project} /></span>
      <DropdownLabels
        items={projectItems}
        bind:selected={projectSel}
        label={ygTimesheet.string.Project}
        autoSelect={false}
        allowDeselect
        kind="regular"
      />
    </div>
    <div class="rp-field">
      <span class="rp-field__label"><Label label={ygTimesheet.string.Status} /></span>
      <DropdownLabels
        items={statusItems}
        bind:selected={statusSel}
        label={ygTimesheet.string.Status}
        autoSelect={false}
        allowDeselect
        kind="regular"
      />
    </div>
    <div class="rp-field rp-field--end">
      <Button
        kind="regular"
        label={ygTimesheet.string.ExportCsv}
        disabled={rows.length === 0}
        on:click={exportCsv}
      />
    </div>
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
            <th class="left"><Label label={ygTimesheet.string.Employee} /></th>
            <th class="left"><Label label={ygTimesheet.string.Project} /></th>
            <th class="left"><Label label={ygTimesheet.string.HulyId} /></th>
            <th class="yg-num"><Label label={ygTimesheet.string.Estimated} /></th>
            <th class="yg-num"><Label label={ygTimesheet.string.Spent} /></th>
            <th><Label label={ygTimesheet.string.Status} /></th>
            <th><Label label={ygTimesheet.string.Priority} /></th>
            <th><Label label={ygTimesheet.string.DueDate} /></th>
            <th class="left"><Label label={ygTimesheet.string.Notes} /></th>
          </tr>
        </thead>
        <tbody>
          {#each pageRows as r, i (r.issue + '|' + r.date + '|' + r.employee + '|' + i)}
            <tr class="yg-row">
              <td class="left">{dateFmt.format(r.date)}</td>
              <td class="left">{r.employeeName}</td>
              <td class="left">{r.projectName}</td>
              <td class="left">
                {#if r.identifier !== '—'}
                  <a class="rp-link" href={issueHref(r.identifier)} on:click={(e) => openIssue(e, r.identifier)}>
                    {r.identifier}
                  </a>
                {:else}
                  <span class="rp-muted">{r.identifier}</span>
                {/if}
              </td>
              <td class="yg-num">{formatHours(r.estimation)}</td>
              <td class="yg-num">{formatHours(r.hours)}</td>
              <td>{r.statusName}</td>
              <td>{priorityLabel(r.priority)}</td>
              <td>{r.dueDate != null ? dateFmt.format(r.dueDate) : '—'}</td>
              <td class="left rp-note">{r.note}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr class="yg-totals">
            <td colspan="5" class="left"><b><Label label={ygTimesheet.string.TotalHours} /></b></td>
            <td class="yg-num"><b>{formatHours(totalSpent)}</b></td>
            <td colspan="4" />
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
      <div class="rp-pager__range">{firstIdx}–{lastIdx} / {rows.length}</div>
      <div class="rp-pager__nav">
        <button class="rp-arrow" disabled={safePage <= 1} on:click={() => (page = safePage - 1)}>‹</button>
        <span class="rp-pager__page">{safePage} / {totalPages}</span>
        <button class="rp-arrow" disabled={safePage >= totalPages} on:click={() => (page = safePage + 1)}>›</button>
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  @use './yg-table' as *;

  .rp-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .rp-filters {
    display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.75rem;
    padding: 0.75rem 1rem; border-bottom: 1px solid var(--theme-divider-color);
  }
  .rp-field { display: flex; flex-direction: column; gap: 0.25rem; }
  .rp-field--end { margin-left: auto; align-self: flex-end; }
  .rp-field__label { font-size: 0.6875rem; color: var(--theme-dark-color); text-transform: uppercase; }
  .rp-date {
    padding: 0.25rem 0.5rem; border: 1px solid var(--theme-divider-color); border-radius: 0.25rem;
    background: var(--theme-bg-color); color: var(--theme-content-color); font-size: 0.8125rem;
  }
  .rp-table-wrap { overflow: auto; flex: 1; padding: 1rem; }
  .rp-link { color: var(--theme-link-color, var(--primary-button-default)); font-weight: 600; text-decoration: none; }
  .rp-link:hover { text-decoration: underline; }
  .rp-muted { color: var(--theme-dark-color); }
  // Notes is the one column with genuinely variable-length free text (a user-entered
  // description, not a short code/name), so it needs to keep wrapping — the shared
  // `.yg-table td` rule sets `white-space: nowrap` for every cell (Task 3's convention).
  // `.rp-note`'s two classes (0,2,0) out-specificity the global `.yg-table td` (0,1,1) for the
  // properties it restates, same mechanism as HrTimesheet's local `.yg-num` fix in Task 3.
  .rp-note { color: var(--theme-content-color); max-width: 24rem; white-space: normal; vertical-align: top; }
  .rp-pager {
    display: flex; align-items: center; gap: 1rem; padding: 0.5rem 1rem;
    border-top: 1px solid var(--theme-divider-color);
  }
  .rp-pager__size { display: flex; align-items: center; gap: 0.5rem; }
  .rp-pager__range { color: var(--theme-dark-color); font-size: 0.8125rem; font-variant-numeric: tabular-nums; }
  .rp-pager__nav { margin-left: auto; display: flex; align-items: center; gap: 0.5rem; }
  .rp-pager__page { font-size: 0.8125rem; font-variant-numeric: tabular-nums; min-width: 3rem; text-align: center; }
  .rp-arrow {
    width: 1.75rem; height: 1.75rem; display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid var(--theme-divider-color); border-radius: 0.25rem; cursor: pointer;
    background: var(--theme-bg-color); color: var(--theme-content-color); font-size: 1rem; line-height: 1;
  }
  .rp-arrow:hover:not(:disabled) { background: var(--theme-button-hovered); }
  .rp-arrow:disabled { opacity: 0.4; cursor: default; }
</style>
