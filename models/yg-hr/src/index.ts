//
// YoungGlobes: yg-hr model.
//
import { type Domain } from '@hcengineering/core'
import { type Builder, Model, Prop, TypeBoolean, TypeString, UX } from '@hcengineering/model'
import core, { TDoc } from '@hcengineering/model-core'
import ygHr from './plugin'

export { ygHrId } from '@hcengineering/yg-hr'
export { ygHrOperation } from './migration'

export const DOMAIN_YG_HR = 'yg_hr' as Domain

@Model(ygHr.class.Department, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.Department)
export class TDepartment extends TDoc {
  @Prop(TypeString(), ygHr.string.Department) name!: string
}

@Model(ygHr.class.Designation, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.Designation)
export class TDesignation extends TDoc {
  @Prop(TypeString(), ygHr.string.Designation) name!: string
  @Prop(TypeBoolean(), ygHr.string.IsHr) isHr?: boolean
}

@Model(ygHr.class.EmploymentStatus, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.EmploymentStatus)
export class TEmploymentStatus extends TDoc {
  @Prop(TypeString(), ygHr.string.EmploymentStatus) name!: string
}

@Model(ygHr.class.Location, core.class.Doc, DOMAIN_YG_HR)
@UX(ygHr.string.Location)
export class TLocation extends TDoc {
  @Prop(TypeString(), ygHr.string.Location) name!: string
}

export function createModel (builder: Builder): void {
  builder.createModel(TDepartment, TDesignation, TEmploymentStatus, TLocation)

  // Shared space holding the admin-managed list items (Department / Designation /
  // EmploymentStatus / Location). Not private so every workspace user can read the lists
  // for their profile/dropdowns; not autoJoin since only HR/admins add members via the UI.
  builder.createDoc(
    core.class.Space,
    core.space.Model,
    {
      name: 'HR Configuration',
      description: 'Department / Designation / Employment status / Location',
      private: false,
      archived: false,
      autoJoin: false,
      members: []
    },
    ygHr.space.HrConfig
  )
}
