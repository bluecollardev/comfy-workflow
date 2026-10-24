/**
 * Imports through adapters (docs/ADR-008, docs/IMPORT-ADAPTERS.md, docs/PLAN-IMPORT-ADAPTERS.md).
 *
 * An adapter maps one kind of source folder onto the ComfyUI-Shared structure. It plans (a list of
 * operations as data), in a child process fenced by Node's permission model; this module checks the
 * plan and applies it: only inside the source (reads) and ComfyUI-Shared (writes), never deleting,
 * never replacing a different file unless told. The source is never changed.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, constants, createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bad } from './errors.js'
import { adaptersDir, approvalsFile, importsDir } from './paths.js'
import * as mounts from './mounts.js'

export type OpName = 'copy' | 'link' | 'verify' | 'note' | 'placeholder'
export type OpKind = 'input' | 'workflow' | 'model' | 'node-pack' | 'reference' | 'manifest'
export interface Op { op: OpName; kind: OpKind; from?: string; to?: string; bytes?: number; sha256?: string; note?: string }
export interface Finding { level: 'info' | 'warn' | 'problem'; text: string; path?: string }
export interface AdapterInfo { id: string; name: string; version: number; builtin: boolean; file: string; sha256: string; approved: boolean; error?: string }
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

// ----- adapters: built-in and yours, with approval -----

function readApprovals(): Record<string, string> { try { return JSON.parse(readFileSync(approvalsFile(), 'utf8')) } catch { return {} } }

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

/** Built-in adapters, then yours. Yours are not imported until approved; an approved one is read again on every call (hot-loaded: a changed file needs approval again). */
export async function list(): Promise<AdapterInfo[]> {
  const approvals = readApprovals()
  const rows: AdapterInfo[] = []
  for (const file of builtinFiles()) {
    const { out } = await runAdapter(file, 'info', null)
    rows.push({ id: out.id || basename(file, '.mjs'), name: out.name || basename(file, '.mjs'), version: out.version ?? 1, builtin: true, file, sha256: await sha256File(file), approved: true, ...(out.ok ? {} : { error: out.error }) })
  }
  for (const file of userFiles()) {
    const id = basename(file, '.mjs'), sha = await sha256File(file)
    const approved = approvals[id] === sha
    let info: Ran = { ok: true, name: id }
    if (approved) info = (await runAdapter(file, 'info', null)).out
    rows.push({ id: (approved && info.id) || id, name: info.name || id, version: info.version ?? 1, builtin: false, file, sha256: sha, approved, ...(info.ok ? {} : { error: info.error }) })
  }
  return rows
}

/** Approve one of your adapters as it is now (its hash). Shown the source first; any change needs approval again. */
export async function approve(id: string): Promise<AdapterInfo> {
  const row = userFiles().find((f) => basename(f, '.mjs') === id)
  if (!row) throw bad(`no adapter ${id} in ${adaptersDir()}`)
  const approvals = readApprovals(); approvals[id] = await sha256File(row)
  mkdirSync(dirname(approvalsFile()), { recursive: true }); writeFileSync(approvalsFile(), JSON.stringify(approvals, null, 2) + '\n')
  return (await list()).find((a) => a.file === row)!
}

/** The source of one of your adapters, for the approval screen. */
export function source(id: string): { id: string; sha256: string; text: string } {
  const file = userFiles().find((f) => basename(f, '.mjs') === id) || builtinFiles().find((f) => basename(f, '.mjs') === id)
  if (!file) throw bad(`no adapter ${id}`)
  const text = readFileSync(file, 'utf8')
  return { id, sha256: sha256Text(text), text }
}

/** Save an adapter module of yours (what an agent calls); a syntax check only, never run. It is unapproved until a person approves it. */
export async function save(id: string, text: string): Promise<AdapterInfo> {
  if (!ID.test(id)) throw bad('the adapter id is lowercase letters, digits and dashes (at most 63)')
  if (text.length > 512 * 1024) throw bad('the adapter is too large (512 KB at most)')
  if (builtinFiles().some((f) => basename(f, '.mjs') === id)) throw bad(`${id} is a built-in adapter`)
  mkdirSync(adaptersDir(), { recursive: true })
  const file = join(adaptersDir(), `${id}.mjs`)
  writeFileSync(file, text)
  const check = await new Promise<string>((ok) => {
    const c = spawn(process.execPath, ['--check', file], { env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }, stdio: ['ignore', 'ignore', 'pipe'] })
    let e = ''; c.stderr.on('data', (d) => { e += d }); c.on('close', (code) => ok(code === 0 ? '' : e.trim().split('\n').slice(0, 6).join('\n'))); c.on('error', (x) => ok(x.message))
  })
  if (check) { throw bad(`the adapter does not parse:\n${check}`) }
  const approvals = readApprovals(); delete approvals[id]
  mkdirSync(dirname(approvalsFile()), { recursive: true }); writeFileSync(approvalsFile(), JSON.stringify(approvals, null, 2) + '\n')
  return (await list()).find((a) => a.file === file)!
}

export interface Detected { id: string; name: string; match: number; evidence: string[]; builtin: boolean; error?: string }
/** Ask every approved adapter whether it knows this folder. Best match first. */
export async function detect(sourceDir: string): Promise<Detected[]> {
  const dir = existingDir(sourceDir)
  const found: Detected[] = []
  for (const a of await list()) {
    if (!a.approved || a.error) continue
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

/** Plan an import: the adapter named, or the best approved match, run fenced; its ops checked. Writes nothing. */
export async function plan(sourceDir: string, adapterId?: string, options: Record<string, unknown> = {}): Promise<Plan> {
  const dir = existingDir(sourceDir)
  const all = await list()
  let chosen: AdapterInfo | undefined
  if (adapterId) {
    chosen = all.find((a) => a.id === adapterId)
    if (!chosen) throw bad(`no adapter ${adapterId}; one of ${all.map((a) => a.id).join(', ')}`)
    if (!chosen.approved) throw bad(`${adapterId} has not been approved (or has changed since): read its source and approve it first`)
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
