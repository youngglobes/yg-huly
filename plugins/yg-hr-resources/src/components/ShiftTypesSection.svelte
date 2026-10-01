<!--
// YG Portal: shift types, configured in HR Settings. "Day starts at" decides which work day a
// punch-in counts on (yg-timesheet istWorkDayStart). Rendered inside HrLists only for HR / admins;
// the server guard (yg-hr-resources HR config guard) enforces the same rule.
-->
<script lang="ts">
  import core, { type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet, { dayStartInsideHours, type ShiftType, type WorkProfile } from '@hcengineering/yg-timesheet'

  const client = getClient()
  let types: ShiftType[] = []
  let profiles: WorkProfile[] = []
  createQuery().query(
    ygTimesheet.class.ShiftType,
    {},
    (res) => {
      types = res
    },
    { sort: { name: 1 } }
  )
  createQuery().query(ygTimesheet.mixin.WorkProfile, {}, (res) => {
    profiles = res
  })

  $: assigned = (id: Ref<ShiftType>): WorkProfile[] => profiles.filter((p) => p.shiftType === id)

  const toTime = (m: number | undefined): string =>
    m === undefined || m === null
      ? ''
      : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const toMin = (s: string): number | undefined => {
    const m = /^(\d{2}):(\d{2})$/.exec(s)
    return m === null ? undefined : Number(m[1]) * 60 + Number(m[2])
  }
  const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

  async function save (t: ShiftType, patch: Partial<ShiftType>): Promise<void> {
    await client.updateDoc(ygTimesheet.class.ShiftType, core.space.Workspace, t._id, patch)
  }

  // Clearing a usual-hours input must unset the field: an undefined patch value is dropped by JSON.
  async function setHours (t: ShiftType, field: 'hoursFromMin' | 'hoursToMin', value: string): Promise<void> {
    const m = toMin(value)
    if (m === undefined) {
      await client.updateDoc(ygTimesheet.class.ShiftType, core.space.Workspace, t._id, { $unset: { [field]: '' } })
    } else {
      await save(t, { [field]: m })
    }
  }

  // Names are unique (case-insensitive): a rename to an empty or existing name is refused and reset.
  async function rename (t: ShiftType, input: HTMLInputElement): Promise<void> {
    const name = input.value.trim()
    if (name === '' || types.some((o) => o._id !== t._id && sameName(o.name, name))) {
      input.value = t.name
      return
    }
    await save(t, { name })
  }

  // New-type row. Placeholders show a worked example (US West). Errors appear only after an Add
  // attempt, then update live as the fields are corrected.
  let nName = ''
  let nDescription = ''
  let nDayStart = ''
  let nFrom = ''
  let nTo = ''
  let tried = false
  let added = false
  $: nameError =
    nName.trim() === ''
      ? ygTimesheet.string.ShiftNameRequired
      : types.some((t) => sameName(t.name, nName))
        ? ygTimesheet.string.ShiftNameTaken
        : undefined
  $: dayStartError = toMin(nDayStart) === undefined ? ygTimesheet.string.ShiftDayStartRequired : undefined
  $: newInsideHours =
    toMin(nDayStart) !== undefined && dayStartInsideHours(toMin(nDayStart) as number, toMin(nFrom), toMin(nTo))

  async function add (): Promise<void> {
    tried = true
    added = false
    if (nameError !== undefined || dayStartError !== undefined) return
    await client.createDoc(ygTimesheet.class.ShiftType, core.space.Workspace, {
      name: nName.trim(),
      description: nDescription.trim(),
      dayStartMin: toMin(nDayStart) as number,
      hoursFromMin: toMin(nFrom),
      hoursToMin: toMin(nTo)
    })
    nName = nDescription = nDayStart = nFrom = nTo = ''
    tried = false
    added = true
  }
</script>

<div class="st">
  <div class="st__help">
    <p><Label label={ygTimesheet.string.ShiftHelp} /></p>
    <p><Label label={ygTimesheet.string.ShiftHelpExample} /></p>
    <p class="st__muted"><Label label={ygTimesheet.string.DayStartAppliesToNew} /></p>
  </div>

  <div class="st__scroll">
    <table class="st__table">
      <thead>
        <tr>
          <th><Label label={ygTimesheet.string.ShiftName} /></th>
          <th><Label label={ygTimesheet.string.ShiftDescription} /></th>
          <th><Label label={ygTimesheet.string.DayStartsAt} /></th>
          <th><Label label={ygTimesheet.string.UsualHours} /></th>
          <th><Label label={ygTimesheet.string.AssignedEmployees} /></th>
          <th><Label label={ygTimesheet.string.Archived} /></th>
        </tr>
      </thead>
      <tbody>
        {#each types as t (t._id)}
          <tr class:st__archived={t.archived === true}>
            <td><input class="st__input" value={t.name} on:change={(e) => void rename(t, e.currentTarget)} /></td>
            <td>
              <textarea
                class="st__input"
                rows="2"
                value={t.description}
                on:change={(e) => void save(t, { description: e.currentTarget.value.trim() })}
              />
            </td>
            <td>
              <input
                class="st__input"
                type="time"
                value={toTime(t.dayStartMin)}
                on:change={(e) => {
                  const m = toMin(e.currentTarget.value)
                  if (m !== undefined) void save(t, { dayStartMin: m })
                }}
              />
              {#if dayStartInsideHours(t.dayStartMin, t.hoursFromMin, t.hoursToMin)}
                <div class="st__warn"><Label label={ygTimesheet.string.DayStartInsideHours} /></div>
              {/if}
            </td>
            <td>
              <div class="st__hours">
                <input
                  class="st__input"
                  type="time"
                  value={toTime(t.hoursFromMin)}
                  on:change={(e) => void setHours(t, 'hoursFromMin', e.currentTarget.value)}
                />
                <input
                  class="st__input"
                  type="time"
                  value={toTime(t.hoursToMin)}
                  on:change={(e) => void setHours(t, 'hoursToMin', e.currentTarget.value)}
                />
              </div>
            </td>
            <td class="st__count">{assigned(t._id).length}</td>
            <td>
              <input
                type="checkbox"
                checked={t.archived === true}
                on:change={(e) => void save(t, { archived: e.currentTarget.checked })}
              />
              {#if t.archived === true && assigned(t._id).length > 0}
                <div class="st__warn">
                  <Label label={ygTimesheet.string.ShiftArchivedHasEmployees} />
                  {assigned(t._id)
                    .map((p) => p.name)
                    .join(', ')}
                </div>
              {/if}
            </td>
          </tr>
        {/each}
        <tr class="st__new">
          <td>
            <input class="st__input" placeholder="US West" bind:value={nName} on:input={() => (added = false)} />
            {#if tried && nameError !== undefined}
              <div class="st__error"><Label label={nameError} /></div>
            {/if}
          </td>
          <td>
            <textarea
              class="st__input"
              rows="2"
              placeholder="US Pacific hours worked from India. Sessions after midnight (until 10:00) count on the day the shift started."
              bind:value={nDescription}
            />
          </td>
          <td>
            <input class="st__input" type="time" bind:value={nDayStart} />
            {#if tried && dayStartError !== undefined}
              <div class="st__error"><Label label={dayStartError} /></div>
            {:else if newInsideHours}
              <div class="st__warn"><Label label={ygTimesheet.string.DayStartInsideHours} /></div>
            {/if}
          </td>
          <td>
            <div class="st__hours">
              <input class="st__input" type="time" bind:value={nFrom} />
              <input class="st__input" type="time" bind:value={nTo} />
            </div>
          </td>
          <td />
          <td>
            <button class="st__btn" on:click={() => void add()}>
              <Label label={ygTimesheet.string.AddShiftType} />
            </button>
            {#if added}
              <div class="st__ok"><Label label={ygTimesheet.string.ShiftAdded} /></div>
            {/if}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

<style lang="scss">
  .st {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .st__help {
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    font-size: 13px;
    color: var(--theme-content-color);
  }
  .st__help p {
    margin: 0 0 6px;
  }
  .st__help p:last-child {
    margin-bottom: 0;
  }
  .st__muted {
    color: var(--theme-dark-color);
  }
  .st__scroll {
    overflow-x: auto;
  }
  .st__table {
    width: 100%;
    border-collapse: collapse;
  }
  .st__table th,
  .st__table td {
    padding: 8px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .st__table th {
    color: var(--theme-dark-color);
    font-size: 12px;
    font-weight: 600;
  }
  .st__input {
    width: 100%;
    min-width: 0;
    font: inherit;
    font-size: 14px;
    color: var(--theme-content-color);
    background: transparent;
    border: 1px solid var(--theme-divider-color);
    border-radius: 8px;
    padding: 6px 9px;
    box-sizing: border-box;
  }
  .st__hours {
    display: flex;
    gap: 6px;
  }
  .st__count {
    color: var(--theme-content-color);
  }
  .st__archived {
    opacity: 0.6;
  }
  .st__warn,
  .st__error,
  .st__ok {
    margin-top: 4px;
    font-size: 12px;
  }
  .st__warn {
    color: var(--theme-warning-color, #b45309);
  }
  .st__error {
    color: var(--theme-error-color, #d33);
  }
  .st__ok {
    color: var(--theme-won-color, #2f9e44);
  }
  .st__btn {
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    color: var(--theme-caption-color);
    background: var(--theme-button-default, transparent);
    border: 1px solid var(--yg-accent, var(--theme-divider-color));
    border-radius: 8px;
    padding: 7px 12px;
    cursor: pointer;
  }
</style>
