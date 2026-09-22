import { parseUserAgent, isMobileDevice } from '../user-agent'

describe('parseUserAgent', () => {
  it('Chrome on Windows desktop', () => {
    const r = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36')
    expect(r.browser).toBe('Chrome 151')
    expect(r.device).toBe('Windows / Desktop')
  })
  it('Safari on iPhone', () => {
    const r = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
    expect(r.browser).toBe('Safari 17')
    expect(r.device).toBe('iOS / Mobile')
  })
  it('Chrome on Android mobile', () => {
    const r = parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36')
    expect(r.browser).toBe('Chrome 151')
    expect(r.device).toBe('Android / Mobile')
  })
  it('Edge on Windows', () => {
    const r = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0')
    expect(r.browser).toBe('Edge 151')
    expect(r.device).toBe('Windows / Desktop')
  })
  it('Firefox on macOS', () => {
    const r = parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0')
    expect(r.browser).toBe('Firefox 130')
    expect(r.device).toBe('macOS / Desktop')
  })
  it('unknown UA yields safe generic labels, never throws', () => {
    expect(parseUserAgent('')).toEqual({ device: 'Unknown', browser: 'Unknown' })
    expect(parseUserAgent('some-random-string')).toEqual({ device: 'Unknown', browser: 'Unknown' })
  })
})

describe('isMobileDevice', () => {
  const android = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  const ipad = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
  const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
  // Android Chrome "Desktop site" mode drops "Mobile" and "Android" but keeps X11; Linux: not
  // detectable by UA alone, so it is treated as a desktop. Documented limit.

  it('is true for phones and tablets', () => {
    expect(isMobileDevice(android)).toBe(true)
    expect(isMobileDevice(iphone)).toBe(true)
    expect(isMobileDevice(ipad)).toBe(true)
  })

  it('is false for laptops and desktops on every OS', () => {
    expect(isMobileDevice(windows)).toBe(false)
    expect(isMobileDevice(linux)).toBe(false)
    expect(isMobileDevice(mac)).toBe(false)
  })

  it('is false for an empty or missing user agent (never lock a real desktop out)', () => {
    expect(isMobileDevice('')).toBe(false)
    expect(isMobileDevice(undefined)).toBe(false)
  })
})
