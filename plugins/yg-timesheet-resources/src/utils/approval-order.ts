//
// YoungGlobes: stable ordering for the Approvals page groups. Groups used to keep the order in
// which each employee FIRST appeared in the date-sorted queue, so approving someone's oldest task
// moved their whole group and the approver had to find them again. Name order does not change as
// tasks are approved. "Unknown" (unresolved employee) sinks to the end.
//
export function sortApprovalGroups<T extends { name: string, employee: string | undefined }> (groups: T[]): T[] {
  return [...groups].sort((a, b) => {
    if (a.employee === undefined) return b.employee === undefined ? 0 : 1
    if (b.employee === undefined) return -1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}
