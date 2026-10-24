import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as im from '../src/imports.js'
import * as st from '../src/studio.js'
import { adaptersDir } from '../src/paths.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-TESTTESTTESTTESTTEST' })
const put = (root: string, rel: string, text: string | Buffer) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }
const tree = (root: string): string[] => (existsSync(root) ? (readdirSync(root, { recursive: true }) as string[]) : []).sort()

const HEADER = '/**\n * Studio test adapter. What it does: copies the inputs. Detects: an input folder. Maps: input/ to input/. Leaves in place: the rest.\n * Needs / assumes: nothing. Limits: a test.\n */\n'
const MODULE = (id: string, to = 'input/a.txt') => `${HEADER}export default { id: '${id}', name: 'Studio test', version: 1, async detect(root, ctx) { return { match: 0.5, evidence: [] } }, async plan(root, ctx) { return { ops: [{ op: 'copy', kind: 'input', from: 'a.txt', to: '${to}' }], findings: [] } } }`

function pack() {
  const root = join(dir, 'pack')
  put(root, 'a.txt', 'A'); put(root, 'README.md', '# Pack\nThe graphs are in graphs/.'); put(root, 'graphs/g1.json', '{"nodes":[1]}'); put(root, 'media/x.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])); put(root, 'media/blob.bin', Buffer.from([1, 0, 2]))
  return root
}
const state = (over: Partial<st.StudioState> = {}): st.StudioState => ({ messages: [{ role: 'user', content: 'hello' }], adapter: '', folder: null, created: [], calls: 0, ...over })

/** A scripted Messages API: the Studio's own turns come from `turns` in order; the build calls (a different system prompt) get `module`. Records every request. */
function api(turns: Array<Array<Record<string, unknown>>>, module: (id: string) => string = (id) => MODULE(id)) {
  const seen: Array<{ system: string; messages: unknown[]; tools?: unknown[] }> = []
  const impl = (async (_url: string, init: { body: string }) => {
    const b = JSON.parse(init.body); seen.push(b)
    if (/Adapter Studio/.test(b.system)) return { ok: true, status: 200, json: async () => ({ content: turns.shift() || [{ type: 'text', text: 'done' }] }) }
    const id = /with id "([^"]+)"/.exec(b.messages[0].content)?.[1] || 'x'
    if (/documentation header of an import adapter/.test(b.system)) return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '/**\n * Documented again. What it does: copies a.txt. Detects: nothing. Maps: a.txt to input/a.txt. Leaves in place: everything else.\n * Needs / assumes: nothing. Limits: a test.\n */' }] }) }
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '```javascript\n' + module(id) + '\n```' }] }) }
  }) as unknown as typeof fetch
  return { impl, seen }
}
const tool = (name: string, input: Record<string, unknown>, id = `tu_${name}`) => ({ type: 'tool_use', id, name, input })

describe('a step', () => {
  it('needs the key; a plain reply ends the turn and costs one call', async () => {
    delete process.env.ANTHROPIC_API_KEY
    await expect(st.step(state())).rejects.toThrow(/No Anthropic API key/)
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-TESTTESTTESTTESTTEST'
    const a = api([[{ type: 'text', text: 'Which folder holds the graphs?' }]])
    const r = await st.step(state(), { fetchImpl: a.impl })
    expect(r.done).toBe(true); expect(r.events).toEqual([{ kind: 'text', text: 'Which folder holds the graphs?' }])
    expect(r.state.calls).toBe(1); expect(r.state.messages.at(-1)).toMatchObject({ role: 'assistant' })
    expect((a.seen[0].tools as { name: string }[]).map((t) => t.name)).toEqual(st.TOOLS.map((t) => t.name))
    expect(a.seen[0].system).toContain('Adapter Studio'); expect(a.seen[0].system).toContain('only adapters and their prompts')
  })

  it('runs the tools the model asks for and hands the results back: chat builds the prompt, the prompt builds the adapter, then it is tested', async () => {
    const root = pack()
    const a = api([
      [{ type: 'text', text: 'Let me look.' }, tool('list_folder', {}, 't1'), tool('read_folder_file', { path: 'README.md' }, 't2')],
      [tool('update_prompt', { id: 'shots-a', text: 'Map a.txt to input/a.txt. The graphs are in graphs/.' }, 't3')],
      [tool('build_adapter', { id: 'shots-a', name: 'Shots A' }, 't4')],
      [tool('validate_adapter', { id: 'shots-a' }, 't5'), tool('test_adapter', { id: 'shots-a' }, 't6')],
      [{ type: 'text', text: 'Built, valid, and it plans 1 file.' }],
    ])
    let s = state({ folder: root, adapter: 'shots-a' })
    const all: st.StudioEvent[] = []
    for (let i = 0; i < st.MAX_STEPS; i++) { const r = await st.step(s, { fetchImpl: a.impl }); s = r.state; all.push(...r.events); if (r.done) break }
    expect(all.filter((e) => e.kind === 'tool').map((e) => `${(e as { name: string }).name}:${(e as { ok: boolean }).ok}`)).toEqual(['list_folder:true', 'read_folder_file:true', 'update_prompt:true', 'build_adapter:true', 'validate_adapter:true', 'test_adapter:true'])
    expect(all.at(-1)).toEqual({ kind: 'text', text: 'Built, valid, and it plans 1 file.' })
    expect(im.getPrompt('shots-a')).toContain('graphs are in graphs/')
    const row = (await im.list()).find((x) => x.id === 'shots-a')!
    expect(row).toMatchObject({ name: 'Shots A', builtin: false })   // the display name was set by the build
    expect(im.validateSource(im.source('shots-a').text, 'shots-a')).toEqual([])
    expect(s.created).toEqual(['shots-a'])
    expect(s.calls).toBe(5 + 1)   // five studio calls and the nested build
    // the model saw what its tools returned
    const lastUser = JSON.stringify(a.seen.at(-1)!.messages)
    expect(lastUser).toContain('copies\\":1'); expect(lastUser).toContain('The graphs are in graphs/')
    // the build was made from the PROMPT and the folder, not from the chat
    const build = a.seen.find((x) => /with id/.test(String((x.messages[0] as { content: string }).content)))!
    expect((build.messages[0] as { content: string }).content).toContain('# The adapter prompt: the source of truth')
    expect((build.messages[0] as { content: string }).content).toContain('Map a.txt to input/a.txt')
    expect((build.messages[0] as { content: string }).content).not.toContain('Let me look.')
  }, 60000)

  it('a tool that fails comes back as an error result for the model, not an exception', async () => {
    const a = api([[tool('update_prompt', { id: '../../evil', text: 'x' })], [{ type: 'text', text: 'ok' }]])
    const r = await st.step(state(), { fetchImpl: a.impl })
    expect(r.done).toBe(false)
    expect(r.events[0]).toMatchObject({ kind: 'tool', ok: false }); expect((r.events[0] as { summary: string }).summary).toMatch(/lowercase letters/)
    expect(JSON.stringify(r.state.messages.at(-1))).toContain('"is_error":true')
  })

  it('stops a conversation that has used its calls', async () => {
    await expect(st.step(state({ calls: st.MAX_CALLS }), { fetchImpl: api([]).impl })).rejects.toThrow(/start a new one/)
  })
})

describe('the rule: Claude writes adapters and their prompts, nothing else', () => {
  it('hostile tool calls (traversal, absolute paths, unknown tools, deleting what it did not create, no folder) all fail, and the disk gains only adapter and prompt files', async () => {
    const root = pack()
    const before = tree(dir)
    const a = api([[
      tool('update_prompt', { id: '../../../etc/evil', text: 'x' }, 'h1'),
      tool('read_folder_file', { path: '../../../etc/passwd' }, 'h2'),
      tool('list_folder', { path: '/etc' }, 'h3'),
      tool('write_file', { path: '/tmp/x', text: 'x' }, 'h4'),
      tool('run_shell', { command: 'rm -rf ~' }, 'h5'),
      tool('delete_adapter', { id: 'comfy-shared' }, 'h6'),
      tool('rename_adapter', { id: 'comfy-shared', name: 'x' }, 'h7'),
      tool('update_prompt', { id: 'ok-one', text: 'a prompt' }, 'h8'),
    ]])
    const r = await st.step(state({ folder: root }), { fetchImpl: a.impl })
    expect(r.events.map((e) => (e as { ok?: boolean }).ok)).toEqual([false, false, false, false, false, false, false, true])
    expect(tree(dir).filter((f) => !before.includes(f))).toEqual(['adapters', 'adapters/ok-one.prompt.md'])
    expect(existsSync('/etc/evil')).toBe(false)
  })

  it('it may delete only what it created in this conversation; the person\'s adapters and built-ins are out of reach', async () => {
    await im.save('persons', MODULE('persons'))
    const a = api([[tool('update_prompt', { id: 'mine-now', text: 'p' }, 'd0'), tool('delete_adapter', { id: 'persons' }, 'd1'), tool('delete_adapter', { id: 'mine-now' }, 'd2')]])
    const r = await st.step(state(), { fetchImpl: a.impl })
    expect(r.events.map((e) => (e as { ok?: boolean }).ok)).toEqual([true, false, true])
    expect(existsSync(join(adaptersDir(), 'persons.mjs'))).toBe(true)
    expect(existsSync(join(adaptersDir(), 'mine-now.prompt.md'))).toBe(false)   // its own prompt went with it
    expect(r.state.created).toEqual([])
  })

  it('editing a built-in through the chat makes an override and leaves the shipped file alone', async () => {
    const root = pack()
    const shipped = im.source('comfy-shared').original ?? im.source('comfy-shared').text
    const a = api([[tool('update_prompt', { id: 'comfy-shared', text: 'link models' }, 'b1'), tool('build_adapter', { id: 'comfy-shared' }, 'b2')]], () => MODULE('comfy-shared'))
    const r = await st.step(state({ folder: root }), { fetchImpl: a.impl })
    expect(r.events.map((e) => (e as { ok?: boolean }).ok)).toEqual([true, true])
    expect(await im.list().then((l) => l.find((x) => x.id === 'comfy-shared'))).toMatchObject({ builtin: true, modified: true })
    im.remove('comfy-shared')
    expect(im.source('comfy-shared').text).toBe(shipped)
    expect(r.state.created).toEqual([])   // an existing id is never "created" by the chat, so it cannot be deleted by it
  })
})

describe('saving, with the agent\'s check', () => {
  it('a good save has no rounds; a failing one is fixed by Claude from the errors and the prompt, and the rounds say so', async () => {
    const root = pack(); put(root, 'a.txt', 'A')
    const good = await st.saveChecked('shots-a', MODULE('shots-a'), { folder: root })
    expect(good).toMatchObject({ valid: true, errors: [], rounds: [], tested: true })
    im.savePrompt('shots-b', 'Map a.txt to input/a.txt.')
    const a = api([], (id) => MODULE(id))
    const fixed = await st.saveChecked('shots-b', MODULE('shots-b', '../escape.txt'), { folder: root, fetchImpl: a.impl })
    expect(fixed.valid).toBe(true); expect(fixed.rounds).toEqual([{ round: 1, errors: [expect.stringContaining('leaves its folder')], fixed: true }])
    expect(fixed.text).toContain("to: 'input/a.txt'")
    const asked = (a.seen[0].messages[0] as { content: string }).content
    expect(asked).toContain('leaves its folder'); expect(asked).toContain('Map a.txt to input/a.txt.'); expect(asked).toContain('The draft you wrote last time')
  }, 60000)

  it('gives up after three rounds, leaves the adapter saved and marked not valid with the errors', async () => {
    const root = pack()
    const a = api([], (id) => MODULE(id, '../still-bad.txt'))
    const r = await st.saveChecked('shots-c', MODULE('shots-c', '../escape.txt'), { folder: root, fetchImpl: a.impl })
    expect(r.valid).toBe(false); expect(r.rounds.length).toBe(3); expect(r.rounds.every((x) => !x.fixed)).toBe(true)
    expect(r.errors[0]).toMatch(/leaves its folder/); expect(existsSync(join(adaptersDir(), 'shots-c.mjs'))).toBe(true)
    expect(a.seen.length).toBe(3)
  }, 90000)

  it('without a key it still checks and reports, and fixes nothing', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const r = await st.saveChecked('shots-d', 'const x = 1 // parses, but is not an adapter', {})
    expect(r.valid).toBe(false); expect(r.rounds).toEqual([]); expect(r.errors.length).toBeGreaterThan(2)
  }, 30000)

  it('a module that does not parse is refused at the door, as before', async () => {
    await expect(st.saveChecked('shots-e', 'export default {')).rejects.toThrow(/does not parse/)
  })
})

describe('the package: its tree and its files', () => {
  it('lists the folder as names with counts, folders first, and says when it cut it short', () => {
    const root = pack()
    const t = st.packageTree(root)
    expect(t.entries.map((e) => e.path)).toEqual(['graphs', 'graphs/g1.json', 'media', 'media/blob.bin', 'media/x.png', 'README.md', 'a.txt'])
    expect(t.entries.find((e) => e.path === 'media')).toMatchObject({ dir: true, files: 2 })
    expect(t.truncated).toBe(false)
    const cut = st.packageTree(root, 3)
    expect(cut.entries.length).toBe(3); expect(cut.truncated).toBe(true); expect(cut.total).toBe(7)
  })

  it('shows a file for the viewer: text, pretty JSON, a small image, or just its size; and never leaves the folder', () => {
    const root = pack()
    expect(st.readPackageFile(root, 'README.md')).toMatchObject({ kind: 'text', text: expect.stringContaining('# Pack') })
    expect(st.readPackageFile(root, 'graphs/g1.json')).toMatchObject({ kind: 'json', text: '{\n  "nodes": [\n    1\n  ]\n}' })
    expect(st.readPackageFile(root, 'media/x.png')).toMatchObject({ kind: 'image', data_url: expect.stringMatching(/^data:image\/png;base64,/) })
    expect(st.readPackageFile(root, 'media/blob.bin')).toEqual({ path: 'media/blob.bin', bytes: 3, kind: 'binary' })
    put(root, 'big.txt', 'x'.repeat(300 * 1024))
    expect(st.readPackageFile(root, 'big.txt')).toMatchObject({ kind: 'text', truncated: true })
    expect(() => st.readPackageFile(root, '../outside.txt')).toThrow(/leaves the folder/)
    expect(() => st.readPackageFile(root, '/etc/passwd')).toThrow(/relative/)
    expect(() => st.readPackageFile(root, 'graphs')).toThrow(/not a file/)
  })
})

describe('documenting', () => {
  it('rewrites the header from the code and leaves every other byte alone; a reply with no comment saves nothing', async () => {
    await im.save('doc-me', MODULE('doc-me'))
    const before = im.source('doc-me').text
    const a = api([])
    const r = await st.documentAdapter('doc-me', { fetchImpl: a.impl })
    const after = im.source('doc-me').text
    expect(r.header).toContain('Documented again'); expect(im.docHeader(after)).toContain('Documented again')
    expect(after.slice(after.indexOf('export default'))).toBe(before.slice(before.indexOf('export default')))
    const none = (async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'no comment here' }] }) })) as unknown as typeof fetch
    await expect(st.documentAdapter('doc-me', { fetchImpl: none })).rejects.toThrow(/comment block/)
    expect(im.source('doc-me').text).toBe(after)
  }, 30000)
})
