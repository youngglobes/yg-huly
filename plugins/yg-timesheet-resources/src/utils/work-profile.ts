import { type WorkProfileCategory } from '@hcengineering/yg-timesheet'

export const CATEGORY_ORDER: WorkProfileCategory[] = ['junior-dev', 'senior-dev', 'sales', 'salesforce', 'other']

export const TRACKED_CATEGORIES = new Set<WorkProfileCategory>(['junior-dev', 'senior-dev'])

export function isTracked (cat: WorkProfileCategory | undefined): boolean {
  return cat !== undefined && TRACKED_CATEGORIES.has(cat)
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
