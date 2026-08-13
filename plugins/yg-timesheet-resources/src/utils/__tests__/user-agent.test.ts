import { parseUserAgent } from '../user-agent'

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
