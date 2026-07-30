//
// YoungGlobes: the only two attendance writes - punch in (create) and punch out (close). Shared by
// the My Attendance page and the reminder controller so both go through identical logic.
//
import core, { type Ref, type TxOperations } from '@hcengineering/core'
import { type Employee } from '@hcengineering/contact'
import ygTimesheet, { type AttendanceMode, type AttendanceSession } from '@hcengineering/yg-timesheet'
import { localMidnight } from './attendance'

export async function createPunchIn (
  client: TxOperations, employee: Ref<Employee>, mode: AttendanceMode, note?: string
): Promise<void> {
  const at = Date.now()
  const trimmed = (note ?? '').trim()
  await client.createDoc(ygTimesheet.class.AttendanceSession, core.space.Workspace, {
    employee,
    date: localMidnight(at),
    punchIn: at,
    mode,
    ...(trimmed !== '' ? { punchInNote: trimmed } : {})
  })
}

export async function closePunchOut (
  client: TxOperations, sessionId: Ref<AttendanceSession>, note?: string
): Promise<void> {
  const at = Date.now()
  const trimmed = (note ?? '').trim()
  await client.updateDoc(ygTimesheet.class.AttendanceSession, core.space.Workspace, sessionId, {
    punchOut: at,
    ...(trimmed !== '' ? { punchOutNote: trimmed } : {})
  })
}
