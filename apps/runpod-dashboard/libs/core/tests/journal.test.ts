import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import * as journal from '../src/journal.js'
import { scratch } from './helpers.js'
import { VOL, fakeBucket, noS3Env, s3Env } from './s3fake.js'

// ADR-046: the change journal over a fake S3 (no pod, no network, no real volume).
const T0 = Date.parse('2026-11-18T10:00:00Z')
let t: number
const o = (b: ReturnType<typeof fakeBucket>) => ({ aws: b.aws, now: () => new Date(t), rand: () => 0.5 })
beforeEach(() => { scratch(); s3Env(); t = T0 })
afterEach(noS3Env)

describe('ULIDs and keys', () => {
  it('sort by time, and by order inside one millisecond', () => {
    const a = journal.ulid(T0, () => 0.1), b = journal.ulid(T0, () => 0.9), c = journal.ulid(T0 + 1, () => 0)
    expect(a).toHaveLength(26); expect(a < b).toBe(true); expect(b < c).toBe(true)
    expect(journal.decodeTime(c)).toBe(T0 + 1)
  })
  it('makes a key per UTC day under comfy-shared/.journal/ that isJournalKey accepts', () => {
    const k = journal.keyFor(T0, journal.ulid(T0), 'app:sync')
    expect(k).toMatch(/^comfy-shared\/\.journal\/2026\/11\/18\/[0-9A-Z]{26}-app:sync\.json$/); expect(journal.isJournalKey(k)).toBe(true)
  })
  it('only journal-shaped keys pass the guard', () => {
    for (const bad of ['comfy-shared/output/a.dpx', 'comfy-shared/.journal/../output/a.dpx', 'comfy-shared/.journal/2026/11/18/../../../../output/x', 'other/.journal/2026/11/18/01ARZ3NDEKTSV4RRFFQ69G5FAV-a.json', 'comfy-shared/.journal/', 'comfy-shared/.journal/2026/11/18/notaulid.json', 'comfy-shared/.journalx/2026/11/18/_compacted.json']) expect(journal.isJournalKey(bad), bad).toBe(false)
    expect(journal.isJournalKey('comfy-shared/.journal/2026/11/18/_compacted.json')).toBe(true)
    expect(() => journal.assertJournalKey('comfy-shared/output/a.dpx')).toThrow(/not a key of the change journal/)
  })
  it('validates paths inside comfy-shared', () => {
    for (const p of ['/etc/passwd', '../x', 'output/../../x', 'a\\b', '.journal/2026/x', 'output/./a', '', 'a\nb']) expect(() => journal.sharedPath(p), p).toThrow()
    expect(journal.sharedPath('output/proxy_v004/a.dpx')).toBe('output/proxy_v004/a.dpx')
    expect(journal.sharedPrefix('output')).toBe('output/')
  })
})

describe('emit', () => {
  it('writes one small file per event, with the event in it', async () => {
    const b = fakeBucket()
    const e = await journal.emit(VOL, { writer: 'app:sync', op: 'batch', prefix: 'input/', files: 3, bytes: 99 }, o(b))
    expect(e).toMatchObject({ writer: 'app:sync', op: 'batch', prefix: 'input/', files: 3, bytes: 99, ts: '2026-11-18T10:00:00.000Z' })
    expect(b.keys()).toEqual([e!.seq]); expect(JSON.parse(b.store.get(e!.seq)!.body)).toMatchObject({ prefix: 'input/', files: 3 })
  })
  it('never throws: no keys, a failing aws, a bad path, a runner that throws, dry-run mode', async () => {
    const b = fakeBucket()
    noS3Env(); journal.forgetCache()
    expect(await journal.emit(VOL, { writer: 'x', op: 'batch', prefix: 'input/' }, o(b))).toBeNull(); expect(b.calls).toEqual([])
    s3Env()
    expect(await journal.emit(VOL, { writer: 'x', op: 'batch', prefix: '../evil/' }, o(b))).toBeNull()
    expect(await journal.emit(VOL, { writer: 'x', op: 'batch', prefix: 'input/' }, { ...o(b), aws: async () => ({ code: 1, stdout: '', stderr: 'AccessDenied' }) })).toBeNull()
    expect(await journal.emit(VOL, { writer: 'x', op: 'batch', prefix: 'input/' }, { ...o(b), aws: async () => { throw new Error('boom') } })).toBeNull()
    expect(await journal.emit('', { writer: 'x', op: 'batch', prefix: 'input/' }, o(b))).toBeNull()
    process.env.RUNPOD_DRY_RUN = '1'
    try { journal.forgetCache(); expect(await journal.emit(VOL, { writer: 'x', op: 'batch', prefix: 'input/' }, o(b))).toBeNull() } finally { delete process.env.RUNPOD_DRY_RUN }
  })
  it('does not put the S3 keys in anything it writes', async () => {
    const b = fakeBucket(); await journal.emit(VOL, { writer: 'app:sync', op: 'batch', prefix: 'input/' }, o(b))
    expect(JSON.stringify([...b.store.values()])).not.toMatch(/user_x|rps_y/)
  })
})

describe('the feed (list)', () => {
  const emitN = async (b: ReturnType<typeof fakeBucket>, n: number, prefix = 'output/') => { for (let i = 0; i < n; i++) { t += 1000; await journal.emit(VOL, { writer: 'reconciler', op: 'created', prefix: `${prefix}${i}/`, files: i }, o(b)) } }
  it('returns events oldest first with a cursor; the next call starts AFTER the cursor (StartAfter), one listing each', async () => {
    const b = fakeBucket(); await emitN(b, 5)
    b.calls.length = 0
    const first = await journal.list({ volume_id: VOL, limit: 3 }, o(b))
    expect(first.events.map((e) => e.prefix)).toEqual(['output/0/', 'output/1/', 'output/2/']); expect(first.more).toBe(true)
    expect(b.calls.filter((c) => c[1] === 'list-objects-v2')).toHaveLength(1)
    const again = await journal.list({ volume_id: VOL, since: first.cursor }, o(b))
    expect(again.events.map((e) => e.prefix)).toEqual(['output/3/', 'output/4/']); expect(again.more).toBe(false)
    const none = await journal.list({ volume_id: VOL, since: again.cursor }, o(b))
    expect(none.events).toEqual([]); expect(none.cursor).toBe(again.cursor)
    expect(b.calls.find((c) => c[1] === 'list-objects-v2' && c.includes('--start-after'))).toBeTruthy()
  })
  it("'now' is the end of the journal: nothing before it, everything after it", async () => {
    const b = fakeBucket(); await emitN(b, 2)
    t += 5000
    const now = await journal.list({ volume_id: VOL, since: 'now' }, o(b)); expect(now.events).toEqual([])
    t += 1000; await journal.emit(VOL, { writer: 'reconciler', op: 'created', prefix: 'output/new/' }, o(b))
    expect((await journal.list({ volume_id: VOL, since: now.cursor }, o(b))).events.map((e) => e.prefix)).toEqual(['output/new/'])
  })
  it('takes an ISO time as since', async () => {
    const b = fakeBucket(); await emitN(b, 4)
    const r = await journal.list({ volume_id: VOL, since: new Date(T0 + 2500).toISOString() }, o(b))
    expect(r.events.map((e) => e.prefix)).toEqual(['output/2/', 'output/3/'])
    await expect(journal.list({ volume_id: VOL, since: 'yesterday-ish' }, o(b))).rejects.toThrow(/since is a cursor/)
  })
  it('filters by prefix but the cursor still moves over the dropped events', async () => {
    const b = fakeBucket(); await emitN(b, 2, 'output/'); await emitN(b, 2, 'models/')
    const r = await journal.list({ volume_id: VOL, prefix: 'models/' }, o(b))
    expect(r.events.map((e) => e.prefix)).toEqual(['models/0/', 'models/1/']); expect(r.cursor).toBe(b.keys().at(-1))
    await expect(journal.list({ volume_id: VOL, prefix: '../x' }, o(b))).rejects.toThrow()
  })
  it('drops an event whose path leaves comfy-shared and one that is not JSON', async () => {
    const b = fakeBucket()
    const k1 = journal.keyFor(T0, journal.ulid(T0, () => 0), 'pod:abc'), k2 = journal.keyFor(T0 + 1, journal.ulid(T0 + 1, () => 0), 'pod:abc'), k3 = journal.keyFor(T0 + 2, journal.ulid(T0 + 2, () => 0), 'pod:abc')
    b.put(k1, { body: JSON.stringify({ writer: 'pod:abc', op: 'created', path: '../../etc/passwd' }) }); b.put(k2, { body: 'not json' }); b.put(k3, { body: JSON.stringify({ writer: 'pod:abc', op: 'created', path: 'output/a.dpx', bytes: 5 }) })
    const r = await journal.list({ volume_id: VOL }, o(b))
    expect(r.events).toEqual([expect.objectContaining({ seq: k3, path: 'output/a.dpx', bytes: 5 })]); expect(r.cursor).toBe(k3)
  })
  it('says why when the volume cannot be read', async () => {
    noS3Env(); journal.forgetCache()
    await expect(journal.list({ volume_id: VOL }, o(fakeBucket()))).rejects.toThrow(/RUNPOD_S3|S3/)
  })
})

describe('prune (retention)', () => {
  const day = (n: number) => T0 - n * 86_400_000
  const ev = (ms: number, w = 'app:sync') => journal.keyFor(ms, journal.ulid(ms, () => 0.3), w)
  const body = (prefix: string) => JSON.stringify({ writer: 'app:sync', op: 'batch', prefix })
  it('compacts a day older than 14 days into _compacted.json, removes one older than 90, leaves recent days alone', async () => {
    const b = fakeBucket()
    const recent = ev(day(1)), mid1 = ev(day(20)), mid2 = ev(day(20) + 5000), old = ev(day(100))
    b.put(recent, body('input/')); b.put(mid1, body('output/a/')); b.put(mid2, body('output/b/')); b.put(old, body('models/'))
    const r = await journal.prune(VOL, {}, o(b))
    expect(r.removed_days).toHaveLength(1); expect(r.compacted_days).toHaveLength(1)
    expect(b.store.has(recent)).toBe(true); expect(b.store.has(old)).toBe(false); expect(b.store.has(mid1)).toBe(false); expect(b.store.has(mid2)).toBe(false)
    const compacted = b.keys().find((k) => k.endsWith('_compacted.json'))!
    expect(JSON.parse(b.store.get(compacted)!.body).events.map((e: { prefix: string }) => e.prefix)).toEqual(['output/a/', 'output/b/'])
    // and the feed still reads the compacted day
    const feed = await journal.list({ volume_id: VOL, since: new Date(day(21)).toISOString() }, o(b))
    expect(feed.events.map((e) => e.prefix)).toEqual(['output/a/', 'output/b/', 'input/'])
  })
  it('NEVER removes a key outside .journal/, even if the listing hands it over or a prefix is crafted', async () => {
    const b = fakeBucket()
    const outside = ['comfy-shared/output/proxy/a.dpx', 'comfy-shared/.journal/../output/b.dpx', 'comfy-shared/models/x.safetensors', 'comfy-shared/.journal/2026/01/01/../../../../models/y.safetensors', 'comfy-shared/.journal/2020/01/01/readme.txt']
    for (const k of outside) b.put(k, { body: 'keep' })
    b.put(ev(day(200)), body('input/'))
    // a listing that lies: it also returns keys outside the journal
    const lying = { ...o(b), aws: (async (args, env, c) => { const r = await b.aws(args, env, c); if (args[1] === 'list-objects-v2' && r.stdout) { const j = JSON.parse(r.stdout); j.Contents.push(...outside.map((Key) => ({ Key, Size: 1 }))); return { ...r, stdout: JSON.stringify(j) } } return r }) as typeof b.aws }
    const r = await journal.prune(VOL, { compactAfterDays: 1, removeAfterDays: 2 }, lying)
    expect(r.skipped).toBeGreaterThanOrEqual(outside.length)
    for (const k of outside) expect(b.store.has(k), k).toBe(true)
    expect(b.calls.filter((c) => c[1] === 'rm').every((c) => c[2].startsWith('s3://' + VOL + '/comfy-shared/.journal/'))).toBe(true)
    await expect(journal.deleteKeyForTest({ id: 'a', secret: 'b', endpoint: 'e', bucket: VOL, region: 'EU-RO-1' }, 'comfy-shared/output/a.dpx', o(b))).rejects.toThrow(/not a key of the change journal/)
    expect(b.calls.some((c) => c[1] === 'rm' && c[2].includes('output/a.dpx'))).toBe(false)
  })
  it('keeps the original files when the merged file did not land', async () => {
    const b = fakeBucket(); const a = ev(day(20)), c = ev(day(20) + 1000); b.put(a, body('x/')); b.put(c, body('y/'))
    const failing = { ...o(b), aws: (async (args, env, cc) => (args[1] === 'cp' && args[3]?.endsWith('_compacted.json') ? { code: 1, stdout: '', stderr: 'denied' } : b.aws(args, env, cc))) as typeof b.aws }
    await expect(journal.prune(VOL, {}, failing)).rejects.toThrow(); expect(b.store.has(a) && b.store.has(c)).toBe(true)
  })
  it('refuses nonsense retention', async () => { await expect(journal.prune(VOL, { compactAfterDays: 10, removeAfterDays: 5 }, o(fakeBucket()))).rejects.toThrow(/Retention/) })
})

describe('writers hook (emitForJob)', () => {
  it('writes one batch per prefix for a finished job, nothing for a failed one', async () => {
    const b = fakeBucket()
    await journal.emitForJob({ kind: 'fetch', round: 'r', state: 'done', fetch_items: [{ name: 'a.safetensors', folder: 'vae' }, { name: 'b.safetensors', folder: 'vae' }], fetched: ['a.safetensors', 'b.safetensors'] }, VOL, o(b))
    await journal.emitForJob({ kind: 'erase', round: 'r', state: 'done', erase_keys: ['output', 'nonsense'] }, VOL, o(b))
    await journal.emitForJob({ kind: 'fetch', round: 'r', state: 'failed' }, VOL, o(b))
    const evs = (await journal.list({ volume_id: VOL }, o(b))).events
    expect(evs.map((e) => `${e.writer} ${e.op} ${e.prefix}`)).toEqual(['app:models batch models/vae/', 'app:erase deleted output/'])
  })
})
