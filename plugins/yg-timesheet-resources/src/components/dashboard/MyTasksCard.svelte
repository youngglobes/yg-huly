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
  Employee dashboard: my open issues, grouped by real status (not the coarse category - many
  custom statuses share a category, see utils/dashboard.ts openStatusNames), plus a scrollable
  list of the issues themselves. Presentational only; the parent already scoped `issues` to me
  and computed `statusColumns` (openStatusNames).
-->
<script lang="ts">
  import { getPanelURI, Label } from '@hcengineering/ui'
  import tracker from '@hcengineering/tracker'
  import ygTimesheet from '@hcengineering/yg-timesheet'
  import { type DashIssue } from '../../utils/dashboard'

  export let issues: DashIssue[]
  export let statusColumns: string[]

  $: byStatus = (() => {
    const m = new Map<string, number>()
    for (const i of issues) m.set(i.status, (m.get(i.status) ?? 0) + 1)
    return m
  })()

  function href (id: string): string {
    return '#' + getPanelURI(tracker.component.EditIssue, id as any, tracker.class.Issue, 'content')
  }
</script>

<div class="mtc">
  <div class="mtc__title">
    <Label label={ygTimesheet.string.MyTasks} />
    {#if issues.length > 0}<span class="mtc__count">{issues.length}</span>{/if}
  </div>

  {#if statusColumns.length > 0}
    <div class="mtc__cols">
      {#each statusColumns as name (name)}
        <div class="mtc__col">
          <span class="mtc__col-n">{byStatus.get(name) ?? 0}</span>
          <span class="mtc__col-k">{name}</span>
        </div>
      {/each}
    </div>
  {/if}

  <div class="mtc__list">
    {#each issues as i (i.id)}
      <a class="mtrow" href={href(i.id)}>
        <span class="mtrow__id">{i.identifier}</span>
        <span class="mtrow__t">{i.title}</span>
        <span class="mtrow__s">{i.status}</span>
      </a>
    {:else}
      <div class="yg-empty">No open tasks assigned to you.</div>
    {/each}
  </div>
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .mtc {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 14px 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .mtc :global(.yg-empty) { margin: auto 0; }
  .mtc__title { font-size: 13px; font-weight: 680; color: var(--yg-text); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .mtc__count { font-size: 11px; font-weight: 700; color: var(--yg-text-dim); background: var(--yg-panel-soft); border-radius: 999px; padding: 1px 8px; }

  .mtc__cols { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .mtc__col {
    display: flex; align-items: baseline; gap: 6px; padding: 5px 9px;
    background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 999px;
  }
  .mtc__col-n { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--yg-text); }
  .mtc__col-k { font-size: 11px; color: var(--yg-text-dim); }

  .mtc__list { max-height: 260px; overflow: auto; }
  .mtrow { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-top: 1px solid var(--yg-border); text-decoration: none; color: var(--yg-text); }
  .mtrow:first-child { border-top: 0; }
  .mtrow__id { font-family: ui-monospace, monospace; font-size: 12px; color: var(--yg-text-dim); min-width: 64px; }
  .mtrow__t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mtrow__s { font-size: 12px; color: var(--yg-text-dim); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
