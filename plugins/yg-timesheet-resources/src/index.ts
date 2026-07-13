import { type Resources } from '@hcengineering/platform'
import Timesheet from './components/Timesheet.svelte'

export default async (): Promise<Resources> => ({
  component: {
    Timesheet
  }
})
