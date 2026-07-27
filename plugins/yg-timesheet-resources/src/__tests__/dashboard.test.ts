import {
  greetingFor, isOpen, inProgressIssues, overdueIssues, dueSoonIssues,
  statusBuckets, hoursByProject, projectStats, computeKpis, todayStart, type DashIssue, type DashTime, type DashProject
} from '../utils/dashboard'

const D = (y: number, m: number, d: number, h = 9): number => new Date(y, m, d, h).getTime()
const iss = (o: Partial<DashIssue>): DashIssue => ({
  id: 'i1', identifier: 'A-1', title: 't', project: 'p1', cat: 'active', assignee: 'e1', priority: 3, dueDate: null, ...o
})

describe('greetingFor', () => {
  it('buckets the hour', () => {
    expect(greetingFor(6)).toBe('Good morning')
    expect(greetingFor(13)).toBe('Good afternoon')
    expect(greetingFor(20)).toBe('Good evening')
  })
})

describe('status helpers', () => {
  const issues = [iss({ cat: 'active' }), iss({ id: 'i2', cat: 'won' }), iss({ id: 'i3', cat: 'todo' }), iss({ id: 'i4', cat: 'lost' })]
  it('isOpen excludes won/lost', () => {
    expect(isOpen('active')).toBe(true); expect(isOpen('todo')).toBe(true)
    expect(isOpen('won')).toBe(false); expect(isOpen('lost')).toBe(false)
  })
  it('inProgressIssues returns only active', () => {
    expect(inProgressIssues(issues).map((i) => i.id)).toEqual(['i1'])
  })
  it('statusBuckets counts each category', () => {
    expect(statusBuckets(issues)).toEqual({ unstarted: 0, todo: 1, active: 1, won: 1, lost: 1 })
  })
})

describe('overdue / due-soon (boundary at local midnight)', () => {
  const now = D(2026, 6, 15, 14) // 15 Jul 2026, 14:00 local
  const issues = [
    iss({ id: 'past', dueDate: D(2026, 6, 14, 23), cat: 'active' }),   // yesterday -> overdue
    iss({ id: 'today', dueDate: D(2026, 6, 15, 8), cat: 'active' }),   // today -> NOT overdue, IS due-soon
    iss({ id: 'soon', dueDate: D(2026, 6, 18, 8), cat: 'todo' }),      // +3d -> due-soon
    iss({ id: 'far', dueDate: D(2026, 6, 30, 8), cat: 'active' }),     // +15d -> neither
    iss({ id: 'donepast', dueDate: D(2026, 6, 1, 8), cat: 'won' })     // past but done -> excluded
  ]
  it('overdue = dueDate before today-midnight and still open', () => {
    expect(overdueIssues(issues, now).map((i) => i.id)).toEqual(['past'])
  })
  it('due-soon = [today-midnight, +7d) and open (incl. today)', () => {
    expect(dueSoonIssues(issues, now, 7).map((i) => i.id).sort()).toEqual(['soon', 'today'])
  })
})

describe('hoursByProject', () => {
  const projects: DashProject[] = [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }]
  const times: DashTime[] = [
    { issue: 'i1', project: 'p1', employee: 'e1', date: D(2026, 6, 14), hours: 2 },
    { issue: 'i2', project: 'p1', employee: 'e2', date: D(2026, 6, 14), hours: 1.5 },
    { issue: 'i3', project: 'p2', employee: 'e1', date: D(2026, 6, 14), hours: 3 }
  ]
  it('sums hours per project, ordered by the projects list', () => {
    expect(hoursByProject(times, projects)).toEqual([
      { project: 'p1', name: 'Alpha', hours: 3.5 },
      { project: 'p2', name: 'Beta', hours: 3 }
    ])
  })
})

describe('projectStats', () => {
  const projects: DashProject[] = [{ id: 'p1', name: 'Alpha' }]
  const issues = [iss({ project: 'p1', cat: 'active' }), iss({ id: 'i2', project: 'p1', cat: 'won' }), iss({ id: 'i3', project: 'p1', cat: 'todo' })]
  const times: DashTime[] = [
    { issue: 'i1', project: 'p1', employee: 'e1', date: D(2026, 6, 14), hours: 2 },
    { issue: 'i3', project: 'p1', employee: 'e2', date: D(2026, 6, 14), hours: 1 }
  ]
  it('rolls up counts, hours and distinct members', () => {
    expect(projectStats(issues, times, projects)).toEqual([
      { project: 'p1', name: 'Alpha', open: 2, inProgress: 1, done: 1, hours: 3, members: 2 }
    ])
  })
})

describe('computeKpis', () => {
  const projects: DashProject[] = [{ id: 'p1', name: 'Alpha' }]
  const now = D(2026, 6, 15, 14)
  const issues = [iss({ cat: 'active' }), iss({ id: 'i2', cat: 'active' }), iss({ id: 'od', cat: 'todo', dueDate: D(2026, 6, 1) })]
  const times: DashTime[] = [{ issue: 'i1', project: 'p1', employee: 'e1', date: D(2026, 6, 14), hours: 4 }]
  it('counts in-progress, overdue, and sums given hours', () => {
    expect(computeKpis(issues, times, now)).toEqual({ inProgress: 2, hoursThisWeek: 4, overdue: 1 })
  })
})
