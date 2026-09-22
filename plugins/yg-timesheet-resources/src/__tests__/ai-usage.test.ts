import {
  weight, modelVar, filterReport, rollup, sumBy, buildWindows,
  fmtM, fmtH, fmtPct, money, periodKey, reportPath, sessionList, usedOf5h, modelRank,
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

describe('model family pricing', () => {
  it('prices a point release at its family rate (claude-fable-5-1 arrives as fable-5-1)', () => {
    // Fable: 1/5/1.25/0.1 per 1M. Without the family fallback this fell to the sonnet default.
    expect(weight('fable-5-1', 1_000_000, 0, 0, 0)).toBeCloseTo(1, 6)
    expect(weight('fable-5', 1_000_000, 0, 0, 0)).toBeCloseTo(1, 6)
    expect(weight('sonnet-5-1', 1_000_000, 0, 0, 0)).toBeCloseTo(3, 6)
  })

  it('prefers an exact match over the family fallback', () => {
    // opus-4-8 is its own entry; it must not be read as an "opus-4" family.
    expect(weight('opus-4-8', 1_000_000, 0, 0, 0)).toBeCloseTo(15, 6)
  })

  it('still falls back to the mid tier for a family it has never seen', () => {
    expect(weight('quasar-9-2', 1_000_000, 0, 0, 0)).toBeCloseTo(3, 6)
  })

  it('ranks a point release next to its family and an unknown model last', () => {
    const order = ['fable-5-1', 'opus-5', 'quasar-9', 'sonnet-5'].sort((a, b) => modelRank(a) - modelRank(b))
    expect(order).toEqual(['opus-5', 'sonnet-5', 'fable-5-1', 'quasar-9'])
  })

  it('colours a point release like its family, not like an unknown model', () => {
    expect(modelVar('fable-5-1')).toBe(modelVar('fable-5'))
    expect(modelVar('sonnet-5-1')).toBe(modelVar('sonnet-5'))
    expect(modelVar('quasar-9')).toBe('--m5')
  })
})

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

  it('under a custom range trusts the report window instead of the newest-row anchor', () => {
    // The sidecar already bounded the rows to the range; the client must not re-cut them by
    // maxHour - days (which would drop everything older than `days` in a 90-day custom range).
    const old: TokenRow = [H - 60 * 86400, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 'opus-5', 1, 1, 1, 1, 1, 'Karthikeyan']
    const r = report({ tokens: [...report().tokens, old], window: { from: H - 90 * 86400, to: H + 3600, days: 90, custom: true } })
    const f = { ...ALL, days: 14, range: { from: '2026-06-01', to: '2026-08-31' } }
    expect(filterReport(r, f).tok).toHaveLength(3)
    expect(filterReport(r, f).cut).toBe(H - 90 * 86400)
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

  it('counts the machines active in a window, so the 5h denominator can scale with them', () => {
    // Two machines each active 3h inside one window: 6h of active time is 60% of 2 x 5h, not 120%.
    const act: ActivityRow[] = [
      [H, 'a1', 'WSL', 'Portal', '~/p', 'terminal', 10800, 'Karthikeyan'],
      [H + 3600, 'a1', 'MAC', 'Other', '~/o', 'terminal', 10800, 'Priya']
    ]
    const w = buildWindows(report().tokens, act, [])
    expect(w[0].devs.size).toBe(2)
    expect(w[0].sec).toBe(21600)
    expect(usedOf5h(w[0])).toBeCloseTo(60, 5)
  })

  it('splits the window tokens by project exactly, from the hourly token facts', () => {
    const w = buildWindows(report().tokens, [], [])
    expect(w[0].projects.get('Portal')).toBe(1_000_000)
    expect(w[0].projects.get('Other')).toBe(1_000_000)
    expect([...w[0].projects.values()].reduce((a, b) => a + b, 0)).toBe(w[0].tok)
  })

  it('a window with tokens but no activity rows still reads as one machine', () => {
    const w = buildWindows(report().tokens, [], [])
    expect(usedOf5h(w[0])).toBe(0)
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


describe('period key and path', () => {
  it('a preset period is keyed and fetched by days', () => {
    expect(periodKey({ ...ALL, days: 7 })).toBe('days:7')
    expect(reportPath({ ...ALL, days: 7 })).toBe('/report?days=7')
  })

  it('a custom range is keyed and fetched by its dates', () => {
    const f = { ...ALL, days: 14, range: { from: '2026-06-01', to: '2026-08-31' } }
    expect(periodKey(f)).toBe('range:2026-06-01..2026-08-31')
    expect(reportPath(f)).toBe('/report?from=2026-06-01&to=2026-08-31')
  })

  it('an incomplete custom range falls back to the preset until both dates are set', () => {
    const f = { ...ALL, days: 14, range: { from: '2026-06-01', to: '' } }
    expect(periodKey(f)).toBe('days:14')
    expect(reportPath(f)).toBe('/report?days=14')
  })
})

describe('sessionList', () => {
  const rows: SessionRow[] = [
    ['s1', 'a1', 'WSL', 'Portal', '~/p', 'terminal', H, H + 600, 1000, 'Karthikeyan'],
    ['s2', 'a1', 'WSL', 'Other', '~/o', 'cowork', H + 7200, H + 7200 + 90, 500, 'Priya'],
    ['s3', 'a1', 'WSL', 'Portal', '~/p', 'vscode', H - 86400, H - 86400 + 30, 0, 'Karthikeyan']
  ]

  it('is newest first with a duration and the surface on each row', () => {
    const l = sessionList(rows)
    expect(l.map((x) => x.id)).toEqual(['s2', 's1', 's3'])
    expect(l[0]).toMatchObject({ surface: 'cowork', person: 'Priya', project: 'Other', sec: 90, tok: 500 })
    expect(l[1].sec).toBe(600)
  })

  it('never yields a negative duration', () => {
    const l = sessionList([['s4', 'a1', 'WSL', 'P', '~/p', 'terminal', H, H - 5, 1, 'X']])
    expect(l[0].sec).toBe(0)
  })
})
