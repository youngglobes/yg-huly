import { type Resources } from '@hcengineering/platform'
import EmployeeProfile from './components/EmployeeProfile.svelte'
import HrLists from './components/HrLists.svelte'

export default async (): Promise<Resources> => ({
  component: {
    HrLists,
    EmployeeProfile
  }
})
