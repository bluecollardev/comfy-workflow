import { describe, expect, it } from 'vitest'
import { presign, signHeaders } from '../src/s3presign.js'

// AWS's documented example: "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)", GET /test.txt from examplebucket.
describe('s3presign', () => {
  it('reproduces the signature in AWS\'s documented SigV4 query example', () => {
    const url = presign({ host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z'), expires: 86400 })
    expect(url).toBe('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
  })
  it('encodes each path segment once and keeps the slashes', () => {
    const u = presign({ host: 'h.example', path: '/b/comfy-shared/output/a b/c(1).dpx', accessKey: 'k', secretKey: 's', region: 'r', now: new Date('2026-01-01T00:00:00Z') })
    expect(u).toContain('/b/comfy-shared/output/a%20b/c%281%29.dpx?')
  })
  it('refuses an expiry outside 1 to 604800 s', () => {
    expect(() => presign({ host: 'h', path: '/x', accessKey: 'k', secretKey: 's', region: 'r', expires: 0 })).toThrow()
    expect(() => presign({ host: 'h', path: '/x', accessKey: 'k', secretKey: 's', region: 'r', expires: 604801 })).toThrow()
  })
  // AWS's documented example: "Signature Calculations for the Authorization Header", GET Object with a Range header.
  it('reproduces the signature in AWS\'s documented SigV4 Authorization-header example (GET Object, Range)', () => {
    const r = signHeaders({ host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z'), range: 'bytes=0-9' })
    expect(r.url).toBe('https://examplebucket.s3.amazonaws.com/test.txt')
    expect(r.headers.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
    expect(r.headers.range).toBe('bytes=0-9')
  })
})
