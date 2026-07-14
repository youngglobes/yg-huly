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
import ygTimesheet, {
  ygTimesheetId,
  type DayStatus,
  type ProjectApprovers,
  type Timesheet,
  type TimesheetDay,
  type TimesheetLine
} from '@hcengineering/yg-timesheet'

export { ygTimesheetId } from '@hcengineering/yg-timesheet'

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

export function createModel (builder: Builder): void {
  builder.createModel(TTimesheet, TTimesheetDay, TProjectApprovers)

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
}
