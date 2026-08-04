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
  HR/Owner editor for the ygTimesheet.mixin.WorkProfile mixin: sets each active employee's
  category and expected shift-start time. One row per employee, plain <select> + <input
  type="time">, written straight to the mixin on change (no separate save step). Category
  option labels are resolved via translate() (not <Label>, which cannot render inside an
  <option>) and re-resolved whenever the UI language changes.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import { type MixinData } from '@hcengineering/core'
  import { translate, type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label, themeStore } from '@hcengineering/ui'
  import ygTimesheet, { type WorkProfile, type WorkProfileCategory } from '@hcengineering/yg-timesheet'
  import { ensureHrMembership } from '../utils/hrMembership'
  import { CATEGORY_ORDER, hhmmToMinutes, minutesToHHMM } from '../utils/work-profile'

  onMount(() => { void ensureHrMembership() })

  const client = getClient()
  const h = client.getHierarchy()

  const empQuery = createQuery()
  let empDocs: Employee[] = []
  empQuery.query(contact.mixin.Employee, { active: true }, (res: Employee[]) => { empDocs = res })
  $: employees = [...empDocs].sort((a, b) => formatName(a.name).localeCompare(formatName(b.name)))

  const mixinOf = (emp: Employee): WorkProfile | undefined =>
    h.hasMixin(emp, ygTimesheet.mixin.WorkProfile) ? h.as(emp, ygTimesheet.mixin.WorkProfile) : undefined

  // Category option labels: <Label> can't render inside a native <option>, so labels are
  // pre-resolved to plain strings via translate() and refreshed whenever the language changes.
  const CAT_STRING: Record<WorkProfileCategory, IntlString> = {
    'junior-dev': ygTimesheet.string.CatJuniorDev,
    'senior-dev': ygTimesheet.string.CatSeniorDev,
    sales: ygTimesheet.string.CatSales,
    salesforce: ygTimesheet.string.CatSalesforce,
    other: ygTimesheet.string.CatOther
  }
  let catLabels: Partial<Record<WorkProfileCategory, string>> = {}
  async function loadCatLabels (lang: string): Promise<void> {
    const entries = await Promise.all(
      CATEGORY_ORDER.map(async (cat) => [cat, await translate(CAT_STRING[cat], {}, lang)] as const)
    )
    catLabels = Object.fromEntries(entries)
  }
  $: void loadCatLabels($themeStore.language)

  async function save (emp: Employee, upd: Partial<Pick<WorkProfile, 'category' | 'shiftStart'>>): Promise<void> {
    if (h.hasMixin(emp, ygTimesheet.mixin.WorkProfile)) {
      await client.updateMixin(emp._id, contact.mixin.Employee, emp.space, ygTimesheet.mixin.WorkProfile, upd)
    } else {
      // A fresh mixin requires `category` (it is mandatory on WorkProfile); a bare shift-start
      // edit on an employee with no category yet still creates the mixin, deferring the
      // required-field cast to here the same way core's own migrate-mixin path does
      // (operations.ts casts a partial payload to MixinData when it knows the value is safe).
      await client.createMixin(
        emp._id,
        contact.mixin.Employee,
        emp.space,
        ygTimesheet.mixin.WorkProfile,
        upd as MixinData<Employee, WorkProfile>
      )
    }
  }

  function onCategoryChange (emp: Employee, value: string): void {
    if (value === '') return
    void save(emp, { category: value as WorkProfileCategory })
  }

  function onShiftStartChange (emp: Employee, value: string): void {
    void save(emp, { shiftStart: value === '' ? undefined : hhmmToMinutes(value) })
  }
</script>

<div class="dash yg-page">
  <div class="yg-head">
    <h1 class="yg-title"><Label label={ygTimesheet.string.TeamProfiles} /></h1>
    <p class="wp-note">PMs are detected automatically and do not need a category.</p>
  </div>
  <div class="yg-scroll">
    <table class="yg-table">
      <thead>
        <tr>
          <th class="left"><Label label={contact.string.Employee} /></th>
          <th class="left"><Label label={ygTimesheet.string.WorkProfileCategoryLabel} /></th>
          <th class="left"><Label label={ygTimesheet.string.ShiftStart} /></th>
        </tr>
      </thead>
      <tbody>
        {#each employees as emp (emp._id)}
          {@const mixin = mixinOf(emp)}
          <tr>
            <td class="left bold">{formatName(emp.name)}</td>
            <td class="left">
              <select
                class="yg-input"
                value={mixin?.category ?? ''}
                on:change={(e) => onCategoryChange(emp, e.currentTarget.value)}
              >
                <option value="">-</option>
                {#each CATEGORY_ORDER as cat (cat)}
                  <option value={cat}>{catLabels[cat] ?? cat}</option>
                {/each}
              </select>
            </td>
            <td class="left">
              <input
                class="yg-input"
                type="time"
                value={mixin?.shiftStart != null ? minutesToHHMM(mixin.shiftStart) : ''}
                on:change={(e) => onShiftStartChange(emp, e.currentTarget.value)}
              />
            </td>
          </tr>
        {:else}
          <tr><td colspan={3} class="yg-empty">No active employees.</td></tr>
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
  .wp-note {
    margin: 0 0 18px;
    font-size: 13px;
    color: var(--yg-text-dim);
  }
</style>
