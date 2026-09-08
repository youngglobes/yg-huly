// YoungGlobes: route-level access predicates for the app gate (Workbench.svelte's `accessCheck`),
// plus the AI Usage icon-hide component's own check (AiUsageGuard.svelte). Each is a one-shot
// query, not a live subscription - the gate runs once per app-resolution, not continuously.
import core, { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import ygTimesheet from '@hcengineering/yg-timesheet'
import { usageGet } from './ai-usage-api'

// HR module route gate: Owner/Maintainer/Admin, OR a member of the private HR team space
// (ygTimesheet.space.HrData). The exact rule already used as the edit gate in
// EmployeeDirectory.svelte / EmployeeProfile.svelte / HrLists.svelte, and as the icon-hide
// membership check in server-plugins/yg-timesheet-resources's OnHrMembershipChange - kept in sync
// deliberately, so the icon and the route can never disagree about who counts as HR.
export async function checkHrAppAccess (): Promise<boolean> {
  const acct = getCurrentAccount()
  if (hasAccountRole(acct, AccountRole.Maintainer)) return true
  const client = getClient()
  const hrSpace = await client.findOne(core.class.Space, { _id: ygTimesheet.space.HrData })
  return hrSpace !== undefined && hrSpace.members.includes(acct.uuid)
}

// Briefly cache the sidecar verdict so navigating between the AI Usage app's own specials (or a
// remount of the icon-hide guard) does not fire a network call on every navigation. Per-session
// only, no persistence - a stale "denied" clears itself within the window, never sooner than a
// fresh page load.
const AI_USAGE_ACCESS_CACHE_MS = 60000
let aiUsageAccessCache: { value: boolean, at: number } | undefined

// AI Usage route gate + icon-hide check: Owner/Maintainer/Admin, OR the usage-sidecar's viewer
// allowlist says the current account may read the dashboard. Reuses the same light `/report` call
// AiUsage.svelte itself makes, so this predicate can never disagree with what the page would
// actually show once opened.
//
// Fails CLOSED: any error from the sidecar call (a 401 for someone not on the allowlist, a network
// failure, or the account service being down) is treated as "not allowed" for a non-admin. Only
// the Maintainer+ short-circuit above bypasses the sidecar entirely.
export async function checkAiUsageAccess (): Promise<boolean> {
  if (hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)) return true

  const now = Date.now()
  if (aiUsageAccessCache !== undefined && now - aiUsageAccessCache.at < AI_USAGE_ACCESS_CACHE_MS) {
    return aiUsageAccessCache.value
  }

  let allowed = false
  try {
    await usageGet('/report?days=1')
    allowed = true
  } catch {
    allowed = false
  }
  aiUsageAccessCache = { value: allowed, at: now }
  return allowed
}
