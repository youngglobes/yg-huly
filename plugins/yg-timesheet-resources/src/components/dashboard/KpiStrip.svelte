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
  KPI strip: a row of headline metric tiles for the top of a dashboard. Deliberately quiet - most
  tiles are neutral panels. Boldness is spent only where it means something: an "attention" tile
  (tone red/amber) tints and grows a left accent bar ONLY when its value is non-zero, so a PM's eye
  lands on overdue/pending work and nothing else. Pure presentational; all math is done by the caller.
-->
<script context="module" lang="ts">
  export interface Kpi {
    label: string
    value: string | number
    // neutral = always quiet. red/amber/green = "attention" tone, applied only when value is truthy
    // and non-zero (so a clean board reads calm, not alarming).
    tone?: 'neutral' | 'red' | 'amber' | 'green'
    // Distinct top accent colour per tile (a category colour). Decorative; the "hot" tint still
    // takes over an attention tile when its value is non-zero.
    accent?: string
    hint?: string
  }
</script>

<script lang="ts">
  export let tiles: Kpi[] = []
  const isHot = (t: Kpi): boolean =>
    t.tone != null && t.tone !== 'neutral' && t.value !== 0 && t.value !== '0' && t.value !== ''
</script>

<div class="kpis">
  {#each tiles as t}
    <div
      class="kpi"
      class:kpi--hot={isHot(t)}
      data-tone={isHot(t) ? t.tone : 'neutral'}
      style={t.accent ? `border-top: 3px solid ${t.accent}` : ''}
      title={t.hint ?? ''}
    >
      <div class="kpi__val">{t.value}</div>
      <div class="kpi__label">{t.label}</div>
    </div>
  {/each}
</div>

<style lang="scss">
  @use '../yg-table' as *;
  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
    margin-top: 16px;
  }
  .kpi {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 16px 18px;
  }
  .kpi__val {
    font-size: 30px;
    font-weight: 720;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: var(--yg-text);
    font-variant-numeric: tabular-nums;
  }
  .kpi__label {
    margin-top: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--yg-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  // Attention tiles: tint the surface and colour the number when the value is non-zero, so a hot
  // tile reads louder than its resting accent stripe. One tone class per semantic colour.
  .kpi--hot[data-tone='red']   { background: var(--yg-red-bg);   border-color: var(--yg-red-line); }
  .kpi--hot[data-tone='red']   .kpi__val { color: var(--yg-red); }
  .kpi--hot[data-tone='amber'] { background: var(--yg-amber-bg); border-color: var(--yg-amber-line); }
  .kpi--hot[data-tone='amber'] .kpi__val { color: var(--yg-amber); }
  .kpi--hot[data-tone='green'] { background: var(--yg-green-bg); border-color: var(--yg-green-line); }
  .kpi--hot[data-tone='green'] .kpi__val { color: var(--yg-green); }
</style>
