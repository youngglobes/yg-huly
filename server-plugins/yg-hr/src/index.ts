//
// YoungGlobes: server-yg-hr plugin ids.
//
import type { Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'

/**
 * @public
 */
export const serverYgHrId = 'server-yg-hr' as Plugin

/**
 * @public
 */
export default plugin(serverYgHrId, {
  trigger: {}
})
