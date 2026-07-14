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
  import { EmployeeBox } from '@hcengineering/contact-resources'
  import { getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
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

<div class="flex-row-center gap-2">
  <span class="p-2">{project.name}</span>
  <EmployeeBox
    label={ygTimesheet.string.PM}
    kind="regular"
    size="large"
    value={mixin?.pm}
    allowDeselect
    showNavigate={false}
    on:change={(e) => set({ pm: e.detail ?? undefined })}
  />
  <EmployeeBox
    label={ygTimesheet.string.TeamLead}
    kind="regular"
    size="large"
    value={mixin?.teamLead}
    allowDeselect
    showNavigate={false}
    on:change={(e) => set({ teamLead: e.detail ?? undefined })}
  />
</div>
