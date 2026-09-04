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
  Designation, Employment status, Location). Each list lives as ygHr.class.* docs in
  core.space.Workspace (a mainSpace, so every workspace user can read them for their own profile
  dropdowns). Add/rename/remove write straight to the doc, no separate save step, same idiom as
  WorkProfileEditor.svelte.

  Gating: create/update/remove of these four classes IS guarded server-side - guardHrConfigWrite
  (called from OnEmployeeHrGuard in server-plugins/yg-hr-resources) reverts any write not made by an
  Owner/Maintainer or a member of the Roster-managed HR team (ygTimesheet.space.HrData). This
  screen's HR/admin gate is the matching client-side affordance: it keeps the edit surface out of
  casual reach so a non-HR user never sees controls that would just be reverted, same idiom as
  HrLatePermissions.svelte's isHr check.
-->
<script lang="ts">
  import core, { AccountRole, getCurrentAccount, hasAccountRole, type Class, type Data, type Doc, type DocumentUpdate, type Ref } from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { IconAdd, IconDelete, Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import ygHr, {
    isSystemDesignation,
    type Department,
    type Designation,
    type EmploymentStatus,
    type HrListItem,
    type Location,
    type TerminationReason
  } from '@hcengineering/yg-hr'

  const client = getClient()

  // Who may edit: workspace Owner/Maintainer, or a member of the Roster-managed HR team
  // (ygTimesheet.space.HrData) - the single source of truth the timesheet features and the server
  // guard use (replaced the old per-designation isHr flag). Same gate the directory/profile use.
  const isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  let empLoaded = false
  let isHrMember = false
  const hrQuery = createQuery()
  hrQuery.query(core.class.Space, { _id: ygTimesheet.space.HrData }, (res) => {
    const space = res[0]
    isHrMember = space !== undefined && (space.members ?? []).includes(getCurrentAccount().uuid)
    empLoaded = true
  })

  let departments: Department[] = []
  let designations: Designation[] = []
  let employmentStatuses: EmploymentStatus[] = []
  let locations: Location[] = []
  let terminationReasons: TerminationReason[] = []
  let desigLoaded = false

  const depQuery = createQuery()
  depQuery.query(ygHr.class.Department, {}, (res) => { departments = res })
  const desigQuery = createQuery()
  desigQuery.query(ygHr.class.Designation, {}, (res) => { designations = res; desigLoaded = true })
  const statusQuery = createQuery()
  statusQuery.query(ygHr.class.EmploymentStatus, {}, (res) => { employmentStatuses = res })
  const locQuery = createQuery()
  locQuery.query(ygHr.class.Location, {}, (res) => { locations = res })
  const termQuery = createQuery()
  termQuery.query(ygHr.class.TerminationReason, {}, (res) => { terminationReasons = res })

  $: ready = empLoaded && desigLoaded
  $: isHr = isAdmin || isHrMember

  const byName = <T extends { name: string }>(list: T[]): T[] => [...list].sort((a, b) => a.name.localeCompare(b.name))
  $: sortedDepartments = byName(departments)
  $: sortedDesignations = byName(designations)
  $: sortedEmploymentStatuses = byName(employmentStatuses)
  $: sortedLocations = byName(locations)
  $: sortedTerminationReasons = byName(terminationReasons)

  async function addItem<T extends HrListItem> (_class: Ref<Class<T>>, name: string): Promise<void> {
    const trimmed = name.trim()
    if (trimmed === '') return
    const data: Data<T> = { name: trimmed }
    // core.space.Workspace (a mainSpace), NOT the old HrConfig space - that space's data was
    // unreadable to non-members (see models/yg-hr/src/migration.ts's HR_LIST_SPACE note). Existing
    // items were relocated there by the migration; new items must land there too.
    await client.createDoc(_class, core.space.Workspace, data)
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

  // One-shot label resolution for plain-string attributes (aria-label, placeholder) that can't
  // bind a <Label> component directly.
  let addLabel = ''
  let removeLabel = ''
  let systemDesignationHint = ''
  void translate(ygHr.string.SystemDesignationHint, {}).then((r) => { systemDesignationHint = r })
  let departmentPlaceholder = ''
  let designationPlaceholder = ''
  let employmentStatusPlaceholder = ''
  let locationPlaceholder = ''
  let terminationReasonPlaceholder = ''
  void translate(ygHr.string.AddItem, {}).then((r) => { addLabel = r })
  void translate(ygHr.string.RemoveItem, {}).then((r) => { removeLabel = r })
  void translate(ygHr.string.Department, {}).then((r) => { departmentPlaceholder = `+ ${r}` })
  void translate(ygHr.string.Designation, {}).then((r) => { designationPlaceholder = `+ ${r}` })
  void translate(ygHr.string.EmploymentStatus, {}).then((r) => { employmentStatusPlaceholder = `+ ${r}` })
  void translate(ygHr.string.Location, {}).then((r) => { locationPlaceholder = `+ ${r}` })
  void translate(ygHr.string.TerminationReason, {}).then((r) => { terminationReasonPlaceholder = `+ ${r}` })

  let newDepartment = ''
  let newDesignation = ''
  let newEmploymentStatus = ''
  let newLocation = ''
  let newTerminationReason = ''

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
  function submitTerminationReason (): void {
    void addItem(ygHr.class.TerminationReason, newTerminationReason)
    newTerminationReason = ''
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
              {@const locked = isSystemDesignation(item.name)}
              <div class="hs-row">
                <input
                  class="hs-input"
                  type="text"
                  value={item.name}
                  readonly={locked}
                  on:change={(e) => { if (!locked) void renameItem(item, e.currentTarget.value) }}
                />
                {#if locked}
                  <span class="hs-lock" title={systemDesignationHint}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                  </span>
                {:else}
                  <button class="hs-icon-btn hs-icon-btn--danger" aria-label={removeLabel} on:click={() => { void removeItem(item) }}>
                    <IconDelete size={'small'} />
                  </button>
                {/if}
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

        <div class="hs-card">
          <div class="hs-card__title"><Label label={ygHr.string.TerminationReasons} /></div>
          <div class="hs-list">
            {#each sortedTerminationReasons as item (item._id)}
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
          <form class="hs-add" on:submit|preventDefault={submitTerminationReason}>
            <input class="hs-input" type="text" placeholder={terminationReasonPlaceholder} bind:value={newTerminationReason} />
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
    padding: 22px 26px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  .hs-card__title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--theme-halfcontent-color);
    margin-bottom: 14px;
  }

  .hs-list { display: flex; flex-direction: column; }
  .hs-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .hs-row:last-child { border-bottom: none; }
  .hs-empty {
    font-size: 14px;
    color: var(--theme-trans-color);
    padding: 10px 0;
  }

  .hs-input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 14.5px;
    color: var(--theme-content-color);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 9px;
    padding: 9px 11px;
  }
  .hs-input:hover { border-color: var(--theme-divider-color); }
  .hs-input:focus {
    outline: none;
    border-color: var(--yg-accent);
    background: var(--theme-comp-header-color);
  }
  .hs-input::placeholder { color: var(--theme-text-placeholder-color); }

  .hs-lock {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex: none;
    color: var(--theme-trans-color);
    cursor: help;
  }
  .hs-lock svg {
    width: 15px;
    height: 15px;
  }
  .hs-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: 9px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    color: var(--theme-halfcontent-color);
  }
  .hs-icon-btn:hover { background: var(--theme-comp-header-color); }
  .hs-icon-btn--danger:hover { color: var(--theme-caption-color); }
  // Black/white primary action (YG theme) - same treatment as the directory's "Add employee" and
  // the profile header's Edit toggle (.yg-btn-dark), replacing the earlier teal accent fill.
  .hs-icon-btn--accent {
    background: #14181b;
    color: #ffffff;
  }
  .hs-icon-btn--accent:hover { background: #23292d; }
  :global(.theme-dark) .hs-icon-btn--accent {
    border-color: rgba(255, 255, 255, 0.16);
  }

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
