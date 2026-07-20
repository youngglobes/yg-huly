<!--
// Copyright © 2022 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { AttachmentsPresenter } from '@hcengineering/attachment-resources'
  import {
    CategoryType,
    Class,
    Doc,
    DocumentQuery,
    DocumentUpdate,
    FindOptions,
    generateId,
    Lookup,
    mergeQueries,
    Ref,
    WithLookup
  } from '@hcengineering/core'
  import { Item, Kanban as KanbanUI } from '@hcengineering/kanban'
  import notification from '@hcengineering/notification'
  import { ActionContext, createQuery, getClient } from '@hcengineering/presentation'
  import tags from '@hcengineering/tags'
  import { DocWithRank, getStates } from '@hcengineering/task'
  import { getTaskKanbanResultQuery, typeStore, updateTaskKanbanCategories } from '@hcengineering/task-resources'
  import { Issue, IssuesGrouping, IssuesOrdering, Project } from '@hcengineering/tracker'
  import {
    Button,
    ColorDefinition,
    Component,
    getEventPositionElement,
    IconAdd,
    Label,
    Loading,
    showPopup,
    themeStore
  } from '@hcengineering/ui'
  import view, { AttributeModel, BuildModelKey, Viewlet, ViewOptionModel, ViewOptions } from '@hcengineering/view'
  import {
    enabledConfig,
    focusStore,
    getCategoryQueryNoLookup,
    getCategoryQueryNoLookupOptions,
    getCategoryQueryProjection,
    getGroupByValues,
    getPresenter,
    groupBy,
    ListSelectionProvider,
    Menu,
    noCategory,
    openDoc,
    SelectDirection,
    setGroupByValues,
    showMenu,
    statusStore
  } from '@hcengineering/view-resources'
  import { onMount } from 'svelte'

  import tracker from '../../plugin'
  import { activeProjects } from '../../utils'
  import ComponentEditor from '../components/ComponentEditor.svelte'
  import CreateIssue from '../CreateIssue.svelte'
  import AssigneeEditor from './AssigneeEditor.svelte'
  import DueDatePresenter from './DueDatePresenter.svelte'
  import SubIssuesSelector from './edit/SubIssuesSelector.svelte'
  import IssuePresenter from './IssuePresenter.svelte'
  import ParentNamesPresenter from './ParentNamesPresenter.svelte'
  import PriorityEditor from './PriorityEditor.svelte'
  import StatusEditor from './StatusEditor.svelte'
  import MilestoneEditor from '../milestones/MilestoneEditor.svelte'

  const _class = tracker.class.Issue
  export let space: Ref<Project> | undefined = undefined
  export let baseMenuClass: Ref<Class<Doc>> | undefined = undefined
  export let query: DocumentQuery<Issue> = {}
  export let viewOptionsConfig: ViewOptionModel[] | undefined = undefined
  export let viewOptions: ViewOptions
  export let viewlet: Viewlet
  export let config: (string | BuildModelKey)[]
  export let options: FindOptions<DocWithRank> | undefined = undefined

  $: groupByKey = (viewOptions.groupBy[0] ?? noCategory) as IssuesGrouping
  $: orderBy = viewOptions.orderBy

  let accentColors = new Map<string, ColorDefinition>()
  const setAccentColor = (n: number, ev: CustomEvent<ColorDefinition>) => {
    accentColors.set(`${n}${$themeStore.dark}${groupByKey}`, ev.detail)
    accentColors = accentColors
  }

  $: dontUpdateRank = orderBy[0] !== IssuesOrdering.Manual

  $: currentSpace = space ?? tracker.project.DefaultProject
  let currentProject: Project | undefined
  $: currentProject = $activeProjects.get(currentSpace) as Project

  let resultQuery: DocumentQuery<any> = { ...query }
  const client = getClient()

  $: void getTaskKanbanResultQuery(client.getHierarchy(), query, viewOptionsConfig, viewOptions).then((p) => {
    resultQuery = mergeQueries(p, query)
  })

  $: queryNoLookup = getCategoryQueryNoLookup(resultQuery)

  function toIssue (object: any): WithLookup<Issue> {
    return object as WithLookup<Issue>
  }

  const lookup: Lookup<Issue> = {
    ...(options?.lookup ?? {}),
    attachedTo: tracker.class.Issue,
    _id: {
      subIssues: tracker.class.Issue
    }
  }

  $: resultOptions = { ...options, lookup, ...(orderBy !== undefined ? { sort: { [orderBy[0]]: orderBy[1] } } : {}) }

  let kanbanUI: KanbanUI
  const listProvider = new ListSelectionProvider((offset: 1 | -1 | 0, of?: Doc, dir?: SelectDirection) => {
    kanbanUI?.select(offset, of, dir)
  })
  const selection = listProvider.selection

  onMount(() => {
    ;(document.activeElement as HTMLElement)?.blur()
  })

  // Category information only
  let tasks: DocWithRank[] = []

  $: groupByDocs = groupBy(tasks, groupByKey, categories)

  let fastDocs: DocWithRank[] = []
  let slowDocs: DocWithRank[] = []

  const docsQuery = createQuery()
  const docsQuerySlow = createQuery()

  let fastQueryIds = new Set<Ref<DocWithRank>>()

  let categoryQueryOptions: Partial<FindOptions<DocWithRank>>
  $: categoryQueryOptions = {
    ...getCategoryQueryNoLookupOptions(resultOptions),
    projection: {
      ...resultOptions.projection,
      _id: 1,
      _class: 1,
      rank: 1,
      ...getCategoryQueryProjection(client.getHierarchy(), _class, queryNoLookup, viewOptions.groupBy)
    }
  }

  $: docsQuery.query(
    _class,
    queryNoLookup,
    (res) => {
      fastDocs = res
      fastQueryIds = new Set(res.map((it) => it._id))
    },
    { ...categoryQueryOptions, limit: 1000 }
  )
  $: docsQuerySlow.query(
    _class,
    queryNoLookup,
    (res) => {
      slowDocs = res
    },
    categoryQueryOptions
  )

  $: tasks = [...fastDocs, ...slowDocs.filter((it) => !fastQueryIds.has(it._id))]

  $: listProvider.update(tasks)

  let categories: CategoryType[] = []
  let loadCategories = true

  const queryId = generateId()

  function update (): void {
    void updateTaskKanbanCategories(
      client,
      viewlet,
      _class,
      space,
      tasks,
      groupByKey,
      viewOptions,
      viewOptionsConfig,
      update,
      queryId
    ).then((res) => {
      categories = res
      loadCategories = false
    })
  }

  $: void updateTaskKanbanCategories(
    client,
    viewlet,
    _class,
    space,
    tasks,
    groupByKey,
    viewOptions,
    viewOptionsConfig,
    update,
    queryId
  ).then((res) => {
    categories = res
    loadCategories = false
  })

  const fullFilled: Record<string, boolean> = {}

  function getHeader (_class: Ref<Class<Doc>>, groupByKey: string): void {
    if (groupByKey === noCategory) {
      headerComponent = undefined
    } else {
      void getPresenter(client, _class, { key: groupByKey }, { key: groupByKey }).then((p) => {
        headerComponent = p
      })
    }
  }

  let headerComponent: AttributeModel | undefined
  $: getHeader(_class, groupByKey)

  const getUpdateProps = (doc: Doc, category: CategoryType): DocumentUpdate<Item> | undefined => {
    const groupValue =
      typeof category === 'object' ? category.values.find((it) => it.space === doc.space)?._id : category
    if (groupValue === undefined) {
      return undefined
    }
    return {
      [groupByKey]: groupValue,
      space: doc.space
    }
  }

  const getAvailableCategories = async (doc: Doc): Promise<CategoryType[]> => {
    const issue = toIssue(doc)

    if ([IssuesGrouping.Component, IssuesGrouping.Milestone].includes(groupByKey)) {
      const availableCategories = []
      const clazz = client.getHierarchy().getAttribute(tracker.class.Issue, groupByKey)

      for (const category of categories) {
        if (!category || (issue as any)[groupByKey] === category) {
          availableCategories.push(category)
        } else if (clazz !== undefined && 'to' in clazz.type) {
          const categoryDoc = await client.findOne(clazz.type.to as Ref<Class<Doc>>, {
            _id: category as Ref<Doc>,
            space: issue.space
          })

          if (categoryDoc) {
            availableCategories.push(category)
          }
        }
      }

      return availableCategories
    }

    if (groupByKey === IssuesGrouping.Status) {
      const space = await client.findOne(tracker.class.Project, { _id: issue.space })
      return getStates(space, $typeStore, $statusStore.byId).map(({ _id }) => _id)
    }

    return categories
  }
</script>

{#if loadCategories}
  <Loading />
{:else}
  <ActionContext
    context={{
      mode: 'browser'
    }}
  />
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <KanbanUI
    bind:this={kanbanUI}
    {categories}
    {dontUpdateRank}
    {_class}
    query={resultQuery}
    options={resultOptions}
    objects={tasks}
    getGroupByValues={(groupByDocs, category) =>
      groupByKey === noCategory ? tasks : getGroupByValues(groupByDocs, category)}
    {setGroupByValues}
    {getUpdateProps}
    {groupByDocs}
    {groupByKey}
    on:obj-focus={(evt) => {
      listProvider.updateFocus(evt.detail)
    }}
    {getAvailableCategories}
    selection={listProvider.current($focusStore)}
    checked={$selection ?? []}
    on:check={(evt) => {
      listProvider.updateSelection(evt.detail.docs, evt.detail.value)
    }}
    on:contextmenu={(evt) => {
      showMenu(evt.detail.evt, { object: evt.detail.objects, baseMenuClass })
    }}
  >
    <svelte:fragment slot="header" let:state let:count let:index>
      <div class="header flex-between">
        <div class="flex-row-center gap-1">
          <span
            class="clear-mins fs-bold overflow-label pointer-events-none"
            style:color={'var(--theme-caption-color)'}
          >
            {#if groupByKey === noCategory}
              <Label label={view.string.NoGrouping} />
            {:else if headerComponent}
              <svelte:component
                this={headerComponent.presenter}
                value={state}
                {space}
                size={'small'}
                kind={'list-header'}
                display={'kanban'}
                colorInherit={true}
                accent
                on:accent-color={(ev) => {
                  setAccentColor(index, ev)
                }}
              />
            {/if}
          </span>
          <span class="counter ml-1">
            {count}
          </span>
        </div>
        <div class="tools gap-1">
          <Button
            icon={IconAdd}
            kind={'ghost'}
            showTooltip={{ label: tracker.string.AddIssueTooltip, direction: 'left' }}
            on:click={() => {
              showPopup(CreateIssue, { space: currentSpace, [groupByKey]: state }, 'top')
            }}
          />
        </div>
      </div>
    </svelte:fragment>
    <svelte:fragment slot="card" let:object>
      {@const issue = toIssue(object)}
      {@const issueId = object._id}
      {#key issueId}
        <div
          class="tracker-card"
          on:click={() => {
            void openDoc(client.getHierarchy(), issue)
          }}
        >
          <div class="card-header flex-between">
            <div class="flex-row-center text-sm">
              <div class="mr-1">
                <StatusEditor value={issue} kind="list" isEditable={false} />
              </div>
              <div class="flex-no-shrink">
                <IssuePresenter value={issue} />
              </div>
              <ParentNamesPresenter value={issue} />
            </div>
            <div class="flex-row-center gap-2 reverse flex-no-shrink">
              <Component is={notification.component.NotificationPresenter} props={{ value: object }} />
            </div>
          </div>
          <div class="card-content text-md caption-color lines-limit-2">
            {object.title}
          </div>
          <div class="card-labels metadata">
            <AssigneeEditor object={issue} avatarSize={'smaller'} shouldShowName={false} />
            {#if enabledConfig(config, 'labels')}
              <Component
                is={tags.component.LabelsPresenter}
                props={{
                  value: issue.labels,
                  object: issue,
                  ckeckFilled: fullFilled[issueId],
                  kind: 'link',
                  compression: true
                }}
                on:change={(res) => {
                  if (res.detail.full) fullFilled[issueId] = true
                }}
              />
            {/if}
            {#if enabledConfig(config, 'component') && issue.component != null}
              <ComponentEditor
                value={issue}
                {space}
                isEditable={true}
                kind={'link-bordered'}
                size={'small'}
                justify={'center'}
              />
            {/if}
            {#if enabledConfig(config, 'milestone') && issue.milestone != null}
              <MilestoneEditor
                value={issue}
                {space}
                isEditable={true}
                kind={'link-bordered'}
                size={'small'}
                justify={'center'}
              />
            {/if}
            {#if enabledConfig(config, 'dueDate')}
              <DueDatePresenter value={issue} size={'small'} kind={'link-bordered'} />
            {/if}
            {#if enabledConfig(config, 'subIssues') && issue && issue.subIssues > 0}
              <SubIssuesSelector value={issue} {currentProject} size={'small'} />
            {/if}
            {#if enabledConfig(config, 'priority')}
              <PriorityEditor
                value={issue}
                isEditable={true}
                kind={'link-bordered'}
                size={'small'}
                justify={'center'}
              />
            {/if}
            {#if enabledConfig(config, 'attachments') && (object.attachments ?? 0) > 0}
              <AttachmentsPresenter value={object.attachments} {object} />
            {/if}
          </div>
        </div>
      {/key}
    </svelte:fragment>
    <svelte:fragment slot="afterCard" let:state>
      <button
        class="add-task"
        on:click={() => {
          showPopup(
            CreateIssue,
            { space: currentSpace, ...(groupByKey !== noCategory ? { [groupByKey]: state } : {}) },
            'top'
          )
        }}
      >
        <IconAdd size={'small'} />
        <span>Add new task</span>
      </button>
    </svelte:fragment>
  </KanbanUI>
{/if}

<style lang="scss">
  .header {
    margin: 0 0.5rem 0.125rem;
    padding: 0 0.5rem 0 0.625rem;
    height: 2.75rem;
    min-height: 2.75rem;
    border: none;
    border-radius: 0.625rem;
    font-weight: 600;

    .counter {
      color: var(--theme-dark-color);
      font-weight: 500;
    }
    .tools {
      opacity: 1;
    }
  }
  .add-task {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    width: 100%;
    margin: 0.25rem 0 0.5rem;
    padding: 0.4375rem 0.625rem;
    border: none;
    background: none;
    color: var(--theme-dark-color);
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: 0.4375rem;
    cursor: pointer;

    &:hover {
      background-color: var(--theme-button-hovered);
      color: var(--theme-caption-color);
    }
  }
  .tracker-card {
    position: relative;
    display: flex;
    flex-direction: column;
    border-radius: 0.4375rem;

    .card-header {
      padding: 0.625rem 0.875rem 0;
    }
    .card-content {
      margin: 0.375rem 0.875rem;
      font-weight: 500;
    }
    /* Global styles in components.scss */
    .card-labels {
      display: flex;
      flex-wrap: nowrap;
      margin: 0 0.75rem 0 0.875rem;
      min-width: 0;

      /* Single Notion-style metadata row: avatar + chips, left-clustered. */
      &.metadata {
        flex-wrap: wrap;
        align-items: center;
        margin: 0.125rem 0.875rem 0.625rem;
      }
    }
  }
</style>
