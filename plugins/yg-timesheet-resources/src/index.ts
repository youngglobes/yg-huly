import { type Resources } from '@hcengineering/platform'
import { AccountRole, getCurrentAccount, hasAccountRole, type Space } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import { getCurrentEmployee } from '@hcengineering/contact'
import tracker from '@hcengineering/tracker'
import type { Location, ResolvedLocation } from '@hcengineering/ui'
import ygTimesheet, { ygTimesheetId, type ProjectApprovers } from '@hcengineering/yg-timesheet'
import { canApproveView } from './utils/task-approval'
import Timesheet from './components/Timesheet.svelte'
import ProjectApproversList from './components/ProjectApproversList.svelte'
import Approvals from './components/Approvals.svelte'
import Reports from './components/Reports.svelte'
import HrTimesheet from './components/HrTimesheet.svelte'
import HrRoster from './components/HrRoster.svelte'
import HrOverview from './components/HrOverview.svelte'
import HrExportDialog from './components/HrExportDialog.svelte'
import ApproveTaskPopup from './components/ApproveTaskPopup.svelte'
import RejectTaskPopup from './components/RejectTaskPopup.svelte'
import NotificationRedirect from './components/NotificationRedirect.svelte'
import Dashboard from './components/Dashboard.svelte'

async function CanApprove (_spaces: Space[]): Promise<boolean> {
  const isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)
  if (isAdmin) return true
  const me = getCurrentEmployee()
  const client = getClient()
  const h = client.getHierarchy()
  const projects = await client.findAll(tracker.class.Project, {})
  const pairs = projects
    .filter((p) => h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers))
    .map((p) => {
      const a: ProjectApprovers = h.as(p, ygTimesheet.mixin.ProjectApprovers)
      return { pm: a.pm, teamLead: a.teamLead }
    })
  return canApproveView(isAdmin, pairs, me)
}

// App root has no special selected (loc.path[3] == null): default it based on role so a first
// visit doesn't land on the blank Application shell. Workbench only restores the last-visited
// special from localStorage, so a fresh browser/profile has nothing to restore from - see
// Workbench.svelte:502-523.
export async function resolveLocation (loc: Location): Promise<ResolvedLocation | undefined> {
  if (loc.path[2] !== ygTimesheetId || loc.path[3] != null) {
    return undefined
  }
  // Approvers/admins land on the dashboard; everyone else on My Timesheet.
  const special = (await CanApprove([])) ? 'dashboard' : 'my'
  const resolved = { ...loc, path: [loc.path[0], loc.path[1], ygTimesheetId, special] }
  return { loc: resolved, defaultLocation: resolved }
}

export default async (): Promise<Resources> => ({
  component: {
    Timesheet,
    ProjectApproversEditor: ProjectApproversList,
    Approvals,
    Reports,
    HrTimesheet,
    HrRoster,
    HrOverview,
    HrExportDialog,
    ApproveTaskPopup,
    RejectTaskPopup,
    NotificationRedirect,
    Dashboard
  },
  function: { CanApprove },
  resolver: { Location: resolveLocation }
})
