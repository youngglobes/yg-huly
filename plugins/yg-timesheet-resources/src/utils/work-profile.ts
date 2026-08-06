import { type WorkDesignation, type WorkDepartment } from '@hcengineering/yg-timesheet'

export const DESIGNATIONS: WorkDesignation[] = [
  'Software Engineer Trainee', 'Associate Software Engineer', 'Senior Software Engineer',
  'Team Leader', 'Project Manager', 'Software Test Engineer', 'Senior Software Tester',
  'Web Designer', 'Front End Developer', 'Senior Front End Developer',
  'SEO Analyst Trainee', 'SEO Analyst', 'Senior SEO Analyst',
  'Business Development Executive', 'Senior Business Development Executive',
  'Business Development Manager', 'Salesforce Developer', 'Senior Salesforce Developer',
  'Lead Generation Executive', 'CEO', 'CTO', 'COO', 'HR Executive', 'Intern'
]

export const DEPARTMENTS: WorkDepartment[] = ['Development', 'Testing', 'SEO', 'Sales', 'HR']

// Titles that appear in the Performance report (dev/tester roles). All others are excluded.
export const TRACKED_DESIGNATIONS = new Set<WorkDesignation>([
  'Software Engineer Trainee', 'Associate Software Engineer', 'Senior Software Engineer',
  'Team Leader', 'Software Test Engineer', 'Senior Software Tester', 'Web Designer',
  'Front End Developer', 'Senior Front End Developer', 'Salesforce Developer',
  'Senior Salesforce Developer'
])

export function isTracked (d: WorkDesignation | undefined): boolean {
  return d !== undefined && TRACKED_DESIGNATIONS.has(d)
}

export function minutesToHHMM (min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function hhmmToMinutes (hhmm: string): number | undefined {
  const mt = /^([0-9]{2}):([0-9]{2})$/.exec(hhmm)
  if (mt == null) return undefined
  const h = Number(mt[1])
  const m = Number(mt[2])
  if (h > 23 || m > 59) return undefined
  return h * 60 + m
}
