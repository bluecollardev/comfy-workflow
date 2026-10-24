import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
function pkg(base: string, opts: { manifest?: boolean; skip?: string[]; extra?: boolean; folder?: string } = {}) {
  const root = join(base, opts.folder || 'brynley-comfy-2026-10-20')
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
  it('lists the two built-ins, with their code hash, and none of yours until you add them', async () => {
    const rows = await im.list()
    expect(rows.map((r) => r.id)).toEqual(['comfy-shared', 'panama-imax-redux'])
    expect(rows.every((r) => r.builtin && !r.error && /^[0-9a-f]{64}$/.test(r.sha256))).toBe(true)
  }, 20000)

  it('runs yours as soon as it is saved (no approval step), always fenced, and picks up an edit on the next call', async () => {
    const src = join(dir, 'src'); put(src, 'a.txt', 'a')
    userAdapter('mine', OK_ADAPTER())
    expect((await im.list()).find((r) => r.id === 'mine')).toMatchObject({ builtin: false, name: 'Mine' })
    expect((await im.plan(src, 'mine')).fenced).toBe(im.fenceSupported())
    userAdapter('mine', OK_ADAPTER("[{ op: 'note', kind: 'reference', from: 'a.txt', note: 'edited' }]"))
    expect((await im.plan(src, 'mine')).ops[0].note).toBe('edited')   // hot-loaded: the file on disk is what runs
  }, 30000)

  it('saves an adapter that parses, and refuses one that does not or one named like a built-in', async () => {
    const row = await im.save('mine', OK_ADAPTER())
    expect(row).toMatchObject({ id: 'mine', builtin: false })
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
    expect(to('workflow')).toEqual(['workflows/panama-imax-redux/brynley-comfy-2026-10-20/shotA-graph-v01.json', 'workflows/panama-imax-redux/brynley-comfy-2026-10-20/shotA-graph-v01_api.json'])
    expect(to('node-pack')).toEqual(['node-packs/panama-imax-redux/ComfyUI-Pack/__init__.py'])
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

  it('recognises a Drive part that came without any manifest, and files its workflows under the round, not under the part\'s " 2"', async () => {
    const part = pkg(dir, { manifest: false, folder: 'brynley-comfy-2026-10-20 2' })
    rmSync(join(part, 'MANIFEST.json'))
    expect((await im.detect(part))[0]).toMatchObject({ id: 'panama-imax-redux', match: 1 })
    const p = await im.plan(part)
    expect(p.ops.filter((o) => o.kind === 'workflow').every((o) => o.to!.startsWith('workflows/panama-imax-redux/brynley-comfy-2026-10-20/'))).toBe(true)
    expect(p.ops.filter((o) => o.op === 'copy').every((o) => o.sha256 === undefined)).toBe(true)   // no manifest here, so nothing to check against
    expect(p.findings.map((f) => f.text).join('\n')).toMatch(/no MANIFEST.json, so no hashes/)
  }, 30000)

  it('copies into ComfyUI-Shared with paths kept, changes nothing in the source, and a second apply finds everything the same', async () => {
    const root = pkg(dir); const target = join(dir, 'ComfyUI-Shared')
    const before = readdirSync(root, { recursive: true }).sort()
    const p = await im.plan(root)
    const first = await im.apply(p, { target })
    expect(first.ok).toBe(true); expect(first.counts.copied).toBe(5)
    expect(readFileSync(join(target, 'input/shots/shotA/05-outputs/Approved/master/a.mov'), 'utf8')).toBe('MOV-final')
    expect(existsSync(join(target, 'workflows/panama-imax-redux/brynley-comfy-2026-10-20/shotA-graph-v01.json'))).toBe(true)
    expect(existsSync(join(target, 'node-packs/panama-imax-redux/ComfyUI-Pack/__init__.py'))).toBe(true)
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
    expect(existsSync(join(target, 'workflows/panama-imax-redux/brynley-comfy-2026-10-20/shotA-graph-v01.json'))).toBe(false)
  }, 30000)
})

describe('what the app enforces whatever an adapter says', () => {
  const adapterWith = async (ops: string) => { userAdapter('mine', OK_ADAPTER(ops)); const src = join(dir, 'src'); put(src, 'a.txt', 'a'); return src }

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
    userAdapter('mine', OK_ADAPTER("[{ op: 'copy', kind: 'input', from: 'link/s.txt', to: 'input/s.txt' }]"))
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
      userAdapter('mine', evil(body))
      await expect(im.plan(src, 'mine'), pre).rejects.toThrow(/denied|ERR_ACCESS|restricted|Access/i)
    }
    expect(existsSync(join(src, 'w.txt'))).toBe(false)
  }, 60000)

  it('says when an adapter is broken instead of throwing at the app', async () => {
    userAdapter('mine', `export default { id: 'mine', name: 'x' }`)
    const row = (await im.list()).find((r) => r.id === 'mine')!
    await expect(im.plan(join(dir), 'mine')).rejects.toThrow(/detect|plan/)
  }, 30000)
})

describe('writing an adapter with Claude', () => {
  const reply = (code: string) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Here you go:\n```javascript\n' + code + '\n```' }] }) }) as unknown as Response
  beforeEach(() => { process.env.SETTINGS_ENV_FILE = join(dir, '.env'); delete process.env.ANTHROPIC_API_KEY })

  it('needs the Anthropic key from Settings, and says where to set it', async () => {
    await expect(im.draft(pkg(dir))).rejects.toThrow(/No Anthropic API key/)
  }, 20000)

  it('previews exactly what would be sent: folder counts, a name sample and small text files, never file contents', () => {
    const p = im.draftPreview(pkg(dir))
    expect(p.total_files).toBeGreaterThan(5)
    expect(p.dirs.map((d) => d.path)).toEqual(expect.arrayContaining(['shotA', 'shotA/comfy', 'shotA/comfy/input']))
    expect(p.texts.map((t) => t.path)).toContain('MANIFEST.json')
    expect(JSON.stringify(p)).not.toContain('MOV-final')   // the media files' bytes are not in it
  })

  it('sends the key, the spec, the listing and the manifest to the API, saves the reply', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-TESTTESTTESTTESTTEST'
    let seen: { url: string; headers: Record<string, string>; body: { model: string; messages: { content: string }[] } } | null = null
    const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => { seen = { url, headers: init.headers, body: JSON.parse(init.body) }; return reply(OK_ADAPTER()) }) as unknown as typeof fetch
    const r = await im.draft(pkg(dir), { fetchImpl })
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages')
    expect(seen!.headers['x-api-key']).toBe('sk-ant-api03-TESTTESTTESTTESTTEST')
    const sent = seen!.body.messages[0].content
    expect(sent).toContain('# Import adapters'); expect(sent).toContain('shotA/comfy/input'); expect(sent).toContain('"for":"Brynley"')
    expect(sent).not.toContain('MOV-final'); expect(sent).not.toContain('BIG-FINAL')
    expect(r.adapter).toMatchObject({ id: 'draft-brynley-comfy-2026-10-20', builtin: false })
    expect(existsSync(join(adaptersDir(), 'draft-brynley-comfy-2026-10-20.mjs'))).toBe(true)   // listed, its code open to read
  }, 30000)

  it('reports an API error and a reply with no module', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-TESTTESTTESTTESTTEST'
    const root = pkg(dir)
    const fail = (async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) })) as unknown as typeof fetch
    await expect(im.draft(root, { fetchImpl: fail })).rejects.toThrow(/Anthropic answered 401: invalid x-api-key/)
    const prose = (async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'I cannot do that.' }] }) })) as unknown as typeof fetch
    await expect(im.draft(root, { fetchImpl: prose })).rejects.toThrow(/did not contain an adapter module/)
  }, 30000)

  it('describes the shot pack: the prompt, the folder material and the key go to the API; the reply is the description', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-TESTTESTTESTTESTTEST'
    let seen: { headers: Record<string, string>; body: { system: string; max_tokens: number; messages: { content: string }[] } } | null = null
    const fetchImpl = (async (_url: string, init: { headers: Record<string, string>; body: string }) => { seen = { headers: init.headers, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '  A first test round of one shot for Brynley.  ' }] }) } }) as unknown as typeof fetch
    const r = await im.describe(pkg(dir), { fetchImpl })
    expect(r.description).toBe('A first test round of one shot for Brynley.')
    expect(r.sent.texts.sort()).toEqual(['MANIFEST.json', 'shotA/MANIFEST.json']); expect(r.sent.files).toBeGreaterThan(5)
    expect(seen!.body.system).toBe(im.DESCRIBE_SYSTEM); expect(seen!.body.system).toMatch(/shot packs/); expect(seen!.body.system).toMatch(/do not guess/)
    expect(seen!.body.max_tokens).toBeLessThan(1000)
    expect(seen!.body.messages[0].content).toContain('shotA/comfy/input'); expect(seen!.body.messages[0].content).toContain('"for":"Brynley"')
    expect(seen!.body.messages[0].content).not.toContain('MOV-final'); expect(seen!.body.messages[0].content).not.toContain('# The adapter spec')   // not the adapter prompt
    expect(seen!.headers['x-api-key']).toBe('sk-ant-api03-TESTTESTTESTTESTTEST')
  }, 30000)

  it('describe needs the key, passes the API\'s error through, and refuses an empty reply', async () => {
    const root = pkg(dir)
    await expect(im.describe(root)).rejects.toThrow(/No Anthropic API key/)
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-TESTTESTTESTTESTTEST'
    const down = (async () => ({ ok: false, status: 529, json: async () => ({ error: { message: 'Overloaded' } }) })) as unknown as typeof fetch
    await expect(im.describe(root, { fetchImpl: down })).rejects.toThrow(/Anthropic answered 529: Overloaded/)
    const empty = (async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '  ' }] }) })) as unknown as typeof fetch
    await expect(im.describe(root, { fetchImpl: empty })).rejects.toThrow(/no description/)
  }, 30000)

  it('validateSource names what is wrong with an adapter without running it', () => {
    expect(im.validateSource(OK_ADAPTER(), 'mine')).toEqual([])
    expect(im.validateSource('export default { id: "x" }')).toEqual(expect.arrayContaining([expect.stringContaining('name'), expect.stringContaining('detect'), expect.stringContaining('plan')]))
    expect(im.validateSource(OK_ADAPTER(), 'other')).toEqual([expect.stringContaining('must be "other"')])
    expect(im.validateSource('const a = 1')).toEqual(expect.arrayContaining([expect.stringContaining('export default')]))
    const evil = OK_ADAPTER().replace('export default', "import fs from 'node:fs'\nexport default") + '\nfetch("http://x"); process.env'
    expect(im.validateSource(evil, 'mine')).toEqual(expect.arrayContaining([expect.stringContaining('imports a Node module'), expect.stringContaining('fetch()'), expect.stringContaining('process')]))
  })

  it('drafts again from the person\'s prompt and the last errors: the first draft, the previous source and the errors go back to Claude, same id', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-TESTTESTTESTTESTTEST'
    const root = pkg(dir)
    const bodies: string[] = []
    const replies = [OK_ADAPTER().replace("id: 'mine'", "id: 'wrong-id'"), OK_ADAPTER().replace("id: 'mine'", "id: 'draft-x'")]
    const fetchImpl = (async (_u: string, init: { body: string }) => { bodies.push(JSON.parse(init.body).messages[0].content); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '```javascript\n' + replies.shift() + '\n```' }] }) } }) as unknown as typeof fetch
    const first = await im.draft(root, { id: 'draft-x', instruction: 'the graphs are under comfy/workflows', fetchImpl })
    expect(first.valid).toBe(false); expect(first.errors).toEqual([expect.stringContaining('must be "draft-x"')])
    expect(first.adapter).toMatchObject({ id: 'draft-x', builtin: false })
    expect(bodies[0]).toContain('the graphs are under comfy/workflows'); expect(bodies[0]).not.toContain('The draft you wrote last time')
    const second = await im.draft(root, { id: 'draft-x', instruction: 'use the id I gave', errors: first.errors, fetchImpl })
    expect(second.valid).toBe(true); expect(second.errors).toEqual([])
    expect(bodies[1]).toContain('The draft you wrote last time'); expect(bodies[1]).toContain("id: 'wrong-id'"); expect(bodies[1]).toContain('must be "draft-x"'); expect(bodies[1]).toContain('use the id I gave')
    expect(readFileSync(join(adaptersDir(), 'draft-x.mjs'), 'utf8')).toContain("id: 'draft-x'")   // the same file, rewritten
  }, 30000)
})

describe('syncing after an import', () => {
  const withVolume = (id: string) => writeFileSync(join(dir, 'mounts.json'), JSON.stringify({ network_volume_id: id, folders: { 'comfy-shared': join(dir, 'shared') } }))
  beforeEach(() => { process.env.MOUNTS_FILE = join(dir, 'mounts.json'); delete process.env.RUNPOD_DRY_RUN })

  it('syncs the shared folder to a real pod when the volume is set', () => {
    withVolume('vol1')
    expect(im.syncAfter('pod-abc')).toEqual({ action: 'sync', request: { pod_id: 'pod-abc', direction: 'push', only: ['comfy-shared'], skip_renders: true } })
  })
  it('says to configure when there is no network volume', () => {
    withVolume('')
    expect(im.syncAfter('pod-abc')).toEqual({ action: 'skip', why: 'no-volume', configure: true })
  })
  it('skips a simulated pod, and the no-spend mode, without asking for configuration', () => {
    withVolume('vol1')
    expect(im.syncAfter('dry-000140s1')).toEqual({ action: 'skip', why: 'simulated', configure: false })
    process.env.RUNPOD_DRY_RUN = '1'
    expect(im.syncAfter('pod-abc')).toEqual({ action: 'skip', why: 'simulated', configure: false })
  })
  it('skips when there is no pod', () => {
    withVolume('vol1')
    expect(im.syncAfter(null)).toEqual({ action: 'skip', why: 'no-pod', configure: false })
  })
})

describe('managing your adapters', () => {
  it('a new adapter from the template passes the structure check, saves, and a built-in shows its source', async () => {
    const text = im.template('my-pack')
    expect(im.validateSource(text, 'my-pack')).toEqual([])
    expect(await im.save('my-pack', text)).toMatchObject({ id: 'my-pack', builtin: false })
    expect(im.source('my-pack')).toMatchObject({ builtin: false, text })
    expect(im.source('panama-imax-redux')).toMatchObject({ builtin: true })
    expect(im.source('panama-imax-redux').text).toContain("id: 'panama-imax-redux'")
    expect(() => im.template('Bad Id')).toThrow(/lowercase/)
  }, 20000)

  it('editing a saved adapter changes its code, and the new text is what runs', async () => {
    const src = join(dir, 'src'); put(src, 'a.txt', 'a')
    await im.save('mine', OK_ADAPTER("[{ op: 'copy', kind: 'input', from: 'a.txt', to: 'input/one.txt' }]"))
    expect((await im.plan(src, 'mine')).ops[0].to).toBe('input/one.txt')
    const before = (await im.list()).find((a) => a.id === 'mine')!.sha256
    await im.save('mine', OK_ADAPTER("[{ op: 'copy', kind: 'input', from: 'a.txt', to: 'input/two.txt' }]"))
    expect((await im.list()).find((a) => a.id === 'mine')!.sha256).not.toBe(before)   // the hash follows the code
    expect((await im.plan(src, 'mine')).ops[0].to).toBe('input/two.txt')
  }, 30000)

  it('deletes yours, refuses a built-in, and says when there is none', async () => {
    await im.save('mine', OK_ADAPTER())
    expect(im.remove('mine')).toEqual({ id: 'mine' })
    expect((await im.list()).map((a) => a.id)).toEqual(['comfy-shared', 'panama-imax-redux'])
    expect(existsSync(join(adaptersDir(), 'mine.mjs'))).toBe(false)
    expect(() => im.remove('comfy-shared')).toThrow(/built-in/)
    expect(() => im.remove('mine')).toThrow(/no adapter mine/)
  }, 20000)

  it('duplicates a built-in under a new id, which then saves, validates and runs', async () => {
    const text = im.duplicate('panama-imax-redux', 'panama-mine')
    expect(text).toContain("id: 'panama-mine'"); expect(text).not.toContain("id: 'panama-imax-redux'")
    expect(im.validateSource(text, 'panama-mine')).toEqual([])
    await im.save('panama-mine', text)
    expect((await im.plan(pkg(dir), 'panama-mine')).adapter.id).toBe('panama-mine')
    expect(() => im.duplicate('nope', 'x-y')).toThrow(/no adapter nope/)
  }, 30000)
})
