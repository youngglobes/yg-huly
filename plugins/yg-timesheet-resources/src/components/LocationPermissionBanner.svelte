<!--
  YoungGlobes: global location-permission reminder. Mounted on every workbench page via
  workbench.extensions.WorkbenchExtensions. Reads the geolocation permission state WITHOUT
  prompting (Permissions API) and shows a neutral, purpose-agnostic strip when it is not granted.
  Silent on an insecure context (the http beta cannot grant geolocation) and when the Permissions
  API is unavailable. Disappears the moment location is granted.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  let show = false
  let status: PermissionStatus | undefined

  function apply (state: PermissionState): void {
    show = state !== 'granted'
  }

  onMount(async () => {
    if (typeof window === 'undefined' || !window.isSecureContext) return
    if (typeof navigator === 'undefined' || navigator.permissions?.query === undefined) return
    try {
      status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
      apply(status.state)
      status.onchange = () => {
        if (status !== undefined) apply(status.state)
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
    <span class="yg-loc-banner__msg">Location access is off. Please enable location in your browser settings.</span>
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
    padding: 6px 16px;
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
</style>
