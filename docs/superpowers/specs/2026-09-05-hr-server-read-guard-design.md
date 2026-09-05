# HR profile server-side read guard (Part 2) - transactor middleware

- **Date:** 2026-09-05
- **Status:** Approved design, ready for implementation
- **Owner:** YG platform (yg-huly fork), branch `yg_beta`
- **Severity:** access-control / confidentiality
- **Follows:** `2026-09-04-app-route-access-gate-design.md` (Part 1, the UI route 403). This is its Part 2.

## 1. Problem

The HR profile data lives as three mixins on the PUBLIC `contact.class.Person` / `contact.mixin.Employee`
doc (`ygHr.mixin.EmployeePersonal`, `EmployeeContact`, `EmployeeJob`) plus six child `AttachedDoc`
collections (`EmergencyContact`, `WorkExperience`, `Education`, `EmployeeSkill`, `EmployeeLanguage`,
`EmployeeLicense`), all in the world-readable `contact.space.Contacts` space. Part 1 route-gates the HR
module UI, but the data is still readable by any workspace member through the API (a raw `findAll` on
`contact.mixin.Employee`, a direct query on a mixin class, or a `$lookup` that pulls a Person). Huly's read
security is space-granular only (`SpaceSecurityMiddleware`); it cannot express "readable by HR OR self", and
the sensitive data deliberately shares a doc with world-readable directory fields, so it cannot be relocated
to a private space. Route-gating the UI is a viewing convenience, not a security boundary, until this ships.

## 2. Rule

A reader may see an employee's HR profile data (the three mixins + the six child docs) iff ANY of:

1. **Admin break-glass:** `hasAccountRole(account, AccountRole.Maintainer)` (Owner/Maintainer/Admin), OR
2. **HR:** `account.uuid` is in `ygTimesheet.space.HrData.members`, OR
3. **Self:** the record is the reader's own (for a Person/mixin doc, `String(doc.personUuid) === String(account.uuid)`; for a child doc, its `attachedTo` Person is the reader's own).

Only `system` is exempt from the filter (it runs triggers/migrations). This mirrors the write-guard's
`isHrAuthorized` exactly. NOTE: `DocGuest` is deliberately NOT exempt - the HR data sits in the PUBLIC
`contact.space.Contacts` space, so space security does not shield it from a guest either; a guest is the
least-trusted reader and must be filtered like any other non-HR account (fail-closed).

## 3. Investigation findings (both settle the design)

- **Wholesale mixin stripping is safe.** No surface reachable by a regular (non-HR) user, outside the now
  route-gated yg-hr module, reads any of the three mixins or six child classes. The one exception is
  `SelfActivate.svelte` (globally mounted), which reads only the caller's OWN `EmployeePersonal.status` -
  covered by the self-exemption.
- **`designation`/`department`/`shiftStart` are read elsewhere via the mirrored `ygTimesheet.mixin.WorkProfile`,
  never `EmployeeJob` directly** (`OnEmployeeJobSync` keeps WorkProfile in sync). So stripping `EmployeeJob`
  wholesale breaks no timesheet/attendance/dashboard/pickers surface.
- **No fulltext index** touches these mixins/fields/classes, so `searchFulltext` is not a leak path and needs
  no change.

## 4. Design

### 4.1 New middleware

New file `server/server-pipeline/src/hrReadSecurity.ts`: `class HrReadSecurityMiddleware extends
BaseMiddleware implements Middleware`, with `static async create(ctx, context, next)`. Overrides `findAll`;
everything else inherits `BaseMiddleware` pass-through.

`findAll` logic:

1. `const account = ctx.contextData?.account`. If `account === undefined` (the space-security init path sets
   `ctx.contextData = undefined` before reading all Spaces) OR `isSystem(account)` OR
   `account.role === AccountRole.DocGuest` -> `return this.provideFindAll(...)` untouched. (Fast, and avoids
   crashing on the init read.)
2. Compute `authorized = hasAccountRole(account, AccountRole.Maintainer) || (await this.hrMembers(ctx)).has(account.uuid)`.
   If authorized -> `return this.provideFindAll(...)` untouched.
3. `const res = await this.provideFindAll(...)`. Then, for an unauthorized reader, post-filter `res`:
   - **Direct child-class query** (`_class` isDerived from one of the six child classes): resolve the
     reader's own Person id set (`await this.ownPersonIds(ctx, account)`), keep only docs whose `attachedTo`
     is in that set.
   - **Direct mixin-class query** (`_class` isDerived from one of the three yg-hr mixins): keep only docs
     that are the reader's own (`String((doc as any).personUuid) === String(account.uuid)`).
   - **Otherwise** (any query that can return Person docs - Person/Employee/Contact/Doc): for each returned
     doc that is a Person (`hierarchy.isDerived(doc._class, contact.class.Person)`) and NOT the reader's own,
     shallow-clone it and `delete` the three yg-hr mixin keys. (Clone so the shared model/DB object is never
     mutated - the discipline `SpaceSecurityMiddleware` follows.)
   - **`$lookup` targets** (always, for the unauthorized reader, regardless of branch): for every returned
     doc with a `$lookup`, walk each looked-up value. A Person that is not the reader's own gets the
     shallow-clone + delete-mixin-keys treatment (closes assignee/lookup leaks in Tracker, chat). An HR
     child doc (the six classes, which arrive as reverse-lookup ARRAYS, e.g. `lookup: { _id: { we:
     WorkExperience } }`) that is not the reader's own person's is DROPPED from the array entirely (every
     field of it is sensitive) - the reverse-lookup path is the standard way clients pull attached
     collections and must be covered, not just the top-level direct-child-class query.
   - Re-wrap with `toFindResult(filtered, res.total, res.lookupMap)` when the array changed.

   KNOWN MINOR LIMITATION (accepted): a direct query on a child/mixin class that supplies a `limit` but no
   own-scoping filter has the DB `limit` applied before the own-filter, so an own record could fall outside
   the fetched window (empty page). Fail-closed, and no real-user impact: the only UI that reads these child
   classes is the HR module, now route-gated to HR (who skip filtering); legit self-service always scopes by
   `attachedTo`/`_id`. Not worth adding query-rewrite risk to a security change.

Stripping a mixin = `delete clone[ygHr.mixin.EmployeePersonal]` etc. (mixin data is stored nested under the
mixin-id key; `hasMixin` is `typeof doc[key] === 'object'`, so deleting the key removes the mixin). The three
yg-hr mixin keys ONLY - never `contact.mixin.Employee` (name/avatar/active stay visible).

### 4.2 Caching (hot path: Person is queried constantly)

- **`hrMembers(ctx)`**: a `Set<AccountUuid>` cached on the instance, lazily initialized (mirroring
  `SpaceSecurityMiddleware.init`'s `wasInit` promise pattern) by reading
  `this.next?.findAll(ctx, core.class.Space, { _id: ygTimesheet.space.HrData }, { limit: 1 })` (goes
  downstream, unfiltered - `members` is a hoisted column returned on the space doc). Invalidated in `tx()`
  when a tx's `objectId` or `objectSpace` is `ygTimesheet.space.HrData` (membership change), then
  `provideTx`. If the space does not exist yet, an empty set (only admins authorized) - acceptable.
- **`ownPersonIds(ctx, account)`**: `Set<Ref<Person>>` cached per `account.uuid`, resolved by
  `this.next?.findAll(ctx, contact.class.Person, { personUuid: account.uuid })`. Used only on the child-class
  branch. If it resolves empty, do NOT cache (re-resolve next time) so a just-provisioned account is not
  pinned to "no own records".

Authorized readers and system pay only the two boolean checks; unauthorized readers pay a per-doc property
check and clone only for Person docs that actually carry a yg-hr mixin.

### 4.3 Registration

`server/server-pipeline/src/pipeline.ts`, in the `middlewares[]` array: insert
`HrReadSecurityMiddleware.create` IMMEDIATELY AFTER the `SpaceSecurityMiddleware.create` lambda (currently
line 152), before `SpacePermissionsMiddleware.create`. This places it downstream of space security (so it
post-processes already space-secured results) and upstream of `LiveQueryMiddleware`, so its stripped output
is what feeds live queries and broadcasts.

Add deps to `server/server-pipeline/package.json`: `@hcengineering/yg-hr` and `@hcengineering/yg-timesheet`
(for `ygHr.mixin.*` / `ygHr.class.*` and `ygTimesheet.space.HrData`). Only the transactor image
(`@hcengineering/pod-server`, `pods/server`) rebuilds; no front/client rebuild for the guard itself.

### 4.4 Out of scope

- `groupBy` / `searchFulltext`: no fulltext index and no groupBy on these fields, so pass-through is safe.
- Non-Person carriers of the mixins: the mixins extend `contact.mixin.Employee`, only ever applied to Persons.

## 5. Deploy

Transactor code + one model dep graph change. Do a full build + `upgrade-workspace yg` (safest for the pod
rebuild + dep wiring), beta first, redpanda-first start, restart transactor + nginx (per ops rules).

## 6. Testing (beta, as a real non-HR user - Mukesh)

1. **API leak closed:** as Mukesh, a raw `findAll(contact.mixin.Employee, {})` (or on a mixin class, or a
   child class) must NOT return another employee's mixin data / child docs. Verify via the browser console
   `getClient().findAll(...)` while logged in as Mukesh.
2. **Self preserved:** as Mukesh, his OWN Employee doc still carries his mixin data, and `SelfActivate` still
   works (first-login pending->active).
3. **HR/admin unaffected:** admin@local and an HrData member still read everyone's mixins + child docs.
4. **Directory basics intact:** name, avatar, work email (SocialIdentity - a separate doc, never touched),
   and cross-app person rendering (Tracker assignees, chat) still work for everyone.
5. **Regression:** non-Person queries and other apps behave exactly as before (the fast-exit path).
