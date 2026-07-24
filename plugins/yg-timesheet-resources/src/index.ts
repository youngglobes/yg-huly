import { type Resources } from '@hcengineering/platform'
import { AccountRole, getCurrentAccount, hasAccountRole, type Space } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import { getCurrentEmployee } from '@hcengineering/contact'
import tracker from '@hcengineering/tracker'
import ygTimesheet, { type ProjectApprovers } from '@hcengineering/yg-timesheet'
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
    RejectTaskPopup
  },
  function: { CanApprove }
})
