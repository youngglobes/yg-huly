<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { greetingFor } from '../../utils/dashboard'
  export let name: string
  let nowD = new Date()
  let timer: any
  onMount(() => { timer = setInterval(() => (nowD = new Date()), 60000) })
  onDestroy(() => clearInterval(timer))
  const dfmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const tfmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
  $: greeting = greetingFor(nowD.getHours())
</script>
<div class="greet yg-section">
  <div class="greet__hi">{greeting}{name ? `, ${name}` : ''}</div>
  <div class="greet__meta">{dfmt.format(nowD)} · {tfmt.format(nowD)}</div>
</div>
<style lang="scss">
  @use '../yg-table' as *;
  .greet { max-width: none; margin-bottom: 16px; }
  .greet__hi { font-size: 22px; font-weight: 680; letter-spacing: -0.01em; color: var(--yg-text); }
  .greet__meta { margin-top: 4px; color: var(--yg-text-dim); font-size: 13px; }
</style>
