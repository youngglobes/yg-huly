<script lang="ts">
  // Top-5 unread inbox: the current user's most recent unread notifications (comments/mentions/
  // reactions/assignments), each linking to its source object. A direct query of the base
  // InboxNotification class (isViewed:false) is simpler and cheaper than the shared 1000-doc store.
  import { getCurrentAccount, SortingOrder } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import notification, { type InboxNotification } from '@hcengineering/notification'
  import { getDocLinkTitle, openDocFromRef } from '@hcengineering/view-resources'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  const client = getClient()

  const q = createQuery()
  let notes: InboxNotification[] = []
  q.query(
    notification.class.InboxNotification,
    { user: getCurrentAccount().uuid, isViewed: false, archived: false },
    (res) => {
      notes = res
    },
    { sort: { createdOn: SortingOrder.Descending }, limit: 5 }
  )

  function kindOf (n: InboxNotification): string {
    switch (n._class) {
      case notification.class.MentionInboxNotification:
        return 'Mention'
      case notification.class.ReactionInboxNotification:
        return 'Reaction'
      case notification.class.ActivityInboxNotification:
        return 'Comment'
      default:
        return 'Update'
    }
  }

  async function titleOf (n: InboxNotification): Promise<string> {
    try {
      return (await getDocLinkTitle(client, n.objectId, n.objectClass)) ?? ''
    } catch {
      return ''
    }
  }

  function open (n: InboxNotification): void {
    void openDocFromRef(n.objectClass, n.objectId)
  }
</script>

<div class="inbox">
  <div class="inbox__title"><Label label={ygTimesheet.string.Inbox} />{#if notes.length > 0}<span class="inbox__n">{notes.length}</span>{/if}</div>
  {#each notes as n (n._id)}
    <button class="irow" on:click={() => open(n)}>
      <span class="irow__dot" />
      {#await titleOf(n) then t}
        <span class="irow__t">{t || 'Notification'}</span>
      {/await}
      <span class="irow__kind">{kindOf(n)}</span>
    </button>
  {:else}
    <div class="yg-empty"><Label label={ygTimesheet.string.InboxEmpty} /></div>
  {/each}
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .inbox {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 14px 16px;
  }
  .inbox__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; }
  .inbox__n { font-size: 11px; font-weight: 700; color: var(--yg-av3); background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 999px; padding: 1px 7px; margin-left: 6px; }
  .irow {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 6px;
    border: 0;
    border-top: 1px solid var(--yg-border);
    background: transparent;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  .irow__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--yg-av3); flex: none; }
  .irow__t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--yg-text); }
  .irow__kind { font-size: 11px; color: var(--yg-text-faint); text-transform: uppercase; letter-spacing: 0.04em; }
</style>
