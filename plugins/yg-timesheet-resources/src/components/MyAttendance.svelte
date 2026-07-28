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
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import ygTimesheet, { type AttendanceSession, type AttendanceMode } from '@hcengineering/yg-timesheet'
  import { localDayKey } from '../utils/week'
  import {
    localMidnight,
    findOpenSession,
    dailyTotal,
    nextMode,
    formatDuration
  } from '../utils/attendance'

  const me = getCurrentEmployee()
  const client = getClient()

  // Live clock: retick every second so the running timer + total are live (GreetingCard idiom).
  let nowMs = Date.now()
  let timer: ReturnType<typeof setInterval>
  onMount(() => {
    timer = setInterval(() => (nowMs = Date.now()), 1000)
  })
  onDestroy(() => clearInterval(timer))

  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short' })
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

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

  // Derived state. `nowMs` feeds the reactive block so timers/totals retick each second.
  $: todayMid = localMidnight(nowMs)
  $: todays = sessions.filter((s) => s.date === todayMid)
  $: openSession = findOpenSession(sessions)
  $: punchedIn = openSession !== undefined
  $: todayTotal = dailyTotal(todays, nowMs)

  // The Office/WFH selection for the NEXT punch-in. Seeded from today's most recent session's
  // mode (else office), sticky within the day. Re-seed only when the day rolls over or a punch
  // closes - not on every tick - so a manual toggle is not clobbered each second.
  let mode: AttendanceMode = 'office'
  let modeSeedKey = ''
  $: {
    const seed = `${todayMid}:${todays.length}:${punchedIn}`
    if (seed !== modeSeedKey) {
      modeSeedKey = seed
      if (!punchedIn) mode = nextMode(todays)
    }
  }

  let note = ''

  async function punchIn (): Promise<void> {
    if (punchedIn) return
    const at = Date.now()
    const trimmed = note.trim()
    await client.createDoc(ygTimesheet.class.AttendanceSession, core.space.Workspace, {
      employee: me,
      date: localMidnight(at),
      punchIn: at,
      mode,
      ...(trimmed !== '' ? { punchInNote: trimmed } : {})
    })
    note = ''
  }

  async function punchOut (): Promise<void> {
    if (openSession === undefined) return
    const at = Date.now()
    const trimmed = note.trim()
    await client.updateDoc(
      ygTimesheet.class.AttendanceSession,
      core.space.Workspace,
      openSession._id,
      { punchOut: at, ...(trimmed !== '' ? { punchOutNote: trimmed } : {}) }
    )
    note = ''
  }

  // Read-only history. `historyKey` is a native <input type="date"> value (yyyy-mm-dd),
  // defaulting to today. Selecting a date filters sessions by that local day.
  let historyKey = localDayKey(Date.now())
  $: historyMid = new Date(`${historyKey}T00:00:00`).getTime()
  $: historyIsToday = historyMid === todayMid
  $: historySessions = sessions
    .filter((s) => s.date === historyMid)
    .sort((a, b) => a.punchIn - b.punchIn)
</script>

<div class="att-wrap">
  <h1 class="att-title"><Label label={ygTimesheet.string.MyAttendance} /></h1>

  <!-- Punch card -->
  <div class="att-card">
    <div class="att-clock">
      <span class="att-clock__date">{dateFmt.format(nowMs)}</span>
      <span class="att-clock__time">{timeFmt.format(nowMs)}</span>
    </div>

    {#if punchedIn && openSession !== undefined}
      <div class="att-running">
        <span class="att-running__label"><Label label={ygTimesheet.string.In} /></span>
        <span class="att-running__at">{timeFmt.format(openSession.punchIn)}</span>
        <span class="att-running__elapsed">{formatDuration(nowMs - openSession.punchIn)}</span>
        <span class="yg-pill" class:yg-pill--approved={openSession.mode === 'wfh'}>
          <Label label={openSession.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} />
        </span>
      </div>
    {:else}
      <div class="yg-seg att-mode">
        <button class="yg-seg__opt" class:yg-seg__opt--on={mode === 'office'} on:click={() => (mode = 'office')}>
          <Label label={ygTimesheet.string.Office} />
        </button>
        <button class="yg-seg__opt" class:yg-seg__opt--on={mode === 'wfh'} on:click={() => (mode = 'wfh')}>
          <Label label={ygTimesheet.string.WFH} />
        </button>
      </div>
    {/if}

    <textarea class="att-note" rows="2" bind:value={note} placeholder="" aria-label="attendance note" />

    {#if punchedIn}
      <button class="yg-btn yg-btn--danger att-action" on:click={punchOut}>
        <Label label={ygTimesheet.string.PunchOut} />
      </button>
    {:else}
      <button class="yg-btn yg-btn--primary att-action" on:click={punchIn}>
        <Label label={ygTimesheet.string.PunchIn} />
      </button>
    {/if}
  </div>

  <!-- Today's sessions -->
  <div class="att-section">
    <div class="att-section__head">
      <span class="att-section__title"><Label label={ygTimesheet.string.TodaysSessions} /></span>
      <span class="att-section__total">{formatDuration(todayTotal)}</span>
    </div>
    {#if todays.length === 0}
      <div class="att-empty"><Label label={ygTimesheet.string.NoSessionsToday} /></div>
    {:else}
      <div class="att-rows">
        {#each [...todays].sort((a, b) => a.punchIn - b.punchIn) as s (s._id)}
          <div class="att-row">
            <span class="att-row__in">{timeFmt.format(s.punchIn)}{#if s.punchInNote}<span class="att-row__note"> · {s.punchInNote}</span>{/if}</span>
            <span class="att-row__out">
              {#if s.punchOut}{timeFmt.format(s.punchOut)}{#if s.punchOutNote}<span class="att-row__note"> · {s.punchOutNote}</span>{/if}{:else}-{/if}
            </span>
            <span class="yg-pill" class:yg-pill--approved={s.mode === 'wfh'}>
              <Label label={s.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} />
            </span>
            <span class="att-row__dur">{formatDuration((s.punchOut ?? nowMs) - s.punchIn)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- History (read-only) -->
  <div class="att-section">
    <div class="att-section__head">
      <span class="att-section__title"><Label label={ygTimesheet.string.History} /></span>
      <input class="yg-input att-date" type="date" bind:value={historyKey} />
    </div>
    {#if historyIsToday}
      <div class="att-empty"><Label label={ygTimesheet.string.TodaysSessions} /> ↑</div>
    {:else if historySessions.length === 0}
      <div class="att-empty"><Label label={ygTimesheet.string.NoSessionsOnDate} /></div>
    {:else}
      <div class="att-rows">
        {#each historySessions as s (s._id)}
          <div class="att-row">
            <span class="att-row__in">{timeFmt.format(s.punchIn)}{#if s.punchInNote}<span class="att-row__note"> · {s.punchInNote}</span>{/if}</span>
            <span class="att-row__out">{#if s.punchOut}{timeFmt.format(s.punchOut)}{#if s.punchOutNote}<span class="att-row__note"> · {s.punchOutNote}</span>{/if}{:else}-{/if}</span>
            <span class="yg-pill" class:yg-pill--approved={s.mode === 'wfh'}>
              <Label label={s.mode === 'wfh' ? ygTimesheet.string.WFH : ygTimesheet.string.Office} />
            </span>
            <span class="att-row__dur">{s.punchOut ? formatDuration(s.punchOut - s.punchIn) : '-'}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  @use './yg-table' as *;

  .att-wrap { padding: 1rem 1.25rem; max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  .att-title { font-size: 1.375rem; font-weight: 680; letter-spacing: -0.01em; margin: 6px 0 4px; color: var(--yg-text); }

  .att-card {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .att-clock { display: flex; align-items: baseline; gap: 12px; }
  .att-clock__date { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--yg-text-faint); font-weight: 600; }
  .att-clock__time { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--yg-text); }

  .att-running { display: flex; align-items: center; gap: 12px; }
  .att-running__label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--yg-text-faint); font-weight: 600; }
  .att-running__at { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--yg-text-dim); }
  .att-running__elapsed { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--yg-ink); }

  .att-mode { align-self: flex-start; }

  .att-note {
    width: 100%;
    resize: vertical;
    border: 1px solid var(--yg-border);
    border-radius: 9px;
    background: var(--yg-panel-soft);
    color: var(--yg-text);
    padding: 8px 10px;
    font: inherit;
  }
  .att-note:focus { outline: none; border-color: var(--yg-border-strong); }

  .att-action { align-self: flex-start; min-width: 140px; justify-content: center; }

  .att-section {
    background: var(--yg-panel);
    border: 1px solid var(--yg-border);
    border-radius: var(--yg-radius);
    box-shadow: var(--yg-shadow);
    overflow: hidden;
  }
  .att-section__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--yg-border);
  }
  .att-section__title { font-size: 13px; font-weight: 660; color: var(--yg-text); }
  .att-section__total { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--yg-ink); }
  .att-date { max-width: 170px; }

  .att-empty { padding: 16px; color: var(--yg-text-faint); font-size: 13px; }

  .att-rows { display: flex; flex-direction: column; }
  .att-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto auto;
    align-items: center;
    gap: 14px;
    padding: 11px 16px;
  }
  .att-row + .att-row { border-top: 1px solid var(--yg-border); }
  .att-row__in, .att-row__out { font-variant-numeric: tabular-nums; color: var(--yg-text); }
  .att-row__note { color: var(--yg-text-faint); font-weight: 400; }
  .att-row__dur { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--yg-text-dim); min-width: 64px; text-align: right; }
</style>
