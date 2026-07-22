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
  import { Contact, Employee, getCurrentEmployee, Person } from '@hcengineering/contact'
  import { DocumentQuery, FindOptions, Ref } from '@hcengineering/core'
  import type { Asset, IntlString } from '@hcengineering/platform'
  import presentation, { createQuery } from '@hcengineering/presentation'
  import {
    AnySvelteComponent,
    EditWithIcon,
    FocusHandler,
    Icon,
    IconCheck,
    IconSearch,
    Label,
    ListView,
    Spinner,
    createFocusManager,
    deviceOptionsStore,
    resizeObserver,
    tooltip
  } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { get } from 'svelte/store'
  import { AssigneeCategory } from '../assignee'
  import contact from '../plugin'
  import { employeeByIdStore } from '../utils'
  import UserInfo from './UserInfo.svelte'

  export let options: FindOptions<Contact> | undefined = undefined
  export let selected: Ref<Person> | undefined
  export let docQuery: DocumentQuery<Contact> | undefined = undefined
  export let categories: AssigneeCategory[] | undefined = undefined
  export let allowDeselect = true
  export let titleDeselect: IntlString | undefined
  export let placeholder: IntlString = presentation.string.Search
  export let placeholderParam: any | undefined = undefined
  export let ignoreUsers: Ref<Person>[] = []
  export let shadows: boolean = true
  export let width: 'medium' | 'large' | 'full' = 'medium'
  export let searchField: string = 'name'
  export let icon: Asset | AnySvelteComponent | undefined = undefined
  export let loading = false

  $: showCategories = categories !== undefined && categories.length > 0

  let search: string = ''
  let objects: Contact[] = []
  let contacts: Contact[] = []

  const categorizedPersons = new Map<Ref<Person>, AssigneeCategory>()

  const dispatch = createEventDispatcher()
  const query = createQuery()

  // The default `{ active: true }` query (no per-issue DocRules restrictions) can be answered
  // instantly from the already-cached, always-on employeeByIdStore (see utils.ts) instead of
  // waiting on a fresh server round-trip on every popup open/keystroke. The live query below
  // still runs unconditionally and reconciles the authoritative result shortly after, so this
  // is purely a "paint immediately, then correct" optimization - it never replaces the query.
  function isDefaultActiveQuery (q: DocumentQuery<Contact> | undefined): boolean {
    if (q === undefined) return true
    const keys = Object.keys(q)
    return keys.length === 1 && keys[0] === 'active' && q.active === true
  }

  function seedFromCache (searchText: string, ignore: Ref<Person>[]): Contact[] {
    const needle = searchText.trim().toLowerCase()
    const ignoreSet = new Set(ignore)
    return (Array.from(get(employeeByIdStore).values()) as Employee[])
      .filter(
        (e) => e.active && !ignoreSet.has(e._id) && (needle === '' || (e.name ?? '').toLowerCase().includes(needle))
      )
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      .slice(0, 200) as unknown as Contact[]
  }

  $: {
    if (searchField === 'name' && isDefaultActiveQuery(docQuery)) {
      objects = seedFromCache(search, ignoreUsers)
    }
    query.query<Contact>(
      contact.mixin.Employee,
      {
        ...(docQuery ?? {}),
        [searchField]: { $like: '%' + search + '%' },
        _id: {
          ...(typeof docQuery?._id === 'object' ? docQuery._id : {}),
          $nin: ignoreUsers
        }
      },
      (result) => {
        objects = result
      },
      { ...(options ?? {}), limit: 200, sort: { name: 1 } }
    )
  }

  let dataLoading = false

  $: {
    dataLoading = true
    updateCategories(objects, categories).then(() => {
      dataLoading = false
    })
  }

  const currentUserCategory: AssigneeCategory = {
    label: contact.string.CategoryCurrentUser,
    func: async () => {
      const employee = getCurrentEmployee()
      return [employee]
    }
  }

  const assigned: AssigneeCategory = {
    label: contact.string.Assigned,
    func: async () => {
      return selected ? [selected] : []
    }
  }

  const otherCategory: AssigneeCategory = {
    label: contact.string.CategoryOther,
    func: async (val: Ref<Contact>[]) => {
      return val
    }
  }

  async function updateCategories (objects: Contact[], categories: AssigneeCategory[] | undefined) {
    const refs = objects.map((e) => e._id)
    const categoryOrder = [currentUserCategory, assigned, ...(categories ?? []), otherCategory]

    // The ListView renders a category header wherever two adjacent items differ in category, so the
    // list must be emitted grouped by category (in priority order) - not in map insertion order,
    // which would interleave groups as people get promoted out of "Other" below.
    function rebuildContacts (): void {
      const next: Contact[] = []
      for (const category of categoryOrder) {
        for (const c of objects) {
          if (categorizedPersons.get(c._id) === category) {
            next.push(c)
          }
        }
      }
      contacts = next
    }

    // Seed every candidate into the catch-all "Other" bucket first (synchronous, no I/O) so the full
    // list is usable right away, instead of staying empty until every category below resolves - some
    // categories (e.g. "previous assignees", computed from an issue's tx history) are per-issue server
    // queries that can be slow. Each category then promotes its members out of "Other" as it resolves,
    // in the same priority order as before (earlier category wins), converging to the same end state.
    for (const contact of await otherCategory.func(refs)) {
      categorizedPersons.set(contact, otherCategory)
    }
    rebuildContacts()
    // The full candidate list is visible from here on - the loop below only refines grouping,
    // so stop the search-field spinner now instead of letting it run for the slow per-issue
    // category queries (e.g. "previous assignees") and read as "list still loading".
    dataLoading = false

    for (const category of [currentUserCategory, assigned, ...(categories ?? [])]) {
      const res = await category.func(refs)
      for (const contact of res) {
        if (categorizedPersons.get(contact) !== otherCategory) continue
        categorizedPersons.set(contact, category)
      }
      rebuildContacts()
    }
  }

  let selection = 0
  let list: ListView

  async function handleSelection (evt: Event | undefined, selection: number): Promise<void> {
    const person = contacts[selection]
    selected = allowDeselect && person?._id === selected ? undefined : person?._id
    dispatch('close', selected !== undefined ? person : undefined)
  }

  function onKeydown (key: KeyboardEvent): void {
    if (key.code === 'ArrowUp') {
      key.stopPropagation()
      key.preventDefault()
      list.select(selection - 1)
    }
    if (key.code === 'ArrowDown') {
      key.stopPropagation()
      key.preventDefault()
      list.select(selection + 1)
    }
    if (key.code === 'Enter') {
      key.preventDefault()
      key.stopPropagation()
      handleSelection(key, selection)
    }
  }
  const manager = createFocusManager()

  function toAny (obj: any): any {
    return obj
  }
</script>

<FocusHandler {manager} />

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="selectPopup"
  class:full-width={width === 'full'}
  class:plainContainer={!shadows}
  class:width-40={width === 'large'}
  on:keydown={onKeydown}
  use:resizeObserver={() => {
    dispatch('changeContent')
  }}
>
  <div class="header">
    <EditWithIcon
      icon={IconSearch}
      size={'large'}
      width={'100%'}
      autoFocus={!$deviceOptionsStore.isMobile}
      bind:value={search}
      {placeholder}
      {placeholderParam}
      loading={dataLoading}
      on:change
    />
  </div>
  <div class="scroll">
    <div class="box">
      <ListView bind:this={list} count={contacts.length} bind:selection>
        <svelte:fragment slot="category" let:item>
          {#if showCategories}
            {@const obj = toAny(contacts[item])}
            {@const category = categorizedPersons.get(obj._id)}
            <!-- {@const cl = hierarchy.getClass(contacts[item]._class)} -->
            {#if category !== undefined && (item === 0 || (item > 0 && categorizedPersons.get(toAny(contacts[item - 1])._id) !== categorizedPersons.get(obj._id)))}
              <!--Category for first item-->
              {#if item > 0}<div class="menu-separator" />{/if}
              <div class="menu-group__header flex-row-center category-box">
                <span class="overflow-label">
                  <Label label={category.label} />
                </span>
              </div>
            {/if}
          {/if}
        </svelte:fragment>
        <svelte:fragment slot="item" let:item>
          {@const obj = contacts[item]}
          <button
            class="menu-item withList no-focus w-full"
            class:selected={obj._id === selected}
            on:click={() => {
              handleSelection(undefined, item)
            }}
          >
            <div class="flex-grow clear-mins">
              <UserInfo size={'smaller'} value={obj} {icon} />
            </div>
            {#if allowDeselect && selected}
              {#if loading && obj._id === selected}
                <Spinner size={'small'} />
              {:else}
                <div class="check">
                  {#if obj._id === selected}
                    <div use:tooltip={{ label: titleDeselect ?? presentation.string.Deselect }}>
                      <Icon icon={IconCheck} size={'small'} />
                    </div>
                  {/if}
                </div>
              {/if}
            {/if}
          </button>
        </svelte:fragment>
      </ListView>
    </div>
  </div>
  <div class="menu-space" />
</div>

<style lang="scss">
  .plainContainer {
    color: var(--caption-color);
    background-color: var(--theme-bg-color);
    border: 1px solid var(--button-border-color);
    border-radius: 0.25rem;
    box-shadow: none;
  }
</style>
