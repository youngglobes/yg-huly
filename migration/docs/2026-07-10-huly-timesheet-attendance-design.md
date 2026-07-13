# Timesheets + Attendance in Huly — Design Spec

**Date:** 2026-07-10
**Status:** Approved (design reviewed in session; implementation plan to follow)
**Decision owner:** praja@youngglobes.com

---

## 1. Problem & goal

The org runs two tools: **Huly** (project management — issues, tasks, per-task time) and
**OrangeHRM 3.3.1** at hr.youngglobe.com (employee records, punch in/out, timesheets).
Projects/activities are duplicated in both. Employees do double data entry: work + log time
in Huly, then re-describe the same 8h/day in HR-portal timesheets, pasting Huly task links
into comments so leads can see what was done. Tracking real project hours requires manually
reconciling the two systems (see the Jonard-hours pipeline, §3C).

**Goal: one portal.** Timesheets and punch in/out move INTO Huly; timesheets are *derived*
from work already logged there (verify, don't re-type). OrangeHRM is retired for
timesheets/attendance and kept only as read-only archive + employee master data + leave.

## 2. Decisions (locked)

| Question | Decision |
|---|---|
| Architecture | **B — build inside Huly** (fork `yg_develop`), not a bridge service |
| System of record for hours | **Huly** (nothing downstream needs hours inside OrangeHRM) |
| Timesheet period | **Weekly sheet with daily rows**; submit day-by-day, approve day-by-day or whole week |
| Approver | **One approver per employee** — team lead/manager from Huly HR `Department` (fallback: configurable default approver). PMs get per-project *reports*, not approval rights |
| Punch scope | **Simple in/out + daily total** — multiple sessions/day (breaks), optional note, HR-viewable attendance report |
| History | **No migration** — OrangeHRM becomes read-only archive; Huly starts at cutover |
| 8h rule | Warning/indicator, not a hard block |

## 3. What the analysis found (grounding)

### A. Huly already has the hard parts (reuse, don't rebuild)
- **`TimeSpendReport`** (`plugins/tracker/src/index.ts` ~L299): per-issue time entry —
  `employee`, `date`, `value` (man-hours), `description` — with full add/edit UI on every
  issue (`plugins/tracker-resources/.../timereport/`) and a server trigger that keeps
  `Issue.reportedTime`/`remainingTime` rolled up (`server-plugins/tracker-resources`).
  Stored in `DOMAIN_TRACKER`. **Employees already fill these today.**
- **HR module** (`plugins/hr`): `Department` (with `teamLead`, `managers`, `members`),
  `Staff`, leave/PTO `Request`s, `PublicHoliday`. Its ScheduleView already queries
  TimeSpendReports across staff+dates (`plugins/hr-resources/.../ScheduleView.svelte` ~L199)
  — precedent for the aggregation we need.
- **API client** (`foundations/core/packages/api-client`): REST/WS external access with
  bearer tokens (used later for report automation; the existing Huly MCP that Jonard reports
  read continues to work unchanged — same underlying data).
- **Audit trail**: every Doc has `modifiedBy/modifiedOn`; full Tx log powers "issues you
  touched today" suggestions.
- **Missing (the build):** timesheet workflow document (submit/approve/lock), timesheet UI,
  auto-generation, and any attendance/punch concept (fully greenfield).

### B. OrangeHRM (hr.youngglobe.com) is a dead end for integration
v3.3.1 (2014-era Symfony 1.4), compat-patched, deployed on Railway. Its REST API exposes
only 3 read-only lookups — no timesheet/attendance endpoints. Only write surface would be
direct DB. This materially strengthened the all-in-Huly decision.

### C. Jonard-hours = the manual prototype of this feature
Scripts reconcile HR-portal scrapes with Huly time entries (via a self-hosted Huly MCP),
route approval through a Google Sheet, and publish to Outline. Reusable: the member
name-mapping (`lib-members.mjs`), the discrepancy rules (>0.5h/day → unbooked/missing/extra),
and — during rollout — the whole pipeline as an independent validation oracle.
⚠️ Also found: **plaintext credentials in that repo** (HR portal login, GCP service-account
key, Outline API key) — rotate regardless of this project.

## 4. Architecture

Two self-contained plugin sets on **`yg_develop`** (v0.7.426-pinned production branch):

```
plugins/yg-timesheet/            plugin interface (classes, ids)
plugins/yg-timesheet-resources/  Svelte UI (My Timesheet, Approvals, Reports)
models/yg-timesheet/             model definitions + migrations
server-plugins/yg-timesheet*/    approval triggers (snapshot on approve, notifications)
plugins/yg-attendance*/          punch widget + attendance report (same shape)
models/yg-attendance/
```

**Isolation rule: new files only**, plus a handful of registration touchpoints (rush.json
project list, model builder registration, workbench app registration, prod bundle deps).
This keeps per-upgrade rebase conflicts near zero — same principle that makes `migration/`
rebase-proof.

### The accepted cost: three custom images
New model classes + server triggers mean stock images no longer suffice. CI on `yg_develop`
builds a **set of four** custom images: `front` (exists), **`workspace`** (applies extended
model on create/upgrade), **`transactor`** (serves model + runs triggers), and **`tool`**
(the spike found the tool bundles the model too — it drives restore/upgrade, so it must carry
the class or workspace-mutating ops break) — all tagged `v0.7.426-yg`, pinned in compose,
auto-deployed by the existing pipeline. Every future Huly upgrade rebuilds four images instead
of one. **Accepted knowingly.**

### Phase 0 spike findings (2026-07-13) — GATE: GO ✅

Executed on branch `yg/spike-model-trio` (merged to `yg_develop`) with a one-class
`yg-timesheet` skeleton model. Results:

- **Model compiles + wires into `model-all`** cleanly (new-files-only; upstream touch limited
  to `rush.json`, `models/all/*`, the CI workflow).
- **CI builds all four images** (`front`+`workspace`+`transactor`+`tool` → GHCR) in one run;
  `deploy-front` correctly **skipped** on the spike branch (production untouched).
- **Model is baked into the images:** transactor `model.json` contains the literal resolved
  id `yg-timesheet:class:Timesheet`; workspace/tool bundles carry the builder code.
- **Fresh workspace on the custom images gets the class:** the per-class domain table
  `public.yg_timesheet` is created and indexed. *(Gate-signal correction: this Huly version
  does not persist built-in class **definitions** as `tx` rows for any class — stock or custom
  — so use domain-table existence, not a `tx` LIKE query, to verify a model class landed.)*
- **Stock-tool `upgrade-workspace` survives** (class table intact, front 200) but logs ~72
  "model transaction skipped" drift warnings → **workspace-mutating ops (restore/upgrade) MUST
  use the custom `tool` image**, not stock; pin it in `run-tool.sh` and the re-migration runbook.

**Conclusion:** the custom-model pipeline works end-to-end. Proceed to write the Phase 1
(timesheet module) plan. Minor follow-ups: the CD deploy-front gate needs `success() &&` (fixed
during the spike); test tool-runs should include `QUEUE_CONFIG` to avoid benign Kafka noise.

## 5. Data model

**Lines are NOT a new concept** — a timesheet line *is* an existing `TimeSpendReport`.
We add only the workflow wrapper:

```ts
Timesheet extends Doc {            // one per employee-week
  employee: Ref<Employee>
  weekStart: Timestamp             // Monday 00:00, workspace tz
}

TimesheetDay extends AttachedDoc { // attachedTo: Timesheet
  date: Timestamp
  status: Draft | Submitted | Approved | Rejected
  submittedOn?: Timestamp
  approvedBy?: Ref<Employee>
  approvedOn?: Timestamp
  rejectReason?: string
  totalHours: number               // denormalized day total
  snapshot?: TimesheetLine[]       // frozen on approval (see below)
}

TimesheetLine {                    // embedded, snapshot only — not a Doc
  issue: Ref<Issue>; identifier: string; title: string
  project: string; hours: number; note: string
}

PunchSession extends Doc {
  employee: Ref<Employee>
  punchIn: Timestamp
  punchOut?: Timestamp             // open session = punched in
  note?: string
}
```

- **Live days** render their lines by querying
  `TimeSpendReport { employee, date ∈ day }` + lookup issue → grouped by project.
  Editing hours inline writes ordinary TimeSpendReports (existing rollups keep working).
- **Approval freezes a snapshot** into the day — approved records stay immutable even if a
  report is edited later. Post-approval drift (live sum ≠ snapshot) renders as a ⚠ flag on
  the day, never a silent change. No hard-locking of TimeSpendReports.
- **Non-project time** (meetings, internal work, interviews): a designated internal Huly
  project with standing issues — so these are ordinary time reports too. One line type total.
- State machine (server trigger enforces legal transitions + writes snapshot):
  `Draft → Submitted → Approved | Rejected(reason) → Draft`. Approve-week = approve all
  submitted days.

## 6. UX

New workbench app **Timesheets** (left rail):

1. **My Timesheet** — week grid, day columns. Per day: lines auto-populated live from time
   reports (project → issue, clickable), inline hour/note editing, **Suggested** section =
   issues with activity by me today (Tx log: comments, status changes) minus issues I logged
   time on → one-click add. Indicators: day total vs 8h vs punch total. **Submit day**.
   Rejected days show the reason and return to editable Draft.
2. **Approvals** (visible to team leads/managers) — queue of submitted days across their
   staff (via `hr.Department` membership), expandable lines, Approve / Reject-with-comment,
   approve-whole-week shortcut. Next-morning review flow.
3. **Reports** — hours by project / member / period, CSV export. Replaces the manual
   Jonard-hours reporting for all projects (the MCP-based reports keep working meanwhile).
4. **Punch widget** — persistent header control: In/Out toggle, running today-total,
   optional note; multiple sessions/day. **Attendance report** (per department, date range)
   for HR under the Timesheets app.

## 7. Permissions

- Employee: own timesheet + own punches.
- Team lead/manager (from `Department.teamLead`/`managers`): approve + view staff sheets.
- HR/admin role: view all sheets + attendance reports.
- PMs: per-project hour reports only (no approval rights).
- Setup prerequisite: all ~34 staff assigned to Huly HR departments with leads; configurable
  fallback approver for gaps.

## 8. Rollout

| Phase | What | Exit criteria |
|---|---|---|
| **0. Spike** | CI trio + one-class model applied to a prod-data copy | upgrade clean, app boots, class queryable |
| **1. Timesheets** | Full module; pilot with one team; HR-portal timesheets continue in parallel | pilot team's Huly sheets ≈ HR sheets for a full cycle (validated with the Jonard reconciliation logic) |
| **2. Punch** | Punch widget + attendance report; brief dual-punching window | totals match OrangeHRM attendance for the window |
| **3. Retire** | All staff on Huly timesheets+punch; OrangeHRM timesheet/attendance modules go read-only archive; duplicated HR projects/activities frozen | HR sign-off |

Out of scope (explicitly): migrating historical HR data; moving employee master data or
leave management out of OrangeHRM (Huly's hr module could absorb leave later — separate
project); OrangeHRM 5.x upgrade.

## 9. Risks & guards

| Risk | Guard |
|---|---|
| Upgrade tax: 3 images + our model migrations per Huly version | new-files-only rule; minimal schema; spike proves the pipeline; upgrade runbook note |
| Model migration breaks workspace upgrade | spike on prod-data copy; migrations kept additive |
| Approved data mutates later | snapshot-on-approve + drift flag (no locks) |
| Employee without department/lead | fallback approver + setup checklist |
| Trigger bugs corrupt states | server trigger validates transitions; states are recoverable (reject→draft) |
| Pilot mismatch Huly vs HR | Jonard reconciliation logic as independent oracle during parallel run |

## 10. Open items (not blockers)

- Rotate the plaintext credentials in Jonard-hours (security hygiene, independent).
- Decide the internal project naming for non-project time ("YG Internal"?).
- Notification preferences for submit/approve events (Huly inbox integration) — Phase 1 nice-to-have.
