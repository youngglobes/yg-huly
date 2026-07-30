import {
  greetingFor, isOpen, inProgressIssues, overdueIssues, dueSoonIssues,
  statusBuckets, hoursByProject, projectStats, portfolioHours, teamWorkload, priorityWatch, computeKpis, todayStart,
  type DashIssue, type DashTime, type DashProject
} from '../utils/dashboard'

const D = (y: number, m: number, d: number, h = 9): number => new Date(y, m, d, h).getTime()
const iss = (o: Partial<DashIssue>): DashIssue => ({
  id: 'i1', identifier: 'A-1', title: 't', project: 'p1', cat: 'active', assignee: 'e1', priority: 3, dueDate: null,
  estimation: 0, reportedTime: 0, ...o
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
  const issues = [
    iss({ project: 'p1', cat: 'active', estimation: 4, reportedTime: 2 }),
    iss({ id: 'i2', project: 'p1', cat: 'won', estimation: 3, reportedTime: 5 }),
    iss({ id: 'i3', project: 'p1', cat: 'todo', estimation: 1, reportedTime: 0 })
  ]
  const times: DashTime[] = [
    { issue: 'i1', project: 'p1', employee: 'e1', date: D(2026, 6, 14), hours: 2 },
    { issue: 'i3', project: 'p1', employee: 'e2', date: D(2026, 6, 14), hours: 1 }
  ]
  it('rolls up counts, hours, members, estimated and spent', () => {
    expect(projectStats(issues, times, projects)).toEqual([
      { project: 'p1', name: 'Alpha', open: 2, inProgress: 1, done: 1, hours: 3, members: 2, estimated: 8, spent: 7 }
    ])
  })
})

describe('portfolioHours', () => {
  it('sums estimated and spent across projects', () => {
    const stats = [
      { project: 'p1', name: 'A', open: 0, inProgress: 0, done: 0, hours: 0, members: 0, estimated: 8, spent: 7 },
      { project: 'p2', name: 'B', open: 0, inProgress: 0, done: 0, hours: 0, members: 0, estimated: 4.5, spent: 2 }
    ]
    expect(portfolioHours(stats)).toEqual({ estimated: 12.5, spent: 9 })
  })
})

describe('teamWorkload', () => {
  const issues = [
    iss({ id: 'a', assignee: 'e1', cat: 'active' }),
    iss({ id: 'b', assignee: 'e1', cat: 'todo' }),
    iss({ id: 'c', assignee: 'e2', cat: 'won' }), // done -> not counted as open
    iss({ id: 'd', assignee: null, cat: 'active' }) // unassigned -> ignored
  ]
  const times: DashTime[] = [
    { issue: 'a', project: 'p1', employee: 'e1', date: D(2026, 6, 14), hours: 3 },
    { issue: 'c', project: 'p1', employee: 'e2', date: D(2026, 6, 14), hours: 1.5 },
    { issue: 'a', project: 'p1', employee: '', date: D(2026, 6, 14), hours: 9 } // empty employee ignored
  ]
  it('rolls up hours + open assigned per member, busiest first', () => {
    expect(teamWorkload(issues, times)).toEqual([
      { employee: 'e1', hours: 3, open: 2 },
      { employee: 'e2', hours: 1.5, open: 0 }
    ])
  })
})

describe('priorityWatch', () => {
  const issues = [
    iss({ id: 'u', priority: 1, cat: 'active', dueDate: D(2026, 6, 20) }),   // Urgent, open
    iss({ id: 'h', priority: 2, cat: 'todo', dueDate: D(2026, 6, 15) }),     // High, open, sooner due
    iss({ id: 'm', priority: 3, cat: 'active' }),                            // Medium -> excluded
    iss({ id: 'ud', priority: 1, cat: 'won' })                              // Urgent but done -> excluded
  ]
  it('keeps open Urgent/High only, urgent-first then soonest due', () => {
    expect(priorityWatch(issues).map((i) => i.id)).toEqual(['u', 'h'])
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
