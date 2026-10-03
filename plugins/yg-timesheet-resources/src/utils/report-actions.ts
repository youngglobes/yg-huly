//
// Reports Action column: find the approval item (TimesheetTask) a time-entry row belongs to.
// Matches employee + issue and an ABSOLUTE 24 h window from the task's day start (the same rule
// the Approved column already uses, see the comment in Reports.svelte).
//
import type { TaskStatus } from '@hcengineering/yg-timesheet'
import { withinDay } from './week'

export interface TaskRef {
  id: string
  employee: string
  issue: string
  start: number
  status: TaskStatus
}

export function indexTasks (tasks: TaskRef[]): Map<string, TaskRef[]> {
  const m = new Map<string, TaskRef[]>()
  for (const t of tasks) {
    const k = `${t.employee}|${t.issue}`
    const list = m.get(k)
    if (list === undefined) m.set(k, [t])
    else list.push(t)
  }
  return m
}

export function taskForRow (
  index: Map<string, TaskRef[]>,
  employee: string,
  issue: string,
  date: number
): TaskRef | undefined {
  return index.get(`${employee}|${issue}`)?.find((t) => withinDay(t.start, date))
}
