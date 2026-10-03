//
// YoungGlobes: never mix plain field sets and `$unset` in ONE update.
//
// The postgres/cockroach storage adapter (foundations/server/packages/postgres/src/storage.ts,
// txUpdateDoc) sends an update down its operator path only when EVERY key starts with `$`
// (core isOperator()). A mixed `{ status: 'Submitted', $unset: { approvedHours: '' } }` takes the
// plain path instead, which merges `data || {plain keys}` and silently drops the `$unset`: status
// changes, the "removed" fields stay in the row. The Mongo adapter has the same all-or-nothing
// contract. So a write that sets fields and removes others is sent as two updates: the plain set
// FIRST (it carries the status the server guard keys on), then a `$unset`-only update.
//
import type { Class, Doc, DocumentUpdate, Ref, Space, TxOperations } from '@hcengineering/core'

/** Splits an update into its plain part and a `$unset`-only part (either may be undefined). */
export function splitUnset<T extends Doc> (
  ops: DocumentUpdate<T>
): { set?: DocumentUpdate<T>, unset?: DocumentUpdate<T> } {
  const { $unset, ...rest } = ops as any
  const set = Object.keys(rest).length > 0 ? (rest as DocumentUpdate<T>) : undefined
  const unset =
    $unset !== undefined && Object.keys($unset).length > 0 ? ({ $unset } as unknown as DocumentUpdate<T>) : undefined
  return { set, unset }
}

/** client.updateDoc that applies a `$unset` mixed with plain fields correctly (two txes, set first). */
export async function updateDocWithUnset<T extends Doc> (
  client: TxOperations,
  _class: Ref<Class<T>>,
  space: Ref<Space>,
  objectId: Ref<T>,
  ops: DocumentUpdate<T>
): Promise<void> {
  const { set, unset } = splitUnset(ops)
  if (set !== undefined) await client.updateDoc(_class, space, objectId, set)
  if (unset !== undefined) await client.updateDoc(_class, space, objectId, unset)
}
