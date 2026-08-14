//
// YoungGlobes: best-effort punch-in context capture. readDeviceFields is synchronous (goes into the
// punch createDoc so device/browser are recorded instantly). capturePunchContext is fired
// detached after the punch is saved - it gathers IP + GPS with short timeouts and patches the
// session. It NEVER throws and never blocks the punch.
//
import core, { type Ref, type TxOperations } from '@hcengineering/core'
import ygTimesheet, { type AttendanceSession } from '@hcengineering/yg-timesheet'
import { parseUserAgent } from './user-agent'

export function readDeviceFields (): { device?: string, browser?: string, userAgent?: string } {
  if (typeof navigator === 'undefined' || navigator.userAgent == null || navigator.userAgent === '') return {}
  const ua = navigator.userAgent
  const { device, browser } = parseUserAgent(ua)
  return { device, browser, userAgent: ua }
}

async function fetchGeoIp (signal: AbortSignal): Promise<{ ip?: string, ipCity?: string }> {
  try {
    const res = await fetch('https://ipwho.is/', { signal })
    if (!res.ok) return {}
    const j = (await res.json()) as { ip?: string, city?: string, region?: string, country?: string, success?: boolean }
    if (j.success === false) return {}
    const parts = [j.city, j.region, j.country].filter((x) => x != null && x !== '')
    return { ip: j.ip, ipCity: parts.length > 0 ? parts.join(', ') : undefined }
  } catch {
    return {}
  }
}

async function getGeo (): Promise<{ geoLat?: number, geoLng?: number, geoAccuracy?: number }> {
  if (typeof window === 'undefined' || !window.isSecureContext) return {}
  if (typeof navigator === 'undefined' || navigator.geolocation === undefined) return {}
  return await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ geoLat: pos.coords.latitude, geoLng: pos.coords.longitude, geoAccuracy: pos.coords.accuracy }),
      () => resolve({}),
      { timeout: 5000, maximumAge: 60000, enableHighAccuracy: false }
    )
  })
}

export async function capturePunchContext (client: TxOperations, sessionId: Ref<AttendanceSession>): Promise<void> {
  try {
    const ctrl = new AbortController()
    // 8s so a slow ipwho.is still lands the IP + IP-city (this is detached/best-effort and never
    // blocks the punch). The GPS read has its own 5s getCurrentPosition timeout, independent of this.
    const t = setTimeout(() => ctrl.abort(), 8000)
    const [geoIp, geo] = await Promise.all([fetchGeoIp(ctrl.signal), getGeo()])
    clearTimeout(t)
    const merged: Record<string, unknown> = { ...geoIp, ...geo }
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(merged)) if (v !== undefined) clean[k] = v
    if (Object.keys(clean).length > 0) {
      await client.updateDoc(ygTimesheet.class.AttendanceSession, core.space.Workspace, sessionId, clean)
    }
  } catch {
    // best-effort: capture failures must never disrupt the punch
  }
}
