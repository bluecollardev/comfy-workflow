import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as podpull from '../src/podpull.js'

// The aws CLI retried over a flaky connection (v1.5.4): fakes only, the wait between tries is recorded, never slept.
const URL_LINE = 'Could not connect to the endpoint URL: "https://s3api-eu-ro-1.runpod.io/a3upg9ey48?list-type=2&prefix=comfy-shared%2F.journal%2F"'
let waits: number[]
beforeEach(() => { waits = []; podpull.setAwsRetrySleep(async (ms) => { waits.push(ms) }) })
afterEach(() => { podpull.setAwsRetrySleep(async () => {}) })
const seq = (...rs: { code: number; stdout?: string; stderr?: string }[]) => {
  let n = 0; const calls: string[][] = []
  const inner: podpull.AwsRunner = async (a) => { calls.push(a); const r = rs[Math.min(n++, rs.length - 1)]; return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' } }
  return { run: podpull.withAwsRetry(inner), calls }
}
const ok = { code: 0, stdout: 'fine' }, conn = { code: 255, stderr: URL_LINE }, reset = { code: 255, stderr: 'Connection was closed before we received a valid response' }

describe('withAwsRetry', () => {
  it('a connect failure then success: retried after 0.4 s, the caller sees the success', async () => {
    const s = seq(conn, ok); const r = await s.run(['s3', 'ls', 's3://v/x'], {})
    expect(r.code).toBe(0); expect(s.calls.length).toBe(2); expect(waits).toEqual([400])
  })
  it('three connect failures: 3 tries (0.4 s, 1.2 s), friendly text with no URL, the first line kept in detail', async () => {
    const s = seq(conn); const r = await s.run(['s3', 'ls', 's3://v/x'], {})
    expect(s.calls.length).toBe(3); expect(waits).toEqual([400, 1200]); expect(r.transient).toBe(true)
    expect(r.stderr).toBe(podpull.STORAGE_UNREACHABLE); expect(r.stderr).not.toMatch(/https?:|a3upg9ey48/); expect(r.detail).toContain('a3upg9ey48')
    const e = podpull.s3Error(r); expect(e.message).toBe(podpull.STORAGE_UNREACHABLE); expect(podpull.isStorageUnreachable(e)).toBe(true); expect(e.message.match(/RunPod's S3 API/g)).toBeNull()
  })
  it('a connect failure retries ANY command, writes included (no request was sent)', async () => {
    for (const args of [['s3', 'rm', 's3://v/x', '--recursive'], ['s3', 'sync', '.', 's3://v/x', '--delete'], ['s3', 'cp', 'a', 's3://v/a']]) {
      const s = seq(conn, ok); expect((await s.run(args, {})).code).toBe(0); expect(s.calls.length).toBe(2)
    }
  })
  it('a connection that broke mid-request is retried for reads only: ls, list-, head-, and a download', async () => {
    for (const args of [['s3', 'ls', 's3://v/x'], ['s3api', 'list-objects-v2', '--bucket', 'v'], ['s3api', 'head-object', '--bucket', 'v'], ['s3', 'cp', 's3://v/a', 'a']]) {
      const s = seq(reset, ok); expect((await s.run(args, {})).code).toBe(0); expect(s.calls.length).toBe(2)
    }
  })
  it('a mid-request break is NOT retried for rm, sync --delete or an upload: exactly one try, the original error', async () => {
    for (const args of [['s3', 'rm', 's3://v/x'], ['s3', 'sync', '.', 's3://v/x', '--delete'], ['s3', 'cp', 'a', 's3://v/a']]) {
      const s = seq(reset, ok); const r = await s.run(args, {}); expect(s.calls.length).toBe(1); expect(r.code).toBe(255); expect(r.transient).toBeUndefined()
    }
  })
  it('other errors (access denied) are not retried and read as RunPod\'s S3 API once', async () => {
    const s = seq({ code: 255, stderr: 'An error occurred (AccessDenied)' }, ok); const r = await s.run(['s3', 'ls', 's3://v'], {})
    expect(s.calls.length).toBe(1); expect(podpull.s3Error(r).message).toBe("RunPod's S3 API: An error occurred (AccessDenied)")
  })
})
