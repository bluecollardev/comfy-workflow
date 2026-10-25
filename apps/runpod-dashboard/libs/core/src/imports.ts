/**
 * Imports through adapters (docs/ADR-008, docs/IMPORT-ADAPTERS.md, docs/PLAN-IMPORT-ADAPTERS.md).
 *
 * An adapter maps one kind of source folder onto the ComfyUI-Shared structure. It plans (a list of
 * operations as data), in a child process fenced by Node's permission model; this module checks the
 * plan and applies it: only inside the source (reads) and ComfyUI-Shared (writes), never deleting,
 * never replacing a different file unless told. The source is never changed.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, constants, createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bad } from './errors.js'
import { REPO_ROOT, adaptersDir, importsDir } from './paths.js'
import * as mounts from './mounts.js'
import * as settings from './settings.js'

export type OpName = 'copy' | 'link' | 'verify' | 'note' | 'placeholder'
export type OpKind = 'input' | 'workflow' | 'model' | 'node-pack' | 'reference' | 'manifest'
export interface Op { op: OpName; kind: OpKind; from?: string; to?: string; bytes?: number; sha256?: string; note?: string }
export interface Finding { level: 'info' | 'warn' | 'problem'; text: string; path?: string }
export interface AdapterInfo { id: string; name: string; version: number; builtin: boolean; file: string; sha256: string; error?: string
  /** A built-in whose file in the adapters folder is used instead of the shipped one (an override, ADR-009): the shipped file is `original` and is never touched. */
  modified?: boolean; original?: string }
export interface PlanSummary { copies: number; links: number; notes: number; bytes: number; by_kind: Record<string, { files: number; bytes: number }> }
export interface Plan { adapter: { id: string; name: string; version: number; builtin: boolean }; source: string; ops: Op[]; findings: Finding[]; summary: PlanSummary; fenced: boolean }
export type OpStatus = 'copied' | 'replaced' | 'same' | 'conflict' | 'hash-mismatch' | 'linked' | 'verified' | 'noted' | 'placeholder' | 'would-copy' | 'would-replace' | 'would-link' | 'error' | 'skipped'
export interface ApplyResult { dry_run: boolean; ok: boolean; counts: Record<string, number>; results: { i: number; status: OpStatus; detail?: string }[]; record: string | null }

const OPS: OpName[] = ['copy', 'link', 'verify', 'note', 'placeholder']
const KINDS: OpKind[] = ['input', 'workflow', 'model', 'node-pack', 'reference', 'manifest']
const TARGET_DIRS = ['input', 'workflows', 'models', 'node-packs']   // what an import may write into; output/ is the pods'
const SHA = /^[0-9a-f]{64}$/i
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/
const TIMEOUT_MS = 5 * 60 * 1000
const MAX_OUTPUT = 200 * 1024 * 1024

// ----- where the runtime pieces are -----

const HERE = dirname(fileURLToPath(import.meta.url))
/** The runner and the built-in adapters: dist/runtime (built, and the packaged app's resources/core/runtime) or libs/core/runtime (from src). */
export function runtimeDir(): string {
  const found = [join(HERE, 'runtime'), join(HERE, '..', 'runtime')].find((d) => existsSync(join(d, 'adapter-runner.mjs')))
  if (!found) throw bad('the adapter runtime is missing (run npm run core:build)')
  return realpathSync(found)
}

const sha256File = (file: string) => new Promise<string>((ok, no) => {
  const h = createHash('sha256'); const s = createReadStream(file)
  s.on('data', (c) => h.update(c)); s.on('end', () => ok(h.digest('hex'))); s.on('error', no)
})
const sha256Text = (text: string) => createHash('sha256').update(text).digest('hex')

/** The adapter writer's spec (docs/IMPORT-ADAPTERS.md): what an agent reads before it writes one. Travels with the core. */
export function spec(): string {
  const file = [join(runtimeDir(), 'IMPORT-ADAPTERS.md'), join(REPO_ROOT, 'docs', 'IMPORT-ADAPTERS.md')].find((f) => existsSync(f))
  if (!file) throw bad('the adapter spec is missing (docs/IMPORT-ADAPTERS.md)')
  return readFileSync(file, 'utf8')
}

// ----- adapters: built-in and yours (no approval step: every adapter's code is open to read in Default Configuration, ADR-008) -----

/** Whether this Node can fence a child with --permission (22.13+ and Electron's Node). */
export const fenceSupported = (): boolean => process.allowedNodeEnvironmentFlags.has('--permission')

interface Ran { ok: boolean; error?: string; id?: string; name?: string; version?: number; result?: unknown }

/** Run the runner on one adapter file, fenced where the Node allows it. */
async function runAdapter(file: string, action: 'info' | 'detect' | 'plan', source: string | null, options: unknown = {}): Promise<{ out: Ran; fenced: boolean }> {
  const runner = join(runtimeDir(), 'adapter-runner.mjs')
  const real = realpathSync(file)
  const root = source ? realpathSync(source) : null
  const fenced = fenceSupported()
  const args = [
    ...(fenced ? ['--permission', `--allow-fs-read=${runner}`, `--allow-fs-read=${real}`, ...(root ? [`--allow-fs-read=${root}`] : [])] : []),
    runner, real, action, ...(root ? [root, JSON.stringify(options ?? {})] : []),
  ]
  const env = { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }
  return new Promise((ok) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: root || dirname(real) })
    let out = '', err = '', size = 0, done = false
    const finish = (r: Ran) => { if (!done) { done = true; clearTimeout(timer); ok({ out: r, fenced }) } }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, error: `the adapter took longer than ${TIMEOUT_MS / 1000}s and was stopped` }) }, TIMEOUT_MS)
    child.stdout.on('data', (c) => { size += c.length; if (size > MAX_OUTPUT) { child.kill('SIGKILL'); finish({ ok: false, error: 'the adapter returned too much output' }) } else out += c })
    child.stderr.on('data', (c) => { if (err.length < 4000) err += c })
    child.on('error', (e) => finish({ ok: false, error: e.message }))
    child.on('close', () => {
      const line = out.trim().split('\n').pop() || ''
      try { finish(JSON.parse(line)) } catch { finish({ ok: false, error: (err.trim().split('\n').find((l) => /Error|denied|ERR_/.test(l)) || err.trim() || 'the adapter produced no result').slice(0, 500) }) }
    })
  })
}

function builtinFiles(): string[] {
  const dir = join(runtimeDir(), 'adapters')
  return readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort().map((f) => join(dir, f))
}
function userFiles(): string[] {
  const dir = adaptersDir()
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('.')).sort().map((f) => join(dir, f)) : []
}

/** Built-in adapters, then yours. Yours are read again on every call (hot-loaded: a file saved meanwhile is there); each runs fenced, read-only on the folder it is given, whoever wrote it.
 *  A built-in with a file of the same name in the adapters folder is an **override** (ADR-009): that file is what runs, the row says `modified`, and the shipped one stays as `original`. */
export async function list(): Promise<AdapterInfo[]> {
  const rows: AdapterInfo[] = []
  const users = userFiles()
  const builtinIds = new Set(builtinFiles().map((f) => basename(f, '.mjs')))
  for (const shipped of builtinFiles()) {
    const id = basename(shipped, '.mjs')
    const over = users.find((f) => basename(f, '.mjs') === id)
    const file = over || shipped
    const { out } = await runAdapter(file, 'info', null)
    rows.push({ id, name: out.name || id, version: out.version ?? 1, builtin: true, file, sha256: await sha256File(file), ...(over ? { modified: true, original: shipped } : {}), ...(out.ok ? {} : { error: out.error }) })
  }
  for (const file of users) {
    const id = basename(file, '.mjs')
    if (builtinIds.has(id)) continue
    const { out } = await runAdapter(file, 'info', null)
    rows.push({ id, name: out.name || id, version: out.version ?? 1, builtin: false, file, sha256: await sha256File(file), ...(out.ok ? {} : { error: out.error }) })
  }
  return rows
}

/** The source of an adapter as it is on disk (what the Studio opens). For a built-in with an override, `text` is the override and `original` the shipped code. */
export function source(id: string): { id: string; sha256: string; text: string; builtin: boolean; modified: boolean; file: string; original?: string } {
  const user = userFiles().find((f) => basename(f, '.mjs') === id)
  const shipped = builtinFiles().find((f) => basename(f, '.mjs') === id)
  const file = user || shipped
  if (!file) throw bad(`no adapter ${id}`)
  const text = readFileSync(file, 'utf8')
  return { id, sha256: sha256Text(text), text, builtin: !!shipped, modified: !!(shipped && user), file, ...(shipped && user ? { original: readFileSync(shipped, 'utf8') } : {}) }
}

/** Delete one of your adapters (its file, its prompt, its history). For a built-in this is **Reset**: the override goes and the shipped file is used again; an unmodified built-in cannot be deleted. */
export function remove(id: string): { id: string; reset?: boolean } {
  const isBuiltin = builtinFiles().some((f) => basename(f, '.mjs') === id)
  const file = userFiles().find((f) => basename(f, '.mjs') === id)
  if (isBuiltin && !file) throw bad(`${id} is a built-in adapter and has not been modified; there is nothing to delete or reset`)
  const prompt = join(adaptersDir(), `${id}.prompt.md`)
  if (!file && !existsSync(prompt)) throw bad(`no adapter ${id} in ${adaptersDir()}`)
  if (file) unlinkSync(file)   // an adapter that so far has only a prompt (no module built yet) is removed too
  if (existsSync(prompt)) unlinkSync(prompt)
  rmSync(join(adaptersDir(), '.history', id), { recursive: true, force: true })
  return isBuiltin ? { id, reset: true } : { id }
}

/** A starting point for a new adapter that passes the structure check as it stands: documented, detect says no, plan returns nothing. */
export function template(id: string, name?: string): string {
  if (!ID.test(id)) throw bad('the adapter id is lowercase letters, digits and dashes (at most 63)')
  return `/**
 * ${name || id}: an import adapter (docs/IMPORT-ADAPTERS.md). It only plans; the app applies the plan.
 *
 * What it does:    (one or two sentences: which package format this maps onto ComfyUI-Shared)
 * Detects:         (the telltale files or folders that say "this folder is mine")
 * Maps:            (source path -> destination under input/, workflows/, models/ or node-packs/)
 * Leaves in place: (what it deliberately does not copy)
 * Needs / assumes: (a manifest, a naming convention, a ComfyUI version)
 * Limits:          (what it does not handle yet)
 *
 * Read the source folder only through ctx: exists, stat, list, text, json, sha256.
 */
export default {
  id: '${id}',
  name: '${name || id}',
  version: 1,

  async detect(root, ctx) {
    // e.g. return { match: (await ctx.exists('MANIFEST.json')) ? 1 : 0, evidence: ['MANIFEST.json'] }
    return { match: 0, evidence: [] }
  },

  async plan(root, ctx) {
    const ops = []
    // e.g. for (const f of await ctx.list('input', { recursive: true })) ops.push({ op: 'copy', kind: 'input', from: f.path, to: f.path, bytes: f.bytes })
    return { ops, findings: [] }
  },
}
`
}

/** Copy a built-in (or your own) adapter's source under a new id: the way to change a built-in. */
export function duplicate(fromId: string, newId: string): string {
  if (!ID.test(newId)) throw bad('the adapter id is lowercase letters, digits and dashes (at most 63)')
  const text = source(fromId).text
  const re = /\bid\s*:\s*['"`][^'"`]+['"`]/
  if (!re.test(text)) throw bad(`${fromId} has no id: '...' to rename`)
  return text.replace(re, `id: '${newId}'`)
}

const HISTORY_KEEP = 20
const historyDir = (id: string) => join(adaptersDir(), '.history', id)
const promptPath = (id: string) => join(adaptersDir(), `${id}.prompt.md`)

/** Keep what is about to be overwritten: adapters/.history/<id>/<stamp>.<ext>, twenty deep per kind. A no-op when the text is unchanged. */
function backup(id: string, file: string, ext: 'mjs' | 'prompt.md', next: string) {
  if (!existsSync(file) || readFileSync(file, 'utf8') === next) return
  const dir = historyDir(id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`), readFileSync(file))
  const old = readdirSync(dir).filter((f) => f.endsWith(`.${ext}`) && (ext === 'mjs' ? !f.endsWith('.prompt.md') : true)).sort()
  for (const f of old.slice(0, Math.max(0, old.length - HISTORY_KEEP))) unlinkSync(join(dir, f))
}

/** Save an adapter module (what an agent calls, and the editor): a syntax check only, nothing is run. A built-in's id is allowed: the file is an override that is used instead of the shipped one, which is never touched (ADR-009). The previous text is kept in the history. */
export async function save(id: string, text: string): Promise<AdapterInfo> {
  if (!ID.test(id)) throw bad('the adapter id is lowercase letters, digits and dashes (at most 63)')
  if (text.length > 512 * 1024) throw bad('the adapter is too large (512 KB at most)')
  mkdirSync(adaptersDir(), { recursive: true })
  const file = join(adaptersDir(), `${id}.mjs`)
  const tmp = join(adaptersDir(), `.check-${process.pid}-${id}.mjs`)   // parsed before it replaces anything
  writeFileSync(tmp, text)
  const check = await new Promise<string>((ok) => {
    const c = spawn(process.execPath, ['--check', tmp], { env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }, stdio: ['ignore', 'ignore', 'pipe'] })
    let e = ''; c.stderr.on('data', (d) => { e += d }); c.on('close', (code) => ok(code === 0 ? '' : e.trim().split('\n').slice(0, 6).join('\n'))); c.on('error', (x) => ok(x.message))
  })
  rmSync(tmp, { force: true })
  if (check) throw bad(`the adapter does not parse:\n${check.replaceAll(tmp, `${id}.mjs`)}`)
  backup(id, file, 'mjs', text)
  writeFileSync(file, text)
  return (await list()).find((a) => a.file === file)!
}

/** The adapter's prompt (ADR-009): the text that builds it, kept beside it as adapters/<id>.prompt.md. '' when it has none yet. */
export function getPrompt(id: string): string {
  if (!ID.test(id)) throw bad('the adapter id is lowercase letters, digits and dashes (at most 63)')
  return existsSync(promptPath(id)) ? readFileSync(promptPath(id), 'utf8') : ''
}
/** Save the prompt (the person's edit or Claude's update); the previous one goes to the history. */
export function savePrompt(id: string, text: string): { id: string; bytes: number } {
  if (!ID.test(id)) throw bad('the adapter id is lowercase letters, digits and dashes (at most 63)')
  if (text.length > 64 * 1024) throw bad('the prompt is too long (64 KB at most)')
  mkdirSync(adaptersDir(), { recursive: true })
  backup(id, promptPath(id), 'prompt.md', text)
  writeFileSync(promptPath(id), text)
  return { id, bytes: text.length }
}

export interface Version { stamp: string; kind: 'code' | 'prompt'; bytes: number }
/** The saved versions of an adapter's code and prompt, newest first. */
export function history(id: string): Version[] {
  if (!ID.test(id)) throw bad('the adapter id is lowercase letters, digits and dashes (at most 63)')
  const dir = historyDir(id)
  if (!existsSync(dir)) return []
  return readdirSync(dir).map((f) => ({ stamp: f.replace(/\.(prompt\.md|mjs)$/, ''), kind: (f.endsWith('.prompt.md') ? 'prompt' : 'code') as 'code' | 'prompt', bytes: statSync(join(dir, f)).size }))
    .sort((a, b) => (a.stamp < b.stamp ? 1 : -1))
}
/** The text of one saved version. */
export function version(id: string, stamp: string, kind: 'code' | 'prompt'): string {
  if (!ID.test(id) || !/^[0-9TZ-]+$/.test(stamp)) throw bad('no such version')
  const file = join(historyDir(id), `${stamp}.${kind === 'prompt' ? 'prompt.md' : 'mjs'}`)
  if (!existsSync(file)) throw bad('no such version')
  return readFileSync(file, 'utf8')
}

/** Replace the first `name: '...'` in a module's source with a new display name. */
export function setName(text: string, name: string): string {
  const n = name.trim()
  if (!n || n.length > 80 || /[\r\n]/.test(n)) throw bad('the name is one line of at most 80 characters')
  const re = /(\bname\s*:\s*)(['"`])[^'"`\n]*\2/
  if (!re.test(text)) throw bad("the adapter has no `name: '...'` to rename")
  return text.replace(re, (_m, pre) => `${pre}${/^[^'\\\n\r]*$/.test(n) ? `'${n}'` : JSON.stringify(n)}`)
}

/** Name an adapter for easy reference: a new display name, and/or a new id (the file name, with the prompt and the history moving along). Not for a built-in. */
export async function rename(id: string, to: { id?: string; name?: string }): Promise<AdapterInfo> {
  if (builtinFiles().some((f) => basename(f, '.mjs') === id)) throw bad(`${id} is a built-in adapter; duplicate it to give a copy another name`)
  const file = join(adaptersDir(), `${id}.mjs`)
  if (!existsSync(file)) throw bad(`no adapter ${id} in ${adaptersDir()}`)
  let text = readFileSync(file, 'utf8')
  const newId = to.id && to.id !== id ? to.id : id
  if (!ID.test(newId)) throw bad('the adapter id is lowercase letters, digits and dashes (at most 63)')
  if (newId !== id && (existsSync(join(adaptersDir(), `${newId}.mjs`)) || builtinFiles().some((f) => basename(f, '.mjs') === newId))) throw bad(`there is already an adapter ${newId}`)
  if (to.name !== undefined) text = setName(text, to.name)
  if (newId !== id) text = text.replace(/(\bid\s*:\s*)(['"`])[^'"`\n]*\2/, (_m, pre) => `${pre}'${newId}'`)
  backup(id, file, 'mjs', text)
  const dest = join(adaptersDir(), `${newId}.mjs`)
  writeFileSync(dest, text)
  if (newId !== id) {
    unlinkSync(file)
    if (existsSync(promptPath(id))) renameSync(promptPath(id), promptPath(newId))
    if (existsSync(historyDir(id))) { mkdirSync(join(adaptersDir(), '.history'), { recursive: true }); renameSync(historyDir(id), historyDir(newId)) }
  }
  return (await list()).find((a) => a.file === dest)!
}

// ----- the documentation rule (ADR-009, decision 12) -----

// The leading comment block of a module (line comments and block comments from the top of the file, up to the first line of code) and the code after it.
function splitHeader(text: string): { header: string; rest: string } {
  let i = 0
  const n = text.length
  for (;;) {
    const ws = /^\s*/.exec(text.slice(i))![0].length
    const at = i + ws
    if (text.startsWith('//', at)) { const nl = text.indexOf('\n', at); i = nl < 0 ? n : nl + 1; continue }
    if (text.startsWith('/*', at)) { const end = text.indexOf('*/', at + 2); if (end < 0) break; i = end + 2; continue }
    break
  }
  return { header: text.slice(0, i).trim(), rest: text.slice(i).replace(/^\s*\n/, '') }
}
/** What an adapter says about itself: its leading comment block. */
export const docHeader = (text: string): string => splitHeader(text).header

/** The words of the header, without comment marks. */
const headerWords = (h: string) => h.replace(/\/\*+|\*+\//g, '').replace(/^\s*(\*|\/\/)\s?/gm, '').trim()
export const hasDocHeader = (text: string): boolean => headerWords(docHeader(text)).length >= 100
/** The source with its leading comment block replaced by `header` (a comment block); the code after it is byte-identical. */
export function withDocHeader(text: string, header: string): string {
  const h = header.trim()
  if (!/^(\/\*[\s\S]*\*\/|(\/\/.*\n?)+)$/.test(h)) throw bad('the documentation header must be a comment block')
  return `${h}\n${splitHeader(text).rest}`
}

export interface Detected { id: string; name: string; match: number; evidence: string[]; builtin: boolean; error?: string }
/** Ask every adapter whether it knows this folder. Best match first. */
export async function detect(sourceDir: string): Promise<Detected[]> {
  const dir = existingDir(sourceDir)
  const found: Detected[] = []
  for (const a of await list()) {
    if (a.error) continue
    const { out } = await runAdapter(a.file, 'detect', dir)
    const r = (out.result || {}) as { match?: number; evidence?: string[] }
    found.push({ id: a.id, name: a.name, builtin: a.builtin, match: out.ok ? Number(r.match) || 0 : 0, evidence: out.ok ? r.evidence || [] : [], ...(out.ok ? {} : { error: out.error }) })
  }
  return found.sort((x, y) => y.match - x.match)
}

function existingDir(p: string): string {
  if (!p || !isAbsolute(p)) throw bad('the source folder must be an absolute path')
  if (!existsSync(p) || !statSync(p).isDirectory()) throw bad(`not a folder: ${p}`)
  return realpathSync(p)
}

// ----- writing an adapter with Claude (docs/ADR-008, decision 7) -----

export interface DraftPreview { source: string; total_files: number; dirs: { path: string; files: number }[]; sample: string[]; texts: { path: string; bytes: number; sent_bytes: number }[]; spec_bytes: number }
const TEXT_NAME = /(^|\/)(README[^/]*|MANIFEST\.json|00_READ_ME[^/]*|01_PATHS[^/]*|[^/]*SETUP[^/]*\.md|[^/]*GUIDE[^/]*\.md|[^/]*CONTRACT[^/]*\.md)$/i
const MAX_TEXT = 12 * 1024, MAX_TEXTS = 4, MAX_SCAN = 200000

function scanFolder(root: string) {
  const files: { path: string; bytes: number }[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (files.length >= MAX_SCAN) return
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) files.push({ path: full.slice(root.length + 1).split(sep).join('/'), bytes: statSync(full).size })
    }
  }
  walk(root)
  return files
}

/** What would be sent to the model: folder names with file counts (three levels), a sample of file names, and a few small text files (README, manifest) cut to 12 KB. Never media, never anything else. */
export function draftPreview(sourceDir: string): DraftPreview & { _texts: { path: string; text: string }[] } {
  const root = existingDir(sourceDir)
  const files = scanFolder(root)
  const dirs = new Map<string, number>()
  for (const f of files) { const parts = f.path.split('/').slice(0, -1); for (let n = 1; n <= Math.min(3, parts.length); n++) { const k = parts.slice(0, n).join('/'); dirs.set(k, (dirs.get(k) || 0) + 1) } }
  const texts = files.filter((f) => TEXT_NAME.test(f.path) && f.path.split('/').length <= 2 && f.bytes > 0 && f.bytes <= 4 * 1024 * 1024).slice(0, MAX_TEXTS)
  const _texts = texts.map((f) => ({ path: f.path, text: readFileSync(join(root, f.path), 'utf8').slice(0, MAX_TEXT) }))
  const step = Math.max(1, Math.floor(files.length / 60))
  return {
    source: root, total_files: files.length,
    dirs: [...dirs.entries()].sort().slice(0, 200).map(([path, n]) => ({ path, files: n })),
    sample: files.filter((_, i) => i % step === 0).slice(0, 60).map((f) => f.path),
    texts: texts.map((f, i) => ({ path: f.path, bytes: f.bytes, sent_bytes: _texts[i].text.length })),
    spec_bytes: spec().length, _texts,
  }
}

const DRAFT_SYSTEM = 'You write import adapters for an app that maps a package folder onto a ComfyUI-Shared structure, and NOTHING else: no other files, no config, no scripts, no shell commands, no edits to anything that exists. Reply with ONE complete ES module (.mjs) in a single ```javascript code block and nothing else. The module MUST begin with a documentation header, a /** ... */ comment before `export default` with these lines: What it does, Detects, Maps (source path -> destination), Leaves in place, Needs / assumes, Limits; the header must describe what the code below it actually does. Follow the spec exactly: default-export { id, name, version, detect(root, ctx), plan(root, ctx) }; use only ctx for reading; return ops as data; never import fs or the network; keep source-relative paths; leave everything else in place and report what you could not place.'

export interface AskOptions { model?: string; fetchImpl?: typeof fetch }
/** One call to the Messages API with the Anthropic key from Settings. The text of the reply; an error with the API's own message. */
export async function askClaude(system: string, user: string, maxTokens: number, opts: AskOptions): Promise<{ text: string; model: string }> {
  const key = settings.lookup('ANTHROPIC_API_KEY')
  if (!key) throw bad('No Anthropic API key: set it in Default Configuration, or use your own coding agent (adapter_spec)')
  const model = opts.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
  const res = await (opts.fetchImpl || fetch)(`${settings.anthropicBase()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  })
  const body = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } }
  if (!res.ok) throw bad(`Anthropic answered ${res.status}: ${body.error?.message || 'no detail'}`)
  return { text: (body.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('\n'), model }
}

export const emptyPreview = (): ReturnType<typeof draftPreview> => ({ source: '', total_files: 0, dirs: [], sample: [], texts: [], spec_bytes: 0, _texts: [] })
export const folderMaterial = (pv: ReturnType<typeof draftPreview>) => [
  `# The folder (${pv.total_files} files)`, '## Folders (with file counts)', pv.dirs.map((d) => `${d.path}/  ${d.files} files`).join('\n'),
  '## A sample of file names', pv.sample.join('\n'),
  ...pv._texts.flatMap((t) => [`## ${t.path}`, t.text]),
].join('\n\n')

/** The structure an adapter module must have, checked without running it (nothing is run): a default export with a string id and name and detect/plan functions, reading only through `ctx`. Returns what is wrong; empty means the module is well formed. The plan it returns is checked when it is tested on a folder (validateOps). */
export function validateSource(text: string, id?: string): string[] {
  const errs: string[] = []
  if (!/export\s+default/.test(text)) errs.push('there is no `export default { ... }`')
  const m = /\bid\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)
  if (!m) errs.push("there is no `id: '...'` (a string)")
  else {
    if (!ID.test(m[1])) errs.push(`the id "${m[1]}" must be lowercase letters, digits and dashes (at most 63)`)
    if (id && m[1] !== id) errs.push(`the id is "${m[1]}" but it must be "${id}"`)
  }
  if (!/\bname\s*:\s*['"`]/.test(text)) errs.push("there is no `name: '...'` (a string)")
  for (const fn of ['detect', 'plan']) if (!new RegExp(`\\b${fn}\\s*[(:]`).test(text)) errs.push(`there is no ${fn}(root, ctx) function`)
  if (!hasDocHeader(text)) errs.push('there is no documentation header: a comment block before `export default` saying what it does, what it detects, what it maps where, what it leaves in place, what it assumes and its limits')
  const banned: [RegExp, string][] = [
    [/from\s+['"](node:)?(fs|fs\/promises|child_process|net|http|https|dns|worker_threads|cluster|vm|os|process)['"]/, 'imports a Node module (read only through ctx)'],
    [/\bimport\s*\(/, 'uses a dynamic import()'], [/\brequire\s*\(/, 'uses require()'], [/\bfetch\s*\(/, 'calls fetch() (adapters have no network)'], [/\bprocess\./, 'touches process'],
  ]
  for (const [re, why] of banned) if (re.test(text)) errs.push(why)
  return errs
}

export interface DraftOptions extends AskOptions {
  id?: string
  /** What the person tells Claude about this folder or what to change (their prompt). */
  instruction?: string
  /** What was wrong with the last draft: validateSource's errors, then what testing it on the folder reported. */
  errors?: string[]
  /** The adapter prompt (ADR-009): the text the module is built from. When given, it is the source of truth for the build. */
  prompt?: string
  /** A display name to give the module. */
  name?: string
}

/** Ask Claude for an adapter for this folder and save it (it is listed in Default Configuration with its code open to read). Called again with `instruction` and the last `errors`, it rewrites the draft it saved last time under the same id: the loop is the person's prompting until the structure validates. Needs the Anthropic key from Settings. */
export async function draft(sourceDir: string | null, opts: DraftOptions = {}): Promise<{ adapter: AdapterInfo; model: string; valid: boolean; errors: string[]; ignored: number }> {
  if (!settings.lookup('ANTHROPIC_API_KEY')) throw bad('No Anthropic API key: set it in Default Configuration, or write the adapter with your own coding agent (adapter_spec)')
  if (!sourceDir && !opts.id) throw bad('an adapter id is needed when no folder is attached')
  const pv = sourceDir ? draftPreview(sourceDir) : emptyPreview()
  const id = opts.id || `draft-${basename(pv.source).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'folder'}`
  if (!ID.test(id)) throw bad('the adapter id is lowercase letters, digits and dashes (at most 63)')
  const file = join(adaptersDir(), `${id}.mjs`)
  const previous = opts.errors?.length || opts.instruction || opts.prompt ? (existsSync(file) ? readFileSync(file, 'utf8') : '') : ''
  const parts = ['# The adapter spec', spec(), folderMaterial(pv)]
  if (previous) parts.push('# The draft you wrote last time', '```javascript\n' + previous + '\n```')
  if (opts.errors?.length) parts.push('# What is wrong with it (fix these)', opts.errors.map((e) => `- ${e}`).join('\n'))
  if (opts.prompt?.trim()) parts.push('# The adapter prompt: the source of truth. Build exactly what it says; where it is silent, follow the spec.', opts.prompt.trim().slice(0, 16000))
  if (opts.instruction?.trim()) parts.push('# What the person asks of you', opts.instruction.trim().slice(0, 4000))
  parts.push(`Write the complete adapter with id "${id}". Map this format onto the ComfyUI-Shared structure.`)
  const { text, model } = await askClaude(DRAFT_SYSTEM, parts.join('\n\n'), 8000, opts)
  // The rule (docs/ADR-008, .claude/rules/claude-writes-adapters-only.md): Claude's reply can become ONE file, <adapters>/<id>.mjs, the id
  // chosen here and never read from the reply. Any other code block, file name or instruction in the reply is dropped and counted.
  const blocks = [...text.matchAll(/```[a-z]*\s*\n([\s\S]*?)```/g)].map((m) => m[1])
  let code = blocks[0] ?? text
  if (opts.name && /export\s+default/.test(code)) { try { code = setName(code, opts.name) } catch { /* the module has no name to set; validateSource says so */ } }
  if (!/export\s+default/.test(code)) throw bad('The reply did not contain an adapter module (no export default)')
  const errors = validateSource(code, id)
  return { adapter: await save(id, code), model, valid: errors.length === 0, errors, ignored: Math.max(0, blocks.length - 1) }
}

/** The prompt that writes a shot pack's description when a folder is attached (docs/ADR-008, decision 11). */
export const DESCRIBE_SYSTEM = 'You write text only, never files or code. You describe delivery packages ("shot packs") of ComfyUI work for a VFX pipeline operator who is about to import one. Write 3 to 6 plain sentences, no headings, no lists, no markdown. Say what the pack is (which film or job, who it is for, when it was built), which shots it holds and what each shot is, what kinds of files it carries (inputs the graphs load, workflows, node packs, finals, provenance), what the graphs need to run (ComfyUI version, node packs, provider keys), and anything the READMEs flag as open, failing or pending. Use only what the material below says; if something is not in it, do not guess. Do not invent file names or numbers.'

/** A short description of the shot pack in this folder, written by Claude from the folder\'s names and its small READMEs and manifests (the same material draftPreview shows; no media). */
export async function describe(sourceDir: string, opts: AskOptions = {}): Promise<{ description: string; model: string; sent: { files: number; dirs: number; texts: string[] } }> {
  const pv = draftPreview(sourceDir)
  const { text, model } = await askClaude(DESCRIBE_SYSTEM, folderMaterial(pv), 700, opts)
  const description = text.trim()
  if (!description) throw bad('Claude returned no description')
  return { description, model, sent: { files: pv.total_files, dirs: pv.dirs.length, texts: pv.texts.map((t) => t.path) } }
}

// ----- checking a plan -----

/** A relative, forward-slash path with no `..`, no absolute part. Returns the clean form or throws. */
function cleanRel(p: unknown, what: string): string {
  if (typeof p !== 'string' || !p || p.includes('\0')) throw bad(`${what}: a path is missing`)
  if (isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.startsWith('\\')) throw bad(`${what}: ${p} is not relative`)
  const n = normalize(p).split(sep).join('/')
  if (n === '..' || n.startsWith('../') || n.split('/').includes('..') || n === '.') throw bad(`${what}: ${p} leaves its folder`)
  return n
}

function validateOps(raw: unknown): Op[] {
  if (!Array.isArray(raw)) throw bad('the adapter did not return an ops list')
  return raw.map((o, i) => {
    const at = `op ${i}`
    if (!o || typeof o !== 'object') throw bad(`${at}: not an object`)
    const op = o as Op
    if (!OPS.includes(op.op)) throw bad(`${at}: unknown op ${String(op.op)}`)
    if (!KINDS.includes(op.kind)) throw bad(`${at}: unknown kind ${String(op.kind)}`)
    const clean: Op = { op: op.op, kind: op.kind }
    if (op.op === 'copy' || op.op === 'link' || op.op === 'verify') clean.from = cleanRel(op.from, at)
    else if (op.from !== undefined) clean.from = cleanRel(op.from, at)
    if (op.op === 'copy' || op.op === 'link' || op.op === 'placeholder') {
      clean.to = cleanRel(op.to, at)
      if (!TARGET_DIRS.includes(clean.to.split('/')[0])) throw bad(`${at}: ${clean.to} is outside ${TARGET_DIRS.join('/, ')}/`)
    }
    if (op.sha256 !== undefined) { if (typeof op.sha256 !== 'string' || !SHA.test(op.sha256)) throw bad(`${at}: sha256 is not 64 hex digits`); clean.sha256 = op.sha256.toLowerCase() }
    if (op.op === 'verify' && !clean.sha256) throw bad(`${at}: verify needs a sha256`)
    if (typeof op.bytes === 'number' && op.bytes >= 0) clean.bytes = op.bytes
    if (typeof op.note === 'string') clean.note = op.note.slice(0, 2000)
    return clean
  })
}

function validateFindings(raw: unknown): Finding[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw bad('findings must be a list')
  return raw.map((f) => ({ level: (['info', 'warn', 'problem'] as const).includes((f as Finding)?.level) ? (f as Finding).level : 'info', text: String((f as Finding)?.text ?? '').slice(0, 1000), ...(typeof (f as Finding)?.path === 'string' ? { path: (f as Finding).path } : {}) }))
}

function summarise(ops: Op[]): PlanSummary {
  const s: PlanSummary = { copies: 0, links: 0, notes: 0, bytes: 0, by_kind: {} }
  for (const o of ops) {
    if (o.op === 'copy' || o.op === 'link') {
      if (o.op === 'copy') { s.copies++; s.bytes += o.bytes || 0 } else s.links++
      const k = (s.by_kind[o.kind] ||= { files: 0, bytes: 0 }); k.files++; k.bytes += o.op === 'copy' ? o.bytes || 0 : 0
    } else if (o.op === 'note') s.notes++
  }
  return s
}

/** Plan an import: the adapter named, or the best match, run fenced; its ops checked. Writes nothing. */
export async function plan(sourceDir: string, adapterId?: string, options: Record<string, unknown> = {}): Promise<Plan> {
  const dir = existingDir(sourceDir)
  const all = await list()
  let chosen: AdapterInfo | undefined
  if (adapterId) {
    chosen = all.find((a) => a.id === adapterId)
    if (!chosen) throw bad(`no adapter ${adapterId}; one of ${all.map((a) => a.id).join(', ')}`)
  } else {
    const best = (await detect(dir))[0]
    if (!best || best.match < 0.5) throw bad(`no adapter recognises ${dir}; write one (docs/IMPORT-ADAPTERS.md) or pick one with --adapter`)
    chosen = all.find((a) => a.id === best.id)!
  }
  if (chosen.error) throw bad(`${chosen.id} failed to load: ${chosen.error}`)
  const { out, fenced } = await runAdapter(chosen.file, 'plan', dir, options)
  if (!out.ok) throw bad(`${chosen.id}: ${out.error}`)
  const r = (out.result || {}) as { ops?: unknown; findings?: unknown }
  const ops = validateOps(r.ops)
  return { adapter: { id: chosen.id, name: chosen.name, version: chosen.version, builtin: chosen.builtin }, source: dir, ops, findings: validateFindings(r.findings), summary: summarise(ops), fenced }
}

// ----- applying a plan -----

/** The mapped ComfyUI-Shared folder on this PC: where an import lands. */
export function targetFolder(): string {
  const t = mounts.load().folders['comfy-shared']
  if (!t) throw bad('ComfyUI-Shared is not mapped on this PC: map it in Configuration first, or pass a target folder')
  return t
}

const within = (root: string, p: string) => p === root || p.startsWith(root + sep)

/** The real path of the nearest existing ancestor of `p`, so a link cannot lead a write out of the target. */
function realAncestor(p: string): string {
  let cur = p
  while (!existsSync(cur)) { const up = dirname(cur); if (up === cur) break; cur = up }
  return realpathSync(cur)
}

export type SyncAfter =
  | { action: 'sync'; request: { pod_id: string; direction: 'push'; only: string[]; skip_renders: boolean } }
  | { action: 'skip'; why: 'no-pod' | 'no-volume' | 'simulated'; configure: boolean }

/** After an import: should ComfyUI-Shared be synced to this pod, and if not, why not (docs/ADR-008). Sync needs a real pod and a network volume; no volume is a configuration to fix (`configure`), a simulated pod or no pod is not. */
export function syncAfter(podId?: string | null): SyncAfter {
  if (!podId) return { action: 'skip', why: 'no-pod', configure: false }
  const cfg = mounts.load()
  if (!cfg.network_volume_id) return { action: 'skip', why: 'no-volume', configure: true }
  if (mounts.dryRun(cfg) || podId.startsWith('dry-')) return { action: 'skip', why: 'simulated', configure: false }
  return { action: 'sync', request: { pod_id: podId, direction: 'push', only: ['comfy-shared'], skip_renders: true } }
}

export interface ApplyOptions { target?: string; dryRun?: boolean; overwrite?: boolean; onProgress?: (done: number, total: number, op: Op) => void }

/** Apply a plan from `plan()`. Dry run: nothing is read in full or written; it says what would happen. */
export async function apply(p: Plan, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const ops = validateOps(p.ops)   // never trust a plan that crossed a process or a wire
  const source = existingDir(p.source)
  const targetArg = opts.target || targetFolder()
  mkdirSync(targetArg, { recursive: true })
  const target = realpathSync(targetArg)
  const dry = !!opts.dryRun
  const results: ApplyResult['results'] = []
  const counts: Record<string, number> = {}
  const put = (i: number, status: OpStatus, detail?: string) => { results.push({ i, status, ...(detail ? { detail } : {}) }); counts[status] = (counts[status] || 0) + 1 }

  for (let i = 0; i < ops.length; i++) {
    const o = ops[i]
    opts.onProgress?.(i, ops.length, o)
    try {
      if (o.op === 'note') { put(i, 'noted', o.note); continue }
      const src = o.from ? resolve(source, o.from) : ''
      if (o.from) {
        if (!within(source, src)) throw new Error(`${o.from} leaves the source folder`)
        if (!existsSync(src)) { put(i, 'error', `${o.from} is not in the source folder`); continue }
        if (!within(source, realpathSync(src))) throw new Error(`${o.from} leads out of the source folder`)
      }
      if (o.op === 'verify') { put(i, (await sha256File(src)) === o.sha256 ? 'verified' : 'hash-mismatch', o.from); continue }
      const dest = resolve(target, o.to!)
      if (!within(target, dest) || !within(target, realAncestor(dirname(dest)))) throw new Error(`${o.to} leaves ComfyUI-Shared`)

      if (o.op === 'placeholder') {
        if (existsSync(dest)) { put(i, 'same', o.to); continue }
        if (!dry) { mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, o.note ?? '') }
        put(i, dry ? 'would-copy' : 'placeholder', o.to); continue
      }
      if (o.op === 'link') {
        const real = realpathSync(src)
        if (existsSync(dest) || lstatSync(dest, { throwIfNoEntry: false })) {
          const same = lstatSync(dest).isSymbolicLink() && readlinkSync(dest) === real
          put(i, same ? 'same' : 'conflict', o.to); continue
        }
        if (!dry) { mkdirSync(dirname(dest), { recursive: true }); symlinkSync(real, dest) }
        put(i, dry ? 'would-link' : 'linked', o.to); continue
      }
      // copy
      const size = statSync(src).size
      let exists = existsSync(dest)
      if (exists && statSync(dest).isDirectory()) { put(i, 'conflict', `${o.to} is a folder`); continue }
      if (!dry && o.sha256 && (await sha256File(src)) !== o.sha256) { put(i, 'hash-mismatch', `${o.from} differs from its manifest; not copied`); continue }
      if (exists) {
        const same = statSync(dest).size === size && (dry || (await sha256File(dest)) === (o.sha256 || (await sha256File(src))))
        if (same) { put(i, 'same', o.to); continue }
        if (!opts.overwrite) { put(i, 'conflict', `${o.to} exists and differs`); continue }
        if (!dry) { copyFileSync(src, dest); put(i, 'replaced', o.to) } else put(i, 'would-replace', o.to)
        continue
      }
      if (!dry) { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(src, dest, constants.COPYFILE_FICLONE) }
      put(i, dry ? 'would-copy' : 'copied', o.to)
    } catch (e) { put(i, 'error', (e as Error).message) }
  }

  const ok = !(counts['conflict'] || counts['hash-mismatch'] || counts['error'])
  let record: string | null = null
  if (!dry) {
    mkdirSync(importsDir(), { recursive: true })
    record = join(importsDir(), `${new Date().toISOString().replace(/[:.]/g, '-')}-${p.adapter.id}.json`)
    writeFileSync(record, JSON.stringify({ at: new Date().toISOString(), adapter: p.adapter, source, target, overwrite: !!opts.overwrite, counts, findings: p.findings, summary: p.summary, problems: results.filter((r) => !['copied', 'same', 'linked', 'verified', 'noted', 'placeholder', 'replaced'].includes(r.status)) }, null, 2) + '\n')
  }
  return { dry_run: dry, ok, counts, results, record }
}
