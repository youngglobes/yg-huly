//
// YoungGlobes: yg-timesheet model (Phase 0 spike — one class, no UI, no triggers).
//
import type { Employee } from '@hcengineering/contact'
import { type Domain, type Ref, type Timestamp } from '@hcengineering/core'
import { type Builder, Model, Prop, TypeDate, TypeRef } from '@hcengineering/model'
import contact from '@hcengineering/contact'
import core, { TDoc } from '@hcengineering/model-core'
import workbench from '@hcengineering/model-workbench'
import ygTimesheet, { ygTimesheetId, type Timesheet } from '@hcengineering/yg-timesheet'

export { ygTimesheetId } from '@hcengineering/yg-timesheet'

export const DOMAIN_YG_TIMESHEET = 'yg-timesheet' as Domain

@Model(ygTimesheet.class.Timesheet, core.class.Doc, DOMAIN_YG_TIMESHEET)
export class TTimesheet extends TDoc implements Timesheet {
  @Prop(TypeRef(contact.mixin.Employee), core.string.Object)
    employee!: Ref<Employee>

  @Prop(TypeDate(), core.string.Object)
    weekStart!: Timestamp
}

export function createModel (builder: Builder): void {
  builder.createModel(TTimesheet)

  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: ygTimesheet.string.Timesheet,
      icon: ygTimesheet.icon.Timesheet,
      alias: ygTimesheetId,
      hidden: false,
      position: 'top',
      component: ygTimesheet.component.Timesheet
    },
    ygTimesheet.app.Timesheet
  )
}
