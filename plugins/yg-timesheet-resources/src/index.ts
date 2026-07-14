import { type Resources } from '@hcengineering/platform'
import Timesheet from './components/Timesheet.svelte'
import TimesheetApp from './components/TimesheetApp.svelte'
import ProjectApproversList from './components/ProjectApproversList.svelte'

export default async (): Promise<Resources> => ({
  component: {
    Timesheet,
    TimesheetApp,
    ProjectApproversEditor: ProjectApproversList
  }
})
