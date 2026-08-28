import {
  weight, modelVar, filterReport, rollup, sumBy, buildWindows,
  fmtM, fmtH, fmtPct, money,
  type UsageReport, type TokenRow, type ActivityRow, type SessionRow
} from '../utils/ai-usage'

const H = 1755000000 - (1755000000 % 3600)

function report (over: Partial<UsageReport> = {}): UsageReport {
  return {
    report_schema: 1,
    tz: '+0530',
    generated: H + 86400,
    window: { from: H - 14 * 86400, to: H + 3600, days: 14 },
    accounts: [{ uuid: 'a1', label: 'Karthi', plan_cents: 20000 }],
    devices: [{ id: 1, label: 'WSL', os: 'wsl', last_seen: H }],
    idle_sec: 300,
    stats: { dup_dropped_7d: 5, stale_devices: [], duplicate_devices: [] },
    // Both rows share the account (the whole point: one Claude account, several people), but
    // are assigned to different people via the trailing PERSON column, so account and person
    // filtering are genuinely distinct axes in these fixtures.
    tokens: [
      [H, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 'opus-5', 2, 1_000_000, 0, 0, 0, 'Karthikeyan'],
      [H, 'a1', 'WSL', 'Other', '~/o', 'vscode', 'sonnet-5', 1, 1_000_000, 0, 0, 0, 'Priya']
    ] as TokenRow[],
    activity: [
      [H, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 3600, 'Karthikeyan'],
      [H, 'a1', 'WSL', 'Other', '~/o', 'vscode', 1800, 'Priya']
    ] as ActivityRow[],
    sessions: [['s1', 'a1', 'WSL', 'Portal', '~/p', 'terminal', H, H + 600, 1000, 'Karthikeyan']] as SessionRow[],
    ...over
  }
}

const ALL = { account: '*', device: '*', project: '*', person: '*', model: '*', days: 14 }

describe('weighting', () => {
  it('prices a model at its list rate', () => {
    expect(weight('opus-5', 1_000_000, 0, 0, 0)).toBeCloseTo(15)
    expect(weight('sonnet-5', 1_000_000, 0, 0, 0)).toBeCloseTo(3)
    expect(weight('opus-5', 0, 1_000_000, 0, 0)).toBeCloseTo(75)
  })

  it('falls back to the mid tier for an unknown model rather than zero', () => {
    expect(weight('some-future-model', 1_000_000, 0, 0, 0)).toBeCloseTo(3)
    expect(modelVar('some-future-model')).toBe('--m5')
    expect(modelVar('opus-5')).toBe('--m1')
  })
})

describe('filtering', () => {
  it('with no filters returns every row', () => {
    const v = filterReport(report(), ALL)
    expect(v.tok).toHaveLength(2)
    expect(v.act).toHaveLength(2)
    expect(v.sess).toHaveLength(1)
  })

  it('filters by project, device and model', () => {
    expect(filterReport(report(), { ...ALL, project: 'Portal' }).tok).toHaveLength(1)
    expect(filterReport(report(), { ...ALL, model: 'sonnet-5' }).tok).toHaveLength(1)
    expect(filterReport(report(), { ...ALL, device: 'NOPE' }).tok).toHaveLength(0)
    expect(filterReport(report(), { ...ALL, account: 'nobody' }).tok).toHaveLength(0)
  })

  it('filters by person, exactly like project', () => {
    const v = filterReport(report(), { ...ALL, person: 'Karthikeyan' })
    expect(v.tok).toHaveLength(1)
    expect(v.tok[0][3]).toBe('Portal')
    expect(v.act).toHaveLength(1)
    expect(v.sess).toHaveLength(1)
    expect(filterReport(report(), { ...ALL, person: 'Nobody' }).tok).toHaveLength(0)
  })

  it('keeps the denominator at the whole period, so one project never looks like the whole plan', () => {
    const all = filterReport(report(), ALL)
    const one = filterReport(report(), { ...ALL, project: 'Portal' })
    expect(one.baseW).toBeCloseTo(all.baseW)
    const share = rollup(one.tok, (r) => r[3]).get('Portal')!.wt / one.baseW
    expect(share).toBeLessThan(1)
    expect(share).toBeCloseTo(15 / 18)
  })

  it('keeps the denominator at the whole ACCOUNT period under a person filter too, same invariant as project', () => {
    const all = filterReport(report(), ALL)
    const one = filterReport(report(), { ...ALL, person: 'Karthikeyan' })
    // Karthikeyan's own tokens are worth 15 (opus-5 on 1M in), but the shared account's whole
    // period is worth 18 (15 + 3 for Priya's sonnet-5 row). A person filter must not renormalise
    // the denominator down to just that person's slice, or their true share of the fee is wrong.
    expect(one.baseW).toBeCloseTo(all.baseW)
    expect(one.baseW).toBeCloseTo(18)
  })

  it('under a model filter keeps only the activity buckets that model ran in', () => {
    const v = filterReport(report(), { ...ALL, model: 'sonnet-5' })
    expect(v.act).toHaveLength(1)
    expect(v.act[0][3]).toBe('Other')
  })

  it('narrows the period relative to the newest row, not to wall clock', () => {
    const old: TokenRow = [H - 10 * 86400, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 'opus-5', 1, 1, 1, 1, 1, 'Karthikeyan']
    const r = report({ tokens: [...report().tokens, old] })
    expect(filterReport(r, { ...ALL, days: 14 }).tok).toHaveLength(3)
    expect(filterReport(r, { ...ALL, days: 7 }).tok).toHaveLength(2)
  })
})

describe('rollup', () => {
  it('sums requests, tokens and weight per key', () => {
    const m = rollup(report().tokens, (r) => r[3])
    expect(m.get('Portal')!.req).toBe(2)
    expect(m.get('Portal')!.tok).toBe(1_000_000)
    expect(m.get('Portal')!.wt).toBeCloseTo(15)
    expect(m.get('Other')!.wt).toBeCloseTo(3)
  })

  it('sumBy totals a single column', () => {
    const m = sumBy(report().activity, (r) => r[3], (r) => r[6])
    expect(m.get('Portal')).toBe(3600)
  })
})

describe('5-hour windows', () => {
  it('opens a new window only after five hours have elapsed', () => {
    const rows: TokenRow[] = [0, 3600, 7200, 18000].map((d) =>
      [H + d, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 'opus-5', 1, 10, 0, 0, 0, 'Karthikeyan'])
    const w = buildWindows(rows, [], [])
    expect(w).toHaveLength(2)
    expect(w[0].start).toBe(H)
    expect(w[1].start).toBe(H + 18000)
  })

  it('counts a session in every window it was alive for, not only the one it started in', () => {
    const rows: TokenRow[] = [0, 18000].map((d) =>
      [H + d, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 'opus-5', 1, 10, 0, 0, 0, 'Karthikeyan'])
    const sess: SessionRow[] = [['s1', 'a1', 'WSL', 'Portal', '~/p', 'terminal', H, H + 20000, 50, 'Karthikeyan']]
    const w = buildWindows(rows, [], sess)
    expect(w[0].sess.size).toBe(1)
    expect(w[1].sess.size).toBe(1)
  })

  it('accumulates active seconds and the per-model split inside a window', () => {
    const act: ActivityRow[] = [[H, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 1200, 'Karthikeyan']]
    const w = buildWindows(report().tokens, act, [])
    expect(w[0].sec).toBe(1200)
    expect(w[0].models.get('opus-5')).toBe(1_000_000)
    expect(w[0].models.get('sonnet-5')).toBe(1_000_000)
  })

  it('returns nothing for an empty period', () => {
    expect(buildWindows([], [], [])).toHaveLength(0)
  })
})

describe('formatters', () => {
  it('fmtPct rounds to a whole number at and above the 9.95 boundary, one decimal below it', () => {
    expect(fmtPct(9.95)).toBe('10%')
    expect(fmtPct(9.94)).toBe('9.9%')
  })

  it('money drops decimals at and above the 100 boundary, keeps two decimals below it', () => {
    expect(money(100)).toBe('$100')
    expect(money(99)).toBe('$99.00')
  })

  it('fmtM switches from one decimal to zero decimals at the 100M boundary', () => {
    expect(fmtM(100_000_000)).toBe('100M')
    expect(fmtM(5_000_000)).toBe('5.0M')
  })

  it('fmtH renders seconds as hours to two decimals', () => {
    expect(fmtH(3600)).toBe('1.00')
  })
})
