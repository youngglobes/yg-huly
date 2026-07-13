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
  import { getCurrentEmployee } from '@hcengineering/contact'
  import { type Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import tracker, { type Issue, type TimeSpendReport } from '@hcengineering/tracker'
  import { Label, Button, IconForward, IconBack } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { weekRange, groupByDay, formatHours, type ReportLike, type DayGroup } from '../utils/week'

  const me = getCurrentEmployee()
  let anchor = Date.now()
  $: week = weekRange(anchor)

  const query = createQuery()
  let days: DayGroup[] = []
  let weekTotal = 0

  $: query.query(
    tracker.class.TimeSpendReport,
    { employee: me, date: { $gte: week.start, $lt: week.end } },
    (res: TimeSpendReport[]) => {
      const reports: ReportLike[] = res.map((r) => {
        const issue = r.$lookup?.attachedTo as Issue | undefined
        return {
          employee: r.employee as Ref<any> | null,
          date: r.date,
          value: r.value,
          issueId: (issue?._id ?? r.attachedTo) as string,
          issueIdentifier: issue?.identifier ?? '—',
          issueTitle: issue?.title ?? '(unknown issue)',
          project: (issue?.space ?? '') as string
        }
      })
      const g = groupByDay(reports, week)
      days = g.days
      weekTotal = g.weekTotal
    },
    { lookup: { attachedTo: tracker.class.Issue } }
  )

  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  function shift (deltaWeeks: number): void { anchor = anchor + deltaWeeks * 7 * 86400_000 }
</script>

<div class="ac-header full divide">
  <div class="ac-header__wrap-title">
    <span class="ac-header__title"><Label label={ygTimesheet.string.Timesheet} /></span>
  </div>
  <div class="ac-header-full">
    <Button icon={IconBack} kind="ghost" on:click={() => shift(-1)} />
    <span class="p-2">{weekdayFmt.format(week.start)} — {weekdayFmt.format(week.end - 86400_000)}</span>
    <Button icon={IconForward} kind="ghost" on:click={() => shift(1)} />
    <Button kind="ghost" label={ygTimesheet.string.Today} on:click={() => (anchor = Date.now())} />
    <div class="ml-4"><Label label={ygTimesheet.string.Total} />: <b>{formatHours(weekTotal)}</b></div>
  </div>
</div>

<div class="ts-grid">
  {#each days as day (day.key)}
    <div class="ts-day">
      <div class="ts-day__head">
        <span>{weekdayFmt.format(day.date)}</span>
        <span class="ts-day__total">{formatHours(day.total)}</span>
      </div>
      {#if day.issues.length === 0}
        <div class="ts-empty">—</div>
      {:else}
        {#each day.issues as it (it.issueId)}
          <div class="ts-line">
            <span class="ts-line__id">{it.identifier}</span>
            <span class="ts-line__title">{it.title}</span>
            <span class="ts-line__hrs">{formatHours(it.hours)}</span>
          </div>
        {/each}
      {/if}
    </div>
  {/each}
</div>

<style lang="scss">
  .ts-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; padding: 1rem; overflow: auto; }
  .ts-day { border: 1px solid var(--theme-divider-color); border-radius: 0.5rem; padding: 0.5rem; min-height: 6rem; }
  .ts-day__head { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 0.5rem; }
  .ts-day__total { color: var(--theme-content-color); }
  .ts-line { display: flex; gap: 0.25rem; font-size: 0.75rem; padding: 0.125rem 0; }
  .ts-line__id { color: var(--theme-dark-color); }
  .ts-line__title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ts-line__hrs { font-variant-numeric: tabular-nums; }
  .ts-empty { color: var(--theme-darker-color); text-align: center; }
</style>
