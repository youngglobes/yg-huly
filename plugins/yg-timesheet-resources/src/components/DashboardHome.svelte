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
  Thin role router for the top-level Dashboard app: renders the existing PM Dashboard for
  approvers/admins, and the new EmployeeDashboard for everyone else. No aggregation lives here -
  role detection is copied verbatim from Dashboard.svelte so behavior is identical.
-->
<script lang="ts">
  import { getCurrentEmployee } from '@hcengineering/contact'
  import core, { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import ygTimesheet, { type ProjectApprovers } from '@hcengineering/yg-timesheet'
  import { canApproveView } from '../utils/task-approval'
  import Dashboard from './Dashboard.svelte'
  import EmployeeDashboard from './EmployeeDashboard.svelte'
  import HrDashboard from './HrDashboard.svelte'

  const me = getCurrentEmployee()
  const client = getClient()
  const h = client.getHierarchy()
  const isAdmin = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  // --- My projects (pm/teamLead == me, or admin => all) --------------------
  const projectQuery = createQuery()
  // isApprover is derived from the query; isAdmin is synchronous. Gating on isAdmin alone (not
  // waiting on isApprover) gives admins a fast path so they never sit behind "Restricted to
  // approvers." while the query is still in flight - mirrors Reports.svelte's isHRAdmin/isApprover
  // split exactly.
  let isApprover = false
  // Projects query still resolving on first render; render nothing until it returns so the
  // template never flashes the wrong dashboard.
  let projReady = false
  projectQuery.query(tracker.class.Project, {}, (res: Project[]) => {
    const pairs = res
      .filter((p) => h.hasMixin(p, ygTimesheet.mixin.ProjectApprovers))
      .map((p) => { const a = h.as(p, ygTimesheet.mixin.ProjectApprovers) as ProjectApprovers; return { pm: a.pm, teamLead: a.teamLead } })
    isApprover = canApproveView(false, pairs, me)
    projReady = true
  })
  $: isPM = isAdmin || isApprover

  // --- HR roster membership (HrData space) ----------------------------------
  let isHR = false
  let hrReady = false
  const hrQuery = createQuery()
  hrQuery.query(core.class.Space, { _id: ygTimesheet.space.HrData }, (res) => {
    const space = res[0]
    isHR = space !== undefined && space.members.includes(getCurrentAccount().uuid)
    hrReady = true
  })

  // Wait for both queries before branching so the template never flashes the wrong dashboard.
  $: ready = projReady && hrReady
</script>

{#if !ready}
  <!-- projects/HR queries still resolving; render nothing to avoid a role flash -->
{:else if isPM}
  <Dashboard />
{:else if isHR}
  <HrDashboard />
{:else}
  <EmployeeDashboard />
{/if}
