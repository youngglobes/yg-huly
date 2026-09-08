//
// YoungGlobes: shared helpers for the modern tabbed employee profile (Task 10).
//
import contact, { type Employee } from '@hcengineering/contact'
import type { Hierarchy, Mixin, MixinData, MixinUpdate, Ref, Timestamp, TxOperations } from '@hcengineering/core'

// Every field on EmployeePersonal/EmployeeContact/EmployeeJob is optional, so a partial payload is
// always a valid fresh mixin - same idiom as WorkProfileEditor.svelte's `save`. Centralized here so
// PersonalTab/ContactTab/JobTab don't each re-derive the create-vs-update branch.
export async function saveEmployeeMixin<M extends Employee> (
  client: TxOperations,
  h: Hierarchy,
  employee: Employee,
  mixinId: Ref<Mixin<M>>,
  upd: Partial<M>
): Promise<void> {
  if (h.hasMixin(employee, mixinId)) {
    await client.updateMixin(employee._id, contact.mixin.Employee, employee.space, mixinId, upd as MixinUpdate<Employee, M>)
  } else {
    await client.createMixin(employee._id, contact.mixin.Employee, employee.space, mixinId, upd as MixinData<Employee, M>)
  }
}

// "02 May 2019" - matches the approved mockup's date formatting exactly.
const displayDateFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export function formatDisplayDate (ts?: Timestamp): string | undefined {
  if (ts == null) return undefined
  return displayDateFormat.format(new Date(ts))
}

// yyyy-mm-dd for binding to <input type="date">.
export function dateToInput (ts?: Timestamp): string {
  if (ts == null) return ''
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function inputToDate (value: string): Timestamp | undefined {
  if (value === '') return undefined
  const d = new Date(`${value}T00:00:00`)
  return isNaN(d.getTime()) ? undefined : d.getTime()
}

export function capitalize (value?: string): string | undefined {
  if (value == null || value === '') return undefined
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function initialsOf (name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

// Deterministic accent-family color per name, for the plain (non-Person) Emergency-contact avatars
// that can't use the platform's AvatarInfo-based Avatar component.
const AVATAR_HUES = [210, 172, 26, 262, 344, 190, 84, 280]

export function colorOf (seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length]
  return `hsl(${hue}, 55%, 42%)`
}
