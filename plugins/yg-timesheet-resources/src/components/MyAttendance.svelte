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
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { getCurrentEmployee } from '@hcengineering/contact'
  import core from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label, themeStore, showPopup } from '@hcengineering/ui'
  import ygTimesheet, { type AttendanceSession, type AttendanceMode, type LatePermission } from '@hcengineering/yg-timesheet'
  import { localDayKey } from '../utils/week'
  import {
    localMidnight,
    findOpenSession,
    dailyTotal,
    dayStats,
    buildDayTimeline,
    formatDuration
  } from '../utils/attendance'
  import { createPunchIn, closePunchOut } from '../utils/attendance-write'
  import { isLate, minutesLateOf, dayLateStatus } from '../utils/late'
  import AttendanceSessionRow from './AttendanceSessionRow.svelte'
  import HolidayCalendarView from './HolidayCalendarView.svelte'
  import LateReasonPopup from './LateReasonPopup.svelte'

  const me = getCurrentEmployee()
  const client = getClient()

  // Current employee's shift start (minutes since midnight), or undefined = exempt from late flow.
  let shiftStart: number | undefined = undefined
  const profQuery = createQuery()
  $: profQuery.query(ygTimesheet.mixin.WorkProfile, { _id: me }, (res) => { shiftStart = res[0]?.shiftStart })

  // This employee's late permissions, keyed by day (local midnight) - drives the Late/Excused/
  // Pending chip next to the day-log date.
  let lateByDay = new Map<number, LatePermission>()
  const lateQuery = createQuery()
  $: lateQuery.query(ygTimesheet.class.LatePermission, { employee: me }, (res) => {
    lateByDay = new Map(res.map((p) => [p.date, p]))
  })

  // Live clock: retick every second so the clock, running timer, totals and timeline are live.
  let nowMs = Date.now()
  let timer: ReturnType<typeof setInterval>
  onMount(() => {
    timer = setInterval(() => (nowMs = Date.now()), 1000)
  })
  onDestroy(() => clearInterval(timer))

  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
  const hourLabel = (h: number): string => {
    const ap = h < 12 || h === 24 ? 'a' : 'p'
    const hr = h % 12 === 0 ? 12 : h % 12
    return `${hr}${ap}`
  }

  // Localized note placeholder (also used as the accessible label).
  let notePlaceholder = ''
  $: void translate(ygTimesheet.string.AddNote, {}, $themeStore.language).then((p) => (notePlaceholder = p))

  // All my sessions, newest punch-in first. Beta volume is small; no range filter needed.
  const query = createQuery()
  let sessions: AttendanceSession[] = []
  query.query(
    ygTimesheet.class.AttendanceSession,
    { space: core.space.Workspace, employee: me },
    (res) => {
      sessions = res
    },
    { sort: { punchIn: -1 } }
  )

  // Today drives the live punch zone (hero). `nowMs` feeds these so timers/totals retick each second.
  $: todayMid = localMidnight(nowMs)
  $: todays = sessions.filter((s) => s.date === todayMid)
  $: openSession = findOpenSession(sessions)
  $: punchedIn = openSession !== undefined
  $: todayTotal = dailyTotal(todays, nowMs)
  $: stats = dayStats(todays, nowMs)

  // Office/WFH must be chosen explicitly for EVERY punch-in (no sticky default). Starts unset; the
  // Punch In button is disabled until one is picked, and it resets after each punch-out.
  let mode: AttendanceMode | undefined = undefined

  // Punch reminders are strictly opt-in and per-browser: turning them on asks for the Notification
  // and Idle Detection permissions and registers the service worker that makes the notification
  // buttons actionable. The flag lives in localStorage; the global AttendanceReminder controller
  // reads the same key, hence the reload once it flips on.
  const REMINDER_OPT_IN_KEY = 'yg-punch-reminders-optin'
  let remindersOn = typeof localStorage !== 'undefined' && localStorage.getItem(REMINDER_OPT_IN_KEY) === 'on'
  async function enableReminders (): Promise<void> {
    let ok = false
    try {
      const perm = typeof Notification !== 'undefined' ? await Notification.requestPermission() : 'denied'
      let idleOk = true
      const IdleDetectorCtor = (window as any).IdleDetector
      if (IdleDetectorCtor?.requestPermission !== undefined) {
        idleOk = (await IdleDetectorCtor.requestPermission()) === 'granted'
      }
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.register('/attendance-reminder-sw.js', { scope: '/' })
      }
      ok = perm === 'granted' && idleOk
    } catch (e) {
      ok = false
    }
    localStorage.setItem(REMINDER_OPT_IN_KEY, ok ? 'on' : 'off')
    remindersOn = ok
    if (ok) location.reload() // let the global controller pick up the opt-in
  }
  function disableReminders (): void {
    localStorage.setItem(REMINDER_OPT_IN_KEY, 'off')
    remindersOn = false
  }

  let note = ''
  // Double-click guard. `punchedIn` only flips after the live query round-trips the new doc, so the
  // button must stay disabled through that lag - not just while the write runs - or a fast second
  // click (e.g. switching Office -> WFH) opens a duplicate session. `busy` is held until the live
  // query reflects the write (see the reactive releases below); createPunchIn also refuses a second
  // open session server-side as a backstop.
  let busy = false
  let pending: 'in' | 'out' | null = null

  async function punchIn (): Promise<void> {
    if (punchedIn || busy) return
    const m = mode
    if (m === undefined) return // must pick Office or WFH first
    const at = Date.now()

    // Set the guard atomically before any await, including the late-detection popup below - a
    // fast double-click during that async window must not re-enter and stack a second popup.
    busy = true
    pending = 'in'

    // Late check only on the FIRST punch of the day, and only when a shiftStart is set.
    let lateReason: string | undefined
    if (shiftStart !== undefined && isLate(at, shiftStart)) {
      const priorToday = await client.findAll(
        ygTimesheet.class.AttendanceSession, { employee: me, date: localMidnight(at) }, { limit: 1 }
      )
      if (priorToday.length === 0) {
        const res = await new Promise<{ reason: string } | undefined>((resolve) => {
          showPopup(LateReasonPopup, { minutesLate: minutesLateOf(at, shiftStart as number) }, undefined, resolve)
        })
        if (res === undefined) {
          busy = false
          pending = null
          return // cancelled: do not punch
        }
        lateReason = res.reason
      }
    }

    try {
      // Pass the inline late reason with the punch; the server (OnAttendancePunch) is the authority
      // that stamps the real IST time and creates the LatePermission, consuming this reason only if
      // IT judges the punch late. No client-side LatePermission write - the browser clock is untrusted.
      await createPunchIn(client, me, m, note, lateReason)
      note = ''
      // keep `busy` until openSession appears (released reactively below)
    } catch (err) {
      console.error('punch in failed', err)
      busy = false
      pending = null
    }
  }

  async function punchOut (): Promise<void> {
    if (openSession === undefined || busy) return
    busy = true
    pending = 'out'
    try {
      await closePunchOut(client, openSession._id, note)
      note = ''
    } catch (err) {
      console.error('punch out failed', err)
      busy = false
      pending = null
    }
  }

  // Release the lock only once the live query is consistent with the write: an open session present
  // after a punch-in, or gone after a punch-out. This closes the query-lag window entirely.
  $: if (busy && pending === 'in' && openSession !== undefined) { busy = false; pending = null }
  $: if (busy && pending === 'out' && openSession === undefined) { busy = false; pending = null }

  // Clear the mode on any transition into punched-in, from any path (this page's button, the
  // reminder banner, or another tab/device) - not just this page's own punch-out click - so a
  // fresh choice is always required on the next punch-in. Harmless while punched in: the toggle
  // is hidden then. The `const m = mode` capture in punchIn() still runs before punchedIn flips.
  $: if (punchedIn) mode = undefined

  // The day log: one browsable full-width view. A native <input type="date"> (yyyy-mm-dd) picks the
  // day, defaulting to today; the timeline and the table below both follow it.
  let logKey = localDayKey(Date.now())
  $: logMid = new Date(`${logKey}T00:00:00`).getTime()
  $: logIsToday = logMid === todayMid
  $: logSessions = sessions.filter((s) => s.date === logMid).sort((a, b) => a.punchIn - b.punchIn)
  $: logTotal = dailyTotal(logSessions, nowMs)
  $: timeline = buildDayTimeline(logSessions, logMid, nowMs)
  $: logLateStatus = dayLateStatus(lateByDay.get(logMid)?.status)
</script>

<div class="att-scroll">
  <div class="att-wrap">
    <header class="att-head">
      <h1 class="att-title"><Label label={ygTimesheet.string.MyAttendance} /></h1>
      <span class="att-datechip">{dateFmt.format(nowMs)} &middot; {timeFmt.format(nowMs)}</span>
    </header>

    <!-- Hero band: today's live punch action + at a glance. -->
    <section class="att-hero">
      <div class="att-panel att-punch" class:is-on={punchedIn}>
        {#if punchedIn && openSession !== undefined}
          <div class="att-punch__eyebrow">
            <span class="att-status att-status--on"><span class="att-status__dot" /><Label label={ygTimesheet.string.OnTheClock} /></span>
            <span class="att-chip att-chip--lg" class:att-chip--wfh={openSession.mode === 'wfh'}>
              <Label label={openSession.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} />
            </span>
          </div>
          <div class="att-timer">{formatDuration(nowMs - openSession.punchIn)}</div>
          <div class="att-punch__since">
            <Label label={ygTimesheet.string.FirstIn} /> &middot; {timeFmt.format(openSession.punchIn)}
          </div>
        {:else}
          <div class="att-punch__eyebrow">
            <span class="att-status"><span class="att-status__dot" /><Label label={ygTimesheet.string.NotPunchedIn} /></span>
          </div>
          <div class="att-bigclock">{timeFmt.format(nowMs)}</div>
          <div class="att-seg" role="group">
            <button class="att-seg__opt" class:is-on={mode === 'office'} on:click={() => (mode = 'office')}>
              <Label label={ygTimesheet.string.Office} />
            </button>
            <button class="att-seg__opt att-seg__opt--wfh" class:is-on={mode === 'wfh'} on:click={() => (mode = 'wfh')}>
              <Label label={ygTimesheet.string.WFH} />
            </button>
          </div>
        {/if}

        <textarea class="att-note" rows="2" bind:value={note} placeholder={notePlaceholder} aria-label={notePlaceholder} />

        {#if punchedIn}
          <button class="att-cta att-cta--out" on:click={punchOut} disabled={busy}>
            {#if busy && pending === 'out'}<span class="att-cta__spin" />Punching out…{:else}<Label label={ygTimesheet.string.PunchOut} />{/if}
          </button>
        {:else}
          <button class="att-cta att-cta--in" on:click={punchIn} disabled={busy || mode === undefined}>
            {#if busy && pending === 'in'}<span class="att-cta__spin" />Punching in…{:else}<Label label={ygTimesheet.string.PunchIn} />{/if}
          </button>
        {/if}

        {#if remindersOn}
          <button class="att-reminder-toggle att-reminder-toggle--on" on:click={disableReminders}>
            <svg class="att-reminder-toggle__ico" viewBox="0 0 24 24" width="14" height="14" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3 2 6" /><path d="M22 6l-3-3" /><path d="M6 19l-2 2" /><path d="M18 19l2 2" />
            </svg>
            <Label label={ygTimesheet.string.DisableReminders} />
          </button>
        {:else}
          <button class="att-reminder-toggle" on:click={() => void enableReminders()}>
            <svg class="att-reminder-toggle__ico" viewBox="0 0 24 24" width="14" height="14" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3 2 6" /><path d="M22 6l-3-3" /><path d="M6 19l-2 2" /><path d="M18 19l2 2" />
            </svg>
            <Label label={ygTimesheet.string.EnableReminders} />
          </button>
        {/if}
      </div>

      <div class="att-right">
        <HolidayCalendarView />
        <div class="att-panel att-glance">
        <span class="att-eyebrow"><Label label={ygTimesheet.string.Today} /></span>
        <div class="att-glance__total">{formatDuration(todayTotal)}</div>
        <div class="att-glance__grid">
          <div class="att-stat">
            <span class="att-stat__k"><Label label={ygTimesheet.string.Sessions} /></span>
            <span class="att-stat__v">{stats.count}</span>
          </div>
          <div class="att-stat">
            <span class="att-stat__k"><Label label={ygTimesheet.string.FirstIn} /></span>
            <span class="att-stat__v">{stats.firstIn !== undefined ? timeFmt.format(stats.firstIn) : '--'}</span>
          </div>
          <div class="att-stat">
            <span class="att-stat__k"><Label label={ygTimesheet.string.LastOut} /></span>
            <span class="att-stat__v">{stats.lastOut !== undefined ? timeFmt.format(stats.lastOut) : '--'}</span>
          </div>
        </div>
        </div>
      </div>
    </section>

    <!-- The day log: date filter -> timeline + full-width table, for the selected day (default today). -->
    <section class="att-panel att-log">
      <div class="att-log__head">
        <span class="att-eyebrow"><Label label={ygTimesheet.string.YourDay} /></span>
        <div class="att-log__ctrls">
          <span class="att-log__total">{formatDuration(logTotal)}</span>
          {#if logLateStatus === 'excused'}
            <span class="att-latechip att-latechip--excused"><Label label={ygTimesheet.string.LateStatusExcused} /></span>
          {:else if logLateStatus === 'pending'}
            <span class="att-latechip att-latechip--pending"><Label label={ygTimesheet.string.LateStatusPending} /></span>
          {:else if logLateStatus === 'late'}
            <span class="att-latechip att-latechip--late"><Label label={ygTimesheet.string.LateStatusLate} /></span>
          {/if}
          <input class="att-date" type="date" bind:value={logKey} />
        </div>
      </div>

      <div class="att-track">
        {#each timeline.ticks as t (t.hour)}
          <span class="att-track__grid" style="left:{t.pct}%" />
          {#if t.hour % 2 === 0}<span class="att-track__lbl" style="left:{t.pct}%">{hourLabel(t.hour)}</span>{/if}
        {/each}
        {#each timeline.blocks as b, i (i)}
          <span class="att-block" class:is-wfh={b.mode === 'wfh'} class:is-open={b.open} style="left:{b.leftPct}%; width:{b.widthPct}%" />
        {/each}
        {#if timeline.nowPct !== undefined}<span class="att-track__now" style="left:{timeline.nowPct}%" />{/if}
      </div>

      {#if logSessions.length === 0}
        <div class="att-empty">
          <Label label={logIsToday ? ygTimesheet.string.NoSessionsToday : ygTimesheet.string.NoSessionsOnDate} />
        </div>
      {:else}
        <table class="att-table">
          <thead>
            <tr>
              <th><Label label={ygTimesheet.string.In} /></th>
              <th><Label label={ygTimesheet.string.Out} /></th>
              <th class="att-th--type"><Label label={ygTimesheet.string.Type} /></th>
              <th class="att-th--dur"><Label label={ygTimesheet.string.Duration} /></th>
            </tr>
          </thead>
          <tbody>
            {#each logSessions as s (s._id)}
              <AttendanceSessionRow session={s} now={nowMs} />
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;

  // Scroll container: fills the workbench pane so the page scrolls instead of cropping.
  .att-scroll { height: 100%; overflow-y: auto; }

  // Attendance accent (indigo = WFH / live), from the yg avatar-3 hue so it belongs to the system
  // but stays distinct from the approval green. Defined here and inherited by child rows.
  .att-wrap {
    --att-wfh: #5566c4;
    --att-wfh-bg: rgba(85, 102, 196, 0.12);
    --att-wfh-line: rgba(85, 102, 196, 0.28);

    box-sizing: border-box;
    padding: 20px 24px 40px;
    max-width: 1080px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  :global(.theme-dark) .att-wrap {
    --att-wfh: #7d8bec;
    --att-wfh-bg: rgba(125, 139, 236, 0.16);
    --att-wfh-line: rgba(125, 139, 236, 0.32);
  }

  .att-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .att-title { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin: 0; color: var(--yg-text); }
  .att-datechip {
    font-size: 12px; font-weight: 600; letter-spacing: 0.01em;
    color: var(--yg-text-dim);
    background: var(--yg-panel); border: 1px solid var(--yg-border);
    padding: 6px 12px; border-radius: 999px; box-shadow: var(--yg-shadow);
    white-space: nowrap; font-variant-numeric: tabular-nums;
  }

  .att-panel {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
  }
  .att-eyebrow {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
    font-weight: 700; color: var(--yg-text-faint);
  }

  // Hero band ---------------------------------------------------------------
  .att-hero { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: stretch; }
  .att-right { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

  .att-punch { padding: 22px 24px; display: flex; flex-direction: column; gap: 16px; }
  .att-punch.is-on { border-color: var(--att-wfh-line); }

  .att-punch__eyebrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .att-status { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 650; color: var(--yg-text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .att-status__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--yg-text-faint); }
  .att-status--on { color: var(--att-wfh); }
  .att-status--on .att-status__dot { background: var(--att-wfh); box-shadow: 0 0 0 0 var(--att-wfh-line); animation: att-pulse 1.8s ease-out infinite; }

  .att-bigclock, .att-timer {
    font-size: 56px; line-height: 1; font-weight: 720; letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums; color: var(--yg-text);
  }
  .att-timer { color: var(--att-wfh); }
  .att-punch__since { font-size: 13px; color: var(--yg-text-dim); font-variant-numeric: tabular-nums; margin-top: -6px; }

  // Segmented Office / WFH toggle - the selected option is filled (Office = ink, WFH = indigo).
  .att-seg { display: inline-flex; padding: 3px; gap: 3px; background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 10px; align-self: flex-start; }
  .att-seg__opt {
    appearance: none; border: 0; cursor: pointer; font: inherit; font-size: 13px; font-weight: 620;
    padding: 8px 20px; border-radius: 7px; background: transparent; color: var(--yg-text-dim);
  }
  .att-seg__opt:hover { color: var(--yg-text); }
  .att-seg__opt.is-on { background: var(--yg-ink); color: var(--yg-ink-fg); box-shadow: var(--yg-shadow); }
  .att-seg__opt--wfh.is-on { background: var(--att-wfh); color: #fff; }

  .att-note {
    width: 100%; resize: vertical; min-height: 120px; flex: 1;
    border: 1px solid var(--yg-border); border-radius: 10px;
    background: var(--yg-panel-soft); color: var(--yg-text);
    padding: 10px 12px; font: inherit; font-size: 14px;
  }
  .att-note::placeholder { color: var(--yg-text-faint); }
  .att-note:focus { outline: none; border-color: var(--yg-border-strong); }

  .att-cta {
    appearance: none; width: 100%; height: 46px; border-radius: 11px; cursor: pointer;
    font: inherit; font-size: 15px; font-weight: 680; letter-spacing: 0.01em;
    border: 1px solid transparent; margin-top: auto;
  }
  .att-cta:disabled { opacity: 0.7; cursor: default; }
  .att-cta__spin { display: inline-block; width: 15px; height: 15px; margin-right: 8px; vertical-align: -2px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: att-cta-spin 0.7s linear infinite; }
  @keyframes att-cta-spin { to { transform: rotate(360deg); } }
  .att-reminder-toggle {
    align-self: flex-start; display: inline-flex; align-items: center; gap: 6px;
    background: var(--yg-panel-soft); border: 1px solid var(--yg-border); color: var(--yg-text-dim);
    font: inherit; font-size: 12px; font-weight: 600; border-radius: 999px; padding: 5px 11px;
    cursor: pointer; text-decoration: none;
  }
  .att-reminder-toggle:hover { color: var(--yg-text); border-color: var(--yg-border-strong); }
  .att-reminder-toggle__ico { flex: 0 0 auto; }
  .att-reminder-toggle--on { color: var(--att-wfh); border-color: var(--att-wfh); }
  .att-cta--in { background: var(--yg-ink); color: var(--yg-ink-fg); }
  .att-cta--in:hover:not(:disabled) { filter: brightness(1.15); }
  .att-cta--out { background: var(--att-wfh); color: #fff; }
  .att-cta--out:hover:not(:disabled) { filter: brightness(1.08); }

  // Today at a glance -------------------------------------------------------
  .att-glance { padding: 22px 24px; display: flex; flex-direction: column; justify-content: center; gap: 16px; }
  .att-glance__total { font-size: 40px; font-weight: 720; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--yg-text); margin: 0; }
  .att-glance__grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .att-stat { display: flex; flex-direction: column; gap: 4px; padding: 12px; background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 10px; }
  .att-stat__k { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 650; color: var(--yg-text-faint); }
  .att-stat__v { font-size: 17px; font-weight: 680; font-variant-numeric: tabular-nums; color: var(--yg-text); }

  // Day log (timeline + table) ----------------------------------------------
  .att-log { padding: 18px 24px 8px; display: flex; flex-direction: column; }
  .att-log__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .att-log__ctrls { display: inline-flex; align-items: center; gap: 14px; }
  .att-log__total { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--yg-text); }

  // Late/Excused/Pending chip for the selected day, next to the date picker. Uses the shared
  // green/amber/red status tokens (yg-table.scss `:root`) so it reads consistently with the
  // Approved/Pending/Rejected vocabulary used across the other HR/timesheet grids.
  .att-latechip {
    display: inline-flex; align-items: center;
    font-size: 11px; font-weight: 650; letter-spacing: 0.01em;
    padding: 4px 10px; border-radius: 999px; border: 1px solid transparent;
    white-space: nowrap;
  }
  .att-latechip--excused { color: var(--yg-green); background: var(--yg-green-bg); border-color: var(--yg-green-line); }
  .att-latechip--pending { color: var(--yg-amber); background: var(--yg-amber-bg); border-color: var(--yg-amber-line); }
  .att-latechip--late { color: var(--yg-red); background: var(--yg-red-bg); border-color: var(--yg-red-line); }

  .att-date {
    appearance: none; font: inherit; font-size: 13px; color: var(--yg-text);
    background: var(--yg-panel-soft); border: 1px solid var(--yg-border); border-radius: 8px;
    padding: 6px 10px;
  }

  .att-track { position: relative; height: 46px; margin: 16px 0 6px; border-radius: 10px; background: var(--yg-panel-soft); border: 1px solid var(--yg-border); }
  .att-track__grid { position: absolute; top: 6px; bottom: 16px; width: 1px; background: var(--yg-border); transform: translateX(-0.5px); }
  .att-track__lbl { position: absolute; bottom: 1px; transform: translateX(-50%); font-size: 10px; font-variant-numeric: tabular-nums; color: var(--yg-text-faint); }
  .att-block { position: absolute; top: 8px; height: 20px; min-width: 4px; border-radius: 5px; background: var(--yg-grey); }
  .att-block.is-wfh { background: var(--att-wfh); }
  .att-block.is-open { background: var(--att-wfh); box-shadow: 0 0 0 0 var(--att-wfh-line); animation: att-pulse 1.8s ease-out infinite; }
  .att-track__now { position: absolute; top: 2px; bottom: 14px; width: 2px; background: var(--yg-ink); transform: translateX(-1px); border-radius: 2px; }

  .att-empty { padding: 22px 2px 26px; color: var(--yg-text-faint); font-size: 13px; }

  // Full-width sessions table.
  .att-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .att-table thead th {
    text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
    font-weight: 700; color: var(--yg-text-faint); padding: 6px 18px 10px; border-bottom: 1px solid var(--yg-border);
  }
  .att-th--dur { text-align: right; }
  .att-th--type { width: 1%; white-space: nowrap; }

  @keyframes att-pulse {
    0% { box-shadow: 0 0 0 0 var(--att-wfh-line); }
    100% { box-shadow: 0 0 0 7px transparent; }
  }
  @media (prefers-reduced-motion: reduce) {
    .att-status--on .att-status__dot, .att-block.is-open { animation: none; }
  }

  // Responsive: collapse the hero to one column on narrow viewports.
  @media (max-width: 900px) {
    .att-hero { grid-template-columns: 1fr; }
    .att-bigclock, .att-timer { font-size: 46px; }
  }
</style>
