<!--
// YG Portal: "server not responding" banner (2026-09-30 wedge follow-up). Driven by the
// 'yg:server-stall' window event from client-resources/src/stall.ts.
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'
  import workbenchRes from '../plugin'

  const STALL_EVENT = 'yg:server-stall' // must match client-resources/src/stall.ts

  let stalled = false
  function onStall (e: Event): void {
    stalled = (e as CustomEvent<{ stalled: boolean }>).detail?.stalled === true
  }
  window.addEventListener(STALL_EVENT, onStall)
  onDestroy(() => {
    window.removeEventListener(STALL_EVENT, onStall)
  })
</script>

{#if stalled}
  <div class="yg-stall" role="status" aria-live="polite">
    <span class="yg-stall-dot" />
    <span>
      <b><Label label={workbenchRes.string.ServerNotResponding} /></b>
      <Label label={workbenchRes.string.ServerNotRespondingHint} />
    </span>
  </div>
{/if}

<style lang="scss">
  .yg-stall {
    position: fixed;
    top: 0.5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20000;
    max-width: calc(100vw - 2rem);
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid #f6c500;
    background: var(--theme-popup-color);
    color: var(--theme-caption-color);
    box-shadow: var(--theme-popup-shadow);
    font-size: 0.8125rem;
    line-height: 1.4;
  }
  .yg-stall-dot {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: #f6c500;
    animation: yg-stall-pulse 1.6s ease-in-out infinite;
  }
  @keyframes yg-stall-pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>
