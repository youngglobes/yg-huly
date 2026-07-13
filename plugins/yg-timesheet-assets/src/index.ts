import ygTimesheet from '@hcengineering/yg-timesheet'
import { loadMetadata } from '@hcengineering/platform'

const icons = require('../assets/icons.svg') as string // eslint-disable-line
loadMetadata(ygTimesheet.icon, {
  Timesheet: `${icons}#timesheet`
})
