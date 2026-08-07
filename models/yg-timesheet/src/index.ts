//
// YoungGlobes: yg-timesheet model.
//
import type { Employee } from '@hcengineering/contact'
import { AccountRole, type Domain, type Ref, type Timestamp } from '@hcengineering/core'
import {
  type Builder,
  ArrOf,
  Collection,
  Mixin,
  Model,
  Prop,
  TypeBoolean,
  TypeDate,
  TypeNumber,
  TypeRef,
  TypeString,
  UX
} from '@hcengineering/model'
import contact, { TEmployee } from '@hcengineering/model-contact'
import hr from '@hcengineering/hr'
import core, { TAttachedDoc, TDoc } from '@hcengineering/model-core'
import presentation from '@hcengineering/model-presentation'
import tracker, { TProject } from '@hcengineering/model-tracker'
import setting from '@hcengineering/setting'
import view from '@hcengineering/model-view'
import workbench from '@hcengineering/model-workbench'
import type { Issue, Project, TimeSpendReport } from '@hcengineering/tracker'
import ygTimesheet, {
  ygTimesheetId,
  type AttendanceMode,
  type AttendanceReminderSettings,
  type AttendanceSession,
  type DayStatus,
  type Holiday,
  type HrTimeEntry,
  type ProjectApprovers,
  type TaskStatus,
  type Timesheet,
  type TimesheetApproval,
  type TimesheetDay,
  type TimesheetLine,
  type TimesheetRejectCycle,
  type TimesheetTask,
  type WorkProfile,
  type WorkDesignation,
  type WorkDepartment
} from '@hcengineering/yg-timesheet'

export { ygTimesheetId } from '@hcengineering/yg-timesheet'
export { ygTimesheetOperation } from './migration'

export const DOMAIN_YG_TIMESHEET = 'yg-timesheet' as Domain

@Model(ygTimesheet.class.Timesheet, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TTimesheet extends TDoc implements Timesheet {
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object)
    employee!: Ref<Employee>

  @Prop(TypeDate(), core.string.Object)
    weekStart!: Timestamp

  @Prop(Collection(ygTimesheet.class.TimesheetDay), ygTimesheet.string.Days)
    days!: number
}

@Model(ygTimesheet.class.TimesheetDay, core.class.AttachedDoc, DOMAIN_YG_TIMESHEET)
// A class label so the Inbox notification card + class filter render a name instead of "undefined"
// (the card falls back to getClass().label when a doc has no ObjectTitle/ObjectIdentifier - 2026-07-29).
@UX(ygTimesheet.string.Timesheet)
export class TTimesheetDay extends TAttachedDoc implements TimesheetDay {
  @Prop(TypeRef(ygTimesheet.class.Timesheet), core.string.Object)
  declare attachedTo: Ref<Timesheet>

  @Prop(TypeDate(), core.string.Object) date!: Timestamp
  // DEPRECATED (2026-07-23): the day's status is now DERIVED from its TimesheetTask children
  // (see utils/task-approval.ts deriveDayStatus). Field retained so pre-migration rows stay
  // readable; nothing reads it any more. Do not write it.
  @Prop(TypeString(), core.string.Object) status!: DayStatus
  @Prop(ArrOf(TypeRef(contact.mixin.Employee)), core.string.Object) approvers!: Ref<Employee>[]
  @Prop(TypeDate(), core.string.Object) submittedOn?: Timestamp
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) approvedBy?: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) approvedOn?: Timestamp
  @Prop(TypeString(), core.string.Object) rejectReason?: string
  @Prop(TypeNumber(), core.string.Object) totalHours!: number

  // snapshot stored as an opaque array — persisted as plain data, no Prop editor.
  declare snapshot?: TimesheetLine[]
}

@Model(ygTimesheet.class.TimesheetTask, core.class.AttachedDoc, DOMAIN_YG_TIMESHEET)
// Class label for the approve/reject Inbox card (same reason as TimesheetDay above).
@UX(ygTimesheet.string.Timesheet)
export class TTimesheetTask extends TAttachedDoc implements TimesheetTask {
  @Prop(TypeRef(ygTimesheet.class.TimesheetDay), core.string.Object)
  declare attachedTo: Ref<TimesheetDay>

  @Prop(TypeDate(), core.string.Object) date!: Timestamp
  @Prop(TypeRef(tracker.class.Issue), core.string.Object) issue!: Ref<Issue>
  @Prop(TypeString(), core.string.Object) identifier!: string
  @Prop(TypeString(), core.string.Object) title!: string
  @Prop(TypeRef(tracker.class.Project), core.string.Object) project!: Ref<Project>
  @Prop(TypeNumber(), core.string.Object) submittedHours!: number
  @Prop(TypeString(), core.string.Object) status!: TaskStatus
  @Prop(ArrOf(TypeRef(contact.mixin.Employee)), core.string.Object) approvers!: Ref<Employee>[]
  @Prop(TypeDate(), core.string.Object) submittedOn?: Timestamp
  @Prop(TypeString(), core.string.Object) rejectReason?: string
  @Prop(TypeNumber(), core.string.Object) approvedHours?: number
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) approvedBy?: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) approvedOn?: Timestamp
}

@Model(ygTimesheet.class.TimesheetApproval, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TTimesheetApproval extends TDoc implements TimesheetApproval {
  @Prop(TypeRef(ygTimesheet.class.TimesheetTask), core.string.Object) task!: Ref<TimesheetTask>
  @Prop(TypeNumber(), core.string.Object) approvedHours!: number
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) approvedBy?: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) approvedOn?: Timestamp
}

@Model(ygTimesheet.class.TimesheetRejectCycle, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TTimesheetRejectCycle extends TDoc implements TimesheetRejectCycle {
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) employee!: Ref<Employee>
  @Prop(TypeRef(tracker.class.Issue), core.string.Object) issue!: Ref<Issue>
  @Prop(TypeDate(), core.string.Object) date!: Timestamp
  @Prop(TypeString(), core.string.Object) rejectReason!: string
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) rejectedBy?: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) rejectedOn!: Timestamp
  @Prop(TypeString(), core.string.Object) resubmitNote?: string
  @Prop(TypeDate(), core.string.Object) resubmittedOn?: Timestamp
}

@Mixin(ygTimesheet.mixin.ProjectApprovers, tracker.class.Project)
export class TProjectApprovers extends TProject implements ProjectApprovers {
  @Prop(TypeRef(contact.mixin.Employee), ygTimesheet.string.PM)
    pm?: Ref<Employee>

  @Prop(TypeRef(contact.mixin.Employee), ygTimesheet.string.TeamLead)
    teamLead?: Ref<Employee>
}

@Mixin(ygTimesheet.mixin.WorkProfile, contact.mixin.Employee)
export class TWorkProfile extends TEmployee implements WorkProfile {
  @Prop(TypeString(), ygTimesheet.string.Designation) designation?: WorkDesignation
  @Prop(TypeString(), ygTimesheet.string.Department) department?: WorkDepartment
  @Prop(TypeString(), ygTimesheet.string.EmployeeId) employeeId?: string
  @Prop(TypeNumber(), ygTimesheet.string.ShiftStart) shiftStart?: number
}

@Model(ygTimesheet.class.HrTimeEntry, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class THrTimeEntry extends TDoc implements HrTimeEntry {
  @Prop(TypeRef(tracker.class.TimeSpendReport), core.string.Object) source!: Ref<TimeSpendReport>
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) employee!: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) date!: Timestamp
  @Prop(TypeNumber(), core.string.Object) hours!: number
  @Prop(TypeRef(tracker.class.Project), core.string.Object) project!: Ref<Project>
  @Prop(TypeString(), core.string.Object) projectName!: string
  @Prop(TypeRef(tracker.class.Issue), core.string.Object) issue!: Ref<Issue>
  @Prop(TypeString(), core.string.Object) identifier!: string
  @Prop(TypeString(), core.string.Object) title!: string
  @Prop(TypeString(), core.string.Object) note!: string
}

@Model(ygTimesheet.class.AttendanceSession, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TAttendanceSession extends TDoc implements AttendanceSession {
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) employee!: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) date!: Timestamp
  @Prop(TypeDate(), core.string.Object) punchIn!: Timestamp
  @Prop(TypeString(), core.string.Object) punchInNote?: string
  @Prop(TypeString(), core.string.Object) mode!: AttendanceMode
  @Prop(TypeDate(), core.string.Object) punchOut?: Timestamp
  @Prop(TypeString(), core.string.Object) punchOutNote?: string
}

@Model(ygTimesheet.class.AttendanceReminderSettings, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TAttendanceReminderSettings extends TDoc implements AttendanceReminderSettings {
  @Prop(TypeBoolean(), core.string.Object) enabled!: boolean
  @Prop(TypeNumber(), core.string.Object) windowStartMin!: number
  @Prop(TypeNumber(), core.string.Object) windowEndMin!: number
  @Prop(ArrOf(TypeNumber()), core.string.Object) days!: number[]
  @Prop(TypeNumber(), core.string.Object) punchInDelayMin!: number
  @Prop(TypeNumber(), core.string.Object) repeatMin!: number
  @Prop(TypeNumber(), core.string.Object) punchOutIdleMin!: number
}

@Model(ygTimesheet.class.Holiday, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class THoliday extends TDoc implements Holiday {
  @Prop(TypeDate(), core.string.Object) date!: Timestamp
  @Prop(TypeString(), core.string.Object) name!: string
}

export function createModel (builder: Builder): void {
  builder.createModel(TTimesheet, TTimesheetDay, TTimesheetTask, TTimesheetApproval, TTimesheetRejectCycle, TProjectApprovers, TWorkProfile, THrTimeEntry, TAttendanceSession, TAttendanceReminderSettings, THoliday)

  // Shared space that holds all Timesheet / TimesheetDay docs. Not private, so approvers
  // can read others' submitted days; autoJoin so every workspace user can write their own.
  builder.createDoc(
    core.class.Space,
    core.space.Model,
    {
      name: 'Timesheets',
      description: 'Timesheet submit/approve workspace',
      private: false,
      archived: false,
      autoJoin: true,
      members: []
    },
    ygTimesheet.space.Timesheets
  )

  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: ygTimesheet.string.Timesheet,
      // Reports-style glyph so the Timesheet app (Dashboard/Approvals/Reports) is visually distinct
      // from the Attendance app, which keeps the clock icon. (2026-07-28, user request)
      icon: tracker.icon.TimeReport,
      alias: ygTimesheetId,
      hidden: false,
      position: 'top',
      locationResolver: ygTimesheet.resolver.Location,
      navigatorModel: {
        spaces: [],
        specials: [
          {
            id: 'my',
            label: ygTimesheet.string.MyTimesheet,
            icon: ygTimesheet.icon.Timesheet,
            component: ygTimesheet.component.Timesheet,
            position: 'top'
          },
          {
            id: 'approvals',
            label: ygTimesheet.string.Approvals,
            icon: tracker.icon.Issue,
            component: ygTimesheet.component.Approvals,
            visibleIf: ygTimesheet.function.CanApprove,
            position: 'top'
          },
          {
            id: 'reports',
            label: ygTimesheet.string.Reports,
            icon: tracker.icon.TimeReport,
            component: ygTimesheet.component.Reports,
            visibleIf: ygTimesheet.function.CanApprove,
            position: 'top'
          },
          {
            id: 'projects',
            label: ygTimesheet.string.Configuration,
            icon: setting.icon.Setting,
            component: ygTimesheet.component.ProjectApproversEditor,
            accessLevel: AccountRole.Maintainer,
            position: 'bottom'
          },
          {
            id: 'reminders',
            label: ygTimesheet.string.ReminderSettings,
            icon: setting.icon.Setting,
            component: ygTimesheet.component.AttendanceReminderSettings,
            accessLevel: AccountRole.Maintainer,
            position: 'bottom'
          }
        ]
      }
    },
    ygTimesheet.app.Timesheet
  )

  // Dedicated "Human Resource" app hosting the HR Timesheets/Overview sub-modules (and the
  // Owner-only roster) as a native vertical navigator — mirrors models/contact's Application
  // (navigatorModel.specials, no top-level `component`; see that file's Contacts app doc).
  // App visibility (user decision 2026-07-22, superseding 2026-07-17): registered with NO
  // `accessLevel`, because "HR" must be HrData-space membership, NOT a workspace role — HR staff
  // stay ordinary Users with no admin powers. `accessLevel` cannot express this: it is a threshold
  // on the AccountRole ladder, so any rung that excludes Maintainers also excludes non-Owner HR.
  //
  // The 2026-07-17 `accessLevel: AccountRole.Owner` was added because the per-user
  // HiddenApplication approach looked broken. That diagnosis was WRONG (see below), so it is
  // reverted here.
  //
  // Who sees the icon: everyone EXCEPT accounts holding a `workbench.class.HiddenApplication` for
  // this app, maintained by OnHrMembershipChange + OnHrEmployeeCreate (server-plugins/
  // yg-timesheet-resources). Owners self-add to HrData via ensureHrMembership, so admins + roster
  // members see it; everyone else has it hidden.
  //
  // Icon hiding is BEST-EFFORT (a user can un-hide from the app switcher); the data is absolute —
  // HrTimeEntry lives in the private HrData space and the server refuses every row to non-members,
  // so a non-member who forces the app open sees empty screens.
  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: ygTimesheet.string.HumanResource,
      icon: hr.icon.HR, // people glyph - distinct from the Timesheet/Attendance clock (2026-07-29 user request)
      alias: 'yg-hr',
      hidden: false,
      position: 'top',
      navigatorModel: {
        spaces: [],
        specials: [
          // Overview first so opening the HR app lands here by default (the default-landing picks the
          // first visible special). Overview shows org-wide data immediately; Timesheets needs an
          // employee selected before it shows anything, so it makes a poor landing tab. (2026-08-01)
          {
            id: 'overview',
            label: ygTimesheet.string.HrOverview,
            icon: hr.icon.Structure,
            component: ygTimesheet.component.HrOverview,
            accessLevel: AccountRole.DocGuest,
            position: 'top'
          },
          {
            id: 'timesheets',
            label: ygTimesheet.string.HrTimesheets,
            icon: tracker.icon.TimeReport,
            component: ygTimesheet.component.HrTimesheet,
            accessLevel: AccountRole.DocGuest,
            position: 'top'
          },
          {
            id: 'attendance',
            label: ygTimesheet.string.HrAttendance,
            icon: hr.icon.Overtime,
            component: ygTimesheet.component.HrAttendance,
            accessLevel: AccountRole.DocGuest,
            position: 'top'
          },
          {
            id: 'performance',
            label: ygTimesheet.string.Performance,
            icon: view.icon.Star,
            component: ygTimesheet.component.Performance,
            accessLevel: AccountRole.DocGuest,
            position: 'top'
          },
          {
            id: 'holidays',
            label: ygTimesheet.string.Holidays,
            icon: hr.icon.Vacation,
            component: ygTimesheet.component.HrHolidays,
            accessLevel: AccountRole.DocGuest,
            position: 'top'
          },
          {
            id: 'roster',
            label: ygTimesheet.string.HrRoster,
            icon: hr.icon.Members,
            component: ygTimesheet.component.HrRoster,
            accessLevel: AccountRole.Owner,
            position: 'bottom'
          },
          {
            id: 'team-profiles',
            label: ygTimesheet.string.TeamProfiles,
            icon: contact.icon.Person,
            component: ygTimesheet.component.WorkProfileEditor,
            // DocGuest like the other HR specials: HR-app visibility is already gated to HrData members
            // + owners (the HiddenApplication trigger), so this shows team-profiles to HR staff too, not
            // just owners. (Was Owner-only; HR users need to manage designations/departments/IDs.)
            accessLevel: AccountRole.DocGuest,
            position: 'bottom'
          }
        ]
      }
    },
    ygTimesheet.app.HumanResource
  )
  // NOTE: hiding the stock HR app happens in the migration (models/yg-timesheet/src/migration.ts) —
  // Builder has no updateDoc; only a TxOperations client (migration) can update an existing app doc.

  // New self-service "Attendance" app (Phase 1d). Same native-navigator pattern as the HR app:
  // navigatorModel.specials, no top-level `component`. One special for v1 (My Attendance, the
  // default landing); Leave + attendance-report specials get added here in later phases.
  // No accessLevel — every workspace user punches their own attendance. AttendanceSession docs
  // live in core.space.Workspace (shared, like Timesheet), so no space is provisioned here.
  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: ygTimesheet.string.Attendance,
      icon: ygTimesheet.icon.Timesheet, // reuse existing icon for the beta
      alias: 'yg-attendance',
      hidden: false,
      position: 'top',
      locationResolver: ygTimesheet.resolver.AttendanceLocation,
      navigatorModel: {
        spaces: [],
        specials: [
          {
            id: 'my',
            label: ygTimesheet.string.MyAttendance,
            icon: ygTimesheet.icon.Timesheet,
            component: ygTimesheet.component.MyAttendance,
            position: 'top'
          }
        ]
      }
    },
    ygTimesheet.app.Attendance
  )

  // New top-level "Dashboard" app (replaces the old in-Timesheet dashboard special). Single view
  // that routes internally by role; no navigatorModel/specials, unlike the other apps above.
  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: ygTimesheet.string.Dashboard,
      icon: tracker.icon.Home, // dashboard/home glyph (swap if a better asset exists)
      alias: 'yg-dashboard',
      hidden: false,
      position: 'top',
      order: 1, // sort first in the left rail (above Inbox/order:100 and every stock top app)
      component: ygTimesheet.component.DashboardHome
    },
    ygTimesheet.app.Dashboard
  )

  // Inbox click-through: an inbox notification navigates to its context object's ObjectPanel
  // (rendered embedded in the Inbox — see plugins/notification-resources). Our approval notifications
  // attach to a TimesheetDay (submit) or TimesheetTask (approve/reject); registering
  // NotificationRedirect as their ObjectPanel makes the click land on the right app view (Approvals
  // vs My Timesheet) instead of a raw doc panel. The component just navigates away on mount.
  builder.mixin(ygTimesheet.class.TimesheetDay, core.class.Class, view.mixin.ObjectPanel, {
    component: ygTimesheet.component.NotificationRedirect
  })
  // Inbox card subtitle: the sheet date. The bold title above it is the @UX class label ("Timesheet").
  // Together they replace the old "undefined / undefined" (and the doubled class-label) header.
  builder.mixin(ygTimesheet.class.TimesheetDay, core.class.Class, view.mixin.ObjectTitle, {
    titleProvider: ygTimesheet.function.TimesheetDayTitle
  })
  builder.mixin(ygTimesheet.class.TimesheetTask, core.class.Class, view.mixin.ObjectPanel, {
    component: ygTimesheet.component.NotificationRedirect
  })

  // Mount the punch-reminder controller on every workbench page (native global slot; renders only a
  // fixed-position banner + fires notifications, so the hidden extension host is fine). presence/love
  // use this exact pattern.
  builder.createDoc(presentation.class.ComponentPointExtension, core.space.Model, {
    extension: workbench.extensions.WorkbenchExtensions,
    component: ygTimesheet.component.AttendanceReminder
  })
}
