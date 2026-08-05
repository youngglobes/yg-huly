<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { Class, IdMap, Ref, Status } from '@hcengineering/core'
  import { IntlString } from '@hcengineering/platform'
  import { DocPopup, getClient } from '@hcengineering/presentation'
  import task, { Task, TaskType } from '@hcengineering/task'
  import { addNotification, NotificationSeverity } from '@hcengineering/ui'
  import { getObjectId, ObjectPresenter, statusStore } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'
  import { taskTypeStore } from '..'
  import EstimateBlockedToast from './EstimateBlockedToast.svelte'

  export let value: Task | Task[]
  export let width: 'medium' | 'large' | 'full' = 'medium'
  export let placeholder: IntlString
  export let _class: Ref<Class<Status>>
  export let embedded: boolean = false

  const dispatch = createEventDispatcher()
  const client = getClient()
  let progress = false
  const changeStatus = async (newStatus: any) => {
    if (newStatus === undefined) {
      dispatch('close', undefined)
      return
    }
    progress = true
    const docs = Array.isArray(value) ? value : [value]

    // Estimate gate (backlog #1): the same feedback the details-page dropdown gives, for the shared
    // Set-Status action (context menu / bulk / keybinding, list AND board). task-resources is upstream
    // of tracker, so this uses a structural `estimation` check rather than a tracker.class.Issue ref.
    const cat = $statusStore.byId.get(newStatus)?.category
    const blocked = (d: Task): boolean =>
      d.status !== newStatus &&
      cat === task.statusCategory.Active &&
      'estimation' in d &&
      ((d as any).estimation ?? 0) <= 0
    const blockedDocs = docs.filter(blocked)
    if (blockedDocs.length > 0) {
      const ids = blockedDocs
        .map((d) => (d as any).identifier as string | undefined)
        .filter((s): s is string => s != null && s !== '')
      addNotification(
        'Set an estimate first',
        ids.length > 0
          ? `Add an estimate to ${ids.join(', ')} before moving it to a started status.`
          : 'Add an estimate before moving it to a started status.',
        EstimateBlockedToast,
        undefined,
        NotificationSeverity.Error
      )
    }

    const ops = client.apply(undefined, 'set-status')
    const changed = (d: Task) => d.status !== newStatus && !blocked(d)
    for (const it of docs.filter(changed)) {
      await ops.update(it, { status: newStatus })
    }
    await ops.commit()

    progress = false

    dispatch('close', newStatus)
    const ids = await getAnalyticsIds(docs)
    Analytics.handleEvent('task.SetStatus', { status: newStatus, objects: ids })
  }

  async function getAnalyticsIds (docs: Task[]): Promise<string[]> {
    const result: string[] = []

    for (const doc of docs) {
      const id = await getObjectId(doc, client.getHierarchy())
      result.push(id)
    }
    return result
  }

  $: current = Array.isArray(value)
    ? value.every((v) => v.status === (value as Array<Task>)[0].status)
      ? value[0].status
      : undefined
    : value.status

  $: kind = Array.isArray(value)
    ? value.every((v) => v.kind === (value as Array<Task>)[0].kind)
      ? value[0].kind
      : undefined
    : value.kind

  function updateStatuses (taskTypes: IdMap<TaskType>, store: IdMap<Status>, kind: Ref<TaskType> | undefined): void {
    if (kind === undefined) {
      statuses = []
    } else {
      const type = taskTypes.get(kind)
      if (type !== undefined) {
        statuses = type.statuses.map((p) => store.get(p)).filter((p) => p !== undefined)
      }
    }
  }

  $: updateStatuses($taskTypeStore, $statusStore.byId, kind)

  let statuses: Status[] = []
  let searchQuery: string = ''
  $: filteredStatuses = !searchQuery
    ? statuses
    : statuses.filter((status) => (status.name ?? '').toLowerCase().includes(searchQuery.toLowerCase()))
</script>

<DocPopup
  {_class}
  objects={filteredStatuses}
  allowDeselect={true}
  selected={current}
  on:close={(evt) => {
    void changeStatus(evt.detail === null ? null : evt.detail?._id)
  }}
  {placeholder}
  {width}
  {embedded}
  loading={progress}
  on:changeContent
  on:search={(e) => (searchQuery = e.detail)}
>
  <svelte:fragment slot="item" let:item>
    <div class="flex-row-center flex-grow overflow-label">
      <ObjectPresenter
        objectId={item._id}
        _class={item._class}
        value={item}
        inline={false}
        noUnderline
        props={{
          disabled: true,
          inline: false,
          size: 'small',
          avatarSize: 'smaller',
          taskType: kind,
          projectType: kind !== undefined ? $taskTypeStore.get(kind)?.parent : undefined
        }}
      />
    </div>
  </svelte:fragment>
</DocPopup>
