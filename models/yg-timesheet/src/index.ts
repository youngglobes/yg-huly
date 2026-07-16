//
// YoungGlobes: yg-timesheet model.
//
import type { Employee } from '@hcengineering/contact'
import { type Domain, type Ref, type Timestamp } from '@hcengineering/core'
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
import core, { TAttachedDoc, TDoc } from '@hcengineering/model-core'
import tracker, { TProject } from '@hcengineering/model-tracker'
import workbench from '@hcengineering/model-workbench'
import hr from '@hcengineering/hr'
import type { Issue, Project, TimeSpendReport } from '@hcengineering/tracker'
import ygTimesheet, {
  ygTimesheetId,
  type DayStatus,
  type HrTimeEntry,
  type ProjectApprovers,
  type Timesheet,
  type TimesheetDay,
  type TimesheetLine
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
  builder.createModel(TTimesheet, TTimesheetDay, TProjectApprovers, THrTimeEntry)

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
      component: ygTimesheet.component.TimesheetApp
    },
    ygTimesheet.app.Timesheet
  )

  // Dedicated "Human Resource" app hosting the HR Timesheets sub-module (and the Owner-only
  // roster). Registered with NO accessLevel: HR is space-membership in ygTimesheet.space.HrData,
  // not a workspace role. The sidebar icon is hidden from non-members by the Task-7 per-user
  // HiddenApplication trigger; the projected HrTimeEntry data is server-private regardless.
  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: ygTimesheet.string.HumanResource,
      icon: ygTimesheet.icon.Timesheet, // reuse existing icon for the beta
      alias: 'yg-hr',
      hidden: false,
      position: 'top',
      component: ygTimesheet.component.HrApp
    },
    ygTimesheet.app.HumanResource
  )

  // Hide Huly's built-in HR app so there is one HR menu (ours).
  builder.updateDoc(workbench.class.Application, core.space.Model, hr.app.HR, { hidden: true })
}
