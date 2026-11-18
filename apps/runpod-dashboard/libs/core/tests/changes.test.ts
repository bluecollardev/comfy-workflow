import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as changes from '../src/changes.js'
import * as journal from '../src/journal.js'
import { scratch } from './helpers.js'
import { VOL, fakeBucket, noS3Env, s3Env } from './s3fake.js'

// ADR-046: the reconciler against a fake S3: baseline, diff, snapshot, caps. No pod, no real volume.
let t: number
const O = (b: ReturnType<typeof fakeBucket>, extra: Partial<changes.ReconcileOpts> = {}) => ({ aws: b.aws, now: () => new Date(t), rand: () => 0.5, ...extra })
const C = 'comfy-shared/'
beforeEach(() => { const d = scratch(); process.env.VOLUME_SNAPSHOTS_FILE = join(d, 'volume-snapshots.json'); s3Env(); t = Date.parse('2026-11-18T10:00:00Z') })
afterEach(() => { noS3Env(); delete process.env.VOLUME_SNAPSHOTS_FILE })
const feed = async (b: ReturnType<typeof fakeBucket>) => (await journal.list({ volume_id: VOL }, O(b))).events.filter((e) => e.writer === 'reconciler')

describe('diffScope', () => {
  it('finds created, modified (size or time) and deleted', async () => {
    const d = await changes.diffScope({ a: [1, 't1'], b: [2, 't1'], c: [3, 't1'] }, { a: [1, 't1'], b: [9, 't1'], c: [3, 't2'], d: [4, 't1'] })
    expect(d).toEqual({ created: ['d'], modified: ['b', 'c'], deleted: [] })
    expect((await changes.diffScope({ x: [1, 't'] }, {})).deleted).toEqual(['x'])
  })
})

describe('reconcile', () => {
  it('the first run records a baseline and emits nothing; a later run reports new and changed files as reconciler events', async () => {
    const b = fakeBucket({ [`${C}output/proxy_v001/a.dpx`]: { size: 100 }, [`${C}workflows/g.json`]: { size: 10 } })
    const first = await changes.reconcile(VOL, O(b)); expect(first.baseline).toBe(true); expect(first.events).toEqual([]); expect(await feed(b)).toEqual([])
    expect(Object.keys((await changes.snapshot(VOL))!.scopes).sort()).toEqual(['node-packs/', 'output/', 'output/proxy_v001/', 'workflows/'])
    t += 60_000
    b.put(`${C}output/proxy_v001/b.dpx`, { size: 50 }); b.put(`${C}workflows/g.json`, { size: 11 })
    const second = await changes.reconcile(VOL, O(b))
    expect(second.baseline).toBe(false)
    const evs = await feed(b)
    expect(evs.map((e) => `${e.op} ${e.prefix} ${e.paths?.join(',')} ${e.bytes}`).sort()).toEqual(['created output/proxy_v001/ output/proxy_v001/b.dpx 50', 'modified workflows/ workflows/g.json 11'])
    expect(evs.every((e) => e.writer === 'reconciler')).toBe(true)
    // nothing changed: nothing emitted
    t += 60_000; const n = b.keys().length; await changes.reconcile(VOL, O(b)); expect(b.keys().length).toBe(n)
  })
  it('a NEW output folder is created; an old folder only now listed is a baseline; a deletion in a complete folder is reported', async () => {
    const b = fakeBucket({ [`${C}output/f1/a.dpx`]: { size: 1 }, [`${C}output/f2/a.dpx`]: { size: 1 } })
    await changes.reconcile(VOL, O(b, { folderCap: 1 }))   // only f2 (the newest by name) is listed whole
    expect(Object.keys((await changes.snapshot(VOL))!.scopes)).not.toContain('output/f1/')
    t += 1000; b.put(`${C}output/f3/x.dpx`, { size: 7 }); b.store.delete(`${C}output/f2/a.dpx`)
    await changes.reconcile(VOL, O(b, { folderCap: 3 }))   // f1 is listed for the first time: a baseline, not "created"
    const evs = await feed(b)
    expect(evs.map((e) => `${e.op} ${e.prefix}`).sort()).toEqual(['created output/f3/', 'deleted output/f2/'])
  })
  it('lists only the allowlist: input and models only when asked, never the whole volume', async () => {
    const b = fakeBucket({ [`${C}input/a.png`]: { size: 1 }, [`${C}models/m.safetensors`]: { size: 1 }, [`${C}temp/x`]: { size: 1 } })
    await changes.reconcile(VOL, O(b))
    const listed = b.calls.filter((c) => c[1] === 'ls').map((c) => c[2])
    expect(listed).toEqual(expect.arrayContaining([`s3://${VOL}/${C}output/`, `s3://${VOL}/${C}workflows/`, `s3://${VOL}/${C}node-packs/`]))
    expect(listed.some((u) => /input|models|temp/.test(u))).toBe(false); expect(listed.every((u) => u !== `s3://${VOL}/`)).toBe(true)
    await changes.reconcile(VOL, O(b, { extra: ['input'] })); expect(b.calls.some((c) => c[2] === `s3://${VOL}/${C}input/`)).toBe(true)
  })
  it('respects the object cap and says it was partial', async () => {
    const files: Record<string, { size: number }> = {}
    for (let f = 0; f < 4; f++) for (let i = 0; i < 5; i++) files[`${C}output/f${f}/${i}.dpx`] = { size: 1 }
    const r = await changes.reconcile(VOL, O(fakeBucket(files), { objectCap: 8 })); expect(r.partial).toBe(true)
  })
  it('does nothing and says why for a volume it cannot read; a corrupt snapshot starts empty', async () => {
    noS3Env(); journal.forgetCache()
    expect((await changes.reconcile(VOL, O(fakeBucket()))).skipped).toMatch(/cannot be read/)
    s3Env(); const { writeFileSync } = await import('node:fs'); writeFileSync(process.env.VOLUME_SNAPSHOTS_FILE!, '{not json')
    expect((await changes.reconcile(VOL, O(fakeBucket()))).baseline).toBe(true)
  })
})

describe('tick', () => {
  it('reconciles the volumes the provider names, skips a failing one, and never throws', async () => {
    const b = fakeBucket({ [`${C}output/a/x.dpx`]: { size: 1 } })
    changes.setOpts({ aws: b.aws })
    changes.start(() => [{ volume_id: VOL }, { volume_id: 'not a volume!' }], 3_600_000)
    try { expect((await changes.tick()).filter((r) => !r.skipped).map((r) => r.volume_id)).toEqual([VOL]) } finally { changes.stop(); changes.setOpts(null) }
  })
})
