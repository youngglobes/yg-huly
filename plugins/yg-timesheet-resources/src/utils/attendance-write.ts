//
// YoungGlobes: the only two attendance writes - punch in (create) and punch out (close). Shared by
// the My Attendance page and the reminder controller so both go through identical logic.
//
import core, { type Ref, type TxOperations } from '@hcengineering/core'
import { getCurrentEmployee, type Employee } from '@hcengineering/contact'
import ygTimesheet, {
  type AttendanceMode,
  type AttendanceSession,
  type LatePermission
} from '@hcengineering/yg-timesheet'
import { localMidnight } from './attendance'
import { minutesLateOf } from './late'
import { capturePunchContext, readDeviceFields } from './capture'

export async function createPunchIn (
  client: TxOperations, employee: Ref<Employee>, mode: AttendanceMode, note?: string
): Promise<void> {
  // Authoritative single-open-session guard: if a session is already open for this employee, do
  // nothing. Prevents a double punch-in (e.g. a rapid second click before the live query reflected
  // the first) from opening two concurrent sessions - the bug that produced an Office + WFH pair.
  const open = await client.findAll(
    ygTimesheet.class.AttendanceSession,
    { employee, punchOut: { $exists: false } },
    { limit: 1 }
  )
  if (open.length > 0) return
  const at = Date.now()
  const trimmed = (note ?? '').trim()
  const id = await client.createDoc(ygTimesheet.class.AttendanceSession, core.space.Workspace, {
    employee,
    date: localMidnight(at),
    punchIn: at,
    mode,
    ...readDeviceFields(),
    ...(trimmed !== '' ? { punchInNote: trimmed } : {})
  })
  void capturePunchContext(client, id)
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

export async function createLatePermission (
  client: TxOperations, employee: Ref<Employee>, punchInMs: number, shiftStartMin: number, reason: string
): Promise<void> {
  const date = localMidnight(punchInMs)
  // Idempotency: at most one per (employee, day). First-of-day is also enforced by the caller, but
  // guard here too so a retry cannot create a duplicate.
  const existing = await client.findAll(
    ygTimesheet.class.LatePermission, { employee, date }, { limit: 1 }
  )
  if (existing.length > 0) return
  await client.createDoc(ygTimesheet.class.LatePermission, core.space.Workspace, {
    employee,
    date,
    punchIn: punchInMs,
    shiftStartSnapshot: shiftStartMin,
    minutesLate: minutesLateOf(punchInMs, shiftStartMin),
    reason: reason.trim(),
    status: 'Pending'
  })
}

export async function approveLatePermission (
  client: TxOperations, id: Ref<LatePermission>, reason: string
): Promise<void> {
  await client.updateDoc(ygTimesheet.class.LatePermission, core.space.Workspace, id, {
    status: 'Approved',
    approvedBy: getCurrentEmployee(),
    approvedOn: Date.now(),
    approveReason: reason.trim(),
    $unset: { rejectReason: '' }
  })
}

export async function rejectLatePermission (
  client: TxOperations, id: Ref<LatePermission>, reason: string
): Promise<void> {
  await client.updateDoc(ygTimesheet.class.LatePermission, core.space.Workspace, id, {
    status: 'Rejected',
    rejectReason: reason.trim(),
    $unset: { approvedBy: '', approvedOn: '', approveReason: '' }
  })
}
