import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as storage from '../src/storage.js'
import * as panama from '../src/panama.js'

// Storage adapters (docs/ADR-063): one S3-compatible storage per record; Wasabi built in; publishing mirrors to the enabled ones.
let dir = ''
const KEY = { access_key_id: 'WASABIKEY12345678', secret_access_key: 'wasabisecretwasabisecret1234' }
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'storage-')); process.env.STORAGE_ADAPTERS_FILE = join(dir, 'storage-adapters.json'); process.env.POD_MANAGER_CONFIG_DIR = dir })
afterEach(() => { storage.setAws(null); delete process.env.STORAGE_ADAPTERS_FILE; rmSync(dir, { recursive: true, force: true }) })

describe('storage adapters', () => {
  it('lists the three built-ins: the publish destination and Panama on, Wasabi off', async () => {
    const { adapters } = await storage.list()
    expect(adapters.map((a) => a.id).slice(0, 3)).toEqual(['publish-s3', 'panama-s3', 'wasabi'])
    expect(adapters.find((a) => a.id === 'publish-s3')!.enabled).toBe(true)
    expect(adapters.find((a) => a.id === 'panama-s3')!.enabled).toBe(true)
    const w = adapters.find((a) => a.id === 'wasabi')!
    expect(w.enabled).toBe(false); expect(w.endpoint).toBe('https://s3.wasabisys.com'); expect(w.ready).toBe(false)
  })
  it('Wasabi gets its endpoint from the region', () => {
    expect(storage.wasabiEndpoint('us-east-1')).toBe('https://s3.wasabisys.com')
    expect(storage.wasabiEndpoint('eu-central-1')).toBe('https://s3.eu-central-1.wasabisys.com')
  })
  it('a storage cannot be switched on until it has a bucket, a region and keys', async () => {
    await expect(storage.setEnabled('wasabi', true)).rejects.toThrow(/cannot be switched on: Add a bucket/)
    await storage.save({ id: 'wasabi', bucket: 'my-bucket', region: 'eu-central-1', prefix: 'bh', ...KEY, enabled: true })
    const w = (await storage.list()).adapters.find((a) => a.id === 'wasabi')!
    expect(w).toMatchObject({ enabled: true, ready: true, prefix: 'bh/', endpoint: 'https://s3.eu-central-1.wasabisys.com', key_hint: '…5678' })
    expect(JSON.stringify(w)).not.toContain(KEY.secret_access_key)
  })
  it('keys are stored 0600 and an empty key field keeps them', async () => {
    await storage.save({ id: 'wasabi', bucket: 'my-bucket', region: 'us-east-1', ...KEY })
    expect(statSync(process.env.STORAGE_ADAPTERS_FILE!).mode & 0o777).toBe(0o600)
    await storage.save({ id: 'wasabi', prefix: 'x', access_key_id: '', secret_access_key: '' })
    expect(JSON.parse(readFileSync(process.env.STORAGE_ADAPTERS_FILE!, 'utf8')).adapters[0].secret_access_key).toBe(KEY.secret_access_key)
  })
  it('adds your own S3-compatible storage with an id from its name, and deletes it', async () => {
    const r = await storage.save({ name: 'Backblaze B2', endpoint: 'https://s3.us-west-004.backblazeb2.com/', region: 'us-west-004', bucket: 'bh-b2', ...KEY })
    const b = r.adapters.find((a) => a.id === 'backblaze-b2')!
    expect(b).toMatchObject({ name: 'Backblaze B2', builtin: false, enabled: false, endpoint: 'https://s3.us-west-004.backblazeb2.com' })
    await storage.remove('backblaze-b2'); expect((await storage.list()).adapters.some((a) => a.id === 'backblaze-b2')).toBe(false)
    await expect(storage.remove('publish-s3')).rejects.toThrow(/built in/)
  })
  it('refuses bad values with the field named', async () => {
    await expect(storage.save({ name: 'X1', bucket: 'A_B' })).rejects.toThrow(/bucket is a bucket name/)
    await expect(storage.save({ name: 'X2', endpoint: 'http://insecure' })).rejects.toThrow(/https URL/)
    await expect(storage.save({ name: 'X3', prefix: '../up' })).rejects.toThrow(/\.\./)
    await expect(storage.save({ id: 'publish-s3', bucket: 'bb-bucket' })).rejects.toThrow(/edited where its values live/)
  })
  it('switching Panama off makes its commands refuse; on, they build', async () => {
    expect(panama.listCmd()[0]).toBe('aws')
    await storage.setEnabled('panama-s3', false)
    expect(() => panama.listCmd()).toThrow(/Panama S3 adapter is off/)
    await storage.setEnabled('panama-s3', true)
    expect(panama.listCmd()[0]).toBe('aws')
  })
  it('mirrors: only enabled, complete adapters, and a copy goes below the adapter directory with its own endpoint and keys', async () => {
    expect(storage.mirrors()).toEqual([])
    await storage.save({ id: 'wasabi', bucket: 'my-bucket', region: 'eu-central-1', prefix: 'bh', ...KEY, enabled: true })
    const m = storage.mirrors(); expect(m.map((x) => x.id)).toEqual(['wasabi'])
    const calls: { args: string[]; env: Record<string, string> }[] = []
    storage.setAws(async (args, env) => { calls.push({ args, env }); return { code: 0, stdout: '', stderr: '' } })
    expect(await storage.mirrorCopy(m[0], '/tmp/a.mov', 'returns/BKK/r1/a.mov')).toBe('')
    expect(calls[0].args).toEqual(['s3', 'cp', '/tmp/a.mov', 's3://my-bucket/bh/returns/BKK/r1/a.mov', '--region', 'eu-central-1', '--endpoint-url', 'https://s3.eu-central-1.wasabisys.com'])
    expect(calls[0].env.AWS_ACCESS_KEY_ID).toBe(KEY.access_key_id)
    storage.setAws(async () => ({ code: 1, stdout: '', stderr: `fatal: ${KEY.secret_access_key} denied https://x.example/y?X-Amz-Signature=abc` }))
    const why = await storage.mirrorCopy(m[0], '/tmp/a.mov', 'k')
    expect(why).toMatch(/denied/); expect(why).not.toContain('X-Amz-Signature=abc')
  })
  it('test reads the bucket and reports the reason without a key', async () => {
    await storage.save({ id: 'wasabi', bucket: 'my-bucket', region: 'us-east-1', ...KEY })
    storage.setAws(async () => ({ code: 0, stdout: '', stderr: '' }))
    expect(await storage.test('wasabi')).toEqual({ ok: true, detail: 'my-bucket answered' })
    storage.setAws(async () => ({ code: 255, stdout: '', stderr: 'AccessDenied' }))
    expect(await storage.test('wasabi')).toEqual({ ok: false, detail: 'AccessDenied' })
  })
})
