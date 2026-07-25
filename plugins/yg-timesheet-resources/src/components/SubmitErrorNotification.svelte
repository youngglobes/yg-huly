<script lang="ts">
  //
  // Toast body for a blocked Submit (no approver on one of the day's projects). Thin wrapper
  // around the shared NotificationToast, same pattern every other plugin uses for addNotification
  // (see e.g. billing-resources' BillingErrorNotification / tracker-resources' IssueNotification).
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
