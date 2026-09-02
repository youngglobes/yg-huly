//
// YoungGlobes: yg-hr-resources merged ids (UI labels the model layer references).
//
import ygHr, { ygHrId } from '@hcengineering/yg-hr'
import contact, { contactId } from '@hcengineering/contact'
import { mergeIds } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'

export default mergeIds(ygHrId, ygHr, {})

// Local typed handle onto contact.component.CreateEmployee (Task 11's Add-employee reuse). That
// component id is declared only in models/contact/src/plugin.ts (a model-layer package this
// resources package cannot import) - mergeIds computes resource ids purely from `${pluginId}:
// ${category}:${key}`, so re-declaring the same key under the same contactId here resolves to the
// identical already-registered string ('contact:component:CreateEmployee') without needing that
// model import. See EmployeeDirectory.svelte's addEmployee() for the one call site.
//
// Explicit narrow type (rather than letting mergeIds's return type infer): the full merged
// namespace type pulls in other packages' private node_modules type paths that tsc's declaration
// emit can't portably name (TS2742) - only this one key is ever used here.
export const contactExt: { component: { CreateEmployee: AnyComponent } } = mergeIds(contactId, contact, {
  component: {
    CreateEmployee: '' as AnyComponent
  }
})
