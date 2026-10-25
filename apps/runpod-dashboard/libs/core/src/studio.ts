/**
 * The Adapter Studio's engine (docs/ADR-009): the chat that builds a prompt, the prompt that builds the adapter, the agentic check on
 * save, and the read-only views of the attached package (its tree, one file).
 *
 * The chat runs one request per step, driven by the screen: the screen sends the conversation, `step` makes ONE Messages API call with
 * a fixed set of tools, executes the tool calls it returns, and answers with the new messages and what each tool did. The screen repeats
 * until the model ends its turn. Every tool goes through the same functions the editor uses (imports.save, savePrompt, rename, remove),
 * so the rule of ADR-008 decision 13 holds for the whole loop: Claude can write `adapters/<id>.mjs` and `adapters/<id>.prompt.md`, and
 * nothing else, and cannot run a shell, touch a built-in's shipped file, or delete what the person made.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, resolve, sep } from 'node:path'
import { bad } from './errors.js'
import * as im from './imports.js'
import * as settings from './settings.js'

// ----- the conversation -----

export type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
export interface Message { role: 'user' | 'assistant'; content: string | Block[] }
export interface StudioState {
  messages: Message[]
  /** The adapter being worked on. */
  adapter: string
  /** The attached package folder, or null. */
  folder: string | null
  /** Adapters Claude created in this conversation: the only ones it may delete. */
  created: string[]
  /** Messages API calls made so far in this conversation, nested ones (build, document) included. */
  calls: number
}
export type StudioEvent = { kind: 'text'; text: string } | { kind: 'tool'; name: string; input: Record<string, unknown>; ok: boolean; summary: string; changed?: 'code' | 'prompt' | 'name' | 'list' }

export const MAX_STEPS = 10      // model calls the screen makes for one message of the person's
export const MAX_CALLS = 40      // a conversation's calls, nested ones included

export const STUDIO_SYSTEM = `You are the assistant inside the Adapter Studio of a pod-manager app. An ADAPTER is one small JavaScript module (adapters/<id>.mjs) that maps a package folder (a "shot pack") onto the ComfyUI-Shared structure; it only plans, and the app applies the plan. You help the person write and manage adapters by talking with them.

How you work:
1. Talk with the person about the package and what the adapter must do. Look at the attached folder with list_folder and read_folder_file (READMEs, manifests) instead of guessing. Ask when something is unclear; keep replies short.
2. Everything you learn goes into the adapter's PROMPT: plain text with the goal, the facts about the source format, the mapping rules, the constraints and the open questions. Keep it up to date with update_prompt after each exchange that changes it. The person can edit the prompt too; read it with read_adapter before you change it and keep their edits.
3. build_adapter makes the module FROM THE PROMPT. After a build, call validate_adapter and test_adapter; if either fails, improve the prompt (not the code by hand) and build again, at most three times, then tell the person what is still wrong.
4. Every adapter starts with a documentation header (What it does, Detects, Maps, Leaves in place, Needs / assumes, Limits). build_adapter writes it; document_adapter rewrites it to match code that was edited by hand.
5. You can name adapters (rename_adapter) so they are easy to find.

Your limits, which are rules and not requests: you can write only adapters and their prompts, through the tools below. You cannot write any other file, run commands, or change a built-in adapter's shipped file (editing a built-in makes an override the person can reset). You may delete only an adapter you created in this conversation. Never put secrets, shell commands or file contents of the package into the prompt beyond what the mapping needs.`

export const TOOLS = [
  { name: 'list_adapters', description: 'The adapters: id, name, whether built-in or yours.', input_schema: { type: 'object', properties: {} } },
  { name: 'read_adapter', description: 'An adapter\'s source, its prompt, and whether it is a built-in.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'list_folder', description: 'Names of files and folders in the attached package folder (at most 200 entries per call). path is relative to the folder; default is its top.', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'read_folder_file', description: 'The start (16 KB) of a small text file in the attached package folder, e.g. a README or MANIFEST.json.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'update_prompt', description: 'Replace the adapter\'s prompt (plain text). Creates the adapter\'s prompt file if it has none. The previous prompt is kept in its history.', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'lowercase letters, digits, dashes' }, text: { type: 'string' } }, required: ['id', 'text'] } },
  { name: 'build_adapter', description: 'Build (or rebuild) the adapter module from its prompt and the attached folder. Needs a non-empty prompt and an attached folder. Returns whether the structure is valid and its errors.', input_schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string', description: 'a display name' } }, required: ['id'] } },
  { name: 'validate_adapter', description: 'Check the saved module\'s structure (no run).', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'test_adapter', description: 'Run the saved adapter, fenced and read-only, on the attached folder and return its plan summary or the error.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'document_adapter', description: 'Rewrite the documentation header of the saved module to match what its code does. Only the header changes.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'rename_adapter', description: 'Give the adapter a display name and/or a new id (its file name). Not for a built-in.', input_schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, new_id: { type: 'string' } }, required: ['id'] } },
  { name: 'delete_adapter', description: 'Delete an adapter you created in this conversation.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
] as const

// ----- reads of the attached folder (confined) -----

function insideFolder(folder: string | null, rel: unknown): string {
  if (!folder) throw bad('no folder is attached')
  if (rel !== undefined && typeof rel !== 'string') throw bad('path must be a string')
  const root = realpathSync(folder)
  const p = rel ? String(rel) : '.'
  if (isAbsolute(p)) throw bad(`path must be relative to the folder: ${p}`)
  const full = resolve(root, p)
  if (full !== root && !full.startsWith(root + sep)) throw bad(`path leaves the folder: ${p}`)
  if (existsSync(full)) { const real = realpathSync(full); if (real !== root && !real.startsWith(root + sep)) throw bad(`path leaves the folder (link): ${p}`) }
  return full
}

export interface TreeEntry { path: string; dir: boolean; bytes: number; files?: number }
/** The attached folder as names: every folder and file, at most `limit`, folders first within each level. Built from names only, no file is read. */
export function packageTree(folder: string, limit = 3000): { entries: TreeEntry[]; truncated: boolean; total: number } {
  const root = realpathSync(folder)
  const out: TreeEntry[] = []
  let total = 0
  const walk = (dir: string, rel: string): number => {
    let files = 0
    const items = readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.DS_Store')).sort((a, b) => (a.isDirectory() === b.isDirectory() ? (a.name < b.name ? -1 : 1) : a.isDirectory() ? -1 : 1))
    for (const e of items) {
      const path = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        const at = out.length
        total++
        if (out.length < limit) out.push({ path, dir: true, bytes: 0 })
        const n = walk(join(dir, e.name), path)
        if (out[at] && out[at].path === path) out[at].files = n
        files += n
      } else if (e.isFile()) {
        total++
        files++
        if (out.length < limit) out.push({ path, dir: false, bytes: statSync(join(dir, e.name)).size })
      }
    }
    return files
  }
  walk(root, '')
  return { entries: out, truncated: total > out.length, total }
}

export interface Viewed { path: string; bytes: number; kind: 'text' | 'json' | 'image' | 'binary'; text?: string; truncated?: boolean; data_url?: string }
const IMAGES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const TEXT_MAX = 256 * 1024, IMAGE_MAX = 2 * 1024 * 1024
/** One file of the attached folder for the read-only viewer: text and JSON (pretty-printed) up to 256 KB, a small image as a data URL, anything else as its name and size. */
export function readPackageFile(folder: string, rel: string): Viewed {
  const full = insideFolder(folder, rel)
  if (!existsSync(full) || !statSync(full).isFile()) throw bad(`not a file: ${rel}`)
  const bytes = statSync(full).size
  const ext = extname(full).toLowerCase()
  if (IMAGES[ext]) return bytes <= IMAGE_MAX ? { path: rel, bytes, kind: 'image', data_url: `data:${IMAGES[ext]};base64,${readFileSync(full).toString('base64')}` } : { path: rel, bytes, kind: 'binary' }
  const buf = readFileSync(full).subarray(0, TEXT_MAX)
  if (buf.includes(0)) return { path: rel, bytes, kind: 'binary' }
  let text = buf.toString('utf8')
  let kind: Viewed['kind'] = 'text'
  if (ext === '.json' && bytes <= TEXT_MAX) { try { text = JSON.stringify(JSON.parse(text), null, 2); kind = 'json' } catch { /* shown as it is */ } }
  return { path: rel, bytes, kind, text, ...(bytes > TEXT_MAX ? { truncated: true } : {}) }
}

// ----- the tools -----

interface Ctx { state: StudioState; opts: im.AskOptions }
const idOf = (input: Record<string, unknown>, key = 'id'): string => {
  const v = input[key]
  if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(v)) throw bad(`${key} must be lowercase letters, digits and dashes (at most 63)`)
  return v
}

async function exists(id: string): Promise<boolean> { return (await im.list()).some((a) => a.id === id) }

async function runTool(name: string, input: Record<string, unknown>, c: Ctx): Promise<{ result: unknown; summary: string; changed?: 'code' | 'prompt' | 'name' | 'list' }> {
  const { state } = c
  switch (name) {
    case 'list_adapters': {
      const rows = (await im.list()).map((a) => ({ id: a.id, name: a.name, builtin: a.builtin, modified: !!a.modified }))
      return { result: rows, summary: `${rows.length} adapters` }
    }
    case 'read_adapter': {
      const id = idOf(input)
      const s = im.source(id)
      return { result: { id, name: (await im.list()).find((a) => a.id === id)?.name, source: s.text, prompt: im.getPrompt(id), builtin: s.builtin, modified: s.modified }, summary: id }
    }
    case 'list_folder': {
      const dir = insideFolder(state.folder, input.path)
      const items = readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.DS_Store')).slice(0, 200).map((e) => ({ name: e.name, dir: e.isDirectory(), bytes: e.isFile() ? statSync(join(dir, e.name)).size : 0 }))
      return { result: items, summary: `${items.length} entries in ${input.path || '.'}` }
    }
    case 'read_folder_file': {
      const full = insideFolder(state.folder, input.path)
      if (!existsSync(full) || !statSync(full).isFile()) throw bad(`not a file: ${String(input.path)}`)
      const buf = readFileSync(full).subarray(0, 16 * 1024)
      if (buf.includes(0)) throw bad('that file is binary')
      return { result: { path: input.path, text: buf.toString('utf8'), truncated: statSync(full).size > buf.length }, summary: String(input.path) }
    }
    case 'update_prompt': {
      const id = idOf(input)
      if (typeof input.text !== 'string') throw bad('text must be a string')
      if (!(await exists(id)) && !state.created.includes(id)) state.created.push(id)
      im.savePrompt(id, input.text)
      return { result: { id, bytes: input.text.length }, summary: `${id}: prompt ${input.text.length} characters`, changed: 'prompt' }
    }
    case 'build_adapter': {
      const id = idOf(input)
      const prompt = im.getPrompt(id)
      if (!prompt.trim()) throw bad('the prompt is empty: write it with update_prompt first')
      if (!state.folder) throw bad('no folder is attached: the build needs it')
      const existed = await exists(id)
      state.calls++
      const r = await im.draft(state.folder, { id, prompt, ...(typeof input.name === 'string' && input.name ? { name: input.name } : {}), ...c.opts })
      if (!existed && !state.created.includes(id)) state.created.push(id)
      return { result: { id, valid: r.valid, errors: r.errors, ignored: r.ignored }, summary: `${id}: ${r.valid ? 'valid' : `${r.errors.length} problem(s)`}`, changed: 'code' }
    }
    case 'validate_adapter': {
      const id = idOf(input)
      const errors = im.validateSource(im.source(id).text, id)
      return { result: { id, valid: errors.length === 0, errors }, summary: errors.length ? `${errors.length} problem(s)` : 'structure ok' }
    }
    case 'test_adapter': {
      const id = idOf(input)
      if (!state.folder) throw bad('no folder is attached')
      const p = await im.plan(state.folder, id)
      return { result: { id, copies: p.summary.copies, bytes: p.summary.bytes, by_kind: p.summary.by_kind, findings: p.findings.slice(0, 20), fenced: p.fenced }, summary: `${p.summary.copies} files to copy` }
    }
    case 'document_adapter': {
      const id = idOf(input)
      state.calls++
      const r = await documentAdapter(id, c.opts)
      return { result: { id, header: r.header }, summary: `${id}: header written`, changed: 'code' }
    }
    case 'rename_adapter': {
      const id = idOf(input)
      const to: { id?: string; name?: string } = {}
      if (typeof input.name === 'string' && input.name) to.name = input.name
      if (input.new_id !== undefined) to.id = idOf(input, 'new_id')
      const row = await im.rename(id, to)
      if (to.id) { state.created = state.created.map((x) => (x === id ? row.id : x)); if (state.adapter === id) state.adapter = row.id }
      return { result: { id: row.id, name: row.name }, summary: `${id} -> ${row.id} (${row.name})`, changed: 'name' }
    }
    case 'delete_adapter': {
      const id = idOf(input)
      if (!state.created.includes(id)) throw bad(`${id} was not created in this conversation; only the person can delete it`)
      im.remove(id)
      state.created = state.created.filter((x) => x !== id)
      return { result: { id, deleted: true }, summary: `${id} deleted`, changed: 'list' }
    }
    default:
      throw bad(`there is no tool ${name}`)
  }
}

// ----- one step -----

/** One model call and the tool calls it asks for. The screen calls it again until `done`. The state comes back updated (messages, calls, created). */
export async function step(state: StudioState, opts: im.AskOptions = {}): Promise<{ state: StudioState; events: StudioEvent[]; done: boolean }> {
  const key = settings.lookup('ANTHROPIC_API_KEY')
  if (!key) throw bad('No Anthropic API key: set it in Default Configuration')
  if (state.calls >= MAX_CALLS) throw bad(`this conversation has made ${MAX_CALLS} requests; start a new one`)
  const next: StudioState = { ...state, messages: [...state.messages], created: [...state.created], calls: state.calls + 1 }
  const model = opts.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
  const context = `${STUDIO_SYSTEM}\n\nThe adapter open in the editor: ${state.adapter || '(none yet)'}. The attached folder: ${state.folder || '(none)'}.`
  const res = await (opts.fetchImpl || fetch)(`${settings.anthropicBase()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, system: context, tools: TOOLS, messages: state.messages }),
  })
  const body = (await res.json().catch(() => ({}))) as { content?: Block[]; error?: { message?: string } }
  if (!res.ok) throw bad(`Anthropic answered ${res.status}: ${body.error?.message || 'no detail'}`)
  const blocks = (body.content || []).filter((b) => b.type === 'text' || b.type === 'tool_use') as Block[]
  next.messages.push({ role: 'assistant', content: blocks })
  const events: StudioEvent[] = []
  const results: Block[] = []
  const ctx: Ctx = { state: next, opts }
  for (const b of blocks) {
    if (b.type === 'text' && b.text.trim()) events.push({ kind: 'text', text: b.text })
    if (b.type !== 'tool_use') continue
    try {
      const r = await runTool(b.name, b.input || {}, ctx)
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(r.result).slice(0, 24000) })
      events.push({ kind: 'tool', name: b.name, input: b.input || {}, ok: true, summary: r.summary, ...(r.changed ? { changed: r.changed } : {}) })
    } catch (e) {
      const message = (e as Error).message
      results.push({ type: 'tool_result', tool_use_id: b.id, content: message, is_error: true })
      events.push({ kind: 'tool', name: b.name, input: b.input || {}, ok: false, summary: message })
    }
  }
  if (results.length) next.messages.push({ role: 'user', content: results })
  return { state: next, events, done: results.length === 0 }
}

// ----- documentation (ADR-009 decision 12) -----

const DOC_SYSTEM = 'You write the documentation header of an import adapter. You are given its code. Reply with ONE comment block (/** ... */) and nothing else: lines for What it does, Detects, Maps (source -> destination), Leaves in place, Needs / assumes, Limits, each saying what THIS code actually does (read it; do not describe what it should do). Plain text, no markdown, no code.'

/** Have Claude write the header from the code as it stands, and replace only the header: the code from the first line of code on is byte-identical. */
export async function documentAdapter(id: string, opts: im.AskOptions = {}): Promise<{ adapter: im.AdapterInfo; header: string; before: string }> {
  const src = im.source(id)
  const code = src.text
  const before = im.docHeader(code)
  const { text } = await im.askClaude(DOC_SYSTEM, `Adapter ${id}. Code:\n\n${code}`, 1200, opts)
  const block = /\/\*[\s\S]*?\*\//.exec(text)?.[0]
  if (!block) throw bad('The reply did not contain a comment block')
  const next = im.withDocHeader(code, block)
  const stripHead = (t: string) => t.slice(t.length - (t.length - (t.indexOf(im.docHeader(t)) + im.docHeader(t).length)))   // from the end of the header
  if (stripHead(next).trim() !== stripHead(code).trim()) throw bad('the code changed outside the header; nothing was saved')
  return { adapter: await im.save(id, next), header: block, before }
}

// ----- saving, with the agent's check (ADR-009 decision 7) -----

export interface Round { round: number; errors: string[]; fixed: boolean }
export interface Checked { adapter: im.AdapterInfo; valid: boolean; errors: string[]; rounds: Round[]; text: string; tested: boolean }
const MAX_ROUNDS = 3

/** Problems with the saved module: its structure, and, when a folder is attached, what a fenced run of its plan reports. */
export async function problems(id: string, folder: string | null): Promise<{ errors: string[]; tested: boolean }> {
  const errors = im.validateSource(im.source(id).text, id)
  if (!folder) return { errors, tested: false }
  try { await im.plan(folder, id) } catch (e) { errors.push(`running it on the attached folder: ${(e as Error).message}`) }
  return { errors, tested: true }
}

/** Save the person's text, then check it; when it fails and a key is set, Claude fixes it (from the errors, the adapter's prompt and the old code), at most three rounds, each saved
 *  as a new version in the history. Without a key the checks still run and the errors come back for the person to fix. */
export async function saveChecked(id: string, text: string, opts: { folder?: string | null; rounds?: number } & im.AskOptions = {}): Promise<Checked> {
  let adapter = await im.save(id, text)
  const folder = opts.folder ?? null
  let { errors, tested } = await problems(id, folder)
  const rounds: Round[] = []
  const hasKey = !!settings.lookup('ANTHROPIC_API_KEY')
  for (let n = 1; errors.length && hasKey && n <= (opts.rounds ?? MAX_ROUNDS); n++) {
    const asked = errors
    try {
      const r = await im.draft(folder, { id, prompt: im.getPrompt(id), errors: asked, instruction: 'Fix the problems above in the code as it stands; change nothing else.', ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.model ? { model: opts.model } : {}) })
      adapter = r.adapter
    } catch (e) { rounds.push({ round: n, errors: [...asked, (e as Error).message], fixed: false }); break }
    ;({ errors, tested } = await problems(id, folder))
    rounds.push({ round: n, errors: asked, fixed: errors.length === 0 })
  }
  return { adapter, valid: errors.length === 0, errors, rounds, text: im.source(id).text, tested }
}
