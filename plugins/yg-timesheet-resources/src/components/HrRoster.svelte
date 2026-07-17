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
<script lang="ts">
  import core, { type AccountUuid, type Space } from '@hcengineering/core'
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { ensureHrMembership } from '../utils/hrMembership'

  // Owner-only editor of the private HR space's membership (HrData.members: AccountUuid[]).
  // AccountArrayEditor is Huly's standard AccountUuid[] picker: it resolves each Employee it
  // shows to its AccountUuid internally, so onChange hands back the next AccountUuid[] directly.
  const client = getClient()

  void ensureHrMembership()

  let space: Space | undefined
  const query = createQuery()
  query.query(core.class.Space, { _id: ygTimesheet.space.HrData }, (res) => {
    space = res[0]
  })

  async function updateMembers (next: AccountUuid[]): Promise<void> {
    if (space === undefined) return
    await client.diffUpdate(space, { members: next })
  }
</script>

<div class="hr-roster flex-col p-4">
  <div class="fs-title mb-2"><Label label={ygTimesheet.string.HrRoster} /></div>
  {#if space !== undefined}
    <AccountArrayEditor
      label={ygTimesheet.string.Employees}
      value={space.members}
      onChange={updateMembers}
      kind={'regular'}
      size={'large'}
    />
  {/if}
</div>
