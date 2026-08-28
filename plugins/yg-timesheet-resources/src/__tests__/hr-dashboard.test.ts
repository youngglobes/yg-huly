import {
  headcount, attendanceToday, modeSplit, notPunchedToday, orgHoursTotal,
  hoursByPerson, notLoggedThisWeek, submissionCompliance,
  type HrEmp, type HrAtt, type HrHours, type HrSub
} from '../utils/hr-dashboard'
import { dayMode } from '../utils/attendance'

const emps: HrEmp[] = [
  { id: 'e1', name: 'Alice A', active: true },
  { id: 'e2', name: 'Bob B', active: true },
  { id: 'e3', name: 'Cara C', active: true },
  { id: 'e4', name: 'Dan D', active: false } // inactive -> excluded from counts
]

describe('headcount', () => {
  it('counts active employees only', () => {
    expect(headcount(emps)).toBe(3)
  })
})

describe('dayMode', () => {
  it('office-only -> office, wfh-only -> wfh, any mix -> partial', () => {
    expect(dayMode(['office', 'office'])).toBe('office')
    expect(dayMode(['wfh'])).toBe('wfh')
    expect(dayMode(['office', 'wfh'])).toBe('partial')
    expect(dayMode(['wfh', 'office', 'wfh'])).toBe('partial')
  })
})

describe('attendanceToday / modeSplit / notPunchedToday', () => {
  // e1: office then wfh -> mixed day = partial, latest session still open; e2: one office session,
  // closed; e3: no session
  const att: HrAtt[] = [
    { employee: 'e1', mode: 'office', open: false, punchIn: 100 },
    { employee: 'e1', mode: 'wfh', open: true, punchIn: 200 },
    { employee: 'e2', mode: 'office', open: false, punchIn: 150 }
  ]
  it('attendanceToday: one row per employee; a mixed day is partial, open = latest session', () => {
    expect(attendanceToday(att, emps)).toEqual([
      { employee: 'e1', name: 'Alice A', mode: 'partial', open: true },
      { employee: 'e2', name: 'Bob B', mode: 'office', open: false }
    ])
  })
  it('modeSplit: office / wfh / partial (a switcher counts as partial, not office or wfh)', () => {
    expect(modeSplit(att, emps)).toEqual({ office: 1, wfh: 0, partial: 1 })
  })
  it('modeSplit: a wfh-only employee counts as wfh', () => {
    const wfhOnly: HrAtt[] = [{ employee: 'e2', mode: 'wfh', open: false, punchIn: 150 }]
    expect(modeSplit(wfhOnly, emps)).toEqual({ office: 0, wfh: 1, partial: 0 })
  })
  it('notPunchedToday: active employees with no session today', () => {
    expect(notPunchedToday(att, emps).map((e) => e.id)).toEqual(['e3'])
  })
})

describe('hours', () => {
  const hours: HrHours[] = [
    { employee: 'e1', hours: 3, date: 10 },
    { employee: 'e1', hours: 2, date: 20 },
    { employee: 'e2', hours: 4, date: 10 }
    // e3 logged nothing
  ]
  it('orgHoursTotal sums all', () => {
    expect(orgHoursTotal(hours)).toBe(9)
  })
  it('hoursByPerson: grouped, distinct days, lastActive, sorted desc', () => {
    expect(hoursByPerson(hours, emps)).toEqual([
      { employee: 'e1', name: 'Alice A', hours: 5, days: 2, lastActive: 20 },
      { employee: 'e2', name: 'Bob B', hours: 4, days: 1, lastActive: 10 }
    ])
  })
  it('notLoggedThisWeek: active employees with zero logged hours', () => {
    expect(notLoggedThisWeek(hours, emps).map((e) => e.id)).toEqual(['e3'])
  })
})

describe('submissionCompliance', () => {
  const subs: HrSub[] = [
    { employee: 'e1', submitted: true },
    { employee: 'e2', submitted: false }
  ]
  it('counts submitted vs expected(active headcount), lists submitted and missing', () => {
    const r = submissionCompliance(subs, emps)
    expect(r.submitted).toBe(1)
    expect(r.expected).toBe(3)
    expect(r.submittedList.map((e) => e.id)).toEqual(['e1'])
    expect(r.missing.map((e) => e.id).sort()).toEqual(['e2', 'e3']) // e2 not submitted, e3 no record
  })
})
