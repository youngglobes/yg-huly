<!--
  YoungGlobes: global location-permission prompt. Mounted on every workbench page via
  workbench.extensions.WorkbenchExtensions, so it asks for location on ANY page, not only at
  punch-in. Reads the geolocation permission state (Permissions API):
    - granted  -> hidden.
    - prompt   -> shows an "Enable location" button; clicking it (a user gesture) opens the browser
                  prompt. We do this on click rather than auto-firing so the browser never suppresses
                  it and it is not startling.
    - denied   -> the browser will NOT re-prompt after a block, so we show guidance to re-enable it
                  in site settings instead.
  Silent on an insecure context (the http deployments cannot grant geolocation) and when the
  Permissions API is unavailable.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  let state: PermissionState | undefined
  let status: PermissionStatus | undefined
  let requesting = false

  $: show = state !== undefined && state !== 'granted'

  function requestLocation (): void {
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) return
    requesting = true
    // We only want to trigger the permission prompt; the position itself is captured at punch-in.
    // status.onchange flips `state` to 'granted' (hides the banner) or 'denied' (shows guidance).
    navigator.geolocation.getCurrentPosition(
      () => { requesting = false },
      () => { requesting = false },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
    )
  }

  onMount(async () => {
    if (typeof window === 'undefined' || !window.isSecureContext) return
    if (typeof navigator === 'undefined' || navigator.permissions?.query === undefined) return
    try {
      status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
      state = status.state
      status.onchange = () => {
        if (status !== undefined) state = status.state
      }
    } catch {
      // Permissions API cannot query geolocation here (older Safari) - stay hidden.
    }
  })

  onDestroy(() => {
    if (status !== undefined) status.onchange = null
  })
</script>

{#if show}
  <div class="yg-loc-banner" role="alert">
    {#if state === 'denied'}
      <span class="yg-loc-banner__msg">Location is blocked. Enable location for this site in your browser settings so your work location is recorded with your attendance.</span>
    {:else}
      <span class="yg-loc-banner__msg">Enable location so your work location is recorded with your attendance.</span>
      <button class="yg-loc-banner__btn" on:click={requestLocation} disabled={requesting}>
        {requesting ? 'Requesting' : 'Enable location'}
      </button>
    {/if}
  </div>
{/if}

<style lang="scss">
  .yg-loc-banner {
    /* Anchored to the BOTTOM, not the top: a top:0 strip renders behind the workbench top bar and
       is never seen. The sibling AttendanceReminder banner is visible at bottom/z-index:1000, so
       match that. */
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 16px;
    background: var(--theme-warning-color, #b8860b);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .yg-loc-banner__msg {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .yg-loc-banner__btn {
    flex: 0 0 auto;
    padding: 4px 14px;
    border: 1px solid rgba(255, 255, 255, 0.75);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .yg-loc-banner__btn:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  .yg-loc-banner__btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
