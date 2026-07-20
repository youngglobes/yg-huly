<!--
// Copyright © 2022-2023 Hardcore Engineering Inc.
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
  import contact, { Employee, getCurrentEmployee } from '@hcengineering/contact'
  import { AttachedData, Class, DocumentUpdate, Ref, Space } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import { UserBox } from '@hcengineering/contact-resources'
  import { Issue, TimeReportDayType, TimeSpendReport, TrackerEvents } from '@hcengineering/tracker'
  import ui, { Button, DatePresenter, EditBox, Label, themeStore } from '@hcengineering/ui'
  import tracker from '../../../plugin'
  import TitlePresenter from '../TitlePresenter.svelte'
  import DurationInput from './DurationInput.svelte'
  import { endOfLocalDay, localDayOffset } from './timeEntryUtils'
  import { Analytics } from '@hcengineering/analytics'

  export let issue: Issue | undefined = undefined
  export let issueId: Ref<Issue> | undefined = issue?._id
  export let issueClass: Ref<Class<Issue>> = issue?._class ?? tracker.class.Issue
  export let space: Ref<Space> | undefined = issue?.space
  export let assignee: Ref<Employee> | null | undefined = issue?.assignee as Ref<Employee>

  export let value: TimeSpendReport | undefined
  export let placeholder: IntlString = tracker.string.TimeSpendReportValue
  // Kept for call-site compatibility. Deliberately NOT used to pre-fill the date: silently
  // defaulting to the previous work day is what caused hours to land on the wrong day.
  export let defaultTimeReportDay: TimeReportDayType = TimeReportDayType.PreviousWorkDay

  const isEdit = value !== undefined

  const data = {
    // Starts null on create. The user must choose a day before anything else is editable.
    date: value?.date ?? null,
    description: value?.description ?? '',
    value: value?.value,
    employee: value?.employee ?? getCurrentEmployee() ?? assignee ?? null
  }

  export function canClose (): boolean {
    return true
  }

  const client = getClient()

  function setDay (offset: number): void {
    data.date = localDayOffset(offset)
  }

  function formatChosenDay (ts: number, language: string): string {
    return new Date(ts).toLocaleDateString(language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  interface DurationPreset {
    value: number
    label: number
    unit: IntlString
  }

  const durationPresets: DurationPreset[] = [
    { value: 0.25, label: 15, unit: tracker.string.MinuteLabel },
    { value: 0.5, label: 30, unit: tracker.string.MinuteLabel },
    { value: 0.75, label: 45, unit: tracker.string.MinuteLabel },
    { value: 1, label: 1, unit: tracker.string.HourLabel },
    { value: 2, label: 2, unit: tracker.string.HourLabel },
    { value: 4, label: 4, unit: tracker.string.HourLabel },
    { value: 6, label: 6, unit: tracker.string.HourLabel },
    { value: 8, label: 8, unit: tracker.string.HourLabel }
  ]

  async function create (): Promise<void> {
    if (value === undefined) {
      if (space && issueId) {
        await client.addCollection(
          tracker.class.TimeSpendReport,
          space,
          issueId,
          issueClass,
          'reports',
          data as AttachedData<TimeSpendReport>
        )
        Analytics.handleEvent(TrackerEvents.IssueTimeSpentAdded, { issue: issue?.identifier ?? issueId })
      }
    } else {
      const ops: DocumentUpdate<TimeSpendReport> = {}
      if (value.value !== data.value) {
        ops.value = data.value
      }
      if (value.employee !== data.employee) {
        ops.employee = data.employee
      }
      if (value.description !== data.description) {
        ops.description = data.description
      }
      if (value.date !== data.date) {
        ops.date = data.date
      }
      if (Object.keys(ops).length > 0) {
        await client.update(value, ops)
        Analytics.handleEvent(TrackerEvents.IssueTimeSpentUpdated, { issue: issue?.identifier ?? issueId })
      }
    }
  }

  $: dateChosen = data.date != null
  $: dateInFuture = data.date != null && data.date > endOfLocalDay()
  // Editing an existing report needs no gate: it already has a date.
  $: fieldsEnabled = isEdit || dateChosen
  $: canSave =
    dateChosen &&
    !dateInFuture &&
    Number.isFinite(data.value) &&
    data.value !== 0 &&
    space !== undefined &&
    issueId !== undefined
</script>

<Card
  label={value === undefined ? tracker.string.TimeSpendReportAdd : tracker.string.TimeSpendReportValue}
  {canSave}
  okAction={create}
  gap={'gapV-4'}
  on:close
  okLabel={value === undefined ? presentation.string.Create : presentation.string.Save}
  on:changeContent
>
  <svelte:fragment slot="header">
    {#if issue}
      <TitlePresenter showParent={false} value={issue} />
    {/if}
  </svelte:fragment>

  <!-- 1. Date. Promoted out of the footer pool: it is logically first, so it is visually first. -->
  <div class="field">
    <div class="field-label"><Label label={tracker.string.TimeSpendReportDate} /><span class="required">*</span></div>
    <div class="flex-row-center gap-2">
      <Button
        kind={'link-bordered'}
        on:click={() => {
          setDay(0)
        }}
      >
        <span slot="content"><Label label={ui.string.Today} /></span>
      </Button>
      <Button
        kind={'link-bordered'}
        on:click={() => {
          setDay(-1)
        }}
      >
        <span slot="content"><Label label={ui.string.Yesterday} /></span>
      </Button>
      <DatePresenter
        bind:value={data.date}
        editable
        kind={'regular'}
        size={'large'}
        labelNull={tracker.string.PickADate}
      />
    </div>
    {#if data.date != null}
      <div class="field-chosen-day">{formatChosenDay(data.date, $themeStore.language)}</div>
    {/if}
    {#if dateInFuture}
      <div class="field-error"><Label label={tracker.string.FutureDateNotAllowed} /></div>
    {:else if !dateChosen}
      <div class="field-hint"><Label label={tracker.string.SelectDateFirst} /></div>
    {/if}
  </div>

  <!-- 2. Hours. Disabled until a date is chosen. -->
  <div class="field" class:gated={!fieldsEnabled}>
    <div class="field-label"><Label label={placeholder} /><span class="required">*</span></div>
    <DurationInput bind:value={data.value} disabled={!fieldsEnabled} />
    <div class="flex-row-center gap-2 presets">
      {#each durationPresets as preset}
        <Button kind={'link-bordered'} disabled={!fieldsEnabled} on:click={() => (data.value = preset.value)}>
          <span slot="content">{preset.label}<Label label={preset.unit} /></span>
        </Button>
      {/each}
    </div>
  </div>

  <!-- 3. Description. Disabled until a date is chosen. -->
  <div class="field" class:gated={!fieldsEnabled}>
    <div class="field-label"><Label label={tracker.string.TimeSpendReportDescription} /></div>
    <!--
      Multi-line: a single-line box made it impossible to write a real note. Stays plain text
      (TimeSpendReport.description is a `string`), so the reports table keeps rendering it
      correctly rather than showing raw markup.
    -->
    <div class="description-box" class:disabled={!fieldsEnabled}>
      <EditBox
        bind:value={data.description}
        placeholder={tracker.string.TimeSpendReportDescription}
        format={'text-multiline'}
        kind={'editbox'}
        fullSize
        disabled={!fieldsEnabled}
      />
    </div>
  </div>

  <svelte:fragment slot="pool">
    <UserBox
      _class={contact.mixin.Employee}
      label={contact.string.Employee}
      kind={'regular'}
      size={'large'}
      bind:value={data.employee}
      showNavigate={false}
    />
  </svelte:fragment>
</Card>

<style lang="scss">
  .field + .field {
    margin-top: 1rem;
  }
  .field-label {
    margin-bottom: 0.5rem;
    color: var(--theme-dark-color);
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .required {
    margin-left: 0.125rem;
    color: var(--theme-warning-color);
  }
  .presets {
    margin-top: 0.5rem;
    flex-wrap: wrap;
  }
  .description-box {
    padding: 0.375rem 0.5rem;
    min-height: 5rem;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.375rem;
    background-color: var(--theme-button-default);

    &:focus-within {
      border-color: var(--primary-edit-border-color);
    }
    &.disabled {
      opacity: 0.4;
    }
  }
  .gated {
    opacity: 0.5;
    pointer-events: none;
  }
  .field-hint,
  .field-error,
  .field-chosen-day {
    margin-top: 0.375rem;
    font-size: 0.75rem;
  }
  .field-hint {
    color: var(--theme-dark-color);
  }
  .field-error {
    color: var(--theme-error-color);
  }
  .field-chosen-day {
    color: var(--theme-caption-color);
    font-weight: 500;
  }
</style>
