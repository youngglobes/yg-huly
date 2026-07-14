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
  import { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import { Scroller } from '@hcengineering/ui'
  import ProjectApprovers from './ProjectApprovers.svelte'

  const isOwner = hasAccountRole(getCurrentAccount(), AccountRole.Owner)

  const query = createQuery()
  let projects: Project[] = []

  $: if (isOwner) {
    query.query(tracker.class.Project, {}, (res) => {
      projects = res
    })
  }
</script>

{#if isOwner}
  <Scroller>
    <div class="flex-col p-4">
      {#each projects as project (project._id)}
        <ProjectApprovers {project} />
      {/each}
    </div>
  </Scroller>
{:else}
  <div class="p-4">
    <span>Restricted to workspace admins.</span>
  </div>
{/if}
