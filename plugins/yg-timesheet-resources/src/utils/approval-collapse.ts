//
// YoungGlobes: per-person collapse state for the Approvals page. Smart default: a person's group
// opens when any of their pending tasks names the viewer as an approver (their PM/TL), and folds
// otherwise, so an approver lands on their own team with everyone else tucked away. Manual toggles
// are stored per browser as explicit overrides; a person with no override keeps following the
// default, so a change in team assignment shows up without clearing anything.
//
export type OpenOverrides = Record<string, boolean>

/** True when the viewer is an approver on at least one of the group's pending tasks. */
export function isMyTeamGroup (tasks: ReadonlyArray<{ approvers?: readonly string[] }>, me: string): boolean {
  return tasks.some((t) => (t.approvers ?? []).includes(me))
}

/** Explicit override wins; otherwise the smart default. */
export function groupOpen (key: string, overrides: OpenOverrides, smartDefault: boolean): boolean {
  const o = overrides[key]
  return o === undefined ? smartDefault : o
}

/** Parse the stored overrides; anything malformed yields an empty set rather than a crash. */
export function parseOverrides (raw: string | null | undefined): OpenOverrides {
  if (raw == null || raw === '') return {}
  try {
    const v: unknown = JSON.parse(raw)
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: OpenOverrides = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'boolean') out[k] = val
    }
    return out
  } catch {
    return {}
  }
}
