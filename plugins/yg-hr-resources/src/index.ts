import { type Resources } from '@hcengineering/platform'
import HrLists from './components/HrLists.svelte'

export default async (): Promise<Resources> => ({
  component: {
    HrLists
  }
})
