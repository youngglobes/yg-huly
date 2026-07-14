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
  import contact, { type Employee, type Person } from '@hcengineering/contact'
  import { EmployeeBox } from '@hcengineering/contact-resources'
  import core, {
    AccountRole,
    getCurrentAccount,
    hasAccountRole,
    type Ref,
    type WithLookup
  } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery } from '@hcengineering/presentation'
  import tracker, { type Issue, type Project, type TimeSpendReport } from '@hcengineering/tracker'
  import {
    Button,
    DropdownLabels,
    DropdownLabelsIntl,
    IconDownOutline,
    IconForward,
    Label,
    type DropdownIntlItem,
    type DropdownTextItem
  } from '@hcengineering/ui'
  import ygTimesheet, { type Timesheet, type TimesheetDay } from '@hcengineering/yg-timesheet'
  import {
    filterRows,
    groupRows,
    toCSV,
    type GroupDim,
    type ReportRow,
    type ReportStatus
  } from '../utils/reports'
  import { formatHours, localDayKey, weekRange } from '../utils/week'

  // --- Filter state (default = current week) -------------------------------
  const initialWeek = weekRange(Date.now())
  let fromStr = localDayKey(initialWeek.start)
  // The To picker is inclusive; the query/filter use an exclusive [from, to) window.
  let toStr = localDayKey(initialWeek.end - 1)

  let member: Ref<Person> | null | undefined
  let projectSel: string | undefined
  let statusSel = 'all'
  let groupBySel = 'project'

  // Employees mode (all-employee data) is available only to Owner/Maintainer. Everyone
  // else is locked to Detail (own data via the space-scoped TimeSpendReport query).
  const isHRAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)
  let modeSel = 'detail'
  $: mode = isHRAdmin ? modeSel : 'detail'

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
  $: groupBy = groupBySel as GroupDim

  // --- Queries -------------------------------------------------------------
  // Reports for the window. Space-security auto-scopes to accessible projects.
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
    for (const e of res) m.set(e._id, e.name)
    employeeNames = m
  })

  // Approval-status join: TimesheetDay carries the status, but the employee lives on the
  // parent Timesheet (attachedTo), so we $lookup it. Key = `<employeeRef>|<localDayKey>`.
  const dayQuery = createQuery()
  let statusByKey: Map<string, ReportStatus> = new Map()
  $: dayQuery.query(
    ygTimesheet.class.TimesheetDay,
    { space: core.space.Workspace, date: { $gte: from, $lt: to } },
    (res: Array<WithLookup<TimesheetDay>>) => {
      const m = new Map<string, ReportStatus>()
      for (const d of res) {
        const parent = d.$lookup?.attachedTo as Timesheet | undefined
        const employee = parent?.employee
        if (employee == null) continue
        m.set(`${employee}|${localDayKey(d.date)}`, d.status)
      }
      statusByKey = m
    },
    { lookup: { attachedTo: ygTimesheet.class.Timesheet } }
  )

  // Employees mode: build rows directly from every workspace TimesheetDay (all employees).
  // The employee lives on the parent Timesheet (attachedTo), so we $lookup it. Approved days
  // with a snapshot expand one row per snapshot line; every other day is one totalHours row.
  const empDayQuery = createQuery()
  let empRows: ReportRow[] = []
  $: empDayQuery.query(
    ygTimesheet.class.TimesheetDay,
    { space: core.space.Workspace, date: { $gte: from, $lt: to } },
    (res: Array<WithLookup<TimesheetDay>>) => {
      const out: ReportRow[] = []
      for (const d of res) {
        const parent = d.$lookup?.attachedTo as Timesheet | undefined
        const employee = (parent?.employee ?? '') as string
        const employeeName = employeeNames.get(employee) ?? employee
        if (d.status === 'Approved' && d.snapshot != null && d.snapshot.length > 0) {
          for (const line of d.snapshot) {
            out.push({
              date: d.date,
              employee,
              employeeName,
              project: line.project ?? '',
              projectName: projectNames.get(line.project) ?? line.project ?? '',
              issue: (line.issue ?? '') as string,
              identifier: line.identifier ?? '—',
              title: line.title ?? '(unknown issue)',
              hours: line.hours,
              status: 'Approved',
              note: line.note ?? ''
            })
          }
        } else {
          out.push({
            date: d.date,
            employee,
            employeeName,
            project: '',
            projectName: '',
            issue: '',
            identifier: '',
            title: '',
            hours: d.totalHours,
            status: d.status,
            note: ''
          })
        }
      }
      empRows = out
    },
    { lookup: { attachedTo: ygTimesheet.class.Timesheet } }
  )

  // --- Build ReportRow[] ---------------------------------------------------
  $: detailRows = reports.map((r): ReportRow => {
    const issue = r.$lookup?.attachedTo as Issue | undefined
    const project = (issue?.space ?? '') as string
    const employee = (r.employee ?? '') as string
    // date is non-null in practice (the query filters on a date range); coerce for typing.
    const date = r.date ?? 0
    const status = statusByKey.get(`${employee}|${localDayKey(date)}`) ?? 'Draft'
    return {
      date,
      employee,
      employeeName: employeeNames.get(employee) ?? employee,
      project,
      projectName: projectNames.get(project) ?? project,
      issue: (issue?._id ?? r.attachedTo) as string,
      identifier: issue?.identifier ?? '—',
      title: issue?.title ?? '(unknown issue)',
      hours: r.value,
      status,
      note: r.description ?? ''
    }
  })

  $: filter = {
    from,
    to,
    project: projectSel != null && projectSel !== '' ? projectSel : undefined,
    member: member ?? undefined,
    status: statusSel === 'all' ? undefined : (statusSel as ReportStatus)
  }
  $: sourceRows = mode === 'employees' ? empRows : detailRows
  $: rows = filterRows(sourceRows, filter)
  $: groups = groupRows(rows, groupBy)
  $: grandTotal = rows.reduce((s, r) => s + r.hours, 0)

  // --- Dropdown option lists -----------------------------------------------
  const statusItems: DropdownIntlItem[] = [
    { id: 'all', label: ygTimesheet.string.All },
    { id: 'Draft', label: ygTimesheet.string.Draft },
    { id: 'Submitted', label: ygTimesheet.string.Submitted },
    { id: 'Approved', label: ygTimesheet.string.Approved },
    { id: 'Rejected', label: ygTimesheet.string.Rejected }
  ]
  const modeItems: DropdownIntlItem[] = [
    { id: 'detail', label: ygTimesheet.string.Detail },
    { id: 'employees', label: ygTimesheet.string.Employees }
  ]
  const groupItems: DropdownIntlItem[] = [
    { id: 'project', label: ygTimesheet.string.Project },
    { id: 'member', label: ygTimesheet.string.Member },
    { id: 'day', label: ygTimesheet.string.Day },
    { id: 'week', label: ygTimesheet.string.Week },
    { id: 'month', label: ygTimesheet.string.Month },
    { id: 'detail', label: ygTimesheet.string.Detail }
  ]

  function statusString (s: ReportStatus): IntlString {
    switch (s) {
      case 'Submitted':
        return ygTimesheet.string.Submitted
      case 'Approved':
        return ygTimesheet.string.Approved
      case 'Rejected':
        return ygTimesheet.string.Rejected
      default:
        return ygTimesheet.string.Draft
    }
  }

  // --- Expand/collapse for grouped mode ------------------------------------
  let expanded: Set<string> = new Set()
  function toggle (key: string): void {
    if (expanded.has(key)) expanded.delete(key)
    else expanded.add(key)
    expanded = expanded
  }

  const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

  // Export the CURRENT filtered rows (post-filter, exactly what the table shows).
  function exportCsv (): void {
    const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'timesheet-report.csv'
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
    {#if isHRAdmin}
      <div class="rp-field">
        <span class="rp-field__label"><Label label={ygTimesheet.string.Reports} /></span>
        <DropdownLabelsIntl items={modeItems} bind:selected={modeSel} kind="regular" />
      </div>
    {/if}
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
      <DropdownLabelsIntl items={statusItems} bind:selected={statusSel} kind="regular" />
    </div>
    <div class="rp-field">
      <span class="rp-field__label"><Label label={ygTimesheet.string.GroupBy} /></span>
      <DropdownLabelsIntl items={groupItems} bind:selected={groupBySel} kind="regular" />
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
    <div class="rp-empty"><Label label={ygTimesheet.string.NoData} /></div>
  {:else if groupBy === 'detail'}
    <div class="rp-table-wrap">
      <table class="rp-table">
        <thead>
          <tr>
            <th><Label label={ygTimesheet.string.Date} /></th>
            <th><Label label={ygTimesheet.string.Employee} /></th>
            <th><Label label={ygTimesheet.string.Project} /></th>
            <th><Label label={ygTimesheet.string.Issue} /></th>
            <th class="rp-num"><Label label={ygTimesheet.string.Hours} /></th>
            <th><Label label={ygTimesheet.string.Status} /></th>
            <th><Label label={ygTimesheet.string.Description} /></th>
          </tr>
        </thead>
        <tbody>
          {#each groups[0].rows as r, i (r.issue + '|' + r.date + '|' + i)}
            <tr>
              <td>{dateFmt.format(r.date)}</td>
              <td>{r.employeeName}</td>
              <td>{r.projectName}</td>
              <td><span class="rp-id">{r.identifier}</span> {r.title}</td>
              <td class="rp-num">{formatHours(r.hours)}</td>
              <td><span class="rp-pill rp-pill--{r.status.toLowerCase()}"><Label label={statusString(r.status)} /></span></td>
              <td class="rp-note">{r.note}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="4"><b><Label label={ygTimesheet.string.TotalHours} /></b></td>
            <td class="rp-num"><b>{formatHours(grandTotal)}</b></td>
            <td colspan="2" />
          </tr>
        </tfoot>
      </table>
    </div>
  {:else}
    <div class="rp-groups">
      {#each groups as g (g.key)}
        <div class="rp-group">
          <button class="rp-group__head" on:click={() => toggle(g.key)}>
            <span class="rp-group__caret">
              {#if expanded.has(g.key)}<IconDownOutline size="small" />{:else}<IconForward size="small" />{/if}
            </span>
            <span class="rp-group__label">{g.label}</span>
            <span class="rp-group__count">{g.count} <Label label={ygTimesheet.string.Entries} /></span>
            <span class="rp-group__total">{formatHours(g.totalHours)}</span>
          </button>
          {#if expanded.has(g.key)}
            <div class="rp-table-wrap">
              <table class="rp-table rp-table--nested">
                <thead>
                  <tr>
                    <th><Label label={ygTimesheet.string.Date} /></th>
                    <th><Label label={ygTimesheet.string.Employee} /></th>
                    <th><Label label={ygTimesheet.string.Project} /></th>
                    <th><Label label={ygTimesheet.string.Issue} /></th>
                    <th class="rp-num"><Label label={ygTimesheet.string.Hours} /></th>
                    <th><Label label={ygTimesheet.string.Status} /></th>
                    <th><Label label={ygTimesheet.string.Description} /></th>
                  </tr>
                </thead>
                <tbody>
                  {#each g.rows as r, i (r.issue + '|' + r.date + '|' + i)}
                    <tr>
                      <td>{dateFmt.format(r.date)}</td>
                      <td>{r.employeeName}</td>
                      <td>{r.projectName}</td>
                      <td><span class="rp-id">{r.identifier}</span> {r.title}</td>
                      <td class="rp-num">{formatHours(r.hours)}</td>
                      <td><span class="rp-pill rp-pill--{r.status.toLowerCase()}"><Label label={statusString(r.status)} /></span></td>
                      <td class="rp-note">{r.note}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {/each}
      <div class="rp-grand">
        <span><b><Label label={ygTimesheet.string.TotalHours} /></b></span>
        <span class="rp-num"><b>{formatHours(grandTotal)}</b></span>
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
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
  .rp-empty { color: var(--theme-darker-color); padding: 2rem; text-align: center; }
  .rp-groups { padding: 1rem; overflow: auto; display: flex; flex-direction: column; gap: 0.5rem; }
  .rp-group { border: 1px solid var(--theme-divider-color); border-radius: 0.5rem; overflow: hidden; }
  .rp-group__head {
    display: flex; align-items: center; gap: 0.75rem; width: 100%;
    padding: 0.5rem 0.75rem; background: var(--theme-bg-color);
    border: none; cursor: pointer; color: var(--theme-content-color); text-align: left;
  }
  .rp-group__head:hover { background: var(--theme-button-hovered); }
  .rp-group__caret { display: inline-flex; width: 1rem; color: var(--theme-dark-color); }
  .rp-group__label { font-weight: 600; }
  .rp-group__count { color: var(--theme-dark-color); font-size: 0.8125rem; }
  .rp-group__total { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
  .rp-grand {
    display: flex; justify-content: space-between; padding: 0.5rem 0.75rem;
    border-top: 2px solid var(--theme-divider-color); margin-top: 0.25rem;
  }
  .rp-table-wrap { overflow-x: auto; padding: 1rem; }
  .rp-table--nested { padding: 0; }
  .rp-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
  .rp-table th {
    text-align: left; font-weight: 600; color: var(--theme-dark-color);
    padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--theme-divider-color); white-space: nowrap;
  }
  .rp-table td { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--theme-divider-color); vertical-align: top; }
  .rp-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rp-id { color: var(--theme-dark-color); }
  .rp-note { color: var(--theme-content-color); max-width: 24rem; }
  .rp-pill {
    font-size: 0.6875rem; font-weight: 600; padding: 0.0625rem 0.375rem; border-radius: 0.75rem;
    background: var(--theme-button-default); color: var(--theme-content-color); white-space: nowrap;
  }
  .rp-pill--submitted { background: var(--theme-warning-color); color: #fff; }
  .rp-pill--approved { background: var(--theme-won-color); color: #fff; }
  .rp-pill--rejected { background: var(--theme-lost-color); color: #fff; }
</style>
