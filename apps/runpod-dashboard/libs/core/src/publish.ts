/**
 * Publishing (docs/ADR-050): send finished outputs (a render's review video, proxies, anything under the local ComfyUI-Shared output/) to an S3
 * bucket and announce them in Slack. Files leave this PC, so it is ALWAYS a person's explicit act: a named approver on every run, a plan first,
 * no default destination, never model weights. Secrets (S3 keys, the Slack webhook) live only in the app's .env and are never returned, logged or
 * put in an error. Everything here is async: it runs in Electron's main process.
 */
import { lstat, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, dirname, join, posix } from 'node:path'
import { bad, CoreError } from './errors.js'
import * as history from './history.js'
import * as mounts from './mounts.js'
import * as panama from './panama.js'
import * as podpull from './podpull.js'
import * as rp from './runpod.js'
import * as sync from './sync.js'
import { presign } from './s3presign.js'
import { configDir } from './paths.js'
import * as settingsEnv from './settings.js'
import * as syncrun from './syncrun.js'

// ----- the defaults baked into the code: NON-SECRET only (the app ships on a public repository) -----
export const DEFAULT_MESSAGE = 'Approved by {approved_by} on {date}\n{count} file(s), {size}\nDestination: {dest}\n{files}\n{links}'
export const DESTINATION_NOTE = 'Lucas, 2026-11-19: Panama exchange bucket, returns/BKK/'
export const PUBLISH_DEFAULTS = {
  s3: { bucket: '', prefix: 'returns/BKK/', region: '', endpoint: '', credentials: 'panama' as 'app' | 'panama', presign_hours: 72, transfer: 'auto' as Transfer },   // the bucket is the Panama exchange bucket's setting (not a second copy here), see effective()
  slack: { channel: '', username: 'RunPod Manager', workspace_name: 'Beinghuman', workspace_url: 'https://beinghuman-hq.slack.com' },
  defaults: { targets: [] as Target[], message: DEFAULT_MESSAGE },
}
export type Target = 's3' | 'slack'
/** How a file that lives only on the volume reaches the bucket (ADR-050, amendment: transfer adapters): `auto` uses a running pod on the volume when there is one, else this PC; `pod` insists on the pod; `pc` streams through this PC. */
export type Transfer = 'auto' | 'pod' | 'pc'
export const TRANSFERS: Transfer[] = ['auto', 'pod', 'pc']
/** A presigned PUT is good for an hour (it only has to be valid when the upload starts); one is made per file, just before it, and one S3 object takes at most 5 GiB in a single PUT. */
export const PUT_EXPIRES_S = 3600, PUT_MAX_BYTES = 5 * 1024 ** 3 - 1, PROBE_MS = 20_000
export const WEIGHT_EXT = ['.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf', '.onnx', '.pkl']
export const isWeight = (name: string): boolean => WEIGHT_EXT.some((e) => name.toLowerCase().endsWith(e))
export const WEIGHTS_REASON = `Model weights are never published (${WEIGHT_EXT.join(' ')})`
export const NEEDS_NAME = 'Publishing needs the name of who says yes (approved_by)'
export const MAX_FILES = 20_000, LIST_CAP = 2000, KEEP_JOBS = 20, SLACK_FILES = 10, STALL_MS = 300_000, TEST_MS = 10_000, SLACK_MS = 15_000
export const TEST_MESSAGE = 'RunPod Manager: test message'
const TITLE = '*Published from RunPod Manager*'

interface Stored { s3?: Partial<typeof PUBLISH_DEFAULTS.s3>; slack?: Partial<typeof PUBLISH_DEFAULTS.slack>; defaults?: { targets?: Target[]; message?: string } }
export interface PublicSettings {
  s3: { bucket: string; prefix: string; region: string; endpoint: string; credentials: 'app' | 'panama'; access_key_hint: string; presign_hours: number; transfer: Transfer; ready: boolean; problem?: string; /** documentation, not a gate: who confirmed the default destination */ note?: string; destination_confirmed?: string }
  slack: { channel: string; username: string; workspace_name: string; workspace_url: string; webhook_hint: string; ready: boolean; problem?: string }
  defaults: { targets: Target[]; message: string }
}

// ----- dependencies (injectable; tests give fakes: no S3, no Slack, no real files outside a scratch folder) -----
export interface Deps {
  now(): number
  aws: podpull.AwsRunner
  fetch: typeof fetch
  /** the local ComfyUI-Shared output/ folder, or null when none is mapped */
  outputRoot(): string | null
  parallel(): number
  /** the volume the backfill scans (the Shared volume, else the network volume) */
  volumeId(): string
  volumeKeys(volumeId: string, prefix: string): Promise<{ key: string; bytes: number; modified?: string }[] | null>
  volumeAccess(volumeId: string): Promise<{ ok: true; id: string; secret: string; endpoint: string; bucket: string; region: string } | { ok: false; reason: string }>
  /** start a process (the two ends of a streamed copy); tests give fakes */
  spawn(cmd: string, args: string[], env: Record<string, string>): ChildProcess
  /** a RUNNING pod attached to the volume that the app can reach over SSH, or null. Reads only: nothing here ever creates, resumes or stops a pod. */
  podOnVolume(volumeId: string): Promise<PodRef | null>
  /** run a script on a pod over SSH (the script goes on stdin) */
  ssh: podpull.SshRunner
}
export interface PodRef { id: string; name: string; host: string; port: number }
const defaults = (): Deps => ({
  now: () => Date.now(),
  aws: (a, e, o) => podpull.defaultAws(a, e, o),
  fetch: (u, i) => fetch(u, i),
  outputRoot: () => { const r = mounts.folderRows(mounts.load()).find((x) => x.key === 'comfy-shared')?.local; return r ? join(r, 'output') : null },
  parallel: () => syncrun.parallelFor(''),
  volumeId: () => { const c = mounts.load(); return (c.shared_volume_id || c.network_volume_id || '').trim() },
  volumeKeys: (v, prefix) => podpull.listVolumeKeys(v, prefix, { recursive: true }),
  volumeAccess: (v) => podpull.s3ReadAccess(v),
  spawn: (cmd, args, env) => nodeSpawn(cmd, args, { env: { ...process.env, ...env, AWS_EC2_METADATA_DISABLED: 'true' }, stdio: ['pipe', 'pipe', 'pipe'] }),
  podOnVolume: async (volumeId) => {
    try {
      if (mounts.dryRun(mounts.load())) return null
      for (const raw of await rp.listPods()) {
        if ((raw.networkVolumeId || '') !== volumeId || (raw.name || '').startsWith(podpull.POD_PREFIX) || (raw.runtime?.uptimeInSeconds ?? 0) <= 0) continue
        try { return { id: raw.id, name: raw.name || raw.id, ...sync.sshTarget(raw) } } catch { continue }
      }
    } catch { /* RunPod unreachable or no key: no pod */ }
    return null
  },
  ssh: (j) => podpull.runSsh(j),
})
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

// ----- settings: non-secret fields in publish.json, secrets in the .env -----
const cfgFile = () => process.env.PUBLISH_FILE || join(configDir(), 'publish.json')
const jobsFile = () => process.env.PUBLISH_JOBS_FILE || join(configDir(), 'publish-jobs.json')
async function readJson<T>(file: string, fallback: T): Promise<T> { try { const j = JSON.parse(await readFile(file, 'utf8')); return j && typeof j === 'object' ? j : fallback } catch { return fallback } }
async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 1), { mode: 0o600 }); await rename(tmp, file)
}
const secret = (n: (typeof settingsEnv.PUBLISH_SECRETS)[number]): string => settingsEnv.lookup(n)
const slackHostAllowed = (host: string): boolean => host === 'hooks.slack.com' || (process.env.PUBLISH_SLACK_HOST_ALLOW ?? '').split(',').map((s) => s.trim()).filter(Boolean).includes(host)

const norm = (p: string): string => { const t = p.trim().replace(/^\/+/, ''); return t ? `${t.replace(/\/+$/, '')}/` : '' }
function check(field: string, v: unknown): string {
  if (typeof v !== 'string') throw bad(`${field} must be text`)
  const t = v.trim()
  switch (field) {
    case 's3.bucket': if (t && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(t)) throw bad('s3.bucket is a bucket name: lower case letters, digits, dots and hyphens, 3 to 63 characters'); return t
    case 's3.prefix': {
      if (t.startsWith('/')) throw bad('s3.prefix must not start with a slash')
      if (t.split('/').includes('..')) throw bad('s3.prefix must not contain ..')
      if (t.length > 200) throw bad('s3.prefix is at most 200 characters'); return norm(t)
    }
    case 's3.region': if (t && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(t)) throw bad('s3.region is a region like us-west-2'); return t
    case 's3.endpoint': {
      if (!t) return ''
      let u: URL; try { u = new URL(t) } catch { throw bad('s3.endpoint is an https URL') }
      if (u.protocol !== 'https:' || u.username || u.password) throw bad('s3.endpoint is an https URL with no user name or password in it'); return t.replace(/\/+$/, '')
    }
    case 'slack.channel': if (t && !/^#[a-z0-9][a-z0-9._-]{0,79}$/.test(t)) throw bad('slack.channel is a channel like #renders'); return t
    case 'slack.username': if (t.length > 80) throw bad('slack.username is at most 80 characters'); return t
    case 'slack.workspace_name': if (t.length > 80) throw bad('slack.workspace_name is at most 80 characters'); return t
    case 'slack.workspace_url': {
      if (!t) return ''
      let u: URL; try { u = new URL(t) } catch { throw bad('slack.workspace_url is an https URL on slack.com') }
      if (u.protocol !== 'https:' || !(u.hostname === 'slack.com' || u.hostname.endsWith('.slack.com')) || u.username || u.password) throw bad('slack.workspace_url is an https URL on slack.com, like https://yourteam.slack.com')
      return `${u.origin}`
    }
    case 'defaults.message': if (t.length > 3000) throw bad('defaults.message is at most 3000 characters'); return v
  }
  return t
}

/** With Panama credentials and no bucket (or region) saved, the Panama exchange settings supply them: one place holds that name. */
function panamaFill<T extends { credentials: 'app' | 'panama'; bucket: string; region: string }>(s3: T): T {
  if (s3.credentials !== 'panama') return s3
  return { ...s3, bucket: s3.bucket || panama.bucket(), region: s3.region || panama.region() }
}
async function effective(): Promise<{ s3: typeof PUBLISH_DEFAULTS.s3 & { credentials: 'app' | 'panama' }; slack: typeof PUBLISH_DEFAULTS.slack; defaults: { targets: Target[]; message: string } }> {
  const st = await readJson<Stored>(cfgFile(), {})
  const pick = <T extends object>(base: T, over: Partial<T> | undefined): T => { const o = { ...base }; for (const [k, v] of Object.entries(over ?? {})) if (v !== undefined && v !== '' && k in base) (o as Record<string, unknown>)[k] = v; return o }
  const targets = (st.defaults?.targets ?? []).filter((t): t is Target => t === 's3' || t === 'slack')
  return {
    s3: panamaFill(pick({ ...PUBLISH_DEFAULTS.s3 }, st.s3)), slack: pick({ ...PUBLISH_DEFAULTS.slack }, st.slack),
    defaults: { targets, message: typeof st.defaults?.message === 'string' && st.defaults.message ? st.defaults.message : PUBLISH_DEFAULTS.defaults.message },
  }
}
const s3Problem = (c: Awaited<ReturnType<typeof effective>>['s3']): string | undefined => {
  if (!c.bucket) return 'Add the bucket (Settings > Publishing)'
  if (!c.region && c.credentials !== 'panama') return 'Add the bucket\'s region, like us-west-2'
  if (c.credentials === 'app' && !(secret('PUBLISH_S3_ACCESS_KEY_ID') && secret('PUBLISH_S3_SECRET_ACCESS_KEY'))) return 'Add the S3 access key id and secret key'
  if (c.credentials === 'panama' && !panama.appKeys()) return 'Add the Panama AWS keys (Settings > Panama) or separate keys'
  return undefined
}
const slackProblem = (c: Awaited<ReturnType<typeof effective>>['slack']): string | undefined =>
  secret('PUBLISH_SLACK_WEBHOOK_URL') ? undefined : `Add the Incoming Webhook URL for ${c.workspace_name || 'Slack'} (Slack: Apps > Incoming Webhooks)`

/** What the window shows. The secrets never come back, only the last four characters. */
export async function settings(): Promise<PublicSettings> {
  const e = await effective(), sp = s3Problem(e.s3), lp = slackProblem(e.slack)
  const saved = await readJson<Stored>(cfgFile(), {}), usesDefault = e.s3.credentials === 'panama' && !saved.s3?.bucket
  return {
    s3: { bucket: e.s3.bucket, prefix: e.s3.prefix, region: e.s3.region, endpoint: e.s3.endpoint, credentials: e.s3.credentials, access_key_hint: settingsEnv.secretHint(secret('PUBLISH_S3_ACCESS_KEY_ID')), presign_hours: e.s3.presign_hours, transfer: e.s3.transfer, ready: !sp, ...(sp ? { problem: sp } : {}), ...(usesDefault ? { note: DESTINATION_NOTE, destination_confirmed: DESTINATION_NOTE } : {}) },
    slack: { channel: e.slack.channel, username: e.slack.username, workspace_name: e.slack.workspace_name, workspace_url: e.slack.workspace_url, webhook_hint: settingsEnv.secretHint(secret('PUBLISH_SLACK_WEBHOOK_URL')), ready: !lp, ...(lp ? { problem: lp } : {}) },
    defaults: e.defaults,
  }
}

export interface SettingsInput {
  s3?: { bucket?: string; prefix?: string; region?: string; endpoint?: string; credentials?: string; presign_hours?: number; transfer?: string; access_key_id?: string; secret_access_key?: string }
  slack?: { channel?: string; username?: string; workspace_name?: string; workspace_url?: string; webhook_url?: string }
  defaults?: { targets?: string[]; message?: string }
  clear?: ('s3_keys' | 'slack_webhook')[]
}
/** Save. A text field set to '' goes back to its default; a secret omitted or empty keeps the stored one (`clear` removes it). Validation names the field. */
export async function setSettings(input: SettingsInput): Promise<PublicSettings> {
  const i = input ?? {}, st = await readJson<Stored>(cfgFile(), {}), changedNames: string[] = [], secrets: Partial<Record<(typeof settingsEnv.PUBLISH_SECRETS)[number], string>> = {}
  const put = <S extends 's3' | 'slack'>(sec: S, key: string, v: unknown) => {
    if (v === undefined) return
    const val = v === null ? '' : check(`${sec}.${key}`, v)
    const o = ((st[sec] ??= {}) as Record<string, unknown>)
    if (val === '') delete o[key]; else o[key] = val
    changedNames.push(`${sec}.${key}`)
  }
  for (const k of ['bucket', 'prefix', 'region', 'endpoint'] as const) put('s3', k, i.s3?.[k])
  for (const k of ['channel', 'username', 'workspace_name', 'workspace_url'] as const) put('slack', k, i.slack?.[k])
  if (i.s3?.credentials !== undefined) {
    if (i.s3.credentials !== 'app' && i.s3.credentials !== 'panama') throw bad("s3.credentials is 'app' or 'panama'")
    ;(st.s3 ??= {}).credentials = i.s3.credentials; changedNames.push('s3.credentials')
  }
  if (i.s3?.presign_hours !== undefined) {
    const h = i.s3.presign_hours
    if (!(typeof h === 'number' && Number.isInteger(h) && h >= 1 && h <= 168)) throw bad('s3.presign_hours is a whole number from 1 to 168 (SigV4 allows 7 days at most)')
    ;(st.s3 ??= {}).presign_hours = h; changedNames.push('s3.presign_hours')
  }
  if (i.s3?.transfer !== undefined) {
    if (!TRANSFERS.includes(i.s3.transfer as Transfer)) throw bad("s3.transfer is 'auto', 'pod' or 'pc'")
    const o = (st.s3 ??= {}); if (i.s3.transfer === 'auto') delete o.transfer; else o.transfer = i.s3.transfer as Transfer
    changedNames.push('s3.transfer')
  }
  if (i.defaults?.targets !== undefined) {
    const t = i.defaults.targets
    if (!Array.isArray(t) || t.some((x) => x !== 's3' && x !== 'slack')) throw bad("defaults.targets is a list of 's3' and 'slack'")
    ;(st.defaults ??= {}).targets = [...new Set(t)] as Target[]; changedNames.push('defaults.targets')
  }
  if (i.defaults?.message !== undefined) { const m = check('defaults.message', i.defaults.message); const d = (st.defaults ??= {}); if (m.trim()) d.message = m; else delete d.message; changedNames.push('defaults.message') }
  // secrets: the value is never part of an error
  const idv = i.s3?.access_key_id, sec = i.s3?.secret_access_key
  if (idv !== undefined && idv !== '') { if (typeof idv !== 'string' || /\s/.test(idv.trim()) || idv.trim().length < 8 || idv.trim().length > 128) throw bad('s3.access_key_id looks wrong (8 to 128 characters, no spaces)'); secrets.PUBLISH_S3_ACCESS_KEY_ID = idv.trim(); changedNames.push('s3.access_key_id') }
  if (sec !== undefined && sec !== '') { if (typeof sec !== 'string' || /\s/.test(sec.trim()) || sec.trim().length < 16 || sec.trim().length > 256) throw bad('s3.secret_access_key looks wrong (16 to 256 characters, no spaces)'); secrets.PUBLISH_S3_SECRET_ACCESS_KEY = sec.trim(); changedNames.push('s3.secret_access_key') }
  const hook = i.slack?.webhook_url
  if (hook !== undefined && hook !== '') {
    let u: URL | null = null; try { u = new URL(String(hook).trim()) } catch { /* below */ }
    if (!u || u.protocol !== 'https:' || u.username || u.password || !slackHostAllowed(u.hostname)) throw bad('slack.webhook_url is an https Incoming Webhook URL from hooks.slack.com')
    secrets.PUBLISH_SLACK_WEBHOOK_URL = String(hook).trim(); changedNames.push('slack.webhook_url')
  }
  for (const c of i.clear ?? []) {
    if (c === 's3_keys') { secrets.PUBLISH_S3_ACCESS_KEY_ID = ''; secrets.PUBLISH_S3_SECRET_ACCESS_KEY = ''; changedNames.push('s3 keys cleared') }
    else if (c === 'slack_webhook') { secrets.PUBLISH_SLACK_WEBHOOK_URL = ''; changedNames.push('slack webhook cleared') }
    else throw bad("clear is a list of 's3_keys' and 'slack_webhook'")
  }
  if (changedNames.length) {
    await writeJson(cfgFile(), st)
    settingsEnv.writePublishSecrets(secrets)
    history.record({ kind: 'change', area: 'configuration', action: 'publishing settings changed', what: 'publishing', detail: changedNames.join(', ') })
  }
  return settings()
}

// ----- redaction: no secret, and no URL, ever reaches a message, log, History entry or error -----
/** The presigned PUT URLs of the files under way: a credential, held here only so redact() can strike them from any text, and dropped the moment the file is done. */
const liveUrls = new Set<string>()
export function redact(text: string): string {
  let t = String(text)
  for (const n of settingsEnv.PUBLISH_SECRETS) { const v = secret(n); if (v) t = t.split(v).join('•••') }
  const pk = panama.appKeys(); for (const v of [pk?.id, pk?.secret, ...liveUrls]) if (v) t = t.split(v).join('•••')
  return t.replace(/https?:\/\/\S+/gi, '<url>').replace(/X-Amz-(?:Signature|Credential|Security-Token)=[^&\s"']*/gi, '•••')
}

// ----- AWS access for the destination -----
interface DestAccess { env: Record<string, string>; common: string[]; bucket: string; prefix: string; presign_hours: number; region: string; endpoint: string; transfer: Transfer; /** the keys a presigned PUT is signed with, here only: null when the AWS CLI uses a profile */ keys: { id: string; secret: string } | null }
async function s3Access(): Promise<DestAccess> {
  const e = { ...(await effective()).s3 }
  const common = ['--region', e.region, ...(e.endpoint ? ['--endpoint-url', e.endpoint] : [])]
  const base = { bucket: e.bucket, prefix: e.prefix, presign_hours: e.presign_hours, region: e.region, endpoint: e.endpoint, transfer: e.transfer }
  if (e.credentials === 'panama') {
    const k = panama.appKeys()
    return { ...base, env: k ? { AWS_ACCESS_KEY_ID: k.id, AWS_SECRET_ACCESS_KEY: k.secret, AWS_REGION: e.region } : {}, common: [...common, ...(k ? [] : ['--profile', panama.profile()])], keys: k }
  }
  const id = secret('PUBLISH_S3_ACCESS_KEY_ID'), sec = secret('PUBLISH_S3_SECRET_ACCESS_KEY')
  return { ...base, env: { AWS_ACCESS_KEY_ID: id, AWS_SECRET_ACCESS_KEY: sec, AWS_REGION: e.region }, common, keys: id && sec ? { id, secret: sec } : null }
}
const awsText = (r: podpull.AwsResult): string => r.transient ? podpull.STORAGE_UNREACHABLE : redact((r.stderr || r.stdout).trim().split('\n').pop() || `aws exited ${r.code}`)
const timeout = (ms: number) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) } }

export async function test(o: { target?: string }): Promise<{ ok: boolean; detail: string }> {
  const target = o?.target
  if (target !== 's3' && target !== 'slack') throw bad("target is 's3' or 'slack'")
  const s = await settings()
  if (target === 's3') {
    if (!s.s3.ready) return { ok: false, detail: s.s3.problem ?? 'S3 is not configured' }
    const a = await s3Access(), t = timeout(TEST_MS)
    try {
      const ls = await deps.aws(['s3', 'ls', `s3://${a.bucket}/${a.prefix}`, ...a.common], a.env, { signal: t.signal, stallMs: TEST_MS })
      const empty = ls.code === 1 && !ls.stdout.trim() && !ls.stderr.trim()
      if (ls.code !== 0 && !empty) return { ok: false, detail: t.signal.aborted ? 'S3 did not answer within 10 seconds' : awsText(ls) }
      const head = await deps.aws(['s3api', 'list-objects-v2', '--bucket', a.bucket, '--prefix', a.prefix, '--max-items', '1', ...a.common], a.env, { signal: t.signal, stallMs: TEST_MS })
      if (head.code !== 0) return { ok: false, detail: t.signal.aborted ? 'S3 did not answer within 10 seconds' : awsText(head) }
      return { ok: true, detail: `The bucket ${a.bucket} answers; ${ls.stdout.trim() ? 'the prefix has files in it' : 'the prefix is empty'} (nothing was written)` }
    } finally { t.done() }
  }
  if (!s.slack.ready) return { ok: false, detail: s.slack.problem ?? 'Slack is not configured' }
  const r = await postSlack(TEST_MESSAGE)
  return r.ok ? { ok: true, detail: `Posted the test message to ${s.slack.workspace_name}${s.slack.channel ? `: ${s.slack.channel}` : ''}` } : { ok: false, detail: r.error }
}

/** One HTTPS POST of the JSON to the webhook: 15 s timeout, one retry on a network error. Errors say what happened, never where. */
async function postSlack(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const e = await effective(), hook = secret('PUBLISH_SLACK_WEBHOOK_URL')
  if (!hook) return { ok: false, error: slackProblem(e.slack) ?? 'Slack is not configured' }
  const body = JSON.stringify({ text, username: e.slack.username, ...(e.slack.channel ? { channel: e.slack.channel } : {}) })
  let last = 'Slack did not answer'
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = timeout(SLACK_MS)
    try {
      const res = await deps.fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: t.signal })
      if (res.ok) return { ok: true }
      const msg = redact(await res.text().catch(() => '')).slice(0, 80)
      return { ok: false, error: `Slack answered ${res.status}${msg ? ` (${msg})` : ''}` }   // an answer: not retried
    } catch { last = t.signal.aborted ? 'Slack did not answer within 15 seconds' : 'Slack could not be reached (the connection failed)' } finally { t.done() }
  }
  return { ok: false, error: last }
}

// ----- the local tree -----
const yieldLoop = () => new Promise<void>((r) => setImmediate(r))
export interface LocalEntry { name: string; path: string; dir: boolean; bytes: number; modified: string; weight: boolean }
const cleanRel = (p: unknown): string | null => {
  if (typeof p !== 'string') return null
  const t = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (t.includes('\0') || t.startsWith('/') || /^[A-Za-z]:/.test(t) || t.split('/').some((x) => x === '..' || x === '')) return t === '' ? '' : null
  return t
}
const root = (): string => { const r = deps.outputRoot(); if (!r) throw bad('The ComfyUI-Shared folder is not mapped on this PC (Default Configuration): there is no local output/ to publish from'); return r }
/** Refuses a path whose folders (not just the last part) are links: a link could lead outside output/. */
async function assertNoLinks(base: string, rel: string): Promise<void> {
  let cur = base
  for (const part of rel.split('/').filter(Boolean)) { cur = join(cur, part); const s = await lstat(cur); if (s.isSymbolicLink()) throw bad('A link in that path is not followed') }
}
export async function local(o: { dir?: string } = {}): Promise<{ dir: string; parent: string; entries: LocalEntry[]; truncated?: number }> {
  const dir = cleanRel(o?.dir ?? '')
  if (dir === null) throw bad('dir is a folder inside output/ (no .. and no leading slash)')
  const base = root()
  try { await assertNoLinks(base, dir) } catch (e) { if (e instanceof CoreError) throw e; throw new CoreError(404, `${dir || 'output'} is not on this PC`) }
  let names: import('node:fs').Dirent[]
  try { names = await readdir(join(base, dir), { withFileTypes: true }) } catch { throw new CoreError(404, `${dir || 'output'} is not on this PC`) }
  const visible = names.filter((d) => !d.isSymbolicLink()).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  const cut = visible.slice(0, LIST_CAP), entries: LocalEntry[] = []
  for (let i = 0; i < cut.length; i += 100) {
    entries.push(...await Promise.all(cut.slice(i, i + 100).map(async (d) => {
      const s = await lstat(join(base, dir, d.name)).catch(() => null)
      return { name: d.name, path: dir ? `${dir}/${d.name}` : d.name, dir: d.isDirectory(), bytes: d.isDirectory() ? 0 : s?.size ?? 0, modified: s ? s.mtime.toISOString() : '', weight: !d.isDirectory() && isWeight(d.name) }
    })))
    await yieldLoop()
  }
  return { dir, parent: dir.includes('/') ? posix.dirname(dir) : '', entries, ...(visible.length > LIST_CAP ? { truncated: visible.length - LIST_CAP } : {}) }
}

// ----- plan -----
export interface PlanItem { path: string; bytes: number; s3_key: string; skip: 'same size already there' | 'weights' | 'missing' | null; /** where the file is read from: this PC (default) or the volume, streamed through this PC */ source?: 'pc' | 'volume'; source_key?: string }
export type ItemIn = string | { where: 'volume'; path: string }
export interface Plan {
  ok: boolean; blockers: string[]; items: PlanItem[]; total_bytes: number; files: number
  s3: { dest: string; count: number; new_bytes: number } | null
  slack: { channel: string; to: string; preview: string } | null
  refused: { path: string; reason: string }[]
  /** files that go from the volume through this PC (nothing is copied here) */ streamed_files: number; streamed_bytes: number
}
export interface PlanRequest { items?: unknown /* ItemIn[] */; targets?: unknown; message?: string; shot_hint?: string; approved_by?: string }
const targetsOf = (t: unknown): Target[] => {
  if (!Array.isArray(t) || !t.length || t.some((x) => x !== 's3' && x !== 'slack')) throw bad("targets is a list of 's3' and/or 'slack'")
  return [...new Set(t)] as Target[]
}
export const fmtSize = (b: number): string => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`

interface MsgInfo { first: { path: string; bytes: number; key: string }[]; count: number; bytes: number; dest: string }
export function renderMessage(template: string, o: { approved_by: string; info: MsgInfo; links?: { path: string; url: string }[]; date: string }): string {
  const linkOf = new Map((o.links ?? []).map((l) => [l.path, l.url]))
  const files = o.info.first.map((f) => `• ${basename(f.path)} (${fmtSize(f.bytes)})`).join('\n') + (o.info.count > o.info.first.length ? `\n…and ${o.info.count - o.info.first.length} more` : '')
  const links = o.links ? o.info.first.filter((f) => linkOf.has(f.path)).map((f) => `<${linkOf.get(f.path)}|${basename(f.path)}>`).join('\n') : '(links appear after the upload)'
  const body = template.replace(/\{(approved_by|count|size|dest|files|links|date)\}/g, (_m, k: string) => ({ approved_by: o.approved_by, count: String(o.info.count), size: fmtSize(o.info.bytes), dest: o.info.dest, files, links, date: o.date } as Record<string, string>)[k])
  return `${TITLE}\n${body}${template.includes('{approved_by}') ? '' : `\nApproved by ${o.approved_by}`}`.trim()
}

// ----- the volume's output/ (read-only, over the app's RunPod S3 access) -----
export const VOLUME_OUTPUT = 'comfy-shared/output/'
type VolAccess = { ok: true; id: string; secret: string; endpoint: string; bucket: string; region: string } | { ok: false; reason: string }
const volumeAccess = async (): Promise<VolAccess> => { const v = deps.volumeId(); return v ? deps.volumeAccess(v) : { ok: false, reason: 'No Shared or network volume is set (Default Configuration)' } }
/** One `aws s3 ls` of a volume prefix: its sub-folders and files (a recursive listing has the files only, with full keys). */
async function volLs(a: Extract<VolAccess, { ok: true }>, prefix: string, recursive: boolean, signal?: AbortSignal): Promise<{ dirs: string[]; files: { key: string; bytes: number; modified: string }[] }> {
  const r = await deps.aws(['s3', 'ls', `s3://${a.bucket}/${prefix}`, ...(recursive ? ['--recursive'] : []), '--endpoint-url', a.endpoint, '--region', a.region], { AWS_ACCESS_KEY_ID: a.id, AWS_SECRET_ACCESS_KEY: a.secret }, { signal, stallMs: 90_000 })
  if (r.code !== 0 && !(r.code === 1 && !r.stdout.trim() && !r.stderr.trim())) throw new Error(podpull.s3Error(r).message)
  const dirs: string[] = [], files: { key: string; bytes: number; modified: string }[] = []
  for (const line of r.stdout.split('\n')) {
    const d = /^\s*PRE (.+)\/$/.exec(line); if (d) { dirs.push(d[1]); continue }
    const m = /^(\d{4}-\d\d-\d\d)\s+(\d\d:\d\d:\d\d)\s+(\d+)\s+(.+)$/.exec(line); if (!m) continue
    if (m[4].endsWith('/')) continue
    files.push({ key: recursive ? m[4] : `${prefix}${m[4]}`, bytes: Number(m[3]), modified: `${m[1]}T${m[2]}Z` })
  }
  return { dirs, files }
}
export interface VolumeEntry { name: string; path: string; dir: boolean; bytes: number | null; modified: string; weight: boolean; empty?: boolean }
/** ONE level of the volume's comfy-shared/output/ (never recursive): folders, files, and for each folder a quick one-key probe of whether it holds anything. Folder sizes are not computed (`volumeSize` does it on demand). */
export async function volume(o: { dir?: string } = {}): Promise<{ dir: string; parent: string; entries: VolumeEntry[]; truncated?: number }> {
  const dir = cleanRel(o?.dir ?? '')
  if (dir === null) throw bad('dir is a folder inside the volume output/ (no .., no leading slash)')
  const a = await volumeAccess(); if (!a.ok) throw new CoreError(409, a.reason)
  const base = `${VOLUME_OUTPUT}${dir ? `${dir}/` : ''}`
  let ls: Awaited<ReturnType<typeof volLs>>
  try { ls = await volLs(a, base, false) } catch (e) { throw new CoreError(502, redact((e as Error).message)) }
  const rel = (n: string) => (dir ? `${dir}/${n}` : n)
  const all: VolumeEntry[] = [
    ...ls.dirs.sort((x, y) => x.localeCompare(y)).map((n) => ({ name: n, path: rel(n), dir: true, bytes: null, modified: '', weight: false })),
    ...ls.files.map((f) => { const n = f.key.slice(base.length); return { name: n, path: rel(n), dir: false, bytes: f.bytes, modified: f.modified, weight: isWeight(n) } }).sort((x, y) => x.name.localeCompare(y.name)),
  ]
  const entries = all.slice(0, LIST_CAP)
  const dirsShown = entries.filter((e) => e.dir); let next = 0
  await Promise.all(Array.from({ length: Math.min(8, dirsShown.length) }, async () => { while (next < dirsShown.length) { const e = dirsShown[next++]; const empty = await podpull.probeEmpty(a, `${base}${e.name}/`, deps.aws, 3000); if (empty !== undefined) e.empty = empty } }))
  return { dir, parent: dir.includes('/') ? posix.dirname(dir) : '', entries, ...(all.length > LIST_CAP ? { truncated: all.length - LIST_CAP } : {}) }
}
const sizeCache = new Map<string, { at: number; value: { files: number; bytes: number } }>(), sizeRuns = new Map<string, AbortController>()
export const SIZE_TTL_MS = 5 * 60_000
/** What a volume folder holds: a recursive listing of its prefix, on demand (the picker's Measure link), cached 5 minutes, abortable with `volumeSizeCancel`. */
export async function volumeSize(o: { path?: string }): Promise<{ files: number; bytes: number; cached?: boolean }> {
  const rel = cleanRel(o?.path ?? ''); if (rel === null || rel === '') throw bad('path is a folder inside the volume output/')
  const hit = sizeCache.get(rel); if (hit && deps.now() - hit.at < SIZE_TTL_MS) return { ...hit.value, cached: true }
  const a = await volumeAccess(); if (!a.ok) throw new CoreError(409, a.reason)
  sizeRuns.get(rel)?.abort(); const ac = new AbortController(); sizeRuns.set(rel, ac)
  try {
    const ls = await volLs(a, `${VOLUME_OUTPUT}${rel}/`, true, ac.signal)
    if (ac.signal.aborted) throw new CoreError(499, 'Measuring was cancelled')
    const value = { files: ls.files.length, bytes: ls.files.reduce((x, f) => x + f.bytes, 0) }; sizeCache.set(rel, { at: deps.now(), value }); return value
  } catch (e) { if (e instanceof CoreError) throw e; throw new CoreError(ac.signal.aborted ? 499 : 502, ac.signal.aborted ? 'Measuring was cancelled' : redact((e as Error).message)) } finally { if (sizeRuns.get(rel) === ac) sizeRuns.delete(rel) }
}
export function volumeSizeCancel(o: { path?: string }): { cancelled: boolean } { const c = sizeRuns.get(cleanRel(o?.path ?? '') ?? ''); c?.abort(); return { cancelled: !!c } }

export async function plan(req: PlanRequest): Promise<Plan> {
  const targets = targetsOf(req?.targets)
  if (!Array.isArray(req.items) || !req.items.length) throw bad('items is a list of paths (files or folders) under the local output/')
  const e = await effective(), blockers: string[] = [], refused: Plan['refused'] = [], items: PlanItem[] = []
  const sp = s3Problem(e.s3), lp = slackProblem(e.slack)
  if (targets.includes('s3') && sp) blockers.push(`S3 is not configured: ${sp}`)
  if (targets.includes('slack') && lp) blockers.push(`Slack is not configured: ${lp}`)
  const rawItems = req.items as unknown[], dedup = new Map<string, unknown>(); for (const x of rawItems) dedup.set(typeof x === 'string' ? `l:${x}` : `v:${(x as { path?: string })?.path}`, x)
  const localItems = [...dedup.values()].filter((x) => typeof x === 'string'), volItems = [...dedup.values()].filter((x) => typeof x !== 'string')
  const base = localItems.length ? root() : '', prefix = e.s3.prefix
  const roots: { prefix: string; recursive: boolean }[] = []
  let capped = false
  const add = (rel: string, bytes: number, skip: PlanItem['skip'] = null) => items.push({ path: rel, bytes, s3_key: `${prefix}${rel}`, skip })
  const walk = async (rel: string): Promise<void> => {
    let ents: import('node:fs').Dirent[]
    try { ents = await readdir(join(base, rel), { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => a.name.localeCompare(b.name))
    for (const d of ents) {
      if (capped) return
      const p = `${rel}/${d.name}`
      if (d.isSymbolicLink()) { refused.push({ path: p, reason: 'A link is never followed' }); continue }
      if (d.isDirectory()) { await walk(p); continue }
      if (items.length >= MAX_FILES) { capped = true; return }
      const s = await lstat(join(base, p)).catch(() => null); if (!s) continue
      if (isWeight(d.name)) { refused.push({ path: p, reason: WEIGHTS_REASON }); add(p, s.size, 'weights') } else add(p, s.size)
      if (items.length % 500 === 0) await yieldLoop()
    }
  }
  for (const raw of localItems) {
    const rel = cleanRel(raw)
    if (rel === null || rel === '') { refused.push({ path: String(raw).slice(0, 200), reason: 'Not a path inside output/ (no .., no leading slash)' }); continue }
    let s: import('node:fs').Stats | null = null
    try { await assertNoLinks(base, dirname(rel) === '.' ? '' : dirname(rel)); s = await lstat(join(base, rel)) } catch (err) { if (err instanceof CoreError) { refused.push({ path: rel, reason: 'A link in that path is not followed' }); continue } }
    if (!s) { add(rel, 0, 'missing'); continue }
    if (s.isSymbolicLink()) { refused.push({ path: rel, reason: 'A link is never followed' }); continue }
    if (s.isDirectory()) { roots.push({ prefix: `${prefix}${rel}/`, recursive: true }); await walk(rel) }
    else { roots.push({ prefix: `${prefix}${posix.dirname(rel) === '.' ? '' : `${posix.dirname(rel)}/`}`, recursive: false }); if (isWeight(rel)) { refused.push({ path: rel, reason: WEIGHTS_REASON }); add(rel, s.size, 'weights') } else add(rel, s.size) }
    if (capped) break
  }
  // items on the volume: expanded by prefix over RunPod's S3 API, read-only; they are streamed through this PC when published
  if (volItems.length) {
    const valid: string[] = []
    for (const raw of volItems) {
      const o = raw as { where?: string; path?: unknown }, rel = o && typeof o === 'object' && o.where === 'volume' ? cleanRel(o.path) : null
      if (rel === null || rel === '') refused.push({ path: String(typeof o === 'object' ? (o as { path?: string })?.path ?? '' : o).slice(0, 200), reason: 'Not a path inside the volume output/ (items are a string, or { where: "volume", path } with no .. and no leading slash)' })
      else valid.push(rel)
    }
    const va = valid.length ? await volumeAccess() : null
    if (va && !va.ok) blockers.push(`The volume cannot be read: ${va.reason}`)
    else if (va) for (const rel of valid) {
      let found: { key: string; bytes: number }[] = []
      try {
        found = (await volLs(va, `${VOLUME_OUTPUT}${rel}/`, true)).files
        if (!found.length) {   // maybe a file
          const dir = posix.dirname(rel) === '.' ? '' : `${posix.dirname(rel)}/`, one = (await volLs(va, `${VOLUME_OUTPUT}${dir}`, false)).files.find((f) => f.key === `${VOLUME_OUTPUT}${rel}`)
          if (one) { found = [one]; roots.push({ prefix: `${prefix}${dir}`, recursive: false }) }
        } else roots.push({ prefix: `${prefix}${rel}/`, recursive: true })
      } catch (err) { blockers.push(`Could not read ${rel} on the volume: ${redact((err as Error).message)}`); continue }
      if (!found.length) { items.push({ path: rel, bytes: 0, s3_key: `${prefix}${rel}`, skip: 'missing', source: 'volume' }); continue }
      for (const f of found) {
        if (items.length >= MAX_FILES) { capped = true; break }
        const r = f.key.slice(VOLUME_OUTPUT.length), name = basename(r), weight = isWeight(name)
        if (weight) refused.push({ path: r, reason: WEIGHTS_REASON })
        items.push({ path: r, bytes: f.bytes, s3_key: `${prefix}${r}`, skip: weight ? 'weights' : null, source: 'volume', source_key: f.key })
        if (items.length % 500 === 0) await yieldLoop()
      }
    }
  }
  if (capped) blockers.push(`More than ${MAX_FILES.toLocaleString('en-US')} files: choose a smaller folder`)
  const sendable = items.filter((i) => i.skip === null || i.skip === 'same size already there')
  if (!items.some((i) => i.skip !== 'missing' && i.skip !== 'weights')) blockers.push('Nothing to publish: no files were found in what you chose')
  // what is already there: each destination prefix listed once (a folder recursively), never one call per file
  if (targets.includes('s3') && !sp && !blockers.length) {
    const a = await s3Access(), there = new Map<string, number>()
    const keep = roots.filter((r, i, all) => !all.some((o, j) => j !== i && o.recursive && o.prefix !== r.prefix && r.prefix.startsWith(o.prefix))).filter((r, i, all) => all.findIndex((x) => x.prefix === r.prefix && x.recursive === r.recursive) === i)
    for (const r of keep) {
      const ls = await deps.aws(['s3', 'ls', `s3://${a.bucket}/${r.prefix}`, ...(r.recursive ? ['--recursive'] : []), ...a.common], a.env, { stallMs: 60_000 })
      if (ls.code !== 0 && !(ls.code === 1 && !ls.stdout.trim() && !ls.stderr.trim())) { blockers.push(`Could not read the destination: ${awsText(ls)}`); break }
      for (const line of ls.stdout.split('\n')) {
        const m = /^\S+\s+\S+\s+(\d+)\s+(.+)$/.exec(line); if (!m) continue
        there.set(r.recursive ? m[2] : `${r.prefix}${m[2]}`, Number(m[1]))
      }
      await yieldLoop()
    }
    for (const it of items) if (it.skip === null && there.get(it.s3_key) === it.bytes) it.skip = 'same size already there'
  }
  const send = items.filter((i) => i.skip === null), real = items.filter((i) => i.skip !== 'missing' && i.skip !== 'weights')
  const total_bytes = real.reduce((a, i) => a + i.bytes, 0), dest = `s3://${e.s3.bucket || '(bucket)'}/${prefix}`
  const info: MsgInfo = { first: real.slice(0, SLACK_FILES).map((i) => ({ path: i.path, bytes: i.bytes, key: i.s3_key })), count: real.length, bytes: total_bytes, dest }
  const to = `${e.slack.workspace_name || 'Slack'}: ${e.slack.channel || "(the webhook's own channel)"}`
  const template = req.message?.trim() ? req.message : e.defaults.message
  void sendable
  return {
    ok: !blockers.length && !refused.length, blockers, items, total_bytes, files: real.length,
    streamed_files: send.filter((i) => i.source === 'volume').length, streamed_bytes: send.filter((i) => i.source === 'volume').reduce((a, i) => a + i.bytes, 0),
    s3: targets.includes('s3') ? { dest, count: send.length, new_bytes: send.reduce((a, i) => a + i.bytes, 0) } : null,
    slack: targets.includes('slack') ? { channel: e.slack.channel, to, preview: `To ${to}\n\n${renderMessage(template, { approved_by: req.approved_by?.trim() || '(the approver you name)', info, date: new Date(deps.now()).toISOString().slice(0, 10) })}` } : null,
    refused,
  }
}

// ----- jobs -----
export type JobState = 'queued' | 'uploading' | 'posting' | 'done' | 'done_with_warning' | 'failed' | 'cancelled'
export interface JobView {
  job_id: string; state: JobState; targets: Target[]; approved_by: string; started_at: string; finished_at: string
  files_total: number; files_done: number; bytes_total: number; bytes_done: number; rate_bps: number; current: string; skipped: number; dest: string
  links: { path: string; url: string; expires_at: string }[]; slack: { state: 'skipped' | 'sent' | 'failed'; error?: string }; error?: string; summary: string
  /** how the files that live on the volume got to the bucket: from a pod on the volume ('pod', with its name) or streamed through this PC ('pc'); `files` says which carried each one (and its sha256) */
  adapter: 'pod' | 'pc'; pod?: string; pod_files: number; pc_files: number; files: JobFile[]
}
export interface JobFile { path: string; adapter: 'pod' | 'pc'; sha256?: string; shot?: string }
interface Job { slackText?: string; view: JobView; abort: AbortController; info: MsgInfo; template: string; started: number; done: Promise<void> }
const jobs = new Map<string, Job>()
let finished: (JobView & { info?: MsgInfo; template?: string; slackText?: string })[] = []
let seq = 0
let loaded: Promise<void> | null = null
const iso = () => new Date(deps.now()).toISOString()
const copy = (v: JobView): JobView => ({ ...v, links: v.links.map((l) => ({ ...l })), slack: { ...v.slack }, files: (v.files ?? []).map((f) => ({ ...f })) })
const ensureLoaded = (): Promise<void> => (loaded ??= readJson<(JobView & { info?: MsgInfo })[]>(jobsFile(), []).then((j) => { if (Array.isArray(j) && !finished.length) finished = j.slice(0, KEEP_JOBS) }))
let writing: Promise<void> = Promise.resolve()
const persist = (): void => { writing = writing.then(() => writeJson(jobsFile(), finished.map((f) => ({ ...f, links: f.links.map((l) => ({ ...l, url: '' })) }))).catch(() => undefined)) }
export const settled = async (): Promise<void> => { for (const j of jobs.values()) await j.done; await writing }

/** From memory, instantly: running jobs first, then the newest finished. */
export function status(jobId?: string): { jobs: JobView[] } {
  void ensureLoaded()
  const all = [...[...jobs.values()].map((j) => j.view), ...finished]
  return { jobs: (jobId ? all.filter((v) => v.job_id === jobId) : all).map((v) => copy(v)) }
}
export function cancel(jobId: string): JobView {
  const j = jobs.get(jobId)
  if (!j) { const f = finished.find((v) => v.job_id === jobId); if (f) return copy(f); throw new CoreError(404, `No such publish job: ${jobId}`) }
  j.abort.abort(); return copy(j.view)
}

export interface RunRequest extends PlanRequest { approved_by?: string; trigger?: string }
export async function run(req: RunRequest): Promise<{ job_id: string }> {
  const who = (req?.approved_by ?? '').trim()
  if (!who) throw bad(NEEDS_NAME)
  const targets = targetsOf(req.targets)
  const p = await plan({ ...req, targets, approved_by: who })   // never trusts the page's plan
  if (p.refused.length) throw bad(`Cannot publish: ${p.refused.slice(0, 3).map((r) => `${r.path}: ${r.reason}`).join('; ')}${p.refused.length > 3 ? ` (and ${p.refused.length - 3} more)` : ''}`)
  if (p.blockers.length) throw bad(`Cannot publish: ${p.blockers.join('; ')}`)
  const e = await effective(), real = p.items.filter((i) => i.skip !== 'missing' && i.skip !== 'weights')
  const send = targets.includes('s3') ? p.items.filter((i) => i.skip === null) : []
  const id = `publish-${deps.now().toString(36)}-${(seq++).toString(36)}`
  const info: MsgInfo = { first: real.slice(0, SLACK_FILES).map((i) => ({ path: i.path, bytes: i.bytes, key: i.s3_key })), count: real.length, bytes: p.total_bytes, dest: p.s3?.dest ?? `s3://${e.s3.bucket || '(not uploaded)'}/${e.s3.prefix}` }
  const view: JobView = { job_id: id, state: 'queued', targets, approved_by: who, started_at: iso(), finished_at: '', files_total: send.length, files_done: 0, bytes_total: send.reduce((a, i) => a + i.bytes, 0), bytes_done: 0, rate_bps: 0, current: '', skipped: p.items.filter((i) => i.skip === 'same size already there').length, dest: info.dest, links: [], slack: { state: 'skipped' }, summary: '', adapter: 'pc', pod_files: 0, pc_files: 0, files: [] }
  const job: Job = { view, abort: new AbortController(), info, template: req.message?.trim() ? req.message : e.defaults.message, started: deps.now(), done: Promise.resolve() }
  jobs.set(id, job)
  job.done = go(job, send, targets, real.length === 0).catch((err) => { view.state = 'failed'; view.error = redact((err as Error).message) }).finally(() => end(job))
  return { job_id: id }
}

const UNITS: Record<string, number> = { Bytes: 1, Byte: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 }
/** The bytes an `aws s3 cp` has sent so far, from its last `Completed 5.0 MiB/1.2 GiB (...)` text; null when the chunk has none. */
export function parseProgress(chunk: string): number | null {
  let last: number | null = null
  for (const m of chunk.matchAll(/Completed (?:~)?([\d.]+) (Bytes?|[KMGT]iB)\//g)) last = Math.round(Number(m[1]) * (UNITS[m[2]] ?? 1))
  return last
}

async function go(job: Job, send: PlanItem[], targets: Target[], nothing: boolean): Promise<void> {
  const v = job.view, ac = job.abort
  void nothing
  const a = targets.includes('s3') ? await s3Access() : null
  if (a && send.length) {
    v.state = 'uploading'
    const t0 = deps.now(), partial = new Map<string, number>(); let next = 0, failure = ''
    const refresh = () => { v.bytes_done = [...partial.values()].reduce((x, y) => x + y, 0) + doneBytes; const s = (deps.now() - t0) / 1000; v.rate_bps = s > 0 ? Math.round(v.bytes_done / s) : 0 }
    let doneBytes = 0
    const pcList = send.filter((i) => i.source !== 'volume'), volList = send.filter((i) => i.source === 'volume')
    const src = volList.length ? await volumeAccess() : null
    if (src && !src.ok) throw new Error(`The volume cannot be read: ${redact(src.reason)}`)
    const route = volList.length ? await chooseRoute(a, v, ac.signal) : null
    const streamWorker = async () => {   // volume files: from a pod on the volume (transfer adapter 'pod') or two piped aws commands through this PC ('pc')
      while (!failure && !ac.signal.aborted) {
        const it = volList[nextVol++]; if (!it) return
        v.current = basename(it.path)
        const r = await volumeCopy(it, { a, s: src as Extract<VolAccess, { ok: true }>, route: route!, v, signal: ac.signal, onBytes: (n) => { partial.set(it.path, Math.min(n, it.bytes)); refresh() } })
        partial.delete(it.path)
        if (r.ok) { doneBytes += it.bytes; v.files_done++; refresh() } else if (!ac.signal.aborted) failure = `${basename(it.path)}: ${r.error}`
      }
    }
    let nextVol = 0
    const worker = async () => {
      while (!failure && !ac.signal.aborted) {
        const it = pcList[next++]; if (!it) return
        v.current = basename(it.path)
        const r = await deps.aws(['s3', 'cp', join(root(), it.path), `s3://${a.bucket}/${it.s3_key}`, ...a.common], a.env, {
          signal: ac.signal, stallMs: STALL_MS,   // silence for this long means stalled: per progress line, never a total time
          onData: (c) => { const n = parseProgress(c); if (n !== null) { partial.set(it.path, Math.min(n, it.bytes)); refresh() } },
        })
        partial.delete(it.path)
        if (r.code === 0) { doneBytes += it.bytes; v.files_done++; refresh() }
        else if (!ac.signal.aborted) failure = `${basename(it.path)}: ${awsText(r)}`
      }
    }
    await Promise.all([...Array.from({ length: pcList.length ? Math.max(1, Math.min(deps.parallel(), pcList.length)) : 0 }, worker), ...Array.from({ length: volList.length ? Math.max(1, Math.min(deps.parallel(), STREAM_MAX, volList.length)) : 0 }, streamWorker)])
    v.current = ''; settleAdapter(v)
    if (ac.signal.aborted) { v.state = 'cancelled'; v.summary = `Cancelled after ${v.files_done} of ${v.files_total} files`; return }
    if (failure) { v.state = 'failed'; v.error = failure; v.summary = `${v.files_done} of ${v.files_total} files uploaded; stopped at an error. Nothing was posted to Slack.`; return }
  }
  if (ac.signal.aborted) { v.state = 'cancelled'; return }
  let links: { path: string; url: string }[] | undefined
  if (a) {
    links = []; const exp = new Date(deps.now() + a.presign_hours * 3600_000).toISOString()
    for (const f of job.info.first) {
      const r = await deps.aws(['s3', 'presign', `s3://${a.bucket}/${f.key}`, '--expires-in', String(a.presign_hours * 3600), ...a.common], a.env, { signal: ac.signal, stallMs: 30_000 })
      const url = r.stdout.trim().split('\n')[0]
      if (r.code === 0 && url.startsWith('http')) { links.push({ path: f.path, url }); v.links.push({ path: f.path, url, expires_at: exp }) }
    }
  }
  if (targets.includes('slack')) {
    v.state = 'posting'
    const msg = job.slackText ?? renderMessage(job.template, { approved_by: v.approved_by, info: job.info, ...(links ? { links } : {}), date: iso().slice(0, 10) })
    const r = await postSlack(msg)
    v.slack = r.ok ? { state: 'sent' } : { state: 'failed', error: r.error }
  }
  const up = a ? `${v.files_done} file${v.files_done === 1 ? '' : 's'} uploaded${v.skipped ? `, ${v.skipped} already there` : ''} (${fmtSize(v.bytes_done)}) to ${v.dest}` : ''
  if (v.slack.state === 'failed') { v.state = a ? 'done_with_warning' : 'failed'; v.error = v.slack.error; v.summary = `${up}${up ? '. ' : ''}${a ? 'The files are up, but the Slack message failed: ' : 'The Slack message failed: '}${v.slack.error}. It can be sent again.` }
  else { v.state = 'done'; v.summary = `${up}${up && v.slack.state === 'sent' ? '; ' : ''}${v.slack.state === 'sent' ? 'posted to Slack' : ''}` }
}

/** Post the Slack message of a finished job again (after a failure). The links are made again. */
export async function slack(o: { job_id?: string }): Promise<{ job_id: string }> {
  await ensureLoaded()
  const f = finished.find((x) => x.job_id === o?.job_id)
  if (!f) throw new CoreError(404, `No such finished publish job: ${o?.job_id}`)
  if (!f.targets.includes('slack')) throw bad('That job did not ask for Slack')
  if (f.slack.state === 'sent') throw bad('The Slack message of that job was already sent')
  const info = f.info; if (!info) throw bad('That job has no file list to post (it is from before this version)')
  const v: JobView = { ...copy(f), job_id: f.job_id, state: 'posting', finished_at: '', error: undefined, links: [], slack: { state: 'skipped' } }
  const job: Job = { ...(f.slackText ? { slackText: f.slackText } : {}), view: v, abort: new AbortController(), info, template: f.template ?? (await effective()).defaults.message, started: deps.now(), done: Promise.resolve() }
  finished = finished.filter((x) => x.job_id !== f.job_id)
  jobs.set(v.job_id, job)
  const targets = f.targets.includes('s3') ? f.targets : f.targets
  job.done = go(job, [], targets, false).catch((err) => { v.state = 'failed'; v.error = redact((err as Error).message) }).finally(() => end(job, true))
  return { job_id: v.job_id }
}

function end(job: Job, again = false): void {
  const v = job.view; v.finished_at = iso()
  jobs.delete(v.job_id); finished.unshift({ ...copy(v), info: job.info, template: job.template, ...(job.slackText ? { slackText: job.slackText } : {}) }); finished.length = Math.min(finished.length, KEEP_JOBS)
  history.record({ kind: 'job', job: 'publish', state: v.state === 'cancelled' ? 'cancelled' : v.state === 'failed' ? 'failed' : 'done', started_at: v.started_at, what: `${again ? 'publish message again' : 'publish'} ${v.files_total} file${v.files_total === 1 ? '' : 's'} to ${v.targets.join(' + ')}`, files: v.files_done, bytes: v.bytes_done,
    detail: `${v.dest}; ${v.summary}${v.pod_files + v.pc_files ? `; ${v.pod_files ? `${v.pod_files} via pod ${v.pod ?? ''}`.trim() : ''}${v.pod_files && v.pc_files ? ', ' : ''}${v.pc_files ? `${v.pc_files} via this PC` : ''}` : ''}`.slice(0, 600), approved_by: v.approved_by, ...(v.error ? { error: redact(v.error) } : {}) })
  persist()
}

/** Forget everything in memory (tests). */
export function reset(): void { sizeCache.clear(); sizeRuns.clear(); scans.clear(); scanSeq = 0; jobs.clear(); finished = []; loaded = null; seq = 0; writing = Promise.resolve(); setDeps(null) }

// ============================================================================================================================
// Backfill (docs/ADR-050 "Backfill", ADR-051 section 8): what the outputs already hold, found read-only and, only on a named yes,
// uploaded as they are (original names) to the destination, files that are only on the volume streamed through this PC.
// ============================================================================================================================
export type Source = 'local-output' | 'volume-output' | 'volume-pipe-finals' | 'volume-deliveries'
export const SOURCES: Source[] = ['local-output', 'volume-output', 'volume-pipe-finals', 'volume-deliveries']
export const VOLUME_PREFIX: Record<Exclude<Source, 'local-output'>, string> = { 'volume-output': 'comfy-shared/output/', 'volume-pipe-finals': 'comfy-shared/input/pipe_finals/', 'volume-deliveries': 'project/90_DELIVERIES/' }
export const SCAN_CAP = 200_000, INVENTORY_CAP = 100_000, STREAM_MAX = 3, FIRST_SHOTS = 15
export type RowKind = 'dpx-sequence' | 'review' | 'proxy' | 'movie' | 'other'
export interface InvRow {
  id: string; shot: string; name: string; kind: RowKind; frames: number; bytes: number; modified: string; where: ('pc' | 'volume')[]; in_destination: boolean
  source: Source; path: string; weight: boolean; backfilled: true; event_time: string
}
interface FileRef { path: string; bytes: number; modified: string; key?: string }   // path: relative to the source root (for the volume, `key` is the full key)
interface ScanRow extends InvRow { files: { name: string; local?: FileRef; volume?: FileRef }[] }
export interface ScanView { job_id: string; state: 'scanning' | 'done' | 'failed'; sources: Source[]; started_at: string; finished_at: string; rows: number; error?: string; destination: { dest: string; known: boolean; note?: string } }
const scans = new Map<string, { view: ScanView; rows: ScanRow[]; unreadable: { source: Source; reason: string }[]; done: Promise<void> }>()
let scanSeq = 0
const MOVIE = /\.(mov|mp4|mxf|avi|mkv|m4v|webm)$/i
const DPX_FRAME = /^(.*?)([._-]?)(\d+)\.dpx$/i
const inventoryFile = () => process.env.PUBLISH_INVENTORY_FILE || join(configDir(), 'publish-inventory.json')
export const shotOf = (name: string, dir: string): string => {   // renders.shotOf, the same rule (a test keeps them equal)
  const m = /^[A-Za-z]+-\d+[a-z]?/.exec(name); if (m) return m[0].toLowerCase()
  return (dir.split('/').filter(Boolean).pop() ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '-') || 'shot'
}
export const rowId = (source: string, path: string, bytes: number): string => createHash('sha1').update(`${source}\0${path}\0${bytes}`).digest('hex').slice(0, 16)
const trimNum = (n: number) => String(n)

/** Which shot, and what kind of thing, a file is: `deliver/<shot>/v###/` is a review, `.proxies/` a proxy. */
function classify(rel: string, source: Source): { shot: string; kind: RowKind } {
  const parts = rel.split('/'), file = parts[parts.length - 1]
  const dl = parts.indexOf('deliver')
  if (dl >= 0 && parts[dl + 1] && /^v\d{3,}$/.test(parts[dl + 2] ?? '')) return { shot: parts[dl + 1].toLowerCase(), kind: MOVIE.test(file) ? 'review' : 'other' }
  if (parts.includes('.proxies')) return { shot: shotOf(file, parts.slice(parts.indexOf('.proxies') + 1, -1).join('/')), kind: MOVIE.test(file) ? 'proxy' : 'other' }
  if (/\.dpx$/i.test(file)) return { shot: shotOf(file, parts.slice(0, -1).join('/')), kind: 'dpx-sequence' }
  return { shot: shotOf(file, parts.slice(0, -1).join('/')), kind: MOVIE.test(file) ? (source === 'volume-deliveries' ? 'review' : 'movie') : 'other' }
}

/** Group a source's files into rows the way the gallery does: the .dpx files of one folder that differ only by frame number are one sequence. */
async function group(source: Source, files: { rel: string; bytes: number; modified: string; where: 'pc' | 'volume'; key?: string }[]): Promise<ScanRow[]> {
  const rows = new Map<string, ScanRow>(); let n = 0
  for (const f of files) {
    if (++n % 500 === 0) await yieldLoop()
    const c = classify(f.rel, source), dir = posix.dirname(f.rel) === '.' ? '' : posix.dirname(f.rel), file = posix.basename(f.rel)
    const ref: FileRef = { path: f.rel, bytes: f.bytes, modified: f.modified, ...(f.key ? { key: f.key } : {}) }
    const m = c.kind === 'dpx-sequence' ? DPX_FRAME.exec(file) : null
    const gkey = m ? `dpx:${dir}/${m[1]}${m[2]}#` : `file:${f.rel}`
    let r = rows.get(gkey)
    if (!r) {
      const name = m ? (`${m[1]}${m[2]}${'#'.repeat(m[3].length)}.dpx`) : file
      r = { id: '', shot: c.shot, name, kind: c.kind, frames: 0, bytes: 0, modified: '', where: [], in_destination: false, source, path: m ? `${dir ? `${dir}/` : ''}${name}` : f.rel, weight: isWeight(file), backfilled: true, event_time: '', files: [] }
      rows.set(gkey, r)
    }
    const slot = r.files.find((x) => x.name === file) ?? (r.files.push({ name: file }), r.files[r.files.length - 1])
    if (f.where === 'pc') slot.local = ref; else slot.volume = ref
  }
  for (const r of rows.values()) finishRow(r)
  return [...rows.values()]
}
function finishRow(r: ScanRow): void {
  r.frames = r.kind === 'dpx-sequence' ? r.files.length : 1
  r.bytes = r.files.reduce((a, f) => a + (f.local ?? f.volume)!.bytes, 0)
  r.modified = r.files.map((f) => (f.local ?? f.volume)!.modified).sort().pop() ?? ''
  r.event_time = r.modified
  r.where = [...(r.files.every((f) => f.local) ? ['pc' as const] : []), ...(r.files.every((f) => f.volume) ? ['volume' as const] : [])]
  if (!r.where.length) r.where = [...(r.files.some((f) => f.local) ? ['pc' as const] : []), ...(r.files.some((f) => f.volume) ? ['volume' as const] : [])]
  r.id = rowId(r.source, r.path, r.bytes)
}

async function walkLocal(base: string, rel: string, out: { rel: string; bytes: number; modified: string; where: 'pc' }[], cap: number): Promise<void> {
  let ents: import('node:fs').Dirent[]
  try { ents = await readdir(join(base, rel), { withFileTypes: true }) } catch { return }
  ents.sort((a, b) => a.name.localeCompare(b.name))
  for (const d of ents) {
    if (out.length >= cap) return
    const p = rel ? `${rel}/${d.name}` : d.name
    if (d.isSymbolicLink()) continue
    if (d.isDirectory()) { await walkLocal(base, p, out, cap); continue }
    const s = await lstat(join(base, p)).catch(() => null); if (!s) continue
    out.push({ rel: p, bytes: s.size, modified: s.mtime.toISOString(), where: 'pc' })
    if (out.length % 500 === 0) await yieldLoop()
  }
}

/** Start a read-only scan of the chosen places. Nothing is written but the inventory file and History. */
export async function scan(o: { sources?: unknown }): Promise<{ job_id: string }> {
  if (!Array.isArray(o?.sources) || !o.sources.length || o.sources.some((x) => !SOURCES.includes(x as Source))) throw bad(`sources is a list of ${SOURCES.join(', ')}`)
  const sources = [...new Set(o.sources as Source[])]
  const id = `scan-${deps.now().toString(36)}-${(scanSeq++).toString(36)}`
  const dest = await destinationInfo()
  const view: ScanView = { job_id: id, state: 'scanning', sources, started_at: iso(), finished_at: '', rows: 0, destination: dest }
  const rec = { view, rows: [] as ScanRow[], unreadable: [] as { source: Source; reason: string }[], done: Promise.resolve() }
  scans.set(id, rec)
  rec.done = doScan(rec, sources).catch((e) => { view.state = 'failed'; view.error = redact((e as Error).message) }).finally(() => { view.finished_at = iso() })
  while (scans.size > 5) scans.delete(scans.keys().next().value as string)
  return { job_id: id }
}
export const scanSettled = async (): Promise<void> => { for (const s of scans.values()) await s.done }

async function destinationInfo(): Promise<ScanView['destination']> {
  const e = (await effective()).s3, p = s3Problem(e)
  return { dest: `s3://${e.bucket || '(bucket not confirmed)'}/${e.prefix}`, known: !p, ...(p ? { note: p } : {}) }
}

async function doScan(rec: { view: ScanView; rows: ScanRow[]; unreadable: { source: Source; reason: string }[] }, sources: Source[]): Promise<void> {
  const byOutput = new Map<string, ScanRow>()   // local-output and volume-output are the same tree: a file in both is one row
  const all: { source: Source; files: { rel: string; bytes: number; modified: string; where: 'pc' | 'volume'; key?: string }[] }[] = []
  if (sources.includes('local-output')) {
    const files: { rel: string; bytes: number; modified: string; where: 'pc' }[] = []
    try { await walkLocal(root(), '', files, SCAN_CAP); all.push({ source: 'local-output', files }); if (files.length >= SCAN_CAP) rec.unreadable.push({ source: 'local-output', reason: `Stopped at ${SCAN_CAP.toLocaleString('en-US')} files` }) } catch (e) { rec.unreadable.push({ source: 'local-output', reason: redact((e as Error).message) }) }
  }
  const vol = deps.volumeId()
  for (const src of sources.filter((x) => x !== 'local-output') as Exclude<Source, 'local-output'>[]) {
    if (!vol) { rec.unreadable.push({ source: src, reason: 'No Shared or network volume is set (Default Configuration)' }); continue }
    try {
      const prefix = VOLUME_PREFIX[src], ks = await deps.volumeKeys(vol, prefix)
      if (ks === null) { rec.unreadable.push({ source: src, reason: "The volume cannot be read over RunPod's S3 API (its datacenter has none, or the S3 keys are not set)" }); continue }
      const files = ks.slice(0, SCAN_CAP).filter((k) => !k.key.endsWith('/')).map((k) => ({ rel: k.key.slice(prefix.length), bytes: k.bytes, modified: k.modified ? new Date(k.modified.includes('T') ? k.modified : `${k.modified.replace(' ', 'T')}Z`).toISOString() : '', where: 'volume' as const, key: k.key }))
      if (ks.length > SCAN_CAP) rec.unreadable.push({ source: src, reason: `Stopped at ${SCAN_CAP.toLocaleString('en-US')} files` })
      all.push({ source: src, files })
    } catch (e) { rec.unreadable.push({ source: src, reason: redact((e as Error).message) }) }
  }
  const rows: ScanRow[] = []
  const merged = all.filter((a) => a.source === 'local-output' || a.source === 'volume-output')
  if (merged.length) {   // one grouping over both, so a sequence on the PC and on the volume is one row with both places
    const files = merged.flatMap((a) => a.files.map((f) => ({ ...f, rel: f.rel })))
    for (const r of await group('local-output', files)) { byOutput.set(r.path, r); rows.push(r) }
    for (const r of rows) { void r }
  }
  for (const a of all.filter((x) => x.source !== 'local-output' && x.source !== 'volume-output')) rows.push(...await group(a.source, a.files))
  // where a sequence is only partly in one place, `where` lists what holds ALL of it
  rows.sort((x, y) => x.shot.localeCompare(y.shot) || x.name.localeCompare(y.name))
  await markDestination(rec, rows)
  rec.rows = rows; rec.view.rows = rows.length
  await saveInventory(rows)
  rec.view.state = 'done'
}

/** ONE listing of the destination prefix tells which rows are already there (same size on every file). */
async function markDestination(rec: { view: ScanView; unreadable: { source: Source; reason: string }[] }, rows: ScanRow[]): Promise<void> {
  const e = (await effective()).s3
  if (s3Problem(e)) return
  try {
    const a = await s3Access(), there = await listDestination(a)
    for (const r of rows) r.in_destination = r.files.length > 0 && r.files.every((f) => there.get(`${a.prefix}${keyFor(r, f.name, new Map())}`) === (f.local ?? f.volume)!.bytes)
    rec.view.destination = { ...rec.view.destination, known: true }
  } catch (err) { rec.view.destination = { ...rec.view.destination, known: false, note: `The destination could not be read: ${redact((err as Error).message)}` } }
}
async function listDestination(a: Awaited<ReturnType<typeof s3Access>>): Promise<Map<string, number>> {
  const ls = await deps.aws(['s3', 'ls', `s3://${a.bucket}/${a.prefix}`, '--recursive', ...a.common], a.env, { stallMs: 120_000 })
  if (ls.code !== 0 && !(ls.code === 1 && !ls.stdout.trim() && !ls.stderr.trim())) throw new Error(awsText(ls))
  const there = new Map<string, number>()
  for (const line of ls.stdout.split('\n')) { const m = /^\S+\s+\S+\s+(\d+)\s+(.+)$/.exec(line); if (m) there.set(m[2], Number(m[1])) }
  return there
}
/** The destination key (below the prefix) of one file of a row: the ORIGINAL name under the shot; a sequence's frames sit in a folder named for it. */
export function keyFor(r: Pick<InvRow, 'shot' | 'name' | 'kind'>, fileName: string, taken: Map<string, string>): string {
  const stem = r.kind === 'dpx-sequence' ? `${r.name.replace(/[#._-]*#+\.dpx$/i, '').replace(/\.dpx$/i, '') || 'sequence'}/` : ''
  let k = `${r.shot}/${stem}${fileName}`
  const owner = `${r.kind}:${r.name}`
  if (taken.has(k) && taken.get(k) !== owner) k = `${r.shot}/${r.kind}/${stem}${fileName}`
  taken.set(k, owner)
  return k
}

async function saveInventory(rows: ScanRow[]): Promise<void> {
  const disk = await readJson<{ rows?: Record<string, InvRow> }>(inventoryFile(), {}), have = disk.rows ?? {}, fresh = new Map<string, number>()
  for (const r of rows) {
    const { files: _f, ...pub } = r
    if (!have[r.id]) fresh.set(r.shot, (fresh.get(r.shot) ?? 0) + 1)
    have[r.id] = pub
  }
  const keys = Object.keys(have); if (keys.length > INVENTORY_CAP) for (const k of keys.slice(0, keys.length - INVENTORY_CAP)) delete have[k]
  await writeJson(inventoryFile(), { rows: have })
  for (const [shot, n] of [...fresh].slice(0, 50)) history.record({ kind: 'change', area: 'volume', action: 'outputs found (backfill)', what: shot, detail: `${n} new inventory row${n === 1 ? '' : 's'}, event time = the file's modified time (backfilled)` })
}

export interface Inventory { job_id: string; state: ScanView['state']; destination: ScanView['destination']; rows: InvRow[]; by_shot: { shot: string; rows: number; files: number; frames: number; bytes: number; in_destination: number }[]; totals: { rows: number; shots: number; files: number; bytes: number; in_destination: number; to_upload: number }; unreadable: { source: Source; reason: string }[]; error?: string }
const pub = (r: ScanRow): InvRow => { const { files: _f, ...p } = r; return p }
export function inventory(jobId?: string): Inventory {
  const rec = jobId ? scans.get(jobId) : [...scans.values()].pop()
  if (!rec) throw new CoreError(404, jobId ? `No such scan: ${jobId}` : 'No scan has run yet: start one with scan')
  const by = new Map<string, Inventory['by_shot'][number]>()
  for (const r of rec.rows) {
    const b = by.get(r.shot) ?? { shot: r.shot, rows: 0, files: 0, frames: 0, bytes: 0, in_destination: 0 }; by.set(r.shot, b)
    b.rows++; b.files += r.files.length; b.frames += r.frames; b.bytes += r.bytes; if (r.in_destination) b.in_destination++
  }
  const rows = rec.rows
  return { job_id: rec.view.job_id, state: rec.view.state, destination: rec.view.destination, rows: rows.map(pub), by_shot: [...by.values()],
    totals: { rows: rows.length, shots: by.size, files: rows.reduce((a, r) => a + r.files.length, 0), bytes: rows.reduce((a, r) => a + r.bytes, 0), in_destination: rows.filter((r) => r.in_destination).length, to_upload: rows.filter((r) => !r.in_destination && !r.weight).length },
    unreadable: rec.unreadable.map((u) => ({ ...u })), ...(rec.view.error ? { error: rec.view.error } : {}) }
}

// ----- backfill plan and run -----
export interface BackfillRequest { job_id?: string; rows?: string[]; all?: boolean; targets?: unknown; destination_prefix?: string; message?: string; approved_by?: string }
export interface BackfillItem extends PlanItem { row: string; shot: string; from: 'pc' | 'volume'; source_key?: string; local_path?: string }
export interface BackfillPlan extends Omit<Plan, 'items'> { items: BackfillItem[]; bucket: string; dest: string; inventory_key: string; excluded_weights: number }
async function pickRows(req: BackfillRequest): Promise<{ rec: NonNullable<ReturnType<typeof scans.get>>; rows: ScanRow[]; excluded: number }> {
  const rec = req.job_id ? scans.get(req.job_id) : [...scans.values()].pop()
  if (!rec) throw new CoreError(404, 'No scan to plan from: run scan first')
  if (rec.view.state === 'scanning') throw bad('The scan is still running')
  if (req.all) { const rows = rec.rows.filter((r) => !r.weight); return { rec, rows, excluded: rec.rows.length - rows.length } }
  if (!Array.isArray(req.rows) || !req.rows.length) throw bad('rows is a list of inventory row ids, or all: true')
  const want = new Set(req.rows), rows = rec.rows.filter((r) => want.has(r.id))
  if (rows.length !== want.size) throw bad('Some of those rows are not in this scan')
  return { rec, rows, excluded: 0 }
}
export async function backfillPlan(req: BackfillRequest): Promise<BackfillPlan> {
  const targets = targetsOf(req?.targets), { rows, excluded } = await pickRows(req)
  const e = await effective(), blockers: string[] = [], refused: Plan['refused'] = []
  const prefix = req.destination_prefix !== undefined ? check('s3.prefix', req.destination_prefix) : e.s3.prefix
  const sp = s3Problem(e.s3), lp = slackProblem(e.slack)
  if (targets.includes('s3') && sp) blockers.push(`S3 is not configured: ${sp}`)
  if (targets.includes('slack') && lp) blockers.push(`Slack is not configured: ${lp}`)
  const taken = new Map<string, string>(), items: BackfillItem[] = []
  for (const r of rows) {
    if (r.weight) { refused.push({ path: r.path, reason: WEIGHTS_REASON }); continue }
    for (const f of r.files) {
      const ref = (f.local ?? f.volume)!, from: 'pc' | 'volume' = f.local ? 'pc' : 'volume'
      items.push({ path: ref.path, bytes: ref.bytes, s3_key: `${prefix}${keyFor(r, f.name, taken)}`, skip: null, row: r.id, shot: r.shot, from, ...(f.local ? { local_path: join(deps.outputRoot() ?? '', f.local.path) } : {}), ...(!f.local && f.volume?.key ? { source_key: f.volume.key } : {}) })
    }
  }
  if (!items.length) blockers.push('Nothing to publish: no files in those rows')
  const date = new Date(deps.now()).toISOString().slice(0, 10), inventory_key = `${prefix}_inventory_${date}.csv`
  if (targets.includes('s3') && !sp && !blockers.length) {
    try {
      const a = await s3Access(), there = await listDestination({ ...a, prefix })
      for (const it of items) if (there.get(it.s3_key) === it.bytes) it.skip = 'same size already there'
    } catch (err) { blockers.push(`Could not read the destination: ${redact((err as Error).message)}`) }
  }
  const send = items.filter((i) => i.skip === null), total_bytes = items.reduce((a, i) => a + i.bytes, 0), dest = `s3://${e.s3.bucket || '(bucket not confirmed)'}/${prefix}`
  const shots = new Map<string, { files: number; bytes: number }>()
  for (const i of send) { const s = shots.get(i.shot) ?? { files: 0, bytes: 0 }; s.files++; s.bytes += i.bytes; shots.set(i.shot, s) }
  const to = `${e.slack.workspace_name || 'Slack'}: ${e.slack.channel || "(the webhook's own channel)"}`
  return {
    ok: !blockers.length && !refused.length, blockers, items, total_bytes, files: items.length, refused, excluded_weights: excluded, streamed_files: send.filter((i) => i.from === 'volume').length, streamed_bytes: send.filter((i) => i.from === 'volume').reduce((x, i) => x + i.bytes, 0), bucket: e.s3.bucket, dest, inventory_key,
    s3: targets.includes('s3') ? { dest, count: send.length, new_bytes: send.reduce((a, i) => a + i.bytes, 0) } : null,
    slack: targets.includes('slack') ? { channel: e.slack.channel, to, preview: `To ${to}\n\n${backfillText({ approved_by: req.approved_by?.trim() || '(the approver you name)', shots, files: send.length, bytes: send.reduce((a, i) => a + i.bytes, 0), dest, uploadedNote: 'will be' })}` } : null,
  }
}

/** The ONE status message of a backfill. Counts and names only: never a link, never a signed URL. */
export function backfillText(o: { approved_by: string; shots: Map<string, { files: number; bytes: number }>; files: number; bytes: number; dest: string; uploadedNote?: string }): string {
  const list = [...o.shots].sort((a, b) => a[0].localeCompare(b[0]))
  const lines = list.slice(0, FIRST_SHOTS).map(([s, v]) => `• ${s}: ${v.files} file${v.files === 1 ? '' : 's'} (${fmtSize(v.bytes)})`)
  if (list.length > FIRST_SHOTS) lines.push(`…and ${list.length - FIRST_SHOTS} more shots`)
  return `${TITLE}\nOutputs inventory and upload: ${list.length} shot${list.length === 1 ? '' : 's'}, ${o.files} file${o.files === 1 ? '' : 's'}, ${fmtSize(o.bytes)} ${o.uploadedNote ? `${o.uploadedNote} uploaded` : 'uploaded'} to ${o.dest}; as they are, naming to be fixed after\n${lines.join('\n')}\nApproved by ${o.approved_by}`
}

const csvCell = (v: string | number | boolean): string => { const t = String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
export function inventoryCsv(rows: ScanRow[], state: Map<string, 'yes' | 'no' | 'already'>): string {
  const head = 'shot,name,kind,frames,bytes,modified,where,uploaded'
  return [head, ...rows.map((r) => [r.shot, r.name, r.kind, r.frames, r.bytes, r.modified, r.where.join('+'), state.get(r.id) ?? 'no'].map(csvCell).join(','))].join('\n') + '\n'
}

// ----- transfer adapters for files that live only on the volume (ADR-050, amendment) -----
interface Route { mode: Transfer; pod: PodRef | null }
type SrcOk = Extract<VolAccess, { ok: true }>
const PROBE = 'command -v curl >/dev/null 2>&1 && echo PROBE-CURL; command -v sha256sum >/dev/null 2>&1 && echo PROBE-SHA; echo PROBE-END'
const FILE_CAP = 200
const plain = (t: string): string => redact(t).replace(/\s+/g, ' ').trim().slice(0, 200)

/** Is a pod adapter possible right now? Reads only: a running pod attached to the volume, the keys here to sign with, and a quick probe over SSH for curl and sha256sum. */
export async function podAvailable(a: DestAccess, signal?: AbortSignal): Promise<{ ok: true; pod: PodRef } | { ok: false; reason: string }> {
  if (!a.keys) return { ok: false, reason: 'the pod needs a signed upload link, and only S3 keys saved in this app can make one (an AWS profile cannot)' }
  const vol = deps.volumeId(), pod = vol ? await deps.podOnVolume(vol).catch(() => null) : null
  if (!pod) return { ok: false, reason: 'no running pod is attached to the volume (this app never starts one for a publish)' }
  const lines: string[] = [], ac = new AbortController(), t = setTimeout(() => ac.abort(), PROBE_MS), onAbort = () => ac.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const r = await deps.ssh({ host: pod.host, port: pod.port, script: PROBE, signal: ac.signal, onLine: (l) => lines.push(l.trim()) })
    if (!lines.includes('PROBE-END')) return { ok: false, reason: ac.signal.aborted ? `pod ${pod.name} did not answer over SSH in ${PROBE_MS / 1000} s` : `pod ${pod.name} could not be reached over SSH${r.code ? ` (exit ${r.code})` : ''}` }
    const missing = [...(lines.includes('PROBE-CURL') ? [] : ['curl']), ...(lines.includes('PROBE-SHA') ? [] : ['sha256sum'])]
    if (missing.length) return { ok: false, reason: `pod ${pod.name} has no ${missing.join(' or ')}` }
    return { ok: true, pod }
  } catch (e) { return { ok: false, reason: `pod ${pod.name} could not be reached over SSH: ${plain((e as Error).message)}` } }
  finally { clearTimeout(t); signal?.removeEventListener('abort', onAbort) }
}

/** Pick the adapter for the volume files of a job (once): `pc` is always this PC; `auto` the pod when available; `pod` the pod or a plain-words failure. */
async function chooseRoute(a: DestAccess, v: JobView, signal: AbortSignal): Promise<Route> {
  if (a.transfer === 'pc') return { mode: 'pc', pod: null }
  const r = await podAvailable(a, signal)
  if (!r.ok) {
    if (a.transfer === 'pod') throw new Error(`Transfer is set to Pod, but ${r.reason}`)
    return { mode: 'auto', pod: null }
  }
  v.adapter = 'pod'; v.pod = r.pod.name
  return { mode: a.transfer, pod: r.pod }
}
/** After the uploads: what carried the files is what the card says. */
function settleAdapter(v: JobView): void { v.adapter = v.pod_files > 0 ? 'pod' : 'pc'; if (!v.pod_files) delete v.pod }

/** The signed PUT link for one destination key; short-lived, never stored or logged. */
function putUrl(a: DestAccess, key: string): string {
  const bucket = a.bucket
  let host: string, path: string
  if (a.endpoint) { host = new URL(a.endpoint).host; path = `/${bucket}/${key}` }
  else if (!bucket.includes('.')) { host = `${bucket}.s3.${a.region}.amazonaws.com`; path = `/${key}` }
  else { host = `s3.${a.region}.amazonaws.com`; path = `/${bucket}/${key}` }
  return presign({ method: 'PUT', host, path, accessKey: a.keys!.id, secretKey: a.keys!.secret, region: a.region, expires: PUT_EXPIRES_S, now: new Date(deps.now()) })
}
/** The script one pod runs for one file: its sha256, then `curl -T` to the link. The link goes in a curl config on stdin (-K -), never on a command line, and the script itself travels on ssh's stdin. */
export function putScript(path: string, url: string): string {
  if (!/^https:\/\/[\w.-]+(:\d+)?\/[^\s"'`\\$]+$/.test(url)) throw new Error('the signed link looks wrong')
  const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`
  return ['set -u', 'echo "PUBLISH-PID $$"', `f=${q(path)}`, '[ -f "$f" ] || { echo "PUBLISH-FAIL the file is not on the pod"; exit 66; }',
    'h=$(sha256sum "$f" | cut -d" " -f1); [ -n "$h" ] || { echo "PUBLISH-FAIL sha256sum failed"; exit 67; }', 'echo "PUBLISH-SHA $h"',
    'curl -fsS --connect-timeout 30 --speed-limit 1024 --speed-time 120 -o /dev/null -T "$f" -K - <<\'PUBLISH_LINK\'', `url = "${url}"`, 'PUBLISH_LINK',
    'rc=$?; if [ $rc -eq 0 ]; then echo "PUBLISH-OK"; else echo "PUBLISH-FAIL curl exit $rc"; fi', 'exit $rc', ''].join('\n')
}
/** One file from the pod. Cancelling kills the ssh and then its remote processes. */
async function podPut(pod: PodRef, it: { source_key?: string; path: string; s3_key: string; bytes: number }, a: DestAccess, signal: AbortSignal): Promise<{ ok: boolean; error: string; sha256?: string }> {
  const key = it.source_key ?? ''
  if (!key || key.split('/').includes('..')) return { ok: false, error: 'the file has no usable place on the volume' }
  const url = putUrl(a, it.s3_key); liveUrls.add(url)
  const lines: string[] = []; let pid = '', sha = '', ok = false, why = ''
  const ac = new AbortController(), onAbort = () => ac.abort(), limit = 120_000 + (it.bytes / 524_288) * 1000, t = setTimeout(() => { why = 'timed out'; ac.abort() }, limit)
  if (signal.aborted) ac.abort(); else signal.addEventListener('abort', onAbort, { once: true })
  try {
    const r = await deps.ssh({ host: pod.host, port: pod.port, script: putScript(`/workspace/${key}`, url), signal: ac.signal, onLine: (l) => {
      const m = /^PUBLISH-(PID|SHA|OK|FAIL)\s*(.*)$/.exec(l.trim()); if (!m) { lines.push(l); if (lines.length > 20) lines.shift(); return }
      if (m[1] === 'PID' && /^\d+$/.test(m[2])) pid = m[2]; else if (m[1] === 'SHA' && /^[0-9a-f]{64}$/.test(m[2])) sha = m[2]; else if (m[1] === 'OK') ok = true; else if (m[1] === 'FAIL') why = m[2]
    } })
    if (ac.signal.aborted) { if (pid) await stopRemote(pod, pid); return { ok: false, error: signal.aborted ? 'cancelled' : plain(why || 'timed out') } }
    if (r.code !== 0 || !ok || !sha) return { ok: false, error: plain(why || (r.code === 255 ? 'the SSH connection to the pod dropped' : lines.at(-1) || `the pod exited ${r.code}`)) }
    return { ok: true, error: '', sha256: sha }
  } catch (e) {
    if (pid) await stopRemote(pod, pid)
    return { ok: false, error: signal.aborted ? 'cancelled' : plain(why || (e as Error).message) }
  } finally { clearTimeout(t); signal.removeEventListener('abort', onAbort); liveUrls.delete(url) }
}
/** Make sure the remote curl is gone after a cancel or a timeout (the ssh that carried it is already dead). */
async function stopRemote(pod: PodRef, pid: string): Promise<void> {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 15_000)
  try { await deps.ssh({ host: pod.host, port: pod.port, script: `pkill -TERM -P ${Number(pid)} 2>/dev/null; kill -TERM ${Number(pid)} 2>/dev/null; echo`, signal: ac.signal, onLine: () => undefined }) } catch { /* the pod is gone: so is the transfer */ } finally { clearTimeout(t) }
}

/** One volume file to the destination by the chosen adapter, and the record of which one carried it. In `auto`, a pod failure falls back to this PC for that file, once; `pod` does not. */
async function volumeCopy(it: { path: string; s3_key: string; bytes: number; source_key?: string }, c: { a: DestAccess; s: SrcOk; route: Route; v: JobView; signal: AbortSignal; shot?: string; onBytes: (n: number) => void }): Promise<{ ok: boolean; error: string }> {
  const rec = (adapter: 'pod' | 'pc', sha256?: string) => { if (adapter === 'pod') c.v.pod_files++; else c.v.pc_files++; if (c.v.files.length < FILE_CAP) c.v.files.push({ path: it.path, adapter, ...(sha256 ? { sha256 } : {}), ...(c.shot ? { shot: c.shot } : {}) }) }
  if (c.route.pod && it.bytes <= PUT_MAX_BYTES) {
    const r = await podPut(c.route.pod, it, c.a, c.signal)
    if (r.ok) { c.onBytes(it.bytes); rec('pod', r.sha256); return { ok: true, error: '' } }
    if (c.signal.aborted) return { ok: false, error: 'cancelled' }
    if (c.route.mode === 'pod') return { ok: false, error: `via pod ${c.route.pod.name}: ${r.error}` }
  } else if (c.route.pod && c.route.mode === 'pod') return { ok: false, error: 'larger than 5 GiB, which one signed upload cannot carry; set Transfer to Auto or This PC' }
  const r = await streamCopy({ args: ['s3', 'cp', `s3://${c.s.bucket}/${it.source_key}`, '-', '--endpoint-url', c.s.endpoint, '--region', c.s.region], env: { AWS_ACCESS_KEY_ID: c.s.id, AWS_SECRET_ACCESS_KEY: c.s.secret } },
    { args: ['s3', 'cp', '-', `s3://${c.a.bucket}/${it.s3_key}`, '--expected-size', String(it.bytes), ...c.a.common], env: c.a.env },
    { signal: c.signal, stallMs: STALL_MS, sha: true, onBytes: c.onBytes })
  if (r.ok) rec('pc', r.sha256)
  return r
}

/** Run one streamed copy: `aws s3 cp s3://src/key -` piped into `aws s3 cp - s3://dest/key --expected-size N`. No temp file, nothing buffered: the pipe moves it chunk by chunk. A stall timer per file, not a total. */
export function streamCopy(a: { args: string[]; env: Record<string, string> }, b: { args: string[]; env: Record<string, string> }, o: { signal?: AbortSignal; stallMs: number; onBytes?: (n: number) => void; stdin?: string; /** hash what is read (sha256 of the source bytes) */ sha?: boolean }): Promise<{ ok: boolean; error: string; sha256?: string }> {
  return new Promise((resolve) => {
    const src = o.stdin === undefined ? deps.spawn('aws', a.args, a.env) : null, dst = deps.spawn('aws', b.args, b.env)
    const hash = o.sha && o.stdin === undefined ? createHash('sha256') : null
    let sent = 0, stalled = false, finished = false, timer: NodeJS.Timeout | null = null, err = ''
    const codes: (number | null | undefined)[] = []
    const kill = () => { for (const c of [src, dst]) { try { c?.kill('SIGKILL') } catch { /* gone */ } } }
    const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { stalled = true; kill() }, o.stallMs) }
    const done = (ok: boolean, error: string) => { if (finished) return; finished = true; if (timer) clearTimeout(timer); o.signal?.removeEventListener('abort', kill); resolve({ ok, error, ...(ok && hash ? { sha256: hash.digest('hex') } : {}) }) }
    const need = src ? 2 : 1
    const closed = (code: number | null | undefined) => {
      codes.push(code)
      if (src && code !== 0 && codes.length === 1) { try { dst.stdin?.destroy() } catch { /* ok */ } try { dst.kill('SIGKILL') } catch { /* ok */ } }
      if (codes.length < need) return
      if (stalled) return done(false, `no data for ${Math.round(o.stallMs / 1000)} s`)
      if (o.signal?.aborted) return done(false, 'cancelled')
      done(codes.every((c) => c === 0), codes.every((c) => c === 0) ? '' : (redact(err.trim().split('\n').pop() ?? '') || 'the copy failed'))
    }
    for (const c of [src, dst]) {
      if (!c) continue
      c.stderr?.on('data', (d) => { err += String(d); if (err.length > 4000) err = err.slice(-2000); arm() })
      c.on('error', (e) => { err += e.message; closed(127) })
      c.on('close', closed)
    }
    if (o.signal?.aborted) { kill(); return }
    o.signal?.addEventListener('abort', kill, { once: true })
    arm()
    if (src) {
      src.stdout?.on('data', (d: Buffer) => { sent += d.length; hash?.update(d); arm(); o.onBytes?.(sent) })
      src.stdout?.pipe(dst.stdin!)   // back pressure: the pipe pauses the download while the upload is slower
      dst.stdin?.on('error', () => undefined)
    } else { dst.stdin?.on('error', () => undefined); dst.stdin?.end(o.stdin); o.onBytes?.(Buffer.byteLength(o.stdin ?? '')) }
    dst.stdout?.on('data', () => arm())
  })
}

/** Start the upload of a plan's files. Same rules as run(): a named approver, the plan re-made here, no weights; files only on the volume are streamed through this PC. */
export async function backfillRun(req: BackfillRequest): Promise<{ job_id: string }> {
  const who = (req?.approved_by ?? '').trim()
  if (!who) throw bad(NEEDS_NAME)
  const targets = targetsOf(req.targets)
  const p = await backfillPlan({ ...req, targets, approved_by: who })
  if (p.blockers.length) throw bad(`Cannot publish: ${p.blockers.join('; ')}`)
  if (p.refused.length) throw bad(`Cannot publish: ${p.refused.slice(0, 3).map((r) => `${r.path}: ${r.reason}`).join('; ')}`)
  const { rows } = await pickRows(req), e = await effective()
  const send = targets.includes('s3') ? p.items.filter((i) => i.skip === null) : []
  const id = `publish-${deps.now().toString(36)}-${(seq++).toString(36)}`
  const info: MsgInfo = { first: [], count: p.items.length, bytes: p.total_bytes, dest: p.dest }
  const view: JobView = { job_id: id, state: 'queued', targets, approved_by: who, started_at: iso(), finished_at: '', files_total: send.length, files_done: 0, bytes_total: send.reduce((a, i) => a + i.bytes, 0), bytes_done: 0, rate_bps: 0, current: '', skipped: p.items.filter((i) => i.skip === 'same size already there').length, dest: p.dest, links: [], slack: { state: 'skipped' }, summary: '', adapter: 'pc', pod_files: 0, pc_files: 0, files: [] }
  const job: Job = { view, abort: new AbortController(), info, template: '', started: deps.now(), done: Promise.resolve() }
  jobs.set(id, job)
  job.done = goBackfill(job, p, send, rows, targets, e.s3.prefix).catch((err) => { view.state = 'failed'; view.error = redact((err as Error).message) }).finally(() => end(job))
  return { job_id: id }
}

async function goBackfill(job: Job, p: BackfillPlan, send: BackfillItem[], rows: ScanRow[], targets: Target[], _prefix: string): Promise<void> {
  const v = job.view, ac = job.abort
  const a = targets.includes('s3') ? await s3Access() : null
  const state = new Map<string, 'yes' | 'no' | 'already'>(), failedRows = new Set<string>()
  for (const r of rows) state.set(r.id, 'no')
  for (const i of p.items) if (i.skip === 'same size already there' && state.get(i.row) === 'no') state.set(i.row, 'already')
  if (a && send.length) {
    v.state = 'uploading'
    const t0 = deps.now(), partial = new Map<string, number>(); let doneBytes = 0, failure = ''
    const refresh = () => { v.bytes_done = [...partial.values()].reduce((x, y) => x + y, 0) + doneBytes; const s = (deps.now() - t0) / 1000; v.rate_bps = s > 0 ? Math.round(v.bytes_done / s) : 0 }
    const pc = send.filter((i) => i.from === 'pc'), vol = send.filter((i) => i.from === 'volume')
    const finishOne = (it: BackfillItem, ok: boolean, why: string) => {
      partial.delete(it.s3_key)
      if (ok) { doneBytes += it.bytes; v.files_done++; refresh(); if (!failedRows.has(it.row)) state.set(it.row, 'yes') } else if (!ac.signal.aborted) { failedRows.add(it.row); state.set(it.row, 'no'); failure ||= `${basename(it.path)}: ${why}` }
    }
    const pool = (list: BackfillItem[], n: number, work: (it: BackfillItem) => Promise<void>) => { let next = 0; return Promise.all(Array.from({ length: Math.max(1, Math.min(n, list.length)) }, async () => { while (!failure && !ac.signal.aborted) { const it = list[next++]; if (!it) return; v.current = basename(it.path); await work(it) } })) }
    const src = vol.length ? await deps.volumeAccess(deps.volumeId()) : null
    if (src && !src.ok) throw new Error(`The volume cannot be read: ${redact(src.reason)}`)
    const route = vol.length ? await chooseRoute(a, v, ac.signal) : null
    await Promise.all([
      pool(pc, deps.parallel(), async (it) => {
        const r = await deps.aws(['s3', 'cp', it.local_path!, `s3://${a.bucket}/${it.s3_key}`, ...a.common], a.env, { signal: ac.signal, stallMs: STALL_MS, onData: (c) => { const n = parseProgress(c); if (n !== null) { partial.set(it.s3_key, Math.min(n, it.bytes)); refresh() } } })
        finishOne(it, r.code === 0, awsText(r))
      }),
      pool(vol, Math.min(deps.parallel(), STREAM_MAX), async (it) => {
        const r = await volumeCopy({ ...it, source_key: it.source_key }, { a, s: src as Extract<typeof src, { ok: true }>, route: route!, v, signal: ac.signal, shot: it.shot, onBytes: (n) => { partial.set(it.s3_key, Math.min(n, it.bytes)); refresh() } })
        finishOne(it, r.ok, r.error)
      }),
    ])
    v.current = ''; settleAdapter(v)
    if (ac.signal.aborted) { v.state = 'cancelled'; v.summary = `Cancelled after ${v.files_done} of ${v.files_total} files`; return }
    if (failure) { v.state = 'failed'; v.error = failure; v.summary = `${v.files_done} of ${v.files_total} files uploaded; stopped at an error. Nothing was posted to Slack.`; return }
  }
  if (ac.signal.aborted) { v.state = 'cancelled'; return }
  if (a) {   // the inventory goes last, next to the files, over stdin (no temp file)
    const csv = inventoryCsv(rows, state), key = p.inventory_key
    const r = await streamCopy({ args: [], env: {} }, { args: ['s3', 'cp', '-', `s3://${a.bucket}/${key}`, '--expected-size', String(Buffer.byteLength(csv)), ...a.common], env: a.env }, { signal: ac.signal, stallMs: 60_000, stdin: csv })
    if (!r.ok) { v.state = ac.signal.aborted ? 'cancelled' : 'failed'; v.error = `The inventory file could not be uploaded: ${r.error}`; v.summary = `${v.files_done} files uploaded, but the inventory ${key.split('/').pop()} did not go up. Nothing was posted to Slack.`; return }
    const disk = await readJson<{ rows?: Record<string, InvRow> }>(inventoryFile(), {})
    for (const r2 of rows) if (state.get(r2.id) !== 'no' && disk.rows?.[r2.id]) disk.rows[r2.id].in_destination = true
    await writeJson(inventoryFile(), disk).catch(() => undefined)
  }
  if (targets.includes('slack')) {
    v.state = 'posting'
    const shots = new Map<string, { files: number; bytes: number }>()
    for (const i of send) { const s = shots.get(i.shot) ?? { files: 0, bytes: 0 }; s.files++; s.bytes += i.bytes; shots.set(i.shot, s) }
    job.slackText = backfillText({ approved_by: v.approved_by, shots, files: v.files_done, bytes: v.bytes_done, dest: p.dest })
    const r = await postSlack(job.slackText)
    v.slack = r.ok ? { state: 'sent' } : { state: 'failed', error: r.error }
  }
  const up = a ? `${v.files_done} file${v.files_done === 1 ? '' : 's'} uploaded${v.skipped ? `, ${v.skipped} already there` : ''} (${fmtSize(v.bytes_done)}) to ${v.dest}` : ''
  if (v.slack.state === 'failed') { v.state = a ? 'done_with_warning' : 'failed'; v.error = v.slack.error; v.summary = `${up}. The files are up, but the Slack message failed: ${v.slack.error}. It can be sent again.` }
  else { v.state = 'done'; v.summary = `${up}${v.slack.state === 'sent' ? '; posted to Slack' : ''}` }
}

export const resetBackfill = (): void => { scans.clear(); scanSeq = 0 }
