/**
 * The Panama exchange bucket as an import source (docs/ADR-015, the Panama connection guide): delivery rounds sit under
 * rounds/<round>/ in one S3 bucket. This reads them with the AWS CLI and a named profile (default `panama`, the one the
 * guide has you put in ~/.aws/credentials), so the app stores no secret. A round is downloaded to a staging folder on
 * this PC, never into ComfyUI-Shared directly: the Import Shot Pack adapters take it from there like any package folder.
 * Read-only against the bucket: ls and cp from it, nothing written to it.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, normalize, relative } from 'node:path'
import { bad } from './errors.js'
import * as mounts from './mounts.js'
import { STAGED_ROUNDS } from './paths.js'
import * as settings from './settings.js'

const val = (name: string, fallback: string) => settings.lookup(name) || fallback
export const profile = () => val('PANAMA_S3_PROFILE', settings.PANAMA_DEFAULTS.profile)
export const bucket = () => val('PANAMA_S3_BUCKET', settings.PANAMA_DEFAULTS.bucket)
export const region = () => val('PANAMA_S3_REGION', settings.PANAMA_DEFAULTS.region)
/** Where rounds are staged on this PC. */
export const stagingDir = () => {
  const set = settings.lookup('PANAMA_ROUNDS_DIR')
  if (set) return set
  const shared = mounts.load().folders['comfy-shared']   // inside the mapped ComfyUI-Shared, so everything is in one place
  return shared ? join(shared, STAGED_ROUNDS) : join(homedir(), STAGED_ROUNDS)   // ComfyUI-Shared/temp/rounds, or ~/temp/rounds with no mapping
}
const touch = (p: string) => writeFileSync(p, new Date().toISOString() + '\n')
const ROUND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/   // one folder name under rounds/: no slashes, no dots-only

/** The keys the app holds (Default Configuration) win; with none, the AWS profile named `panama` on this PC is the fallback. */
export const appKeys = () => { const id = settings.lookup('PANAMA_AWS_ACCESS_KEY_ID'), secret = settings.lookup('PANAMA_AWS_SECRET_ACCESS_KEY'); return id && secret ? { id, secret } : null }
const aws = (args: string[]) => [...(appKeys() ? [] : ['--profile', profile()]), '--region', region(), ...args]
/** The environment an aws call runs in: the app's keys in the standard variables, never on the command line. */
export const awsEnv = (): NodeJS.ProcessEnv => {
  const k = appKeys()
  if (!k) return process.env
  // The app's keys win over any profile the shell has set: UNSET the profile variables. An empty AWS_PROFILE is not "none", the CLI looks for a profile named "".
  const { AWS_PROFILE: _p, AWS_DEFAULT_PROFILE: _d, AWS_SESSION_TOKEN: _t, ...rest } = process.env
  return { ...rest, AWS_ACCESS_KEY_ID: k.id, AWS_SECRET_ACCESS_KEY: k.secret, AWS_REGION: region() }
}

/** The command for listing the rounds, as data so it can be tested without a bucket. */
export const listCmd = () => ['aws', 's3', 'ls', `s3://${bucket()}/rounds/`, ...aws([])]
export const sizeCmd = (round: string) => ['aws', 's3', 'ls', `s3://${bucket()}/rounds/${round}/`, '--recursive', '--summarize', ...aws([])]
export const pullCmd = (round: string, dest: string) => ['aws', 's3', 'sync', `s3://${bucket()}/rounds/${round}/`, dest, ...aws([])]   // sync, not cp: a stopped or cancelled download carries on over what is already there; no --delete, ever

function run(cmd: string[], timeoutMs = 60_000) {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: awsEnv() })
  if (r.error) throw bad(r.error.message.includes('ENOENT') ? 'The AWS CLI (aws) is not installed on this PC: brew install awscli.' : r.error.message)
  return r
}

/** Is Panama configured: the AWS CLI is there and the profile exists. The only thing the picker looks at. */
export function status() {
  if (appKeys()) return { configured: true, via: 'app keys', profile: profile(), bucket: bucket(), region: region(), staging: stagingDir(), reason: '' }
  const r = spawnSync('aws', ['configure', 'list-profiles'], { encoding: 'utf8', timeout: 15_000 })
  if (r.error || r.status !== 0) return { configured: false, via: 'none', profile: profile(), bucket: bucket(), region: region(), staging: stagingDir(), reason: r.error ? 'The AWS CLI (aws) is not installed.' : 'The AWS CLI could not list its profiles.' }
  const has = r.stdout.split('\n').map((s) => s.trim()).includes(profile())
  return { configured: has, via: has ? 'aws profile' : 'none', profile: profile(), bucket: bucket(), region: region(), staging: stagingDir(), reason: has ? '' : `No Panama keys: enter them in Default Configuration (or add an AWS profile named "${profile()}").` }
}

/** What is on this PC for a round: nothing, some of it, all of it but never checked, or all of it and verified (the done marker). */
export interface Staged { state: 'none' | 'partial' | 'unverified' | 'complete'; present: number; expected: number | null; missing: number | null }
export interface Round { name: string; staged: boolean; state: Staged['state']; present: number; expected: number | null; missing: number | null; bytes: number }
/** Bytes under a folder (what Delete would free). */
const dirBytes = (d: string): number => { let n = 0; try { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); n += e.isDirectory() ? dirBytes(f) : e.isFile() ? statSync(f).size : 0 } } catch { /* not there */ } return n }
const countFiles = (d: string): number => { let n = 0; try { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) n += countFiles(join(d, e.name)); else if (!e.name.startsWith('.panama-pull')) n++ } } catch { /* not there */ } return n }
/** Cheap (existence and size, no hashing) so the list can show it for every round: a folder with some files is `partial`, with every listed file present and the right size but no marker `unverified`. */
export function stagedState(round: string): Staged {
  const dir = join(stagingDir(), round)
  if (!existsSync(dir)) return { state: 'none', present: 0, expected: null, missing: null }
  const l = listedFiles(dir)
  if (existsSync(join(dir, '.panama-pull.done'))) { const n = l ? l.files.size : countFiles(dir); return { state: 'complete', present: n, expected: n, missing: 0 } }
  if (!l || l.files.size === 0) { const n = countFiles(dir); return { state: n ? 'partial' : 'none', present: n, expected: null, missing: null } }
  let present = 0
  for (const f of l.files.values()) { try { if (statSync(join(dir, f.path)).size === f.bytes) present++ } catch { /* missing */ } }
  const expected = l.files.size
  return { state: present === expected ? 'unverified' : 'partial', present, expected, missing: expected - present }
}
export function rounds(): Round[] {
  const r = run(listCmd())
  if (r.status !== 0) throw bad(`Could not list the bucket: ${(r.stderr || r.stdout).trim().split('\n').pop()}`)
  return r.stdout.split('\n').map((l) => /^\s*PRE (.+)\/\s*$/.exec(l)?.[1]).filter((n): n is string => !!n && ROUND.test(n))
    .map((name) => { const st = stagedState(name); return { name, staged: st.state === 'complete', ...st, bytes: st.state === 'none' ? 0 : dirBytes(join(stagingDir(), name)) } })
}

/** Files and bytes under one round (a listing, so a big round takes a few seconds). */
export function size(round: string) {
  if (!ROUND.test(round)) throw bad(`Not a round name: ${round}`)
  const r = run(sizeCmd(round), 120_000)
  if (r.status !== 0) throw bad(`Could not size ${round}: ${(r.stderr || r.stdout).trim().split('\n').pop()}`)
  const files = Number(/Total Objects:\s*(\d+)/.exec(r.stdout)?.[1] ?? 0)
  const bytes = Number(/Total Size:\s*(\d+)/.exec(r.stdout)?.[1] ?? 0)
  return { round, files, bytes }
}

// ----- pulling: one job per round, in this process, polled -----
export interface Verify { listed: number; bad: string[]; extra: number; kind?: string; ok: boolean }
export interface PullJob { id: string; round: string; dest: string; state: 'running' | 'verifying' | 'done' | 'failed' | 'cancelled'; files: number; lines: string[]; error?: string; verify?: Verify }
const jobs = new Map<string, PullJob>()
const children = new Map<string, ReturnType<typeof spawn>>()

export function pull(round: string): PullJob {
  if (!ROUND.test(round)) throw bad(`Not a round name: ${round}`)
  const running = [...jobs.values()].find((j) => j.round === round && j.state === 'running')
  if (running) return running
  const dest = join(stagingDir(), round)
  mkdirSync(dest, { recursive: true })
  const cmd = pullCmd(round, dest)
  const job: PullJob = { id: `${round}-${Date.now()}`, round, dest, state: 'running', files: 0, lines: [] }
  jobs.set(job.id, job)
  const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env: awsEnv() })
  children.set(job.id, child)
  const onData = (buf: Buffer) => {
    for (const l of buf.toString().split(/\r|\n/).filter(Boolean)) {
      if (/^download:/.test(l)) job.files++
      job.lines.push(l); if (job.lines.length > 200) job.lines.shift()
    }
  }
  child.stdout.on('data', onData); child.stderr.on('data', onData)
  child.on('error', (e) => { job.state = 'failed'; job.error = e.message })
  child.on('close', (code) => {
    children.delete(job.id)
    if (job.state === 'cancelled') return   // stopped on request: what was fetched stays, a new Download carries on from it
    if (code !== 0) { if (job.state === 'running') { job.state = 'failed'; job.error = `aws exited ${code}: ${job.lines.slice(-1)[0] ?? ''}` } return }
    // Downloaded; now what the guide says to do before anything reads a round: check every file against its MANIFEST.json.
    job.state = 'verifying'
    verify(dest).then((v) => {
      job.verify = v
      if (v.ok) { job.state = 'done'; try { touch(join(dest, '.panama-pull.done')) } catch { /* the folder is there either way */ } }
      else { job.state = 'failed'; job.error = v.listed === 0 ? 'No MANIFEST.json file list in this round, so it cannot be verified.' : `${v.bad.length} file(s) do not match the manifest: ${v.bad.slice(0, 3).join('; ')}` }
    }).catch((e) => { job.state = 'failed'; job.error = String(e?.message || e) })
  })
  return job
}

const sha256 = (path: string) => new Promise<string>((res, rej) => {
  const h = createHash('sha256'); const s = createReadStream(path)
  s.on('data', (b) => h.update(b)); s.on('error', rej); s.on('end', () => res(h.digest('hex')))
})
interface Listed { path: string; bytes: number; sha256: string }

/** verify_round.py in TypeScript (the Panama console's scripts/panama-gen/migration): every file the round's MANIFEST.json lists is
 *  present, the same size and the same sha256. The root manifest may list all files; older rounds list them per shot too. Files
 *  on disk that no manifest lists are counted, never touched. */
/** The files a staged round's manifests list (root file list plus per-shot ones), or null when the root manifest is not there yet. */
function listedFiles(root: string): { files: Map<string, Listed>; kind?: string } | null {
  const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
  const rootManifest = join(root, 'MANIFEST.json')
  if (!existsSync(rootManifest)) return null
  let m: { files?: Listed[]; shots?: Record<string, unknown>; kind?: string }
  try { m = read(rootManifest) } catch { return null }   // a manifest cut short by an interrupted download
  const files = new Map<string, Listed>()
  for (const f of (m.files || []) as Listed[]) files.set(normalize(f.path), f)
  for (const shot of Object.keys(m.shots || {})) {
    const sm = join(root, shot, 'MANIFEST.json')
    if (existsSync(sm)) { try { for (const f of (read(sm).files || []) as Listed[]) if (!files.has(normalize(f.path))) files.set(normalize(f.path), f) } catch { /* that shot's manifest is not whole yet */ } }
  }
  return { files, kind: m.kind }
}

export async function verify(root: string): Promise<Verify> {
  const l = listedFiles(root)
  if (!l) return { listed: 0, bad: [], extra: 0, ok: false }
  const { files } = l
  const m = { kind: l.kind }
  const bad: string[] = []
  for (const f of files.values()) {
    const p = join(root, f.path)
    if (!existsSync(p)) bad.push(`MISSING ${f.path}`)
    else if (statSync(p).size !== f.bytes) bad.push(`SIZE ${f.path}`)
    else if ((await sha256(p)) !== f.sha256) bad.push(`SHA256 ${f.path}`)
  }
  let extra = 0
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const full = join(d, e.name)
    if (e.isDirectory()) walk(full)
    else { const rel = normalize(relative(root, full)); if (!files.has(rel) && e.name !== 'MANIFEST.json' && !e.name.startsWith('.panama-pull')) extra++ }
  } }
  walk(root)
  return { listed: files.size, bad, extra, kind: m.kind, ok: files.size > 0 && bad.length === 0 }
}

/** Delete a round's staged copy on THIS PC (ComfyUI-Shared/temp/rounds/<round>) to free disk. Never touches the bucket, a pod, or anything outside the staging folder:
 *  the name must be one folder name, the resolved path must sit directly inside the staging folder, and a running download of it blocks the delete. */
export function remove(round: string): { round: string; freed: number } {
  if (!ROUND.test(round)) throw bad(`Not a round name: ${round}`)
  if ([...jobs.values()].some((j) => j.round === round && ['running', 'verifying'].includes(j.state))) throw bad(`${round} is downloading: cancel it first.`)
  const root = stagingDir(), dir = join(root, round)
  if (!existsSync(dir)) return { round, freed: 0 }
  const real = realpathSync(dir), realRoot = realpathSync(root)
  if (dirname(real) !== realRoot) throw bad(`Refusing to delete ${dir}: it is not directly inside the staging folder ${root}.`)
  const freed = dirBytes(real)
  rmSync(real, { recursive: true, force: true })
  return { round, freed }
}

/** Stop a running download. The files already fetched stay; Download again carries on from them (sync skips what is complete). */
export function cancel(id: string): PullJob {
  const j = jobs.get(id)
  if (!j) throw bad(`No download ${id}`)
  if (j.state !== 'running') return j   // done, failed, verifying (hashing cannot be cut short) or already cancelled
  j.state = 'cancelled'
  j.error = undefined
  children.get(id)?.kill('SIGTERM')
  return j
}

export const job = (id: string) => jobs.get(id) ?? null
