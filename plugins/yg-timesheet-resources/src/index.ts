import { type Resources } from '@hcengineering/platform'
import core, { AccountRole, getCurrentAccount, hasAccountRole, type Client, type Doc, type Ref, type Space } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import contact, { getCurrentEmployee } from '@hcengineering/contact'
import tracker from '@hcengineering/tracker'
import type { Location, ResolvedLocation } from '@hcengineering/ui'
import ygTimesheet, {
  ygTimesheetId, type ProjectApprovers, type WorkDesignation, type WorkProfile, type TimesheetDay
} from '@hcengineering/yg-timesheet'
import { canApproveView } from './utils/task-approval'
import { asRefArray } from './utils/workflow'
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
import LocationPermissionBanner from './components/LocationPermissionBanner.svelte'
import WorkProfileEditor from './components/WorkProfileEditor.svelte'
import Performance from './components/Performance.svelte'
import HrHolidays from './components/HrHolidays.svelte'
import HrLatePermissions from './components/HrLatePermissions.svelte'
import AiUsage from './components/AiUsage.svelte'
import AiUsageConfig from './components/AiUsageConfig.svelte'

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
      return { pm: asRefArray(a.pm), teamLead: asRefArray(a.teamLead) }
    })
  return canApproveView(isAdmin, pairs, me)
}

// Leadership designations (ygTimesheet.mixin.WorkProfile) that may create a project even without
// an Owner role, an HR-space membership, or a ProjectApprovers assignment.
const PROJECT_CREATOR_DESIGNATIONS: WorkDesignation[] = [
  'Project Manager', 'Team Leader', 'HR Executive', 'CEO', 'CTO', 'COO'
]

// May the current user create a project? Owner OR HR-space member OR PM/TeamLead on any project's
// ProjectApprovers mixin OR a leadership WorkProfile designation. Client-side hide only - a
// determined API caller can still create; not enforced server-side (see spec).
async function CanCreateProject (): Promise<boolean> {
  const acct = getCurrentAccount()
  if (hasAccountRole(acct, AccountRole.Owner)) return true

  const client = getClient()
  const h = client.getHierarchy()

  const hrSpace = await client.findOne(core.class.Space, { _id: ygTimesheet.space.HrData })
  if (hrSpace !== undefined && hrSpace.members.includes(acct.uuid)) return true

  const me = getCurrentEmployee()
  const projects = await client.findAll(tracker.class.Project, {})
  const isApprover = projects
    .filter((p) => h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers))
    .some((p) => {
      const a: ProjectApprovers = h.as(p, ygTimesheet.mixin.ProjectApprovers)
      return asRefArray(a.pm).includes(me) || asRefArray(a.teamLead).includes(me)
    })
  if (isApprover) return true

  const myEmployee = await client.findOne(contact.mixin.Employee, { _id: me })
  const designation =
    myEmployee !== undefined && h.hasMixin(myEmployee, ygTimesheet.mixin.WorkProfile)
      ? (h.as(myEmployee, ygTimesheet.mixin.WorkProfile) as WorkProfile).designation
      : undefined
  return designation !== undefined && PROJECT_CREATOR_DESIGNATIONS.includes(designation)
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
  // Everyone lands on My Timesheet; the PM dashboard lives in the separate Dashboard app.
  const special = 'my'
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
    AttendanceReminder,
    LocationPermissionBanner,
    WorkProfileEditor,
    Performance,
    HrHolidays,
    HrLatePermissions,
    AiUsage,
    AiUsageConfig
  },
  function: { CanApprove, TimesheetDayTitle: timesheetDayTitle, CanCreateProject },
  resolver: { Location: resolveLocation, AttendanceLocation: resolveAttendanceLocation }
})
