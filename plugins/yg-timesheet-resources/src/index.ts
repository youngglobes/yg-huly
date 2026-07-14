import { type Resources } from '@hcengineering/platform'
import Timesheet from './components/Timesheet.svelte'
import TimesheetApp from './components/TimesheetApp.svelte'
import ProjectApproversList from './components/ProjectApproversList.svelte'
import Approvals from './components/Approvals.svelte'
import Reports from './components/Reports.svelte'

export default async (): Promise<Resources> => ({
  component: {
    Timesheet,
    TimesheetApp,
    ProjectApproversEditor: ProjectApproversList,
    Approvals,
    Reports
  }
})
