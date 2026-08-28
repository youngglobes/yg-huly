// Fetch helper for the AI Usage dashboard and its config page. Talks to the sidecar behind
// nginx's /_usage route, authenticated with the same platform token the rest of the app uses.

import { getMetadata } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'

// Same-origin by design: nginx routes /_usage to the sidecar, so nothing has to be threaded
// through the front service config or dev/prod/src/platform.ts. The override exists only for
// running the front dev server against a sidecar on another port.
export function usageBase (): string {
  try {
    const o = window.localStorage.getItem('YG_USAGE_URL')
    if (o != null && o !== '') return o.replace(/\/+$/, '')
  } catch { /* private mode or blocked storage: fall through to same origin */ }
  return `${window.location.origin}/_usage`
}

async function call (method: string, path: string, body?: unknown): Promise<any> {
  const token = getMetadata(presentation.metadata.Token) ?? ''
  const res = await fetch(`${usageBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (!res.ok) {
    const err = new Error(res.status === 401
      ? 'Not authorised. AI Usage needs a Maintainer or Owner role.'
      : `Usage service returned ${res.status}`)
    // The status travels as data, not prose to parse back out of the message. The 503 case
    // matters: it means the Huly account service is unreachable, NOT that the caller lacks
    // permission, and that distinction is engineered all the way down through the sidecar's
    // auth layer, so callers that need to branch on it should read `.status`, not the message.
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return await res.json()
}

export const usageGet = async (path: string): Promise<any> => await call('GET', path)
export const usagePost = async (path: string, body: unknown): Promise<any> => await call('POST', path, body)
export const usageDelete = async (path: string): Promise<any> => await call('DELETE', path)
