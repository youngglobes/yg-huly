import type { Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'

export const ygHrId = 'yg-hr' as Plugin

export default plugin(ygHrId, {
  class: {},
  mixin: {},
  string: {}
})
