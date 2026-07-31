import { type Resources } from '@hcengineering/platform'
import { AccountRole, getCurrentAccount, hasAccountRole, type Client, type Doc, type Ref, type Space } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import { getCurrentEmployee } from '@hcengineering/contact'
import tracker from '@hcengineering/tracker'
import type { Location, ResolvedLocation } from '@hcengineering/ui'
import ygTimesheet, { ygTimesheetId, type ProjectApprovers, type TimesheetDay } from '@hcengineering/yg-timesheet'
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
import DashboardHome from './components/DashboardHome.svelte'
import MyAttendance from './components/MyAttendance.svelte'
import HrAttendance from './components/HrAttendance.svelte'
import AttendanceReminderSettings from './components/AttendanceReminderSettings.svelte'
import AttendanceReminder from './components/AttendanceReminder.svelte'

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

// view.mixin.ObjectTitle provider for TimesheetDay: the Inbox card's subtitle line. The bold title
// above it is the @UX class label ("Timesheet"); this returns the sheet's date. Called by getDocTitle
// with the doc already loaded, so no extra query is needed.
async function timesheetDayTitle (_client: Client, _id: Ref<Doc>, doc?: Doc): Promise<string> {
  const day = doc as TimesheetDay | undefined
  if (day?.date == null) return ''
  return new Date(day.date).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
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

// The Attendance app root (loc.path[3] == null) has one special - default it to My Attendance so a
// first visit does not land on the blank Application shell (same reason as resolveLocation above).
export async function resolveAttendanceLocation (loc: Location): Promise<ResolvedLocation | undefined> {
  if (loc.path[2] !== 'yg-attendance' || loc.path[3] != null) {
    return undefined
  }
  const resolved = { ...loc, path: [loc.path[0], loc.path[1], 'yg-attendance', 'my'] }
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
    Dashboard,
    DashboardHome,
    MyAttendance,
    HrAttendance,
    AttendanceReminderSettings,
    AttendanceReminder
  },
  function: { CanApprove, TimesheetDayTitle: timesheetDayTitle },
  resolver: { Location: resolveLocation, AttendanceLocation: resolveAttendanceLocation }
})
