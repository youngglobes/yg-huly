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
  upload path. Each file shows a type-coloured icon tile (extension) and an icon remove button.
-->
<script lang="ts">
  import contact, { type Employee } from '@hcengineering/contact'
  import attachment, { type Attachment } from '@hcengineering/attachment'
  import { createQuery, deleteFile, getClient, getFileUrl, uploadFile } from '@hcengineering/presentation'
  import { translate } from '@hcengineering/platform'
  import { IconDelete, Label, Spinner } from '@hcengineering/ui'
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

  // Uppercased file extension for the icon tile label (empty when the name has none).
  function fileExt (name: string): string {
    const m = /\.([a-z0-9]{1,6})$/i.exec(name)
    return m !== null ? m[1].toUpperCase() : ''
  }

  // Coarse type bucket that drives the icon tile colour (see the yg-file__ic--* rules).
  function fileCat (name: string, type: string): string {
    const e = fileExt(name).toLowerCase()
    if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic'].includes(e)) return 'image'
    if (e === 'pdf' || type === 'application/pdf') return 'pdf'
    if (['doc', 'docx', 'rtf', 'odt', 'txt', 'md'].includes(e)) return 'doc'
    if (['xls', 'xlsx', 'csv', 'ods'].includes(e)) return 'sheet'
    if (['ppt', 'pptx', 'odp'].includes(e)) return 'slide'
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return 'archive'
    return 'file'
  }

  let removeTitle = ''
  void translate(ygHr.string.RemoveItem, {}).then((r) => { removeTitle = r })
</script>

<SectionCard label={attachment.string.Attachments} full>
  <svelte:fragment slot="actions">
    {#if uploading}
      <span class="yg-files__spin"><Spinner size={'small'} /></span>
    {/if}
    {#if canEdit}
      <button class="yg-abtn" type="button" on:click={() => input.click()}>
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
    <div class="yg-files__empty"><Label label={attachment.string.NoFiles} /></div>
  {:else}
    <div class="yg-files">
      {#each files as att (att._id)}
        <div class="yg-file">
          <a class="yg-file__link" href={getFileUrl(att.file, att.name)} download={att.name}>
            <span class="yg-file__ic yg-file__ic--{fileCat(att.name, att.type)}">{fileExt(att.name) || 'FILE'}</span>
            <span class="yg-file__meta">
              <span class="yg-file__name">{att.name}</span>
              <span class="yg-file__size">{fmtSize(att.size)}</span>
            </span>
          </a>
          {#if canEdit}
            <button class="yg-file__rm" type="button" title={removeTitle} aria-label={removeTitle} on:click={() => remove(att)}>
              <IconDelete size={'small'} />
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
  .yg-file {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 11px;
    border: 1px solid var(--theme-divider-color);
    background: var(--theme-panel-color);
    transition: border-color 0.12s ease;
  }
  .yg-file:hover {
    border-color: var(--theme-trans-color);
  }
  .yg-file__link {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }
  .yg-file__ic {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #ffffff;
    background: #6b7280;
  }
  .yg-file__ic--image {
    background: #16a34a;
  }
  .yg-file__ic--pdf {
    background: #dc2626;
  }
  .yg-file__ic--doc {
    background: #2563eb;
  }
  .yg-file__ic--sheet {
    background: #0f766e;
  }
  .yg-file__ic--slide {
    background: #ea580c;
  }
  .yg-file__ic--archive {
    background: #7c3aed;
  }
  .yg-file__ic--file {
    background: #6b7280;
  }
  .yg-file__meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .yg-file__name {
    font-size: 14px;
    font-weight: 500;
    color: var(--theme-caption-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .yg-file__link:hover .yg-file__name {
    text-decoration: underline;
  }
  .yg-file__size {
    font-size: 11.5px;
    color: var(--theme-trans-color);
  }
  .yg-file__rm {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    color: var(--theme-halfcontent-color);
  }
  .yg-file__rm:hover {
    background: var(--theme-comp-header-color);
    color: var(--theme-error-color, #dc2626);
  }
  .yg-files__spin {
    display: inline-flex;
    align-items: center;
  }
  .yg-files__empty {
    font-size: 14px;
    color: var(--theme-trans-color);
  }

  // Black/white primary action (Add), matching the theme's .yg-btn-dark at a compact size.
  .yg-abtn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-weight: 600;
    font-size: 12.5px;
    padding: 6px 13px;
    border-radius: 9px;
    border: 1px solid transparent;
    cursor: pointer;
    white-space: nowrap;
    background: #14181b;
    color: #ffffff;
  }
  .yg-abtn:hover {
    background: #23292d;
  }
  :global(.theme-dark) .yg-abtn {
    border-color: rgba(255, 255, 255, 0.16);
  }
</style>
