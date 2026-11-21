import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import * as layout from '../src/publishlayout.js'
import * as publish from '../src/publish.js'
import * as manifestcheck from '../src/manifestcheck.js'
import * as settingsEnv from '../src/settings.js'
import * as edl from '../src/edl.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-055 section 14: manifest_check and manifest_rebuild over a fake bucket. Fakes only: no real bucket, no pod.
const BUCKET = 'my-internal-bucket', PFX = 'returns/BKK/', ROUND = 'qc_2026-11-21_r01', ROOT = `${PFX}${ROUND}/`, RM = `${ROOT}RETURN-MANIFEST.json`
let objs: Map<string, string>, puts: string[]
const fakeAws: podpull.AwsRunner = async (args) => {
  if (args[1] === 'ls') { const pre = /^s3:\/\/[^/]+\/(.*)$/.exec(args[2])![1], rows = [...objs].filter(([k]) => k.startsWith(pre)).map(([k, v]) => `2026-11-21 10:00:00 ${v.length} ${k}`); return { code: rows.length ? 0 : 1, stdout: rows.join('\n'), stderr: '' } }
  if (args[1] === 'cp' && args[3] === '-') { const k = args[2].replace(/^s3:\/\/[^/]+\//, ''); return objs.has(k) ? { code: 0, stdout: objs.get(k)!, stderr: '' } : { code: 1, stdout: '', stderr: 'An error occurred (404) when calling the HeadObject operation: Not Found' } }
  return { code: 2, stdout: '', stderr: 'unexpected' }
}
const fakeSpawn = (_c: string, args: string[]): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess, so = new PassThrough(), se = new PassThrough(), si = new PassThrough(); Object.assign(c, { stdout: so, stderr: se, stdin: si, kill: () => true })
  let body = ''; si.on('data', (d) => { body += String(d) }); si.on('end', () => { const k = args[3].replace(/^s3:\/\/[^/]+\//, ''); objs.set(k, body); puts.push(k); setImmediate(() => c.emit('close', 0)) })
  return c
}
const NOW = Date.parse('2026-11-21T12:34:56Z'), POD = { provider: 'runpod', pod_id: 'abc', gpu: 'x', hours: 1, cost_usd: 1, paid_by: 'BH', provider_api_calls: 1 }
const item = (shot: string, element: string, n = 2): layout.ManifestItem => {
  const clip = `${shot.toUpperCase()}_${element}_FINAL_V01`
  return { shot, element, input_final: { delivered_name: clip, sha256: 'd' }, graph: { name: 'n/a', sha256: 'n/a', returned_path: 'n/a' },
    outputs: Array.from({ length: n }, (_, i) => ({ path: `${shot}/${clip}/${clip}.${String(i + 1).padStart(4, '0')}.dpx`, role: 'dpx' as const, sha256: `s${i}`, bytes: 10 })), measures: { kind: 'FINAL delivery', frames: n, notes: '' } }
}
const addElement = (it: layout.ManifestItem, o: { files?: boolean; manifest?: boolean; issues?: boolean } = {}) => {
  if (o.files !== false) for (const out of it.outputs) objs.set(`${ROOT}${out.path}`, 'x'.repeat(out.bytes))
  if (o.manifest !== false) objs.set(`${ROOT}${it.shot}/${it.input_final.delivered_name}_MANIFEST.json`, JSON.stringify({ schema_version: 'bh-return-1', round: ROUND, returned_by: 'Lucas', returned_at: 'x', pod: POD, item: it, ...(o.issues === false ? {} : { issues: [] }) }))
}
const putReturn = (items: layout.ManifestItem[]) => objs.set(RM, `${JSON.stringify({ schema_version: 'bh-return-1', round: ROUND, returned_by: 'Binc', returned_at: '2026-11-20T00:00:00+07:00', pod: POD, items }, null, 2)}\n`)
const ret = () => JSON.parse(objs.get(RM)!) as layout.Manifest

beforeEach(async () => {
  const dir = scratch(); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  objs = new Map(); puts = []; edl.reset(); publish.reset()
  publish.setDeps({ aws: fakeAws, spawn: fakeSpawn, now: () => NOW, podInfo: async () => null })
  await publish.setSettings({ s3: { credentials: 'app', bucket: BUCKET, region: 'us-west-2', access_key_id: 'AKIAEXAMPLEKEY1234', secret_access_key: 'secretsecretsecret1234' } })
})
afterEach(() => { publish.reset(); edl.reset() })

describe('manifest_check', () => {
  it('a clean round checks clean', async () => {
    const a = item('archival-077', 'A'), b = item('cgi-042', 'MAIN'); addElement(a); addElement(b); putReturn([a, b])
    const r = await manifestcheck.check({ round: ROUND })
    expect(r.summary).toMatchObject({ elements: 2, clean: 2, with_findings: 0, errors: 0, warnings: 0, return_items: 2, element_manifests: 2, stale_items: 0, bundled_items: 0 })
    expect(r.return_manifest).toBe('ok'); expect(r.round_findings).toEqual([])
  })
  it('reports a bundled item, a missing element manifest, a missing file, a size difference, no sha256 and no issues section; writes nothing', async () => {
    const a = item('archival-077', 'A'), c = item('archival-077', 'C'); a.outputs[0].sha256 = 'n/a'
    addElement(a, { issues: false }); addElement(c); objs.delete(`${ROOT}${c.outputs[1].path}`); objs.set(`${ROOT}${c.outputs[0].path}`, 'xxxxxxxx')
    addElement(item('photoreal-013', 'TOP'), { manifest: false })   // frames, no element manifest
    putReturn([a, c, item('archival-077', 'main')])
    const r = await manifestcheck.check({ round: ROUND }), codes = (x: { code: string }[]) => x.map((y) => y.code).sort()
    expect(codes(r.elements.find((e) => e.element === 'A')!.findings)).toEqual(['no-issues-section', 'no-sha256'])
    expect(codes(r.elements.find((e) => e.element === 'C')!.findings)).toEqual(['file-missing', 'file-size-differs'])
    expect(codes(r.round_findings)).toEqual(expect.arrayContaining(['bundled-item', 'no-element-manifest']))
    expect(r.summary).toMatchObject({ bundled_items: 1, missing_element_manifests: 1, stale_items: 0 })
    expect(puts).toEqual([])
  })
  it('an item with no element manifest (not main) is stale', async () => {
    const a = item('archival-077', 'A'); addElement(a); putReturn([a, item('cgi-042', 'MAIN')])
    expect((await manifestcheck.check({ round: ROUND })).summary.stale_items).toBe(1)
  })
})

describe('manifest_rebuild', () => {
  const ok = { round: ROUND, approved_by: 'Lucas', understood: true }
  it('a stale bundled item is rebuilt to one item per element; the backup is written; returned_by and pod are kept; a second run is a no-op', async () => {
    const a = item('archival-077', 'A'), c = item('archival-077', 'C'); addElement(a); addElement(c)
    putReturn([item('archival-077', 'main'), item('archival-077', 'main'), a])
    const before = objs.get(RM)!
    const p = await manifestcheck.plan({ round: ROUND })
    expect(p).toMatchObject({ write: true, before_items: 3, after_items: 2, add: ['archival-077/C'], remove: ['archival-077/main', 'archival-077/main'], blockers: [] })
    expect(objs.get(RM)).toBe(before); expect(puts).toEqual([])
    const r = await manifestcheck.run(ok)
    expect(r).toMatchObject({ written: true, items: 2, verified: true, backup: `${ROOT}RETURN-MANIFEST.backup-20261121T123456Z.json` })
    expect(objs.get(r.backup!)).toBe(before)
    const m = ret(); expect(m.items.map((i) => `${i.shot}/${i.element}`)).toEqual(['archival-077/A', 'archival-077/C'])
    expect(Object.keys(m)).toEqual(['schema_version', 'round', 'returned_by', 'returned_at', 'pod', 'items']); expect(m.returned_by).toBe('Binc'); expect(m.pod).toEqual(POD); expect(m.returned_at).toMatch(/^2026-11-21T/)
    const n = puts.length, again = await manifestcheck.run(ok)
    expect(again).toMatchObject({ written: false, backup: null, verified: true }); expect(puts.length).toBe(n)
    expect((await manifestcheck.check({ round: ROUND })).summary).toMatchObject({ errors: 0, stale_items: 0, bundled_items: 0 })
  })
  it('a missing element manifest is reported, not guessed: no item is made for it', async () => {
    const a = item('archival-077', 'A'); addElement(a); addElement(item('photoreal-013', 'TOP'), { manifest: false }); putReturn([a])
    await manifestcheck.run(ok); expect(ret().items.map((i) => i.element)).toEqual(['A'])
    expect((await manifestcheck.check({ round: ROUND })).round_findings.some((f) => f.code === 'no-element-manifest')).toBe(true)
  })
  it('a file listed but absent stops the rebuild and nothing is written', async () => {
    const a = item('archival-077', 'A'); addElement(a); objs.delete(`${ROOT}${a.outputs[1].path}`); putReturn([item('archival-077', 'main')]); const before = objs.get(RM)
    expect((await manifestcheck.plan({ round: ROUND })).blockers.join(' ')).toMatch(/not in the bucket/)
    await expect(manifestcheck.run(ok)).rejects.toThrow(/not in the bucket/); expect(puts).toEqual([]); expect(objs.get(RM)).toBe(before)
  })
  it('an unreadable element manifest stops it too', async () => {
    const a = item('archival-077', 'A'); addElement(a); objs.set(`${ROOT}cgi-042/CGI-042_MAIN_FINAL_V01_MANIFEST.json`, '{nope'); putReturn([a])
    await expect(manifestcheck.run(ok)).rejects.toThrow(/cannot be read/); expect(puts).toEqual([])
  })
  it('needs approved_by and understood', async () => {
    const a = item('archival-077', 'A'); addElement(a); putReturn([item('archival-077', 'main')])
    await expect(manifestcheck.run({ round: ROUND, understood: true })).rejects.toThrow(/approved_by/)
    await expect(manifestcheck.run({ round: ROUND, approved_by: 'Lucas' })).rejects.toThrow(/understood/)
    expect((await publish.roundIo(ROUND)).publishing()).toBe(false)
  })
})
