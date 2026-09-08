<!--
  YoungGlobes: global, render-nothing component (workbench.extensions.WorkbenchExtensions, same
  slot as AttendanceReminder / LocationPermissionBanner / yg-hr's SelfActivate) that keeps the AI
  Usage icon hidden from the current user when checkAiUsageAccess says no, and un-hides it again
  when it says yes. Only ever touches THIS user's own workbench.class.HiddenApplication doc, the
  same client-side create/remove idiom workbench-resources's hideApplication/showApplication use
  (a Preference in the shared core.space.Workspace, scoped per-user server-side by createdBy).

  The route itself is gated separately by accessCheck on ygTimesheet.app.AiUsage (see
  Workbench.svelte's syncLoc), so a user who un-hides the icon by hand still hits the 403 view -
  this component only keeps the nav icon's default state in agreement with that gate.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import core, { type Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import workbench, { type Application } from '@hcengineering/workbench'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { checkAiUsageAccess } from '../utils/access'

  const AI_USAGE_APP = ygTimesheet.app.AiUsage as unknown as Ref<Application>

  onMount(async () => {
    const client = getClient()
    const allowed = await checkAiUsageAccess()
    const existing = await client.findOne(workbench.class.HiddenApplication, { attachedTo: AI_USAGE_APP })
    if (allowed) {
      if (existing !== undefined) await client.remove(existing)
    } else if (existing === undefined) {
      await client.createDoc(workbench.class.HiddenApplication, core.space.Workspace, {
        attachedTo: AI_USAGE_APP
      })
    }
  })
</script>
