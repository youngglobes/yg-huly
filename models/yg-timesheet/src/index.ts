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
  TypeDate,
  TypeNumber,
  TypeRef,
  TypeString
} from '@hcengineering/model'
import contact from '@hcengineering/contact'
import hr from '@hcengineering/hr'
import core, { TAttachedDoc, TDoc } from '@hcengineering/model-core'
import tracker, { TProject } from '@hcengineering/model-tracker'
import workbench from '@hcengineering/model-workbench'
import type { Issue, Project, TimeSpendReport } from '@hcengineering/tracker'
import ygTimesheet, {
  ygTimesheetId,
  type DayStatus,
  type HrTimeEntry,
  type ProjectApprovers,
  type TaskStatus,
  type Timesheet,
  type TimesheetApproval,
  type TimesheetDay,
  type TimesheetLine,
  type TimesheetTask
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
}

@Model(ygTimesheet.class.TimesheetApproval, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TTimesheetApproval extends TDoc implements TimesheetApproval {
  @Prop(TypeRef(ygTimesheet.class.TimesheetTask), core.string.Object) task!: Ref<TimesheetTask>
  @Prop(TypeNumber(), core.string.Object) approvedHours!: number
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object) approvedBy?: Ref<Employee>
  @Prop(TypeDate(), core.string.Object) approvedOn?: Timestamp
}

@Mixin(ygTimesheet.mixin.ProjectApprovers, tracker.class.Project)
export class TProjectApprovers extends TProject implements ProjectApprovers {
  @Prop(TypeRef(contact.mixin.Employee), ygTimesheet.string.PM)
    pm?: Ref<Employee>

  @Prop(TypeRef(contact.mixin.Employee), ygTimesheet.string.TeamLead)
    teamLead?: Ref<Employee>
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

export function createModel (builder: Builder): void {
  builder.createModel(TTimesheet, TTimesheetDay, TTimesheetTask, TTimesheetApproval, TProjectApprovers, THrTimeEntry)

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
      icon: ygTimesheet.icon.Timesheet,
      alias: ygTimesheetId,
      hidden: false,
      position: 'top',
      navigatorModel: {
        spaces: [],
        specials: [
          {
            id: 'my',
            label: ygTimesheet.string.Timesheet,
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
            label: ygTimesheet.string.Projects,
            icon: tracker.icon.Component,
            component: ygTimesheet.component.ProjectApproversEditor,
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
      icon: ygTimesheet.icon.Timesheet, // reuse existing icon for the beta
      alias: 'yg-hr',
      hidden: false,
      position: 'top',
      navigatorModel: {
        spaces: [],
        specials: [
          {
            id: 'timesheets',
            label: ygTimesheet.string.HrTimesheets,
            icon: ygTimesheet.icon.Timesheet,
            component: ygTimesheet.component.HrTimesheet,
            accessLevel: AccountRole.DocGuest,
            position: 'top'
          },
          {
            id: 'overview',
            label: ygTimesheet.string.HrOverview,
            icon: hr.icon.Structure,
            component: ygTimesheet.component.HrOverview,
            accessLevel: AccountRole.DocGuest,
            position: 'top'
          },
          {
            id: 'roster',
            label: ygTimesheet.string.HrRoster,
            icon: contact.icon.Person,
            component: ygTimesheet.component.HrRoster,
            accessLevel: AccountRole.Owner,
            position: 'bottom'
          }
        ]
      }
    },
    ygTimesheet.app.HumanResource
  )
  // NOTE: hiding the stock HR app happens in the migration (models/yg-timesheet/src/migration.ts) —
  // Builder has no updateDoc; only a TxOperations client (migration) can update an existing app doc.
}
