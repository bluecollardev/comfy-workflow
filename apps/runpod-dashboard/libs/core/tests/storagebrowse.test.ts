import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sb from '../src/storagebrowse.js'
import type { AwsRunner } from '../src/podpull.js'

// Browsing a storage adapter's bucket: one level, read-only, a fake AWS runner (no AWS is touched).
const ID = 'WASABIKEY12345678', SECRET = 'wasabisecretwasabisecret1234'
const LS = ['                           PRE shot-001/', '                           PRE my folder/', '2026-11-18 10:30:00       2048 notes.txt', '2026-11-18 11:00:01 5368709120 take 1.mov', 'junk line'].join('\n')
let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sbrowse-'))
  process.env.STORAGE_ADAPTERS_FILE = join(dir, 'storage-adapters.json'); process.env.SETTINGS_ENV_FILE = join(dir, 'none.env')
  writeFileSync(process.env.STORAGE_ADAPTERS_FILE, JSON.stringify({ flags: {}, adapters: [{ id: 'wasabi', name: 'Wasabi', endpoint: '', region: 'eu-central-1', bucket: 'bh-wasabi', prefix: '', enabled: true, access_key_id: ID, secret_access_key: SECRET }, { id: 'nokeys', name: 'No keys', endpoint: 'https://s3.example.com', region: 'x-1', bucket: 'bucket-a', prefix: '', enabled: false, access_key_id: '', secret_access_key: '' }] }))
})
afterEach(() => { sb.setAws(null); delete process.env.STORAGE_ADAPTERS_FILE; delete process.env.SETTINGS_ENV_FILE })

describe('storagebrowse.parseLs and cleanPrefix', () => {
  it('parses folders and files, ignores junk, caps', () => {
    const r = sb.parseLs(LS)
    expect(r.folders).toEqual(['shot-001', 'my folder'])
    expect(r.files).toEqual([{ name: 'notes.txt', bytes: 2048, modified: '2026-11-18T10:30:00' }, { name: 'take 1.mov', bytes: 5368709120, modified: '2026-11-18T11:00:01' }])
    expect(sb.parseLs(LS, 2)).toMatchObject({ truncated: true, folders: ['shot-001', 'my folder'], files: [] })
  })
  it('accepts the top and folders; refuses ..', () => {
    expect(sb.cleanPrefix('')).toBe(''); expect(sb.cleanPrefix('a/b')).toBe('a/b/'); expect(sb.cleanPrefix('a/b/')).toBe('a/b/')
    for (const bad of ['../x', '/x', 'a//b', 'a/../b']) expect(() => sb.cleanPrefix(bad)).toThrow()
  })
})

describe('storagebrowse.browse', () => {
  it('lists one level with the adapter endpoint, region and keys, as ls only', async () => {
    const seen: { args: string[]; env: Record<string, string> }[] = []
    const aws: AwsRunner = async (args, env) => { seen.push({ args, env }); return { code: 0, stdout: LS, stderr: '' } }
    sb.setAws(aws)
    const r = await sb.browse('wasabi', 'renders')
    expect(r).toMatchObject({ id: 'wasabi', bucket: 'bh-wasabi', prefix: 'renders/', folders: ['shot-001', 'my folder'], truncated: false })
    expect(r.files).toHaveLength(2)
    expect(seen[0].args).toEqual(['s3', 'ls', 's3://bh-wasabi/renders/', '--region', 'eu-central-1', '--endpoint-url', 'https://s3.eu-central-1.wasabisys.com'])
    expect(seen[0].env).toMatchObject({ AWS_ACCESS_KEY_ID: ID })
    expect(JSON.stringify(r)).not.toContain(SECRET)
  })
  it('an empty folder (exit 1, no output) is an empty listing', async () => {
    sb.setAws(async () => ({ code: 1, stdout: '', stderr: '' }))
    expect(await sb.browse('wasabi', '')).toMatchObject({ prefix: '', folders: [], files: [] })
  })
  it('an error carries no key', async () => {
    sb.setAws(async () => ({ code: 255, stdout: '', stderr: `An error occurred (InvalidAccessKeyId) ${ID} with ${SECRET}` }))
    const e = await sb.browse('wasabi', '').catch((x) => x as Error)
    expect(e).toBeInstanceOf(Error); expect(String((e as Error).message)).toContain('could not be read')
    expect(String((e as Error).message)).not.toContain(ID); expect(String((e as Error).message)).not.toContain(SECRET)
  })
  it('refuses an unknown id, a storage without keys, and a bad prefix', async () => {
    sb.setAws(async () => { throw new Error('must not run') })
    await expect(sb.browse('nope', '')).rejects.toThrow(/no storage adapter/)
    await expect(sb.browse('nokeys', '')).rejects.toThrow()
    await expect(sb.browse('wasabi', '../x')).rejects.toThrow(/Not a folder/)
  })
})

describe('storagebrowse.signGet (a storage object for the page)', () => {
  it('signs a read with that storage keys and never returns them', async () => {
    const s = await sb.signGet('s3file://storage.wasabi/renders%2Fa%20b.mov', { range: 'bytes=0-99', now: new Date('2026-01-01T00:00:00Z') })
    expect(s.url).toBe('https://s3.eu-central-1.wasabisys.com/bh-wasabi/renders/a%20b.mov')
    expect(s.headers.authorization).toContain(`Credential=${ID}/20260101/eu-central-1/s3/aws4_request`)
    expect(JSON.stringify(s)).not.toContain(SECRET)
  })
  it('refuses a bad address, an unknown or not-ready storage', async () => {
    expect(() => sb.guardStorageUrl('s3file://storage.wasabi/..%2Fx')).toThrow()
    expect(() => sb.guardStorageUrl('s3file://abc123/x')).toThrow()
    expect(() => sb.guardStorageUrl('s3file://storage.wasabi/a/')).toThrow()
    await expect(sb.signGet('s3file://storage.nokeys/a.mov')).rejects.toThrow()
    await expect(sb.signGet('s3file://storage.nope/a.mov')).rejects.toThrow()
  })
})
