// Pure aggregation for the AI Usage dashboard. No platform deps, so all the maths is testable
// in isolation from queries and rendering, the same way utils/dashboard.ts is.
//
// Ported from ~/dev/claude-usage-fleet/dashboard.template.html, which is the reference
// implementation: the portal render must match a build-dashboard.sh render of the same facts
// number for number.

export type TokenRow = [number, string, string, string, string, string, string, number, number, number, number, number]
export type ActivityRow = [number, string, string, string, string, string, number]
export type SessionRow = [string, string, string, string, string, string, number, number, number]

export const T = { hour: 0, acct: 1, dev: 2, project: 3, cwd: 4, surface: 5, model: 6, req: 7, in: 8, out: 9, cw: 10, cr: 11 } as const
export const A = { hour: 0, acct: 1, dev: 2, project: 3, cwd: 4, surface: 5, sec: 6 } as const
export const S = { id: 0, acct: 1, dev: 2, project: 3, cwd: 4, surface: 5, first: 6, last: 7, tok: 8 } as const

export interface UsageAccount { uuid: string, label: string, employee_name?: string | null, plan_cents: number }
export interface UsageDevice { id: number, label: string, os: string | null, last_seen: number | null }
export interface UsageReport {
  report_schema: number
  tz: string
  generated: number
  window: { from: number, to: number, days: number }
  accounts: UsageAccount[]
  devices: UsageDevice[]
  idle_sec: number
  stats: { dup_dropped_7d: number, stale_devices: string[] }
  tokens: TokenRow[]
  activity: ActivityRow[]
  sessions: SessionRow[]
}
export interface Filters { account: string, device: string, project: string, model: string, days: number }
export interface Agg { key: string, req: number, tok: number, wt: number }
export interface UsageWindow { start: number, last: number, tok: number, sec: number, models: Map<string, number>, sess: Set<string> }

// List price per 1M tokens: in, out, cache-write, cache-read. Order also drives the blue ramp,
// darkest being most expensive.
const PRICE: Record<string, [number, number, number, number]> = {
  'opus-5': [15, 75, 18.75, 1.5],
  'opus-4-8': [15, 75, 18.75, 1.5],
  'opus-4-7': [15, 75, 18.75, 1.5],
  'sonnet-5': [3, 15, 3.75, 0.3],
  'sonnet-4-6': [3, 15, 3.75, 0.3],
  'haiku-4-5': [1, 5, 1.25, 0.1],
  'fable-5': [1, 5, 1.25, 0.1]
}
const DEFAULT_PRICE: [number, number, number, number] = [3, 15, 3.75, 0.3]
export const TIER = ['opus-5', 'opus-4-8', 'opus-4-7', 'sonnet-5', 'sonnet-4-6', 'haiku-4-5', 'fable-5']
const MVAR = ['--m1', '--m2', '--m2', '--m3', '--m3', '--m4', '--m5']

export function weight (model: string, i: number, o: number, cw: number, cr: number): number {
  const p = PRICE[model] ?? DEFAULT_PRICE
  return (i * p[0] + o * p[1] + cw * p[2] + cr * p[3]) / 1e6
}

export function modelVar (model: string): string {
  const i = TIER.indexOf(model)
  return i < 0 ? '--m5' : MVAR[i]
}

// Presentation formatters, shared by every report component so the acceptance-task's
// number-for-number comparison against the reference can never see a rounding drift from one
// component quietly diverging from another. Byte-identical to the reference's own fmtM / fmtH
// / fmtPct / money.
export function fmtM (n: number): string {
  return (n / 1e6 >= 100 ? (n / 1e6).toFixed(0) : (n / 1e6).toFixed(1)) + 'M'
}

export function fmtH (s: number): string {
  return (s / 3600).toFixed(2)
}

export function fmtPct (p: number): string {
  return (p >= 9.95 ? p.toFixed(0) : p.toFixed(1)) + '%'
}

export function money (n: number): string {
  return '$' + (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2))
}

function maxHour (r: UsageReport): number {
  let mx = 0
  for (const row of r.tokens) if (row[T.hour] > mx) mx = row[T.hour]
  for (const row of r.activity) if (row[A.hour] > mx) mx = row[A.hour]
  return mx
}

export function filterReport (r: UsageReport, f: Filters): {
  tok: TokenRow[], act: ActivityRow[], sess: SessionRow[], baseW: number, cut: number
} {
  const cut = maxHour(r) + 3600 - f.days * 86400
  const inAcct = (a: string): boolean => f.account === '*' || a === f.account
  const inDev = (d: string): boolean => f.device === '*' || d === f.device

  const tok = r.tokens.filter((x) =>
    x[T.hour] >= cut && inAcct(x[T.acct]) && inDev(x[T.dev]) &&
    (f.project === '*' || x[T.project] === f.project) &&
    (f.model === '*' || x[T.model] === f.model))

  // Active time carries no model dimension in the logs. Under a model filter we keep only the
  // (hour, project) buckets where that model actually ran: an attribution, not a measurement.
  // The dashboard footnote says so, and that footnote must not be removed.
  const keep = f.model === '*' ? null : new Set(tok.map((x) => `${x[T.hour]}|${x[T.project]}`))

  const act = r.activity.filter((x) =>
    x[A.hour] >= cut && inAcct(x[A.acct]) && inDev(x[A.dev]) &&
    (f.project === '*' || x[A.project] === f.project) &&
    (keep == null || keep.has(`${x[A.hour]}|${x[A.project]}`)))

  const sess = r.sessions.filter((x) =>
    x[S.first] >= cut && inAcct(x[S.acct]) && inDev(x[S.dev]) &&
    (f.project === '*' || x[S.project] === f.project))

  // The denominator for share and cost is the selected ACCOUNT's whole period, never the
  // filtered subset. Renormalising inside a filter makes any single project look like it
  // consumed the entire plan fee, which is backwards for an invoice.
  let baseW = 0
  for (const x of r.tokens) {
    if (x[T.hour] >= cut && inAcct(x[T.acct])) baseW += weight(x[T.model], x[T.in], x[T.out], x[T.cw], x[T.cr])
  }

  return { tok, act, sess, baseW, cut }
}

export function rollup (rows: TokenRow[], keyFn: (r: TokenRow) => string): Map<string, Agg> {
  const m = new Map<string, Agg>()
  for (const r of rows) {
    const k = keyFn(r)
    let o = m.get(k)
    if (o === undefined) { o = { key: k, req: 0, tok: 0, wt: 0 }; m.set(k, o) }
    o.req += r[T.req]
    o.tok += r[T.in] + r[T.out] + r[T.cw] + r[T.cr]
    o.wt += weight(r[T.model], r[T.in], r[T.out], r[T.cw], r[T.cr])
  }
  return m
}

export function sumBy<R> (rows: R[], keyFn: (r: R) => string, valFn: (r: R) => number): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(keyFn(r), (m.get(keyFn(r)) ?? 0) + valFn(r))
  return m
}

const FIVE_HOURS = 18000

export function buildWindows (tok: TokenRow[], act: ActivityRow[], sess: SessionRow[]): UsageWindow[] {
  const hours = [...new Set(tok.map((r) => r[T.hour]))].sort((a, b) => a - b)
  const wins: UsageWindow[] = []
  let end = -Infinity
  for (const h of hours) {
    if (h >= end) { wins.push({ start: h, last: h, tok: 0, sec: 0, models: new Map(), sess: new Set() }); end = h + FIVE_HOURS }
    wins[wins.length - 1].last = h
  }
  const find = (h: number): UsageWindow | null => {
    for (let i = wins.length - 1; i >= 0; i--) if (h >= wins[i].start && h < wins[i].start + FIVE_HOURS) return wins[i]
    return null
  }
  for (const r of tok) {
    const w = find(r[T.hour])
    if (w == null) continue
    const t = r[T.in] + r[T.out] + r[T.cw] + r[T.cr]
    w.tok += t
    w.models.set(r[T.model], (w.models.get(r[T.model]) ?? 0) + t)
  }
  for (const r of act) { const w = find(r[A.hour]); if (w != null) w.sec += r[A.sec] }
  // A session counts in every window it was ALIVE for, not just the one it started in, or a
  // long session leaves later windows reading zero.
  for (const s of sess) {
    for (const w of wins) if (s[S.last] >= w.start && s[S.first] < w.start + FIVE_HOURS) w.sess.add(s[S.id])
  }
  return wins
}
