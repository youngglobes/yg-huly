<script lang="ts">
  //
  // Toast body for a status change blocked by the estimate gate (backlog #1) from the shared
  // Set-Status action (context menu / bulk / keybinding). task-resources cannot import
  // tracker-resources' EstimateBlockedNotification, so it has its own thin wrapper.
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
