<script lang="ts">
  // Top-5 unread inbox: the current user's most recent unread notifications, each linking to its
  // source object. Shows WHO it is from (sender) and a short WHAT preview (the comment/message text,
  // truncated) so a PM can triage at a glance without opening every one.
  import { getCurrentAccount, SortingOrder, type Doc, type Ref, type Class } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import notification, { type InboxNotification, type ActivityInboxNotification } from '@hcengineering/notification'
  import { getDocLinkTitle, openDocFromRef } from '@hcengineering/view-resources'
  import { employeeByPersonIdStore, Avatar } from '@hcengineering/contact-resources'
  import { formatName } from '@hcengineering/contact'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'

  const client = getClient()
  const h = client.getHierarchy()

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

  // Pull the underlying message text for activity (comment) notifications, keyed by message id. The
  // message class comes from the notification itself (attachedToClass), so we need no chunter dep.
  let msgText = new Map<string, string>()
  $: void loadPreviews(notes)
  async function loadPreviews (ns: InboxNotification[]): Promise<void> {
    const acts = ns.filter((n) => h.isDerived(n._class, notification.class.ActivityInboxNotification)) as ActivityInboxNotification[]
    const byClass = new Map<Ref<Class<Doc>>, Array<Ref<Doc>>>()
    for (const a of acts) {
      if (a.attachedTo == null || a.attachedToClass == null) continue
      const arr = byClass.get(a.attachedToClass) ?? []
      arr.push(a.attachedTo)
      byClass.set(a.attachedToClass, arr)
    }
    const map = new Map<string, string>()
    for (const [cls, refs] of byClass) {
      const msgs = await client.findAll(cls, { _id: { $in: refs } })
      for (const m of msgs) {
        const mk = (m as any).message
        if (typeof mk === 'string') map.set(m._id as string, markupText(mk))
      }
    }
    msgText = map
  }

  // Minimal ProseMirror-JSON -> plain text (collect all text nodes). Tolerant of non-JSON markup.
  function markupText (markup: string): string {
    try {
      const parts: string[] = []
      const walk = (n: any): void => {
        if (n == null) return
        if (typeof n.text === 'string') parts.push(n.text)
        if (Array.isArray(n.content)) n.content.forEach(walk)
      }
      walk(JSON.parse(markup))
      return parts.join(' ').replace(/\s+/g, ' ').trim()
    } catch {
      return ''
    }
  }

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

  // Resolve sender + preview per note; recomputes when notes / people / messages change.
  $: rows = notes.map((n) => {
    const emp = $employeeByPersonIdStore.get(n.createdBy as any)
    const prev = h.isDerived(n._class, notification.class.ActivityInboxNotification)
      ? (msgText.get((n as ActivityInboxNotification).attachedTo as string) ?? '')
      : ''
    return { n, emp, from: emp != null ? formatName(emp.name) : '', preview: prev.slice(0, 140) }
  })
</script>

<div class="inbox">
  <div class="inbox__title"><Label label={ygTimesheet.string.Inbox} />{#if notes.length > 0}<span class="inbox__n">{notes.length}</span>{/if}</div>
  {#each rows as r (r.n._id)}
    <button class="irow" on:click={() => open(r.n)}>
      <span class="irow__av"><Avatar size="small" person={r.emp} name={r.emp?.name ?? null} /></span>
      <span class="irow__body">
        <span class="irow__head">
          <span class="irow__from">{r.from || kindOf(r.n)}</span>
          {#await titleOf(r.n) then t}{#if t}<span class="irow__on">on {t}</span>{/if}{/await}
        </span>
        {#if r.preview}<span class="irow__prev">{r.preview}</span>{/if}
      </span>
      <span class="irow__kind">{kindOf(r.n)}</span>
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
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .inbox :global(.yg-empty) { margin: auto 0; }
  .inbox__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; }
  .inbox__n { font-size: 11px; font-weight: 700; color: var(--yg-av3); background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 999px; padding: 1px 7px; margin-left: 6px; }
  .irow {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 6px;
    border: 0;
    border-top: 1px solid var(--yg-border);
    background: transparent;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  .irow__av { flex: none; margin-top: 1px; }
  .irow__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
  .irow__head { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .irow__from { font-weight: 600; color: var(--yg-text); white-space: nowrap; flex: none; }
  .irow__on { font-size: 12px; color: var(--yg-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .irow__prev { font-size: 12px; color: var(--yg-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .irow__kind { font-size: 11px; color: var(--yg-text-faint); text-transform: uppercase; letter-spacing: 0.04em; flex: none; }
</style>
