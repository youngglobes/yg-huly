import { type Resources } from '@hcengineering/platform'
import EmployeeDirectory from './components/EmployeeDirectory.svelte'
import EmployeeProfile from './components/EmployeeProfile.svelte'
import HrLists from './components/HrLists.svelte'

export default async (): Promise<Resources> => ({
  component: {
    HrLists,
    EmployeeProfile,
    EmployeeDirectory
  }
})
