<script lang="ts">
  import { getCurrentLocation, navigate, Label } from '@hcengineering/ui'
  import ygTimesheet, { ygTimesheetId } from '@hcengineering/yg-timesheet'
  import { type Kpis } from '../../utils/dashboard'
  export let kpis: Kpis
  export let pendingCount: number
  function goApprovals (): void { const loc = getCurrentLocation(); loc.path[2] = ygTimesheetId; loc.path[3] = 'approvals'; loc.path.length = 4; navigate(loc) }
</script>
<div class="kpis">
  <div class="kpi"><span class="kpi__k"><Label label={ygTimesheet.string.InProgress} /></span><span class="kpi__v kpi__v--info">{kpis.inProgress}</span></div>
  <button class="kpi kpi--btn" on:click={goApprovals}><span class="kpi__k"><Label label={ygTimesheet.string.PendingApproval} /></span><span class="kpi__v kpi__v--amber">{pendingCount}</span></button>
  <div class="kpi"><span class="kpi__k"><Label label={ygTimesheet.string.HoursThisWeek} /></span><span class="kpi__v">{kpis.hoursThisWeek}</span></div>
  <div class="kpi"><span class="kpi__k"><Label label={ygTimesheet.string.Overdue} /></span><span class="kpi__v kpi__v--red">{kpis.overdue}</span></div>
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  @media (max-width: 900px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
  .kpi { background: var(--yg-panel); border: 1px solid var(--yg-border); border-radius: var(--yg-radius); box-shadow: var(--yg-shadow); padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; text-align: left; }
  .kpi--btn { cursor: pointer; font: inherit; }
  .kpi__k { color: var(--yg-text-dim); font-size: 13px; }
  .kpi__v { font-size: 30px; font-weight: 720; letter-spacing: -0.02em; color: var(--yg-text); }
  .kpi__v--info { color: var(--yg-av3); } .kpi__v--amber { color: var(--yg-amber); } .kpi__v--red { color: var(--yg-red); }
</style>
