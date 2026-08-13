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
  import { UserBoxList } from '@hcengineering/contact-resources'
  import { getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet, { type ProjectApprovers } from '@hcengineering/yg-timesheet'

  export let project: Project

  const client = getClient()
  const h = client.getHierarchy()

  $: mixin = h.hasMixin(project, ygTimesheet.mixin.ProjectApprovers)
    ? h.as(project, ygTimesheet.mixin.ProjectApprovers)
    : undefined

  async function set (upd: Partial<ProjectApprovers>): Promise<void> {
    if (h.hasMixin(project, ygTimesheet.mixin.ProjectApprovers)) {
      await client.updateMixin(
        project._id,
        tracker.class.Project,
        project.space,
        ygTimesheet.mixin.ProjectApprovers,
        upd
      )
    } else {
      await client.createMixin(
        project._id,
        tracker.class.Project,
        project.space,
        ygTimesheet.mixin.ProjectApprovers,
        upd
      )
    }
  }
</script>

<div class="pa-row">
  <span class="pa-row__name">{project.name}</span>
  <div class="pa-row__fields">
    <div class="pa-field">
      <span class="pa-field__label"><Label label={ygTimesheet.string.PM} /></span>
      <UserBoxList
        label={ygTimesheet.string.PM}
        kind="regular"
        size="large"
        items={mixin?.pm ?? []}
        on:update={(e) => set({ pm: e.detail })}
      />
    </div>
    <div class="pa-field">
      <span class="pa-field__label"><Label label={ygTimesheet.string.TeamLead} /></span>
      <UserBoxList
        label={ygTimesheet.string.TeamLead}
        kind="regular"
        size="large"
        items={mixin?.teamLead ?? []}
        on:update={(e) => set({ teamLead: e.detail })}
      />
    </div>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;

  .pa-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    padding: 12px 16px;
  }
  .pa-row__name {
    flex: 1 1 160px;
    min-width: 120px;
    font-weight: 650;
    font-size: 14px;
    letter-spacing: -0.01em;
    color: var(--yg-text);
  }
  .pa-row__fields {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
  }
  .pa-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .pa-field__label {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--yg-text-faint);
  }
</style>
