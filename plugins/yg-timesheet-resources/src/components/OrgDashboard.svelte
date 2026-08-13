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
  Organization dashboard for Owners: a tab shell over the all-active-projects view (Dashboard
  scope="org") and the HR dashboard. No data logic here - each tab reuses its own dashboard.
-->
<script lang="ts">
  import Dashboard from './Dashboard.svelte'
  import HrDashboard from './HrDashboard.svelte'

  let tab: 'projects' | 'hr' = 'projects'
</script>

<div class="org">
  <div class="org__seg" role="group">
    <button class="org__opt" class:is-on={tab === 'projects'} on:click={() => (tab = 'projects')}>Projects</button>
    <button class="org__opt" class:is-on={tab === 'hr'} on:click={() => (tab = 'hr')}>HR</button>
  </div>
  {#if tab === 'projects'}
    <Dashboard scope="org" />
  {:else}
    <HrDashboard />
  {/if}
</div>

<style lang="scss">
  .org { display: flex; flex-direction: column; }
  .org__seg { display: inline-flex; padding: 3px; gap: 3px; margin: 12px 16px 0; background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 10px; align-self: flex-start; }
  .org__opt { border: none; background: transparent; padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 640; color: var(--yg-text-dim); cursor: pointer; }
  .org__opt:hover { color: var(--yg-text); }
  .org__opt.is-on { background: var(--yg-ink); color: var(--yg-ink-fg); box-shadow: var(--yg-shadow); }
</style>
