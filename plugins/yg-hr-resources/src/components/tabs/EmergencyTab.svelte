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
  Emergency tab (Task 10): the emergencyContacts collection on the Employee (ygHr.class.
  EmergencyContact, attachedTo the Employee). While the profile-wide `editing` flag (PO UI
  refinement - the header's single Edit/Done toggle, EmployeeProfile.svelte) is on, HR/admin get
  add/edit/remove inline (same no-separate-save-step idiom as HrLists.svelte); everyone else, and
  everyone outside edit mode, sees a plain read-only list. Unlike the other three tabs' simple
  field cards, add/edit-row here keeps its own Save/Cancel - that's the inherent commit step for
  entering a brand-new collection item, not a competing whole-card edit toggle. The server-side
  OnEmployeeHrGuard trigger (Task 8) is the real authorization boundary - this UI gate just keeps
  the affordance out of casual reach.
-->
<script lang="ts">
  import type { Employee } from '@hcengineering/contact'
  import contact from '@hcengineering/contact'
  import type { AttachedData } from '@hcengineering/core'
  import { type IntlString, translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygHr, { type EmergencyContact } from '@hcengineering/yg-hr'
  import SectionCard from '../SectionCard.svelte'
  import { colorOf, initialsOf } from '../../utils/profile'

  export let employee: Employee
  export let editing: boolean

  const client = getClient()

  let contacts: EmergencyContact[] = []
  const query = createQuery()
  $: query.query(ygHr.class.EmergencyContact, { attachedTo: employee._id }, (res) => { contacts = res })

  function phoneOf (c: EmergencyContact): { value: string, label: IntlString } | undefined {
    if (c.mobile != null && c.mobile !== '') return { value: c.mobile, label: ygHr.string.Mobile }
    if (c.homePhone != null && c.homePhone !== '') return { value: c.homePhone, label: ygHr.string.HomePhone }
    if (c.workPhone != null && c.workPhone !== '') return { value: c.workPhone, label: ygHr.string.WorkPhone }
    return undefined
  }

  // <input placeholder> can't bind a <Label> component directly - resolve once, same idiom
  // HrLists.svelte uses for its own add-form placeholders.
  let namePlaceholder = ''
  let relationshipPlaceholder = ''
  let mobilePlaceholder = ''
  let homePhonePlaceholder = ''
  void translate(ygHr.string.Name, {}).then((r) => { namePlaceholder = r })
  void translate(ygHr.string.Relationship, {}).then((r) => { relationshipPlaceholder = r })
  void translate(ygHr.string.Mobile, {}).then((r) => { mobilePlaceholder = r })
  void translate(ygHr.string.HomePhone, {}).then((r) => { homePhonePlaceholder = r })

  let adding = false
  let editingId: string | undefined

  let fName = ''
  let fRelationship = ''
  let fMobile = ''
  let fHomePhone = ''

  function resetForm (): void {
    fName = ''
    fRelationship = ''
    fMobile = ''
    fHomePhone = ''
  }

  function beginAdd (): void {
    resetForm()
    editingId = undefined
    adding = true
  }

  function beginEdit (c: EmergencyContact): void {
    fName = c.name
    fRelationship = c.relationship ?? ''
    fMobile = c.mobile ?? ''
    fHomePhone = c.homePhone ?? ''
    editingId = c._id
    adding = false
  }

  function cancelForm (): void {
    adding = false
    editingId = undefined
  }

  // Header "Done" ends edit mode - drop any in-progress add/edit row rather than leaving it
  // dangling (and inaccessible) behind the now-read-only view.
  $: if (!editing) cancelForm()

  async function submitAdd (): Promise<void> {
    const name = fName.trim()
    if (name === '') return
    const data: AttachedData<EmergencyContact> = {
      name,
      relationship: fRelationship.trim() === '' ? undefined : fRelationship.trim(),
      mobile: fMobile.trim() === '' ? undefined : fMobile.trim(),
      homePhone: fHomePhone.trim() === '' ? undefined : fHomePhone.trim()
    }
    await client.addCollection(
      ygHr.class.EmergencyContact,
      employee.space,
      employee._id,
      contact.mixin.Employee,
      'emergencyContacts',
      data
    )
    adding = false
    resetForm()
  }

  async function submitEdit (c: EmergencyContact): Promise<void> {
    const name = fName.trim()
    if (name === '') return
    await client.update(c, {
      name,
      relationship: fRelationship.trim() === '' ? undefined : fRelationship.trim(),
      mobile: fMobile.trim() === '' ? undefined : fMobile.trim(),
      homePhone: fHomePhone.trim() === '' ? undefined : fHomePhone.trim()
    })
    editingId = undefined
    resetForm()
  }

  async function removeContact (c: EmergencyContact): Promise<void> {
    await client.remove(c)
  }
</script>

<div class="yg-cards">
  <SectionCard label={ygHr.string.EmergencyContacts} full>
    <svelte:fragment slot="actions">
      {#if editing && !adding}
        <button class="yg-iconbtn" on:click={beginAdd}><Label label={ygHr.string.AddItem} /></button>
      {/if}
    </svelte:fragment>

    <div class="yg-ec-list">
      {#each contacts as c (c._id)}
        {#if editingId === c._id}
          <div class="yg-ec-form">
            <input class="yg-input" type="text" placeholder={namePlaceholder} bind:value={fName} />
            <input class="yg-input" type="text" placeholder={relationshipPlaceholder} bind:value={fRelationship} />
            <input class="yg-input" type="text" placeholder={mobilePlaceholder} bind:value={fMobile} />
            <input class="yg-input" type="text" placeholder={homePhonePlaceholder} bind:value={fHomePhone} />
            <div class="yg-ec-form__actions">
              <button class="yg-linkbtn" on:click={cancelForm}><Label label={ygHr.string.Cancel} /></button>
              <button class="yg-linkbtn yg-linkbtn--accent" on:click={() => submitEdit(c)}><Label label={ygHr.string.Save} /></button>
            </div>
          </div>
        {:else}
          {@const phone = phoneOf(c)}
          <div class="yg-ec">
            <div class="yg-ec__avatar" style="background: {colorOf(c.name)}">{initialsOf(c.name)}</div>
            <div class="yg-ec__who">
              <div class="yg-ec__name">{c.name}</div>
              {#if c.relationship != null && c.relationship !== ''}<div class="yg-ec__rel">{c.relationship}</div>{/if}
            </div>
            {#if phone !== undefined}
              <div class="yg-ec__phone">
                <div class="mono">{phone.value}</div>
                <small><Label label={phone.label} /></small>
              </div>
            {/if}
            {#if editing}
              <div class="yg-ec__actions">
                <button class="yg-iconbtn" on:click={() => { beginEdit(c) }}><Label label={ygHr.string.Edit} /></button>
                <button class="yg-iconbtn" on:click={() => { void removeContact(c) }}><Label label={ygHr.string.RemoveItem} /></button>
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        {#if !adding}
          <div class="yg-ec-empty"><Label label={ygHr.string.NoItemsYet} /></div>
        {/if}
      {/each}

      {#if adding}
        <div class="yg-ec-form">
          <input class="yg-input" type="text" placeholder={namePlaceholder} bind:value={fName} />
          <input class="yg-input" type="text" placeholder={relationshipPlaceholder} bind:value={fRelationship} />
          <input class="yg-input" type="text" placeholder={mobilePlaceholder} bind:value={fMobile} />
          <input class="yg-input" type="text" placeholder={homePhonePlaceholder} bind:value={fHomePhone} />
          <div class="yg-ec-form__actions">
            <button class="yg-linkbtn" on:click={cancelForm}><Label label={ygHr.string.Cancel} /></button>
            <button class="yg-linkbtn yg-linkbtn--accent" on:click={submitAdd}><Label label={ygHr.string.Save} /></button>
          </div>
        </div>
      {/if}
    </div>
  </SectionCard>
</div>

<style lang="scss">
  @use '../yg-profile' as *;

  .yg-ec-list {
    display: flex;
    flex-direction: column;
  }
  .yg-ec {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 13px 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .yg-ec:last-child {
    border-bottom: none;
  }
  .yg-ec__avatar {
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
  }
  .yg-ec__who {
    min-width: 0;
  }
  .yg-ec__name {
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .yg-ec__rel {
    font-size: 13px;
    color: var(--theme-dark-color);
  }
  .yg-ec__phone {
    margin-left: auto;
    text-align: right;
  }
  .yg-ec__phone .mono {
    font-size: 13.5px;
    color: var(--theme-content-color);
    font-variant-numeric: tabular-nums;
  }
  .yg-ec__phone small {
    display: block;
    color: var(--theme-trans-color);
    font-size: 11.5px;
  }
  .yg-ec__actions {
    display: flex;
    gap: 6px;
    flex: none;
  }
  .yg-ec-empty {
    font-size: 13px;
    color: var(--theme-trans-color);
    padding: 10px 0;
  }
  .yg-ec-form {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  @media (max-width: 640px) {
    .yg-ec-form {
      grid-template-columns: 1fr 1fr;
    }
  }
  .yg-ec-form__actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
</style>
