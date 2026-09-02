//
// YoungGlobes: server-yg-hr plugin ids.
//
import type { Plugin, Resource } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { TriggerFunc } from '@hcengineering/server-core'

/**
 * @public
 */
export const serverYgHrId = 'server-yg-hr' as Plugin

/**
 * @public
 */
export default plugin(serverYgHrId, {
  trigger: {
    OnEmployeeCreate: '' as Resource<TriggerFunc>
  }
})
