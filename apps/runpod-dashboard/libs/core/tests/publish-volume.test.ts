import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import * as publish from '../src/publish.js'
import * as settingsEnv from '../src/settings.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-050 "Publishing from the volume": the picker lists the volume's output/ one level at a time, and a volume item is streamed through this PC. Fakes only.
vi.setConfig({ testTimeout: 15_000 })
const VOLB = 'a3upg9ey48', DEST = 'my-internal-bucket', O = 'comfy-shared/output/'
let dir: string, out: string, vol: Map<string, number>, dest: Map<string, number>, calls: { args: string[]; env: Record<string, string> }[], hang: Set<string>, now: number
let hold = false
let spawned: { args: string[]; env: Record<string, string>; killed: boolean }[]
const write = (rel: string, size = 10) => { const p = join(out, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, Buffer.alloc(size, 1)) }
const row = (k: string, n: number) => `2026-11-18 10:00:00 ${String(n).padStart(10)} ${k}`
const fakeAws: podpull.AwsRunner = async (args, env, o) => {
  calls.push({ args, env })
  if (args[0] === 's3api') {
    const pre = args[args.indexOf('--prefix') + 1]
    if (hang.has(pre)) return new Promise((res) => o?.signal?.addEventListener('abort', () => res({ code: 130, stdout: '', stderr: '' })))
    const keys = [...vol.keys()].filter((k) => k.startsWith(pre)).slice(0, 2); return { code: 0, stdout: JSON.stringify(keys.length ? { Contents: keys.map((Key) => ({ Key })) } : {}), stderr: '' }
  }
  if (args[0] === 's3' && args[1] === 'ls') {
    const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(args[2])!, store = m[1] === VOLB ? vol : dest, pre = m[2], recursive = args.includes('--recursive')
    if (hang.has(pre)) return new Promise((res) => o?.signal?.addEventListener('abort', () => res({ code: 130, stdout: '', stderr: '' })))
    const under = [...store].filter(([k]) => k.startsWith(pre)).sort()
    if (recursive) { const rows = under.map(([k, n]) => row(k, n)); return { code: rows.length ? 0 : 1, stdout: rows.join('\n'), stderr: '' } }
    const pres = new Set<string>(), files: string[] = []
    for (const [k, n] of under) { const r = k.slice(pre.length); if (r.includes('/')) pres.add(`${r.split('/')[0]}/`); else files.push(row(r, n)) }
    return { code: pres.size || files.length ? 0 : 1, stdout: [...[...pres].map((p) => `                           PRE ${p}`), ...files].join('\n'), stderr: '' }
  }
  if (args[0] === 's3' && args[1] === 'cp') { dest.set(args[3].replace(/^s3:\/\/[^/]+\//, ''), 1); return { code: 0, stdout: '', stderr: '' } }
  return { code: 2, stdout: '', stderr: 'unexpected' }
}
const fakeSpawn = (_c: string, args: string[], env: Record<string, string>): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess & { closed?: boolean }, rec = { args, env, killed: false }; spawned.push(rec)
  const so = new PassThrough(), se = new PassThrough(), si = new PassThrough(); Object.assign(c, { stdout: so, stderr: se, stdin: si })
  const close = (code: number | null) => { if (!c.closed) { c.closed = true; c.emit('close', code) } }
  ;(c as unknown as { kill: () => boolean }).kill = () => { rec.killed = true; setImmediate(() => close(null)); return true }
  if (args[3] === '-') { const n = vol.get(args[2].replace(/^s3:\/\/[^/]+\//, '')) ?? 0; setImmediate(() => { if (hold) return; for (let i = 0; i < n; i += 4) so.write(Buffer.alloc(Math.min(4, n - i), 2)); so.end(); setImmediate(() => close(0)) }) }
  else if (args[2] === '-') { si.on('data', () => undefined); si.on('end', () => { dest.set(args[3].replace(/^s3:\/\/[^/]+\//, ''), 1); setImmediate(() => close(0)) }) }
  return c
}
const configure = () => publish.setSettings({ s3: { layout: 'as-is', credentials: 'app', bucket: DEST, prefix: 'returns/BKK', region: 'us-west-2', access_key_id: 'AKIAEXAMPLE12345', secret_access_key: 'secretsecretsecret1234' } })

beforeEach(async () => {
  dir = scratch(); out = join(dir, 'shared', 'output'); mkdirSync(out, { recursive: true }); process.env.SETTINGS_ENV_FILE = join(dir, '.env')
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  hold = false; calls = []; spawned = []; hang = new Set(); now = Date.parse('2026-11-19T10:00:00Z'); dest = new Map()
  vol = new Map([[`${O}delivery_v007/clipA.mov`, 400], [`${O}delivery_v007/sub/clipB.mov`, 100], [`${O}delivery_v007/DELIVERY.md`, 20], [`${O}lores_v003/a.mp4`, 7], [`${O}empty_shell/`, 0], [`${O}weights/m.safetensors`, 9], [`${O}top.mov`, 5], [`${O}proxy/b.dpx`, 3]])
  publish.reset(); publish.setDeps({ aws: fakeAws, outputRoot: () => out, parallel: () => 8, spawn: fakeSpawn, now: () => now, volumeId: () => 'vol1',
    volumeAccess: async () => ({ ok: true, id: 'RPKEY', secret: 'RPSECRET', endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: VOLB, region: 'EU-RO-1' }) })
  await configure()
})
afterEach(() => { publish.reset(); for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k] })

describe('publish.volume(): one level of the volume output/', () => {
  it('lists folders and files of ONE level (never recursive), with the empty flag from a probe and no folder sizes', async () => {
    const v = await publish.volume()
    expect(v.dir).toBe(''); expect(v.parent).toBe(''); expect(v.entries.map((e) => [e.name, e.dir])).toEqual([['delivery_v007', true], ['empty_shell', true], ['lores_v003', true], ['proxy', true], ['weights', true], ['top.mov', false]])
    expect(v.entries.find((e) => e.name === 'delivery_v007')).toMatchObject({ path: 'delivery_v007', bytes: null, empty: false, weight: false }); expect(v.entries.find((e) => e.name === 'empty_shell')!.empty).toBe(true)
    expect(v.entries.find((e) => e.name === 'top.mov')).toMatchObject({ bytes: 5, dir: false, modified: '2026-11-18T10:00:00Z' }); expect(v.entries.find((e) => e.name === 'top.mov')!.empty).toBeUndefined()
    const ls = calls.filter((c) => c.args[1] === 'ls'); expect(ls).toHaveLength(1); expect(ls[0].args).toEqual(['s3', 'ls', `s3://${VOLB}/${O}`, '--endpoint-url', 'https://s3api-eu-ro-1.runpod.io', '--region', 'EU-RO-1']); expect(ls[0].args).not.toContain('--recursive')
    expect(calls.filter((c) => c.args[0] === 's3api')).toHaveLength(5); expect(calls.find((c) => c.args[0] === 's3api')!.args).toContain('--max-keys')
    expect(calls.some((c) => /\b(cp|rm|mv|sync)\b/.test(c.args.slice(0, 2).join(' ')))).toBe(false)
  })
  it('a folder level: path and parent, weights flagged; .. and absolute paths are refused; no volume is a 409', async () => {
    const sub = await publish.volume({ dir: 'delivery_v007' }); expect(sub.parent).toBe(''); expect(sub.entries.map((e) => e.path)).toEqual(['delivery_v007/sub', 'delivery_v007/DELIVERY.md', 'delivery_v007/clipA.mov'].sort((a, b) => (a === 'delivery_v007/sub' ? -1 : b === 'delivery_v007/sub' ? 1 : a.localeCompare(b))))
    expect((await publish.volume({ dir: 'weights' })).entries[0]).toMatchObject({ name: 'm.safetensors', weight: true }); expect((await publish.volume({ dir: 'delivery_v007/sub' })).parent).toBe('delivery_v007')
    await expect(publish.volume({ dir: '../x' })).rejects.toMatchObject({ status: 400 }); await expect(publish.volume({ dir: '/etc' })).rejects.toMatchObject({ status: 400 })
    publish.setDeps({ volumeId: () => '' }); await expect(publish.volume()).rejects.toMatchObject({ status: 409 })
  })
  it('caps at 2000 entries and says how many more', async () => {
    for (let i = 0; i < 2100; i++) vol.set(`${O}many/f${String(i).padStart(4, '0')}.txt`, 1)
    const v = await publish.volume({ dir: 'many' }); expect(v.entries).toHaveLength(2000); expect(v.truncated).toBe(100)
  })
  it('the empty probe: a probe that errors or times out (3 s) leaves `empty` undefined for that folder only', async () => {
    hang.add(`${O}lores_v003/`)
    const v = await publish.volume(); expect(v.entries.find((e) => e.name === 'lores_v003')!.empty).toBeUndefined(); expect(v.entries.find((e) => e.name === 'empty_shell')!.empty).toBe(true); expect(v.entries.find((e) => e.name === 'proxy')!.empty).toBe(false)
    publish.setDeps({ aws: async (a, e, o) => (a[0] === 's3api' ? { code: 255, stdout: '', stderr: 'boom' } : fakeAws(a, e, o)) }); expect((await publish.volume()).entries.every((e) => e.empty === undefined)).toBe(true)
  })
})

describe('publish.volumeSize()', () => {
  it('counts files and bytes under a folder with a recursive listing, cached for 5 minutes', async () => {
    expect(await publish.volumeSize({ path: 'delivery_v007' })).toEqual({ files: 3, bytes: 520 }); expect(calls.filter((c) => c.args[1] === 'ls')).toHaveLength(1); expect(calls[0].args).toContain('--recursive')
    expect(await publish.volumeSize({ path: 'delivery_v007' })).toMatchObject({ files: 3, cached: true }); expect(calls.filter((c) => c.args[1] === 'ls')).toHaveLength(1)
    now += 5 * 60_000 + 1; expect((await publish.volumeSize({ path: 'delivery_v007' })).cached).toBeUndefined(); expect(calls.filter((c) => c.args[1] === 'ls')).toHaveLength(2)
    await expect(publish.volumeSize({ path: '' })).rejects.toMatchObject({ status: 400 }); await expect(publish.volumeSize({ path: '../x' })).rejects.toMatchObject({ status: 400 })
  })
  it('is abortable', async () => {
    hang.add(`${O}proxy/`); const p = publish.volumeSize({ path: 'proxy' }); await new Promise((r) => setTimeout(r, 20)); expect(publish.volumeSizeCancel({ path: 'proxy' })).toEqual({ cancelled: true })
    await expect(p).rejects.toMatchObject({ status: 499 }); expect(publish.volumeSizeCancel({ path: 'proxy' })).toEqual({ cancelled: false })
  })
})

describe('plan and run with volume items', () => {
  it('keys keep the relative path under the prefix; streamed counts; same-size objects are skipped; weights refused; a missing path says so', async () => {
    dest.set('returns/BKK/delivery_v007/DELIVERY.md', 20); dest.set('returns/BKK/delivery_v007/clipA.mov', 399)   // same size, different size
    const p = await publish.plan({ items: [{ where: 'volume', path: 'delivery_v007' }, { where: 'volume', path: 'top.mov' }, { where: 'volume', path: 'nope' }], targets: ['s3'] })
    expect(p.ok).toBe(true); expect(p.items.map((i) => [i.s3_key, i.skip, i.source])).toEqual([['returns/BKK/delivery_v007/DELIVERY.md', 'same size already there', 'volume'], ['returns/BKK/delivery_v007/clipA.mov', null, 'volume'], ['returns/BKK/delivery_v007/sub/clipB.mov', null, 'volume'], ['returns/BKK/top.mov', null, 'volume'], ['returns/BKK/nope', 'missing', 'volume']])
    expect(p.streamed_files).toBe(3); expect(p.streamed_bytes).toBe(505); expect(p.s3).toEqual({ dest: `s3://${DEST}/returns/BKK/`, count: 3, new_bytes: 505 }); expect(p.items.find((i) => i.path === 'top.mov')!.source_key).toBe(`${O}top.mov`)
    const w = await publish.plan({ items: [{ where: 'volume', path: 'weights' }], targets: ['s3'] }); expect(w.ok).toBe(false); expect(w.refused[0]).toMatchObject({ path: 'weights/m.safetensors', reason: expect.stringMatching(/weights/) })
    const bad = await publish.plan({ items: [{ where: 'volume', path: '../x' }, { where: 'disk', path: 'a' } as never, 5 as never, { where: 'volume', path: 'top.mov' }], targets: ['s3'] }); expect(bad.refused).toHaveLength(3)
  })
  it('a volume-only plan needs no local output folder; an unreadable volume is a blocker', async () => {
    publish.setDeps({ outputRoot: () => null }); expect((await publish.plan({ items: [{ where: 'volume', path: 'top.mov' }], targets: ['s3'] })).ok).toBe(true)
    publish.setDeps({ volumeAccess: async () => ({ ok: false, reason: 'no S3 keys' }) }); expect((await publish.plan({ items: [{ where: 'volume', path: 'top.mov' }], targets: ['s3'] })).blockers.join()).toMatch(/volume cannot be read: no S3 keys/)
  })
  it('run streams volume files through two piped aws commands (--expected-size, no temp file), mixed with a local file; a few at a time; needs the approver', async () => {
    write('local/a.mov', 12)
    const items = [{ where: 'volume' as const, path: 'delivery_v007' }, 'local/a.mov']
    await expect(publish.run({ items, targets: ['s3'] })).rejects.toMatchObject({ status: 400 })
    const { job_id } = await publish.run({ items, targets: ['s3'], approved_by: 'Lucas' }); await publish.settled(); const j = publish.status(job_id).jobs[0]
    expect(j).toMatchObject({ state: 'done', files_total: 4, files_done: 4, approved_by: 'Lucas' })
    expect(calls.filter((c) => c.args[1] === 'cp')).toHaveLength(1); expect(calls.find((c) => c.args[1] === 'cp')!.args[3]).toBe(`s3://${DEST}/returns/BKK/local/a.mov`)
    const down = spawned.filter((s) => s.args[3] === '-'), up = spawned.filter((s) => s.args[2] === '-')
    expect(down).toHaveLength(3); expect(up).toHaveLength(3); expect(down[0].args.slice(0, 2)).toEqual(['s3', 'cp']); expect(down[0].args[2]).toMatch(new RegExp(`^s3://${VOLB}/${O}delivery_v007/`)); expect(down[0].env).toMatchObject({ AWS_ACCESS_KEY_ID: 'RPKEY' })
    const clipA = up.find((u) => u.args[3].endsWith('delivery_v007/clipA.mov'))!; expect(clipA.args).toEqual(expect.arrayContaining(['--expected-size', '400', '--region', 'us-west-2'])); expect(clipA.env).toMatchObject({ AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE12345' })
    expect(dest.has('returns/BKK/delivery_v007/sub/clipB.mov')).toBe(true); expect(spawned.some((s) => s.args.some((a) => /\.part|\/tmp/.test(a)))).toBe(false)
  })
  it('streams at most 3 at a time, whatever sync_parallel says', async () => {
    for (let i = 0; i < 9; i++) vol.set(`${O}many/f${i}.mov`, 8)
    let live = 0, max = 0
    publish.setDeps({ spawn: (c, a, e) => { const ch = fakeSpawn(c, a, e); if (a[3] === '-') { live++; max = Math.max(max, live); ch.on('close', () => live--) } return ch } })
    const { job_id } = await publish.run({ items: [{ where: 'volume', path: 'many' }], targets: ['s3'], approved_by: 'L' }); await publish.settled()
    expect(publish.status(job_id).jobs[0].state).toBe('done'); expect(max).toBeGreaterThan(1); expect(max).toBeLessThanOrEqual(3)
  })
  it('a same-size object already at the destination is not streamed again; weights stop a run', async () => {
    dest.set('returns/BKK/top.mov', 5); const { job_id } = await publish.run({ items: [{ where: 'volume', path: 'top.mov' }, { where: 'volume', path: 'lores_v003' }], targets: ['s3'], approved_by: 'L' }); await publish.settled()
    expect(publish.status(job_id).jobs[0]).toMatchObject({ state: 'done', files_total: 1, skipped: 1 }); expect(spawned.filter((s) => s.args[3] === '-')).toHaveLength(1)
    await expect(publish.run({ items: [{ where: 'volume', path: 'weights' }], targets: ['s3'], approved_by: 'L' })).rejects.toThrow(/weights/)
  })
  it('cancel kills both ends of a stream', async () => {
    hold = true
    const { job_id } = await publish.run({ items: [{ where: 'volume', path: 'top.mov' }], targets: ['s3'], approved_by: 'L' }); await new Promise((r) => setTimeout(r, 40)); publish.cancel(job_id); await publish.settled()
    expect(publish.status(job_id).jobs[0].state).toBe('cancelled'); expect(spawned.filter((s) => s.killed).length).toBe(2)
  })
})

describe('async rule', () => { it('the new volume code adds no synchronous file or process calls', async () => { const t = (await import('node:fs')).readFileSync(join(import.meta.dirname, '..', 'src', 'publish.ts'), 'utf8'); expect(t.replace(/\/\*[\s\S]*?\*\//g, '').match(/\b(spawnSync|execSync|readFileSync|writeFileSync|statSync|readdirSync)\b/g) ?? []).toEqual([]) }) })
