<!--
  YoungGlobes: punch-reminder controller (Phase 1e). Mounted on every workbench page via
  workbench.extensions.WorkbenchExtensions, so it renders nothing but a fixed-position banner.

  It feeds real signals (IdleDetector, punch state, a 30s tick) to the pure engine in
  utils/reminder.ts and delivers the verdict as a banner + an OS notification with action
  buttons (shown through attendance-reminder-sw.js so the buttons work).

  Reminder only: it never punches on its own. Every write is an explicit user action.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { getCurrentEmployee } from '@hcengineering/contact'
  import core from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label, themeStore } from '@hcengineering/ui'
  import ygTimesheet, { type AttendanceSession, type AttendanceReminderSettings } from '@hcengineering/yg-timesheet'
  import { evaluateReminder, DEFAULT_REMINDER_CONFIG, type ReminderConfig, type ReminderKind } from '../utils/reminder'
  import { createPunchIn, closePunchOut } from '../utils/attendance-write'
  import { findOpenSession, nextMode, localMidnight } from '../utils/attendance'

  const OPT_IN_KEY = 'yg-punch-reminders-optin'
  const optedIn = (): boolean => typeof localStorage !== 'undefined' && localStorage.getItem(OPT_IN_KEY) === 'on'

  const me = getCurrentEmployee()
  const client = getClient()

  // Org config (singleton; defaults when absent).
  const cfgQuery = createQuery()
  let config: ReminderConfig = { ...DEFAULT_REMINDER_CONFIG }
  cfgQuery.query(ygTimesheet.class.AttendanceReminderSettings, {}, (res: AttendanceReminderSettings[]) => {
    const d = res[0]
    if (d !== undefined) {
      config = {
        enabled: d.enabled,
        windowStartMin: d.windowStartMin,
        windowEndMin: d.windowEndMin,
        days: d.days,
        punchInDelayMin: d.punchInDelayMin,
        repeatMin: d.repeatMin,
        punchOutIdleMin: d.punchOutIdleMin
      }
    }
  })

  // My sessions -> punch state (reuse findOpenSession).
  const sessQuery = createQuery()
  let mySessions: AttendanceSession[] = []
  sessQuery.query(ygTimesheet.class.AttendanceSession, { space: core.space.Workspace, employee: me }, (res) => {
    mySessions = res
  })
  $: openSession = findOpenSession(mySessions)
  $: punchedIn = openSession !== undefined

  // Idle + streak tracking (controller-owned; the pure engine consumes these).
  let userActive = true
  let idleSince: number | undefined
  let activeUnpunchedSince: number | undefined
  let snoozedUntil: number | undefined
  let lastRemindedAt: number | undefined

  let idleDetector: any
  let tick: ReturnType<typeof setInterval> | undefined
  let bannerKind: ReminderKind = 'none'

  // Notification copy is prefetched: showNotification needs plain strings, not <Label>.
  let inTitle = ''
  let inBody = ''
  let outTitle = ''
  let outBody = ''
  async function loadStrings (): Promise<void> {
    inTitle = await translate(ygTimesheet.string.ReminderPunchInTitle, {}, $themeStore.language)
    inBody = await translate(ygTimesheet.string.ReminderPunchInBody, {}, $themeStore.language)
    outTitle = await translate(ygTimesheet.string.ReminderPunchOutTitle, {}, $themeStore.language)
    outBody = await translate(ygTimesheet.string.ReminderPunchOutBody, {}, $themeStore.language)
  }

  function refreshStreak (): void {
    // A "streak" is active + unpunched + inside the work window. Reset when any breaks.
    const now = Date.now()
    const d = new Date(now)
    const mins = d.getHours() * 60 + d.getMinutes()
    const inWindow =
      config.days.includes(d.getDay()) && mins >= config.windowStartMin && mins < config.windowEndMin
    if (userActive && !punchedIn && inWindow) {
      if (activeUnpunchedSince === undefined) activeUnpunchedSince = now
    } else {
      activeUnpunchedSince = undefined
    }
  }

  async function showOsNotification (kind: ReminderKind): Promise<void> {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.ready
    const title = kind === 'punch-in' ? inTitle : outTitle
    const body = kind === 'punch-in' ? inBody : outBody
    await reg.showNotification(title, {
      body,
      tag: 'yg-punch-reminder',
      renotify: true,
      requireInteraction: false,
      actions: [
        { action: 'punch', title: kind === 'punch-in' ? 'Punch in' : 'Punch out' },
        { action: 'snooze', title: 'Snooze' }
      ]
    } as NotificationOptions)
  }

  async function doPunch (): Promise<void> {
    const todayMid = localMidnight(Date.now())
    const todays = mySessions.filter((s) => s.date === todayMid)
    if (punchedIn && openSession !== undefined) await closePunchOut(client, openSession._id)
    else if (!punchedIn) await createPunchIn(client, me, nextMode(todays))
    bannerKind = 'none'
  }
  function snooze (): void {
    snoozedUntil = Date.now() + config.repeatMin * 60_000
    bannerKind = 'none'
  }

  function evaluate (): void {
    if (!optedIn()) {
      bannerKind = 'none'
      return
    }
    refreshStreak()
    const kind = evaluateReminder({
      now: Date.now(),
      userActive,
      punchedIn,
      activeUnpunchedSince,
      idleSince,
      snoozedUntil,
      lastRemindedAt,
      config
    })
    if (kind !== 'none') {
      bannerKind = kind
      lastRemindedAt = Date.now()
      void showOsNotification(kind)
    }
  }

  function onSwMessage (e: MessageEvent): void {
    if (e.data?.type !== 'yg-punch-reminder-action') return
    if (e.data.action === 'snooze') snooze()
    else void doPunch()
  }

  onMount(() => {
    if (!optedIn()) return
    void loadStrings()
    // Idle detection (whole-machine). Falls back to always-active if unsupported/denied.
    const IdleDetectorCtor = (window as any).IdleDetector
    if (IdleDetectorCtor !== undefined) {
      try {
        idleDetector = new IdleDetectorCtor()
        idleDetector.addEventListener('change', () => {
          const active = idleDetector.userState === 'active' && idleDetector.screenState === 'unlocked'
          if (active) {
            userActive = true
            idleSince = undefined
          } else {
            userActive = false
            if (idleSince === undefined) idleSince = Date.now()
          }
        })
        void idleDetector.start({ threshold: 60_000 })
      } catch (e) {
        userActive = true
      }
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onSwMessage)
    tick = setInterval(evaluate, 30_000)
    evaluate()
  })
  onDestroy(() => {
    if (tick !== undefined) clearInterval(tick)
    if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onSwMessage)
    try {
      idleDetector?.stop?.()
    } catch (e) {
      /* ignore */
    }
  })
</script>

{#if bannerKind !== 'none'}
  <div class="yg-punch-banner" role="alert">
    <span class="yg-punch-banner__msg">
      <Label
        label={bannerKind === 'punch-in'
          ? ygTimesheet.string.ReminderPunchInTitle
          : ygTimesheet.string.ReminderPunchOutTitle}
      />
    </span>
    <button class="yg-btn yg-btn--primary" on:click={() => void doPunch()}>
      <Label label={bannerKind === 'punch-in' ? ygTimesheet.string.PunchIn : ygTimesheet.string.PunchOut} />
    </button>
    <button class="yg-btn yg-btn--ghost" on:click={snooze}><Label label={ygTimesheet.string.Snooze} /></button>
  </div>
{/if}

<style lang="scss">
  @use './yg-table' as *;
  .yg-punch-banner {
    position: fixed; z-index: 1000; right: 20px; bottom: 20px;
    display: flex; align-items: center; gap: 12px;
    background: var(--yg-panel); border: 1px solid var(--yg-border-strong);
    border-radius: 12px; box-shadow: var(--yg-shadow); padding: 12px 16px;
  }
  .yg-punch-banner__msg { font-weight: 640; color: var(--yg-text); }
</style>
