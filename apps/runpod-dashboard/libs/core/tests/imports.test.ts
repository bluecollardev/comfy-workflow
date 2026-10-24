import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as im from '../src/imports.js'
import { adaptersDir } from '../src/paths.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch() })

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const put = (root: string, rel: string, text: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }

/** A delivery package in the real shape: <shot>/comfy/{input,workflows}, <shot>/nodes/<pack>-vN, final/approved left alone, a manifest with real hashes. */
function pkg(base: string, opts: { manifest?: boolean; skip?: string[]; extra?: boolean } = {}) {
  const root = join(base, 'brynley-comfy-2026-10-20')
  const files: Record<string, string> = {
    'shotA/comfy/input/shots/shotA/01-look-dev/Approved/ref.png': 'PNG-ref',
    'shotA/comfy/input/shots/shotA/05-outputs/Approved/master/a.mov': 'MOV-final',
    'shotA/comfy/workflows/shotA-graph-v01.json': '{"nodes":[]}',
    'shotA/comfy/workflows/shotA-graph-v01_api.json': '{}',
    'shotA/nodes/ComfyUI-Pack-v1.2/__init__.py': 'x=1',
    'shotA/final/shotA_main_final_v01.mov': 'BIG-FINAL',
    'shotA/approved/take.mp4': 'TAKE',
  }
  const entries = Object.entries(files).map(([path, text]) => ({ path, role: 'x', sha256: sha(text), bytes: text.length }))
  for (const [p, t] of Object.entries(files)) if (!(opts.skip || []).includes(p)) put(root, p, t)
  if (opts.manifest !== false) put(root, 'shotA/MANIFEST.json', JSON.stringify({ shot: 'shotA', graph: 'g', node_types: ['LoadImage', 'FalAPI_x-y', 'OpenAIGPTImageNodeV2'], files: entries }))
  put(root, 'MANIFEST.json', JSON.stringify({ built: '2026-10-20', for: 'Brynley', environment_on_kyles_machine: { comfyui_version: '0.39.2', comfyui_commit: 'abc' }, shots: { shotA: {} } }))
  if (opts.extra) put(root, 'shotA/comfy/input/shots/shotA/stray.txt', 'not in the manifest')
  return root
}

const userAdapter = (id: string, body: string) => { mkdirSync(adaptersDir(), { recursive: true }); writeFileSync(join(adaptersDir(), `${id}.mjs`), body) }
const OK_ADAPTER = (ops = '[]') => `export default { id: 'mine', name: 'Mine', version: 1, async detect() { return { match: 1, evidence: ['x'] } }, async plan() { return { ops: ${ops}, findings: [] } } }`

describe('adapters', () => {
  it('lists the two built-ins, approved, and none of yours until you add them', async () => {
    const rows = await im.list()
    expect(rows.map((r) => r.id)).toEqual(['comfy-shared', 'panama-imax-redux'])
    expect(rows.every((r) => r.builtin && r.approved && !r.error)).toBe(true)
  }, 20000)

  it('does not run yours until approved, runs it once approved, and wants approval again when it changes', async () => {
    const src = join(dir, 'src'); put(src, 'a.txt', 'a')
    userAdapter('mine', OK_ADAPTER())
    expect((await im.list()).find((r) => r.id === 'mine')).toMatchObject({ approved: false, builtin: false })
    await expect(im.plan(src, 'mine')).rejects.toThrow(/not been approved/)
    await im.approve('mine')
    expect((await im.plan(src, 'mine')).adapter.id).toBe('mine')
    userAdapter('mine', OK_ADAPTER() + '\n// edited')
    await expect(im.plan(src, 'mine')).rejects.toThrow(/not been approved/)
  }, 30000)

  it('saves an adapter that parses, unapproved, and refuses one that does not or one named like a built-in', async () => {
    const row = await im.save('mine', OK_ADAPTER())
    expect(row).toMatchObject({ id: 'mine', approved: false })
    await expect(im.save('broken', 'export default {')).rejects.toThrow(/does not parse/)
    await expect(im.save('comfy-shared', OK_ADAPTER())).rejects.toThrow(/built-in/)
    await expect(im.save('Bad Id', OK_ADAPTER())).rejects.toThrow(/lowercase/)
  }, 20000)
})

describe('the delivery package adapter', () => {
  it('is recognised, and a plain ComfyUI-Shared folder is recognised by the other one', async () => {
    const root = pkg(dir)
    expect((await im.detect(root))[0]).toMatchObject({ id: 'panama-imax-redux', match: 1 })
    const shared = join(dir, 'shared'); put(shared, 'input/a.png', '1'); put(shared, 'models/m.bin', '2')
    expect((await im.detect(shared))[0]).toMatchObject({ id: 'comfy-shared', match: 1 })
  }, 30000)

  it('maps input to input/, workflows to workflows/<round>/, packs to node-packs/ without -vN, and leaves the rest', async () => {
    const p = await im.plan(pkg(dir))
    const to = (k: string) => p.ops.filter((o) => o.kind === k && o.op === 'copy').map((o) => o.to).sort()
    expect(to('input')).toEqual(['input/shots/shotA/01-look-dev/Approved/ref.png', 'input/shots/shotA/05-outputs/Approved/master/a.mov'])
    expect(to('workflow')).toEqual(['workflows/brynley-comfy-2026-10-20/shotA-graph-v01.json', 'workflows/brynley-comfy-2026-10-20/shotA-graph-v01_api.json'])
    expect(to('node-pack')).toEqual(['node-packs/ComfyUI-Pack/__init__.py'])
    expect(p.ops.filter((o) => o.op === 'note').map((o) => o.note)).toEqual(expect.arrayContaining(['shotA/final: 1 files left in place', 'shotA/approved: 1 files left in place']))
    expect(p.ops.every((o) => o.op !== 'copy' || /^[0-9a-f]{64}$/.test(o.sha256 || ''))).toBe(true)
    expect(p.summary.copies).toBe(5)
    expect(p.fenced).toBe(im.fenceSupported())
    const text = p.findings.map((f) => f.text).join('\n')
    expect(text).toMatch(/0\.39\.2/); expect(text).toMatch(/FalAPI_\* node types are used and no fal pack/); expect(text).toMatch(/OpenAI partner-API/)
  }, 30000)

  it('works on one part of a package: reports what the manifest lists that is not here, and what is here that it does not list', async () => {
    const p = await im.plan(pkg(dir, { skip: ['shotA/comfy/workflows/shotA-graph-v01_api.json'], extra: true }))
    const text = p.findings.map((f) => `${f.level}: ${f.text}`).join('\n')
    expect(text).toMatch(/info: shotA: 1 files in the manifest are not in this folder/)
    expect(text).toMatch(/warn: shotA: 1 files under comfy\/ or nodes\/ are not in its manifest/)
    expect(p.ops.some((o) => o.to?.endsWith('stray.txt'))).toBe(false)
  }, 30000)

  it('copies into ComfyUI-Shared with paths kept, changes nothing in the source, and a second apply finds everything the same', async () => {
    const root = pkg(dir); const target = join(dir, 'ComfyUI-Shared')
    const before = readdirSync(root, { recursive: true }).sort()
    const p = await im.plan(root)
    const first = await im.apply(p, { target })
    expect(first.ok).toBe(true); expect(first.counts.copied).toBe(5)
    expect(readFileSync(join(target, 'input/shots/shotA/05-outputs/Approved/master/a.mov'), 'utf8')).toBe('MOV-final')
    expect(existsSync(join(target, 'workflows/brynley-comfy-2026-10-20/shotA-graph-v01.json'))).toBe(true)
    expect(existsSync(join(target, 'node-packs/ComfyUI-Pack/__init__.py'))).toBe(true)
    expect(readdirSync(target).sort()).toEqual(['input', 'node-packs', 'workflows'])   // not final/, approved/ or the manifest
    expect(readdirSync(root, { recursive: true }).sort()).toEqual(before)
    expect(first.record && existsSync(first.record)).toBe(true)
    const second = await im.apply(p, { target })
    expect(second.counts).toEqual({ same: 5, noted: 2 })
  }, 30000)

  it('does not replace a different file unless told, and a dry run writes nothing', async () => {
    const root = pkg(dir); const target = join(dir, 'ComfyUI-Shared')
    const p = await im.plan(root)
    const dry = await im.apply(p, { target, dryRun: true })
    expect(dry.counts['would-copy']).toBe(5); expect(dry.record).toBeNull(); expect(readdirSync(target)).toEqual([])
    await im.apply(p, { target })
    put(target, 'input/shots/shotA/01-look-dev/Approved/ref.png', 'MY EDIT')
    const kept = await im.apply(p, { target })
    expect(kept.ok).toBe(false); expect(kept.counts.conflict).toBe(1)
    expect(readFileSync(join(target, 'input/shots/shotA/01-look-dev/Approved/ref.png'), 'utf8')).toBe('MY EDIT')
    const forced = await im.apply(p, { target, overwrite: true })
    expect(forced.counts.replaced).toBe(1)
    expect(readFileSync(join(target, 'input/shots/shotA/01-look-dev/Approved/ref.png'), 'utf8')).toBe('PNG-ref')
  }, 30000)

  it('refuses a file whose bytes differ from its manifest hash, and copies the others', async () => {
    const root = pkg(dir); const target = join(dir, 'ComfyUI-Shared')
    const p = await im.plan(root)
    writeFileSync(join(root, 'shotA/comfy/workflows/shotA-graph-v01.json'), '{"nodes":["tampered"]}')
    const r = await im.apply(p, { target })
    expect(r.ok).toBe(false); expect(r.counts['hash-mismatch']).toBe(1); expect(r.counts.copied).toBe(4)
    expect(existsSync(join(target, 'workflows/brynley-comfy-2026-10-20/shotA-graph-v01.json'))).toBe(false)
  }, 30000)
})

describe('what the app enforces whatever an adapter says', () => {
  const adapterWith = async (ops: string) => { userAdapter('mine', OK_ADAPTER(ops)); await im.approve('mine'); const src = join(dir, 'src'); put(src, 'a.txt', 'a'); return src }

  it.each([
    ["{ op: 'copy', kind: 'input', from: 'a.txt', to: '../escape.txt' }", /leaves its folder/],
    ["{ op: 'copy', kind: 'input', from: 'a.txt', to: '/etc/passwd' }", /not relative/],
    ["{ op: 'copy', kind: 'input', from: '../x', to: 'input/x' }", /leaves its folder/],
    ["{ op: 'copy', kind: 'input', from: 'a.txt', to: 'output/x' }", /outside input/],
    ["{ op: 'delete', kind: 'input', from: 'a.txt' }", /unknown op/],
    ["{ op: 'copy', kind: 'input', from: 'a.txt', to: 'input/a.txt', sha256: 'nope' }", /sha256/],
  ])('rejects a plan with %s', async (op, msg) => {
    const src = await adapterWith(`[${op}]`)
    await expect(im.plan(src, 'mine')).rejects.toThrow(msg)
  }, 30000)

  it('rejects a tampered plan at apply even if it skipped plan()', async () => {
    const src = await adapterWith("[{ op: 'copy', kind: 'input', from: 'a.txt', to: 'input/a.txt' }]")
    const p = await im.plan(src, 'mine')
    p.ops[0].to = '../outside.txt'
    await expect(im.apply(p, { target: join(dir, 'T') })).rejects.toThrow(/leaves its folder/)
  }, 30000)

  it('will not follow a symlink in the source out of it', async () => {
    const src = join(dir, 'src'); put(src, 'ok.txt', 'ok'); put(dir, 'secret/s.txt', 'SECRET')
    symlinkSync(join(dir, 'secret'), join(src, 'link'))
    userAdapter('mine', OK_ADAPTER("[{ op: 'copy', kind: 'input', from: 'link/s.txt', to: 'input/s.txt' }]")); await im.approve('mine')
    const p = await im.plan(src, 'mine')
    const r = await im.apply(p, { target: join(dir, 'T') })
    expect(r.counts.error).toBe(1); expect(existsSync(join(dir, 'T/input/s.txt'))).toBe(false)
  }, 30000)

  it.runIf(im.fenceSupported())('fences an adapter that reads outside its source, writes, or starts a process', async () => {
    put(dir, 'outside/o.txt', 'OUT')
    const evil = (body: string) => `export default { id: 'mine', name: 'x', version: 1, async detect() { return { match: 1 } }, async plan() { ${body}; return { ops: [], findings: [] } } }`
    const src = join(dir, 'src'); put(src, 'a.txt', 'a')
    for (const [body, pre] of [
      [`const fs = await import('node:fs'); fs.readFileSync('${join(dir, 'outside/o.txt')}')`, 'read outside'],
      [`const fs = await import('node:fs'); fs.writeFileSync('${join(src, 'w.txt')}', 'x')`, 'write'],
      [`const cp = await import('node:child_process'); cp.execSync('echo hi')`, 'spawn'],
    ]) {
      userAdapter('mine', evil(body)); await im.approve('mine')
      await expect(im.plan(src, 'mine'), pre).rejects.toThrow(/denied|ERR_ACCESS|restricted|Access/i)
    }
    expect(existsSync(join(src, 'w.txt'))).toBe(false)
  }, 60000)

  it('says when an adapter is broken instead of throwing at the app', async () => {
    userAdapter('mine', `export default { id: 'mine', name: 'x' }`); await im.approve('mine')
    const row = (await im.list()).find((r) => r.id === 'mine')!
    expect(row.approved).toBe(true)
    await expect(im.plan(join(dir), 'mine')).rejects.toThrow(/detect|plan/)
  }, 30000)
})
