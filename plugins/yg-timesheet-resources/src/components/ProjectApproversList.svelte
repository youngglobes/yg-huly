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

  // PM/Team Lead assignment is load-bearing for the approval security model (see
  // OnProjectApproversMixinGuard in server-plugins/yg-timesheet-resources): being a PM or TL on
  // ANY project grants approval rights over EVERY timesheet task workspace-wide, so only admins
  // may assign it. Gate on Maintainer+ to match the server-side guard exactly — this UI gate is
  // not itself a security boundary, it only hides the control; the server trigger is what refuses
  // the write for non-admins (a known, documented gap tracked separately, not fixed here).
  const isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  const query = createQuery()
  let projects: Project[] = []

  $: if (isAdmin) {
    query.query(tracker.class.Project, {}, (res) => {
      projects = res
    })
  }
</script>

<div class="pa-root">
  {#if isAdmin}
    <div class="pa-head">
      <h1 class="pa-title">Approvers per project</h1>
      <span class="pa-desc">
        Assign a PM or Team Lead to each project. They can approve any submitted timesheet task.
      </span>
    </div>
    <Scroller>
      <div class="pa-list">
        {#each projects as project (project._id)}
          <ProjectApprovers {project} />
        {/each}
        {#if projects.length === 0}
          <div class="yg-empty">No projects yet.</div>
        {/if}
      </div>
    </Scroller>
  {:else}
    <div class="yg-empty">Restricted to workspace admins.</div>
  {/if}
</div>

<style lang="scss">
  @use './yg-table' as *;

  .pa-root {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .pa-head {
    padding: 1rem 1.25rem 0.75rem;
  }
  .pa-title {
    margin: 0 0 4px;
    font-size: 1.1rem;
    font-weight: 680;
    letter-spacing: -0.01em;
    color: var(--yg-text);
  }
  .pa-desc {
    display: block;
    font-size: 0.8125rem;
    color: var(--yg-text-dim);
  }
  .pa-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 1.25rem 1.5rem;
  }
</style>
