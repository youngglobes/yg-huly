import {
  cycleKey,
  groupCycles,
  isOpen,
  openCycle,
  closedCycles,
  cyclesToClose,
  type RejectCycleLike
} from '../reject-cycle'

const DAY = new Date(2026, 7, 5).getTime()

function cyc (over: Partial<RejectCycleLike> = {}): RejectCycleLike {
  return {
    employee: 'emp-1',
    issue: 'YG-98',
    date: DAY,
    rejectReason: 'too high',
    rejectedOn: 1000,
    ...over
  }
}

test('cycleKey joins the triple and separates distinct units', () => {
  expect(cycleKey('emp-1', 'YG-98', DAY)).toBe(cycleKey('emp-1', 'YG-98', DAY))
  expect(cycleKey('emp-1', 'YG-98', DAY)).not.toBe(cycleKey('emp-2', 'YG-98', DAY))
  expect(cycleKey('emp-1', 'YG-98', DAY)).not.toBe(cycleKey('emp-1', 'YG-99', DAY))
  expect(cycleKey('emp-1', 'YG-98', DAY)).not.toBe(cycleKey('emp-1', 'YG-98', DAY + 86400000))
})

test('groupCycles buckets by the triple', () => {
  const g = groupCycles([cyc(), cyc({ issue: 'YG-99' }), cyc({ rejectedOn: 2000 })])
  expect(g.size).toBe(2)
  expect(g.get(cycleKey('emp-1', 'YG-98', DAY))).toHaveLength(2)
  expect(g.get(cycleKey('emp-1', 'YG-99', DAY))).toHaveLength(1)
})

test('groupCycles sorts each bucket into round order, oldest first', () => {
  const g = groupCycles([
    cyc({ rejectedOn: 3000, rejectReason: 'third' }),
    cyc({ rejectedOn: 1000, rejectReason: 'first' }),
    cyc({ rejectedOn: 2000, rejectReason: 'second' })
  ])
  const list = g.get(cycleKey('emp-1', 'YG-98', DAY)) ?? []
  expect(list.map((c) => c.rejectReason)).toEqual(['first', 'second', 'third'])
})

test('isOpen is true only while resubmittedOn is absent', () => {
  expect(isOpen(cyc())).toBe(true)
  expect(isOpen(cyc({ resubmittedOn: 5000 }))).toBe(false)
})

test('openCycle returns the one unresubmitted round', () => {
  const list = [cyc({ rejectedOn: 1000, resubmittedOn: 1500 }), cyc({ rejectedOn: 2000 })]
  expect(openCycle(list)?.rejectedOn).toBe(2000)
})

test('openCycle returns undefined when every round is closed', () => {
  expect(openCycle([cyc({ resubmittedOn: 1500 })])).toBeUndefined()
})

test('openCycle returns the latest when several are somehow open', () => {
  // Defensive: a partial-failure write could leave two open. Prefer the newest.
  const list = [cyc({ rejectedOn: 1000 }), cyc({ rejectedOn: 4000 })]
  expect(openCycle(list)?.rejectedOn).toBe(4000)
})

test('closedCycles returns only resubmitted rounds, in round order', () => {
  const list = [
    cyc({ rejectedOn: 1000, resubmittedOn: 1500, rejectReason: 'r1' }),
    cyc({ rejectedOn: 2000, resubmittedOn: 2500, rejectReason: 'r2' }),
    cyc({ rejectedOn: 3000, rejectReason: 'open' })
  ]
  expect(closedCycles(list).map((c) => c.rejectReason)).toEqual(['r1', 'r2'])
})

test('cyclesToClose picks open cycles whose issue is being resubmitted', () => {
  const cycles = [
    cyc({ issue: 'YG-98' }),
    cyc({ issue: 'YG-104' }),
    cyc({ issue: 'YG-200' })
  ]
  const picked = cyclesToClose(cycles, new Set(['YG-98', 'YG-104']))
  expect(picked.map((c) => c.issue).sort()).toEqual(['YG-104', 'YG-98'])
})

test('cyclesToClose skips already-closed cycles', () => {
  const cycles = [cyc({ issue: 'YG-98', resubmittedOn: 9000 }), cyc({ issue: 'YG-104' })]
  expect(cyclesToClose(cycles, new Set(['YG-98', 'YG-104'])).map((c) => c.issue)).toEqual(['YG-104'])
})

test('cyclesToClose skips issues the employee dropped from the day', () => {
  // Rejected, then removed from the day entirely: the cycle stays open on purpose.
  const cycles = [cyc({ issue: 'YG-98' })]
  expect(cyclesToClose(cycles, new Set(['YG-104']))).toEqual([])
})
