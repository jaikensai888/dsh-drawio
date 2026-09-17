import type { IncomingHttpHeaders } from 'node:http'
import { describe, expect, it } from 'vitest'
import { isLoopbackHostname, isTrustedApiRequest } from '../src/net/trust-fence.js'

function request(headers: IncomingHttpHeaders): { headers: IncomingHttpHeaders } {
  return { headers }
}

describe('isLoopbackHostname', () => {
  it('accepts the loopback spellings', () => {
    for (const host of ['localhost', '[::1]', '127.0.0.1', '127.1.2.3']) {
      expect(isLoopbackHostname(host)).toBe(true)
    }
  })

  it('refuses everything else', () => {
    for (const host of ['evil.example', '128.0.0.1', '127.0.0.256', '127.0.0', 'localhost.evil.example']) {
      expect(isLoopbackHostname(host)).toBe(false)
    }
  })
})

describe('isTrustedApiRequest', () => {
  it('accepts a loopback Host with no Origin (an iframe navigation)', () => {
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:43120' }), [])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'localhost:43120' }), [])).toBe(true)
  })

  it('accepts a same-hostname Origin (port is not re-decided)', () => {
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120' }), [])).toBe(true)
  })

  it('refuses a rebound Host name', () => {
    expect(isTrustedApiRequest(request({ host: 'evil.example' }), [])).toBe(false)
  })

  it('refuses cross-site browser markers', () => {
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:43120', 'sec-fetch-site': 'cross-site' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:43120', origin: 'http://evil.example' }), [])).toBe(false)
  })

  it('refuses the literal null origin (opaque, i.e. sandboxed frames)', () => {
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:43120', origin: 'null' }), [])).toBe(false)
  })

  it('refuses a missing or unparsable Host', () => {
    expect(isTrustedApiRequest(request({}), [])).toBe(false)
    expect(isTrustedApiRequest(request({ host: 'has space' }), [])).toBe(false)
  })

  it('honours declared trusted authorities, with and without a port', () => {
    expect(isTrustedApiRequest(request({ host: 'harness.internal:43120' }), ['harness.internal'])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'harness.internal:43120' }), ['harness.internal:43120'])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'harness.internal:9999' }), ['harness.internal:43120'])).toBe(false)
    expect(isTrustedApiRequest(request({ host: 'other.internal' }), ['harness.internal'])).toBe(false)
  })
})
