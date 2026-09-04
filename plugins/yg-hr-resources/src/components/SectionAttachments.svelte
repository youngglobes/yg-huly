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
  Reusable per-section file attachments (Task 9): a SectionCard listing the Attachment docs
  attached to an Employee under a given `collection` name (e.g. 'personalFiles', 'jobFiles') so
  the Personal and Job tabs each get their own independent file list on the same Employee. Uses
  Huly's own attachment plugin (blob storage + the Attachment AttachedDoc) rather than a bespoke
  upload path.
-->
<script lang="ts">
  import contact, { type Employee } from '@hcengineering/contact'
  import attachment, { type Attachment } from '@hcengineering/attachment'
  import { createQuery, deleteFile, getClient, getFileUrl, uploadFile } from '@hcengineering/presentation'
  import { Label, Spinner } from '@hcengineering/ui'
  import ygHr from '@hcengineering/yg-hr'
  import SectionCard from './SectionCard.svelte'

  export let employee: Employee
  export let collection: string
  export let canEdit: boolean

  const client = getClient()
  let files: Attachment[] = []
  const q = createQuery()
  $: q.query(attachment.class.Attachment, { attachedTo: employee._id, collection }, (res) => { files = res })

  let uploading = false
  let input: HTMLInputElement

  async function onSelected (e: Event): Promise<void> {
    const list = (e.currentTarget as HTMLInputElement).files
    if (list === null || list.length === 0) return
    uploading = true
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list.item(i)
        if (file === null) continue
        const { uuid, metadata } = await uploadFile(file)
        await client.addCollection(
          attachment.class.Attachment, employee.space, employee._id, contact.mixin.Employee, collection,
          { name: file.name, file: uuid, type: file.type, size: file.size, lastModified: file.lastModified, metadata }
        )
      }
    } finally {
      uploading = false
      if (input !== undefined) input.value = ''
    }
  }

  async function remove (att: Attachment): Promise<void> {
    await client.removeCollection(att._class, att.space, att._id, att.attachedTo, att.attachedToClass, collection)
    await deleteFile(att.file)
  }

  function fmtSize (n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }
</script>

<SectionCard label={attachment.string.Attachments} full>
  <svelte:fragment slot="actions">
    {#if uploading}
      <Spinner size={'small'} />
    {/if}
    {#if canEdit}
      <button class="yg-iconbtn" type="button" on:click={() => input.click()}>
        <Label label={ygHr.string.AddItem} />
      </button>
      <input
        type="file"
        multiple
        bind:this={input}
        on:change={onSelected}
        style="display:none"
      />
    {/if}
  </svelte:fragment>

  {#if files.length === 0}
    <div class="yg-files__empty"><Label label={ygHr.string.NotSet} /></div>
  {:else}
    <div class="yg-files">
      {#each files as att (att._id)}
        <div class="yg-files__row">
          <a class="yg-files__name" href={getFileUrl(att.file, att.name)} download={att.name}>{att.name}</a>
          <span class="yg-files__size">{fmtSize(att.size)}</span>
          {#if canEdit}
            <button class="yg-linkbtn" type="button" on:click={() => remove(att)}>
              <Label label={ygHr.string.RemoveItem} />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</SectionCard>

<style lang="scss">
  @use './yg-profile' as *;

  .yg-files {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .yg-files__row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .yg-files__name {
    font-size: 14px;
    font-weight: 500;
    color: var(--theme-content-color);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .yg-files__name:hover {
    text-decoration: underline;
  }
  .yg-files__size {
    flex: none;
    font-size: 12px;
    color: var(--theme-trans-color);
  }
  .yg-files__row .yg-linkbtn {
    flex: none;
    margin-left: auto;
  }
  .yg-files__empty {
    font-size: 14px;
    color: var(--theme-trans-color);
  }
</style>
