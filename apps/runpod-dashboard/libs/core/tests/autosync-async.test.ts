import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import * as autosync from '../src/autosync.js'
import * as changes from '../src/changes.js'
import * as mounts from '../src/mounts.js'
import * as store from '../src/autosyncstore.js'
import type * as journal from '../src/journal.js'
import { scratch } from './helpers.js'
import { VOL, noS3Env, s3Env } from './s3fake.js'

// ADR-046, the ASYNC RULE: the core runs in Electron's main process, so nothing in the auto-sync path may block it.
const SRC = join(import.meta.dirname, '..', 'src')
const text = (f: string) => readFileSync(join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const FORBIDDEN = /\b(spawnSync|execSync|execFileSync|readFileSync|writeFileSync)\b/

describe('static: no synchronous process or file calls on anything big or slow', () => {
  // The one exception, with its reason: autosyncstore.ts reads and writes autosync.json and autosync-state.json (a few KB: the settings per pod, a cursor per pod, up to 200 conflicts)
  // synchronously, once per click or per tick. The manifest and the reconciler's snapshot (thousands of entries) use fs.promises. Nothing else is allowed.
  const ALLOWED: Record<string, string[]> = { 'autosyncstore.ts': ['readFileSync', 'writeFileSync'] }
  for (const f of ['journal.ts', 'changes.ts', 'autosync.ts', 'autosyncpush.ts', 'autosyncstore.ts', 'syncruns.ts', 'renders.ts']) {
    it(`${f} has none${ALLOWED[f] ? ` beyond the tiny-config helper (${ALLOWED[f].join(', ')})` : ''}`, () => {
      const used = new Set(text(f).match(new RegExp(FORBIDDEN, 'g')) ?? [])
      for (const a of ALLOWED[f] ?? []) used.delete(a)
      expect([...used]).toEqual([])
    })
  }
  it('the additions to syncrun.ts (the paths filter, its lists and stats) are async too', () => {
    expect(text('syncrun.ts').match(/\b(spawnSync|execSync|execFileSync|readFileSync|writeFileSync|mkdtempSync|statSync|rmSync)\b/g) ?? []).toEqual([])
  })
  it('only the small tiny-config helper in autosyncstore.ts touches the two small files', () => {
    const t = text('autosyncstore.ts'); const at = t.indexOf('function readJson'); expect(at).toBeGreaterThan(0)
    expect(t.match(/readFileSync|writeFileSync/g)!.length).toBeLessThanOrEqual(4)
  })
})

/** Records the longest gap between ticks of a 1 ms interval while `work` runs: a measure of how long the event loop was held. */
async function maxLag(work: () => Promise<unknown>): Promise<number> {
  let last = performance.now(), worst = 0
  const probe = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n }, 1)
  await new Promise((r) => setTimeout(r, 5)); last = performance.now(); worst = 0
  try { await work() } finally { clearInterval(probe) }
  return worst
}
// The bound: a window frame is 16 ms, so a main-process stall of three frames (50 ms) is where the app visibly freezes. The work is done in chunks of 500 with a yield between them, each a few ms.
const BOUND_MS = 50

describe('event-loop lag', () => {
  let dir: string
  beforeEach(() => { dir = scratch(); process.env.VOLUME_SNAPSHOTS_FILE = join(dir, 'snap.json'); s3Env() })
  afterEach(() => { noS3Env(); delete process.env.VOLUME_SNAPSHOTS_FILE; autosync.reset() })

  it(`the reconciler on a 50,000-object listing never holds the loop for ${BOUND_MS} ms`, async () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => `2026-11-18 10:00:00 ${String(1000 + (i % 7)).padStart(10)} comfy-shared/output/big/f${String(i).padStart(6, '0')}.dpx`).join('\n')   // built once, outside the measure
    const rows2 = rows.replace('f000001.dpx', 'f900001.dpx')
    let which = rows
    const aws = async (args: string[]) => ({ code: 0, stderr: '', stdout: args[0] === 's3' && args[2].endsWith('/output/') && !args.includes('--recursive') ? '                           PRE big/' : args[2].endsWith('/output/big/') ? which : '' })
    await changes.reconcile(VOL, { aws })   // the baseline
    which = rows2
    const lag = await maxLag(async () => { const r = await changes.reconcile(VOL, { aws, objectCap: 60_000 }); expect(r.listed).toBeGreaterThan(50_000) })
    expect(lag).toBeLessThan(BOUND_MS)
  }, { timeout: 60_000, retry: 2 })   // a 1 ms probe is noisy when other test files load the machine: it must pass once in three tries, and a real blocking loop fails all three

  it(`the controller turning a 2,000-path feed into a pull never holds the loop for ${BOUND_MS} ms`, async () => {
    const shared = join(dir, 'shared'); mkdirSync(join(shared, 'output'), { recursive: true })
    for (const [k, f] of [['AUTOSYNC_FILE', 'a.json'], ['AUTOSYNC_STATE_FILE', 's.json'], ['AUTOSYNC_MANIFEST_FILE', 'm.json']]) process.env[k] = join(dir, f)
    const cfg = mounts.defaults(); cfg.folders['comfy-shared'] = shared; cfg.network_volume_id = VOL; mounts.save(cfg)
    const paths = Array.from({ length: 2000 }, (_, i) => `output/big/f${i}.dpx`)
    const evs: journal.JournalEvent[] = Array.from({ length: 10 }, (_, k) => ({ seq: `k${k}`, ts: '', writer: 'reconciler', op: 'created', paths: paths.slice(k * 200, k * 200 + 200) }) as journal.JournalEvent)
    store.set('p1', { enabled: true, pull: true, approved_by: 'Lucas' })
    autosync.setDeps({ volumeOf: async () => VOL, tail: async () => 'k', reconcile: async () => undefined, podName: () => 'p', localRoot: () => shared, parallel: () => 4,
      feed: async (_v, since) => ({ volume_id: VOL, cursor: 'kz', events: since === 'k' ? evs : [], more: false }),
      files: async () => paths.map((path) => ({ path, bytes: 10, modified: 'm' })), stat: async () => null,
      run: async (req) => { for (const p of req.paths!) void p; return { steps: 1, failed: 0, warned: 0, cancelled: false } } })
    const lag = await maxLag(async () => { await autosync.tick(); await autosync.settle() })
    expect(lag).toBeLessThan(BOUND_MS)
    for (const k of ['AUTOSYNC_FILE', 'AUTOSYNC_STATE_FILE', 'AUTOSYNC_MANIFEST_FILE']) delete process.env[k]
  }, { timeout: 30_000, retry: 2 })

  it('status() and get() answer in a few ms while a pull is in flight', async () => {
    const shared = join(dir, 'shared'); mkdirSync(join(shared, 'output'), { recursive: true })
    for (const [k, f] of [['AUTOSYNC_FILE', 'a.json'], ['AUTOSYNC_STATE_FILE', 's.json'], ['AUTOSYNC_MANIFEST_FILE', 'm.json']]) process.env[k] = join(dir, f)
    const cfg = mounts.defaults(); cfg.folders['comfy-shared'] = shared; mounts.save(cfg)
    store.set('p1', { enabled: true, pull: true, approved_by: 'Lucas' })
    let release!: () => void; const gate = new Promise<void>((r) => { release = r })
    autosync.setDeps({ volumeOf: async () => VOL, tail: async () => 'k', reconcile: async () => undefined, podName: () => 'p', localRoot: () => shared, parallel: () => 4,
      feed: async (_v, since) => ({ volume_id: VOL, cursor: 'kz', events: since === 'k' ? [{ seq: 'k1', ts: '', writer: 'reconciler', op: 'created', prefix: 'output/a/' } as journal.JournalEvent] : [], more: false }),
      files: async () => [{ path: 'output/a/x.dpx', bytes: 10, modified: 'm' }], stat: async () => null, run: async () => { await gate; return { steps: 1, failed: 0, warned: 0, cancelled: false } } })
    await autosync.tick()
    expect(autosync.status().items[0].state).toBe('syncing')
    const t0 = performance.now(); for (let i = 0; i < 20; i++) { autosync.status(); autosync.get('p1') }; const per = (performance.now() - t0) / 20
    expect(per).toBeLessThan(5)
    release(); await autosync.settle()
    for (const k of ['AUTOSYNC_FILE', 'AUTOSYNC_STATE_FILE', 'AUTOSYNC_MANIFEST_FILE']) delete process.env[k]
  })
})
