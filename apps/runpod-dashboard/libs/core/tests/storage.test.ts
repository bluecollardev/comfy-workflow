import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as storage from '../src/storage.js'
import * as panama from '../src/panama.js'
import * as syncrules from '../src/syncrules.js'

// Storage adapters (docs/ADR-063): one S3-compatible storage per record; Wasabi built in; publishing mirrors to the enabled ones.
let dir = ''
const until = async (f: () => boolean, n = 200) => { for (let i = 0; i < n && !f(); i++) await new Promise((r) => setTimeout(r, 5)) }
const KEY = { access_key_id: 'WASABIKEY12345678', secret_access_key: 'wasabisecretwasabisecret1234' }
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'storage-')); process.env.STORAGE_ADAPTERS_FILE = join(dir, 'storage-adapters.json'); process.env.SYNC_RULES_FILE = join(dir, 'sync-rules.json'); process.env.POD_MANAGER_CONFIG_DIR = dir })
afterEach(() => { storage.setAws(null); delete process.env.STORAGE_ADAPTERS_FILE; delete process.env.SYNC_RULES_FILE; rmSync(dir, { recursive: true, force: true }) })

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
  it('a copy goes below the adapter directory with its own endpoint and keys, only for enabled, complete adapters that listen to the event', async () => {
    expect(storage.forEvent('published')).toEqual([])
    await storage.save({ id: 'wasabi', bucket: 'my-bucket', region: 'eu-central-1', prefix: 'bh', ...KEY, enabled: true })
    syncrules.set('*', 'published', [{ type: 'storage', id: 'wasabi' }])
    const m = storage.forEvent('published'); expect(m.map((x) => x.id)).toEqual(['wasabi'])
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
  // docs/ADR-064: events
  it('events are saved, validated, and a record with none listens to nothing (an old generating or publishing is ignored)', async () => {
    await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'us-east-1', ...KEY, enabled: true })
    expect((await storage.list()).adapters.find((a) => a.id === 'wasabi')!.events).toEqual([])
    await storage.save({ id: 'wasabi', events: ['generated', 'approved'] })
    expect((await storage.list()).adapters.find((a) => a.id === 'wasabi')!.events).toEqual(['generated', 'approved'])
    await expect(storage.save({ id: 'wasabi', events: ['nope'] })).rejects.toThrow(/events are some of/)
    await storage.save({ id: 'wasabi', events: [] })
    expect(storage.forEvent('generated')).toEqual([]); expect(storage.forEvent('published')).toEqual([])
  })
  it('uploadOn sends to the adapters that listen, skips weights and a same-size file already there, and a failure is a warning', async () => {
    const { writeFileSync } = await import('node:fs')
    await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'us-east-1', ...KEY, enabled: true })
    syncrules.set('*', 'generated', [{ type: 'storage', id: 'wasabi' }])
    const a = join(dir, 'a.mov'), w = join(dir, 'w.safetensors'), c = join(dir, 'c.mov'); writeFileSync(a, 'abc'); writeFileSync(w, 'x'); writeFileSync(c, 'abcd')
    const calls: string[] = []
    storage.setAws(async (args) => {
      calls.push(args.slice(0, 3).join(' '))
      if (args[1] === 'ls') return { code: 0, stdout: args[2].endsWith('/a.mov') ? '2026-01-01 00:00:00          3 a.mov\n' : '', stderr: '' } as never
      return { code: args[2] === c ? 1 : 0, stdout: '', stderr: args[2] === c ? 'denied' : '' } as never
    })
    const warns = await storage.uploadOn('generated', [{ abs: a, key: 'x/a.mov' }, { abs: w, key: 'x/w.safetensors' }, { abs: c, key: 'x/c.mov' }])
    expect(calls.some((x) => x.includes('w.safetensors'))).toBe(false)
    expect(calls.filter((x) => x.startsWith('s3 cp')).length).toBe(1)   // a.mov was already there; the weight never goes; c.mov tried
    expect(warns).toHaveLength(1); expect(warns[0]).toMatch(/c\.mov/)
    expect(await storage.uploadOn('approved', [{ abs: a, key: 'x/a.mov' }])).toEqual([])
  })
  it('uploadFromVolume: with no pod, each file is read from the volume once, copied on and the temporary file removed; a same-size one and a weight never move', async () => {
    const publish = await import('../src/publish.js')
    const { existsSync, writeFileSync } = await import('node:fs')
    await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'us-east-1', ...KEY, enabled: true })
    syncrules.set('vol1', 'published', [{ type: 'storage', id: 'wasabi' }])
    publish.setDeps({ volumeAccess: (async () => ({ ok: true, id: 'RPKEYID1234567890', secret: 'rpsecretrpsecretrpsecret99', endpoint: 'https://s3api.example', bucket: 'vol1', region: 'eu-ro-1' })) as never })
    const cps: string[][] = []; let tmp = ''
    storage.setAws(async (args) => {
      if (args[1] === 'ls') return { code: 0, stdout: args[2].endsWith('/old.mov') ? '2026-01-01 00:00:00          3 old.mov\n' : '', stderr: '' } as never
      cps.push([args[2], args[3]]); if (args[2].startsWith('s3://vol1/')) { tmp = args[3]; writeFileSync(tmp, 'abc') }
      return { code: 0, stdout: '', stderr: '' } as never
    })
    try {
      const f = (n: string) => ({ source_key: `comfy-shared/output/deliver/s/v001/${n}`, key: `deliver/s/v001/${n}`, bytes: 3 })
      expect(await storage.uploadFromVolume('published', 'vol1', [f('a.mov'), f('old.mov'), f('w.safetensors')])).toEqual([])
      expect(cps.map((c) => c[0])).toEqual(['s3://vol1/comfy-shared/output/deliver/s/v001/a.mov', tmp])
      expect(cps[1][1]).toBe('s3://b-bucket/deliver/s/v001/a.mov')
      expect(existsSync(tmp)).toBe(false)
      expect(await storage.uploadFromVolume('approved', 'vol1', [f('a.mov')])).toEqual([])   // no rule: nothing moves
      expect(cps).toHaveLength(2)
    } finally { publish.setDeps(null) }
  })
  it('any storage can be given a title, the built-ins too; an empty one puts the default back', async () => {
    await storage.save({ id: 'publish-s3', name: 'Panama BH' }); await storage.save({ id: 'wasabi', name: 'Long-term' })
    let l = (await storage.list()).adapters
    expect(l.find((a) => a.id === 'publish-s3')!.name).toBe('Panama BH'); expect(l.find((a) => a.id === 'wasabi')!.name).toBe('Long-term')
    await storage.save({ id: 'publish-s3', name: '' })
    l = (await storage.list()).adapters; expect(l.find((a) => a.id === 'publish-s3')!.name).toBe('Panama BH (S3)')
    await expect(storage.save({ id: 'panama-s3', name: 'x'.repeat(61) })).rejects.toThrow(/1 to 60/)
  })
  it('uploadFromPod: the pod puts each file to a signed link of the adapter, keys never reach the pod, a big or weight file is not sent', async () => {
    const publish = await import('../src/publish.js')
    await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'ap-southeast-1', prefix: 'lt', ...KEY, enabled: true })
    syncrules.set('*', 'generated', [{ type: 'storage', id: 'wasabi' }])
    const scripts: string[] = []
    publish.setDeps({ ssh: (async (o: { script: string; onLine: (l: string) => void }) => { scripts.push(o.script); o.onLine(`PUBLISH-SHA ${'a'.repeat(64)}`); o.onLine('PUBLISH-OK'); return { code: 0 } }) as never })
    storage.setAws(async () => ({ code: 1, stdout: '', stderr: '' }) as never)   // nothing is there yet
    try {
      const pod = { id: 'p1', name: 'pod-1', host: 'root@1.2.3.4', port: 22 }
      const warns = await storage.uploadFromPod('generated', pod, [
        { source_key: 'comfy-shared/output/a.mov', key: 'a.mov', bytes: 10 },
        { source_key: 'comfy-shared/output/w.safetensors', key: 'w.safetensors', bytes: 10 },
        { source_key: 'comfy-shared/output/big.mov', key: 'big.mov', bytes: 6 * 1024 ** 3 },
      ])
      expect(scripts).toHaveLength(1)
      expect(scripts[0]).toContain('/workspace/comfy-shared/output/a.mov'); expect(scripts[0]).toContain('s3.ap-southeast-1.wasabisys.com/b-bucket/lt/a.mov')
      expect(scripts[0]).not.toContain(KEY.secret_access_key)   // only a signature goes to the pod
      expect(warns).toHaveLength(1); expect(warns[0]).toMatch(/big\.mov.*over 5 GB/)
      expect(await storage.uploadFromPod('approved', pod, [{ source_key: 'x', key: 'x', bytes: 1 }])).toEqual([])
    } finally { publish.setDeps(null) }
  })
  it('one storage can be the default; the publish destination and Panama cannot; it clears', async () => {
    await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'us-east-1', ...KEY })
    expect((await storage.list()).adapters.some((a) => a.default)).toBe(false)
    let l = (await storage.setDefault('wasabi')).adapters
    expect(l.filter((a) => a.default).map((a) => a.id)).toEqual(['wasabi'])
    await storage.save({ name: 'Mine', bucket: 'mine-bucket', region: 'us-east-1', ...KEY })
    l = (await storage.setDefault('mine')).adapters; expect(l.filter((a) => a.default).map((a) => a.id)).toEqual(['mine'])   // one at a time
    await expect(storage.setDefault('publish-s3')).rejects.toThrow(/Wasabi or a storage of your own/); await expect(storage.setDefault('panama-s3')).rejects.toThrow(); await expect(storage.setDefault('nope')).rejects.toThrow()
    await expect(storage.remove('mine')).rejects.toThrow(/default storage cannot be deleted/)   // the default is not deletable
    await storage.setDefault('wasabi'); await storage.remove('mine'); expect((await storage.list()).adapters.some((x) => x.id === 'mine')).toBe(false)   // another one is
    await expect(storage.remove('wasabi')).rejects.toThrow(/default storage cannot be deleted/)
    l = (await storage.setDefault('wasabi')).adapters; l = (await storage.setDefault('')).adapters; expect(l.some((a) => a.default)).toBe(false)
  })
  it('an Upload On event upload is a job: counted while it runs, listed after, and Cancel stops it', async () => {
    const { writeFileSync } = await import('node:fs')
    const uploads = await import('../src/storageuploads.js')
    uploads.reset()
    await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'us-east-1', ...KEY, enabled: true })
    syncrules.set('*', 'generated', [{ type: 'storage', id: 'wasabi' }])
    const a = join(dir, 'a.mov'), b = join(dir, 'b.mov'); writeFileSync(a, 'abc'); writeFileSync(b, 'abcd')
    let release: () => void = () => undefined; const hold = new Promise<void>((r) => { release = r })
    storage.setAws(async (args) => { if (args[1] === 'ls') return { code: 1, stdout: '', stderr: '' } as never; if (args[2] === b) await hold; return { code: 0, stdout: '', stderr: '' } as never })
    const run = storage.uploadOn('generated', [{ abs: a, key: 'x/a.mov' }, { abs: b, key: 'x/b.mov' }])
    await until(() => storage.uploadJobs().jobs.some((j) => j.files_done === 1))
    const live = storage.uploadJobs().jobs[0]
    expect(live).toMatchObject({ kind: 'storage-upload', state: 'uploading', event: 'generated', targets: ['Wasabi'], files_total: 2, files_done: 1, bytes_total: 7 })
    release(); await run
    const done = storage.uploadJobs().jobs[0]; expect(done).toMatchObject({ state: 'done', files_done: 2, files_failed: 0 }); expect(done.finished_at).toBeTruthy()
    // cancel while a file is held
    let rel2: () => void = () => undefined; const hold2 = new Promise<void>((r) => { rel2 = r })
    storage.setAws(async (args, _e, o) => { if (args[1] === 'ls') return { code: 1, stdout: '', stderr: '' } as never; await Promise.race([hold2, new Promise<void>((r) => o?.signal?.addEventListener('abort', () => r()))]); return { code: o?.signal?.aborted ? 1 : 0, stdout: '', stderr: o?.signal?.aborted ? 'aborted' : '' } as never })
    const run2 = storage.uploadOn('generated', [{ abs: a, key: 'y/a.mov' }])
    await until(() => storage.uploadJobs().jobs.some((j) => j.state === 'uploading'))
    const id = storage.uploadJobs().jobs.find((j) => j.state === 'uploading')!.job_id
    storage.cancelUpload(id); rel2(); await run2
    expect(storage.uploadJobs(id).jobs[0].state).toBe('cancelled')
    uploads.reset()
  })
  it('a storage is limited to volumes by the sync rules; the old volumes field is kept valid but no longer drives sending', async () => {
    await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'us-east-1', ...KEY, enabled: true })
    syncrules.set('*', 'generated', [{ type: 'storage', id: 'wasabi' }])
    expect(storage.forEvent('generated', 'volA').length).toBe(1)   // the '*' rule: every volume
    syncrules.set('volA', 'generated', [{ type: 'storage', id: 'wasabi' }]); syncrules.set('volB', 'generated', [])
    expect(storage.forEvent('generated', 'volA').length).toBe(1); expect(storage.forEvent('generated', 'volB').length).toBe(0); expect(storage.forEvent('generated').length).toBe(1)
    await storage.save({ id: 'wasabi', volumes: ['volA'] })
    expect((await storage.list()).adapters.find((a) => a.id === 'wasabi')!.volumes).toEqual(['volA'])
    expect(storage.forEvent('generated', 'volB').length).toBe(0); expect(storage.forEvent('generated', 'volC').length).toBe(1)   // ignored by sending
    await expect(storage.save({ id: 'wasabi', volumes: ['bad id!'] })).rejects.toThrow(/volume ids/)
  })
})
