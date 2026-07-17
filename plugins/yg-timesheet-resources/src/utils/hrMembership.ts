//
// Copyright © 2026 YoungGlobes
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

// Owner self-add: ensure the current Owner is a member (and owner) of the private HR space
// (ygTimesheet.space.HrData) so their own client can read HrTimeEntry. Owners may modify a space
// they own even before membership (see OnHrDataMembershipGuard, server-plugins/yg-timesheet-resources).
//
// Previously this ran once from the (now-removed) HrApp.svelte TabList shell, which mounted
// unconditionally whenever the "Human Resource" app was opened, regardless of which tab was
// selected. Now that the app is a native navigatorModel with three independently-routed specials
// (Timesheets/Overview/Roster), each of those three sub-module components calls this on mount so
// a fresh Owner still gets self-added no matter which special they land on first.
import core, { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import ygTimesheet from '@hcengineering/yg-timesheet'

export async function ensureHrMembership (): Promise<void> {
  const acct = getCurrentAccount()
  if (!hasAccountRole(acct, AccountRole.Owner)) return

  const client = getClient()
  const space = await client.findOne(core.class.Space, { _id: ygTimesheet.space.HrData })
  if (space === undefined) return
  if (!space.members.includes(acct.uuid)) await client.update(space, { $push: { members: acct.uuid } })
  if (!(space.owners ?? []).includes(acct.uuid)) await client.update(space, { $push: { owners: acct.uuid } })
}
