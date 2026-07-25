<script lang="ts">
  //
  // Inbox click-through redirect. Clicking an inbox notification navigates to its DocNotifyContext
  // object's ObjectPanel, rendered embedded inside the Inbox (the destination is hardcoded to the
  // context object's class -> its view.mixin.ObjectPanel; headerObject/props do not affect it). We
  // register THIS component as the ObjectPanel for TimesheetDay + TimesheetTask so a timesheet
  // notification lands on the right app view instead of a raw issue/doc panel:
  //   - submit notification  -> attached to the TimesheetDay  -> Approvals
  //   - approve/reject notif  -> attached to the TimesheetTask -> My Timesheet
  // The component renders nothing; it just navigates away on mount.
  //
  import { onMount } from 'svelte'
  import type { Class, Doc, Ref } from '@hcengineering/core'
  import { getCurrentLocation, navigate } from '@hcengineering/ui'
  import ygTimesheet, { ygTimesheetId } from '@hcengineering/yg-timesheet'

  export let _class: Ref<Class<Doc>> | undefined = undefined

  onMount(() => {
    const special = _class === ygTimesheet.class.TimesheetDay ? 'approvals' : 'my'
    const loc = getCurrentLocation()
    loc.path[2] = ygTimesheetId
    loc.path[3] = special
    loc.path.length = 4
    loc.fragment = undefined
    loc.query = undefined
    navigate(loc)
  })
</script>
