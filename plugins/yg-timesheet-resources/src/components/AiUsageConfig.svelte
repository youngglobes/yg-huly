<script lang="ts">
  // Admin config for the AI Usage dashboard: mapping rules (cwd prefix -> project or label),
  // account-to-employee links with a monthly fee, device enrollment tokens, and the viewer
  // allowlist (who besides an admin may read the dashboard). Every control here talks to the
  // sidecar (usage-sidecar/server.js) via usageGet/usagePost/usageDelete, and the snapshot is
  // reloaded after every mutation so the page can never show a stale write.
  //
  // Styling follows AiUsage.svelte and its aiusage/* siblings: --theme-* variables, the same
  // .state loading/error treatment, and the same section/table chrome as ProjectLedger.svelte.
  // Pickers follow this plugin's own conventions rather than inventing new ones: createQuery()
  // for tracker projects (ProjectApproversList.svelte), EmployeeBox for a single-select employee
  // (HrAttendance.svelte) since UserBoxList in ProjectApprovers.svelte is multi-select and the
  // account-to-employee link is exactly one person or none.
  import { onMount } from 'svelte'
  import contact, { formatName, type Employee, type Person } from '@hcengineering/contact'
  import { EmployeeBox } from '@hcengineering/contact-resources'
  import { AccountRole, roleOrder, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import { Scroller, TimeSince } from '@hcengineering/ui'
  import ygTimesheet, { type WorkProfile } from '@hcengineering/yg-timesheet'
  import { fmtM } from '../utils/ai-usage'
  import { usageGet, usagePost, usageDelete } from '../utils/ai-usage-api'

  interface ConfigRule {
    id: number
    prefix: string
    target_kind: 'project' | 'label'
    project_id: string | null
    project_name: string | null
    label: string | null
    updated: number | null
  }
  interface ConfigAccount {
    uuid: string
    label: string | null
    email: string | null
    plan_cents: number
    last_seen: number | null
  }
  interface DeviceAccountRef { uuid: string, label: string | null }
  interface ConfigDevice {
    id: number
    label: string
    os: string | null
    reported_name: string | null
    employee_ref: string | null
    employee_name: string | null
    created: number
    last_seen: number | null
    revoked_at: number | null
    stale: boolean
    // Labels of OTHER unrevoked devices reporting the same reported_name, i.e. the same machine
    // enrolled twice. Empty for a revoked device or one that has never reported.
    duplicate_with: string[]
    // Which Claude accounts this device has reported under, derived from the facts. Never
    // stored: a device can genuinely show more than one when a shared login moves machines.
    accounts: DeviceAccountRef[]
  }
  interface UnmappedEntry { cwd: string, cwd_norm: string, tokens: number }
  // account_uuid is the viewer's Huly ACCOUNT uuid (what the sidecar matches against the
  // token's `account` claim), not the employee/person ref -- see addViewer below for how it is
  // resolved from a picked employee. employee_ref/employee_name are a display label only.
  interface ConfigViewer {
    account_uuid: string
    employee_ref: string | null
    employee_name: string | null
    added: string | null
    created: number
    can_edit: number // 0 or 1, straight off the sqlite column
  }
  // Sent on every GET /config so the page can render by capability without guessing from which
  // fields happen to be present. role is the raw workspace role string (e.g. 'OWNER', 'USER');
  // can_edit is true for an admin too (an admin can do everything an editor can), computed
  // server-side -- see server.js's GET /config handler.
  interface ConfigMe {
    role: string
    can_edit: boolean
  }
  interface ConfigSnapshot {
    rules: ConfigRule[]
    accounts: ConfigAccount[]
    devices: ConfigDevice[]
    // Present ONLY for an admin caller -- the sidecar omits this key entirely for anyone else,
    // so a non-admin can never read who else is on the list. Never rely on ITS absence to infer
    // admin-ness in the UI below; branch on `me` instead, which is always present.
    viewers?: ConfigViewer[]
    unmapped: UnmappedEntry[]
    me: ConfigMe
  }

  let snap: ConfigSnapshot | undefined
  let loading = true
  let loadError: string | undefined
  // Set instead of loadError for a 401: an expected, everyday outcome now that this page is
  // reachable by every workspace User (see models/yg-timesheet's AiUsage registration), not a
  // service failure -- same calm, distinct treatment as AiUsage.svelte's `forbidden`.
  let forbidden: string | undefined
  // Set after a mutation fails, shown as a page-top banner. Cleared at the start of the next
  // attempt, not on a timer, so it stays visible until the admin either fixes it or retries.
  let actionError: string | undefined

  // isAdmin uses the platform's own Maintainer+ threshold (roleOrder, the same one
  // hasAccountRole compares against) rather than hand-rolling a role list here, so it can never
  // drift from what the sidecar's ADMIN_ROLES actually means. canEdit is a plain server-computed
  // boolean (true for an admin too, see ConfigMe above); the "neither" case renders as a polite
  // refusal, exactly like AiUsage.svelte does for its own 401.
  $: isAdmin = snap?.me != null && roleOrder[snap.me.role as AccountRole] >= roleOrder[AccountRole.Maintainer]
  $: canEdit = snap?.me?.can_edit === true

  // A non-401 failure from usageGet/usagePost/usageDelete carries its HTTP status on `.status`
  // (see ai-usage-api.ts), not just in the message prose, so classification never depends on
  // parsing text that could change shape later. The contract requires 503 (account service
  // down) never read as a permission problem, and 400/404/409 to read distinctly from each
  // other.
  function friendlyError (e: unknown, fallback: string): string {
    const status = e instanceof Error ? (e as Error & { status?: number }).status : undefined
    if (status === 503) return 'The account service is unreachable right now. This is not a permissions problem, try again shortly.'
    if (status === 409) return 'That label is already in use.'
    if (status === 404) return 'Not found. It may already have been removed.'
    if (status === 400) return 'That request was rejected as invalid.'
    const msg = e instanceof Error ? e.message : String(e)
    return msg !== '' ? msg : fallback
  }

  async function load (): Promise<void> {
    loading = true
    loadError = undefined
    forbidden = undefined
    try {
      snap = await usageGet('/config')
      resetAccountDrafts()
      resetDeviceDrafts()
    } catch (e) {
      if ((e as Error & { status?: number })?.status === 401) {
        forbidden = 'You do not have access to AI Usage. Ask a workspace owner to add you as a viewer.'
      } else {
        loadError = friendlyError(e, 'Could not reach the usage service.')
      }
      snap = undefined
    } finally {
      loading = false
    }
  }

  onMount(() => { void load() })

  // --- Tracker projects, for the rule picker -----------------------------------------------
  const projectQuery = createQuery()
  let projects: Project[] = []
  projectQuery.query(tracker.class.Project, {}, (res) => { projects = res })

  // --- Employees, for resolving the name snapshot sent with a device's employee link, and the
  // account uuid sent with a viewer link -----------------------------------------------------
  const employeeQuery = createQuery()
  let employeeName = new Map<Ref<Employee>, string>()
  // Employee.personUuid IS the Huly account uuid for that person (see
  // employeeRefByAccountUuidStore in contact-resources/src/utils.ts, which builds the reverse
  // map from this exact field) -- NOT the same identifier as the employee ref (`_id`). The
  // sidecar's viewer table keys on the account uuid because that is what a request's decoded
  // token carries as `account`; sending the employee ref there would silently never match.
  let employeeByRef = new Map<Ref<Employee>, Employee>()
  employeeQuery.query(contact.mixin.Employee, { active: true }, (res: Employee[]) => {
    employeeName = new Map(res.map((e) => [e._id, formatName(e.name)]))
    employeeByRef = new Map(res.map((e) => [e._id, e]))
  })

  // A previously-linked employee can be inactive (outside the active query above); fall back to
  // a direct lookup so the snapshot name sent to the server is never wrong just because the
  // person left.
  async function nameForEmployee (ref: Ref<Person> | null): Promise<string | null> {
    if (ref == null) return null
    const cached = employeeName.get(ref as Ref<Employee>)
    if (cached !== undefined) return cached
    const emp = await getClient().findOne(contact.mixin.Employee, { _id: ref as Ref<Employee> })
    return emp != null ? formatName(emp.name) : null
  }

  // --- Team Leaders, so the viewer picker below can put them first: adding a TL is the main
  // use case for the Viewers panel, but any active employee may be added. -------------------
  const teamLeadQuery = createQuery()
  let teamLeadRefs = new Set<Ref<Employee>>()
  teamLeadQuery.query(ygTimesheet.mixin.WorkProfile, { designation: 'Team Leader' }, (res: WorkProfile[]) => {
    teamLeadRefs = new Set(res.map((e) => e._id as unknown as Ref<Employee>))
  })

  // Busy keys disable the one control in flight without freezing the rest of the page.
  let busy = new Set<string>()
  function setBusy (key: string, on: boolean): void {
    const next = new Set(busy)
    if (on) next.add(key); else next.delete(key)
    busy = next
  }

  // =========================================================================================
  // Mapping
  // =========================================================================================
  let addPrefix = ''
  let addKind: 'project' | 'label' = 'project'
  let addProjectId: Ref<Project> | '' = ''
  let addLabel = ''
  let addError: string | undefined
  let prefixInput: HTMLInputElement | undefined

  function resetAddRule (): void {
    addPrefix = ''
    addKind = 'project'
    addProjectId = ''
    addLabel = ''
    addError = undefined
  }

  function mapThis (entry: UnmappedEntry): void {
    resetAddRule()
    addPrefix = entry.cwd_norm
    prefixInput?.focus()
  }

  async function addRule (): Promise<void> {
    actionError = undefined
    addError = undefined
    const prefix = addPrefix.trim()
    if (prefix === '') { addError = 'A prefix is required.'; return }
    const project = addKind === 'project' ? projects.find((p) => p._id === addProjectId) : undefined
    if (addKind === 'project' && project === undefined) { addError = 'Pick a project.'; return }
    const label = addLabel.trim()
    if (addKind === 'label' && label === '') { addError = 'A label is required.'; return }

    setBusy('rule-add', true)
    try {
      await usagePost('/config/rule', {
        prefix,
        target_kind: addKind,
        project_id: addKind === 'project' ? project?._id ?? null : null,
        project_name: addKind === 'project' ? project?.name ?? null : null,
        label: addKind === 'label' ? label : null
      })
      resetAddRule()
      await load()
    } catch (e) {
      addError = friendlyError(e, 'Could not save that rule.')
    } finally {
      setBusy('rule-add', false)
    }
  }

  async function removeRule (rule: ConfigRule): Promise<void> {
    actionError = undefined
    setBusy(`rule:${rule.id}`, true)
    try {
      await usageDelete(`/config/rule/${rule.id}`)
      await load()
    } catch (e) {
      actionError = friendlyError(e, 'Could not remove that rule.')
    } finally {
      setBusy(`rule:${rule.id}`, false)
    }
  }

  // =========================================================================================
  // Accounts
  // =========================================================================================
  // The account carries only the fee now: one Claude account is shared by several people, and
  // the monthly fee belongs to the subscription, not to a person. Person-attribution lives on
  // the device instead (see Devices below).
  interface AccountDraft { fee: number, error?: string }
  let accountDrafts: Record<string, AccountDraft> = {}

  // Reset to the committed snapshot on every load, including after this row's own save. An
  // in-flight edit on a DIFFERENT row loses its draft if some other panel's mutation reloads the
  // page first; on an admin-only, low-traffic page that is an acceptable trade for never
  // rendering a stale write.
  function resetAccountDrafts (): void {
    const next: Record<string, AccountDraft> = {}
    for (const a of snap?.accounts ?? []) {
      // A number type input already turns this into a real number the instant it round-trips
      // through the DOM (bind:value on type="number" reads back via `+input.value`).
      next[a.uuid] = { fee: a.plan_cents / 100 }
    }
    accountDrafts = next
  }

  async function saveAccount (a: ConfigAccount): Promise<void> {
    actionError = undefined
    const d = accountDrafts[a.uuid]
    d.error = undefined
    if (!Number.isFinite(d.fee) || d.fee < 0) {
      d.error = 'Enter a fee of 0 or more.'
      accountDrafts = { ...accountDrafts }
      return
    }
    setBusy(`account:${a.uuid}`, true)
    try {
      await usagePost(`/config/account/${encodeURIComponent(a.uuid)}`, {
        plan_cents: Math.round(d.fee * 100)
      })
      await load()
    } catch (e) {
      d.error = friendlyError(e, 'Could not save that account.')
      accountDrafts = { ...accountDrafts }
    } finally {
      setBusy(`account:${a.uuid}`, false)
    }
  }

  // =========================================================================================
  // Devices
  // =========================================================================================
  // THIS is where a person is assigned: a device is one person's machine, so the employee link
  // lives here rather than on the shared account. Same draft-and-Save shape as accounts above.
  interface DeviceDraft { employee: Ref<Person> | null, error?: string }
  let deviceDrafts: Record<number, DeviceDraft> = {}

  function resetDeviceDrafts (): void {
    const next: Record<number, DeviceDraft> = {}
    for (const d of snap?.devices ?? []) {
      next[d.id] = { employee: (d.employee_ref as Ref<Person> | null) ?? null }
    }
    deviceDrafts = next
  }

  async function saveDeviceEmployee (device: ConfigDevice): Promise<void> {
    actionError = undefined
    const d = deviceDrafts[device.id]
    d.error = undefined
    setBusy(`device-employee:${device.id}`, true)
    try {
      const employee_name = await nameForEmployee(d.employee)
      await usagePost(`/config/device/${device.id}/employee`, {
        employee_ref: d.employee,
        employee_name
      })
      await load()
    } catch (e) {
      d.error = friendlyError(e, 'Could not save that device.')
      deviceDrafts = { ...deviceDrafts }
    } finally {
      setBusy(`device-employee:${device.id}`, false)
    }
  }

  let addDeviceLabel = ''
  let addDeviceError: string | undefined
  // The token is shown exactly once, right after creation, and never again after this banner
  // is dismissed or the page reloads.
  let newDeviceToken: { label: string, token: string } | undefined
  let copied = false

  async function addDevice (): Promise<void> {
    actionError = undefined
    addDeviceError = undefined
    const label = addDeviceLabel.trim()
    if (label === '') { addDeviceError = 'A label is required.'; return }
    setBusy('device-add', true)
    try {
      const res: { id: number, token: string } = await usagePost('/config/device', { label })
      newDeviceToken = { label, token: res.token }
      copied = false
      addDeviceLabel = ''
      await load()
    } catch (e) {
      addDeviceError = friendlyError(e, 'Could not add that device.')
    } finally {
      setBusy('device-add', false)
    }
  }

  async function copyToken (): Promise<void> {
    if (newDeviceToken === undefined) return
    try {
      await navigator.clipboard.writeText(newDeviceToken.token)
      copied = true
    } catch {
      // Clipboard access can be blocked; the token stays visible and selectable either way.
    }
  }

  async function revokeDevice (device: ConfigDevice): Promise<void> {
    actionError = undefined
    setBusy(`device:${device.id}`, true)
    try {
      await usagePost(`/config/device/${device.id}/revoke`, {})
      await load()
    } catch (e) {
      actionError = friendlyError(e, 'Could not revoke that device.')
    } finally {
      setBusy(`device:${device.id}`, false)
    }
  }

  // =========================================================================================
  // Viewers
  // =========================================================================================
  // Grants read-only access to the whole dashboard (GET /report) to someone who is not a
  // workspace admin -- the Team Leader case this panel exists for. It carries no admin power:
  // every /config/* route, including this one, still requires an admin role on the sidecar side.
  let newViewerEmployee: Ref<Person> | null = null
  let addViewerError: string | undefined

  async function addViewer (): Promise<void> {
    actionError = undefined
    addViewerError = undefined
    if (newViewerEmployee == null) { addViewerError = 'Pick an employee.'; return }
    const emp = employeeByRef.get(newViewerEmployee as Ref<Employee>)
    if (emp === undefined) { addViewerError = 'Could not find that employee.'; return }
    // Employee.personUuid is the Huly account uuid (see the note by employeeByRef above). A
    // person who has never accepted their workspace invite has none yet -- refuse explicitly
    // here rather than sending a wrong id that would silently never match the token's account
    // claim on the sidecar side.
    const accountUuid = emp.personUuid
    if (accountUuid == null || accountUuid === '') {
      addViewerError = `${formatName(emp.name)} has no linked Huly account yet (they have not signed in), so they cannot be added as a viewer.`
      return
    }
    setBusy('viewer-add', true)
    try {
      await usagePost('/config/viewer', {
        account_uuid: accountUuid,
        employee_ref: emp._id,
        employee_name: formatName(emp.name)
      })
      newViewerEmployee = null
      await load()
    } catch (e) {
      addViewerError = friendlyError(e, 'Could not add that viewer.')
    } finally {
      setBusy('viewer-add', false)
    }
  }

  async function removeViewer (viewer: ConfigViewer): Promise<void> {
    actionError = undefined
    setBusy(`viewer:${viewer.account_uuid}`, true)
    try {
      await usageDelete(`/config/viewer/${encodeURIComponent(viewer.account_uuid)}`)
      await load()
    } catch (e) {
      actionError = friendlyError(e, 'Could not remove that viewer.')
    } finally {
      setBusy(`viewer:${viewer.account_uuid}`, false)
    }
  }

  // Promotes/demotes an existing viewer between the viewer and editor tiers. Editor grants
  // exactly two capabilities on the sidecar (mapping rules, device-employee assignment) and
  // nothing more -- see server.js's route tiering -- so this toggle never widens beyond that.
  async function toggleViewerEdit (viewer: ConfigViewer): Promise<void> {
    actionError = undefined
    setBusy(`viewer-edit:${viewer.account_uuid}`, true)
    try {
      await usagePost(`/config/viewer/${encodeURIComponent(viewer.account_uuid)}/edit`, {
        can_edit: viewer.can_edit !== 1
      })
      await load()
    } catch (e) {
      actionError = friendlyError(e, 'Could not change that viewer\'s access.')
    } finally {
      setBusy(`viewer-edit:${viewer.account_uuid}`, false)
    }
  }
</script>

<Scroller>
  <div class="ai-usage-config">
    <h1>AI Usage configuration</h1>
    <p class="lede">Map working directories to projects or labels, set each Claude account's
      monthly fee, assign each device to the person who uses it, and issue device tokens.
      Changes here reshape past reports immediately: nothing is re-ingested.</p>

    {#if loading}
      <div class="state">Loading configuration...</div>
    {:else if forbidden !== undefined}
      <div class="state">{forbidden}</div>
    {:else if loadError !== undefined}
      <div class="state err">{loadError}</div>
    {:else if snap !== undefined && !isAdmin && !canEdit}
      <div class="state">You do not have access to AI Usage configuration. Ask a workspace owner to add you as a viewer or editor.</div>
    {:else if snap !== undefined}
      {#if actionError !== undefined}
        <div class="state err">{actionError}</div>
      {/if}

      <!-- Mapping ============================================================================ -->
      <section class="panel">
        <div class="head"><h2>Mapping</h2><span class="tag">Rules</span></div>
        <p class="note">A working-directory prefix maps to either a tracker project or a free-text
          label. The longest matching prefix wins. A project rule stores the project's name
          alongside its id, so a later rename or deletion still renders correctly in old reports.</p>

        <div class="scroll">
          <table>
            <thead>
              <tr><th>Prefix</th><th>Target</th><th class="act" /></tr>
            </thead>
            <tbody>
              {#each snap.rules as rule (rule.id)}
                <tr>
                  <td class="mono">{rule.prefix}</td>
                  <td>
                    {#if rule.target_kind === 'project'}
                      <span class="chip chip-project">{rule.project_name ?? '(unnamed project)'}</span>
                    {:else}
                      <span class="chip chip-label">{rule.label ?? '(no label)'}</span>
                    {/if}
                  </td>
                  <td class="act">
                    <button
                      type="button" class="link-btn danger"
                      disabled={busy.has(`rule:${rule.id}`)}
                      on:click={() => removeRule(rule)}
                    >Remove</button>
                  </td>
                </tr>
              {/each}
              {#if snap.rules.length === 0}
                <tr><td colspan="3" class="empty">No mapping rules yet.</td></tr>
              {/if}
            </tbody>
          </table>
        </div>

        <form class="add-row" on:submit|preventDefault={addRule}>
          <input
            bind:this={prefixInput}
            class="txt prefix"
            type="text"
            placeholder="~/dev/some-project"
            bind:value={addPrefix}
          />
          <div class="seg" role="group" aria-label="Target kind">
            <button type="button" aria-pressed={addKind === 'project'} on:click={() => { addKind = 'project' }}>Project</button>
            <button type="button" aria-pressed={addKind === 'label'} on:click={() => { addKind = 'label' }}>Label</button>
          </div>
          {#if addKind === 'project'}
            <select class="txt" bind:value={addProjectId}>
              <option value="">Pick a project...</option>
              {#each projects as p (p._id)}
                <option value={p._id}>{p.name}</option>
              {/each}
            </select>
          {:else}
            <input class="txt" type="text" placeholder="Label" bind:value={addLabel} />
          {/if}
          <button class="primary-btn" type="submit" disabled={busy.has('rule-add')}>Add rule</button>
        </form>
        {#if addError !== undefined}
          <div class="inline-err">{addError}</div>
        {/if}

        <h3 class="sub">Unmapped</h3>
        {#if snap.unmapped.length === 0}
          <p class="note">Every working directory seen in the last 30 days is mapped.</p>
        {:else}
          <ul class="unmapped">
            {#each snap.unmapped as entry (entry.cwd_norm)}
              <li>
                <span class="mono path">{entry.cwd}</span>
                <span class="tok">{fmtM(entry.tokens)} tokens</span>
                <button type="button" class="link-btn" on:click={() => mapThis(entry)}>Map this</button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- Accounts =========================================================================== -->
      <section class="panel">
        <div class="head"><h2>Accounts</h2><span class="tag">Billing</span></div>
        {#if isAdmin}
          <p class="note">Set each Claude account's monthly plan fee, in whole currency units. The
            fee is a property of the subscription, not of a person, so it is set here; who uses
            the account is assigned per device, in the Devices panel below. The fee is stored in
            cents and prorated on the usage dashboard.</p>
        {:else}
          <p class="note">Each Claude account's monthly plan fee. Only an owner can change it; who
            uses the account is assigned per device, in the Devices panel below.</p>
        {/if}

        <div class="scroll">
          <table>
            <thead>
              <tr><th>Account</th><th class="n">Monthly fee</th>{#if isAdmin}<th class="act" />{/if}</tr>
            </thead>
            <tbody>
              {#each snap.accounts as a (a.uuid)}
                <tr>
                  <td>
                    <div class="acct-name">{a.label ?? a.uuid}</div>
                    {#if a.email != null && a.email !== ''}<div class="acct-email">{a.email}</div>{/if}
                  </td>
                  <td class="n">
                    {#if isAdmin}
                      {#if accountDrafts[a.uuid] !== undefined}
                        <input class="txt fee" type="number" min="0" step="0.01" bind:value={accountDrafts[a.uuid].fee} />
                      {/if}
                    {:else}
                      {(a.plan_cents / 100).toFixed(2)}
                    {/if}
                  </td>
                  {#if isAdmin}
                    <td class="act">
                      <button
                        type="button" class="link-btn"
                        disabled={accountDrafts[a.uuid] === undefined || busy.has(`account:${a.uuid}`)}
                        on:click={() => saveAccount(a)}
                      >Save</button>
                    </td>
                  {/if}
                </tr>
                {#if isAdmin && accountDrafts[a.uuid]?.error !== undefined}
                  <tr><td colspan="3" class="inline-err">{accountDrafts[a.uuid].error}</td></tr>
                {/if}
              {/each}
              {#if snap.accounts.length === 0}
                <tr><td colspan="3" class="empty">No accounts have reported usage yet.</td></tr>
              {/if}
            </tbody>
          </table>
        </div>
      </section>

      <!-- Devices ============================================================================ -->
      <section class="panel">
        <div class="head"><h2>Devices</h2><span class="tag">Tokens</span></div>
        <p class="note">Each device authenticates with its own token and belongs to one person.
          The account column shows which Claude account(s) the device has actually reported
          usage under; it is read-only here because it comes from the facts, not from a setting.
          A revoked device can no longer send usage.</p>

        <div class="scroll">
          <table>
            <thead>
              <tr><th>Device</th><th>User</th><th>Account</th><th>Last seen</th><th class="act" /></tr>
            </thead>
            <tbody>
              {#each snap.devices as device (device.id)}
                <tr>
                  <td>
                    <div class="dev-name">{device.reported_name ?? device.label}</div>
                    {#if device.stale}<span class="badge warn">no payload in over 24 hours</span>{/if}
                    {#if device.duplicate_with.length > 0}
                      <span class="badge warn" title="Also reported by {device.duplicate_with.join(', ')}. Revoke the duplicate.">
                        duplicate machine
                      </span>
                    {/if}
                    {#if device.revoked_at != null}<span class="badge">revoked</span>{/if}
                  </td>
                  <td>
                    {#if deviceDrafts[device.id] !== undefined}
                      <EmployeeBox
                        label={ygTimesheet.string.Employee}
                        bind:value={deviceDrafts[device.id].employee}
                        allowDeselect={true}
                        kind="regular"
                        size="medium"
                      />
                    {/if}
                  </td>
                  <td>
                    {#if device.accounts.length === 0}
                      <span class="muted">-</span>
                    {:else}
                      {#each device.accounts as acc (acc.uuid)}
                        <span class="chip chip-account">{acc.label ?? acc.uuid}</span>
                      {/each}
                    {/if}
                  </td>
                  <td>
                    {#if device.last_seen != null}
                      <TimeSince value={device.last_seen * 1000} />
                    {:else}
                      Never
                    {/if}
                  </td>
                  <td class="act">
                    <button
                      type="button" class="link-btn"
                      disabled={deviceDrafts[device.id] === undefined || busy.has(`device-employee:${device.id}`)}
                      on:click={() => saveDeviceEmployee(device)}
                    >Save</button>
                    {#if isAdmin && device.revoked_at == null}
                      <button
                        type="button" class="link-btn danger"
                        disabled={busy.has(`device:${device.id}`)}
                        on:click={() => revokeDevice(device)}
                      >Revoke</button>
                    {/if}
                  </td>
                </tr>
                {#if deviceDrafts[device.id]?.error !== undefined}
                  <tr><td colspan="5" class="inline-err">{deviceDrafts[device.id].error}</td></tr>
                {/if}
              {/each}
              {#if snap.devices.length === 0}
                <tr><td colspan="5" class="empty">No devices enrolled yet.</td></tr>
              {/if}
            </tbody>
          </table>
        </div>

        {#if isAdmin}
          <!-- Enrollment mints a token that is a write credential over the whole fact space, so
               this stays admin-only, unlike the employee picker above (an editor may use that). -->
          <form class="add-row" on:submit|preventDefault={addDevice}>
            <input class="txt" type="text" placeholder="Device label" bind:value={addDeviceLabel} />
            <button class="primary-btn" type="submit" disabled={busy.has('device-add')}>Add device</button>
          </form>
          {#if addDeviceError !== undefined}
            <div class="inline-err">{addDeviceError}</div>
          {/if}

          {#if newDeviceToken !== undefined}
            <div class="token-box">
              <div class="token-head">Token for <b>{newDeviceToken.label}</b></div>
              <code class="token-value">{newDeviceToken.token}</code>
              <div class="token-row">
                <button type="button" class="primary-btn" on:click={copyToken}>{copied ? 'Copied' : 'Copy'}</button>
                <button type="button" class="link-btn" on:click={() => { newDeviceToken = undefined }}>Done</button>
              </div>
              <p class="token-note">Copy this now. It is shown once and cannot be retrieved later.</p>
            </div>
          {/if}
        {/if}
      </section>

      <!-- Viewers ============================================================================ -->
      <!-- Admin-only, full stop: managing this list IS the access model, so it is never shown to
           an editor, who is themselves only ever a row in it. -->
      {#if isAdmin}
        <section class="panel">
          <div class="head"><h2>Viewers</h2><span class="tag">Access</span></div>
          <p class="note">Anyone on this list can see the whole dashboard without being a workspace
            owner, mainly for Team Leaders who need to check their team's usage. An <b>editor</b>
            can additionally map projects and assign devices to people, same as an owner, but
            nothing more: no enrolling or revoking devices, no billing, no changing this list.</p>

          <div class="scroll">
            <table>
              <thead>
                <tr><th>Person</th><th>Access</th><th>Added</th><th class="act" /></tr>
              </thead>
              <tbody>
                {#each snap.viewers ?? [] as viewer (viewer.account_uuid)}
                  <tr>
                    <td>
                      <div class="acct-name">{viewer.employee_name ?? viewer.account_uuid}</div>
                    </td>
                    <td>
                      <span class="chip" class:chip-editor={viewer.can_edit === 1}>
                        {viewer.can_edit === 1 ? 'Editor' : 'Viewer'}
                      </span>
                    </td>
                    <td><TimeSince value={viewer.created * 1000} /></td>
                    <td class="act">
                      <button
                        type="button" class="link-btn"
                        disabled={busy.has(`viewer-edit:${viewer.account_uuid}`)}
                        on:click={() => toggleViewerEdit(viewer)}
                      >{viewer.can_edit === 1 ? 'Make viewer-only' : 'Make editor'}</button>
                      <button
                        type="button" class="link-btn danger"
                        disabled={busy.has(`viewer:${viewer.account_uuid}`)}
                        on:click={() => removeViewer(viewer)}
                      >Remove</button>
                    </td>
                  </tr>
                {/each}
                {#if (snap.viewers ?? []).length === 0}
                  <tr><td colspan="4" class="empty">No viewers added yet.</td></tr>
                {/if}
              </tbody>
            </table>
          </div>

          <form class="add-row viewer-add" on:submit|preventDefault={addViewer}>
            <!-- Team Leaders first, since adding a TL is the main reason this panel exists, but
                 the second box reaches every active employee so anyone can be added. Both are the
                 same EmployeeBox picker used for the device assignment above; only their docQuery
                 (and so which employees show up) differs. Both boxes are bound to the same value:
                 whichever one the admin picks from is what gets added. New viewers always start
                 as viewer-only (can_edit defaults to false server-side); promote with the "Make
                 editor" button above once they're on the list, to keep the two steps separate. -->
            <div class="picker">
              <span class="picker-label">Team Leader</span>
              <EmployeeBox
                docQuery={{ active: true, _id: { $in: Array.from(teamLeadRefs) } }}
                label={ygTimesheet.string.Employee}
                bind:value={newViewerEmployee}
                kind="regular"
                size="medium"
              />
            </div>
            <div class="picker">
              <span class="picker-label">Any employee</span>
              <EmployeeBox
                label={ygTimesheet.string.Employee}
                bind:value={newViewerEmployee}
                kind="regular"
                size="medium"
              />
            </div>
            <button class="primary-btn" type="submit" disabled={busy.has('viewer-add')}>Add viewer</button>
          </form>
          {#if addViewerError !== undefined}
            <div class="inline-err">{addViewerError}</div>
          {/if}
        </section>
      {/if}
    {/if}
  </div>
</Scroller>

<style lang="scss">
  .ai-usage-config { padding: 1.5rem 1.25rem 4rem; max-width: 72rem; margin: 0 auto; }
  h1 { font-size: 1.3rem; font-weight: 700; margin: 0 0 .25rem; }
  .lede { color: var(--theme-dark-color); font-size: .85rem; margin: 0 0 1.25rem; max-width: 68ch; }
  .state { padding: 1.75rem 1rem; text-align: center; color: var(--theme-dark-color);
    border: 1px solid var(--theme-divider-color); border-radius: .5rem; margin-bottom: 1rem; }
  .state.err { color: var(--theme-error-color); text-align: left; }

  .panel { margin-bottom: 2.125rem; }
  .head { display: flex; align-items: baseline; gap: .625rem; margin-bottom: .1875rem; flex-wrap: wrap; }
  h2 { font-size: .9375rem; font-weight: 600; letter-spacing: -.01em; margin: 0; color: var(--theme-caption-color); }
  h3.sub { font-size: .8125rem; font-weight: 600; color: var(--theme-caption-color); margin: 1rem 0 .5rem; }
  .tag {
    font-size: .5625rem; letter-spacing: .1em; text-transform: uppercase; padding: .125rem .4375rem;
    border-radius: 1.25rem; background: var(--theme-caption-color); color: var(--theme-bg-color); font-weight: 600;
  }
  .note { color: var(--theme-dark-color); font-size: .75rem; margin: 0 0 .75rem; max-width: 78ch; }

  .scroll { overflow-x: auto; background: var(--theme-comp-header-color); border: 1px solid var(--theme-divider-color); border-radius: .625rem; }
  table { width: 100%; border-collapse: collapse; font-size: .8125rem; min-width: 32rem; }
  th, td { padding: .5625rem .8125rem; text-align: left; border-bottom: 1px solid var(--theme-divider-color); vertical-align: middle; }
  thead th {
    font-size: .625rem; color: var(--theme-dark-color); font-weight: 500; text-transform: uppercase;
    letter-spacing: .08em; white-space: nowrap; position: sticky; top: 0; background: var(--theme-comp-header-color);
  }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: var(--theme-bg-color); }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.act, th.act { text-align: right; white-space: nowrap; width: 1%; }
  .empty { text-align: center; color: var(--theme-dark-color); }
  .mono { font-family: var(--theme-mono-font, monospace); font-size: .75rem; }

  .chip {
    font-size: .6875rem; border-radius: 1.25rem; padding: .1875rem .625rem; white-space: nowrap;
    display: inline-block; border: 1px solid var(--theme-divider-color);
  }
  .chip-project { background: var(--theme-navpanel-selected, var(--theme-comp-header-color)); color: var(--theme-caption-color); font-weight: 600; }
  .chip-label { color: var(--theme-dark-color); font-style: italic; }
  .chip-account { background: var(--theme-comp-header-color); color: var(--theme-caption-color); font-weight: 500; margin: 0 .25rem .25rem 0; }
  .chip-editor { background: var(--theme-navpanel-selected, var(--theme-comp-header-color)); color: var(--theme-caption-color); font-weight: 600; }
  .muted { color: var(--theme-dark-color); }

  .acct-name { font-weight: 500; color: var(--theme-caption-color); }
  .acct-email { font-size: .6875rem; color: var(--theme-dark-color); }

  .dev-name { font-weight: 500; color: var(--theme-caption-color); }

  .badge {
    display: inline-block; margin-left: .5rem; font-size: .625rem; text-transform: uppercase;
    letter-spacing: .06em; padding: .0625rem .4375rem; border-radius: 1.25rem;
    border: 1px solid var(--theme-divider-color); color: var(--theme-dark-color);
  }
  .badge.warn { color: var(--theme-warning-color); border-color: var(--theme-warning-color); }

  .add-row { display: flex; flex-wrap: wrap; gap: .625rem; align-items: center; margin-top: .875rem; }
  .viewer-add { align-items: flex-end; }
  .picker { display: flex; flex-direction: column; gap: .25rem; }
  .picker-label { font-size: .625rem; color: var(--theme-dark-color); text-transform: uppercase; letter-spacing: .06em; }
  .txt, select.txt {
    font: inherit; font-size: .8125rem; color: var(--theme-content-color);
    background: var(--theme-bg-color); border: 1px solid var(--theme-divider-color);
    border-radius: .4375rem; padding: .375rem .5625rem;
  }
  .prefix { min-width: 16rem; flex: 1 1 16rem; }
  .fee { width: 6rem; text-align: right; }
  select.txt { min-width: 12rem; }

  .seg { display: flex; border: 1px solid var(--theme-divider-color); border-radius: .4375rem; overflow: hidden; }
  .seg button {
    font-size: .75rem; border: 0; padding: .4375rem .75rem; background: var(--theme-bg-color);
    color: var(--theme-dark-color); cursor: pointer; border-right: 1px solid var(--theme-divider-color);
  }
  .seg button:last-child { border-right: 0; }
  .seg button[aria-pressed='true'] { background: var(--theme-caption-color); color: var(--theme-bg-color); font-weight: 600; }

  .primary-btn {
    font-size: .8125rem; font-weight: 600; border: 0; border-radius: .4375rem; padding: .4375rem .875rem;
    background: var(--theme-caption-color); color: var(--theme-bg-color); cursor: pointer;
  }
  .primary-btn:disabled { opacity: .55; cursor: default; }
  .link-btn {
    font-size: .75rem; background: none; border: 0; color: var(--theme-dark-color);
    cursor: pointer; text-decoration: underline; padding: .1875rem .125rem;
  }
  .link-btn.danger { color: var(--theme-error-color); }
  .link-btn:disabled { opacity: .5; cursor: default; text-decoration: none; }

  .inline-err { color: var(--theme-error-color); font-size: .75rem; margin-top: .375rem; }

  .unmapped { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .375rem; }
  .unmapped li {
    display: flex; align-items: center; gap: .75rem; padding: .5rem .75rem;
    background: var(--theme-comp-header-color); border: 1px solid var(--theme-divider-color); border-radius: .4375rem;
  }
  .unmapped .path { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .unmapped .tok { font-size: .75rem; color: var(--theme-dark-color); white-space: nowrap; }

  .token-box {
    margin-top: 1rem; padding: .875rem 1rem; border-radius: .625rem;
    background: var(--theme-comp-header-color); border: 1px solid var(--theme-warning-color);
  }
  .token-head { font-size: .8125rem; margin-bottom: .5rem; }
  .token-value {
    display: block; font-family: var(--theme-mono-font, monospace); font-size: .8125rem;
    background: var(--theme-bg-color); border: 1px solid var(--theme-divider-color); border-radius: .375rem;
    padding: .5rem .625rem; word-break: break-all; user-select: all;
  }
  .token-row { display: flex; gap: .625rem; margin-top: .625rem; align-items: center; }
  .token-note { font-size: .75rem; color: var(--theme-warning-color); font-weight: 600; margin: .625rem 0 0; }

  @media (max-width: 40rem) {
    .add-row { flex-direction: column; align-items: stretch; }
    .prefix, select.txt { width: 100%; min-width: 0; }
  }
</style>
