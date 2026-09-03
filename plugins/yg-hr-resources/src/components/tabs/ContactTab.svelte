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
  Contact tab (Task 10): the EmployeeContact mixin (Address card, Reach card) plus a Work email row
  sourced from the person's login email SocialIdentity (queried by the shell, passed in as
  `workEmail`) - always read-only, never part of the Reach card's edit form even in edit mode, with
  a small "from login" lock badge next to its label, same as the approved mockup. Both cards render
  read-only FieldRows or, while the profile-wide `editing` flag (PO UI refinement - the header's
  single Edit/Done toggle, EmployeeProfile.svelte) is on, plain inputs that live-save on change.
-->
<script lang="ts">
  import type { Employee } from '@hcengineering/contact'
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygHr, { type EmployeeContact } from '@hcengineering/yg-hr'
  import FieldGroup from '../FieldGroup.svelte'
  import FieldRow from '../FieldRow.svelte'
  import SectionCard from '../SectionCard.svelte'
  import { saveEmployeeMixin } from '../../utils/profile'

  export let employee: Employee
  export let editing: boolean
  export let workEmail: string | undefined

  const client = getClient()
  const h = client.getHierarchy()

  $: info = h.hasMixin(employee, ygHr.mixin.EmployeeContact) ? h.as(employee, ygHr.mixin.EmployeeContact) : undefined

  let fStreet1 = ''
  let fStreet2 = ''
  let fCity = ''
  let fState = ''
  let fZip = ''
  let fCountry = ''

  $: if (editing) {
    fStreet1 = info?.street1 ?? ''
    fStreet2 = info?.street2 ?? ''
    fCity = info?.addressCity ?? ''
    fState = info?.state ?? ''
    fZip = info?.zip ?? ''
    fCountry = info?.country ?? ''
  }

  async function saveAddress (): Promise<void> {
    const upd: Partial<EmployeeContact> = {
      street1: fStreet1.trim() === '' ? undefined : fStreet1.trim(),
      street2: fStreet2.trim() === '' ? undefined : fStreet2.trim(),
      addressCity: fCity.trim() === '' ? undefined : fCity.trim(),
      state: fState.trim() === '' ? undefined : fState.trim(),
      zip: fZip.trim() === '' ? undefined : fZip.trim(),
      country: fCountry.trim() === '' ? undefined : fCountry.trim()
    }
    await saveEmployeeMixin(client, h, employee, ygHr.mixin.EmployeeContact, upd)
  }

  let fMobile = ''
  let fHomePhone = ''
  let fOtherEmail = ''

  $: if (editing) {
    fMobile = info?.mobile ?? ''
    fHomePhone = info?.homePhone ?? ''
    fOtherEmail = info?.otherEmail ?? ''
  }

  async function saveReach (): Promise<void> {
    const upd: Partial<EmployeeContact> = {
      mobile: fMobile.trim() === '' ? undefined : fMobile.trim(),
      homePhone: fHomePhone.trim() === '' ? undefined : fHomePhone.trim(),
      otherEmail: fOtherEmail.trim() === '' ? undefined : fOtherEmail.trim()
    }
    await saveEmployeeMixin(client, h, employee, ygHr.mixin.EmployeeContact, upd)
  }
</script>

<div class="yg-cards">
  <SectionCard label={ygHr.string.Address}>
    {#if editing}
      <FieldGroup>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Street1} /></span>
          <input class="yg-input" type="text" bind:value={fStreet1} on:change={saveAddress} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Street2} /></span>
          <input class="yg-input" type="text" bind:value={fStreet2} on:change={saveAddress} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.City} /></span>
          <input class="yg-input" type="text" bind:value={fCity} on:change={saveAddress} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.State} /></span>
          <input class="yg-input" type="text" bind:value={fState} on:change={saveAddress} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Zip} /></span>
          <input class="yg-input" type="text" bind:value={fZip} on:change={saveAddress} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Country} /></span>
          <input class="yg-input" type="text" bind:value={fCountry} on:change={saveAddress} />
        </label>
      </FieldGroup>
    {:else}
      <FieldGroup>
        <FieldRow label={ygHr.string.Street1} value={info?.street1} />
        <FieldRow label={ygHr.string.Street2} value={info?.street2} />
        <FieldRow label={ygHr.string.City} value={info?.addressCity} />
        <FieldRow label={ygHr.string.State} value={info?.state} />
        <FieldRow label={ygHr.string.Zip} value={info?.zip} mono />
        <FieldRow label={ygHr.string.Country} value={info?.country} />
      </FieldGroup>
    {/if}
  </SectionCard>

  <SectionCard label={ygHr.string.Reach}>
    {#if editing}
      <FieldGroup>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.Mobile} /></span>
          <input class="yg-input" type="text" bind:value={fMobile} on:change={saveReach} />
        </label>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.HomePhone} /></span>
          <input class="yg-input" type="text" bind:value={fHomePhone} on:change={saveReach} />
        </label>
        <FieldRow label={ygHr.string.WorkEmail} value={workEmail} full>
          <svelte:fragment slot="labelSuffix">
            <span class="yg-lock"><Label label={ygHr.string.FromLogin} /></span>
          </svelte:fragment>
        </FieldRow>
        <label class="yg-input-f">
          <span><Label label={ygHr.string.OtherEmail} /></span>
          <input class="yg-input" type="text" bind:value={fOtherEmail} on:change={saveReach} />
        </label>
      </FieldGroup>
    {:else}
      <FieldGroup>
        <FieldRow label={ygHr.string.Mobile} value={info?.mobile} mono />
        <FieldRow label={ygHr.string.HomePhone} value={info?.homePhone} mono />
        <FieldRow label={ygHr.string.WorkEmail} value={workEmail} full>
          <svelte:fragment slot="labelSuffix">
            <span class="yg-lock"><Label label={ygHr.string.FromLogin} /></span>
          </svelte:fragment>
        </FieldRow>
        <FieldRow label={ygHr.string.OtherEmail} value={info?.otherEmail} />
      </FieldGroup>
    {/if}
  </SectionCard>
</div>

<style lang="scss">
  @use '../yg-profile' as *;

  .yg-lock {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 500;
    color: var(--theme-trans-color);
    margin-left: 7px;
  }
  .yg-lock::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 2px;
    border: 1.4px solid currentColor;
    display: inline-block;
  }
</style>
