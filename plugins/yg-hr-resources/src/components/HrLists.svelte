<!--
// Copyright © 2026 YoungGlobes
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
<!--
  HR "Settings" special: manage the four admin lists behind every employee profile (Department,
  Designation, Employment status, Location). Each list lives as ygHr.class.* docs in the shared,
  non-private ygHr.space.HrConfig space (so every workspace user can read them for their own
  profile dropdowns). Add/rename/remove write straight to the doc, no separate save step, same
  idiom as WorkProfileEditor.svelte. Designation additionally exposes the isHr flag that marks
  which designation counts as HR staff (isHrDesignationByFlag reads it).

  Gating: HrConfig is not private, and no server trigger guards writes to these four classes (only
  the EmployeePersonal/Contact/Job mixins and EmergencyContact are guarded - see
  OnEmployeeHrGuard in server-plugins/yg-hr-resources), so this screen's HR/admin gate is UI-only,
  same caveat as HrLatePermissions.svelte's isHr check: it keeps the edit surface out of casual
  reach, it is not the security boundary.
-->
<script lang="ts">
  import { AccountRole, getCurrentAccount, hasAccountRole, type Class, type Data, type Doc, type DocumentUpdate, type Ref } from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { IconAdd, IconDelete, Label } from '@hcengineering/ui'
  import contact, { getCurrentEmployee } from '@hcengineering/contact'
  import ygHr, {
    isHrDesignationByFlag,
    type Department,
    type Designation,
    type EmploymentStatus,
    type HrListItem,
    type Location
  } from '@hcengineering/yg-hr'

  const client = getClient()
  const h = client.getHierarchy()

  // Who may edit: workspace Owner/Maintainer, or the current user's own designation is flagged HR.
  // Mirrors HrLatePermissions.svelte's isAdmin || isHrDesignation(...) gate.
  const isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)
  const me = getCurrentEmployee()

  let empLoaded = false
  let myDesignationRef: Ref<Designation> | undefined
  const empQuery = createQuery()
  empQuery.query(contact.mixin.Employee, { _id: me }, (res) => {
    const emp = res[0]
    myDesignationRef = emp !== undefined && h.hasMixin(emp, ygHr.mixin.EmployeeJob)
      ? h.as(emp, ygHr.mixin.EmployeeJob).designation
      : undefined
    empLoaded = true
  })

  let departments: Department[] = []
  let designations: Designation[] = []
  let employmentStatuses: EmploymentStatus[] = []
  let locations: Location[] = []
  let desigLoaded = false

  const depQuery = createQuery()
  depQuery.query(ygHr.class.Department, {}, (res) => { departments = res })
  const desigQuery = createQuery()
  desigQuery.query(ygHr.class.Designation, {}, (res) => { designations = res; desigLoaded = true })
  const statusQuery = createQuery()
  statusQuery.query(ygHr.class.EmploymentStatus, {}, (res) => { employmentStatuses = res })
  const locQuery = createQuery()
  locQuery.query(ygHr.class.Location, {}, (res) => { locations = res })

  $: ready = empLoaded && desigLoaded
  $: myDesignation = designations.find((d) => d._id === myDesignationRef)
  $: isHr = isAdmin || isHrDesignationByFlag(myDesignation)

  const byName = <T extends { name: string }>(list: T[]): T[] => [...list].sort((a, b) => a.name.localeCompare(b.name))
  $: sortedDepartments = byName(departments)
  $: sortedDesignations = byName(designations)
  $: sortedEmploymentStatuses = byName(employmentStatuses)
  $: sortedLocations = byName(locations)

  async function addItem<T extends HrListItem> (_class: Ref<Class<T>>, name: string): Promise<void> {
    const trimmed = name.trim()
    if (trimmed === '') return
    const data: Data<T> = { name: trimmed }
    await client.createDoc(_class, ygHr.space.HrConfig, data)
  }

  async function renameItem<T extends HrListItem> (doc: T, name: string): Promise<void> {
    const trimmed = name.trim()
    if (trimmed === '' || trimmed === doc.name) return
    const update: DocumentUpdate<T> = { name: trimmed }
    await client.updateDoc(doc._class, doc.space, doc._id, update)
  }

  async function removeItem<T extends Doc> (doc: T): Promise<void> {
    await client.removeDoc(doc._class, doc.space, doc._id)
  }

  async function toggleIsHr (doc: Designation): Promise<void> {
    await client.updateDoc(ygHr.class.Designation, doc.space, doc._id, { isHr: doc.isHr !== true })
  }

  // One-shot label resolution for plain-string attributes (aria-label, placeholder) that can't
  // bind a <Label> component directly.
  let addLabel = ''
  let removeLabel = ''
  let departmentPlaceholder = ''
  let designationPlaceholder = ''
  let employmentStatusPlaceholder = ''
  let locationPlaceholder = ''
  void translate(ygHr.string.AddItem, {}).then((r) => { addLabel = r })
  void translate(ygHr.string.RemoveItem, {}).then((r) => { removeLabel = r })
  void translate(ygHr.string.Department, {}).then((r) => { departmentPlaceholder = `+ ${r}` })
  void translate(ygHr.string.Designation, {}).then((r) => { designationPlaceholder = `+ ${r}` })
  void translate(ygHr.string.EmploymentStatus, {}).then((r) => { employmentStatusPlaceholder = `+ ${r}` })
  void translate(ygHr.string.Location, {}).then((r) => { locationPlaceholder = `+ ${r}` })

  let newDepartment = ''
  let newDesignation = ''
  let newEmploymentStatus = ''
  let newLocation = ''

  function submitDepartment (): void {
    void addItem(ygHr.class.Department, newDepartment)
    newDepartment = ''
  }
  function submitDesignation (): void {
    void addItem(ygHr.class.Designation, newDesignation)
    newDesignation = ''
  }
  function submitEmploymentStatus (): void {
    void addItem(ygHr.class.EmploymentStatus, newEmploymentStatus)
    newEmploymentStatus = ''
  }
  function submitLocation (): void {
    void addItem(ygHr.class.Location, newLocation)
    newLocation = ''
  }
</script>

<div class="hs-page">
  {#if ready}
    <div class="hs-head">
      <h1 class="hs-title"><Label label={ygHr.string.HrSettings} /></h1>
      <p class="hs-intro"><Label label={ygHr.string.HrSettingsIntro} /></p>
    </div>

    {#if isHr}
      <div class="hs-grid">
        <div class="hs-card">
          <div class="hs-card__title"><Label label={ygHr.string.Departments} /></div>
          <div class="hs-list">
            {#each sortedDepartments as item (item._id)}
              <div class="hs-row">
                <input
                  class="hs-input"
                  type="text"
                  value={item.name}
                  on:change={(e) => { void renameItem(item, e.currentTarget.value) }}
                />
                <button
                  class="hs-icon-btn hs-icon-btn--danger"
                  aria-label={removeLabel}
                  on:click={() => { void removeItem(item) }}
                >
                  <IconDelete size={'small'} />
                </button>
              </div>
            {:else}
              <div class="hs-empty"><Label label={ygHr.string.NoItemsYet} /></div>
            {/each}
          </div>
          <form class="hs-add" on:submit|preventDefault={submitDepartment}>
            <input class="hs-input" type="text" placeholder={departmentPlaceholder} bind:value={newDepartment} />
            <button class="hs-icon-btn hs-icon-btn--accent" type="submit" aria-label={addLabel}>
              <IconAdd size={'small'} />
            </button>
          </form>
        </div>

        <div class="hs-card">
          <div class="hs-card__title"><Label label={ygHr.string.Designations} /></div>
          <div class="hs-list">
            {#each sortedDesignations as item (item._id)}
              <div class="hs-row">
                <input
                  class="hs-input"
                  type="text"
                  value={item.name}
                  on:change={(e) => { void renameItem(item, e.currentTarget.value) }}
                />
                <label class="hs-toggle">
                  <input
                    type="checkbox"
                    checked={item.isHr === true}
                    on:change={() => { void toggleIsHr(item) }}
                  />
                  <Label label={ygHr.string.IsHr} />
                </label>
                <button class="hs-icon-btn hs-icon-btn--danger" aria-label={removeLabel} on:click={() => { void removeItem(item) }}>
                  <IconDelete size={'small'} />
                </button>
              </div>
            {:else}
              <div class="hs-empty"><Label label={ygHr.string.NoItemsYet} /></div>
            {/each}
          </div>
          <form class="hs-add" on:submit|preventDefault={submitDesignation}>
            <input class="hs-input" type="text" placeholder={designationPlaceholder} bind:value={newDesignation} />
            <button class="hs-icon-btn hs-icon-btn--accent" type="submit" aria-label={addLabel}>
              <IconAdd size={'small'} />
            </button>
          </form>
        </div>

        <div class="hs-card">
          <div class="hs-card__title"><Label label={ygHr.string.EmploymentStatuses} /></div>
          <div class="hs-list">
            {#each sortedEmploymentStatuses as item (item._id)}
              <div class="hs-row">
                <input
                  class="hs-input"
                  type="text"
                  value={item.name}
                  on:change={(e) => { void renameItem(item, e.currentTarget.value) }}
                />
                <button class="hs-icon-btn hs-icon-btn--danger" aria-label={removeLabel} on:click={() => { void removeItem(item) }}>
                  <IconDelete size={'small'} />
                </button>
              </div>
            {:else}
              <div class="hs-empty"><Label label={ygHr.string.NoItemsYet} /></div>
            {/each}
          </div>
          <form class="hs-add" on:submit|preventDefault={submitEmploymentStatus}>
            <input class="hs-input" type="text" placeholder={employmentStatusPlaceholder} bind:value={newEmploymentStatus} />
            <button class="hs-icon-btn hs-icon-btn--accent" type="submit" aria-label={addLabel}>
              <IconAdd size={'small'} />
            </button>
          </form>
        </div>

        <div class="hs-card">
          <div class="hs-card__title"><Label label={ygHr.string.Locations} /></div>
          <div class="hs-list">
            {#each sortedLocations as item (item._id)}
              <div class="hs-row">
                <input
                  class="hs-input"
                  type="text"
                  value={item.name}
                  on:change={(e) => { void renameItem(item, e.currentTarget.value) }}
                />
                <button class="hs-icon-btn hs-icon-btn--danger" aria-label={removeLabel} on:click={() => { void removeItem(item) }}>
                  <IconDelete size={'small'} />
                </button>
              </div>
            {:else}
              <div class="hs-empty"><Label label={ygHr.string.NoItemsYet} /></div>
            {/each}
          </div>
          <form class="hs-add" on:submit|preventDefault={submitLocation}>
            <input class="hs-input" type="text" placeholder={locationPlaceholder} bind:value={newLocation} />
            <button class="hs-icon-btn hs-icon-btn--accent" type="submit" aria-label={addLabel}>
              <IconAdd size={'small'} />
            </button>
          </form>
        </div>
      </div>
    {:else}
      <div class="hs-restricted">
        <Label label={ygHr.string.HrSettingsRestricted} />
      </div>
    {/if}
  {/if}
</div>

<style lang="scss">
  // Local accent (petrol-teal), matching the approved mockup's --accent token. Everything else
  // (ground/surface/text/border) rides Huly's own --theme-* variables so the screen stays
  // theme-aware without introducing a parallel token system.
  .hs-page {
    --yg-accent: #0f766e;
    flex: 1;
    min-width: 0;
    padding: 28px 32px;
    overflow-y: auto;
    background: var(--theme-bg-color);
  }
  // Huly signals theme with a .theme-light/.theme-dark CLASS on an ancestor (packages/theme),
  // not a media query or [data-theme] attribute - same mechanism yg-table.scss documents.
  :global(.theme-dark) .hs-page {
    --yg-accent: #2dd4bf;
  }

  .hs-head { margin-bottom: 22px; }
  .hs-title {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--theme-caption-color);
  }
  .hs-intro {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--theme-dark-color);
    max-width: 640px;
  }

  .hs-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(280px, 1fr));
    gap: 16px;
  }
  @media (max-width: 760px) {
    .hs-grid { grid-template-columns: 1fr; }
  }

  .hs-card {
    background: var(--theme-panel-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 14px;
    padding: 18px 20px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  .hs-card__title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--theme-halfcontent-color);
    margin-bottom: 12px;
  }

  .hs-list { display: flex; flex-direction: column; }
  .hs-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .hs-row:last-child { border-bottom: none; }
  .hs-empty {
    font-size: 13px;
    color: var(--theme-trans-color);
    padding: 8px 0;
  }

  .hs-input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 13.5px;
    color: var(--theme-content-color);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 6px 8px;
  }
  .hs-input:hover { border-color: var(--theme-divider-color); }
  .hs-input:focus {
    outline: none;
    border-color: var(--yg-accent);
    background: var(--theme-comp-header-color);
  }
  .hs-input::placeholder { color: var(--theme-text-placeholder-color); }

  .hs-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--theme-dark-color);
    white-space: nowrap;
    cursor: pointer;
  }

  .hs-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    color: var(--theme-halfcontent-color);
  }
  .hs-icon-btn:hover { background: var(--theme-comp-header-color); }
  .hs-icon-btn--danger:hover { color: var(--theme-caption-color); }
  .hs-icon-btn--accent {
    background: var(--yg-accent);
    color: #04211e;
  }
  .hs-icon-btn--accent:hover { filter: brightness(1.08); background: var(--yg-accent); }

  .hs-add {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--theme-divider-color);
  }

  .hs-restricted {
    background: var(--theme-panel-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 14px;
    padding: 24px;
    color: var(--theme-dark-color);
    font-size: 14px;
    max-width: 520px;
  }
</style>
