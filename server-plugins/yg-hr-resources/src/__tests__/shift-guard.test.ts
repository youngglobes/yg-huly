//
// Shift-aware attendance fix wave (2026-10-01): the shift fields and ShiftType docs are HR-only, and
// OnEmployeeJobSync never mirrors a write the guard rejects.
//
import core, { AccountRole, TxFactory, type Doc, type Ref, type Tx, type TxMixin, type TxUpdateDoc } from '@hcengineering/core'
import contact from '@hcengineering/contact'
import ygHr from '@hcengineering/yg-hr'
import ygTimesheet from '@hcengineering/yg-timesheet'
import { OnEmployeeHrGuard, OnEmployeeJobSync } from '../index'

const USER = 'user-uuid'
const HR = 'hr-uuid'
const person = 'person-1' as Ref<Doc>
const shift = 'shift-1' as Ref<Doc>

const userTx = new TxFactory('user-social' as any)
const sysTx = new TxFactory(core.account.System)

interface Mock { control: any, applied: Tx[] }

function makeControl (actor: string, log: Tx[], current: Record<string, any> | undefined): Mock {
  const applied: Tx[] = []
  const control: any = {
    ctx: {
      contextData: { account: { uuid: actor, role: AccountRole.User } },
      warn: () => {},
      error: () => {},
      info: () => {}
    },
    txFactory: sysTx,
    hierarchy: {
      hasMixin: (doc: any, m: string) => doc?.[m] !== undefined,
      as: (doc: any, m: string) => ({ ...doc, ...(doc?.[m] ?? {}) })
    },
    findAll: async (_ctx: any, _class: string, query: any) => {
      if (_class === core.class.TxCUD) return log.filter((t: any) => t.objectId === query.objectId)
      if (_class === core.class.Space) return [{ _id: ygTimesheet.space.HrData, members: [HR] }]
      if (_class === contact.class.Person) return current !== undefined ? [current] : []
      return []
    },
    apply: async (_ctx: any, txes: Tx[]) => { applied.push(...txes) }
  }
  return { control, applied }
}

function personLog (): Tx[] {
  const create = sysTx.createTxCreateDoc(contact.class.Person, contact.space.Contacts, { name: 'A' } as any, person as any)
  const job = sysTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygHr.mixin.EmployeeJob,
    { shiftType: 'old-shift', shiftStart: 540 } as any)
  return [create, job]
}

describe('EmployeeJob shift fields guard', () => {
  it('reverts a non-HR write of shiftType/shiftStart to the prior values', async () => {
    const forged = userTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygHr.mixin.EmployeeJob,
      { shiftType: 'forged', shiftStart: 0 } as any)
    const log = [...personLog(), forged]
    const { control, applied } = makeControl(USER, log, undefined)
    await OnEmployeeHrGuard([forged], control)
    expect(applied).toHaveLength(1)
    const revert = applied[0] as TxMixin<any, any>
    expect(revert.modifiedBy).toBe(core.account.System)
    expect(revert.mixin).toBe(ygHr.mixin.EmployeeJob)
    expect((revert.attributes as any).shiftType).toBe('old-shift')
    expect((revert.attributes as any).shiftStart).toBe(540)
  })

  it('replays the prior log in modifiedOn order, not storage order', async () => {
    const hrTx = new TxFactory('hr-social' as any)
    const at = (t: Tx, ms: number): Tx => { (t as any).modifiedOn = ms; return t }
    const create = at(sysTx.createTxCreateDoc(contact.class.Person, contact.space.Contacts, { name: 'A' } as any, person as any), 1)
    const first = at(hrTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygHr.mixin.EmployeeJob,
      { shiftType: 'first' } as any), 2)
    const latest = at(hrTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygHr.mixin.EmployeeJob,
      { shiftType: 'latest' } as any), 3)
    const forged = at(userTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygHr.mixin.EmployeeJob,
      { shiftType: 'forged' } as any), 4)
    // Storage order is random _id order on CockroachDB.
    const { control, applied } = makeControl(USER, [latest, forged, create, first], undefined)
    await OnEmployeeHrGuard([forged], control)
    expect((applied[0] as TxMixin<any, any>).attributes).toMatchObject({ shiftType: 'latest' })
  })

  it('does not let an earlier, already-reverted forgery by the same actor count as prior state', async () => {
    // Reverts are System txes that never reach the tx table, so forgery #1 is still in the log.
    const at = (t: Tx, ms: number): Tx => { (t as any).modifiedOn = ms; return t }
    const [create, job] = personLog()
    at(create, 1); at(job, 2)
    const forged1 = at(userTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygHr.mixin.EmployeeJob,
      { shiftType: 'forged-1' } as any), 3)
    const forged2 = at(userTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygHr.mixin.EmployeeJob,
      { shiftType: 'forged-2' } as any), 4)
    const { control, applied } = makeControl(USER, [create, job, forged1, forged2], undefined)
    await OnEmployeeHrGuard([forged2], control)
    expect((applied[0] as TxMixin<any, any>).attributes).toMatchObject({ shiftType: 'old-shift', shiftStart: 540 })
  })

  it('lets an HR member write the shift fields', async () => {
    const write = userTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygHr.mixin.EmployeeJob,
      { shiftType: 'new' } as any)
    const { control, applied } = makeControl(HR, [...personLog(), write], undefined)
    await OnEmployeeHrGuard([write], control)
    expect(applied).toHaveLength(0)
  })

  it('reverts a non-HR WorkProfile write by re-deriving the mirror from EmployeeJob', async () => {
    // The sync's mirror writes are System txes, which never reach the tx log, so the revert must
    // not replay the log: EmployeeJob (the source of truth) is re-mirrored instead.
    const current = {
      _id: person,
      _class: contact.class.Person,
      space: contact.space.Contacts,
      [ygHr.mixin.EmployeeJob]: { shiftType: 'old-shift', shiftStart: 540 },
      [ygTimesheet.mixin.WorkProfile]: { shiftType: 'forged', designation: 'HR Executive' }
    }
    const forged = userTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygTimesheet.mixin.WorkProfile,
      { shiftType: 'forged', designation: 'HR Executive' } as any)
    const { control, applied } = makeControl(USER, [forged], current)
    await OnEmployeeHrGuard([forged], control)
    expect(applied).toHaveLength(1)
    const revert = applied[0] as TxMixin<any, any>
    expect(revert.modifiedBy).toBe(core.account.System)
    expect(revert.mixin).toBe(ygTimesheet.mixin.WorkProfile)
    const attrs = revert.attributes as any
    expect(attrs.shiftType).toBe('old-shift')
    expect(attrs.shiftStart).toBe(540)
    expect(attrs.designation).toBeUndefined()
  })

  it('lets an HR member write WorkProfile', async () => {
    const write = userTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygTimesheet.mixin.WorkProfile,
      { shiftType: 'x' } as any)
    const { control, applied } = makeControl(HR, [write], { _id: person })
    await OnEmployeeHrGuard([write], control)
    expect(applied).toHaveLength(0)
  })
})

describe('ShiftType guard', () => {
  function shiftLog (): Tx[] {
    return [sysTx.createTxCreateDoc(ygTimesheet.class.ShiftType, core.space.Workspace,
      { name: 'UK', description: '', dayStartMin: 300 } as any, shift as any)]
  }

  it('reverts a non-HR update of dayStartMin', async () => {
    const forged = userTx.createTxUpdateDoc(ygTimesheet.class.ShiftType, core.space.Workspace, shift as any, { dayStartMin: 0 } as any)
    const { control, applied } = makeControl(USER, [...shiftLog(), forged], undefined)
    await OnEmployeeHrGuard([forged], control)
    const set = applied.find((t) => (t as TxUpdateDoc<any>).operations?.dayStartMin !== undefined) as TxUpdateDoc<any>
    expect(set).toBeDefined()
    expect(set.operations.dayStartMin).toBe(300)
    expect(set.modifiedBy).toBe(core.account.System)
  })

  it('removes a ShiftType created by a non-HR member', async () => {
    const created = userTx.createTxCreateDoc(ygTimesheet.class.ShiftType, core.space.Workspace,
      { name: 'X', description: '', dayStartMin: 0 } as any)
    const { control, applied } = makeControl(USER, [created], undefined)
    await OnEmployeeHrGuard([created], control)
    expect(applied).toHaveLength(1)
    expect(applied[0]._class).toBe(core.class.TxRemoveDoc)
  })

  it('recreates a ShiftType removed by a non-HR member', async () => {
    const removed = userTx.createTxRemoveDoc(ygTimesheet.class.ShiftType, core.space.Workspace, shift as any)
    const { control, applied } = makeControl(USER, [...shiftLog(), removed], undefined)
    await OnEmployeeHrGuard([removed], control)
    expect(applied).toHaveLength(1)
    expect(applied[0]._class).toBe(core.class.TxCreateDoc)
    expect((applied[0] as any).attributes.dayStartMin).toBe(300)
  })

  it('lets an HR member update a ShiftType', async () => {
    const write = userTx.createTxUpdateDoc(ygTimesheet.class.ShiftType, core.space.Workspace, shift as any, { dayStartMin: 360 } as any)
    const { control, applied } = makeControl(HR, [...shiftLog(), write], undefined)
    await OnEmployeeHrGuard([write], control)
    expect(applied).toHaveLength(0)
  })
})

describe('OnEmployeeJobSync ordering', () => {
  // Post-apply state the sync would see if it ran before the guard's revert: the forged value.
  const current: Record<string, any> = {
    _id: person,
    _class: contact.class.Person,
    space: contact.space.Contacts,
    [contact.mixin.Employee]: { active: true },
    [ygHr.mixin.EmployeeJob]: { shiftType: 'forged' },
    [ygTimesheet.mixin.WorkProfile]: { shiftType: 'old-shift' }
  }

  it('does not mirror a non-HR EmployeeJob write into WorkProfile', async () => {
    const forged = userTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygHr.mixin.EmployeeJob,
      { shiftType: 'forged' } as any)
    const { control, applied } = makeControl(USER, [], current)
    await OnEmployeeJobSync([forged], control)
    expect(applied).toHaveLength(0)
  })

  it('mirrors an HR EmployeeJob write into WorkProfile', async () => {
    const write = userTx.createTxMixin(person as any, contact.class.Person, contact.space.Contacts, ygHr.mixin.EmployeeJob,
      { shiftType: 'forged' } as any)
    const { control, applied } = makeControl(HR, [], current)
    await OnEmployeeJobSync([write], control)
    expect(applied).toHaveLength(1)
    const tx = applied[0] as TxMixin<any, any>
    expect(tx.mixin).toBe(ygTimesheet.mixin.WorkProfile)
    expect((tx.attributes as any).shiftType).toBe('forged')
  })
})
