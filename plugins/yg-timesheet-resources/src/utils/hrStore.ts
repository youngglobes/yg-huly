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

// Shared HR store: lets the Overview sub-module (all-employees grid) hand off a selected
// employee to the Timesheets sub-module (per-employee grid) on click-through, since the two
// live in separate sub-module components with no direct prop path between them.
import { writable } from 'svelte/store'
import type { Ref } from '@hcengineering/core'
import type { Person } from '@hcengineering/contact'

export const hrSelectedEmployee = writable<Ref<Person> | undefined>(undefined)

// Alongside the employee, the week the user was viewing on Overview (a weekMs anchor), so the
// Timesheets sub-module opens on that same week instead of resetting to the current one. Both are
// consumed and cleared on arrival, so a later direct visit to Timesheets is unaffected.
export const hrSelectedWeek = writable<number | undefined>(undefined)
