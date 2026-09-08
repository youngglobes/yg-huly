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
  First-login auto-activate. Mounted on every workbench page via
  workbench.extensions.WorkbenchExtensions (same slot presence/love/yg-timesheet use), so it runs
  once whenever any user opens the workspace. If the current user is an employee still in the
  'pending' lifecycle state (created by HR, not yet logged in), flip it to 'active' - this is exactly
  their first login. A pending user is a plain member, not HR, so the write would normally be
  reverted by OnEmployeeHrGuard; a narrow carve-out there authorizes ONLY this self pending->active
  transition (server-plugins/yg-hr-resources). Idempotent: once active, the guard below no-ops.
  Renders nothing.
-->
<script lang="ts">
  import contact, { getCurrentEmployee } from '@hcengineering/contact'
  import { getClient } from '@hcengineering/presentation'
  import { onMount } from 'svelte'
  import ygHr from '@hcengineering/yg-hr'

  const client = getClient()
  const h = client.getHierarchy()

  onMount(async () => {
    const me = getCurrentEmployee()
    if (me === undefined) return
    const emp = await client.findOne(contact.mixin.Employee, { _id: me })
    if (emp === undefined || !h.hasMixin(emp, ygHr.mixin.EmployeePersonal)) return
    if (h.as(emp, ygHr.mixin.EmployeePersonal).status !== 'pending') return
    await client.updateMixin(emp._id, contact.mixin.Employee, emp.space, ygHr.mixin.EmployeePersonal, {
      status: 'active'
    })
  })
</script>
