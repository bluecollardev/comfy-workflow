import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as storage from '../src/storage.js'
import * as storageusage from '../src/storageusage.js'

// docs/ADR-066: a storage's size, listed in the background through the aws runner (fake here).
let dir = ''
const KEY = { access_key_id: 'WASABIKEY12345678', secret_access_key: 'wasabisecretwasabisecret1234' }
const until = async (f: () => boolean, n = 200) => { for (let i = 0; i < n && !f(); i++) await new Promise((r) => setTimeout(r, 5)) }
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'usage-')); process.env.STORAGE_ADAPTERS_FILE = join(dir, 'storage-adapters.json'); process.env.POD_MANAGER_CONFIG_DIR = dir; storageusage.reset() })
afterEach(() => { storage.setAws(null); storageusage.reset(); storageusage.setClock(null); delete process.env.STORAGE_ADAPTERS_FILE; rmSync(dir, { recursive: true, force: true }) })

describe('storage usage', () => {
  it('lists in the background, counts bytes and objects across chunks, prices Wasabi, and keeps the answer', async () => {
    await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'ap-southeast-1', prefix: 'lt', ...KEY, enabled: true })
    let calls = 0
    storage.setAws(async (_a, _e, o) => { calls++; o?.onData?.('2026-11-28 00:09:49     285020 .proxies/a.mp4\n2026-11-28 00:09:50   1000'); o?.onData?.('0 b/c.dpx\n'); return { code: 0, stdout: '', stderr: '' } as never })
    const first = storageusage.usage('wasabi')
    expect(first.state).toBe('listing')
    await until(() => storageusage.usage('wasabi').state === 'done')
    const u = storageusage.usage('wasabi')
    expect(u).toMatchObject({ state: 'done', bytes: 285020 + 10000, objects: 2, price_per_tb_month: 7.99 })
    expect(u.as_of).not.toBe(''); expect(calls).toBe(1)   // the second call used the kept answer
  })
  it('an empty bucket is zero, a refusal is failed with a redacted line, an unready storage fails at once', async () => {
    await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'us-east-1', ...KEY, enabled: true })
    storage.setAws(async () => ({ code: 1, stdout: '', stderr: '' }) as never)
    storageusage.usage('wasabi'); await until(() => storageusage.usage('wasabi').state !== 'listing')
    expect(storageusage.usage('wasabi')).toMatchObject({ state: 'done', bytes: 0, objects: 0 })
    storageusage.reset(); storage.setAws(async () => ({ code: 255, stdout: '', stderr: 'AccessDenied: no' }) as never)
    storageusage.usage('wasabi'); await until(() => storageusage.usage('wasabi').state !== 'listing')
    expect(storageusage.usage('wasabi')).toMatchObject({ state: 'failed' }); expect(storageusage.usage('wasabi').error).toMatch(/AccessDenied/)
    storageusage.reset(); await storage.save({ name: 'Mine', bucket: '', region: '' } as never).catch(() => undefined)
    expect(storageusage.usage('nope').state).toBe('failed')
  })
  it('after ten minutes the next call lists again', async () => {
    await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'us-east-1', ...KEY, enabled: true })
    let t = 1_000_000, calls = 0; storageusage.setClock(() => t)
    storage.setAws(async (_a, _e, o) => { calls++; o?.onData?.('2026-11-28 00:00:00      5 x\n'); return { code: 0, stdout: '', stderr: '' } as never })
    storageusage.usage('wasabi'); await until(() => storageusage.usage('wasabi').state === 'done'); expect(calls).toBe(1)
    t += storageusage.KEEP_MS + 1; expect(storageusage.usage('wasabi').state).toBe('listing')   // stale numbers stay while it lists again
    await until(() => storageusage.usage('wasabi').state === 'done'); expect(calls).toBe(2)
  })
})
