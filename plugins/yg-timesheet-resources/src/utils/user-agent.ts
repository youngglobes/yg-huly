// Pure userAgent parser: enough to label a punch-in's device + browser for HR. Order matters
// (Edge/Opera masquerade as Chrome; Chrome carries "Safari"), so test the more specific tokens
// first. Never throws - unknown input yields "Unknown".

interface Parsed { device: string, browser: string }

function osLabel (ua: string): string {
  if (/Android/i.test(ua)) return 'Android / Mobile'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS / Mobile'
  if (/Windows NT/i.test(ua)) return 'Windows / Desktop'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS / Desktop'
  if (/Linux/i.test(ua)) return 'Linux / Desktop'
  return 'Unknown'
}

function browserLabel (ua: string): string {
  const m = (re: RegExp): string | undefined => {
    const g = re.exec(ua)
    return g?.[1]?.split('.')[0]
  }
  let v: string | undefined
  if ((v = m(/Edg\/(\d+)/)) !== undefined) return `Edge ${v}`
  if ((v = m(/OPR\/(\d+)/)) !== undefined) return `Opera ${v}`
  if ((v = m(/Firefox\/(\d+)/)) !== undefined) return `Firefox ${v}`
  if ((v = m(/Chrome\/(\d+)/)) !== undefined) return `Chrome ${v}`
  if (/Safari/.test(ua) && (v = m(/Version\/(\d+)/)) !== undefined) return `Safari ${v}`
  return 'Unknown'
}

export function parseUserAgent (ua: string): Parsed {
  if (ua == null || ua === '') return { device: 'Unknown', browser: 'Unknown' }
  return { device: osLabel(ua), browser: browserLabel(ua) }
}

// Phone or tablet, by user agent. Used to hide punch in/out on mobile (decided 2026-09-22: a
// stale phone tab re-closing a session is how the overlap incident happened, and punching is
// meant to be done at the desk). Same tokens osLabel uses for the "/ Mobile" device labels, so
// what HR sees on a punch and what gets hidden can never disagree. A missing UA is a desktop:
// hiding is the convenience, not the security boundary, so it must never lock a real laptop out.
export function isMobileDevice (ua: string | undefined): boolean {
  if (ua == null || ua === '') return false
  return /Android|iPhone|iPad|iPod/i.test(ua)
}
