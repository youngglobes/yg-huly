<script lang="ts">
  //
  // Toast body for a status change blocked by the estimate gate (backlog #1): the issue has no
  // estimate and the user tried to move it into a started status. Thin wrapper around the shared
  // NotificationToast, same pattern as yg-timesheet's SubmitErrorNotification.
  //
  import { type Notification, NotificationToast } from '@hcengineering/ui'

  export let notification: Notification
  export let onRemove: () => void
</script>

<NotificationToast title={notification.title} severity={notification.severity} onClose={onRemove}>
  <svelte:fragment slot="content">
    {notification.subTitle}
  </svelte:fragment>
</NotificationToast>
