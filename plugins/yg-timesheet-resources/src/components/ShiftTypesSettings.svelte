<!--
// YG Portal: HR-configurable shift types. "Day starts at" decides which work day a punch-in counts on.
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
    m === undefined ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const toMin = (s: string): number | undefined => {
    const m = /^(\d{2}):(\d{2})$/.exec(s)
    return m === null ? undefined : Number(m[1]) * 60 + Number(m[2])
  }

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

  // Names are unique (case-insensitive): a rename to an existing name is refused and the field reset.
  async function rename (t: ShiftType, input: HTMLInputElement): Promise<void> {
    const name = input.value.trim()
    const clash = types.some((o) => o._id !== t._id && o.name.trim().toLowerCase() === name.toLowerCase())
    if (name === '' || clash) {
      input.value = t.name
      return
    }
    await save(t, { name })
  }

  // New-type form. Placeholders show a worked example (US West).
  let nName = ''
  let nDescription = ''
  let nDayStart = ''
  let nFrom = ''
  let nTo = ''
  $: nameTaken = types.some((t) => t.name.trim().toLowerCase() === nName.trim().toLowerCase())
  $: canAdd = nName.trim() !== '' && !nameTaken && toMin(nDayStart) !== undefined
  async function add (): Promise<void> {
    if (!canAdd) return
    await client.createDoc(ygTimesheet.class.ShiftType, core.space.Workspace, {
      name: nName.trim(),
      description: nDescription.trim(),
      dayStartMin: toMin(nDayStart) as number,
      hoursFromMin: toMin(nFrom),
      hoursToMin: toMin(nTo)
    })
    nName = nDescription = nDayStart = nFrom = nTo = ''
  }
</script>

<div class="yg-page">
  <div class="yg-head"><h1 class="yg-title"><Label label={ygTimesheet.string.Shifts} /></h1></div>
  <div class="yg-shifts">
    <div class="yg-shifts__help">
      <p><Label label={ygTimesheet.string.ShiftHelp} /></p>
      <p><Label label={ygTimesheet.string.ShiftHelpExample} /></p>
      <p class="yg-shifts__muted"><Label label={ygTimesheet.string.DayStartAppliesToNew} /></p>
    </div>

    <table class="yg-shifts__table">
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
          <tr class:yg-shifts__archived={t.archived === true}>
            <td><input class="yg-input" value={t.name} on:change={(e) => void rename(t, e.currentTarget)} /></td>
            <td>
              <textarea
                class="yg-input"
                rows="2"
                value={t.description}
                on:change={(e) => void save(t, { description: e.currentTarget.value.trim() })}
              />
            </td>
            <td>
              <input
                class="yg-input"
                type="time"
                value={toTime(t.dayStartMin)}
                on:change={(e) => {
                  const m = toMin(e.currentTarget.value)
                  if (m !== undefined) void save(t, { dayStartMin: m })
                }}
              />
              {#if dayStartInsideHours(t.dayStartMin, t.hoursFromMin, t.hoursToMin)}
                <div class="yg-shifts__warn"><Label label={ygTimesheet.string.DayStartInsideHours} /></div>
              {/if}
            </td>
            <td>
              <input
                class="yg-input"
                type="time"
                value={toTime(t.hoursFromMin)}
                on:change={(e) => void setHours(t, 'hoursFromMin', e.currentTarget.value)}
              />
              <input
                class="yg-input"
                type="time"
                value={toTime(t.hoursToMin)}
                on:change={(e) => void setHours(t, 'hoursToMin', e.currentTarget.value)}
              />
            </td>
            <td>{assigned(t._id).length}</td>
            <td>
              <input
                type="checkbox"
                checked={t.archived === true}
                on:change={(e) => void save(t, { archived: e.currentTarget.checked })}
              />
              {#if t.archived === true && assigned(t._id).length > 0}
                <div class="yg-shifts__warn">
                  <Label label={ygTimesheet.string.ShiftArchivedHasEmployees} />
                  {assigned(t._id)
                    .map((p) => p.name)
                    .join(', ')}
                </div>
              {/if}
            </td>
          </tr>
        {/each}
        <tr class="yg-shifts__new">
          <td><input class="yg-input" placeholder="US West" bind:value={nName} /></td>
          <td>
            <textarea
              class="yg-input"
              rows="2"
              placeholder="US Pacific hours worked from India. Sessions after midnight (until 10:00) count on the day the shift started."
              bind:value={nDescription}
            />
          </td>
          <td><input class="yg-input" type="time" bind:value={nDayStart} /></td>
          <td>
            <input class="yg-input" type="time" bind:value={nFrom} />
            <input class="yg-input" type="time" bind:value={nTo} />
          </td>
          <td />
          <td>
            <button class="yg-btn yg-btn--primary" disabled={!canAdd} on:click={() => void add()}>
              <Label label={ygTimesheet.string.AddShiftType} />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;
  .yg-shifts {
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .yg-shifts__help {
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: var(--yg-panel-soft);
    border: 1px solid var(--yg-border);
    font-size: 13px;
  }
  .yg-shifts__help p {
    margin: 0 0 0.5rem;
  }
  .yg-shifts__help p:last-child {
    margin-bottom: 0;
  }
  .yg-shifts__muted {
    color: var(--yg-text-dim);
  }
  .yg-shifts__table {
    width: 100%;
    border-collapse: collapse;
  }
  .yg-shifts__table th,
  .yg-shifts__table td {
    padding: 0.5rem;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--yg-border);
  }
  .yg-shifts__table th {
    color: var(--yg-text-dim);
    font-size: 12px;
    font-weight: 600;
  }
  .yg-shifts__archived {
    opacity: 0.6;
  }
  .yg-shifts__warn {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--yg-amber);
  }
</style>
