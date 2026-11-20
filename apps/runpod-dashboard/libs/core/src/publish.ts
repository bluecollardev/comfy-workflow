/**
 * Publishing (docs/ADR-050): send finished outputs (a render's review video, proxies, anything under the local ComfyUI-Shared output/) to an S3
 * bucket and announce them in Slack. Files leave this PC, so it is ALWAYS a person's explicit act: a named approver on every run, a plan first,
 * no default destination, never model weights. Secrets (S3 keys, the Slack webhook) live only in the app's .env and are never returned, logged or
 * put in an error. Everything here is async: it runs in Electron's main process.
 */
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, dirname, join, posix } from 'node:path'
import { bad, CoreError } from './errors.js'
import * as history from './history.js'
import * as jobsregistry from './jobsregistry.js'
import * as failures from './failures.js'
import * as mounts from './mounts.js'
import * as panama from './panama.js'
import * as podpull from './podpull.js'
import * as rp from './runpod.js'
import * as sync from './sync.js'
import { presign } from './s3presign.js'
import { configDir } from './paths.js'
import * as settingsEnv from './settings.js'
import * as layout from './publishlayout.js'
import * as syncrun from './syncrun.js'
import * as edl from './edl.js'
import * as tunnelj from './tunnel.js'

// ----- the defaults baked into the code: NON-SECRET only (the app ships on a public repository) -----
export const DEFAULT_MESSAGE = 'Approved by {approved_by} on {date}\n{count} file(s), {size}\nDestination: {dest}\n{files}\n{folders}\n{links}'
export const DESTINATION_NOTE = 'Lucas, 2026-11-19: Panama exchange bucket, returns/BKK/'
export const PUBLISH_DEFAULTS = {
  s3: { bucket: '', prefix: 'returns/BKK/', region: '', endpoint: '', credentials: 'panama' as 'app' | 'panama', presign_hours: 72, transfer: 'auto' as Transfer },   // the bucket is the Panama exchange bucket's setting (not a second copy here), see effective()
  slack: { channel: '', username: 'RunPod Manager', workspace_name: 'Beinghuman', workspace_url: 'https://beinghuman-hq.slack.com', preview_frame: true, volume_source: true, per_shot: true, file_links: true, file_link_count: 10, folder_link: true },
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
  s3: { /** where files go under the prefix: as they are, or the BKK return layout (round / shot / clip), default by prefix */ layout: layout.Layout; bucket: string; prefix: string; region: string; endpoint: string; credentials: 'app' | 'panama'; access_key_hint: string; presign_hours: number; transfer: Transfer; ready: boolean; problem?: string; /** documentation, not a gate: who confirmed the default destination */ note?: string; destination_confirmed?: string }
  slack: { channel: string; username: string; workspace_name: string; workspace_url: string; /** post the first frame of what was published as an image (needs ffmpeg and S3) */ preview_frame: boolean; /** say where on the RunPod volume the files came from (never a link to a file, never a key) */ volume_source: boolean; /** one Slack message per shot (default on for the BKK return) or one per run */ per_shot: boolean; /** expiring links to the first `file_link_count` files (default on) */ file_links: boolean; file_link_count: number; /** a link to the destination folder in the AWS console (default on) */ folder_link: boolean; webhook_hint: string; ready: boolean; problem?: string }
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
  /** where ffmpeg is on this PC (the one the renders use), or null: for the first-frame preview of a Slack post */
  findFfmpeg(): Promise<string | null>
  /** the RunPod volume's name and datacenter, for the Slack message's source line; null when unknown */
  volumeRecord(id: string): Promise<{ id: string; name: string; datacenter: string } | null>
  /** the pod a render of these files (paths under output/) ran on, for the return manifest; null when unknown */
  podInfo(paths: string[]): Promise<layout.Pod | null>
  /** a RUNNING pod attached to the volume that the app can reach over SSH, or null. Reads only: nothing here ever creates, resumes or stops a pod. */
  podOnVolume(volumeId: string): Promise<PodRef | null>
  /** run a script on a pod over SSH (the script goes on stdin) */
  ssh: podpull.SshRunner
}
export interface PodRef { id: string; name: string; host: string; port: number }
let ffmpegOverride: (() => Promise<string | null>) | null = null
/** Tests replace the ffmpeg lookup, so no test ever runs the real one (tests/setup.ts). */
export const setFfmpegOverride = (f: (() => Promise<string | null>) | null) => { ffmpegOverride = f }
let volMemo: { at: number; rows: { id: string; name: string; datacenter: string }[] } | null = null
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
  findFfmpeg: () => (ffmpegOverride ?? (async () => (await (await import('./renders.js')).ffmpegState()).path))(),
  podInfo: async (paths) => {
    try {
      const R = await import('./renders.js'), outs = new Set(paths.map((x) => `output/${x}`))
      for (const j of R.status().jobs) if (j.pod_id && j.sequences.some((q) => outs.has(q.out) || (q.outs ?? []).some((o) => outs.has(o)))) return { provider: 'RunPod', pod_id: j.pod_id, gpu: j.pod_name || 'n/a', hours: 0.0, cost_usd: 0.0, paid_by: 'n/a', provider_api_calls: 'n/a' }
    } catch { /* unknown */ }
    return null
  },
  volumeRecord: async (id) => {
    try {
      if (!volMemo || Date.now() - volMemo.at > 5 * 60_000) volMemo = { at: Date.now(), rows: (await (await import('./volumes.js')).list()).map((v) => ({ id: v.id, name: v.name, datacenter: v.datacenter })) }
      return volMemo.rows.find((v) => v.id === id) ?? null
    } catch { return null }
  },
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
async function effective(): Promise<{ s3: typeof PUBLISH_DEFAULTS.s3 & { credentials: 'app' | 'panama'; layout: layout.Layout }; slack: typeof PUBLISH_DEFAULTS.slack; defaults: { targets: Target[]; message: string } }> {
  const st = await readJson<Stored>(cfgFile(), {})
  const pick = <T extends object>(base: T, over: Partial<T> | undefined): T => { const o = { ...base }; for (const [k, v] of Object.entries(over ?? {})) if (v !== undefined && v !== '' && k in base) (o as Record<string, unknown>)[k] = v; return o }
  const targets = (st.defaults?.targets ?? []).filter((t): t is Target => t === 's3' || t === 'slack')
  return {
    s3: { ...panamaFill(pick({ ...PUBLISH_DEFAULTS.s3 }, st.s3)), layout: layout.layoutFor(st.s3?.prefix || PUBLISH_DEFAULTS.s3.prefix, (st.s3 as { layout?: string } | undefined)?.layout) }, slack: { ...pick({ ...PUBLISH_DEFAULTS.slack }, st.slack), per_shot: typeof st.slack?.per_shot === 'boolean' ? st.slack.per_shot : layout.layoutFor(st.s3?.prefix || PUBLISH_DEFAULTS.s3.prefix, (st.s3 as { layout?: string } | undefined)?.layout) === 'bkk-return' },
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
    s3: { layout: e.s3.layout, bucket: e.s3.bucket, prefix: e.s3.prefix, region: e.s3.region, endpoint: e.s3.endpoint, credentials: e.s3.credentials, access_key_hint: settingsEnv.secretHint(secret('PUBLISH_S3_ACCESS_KEY_ID')), presign_hours: e.s3.presign_hours, transfer: e.s3.transfer, ready: !sp, ...(sp ? { problem: sp } : {}), ...(usesDefault ? { note: DESTINATION_NOTE, destination_confirmed: DESTINATION_NOTE } : {}) },
    slack: { channel: e.slack.channel, username: e.slack.username, workspace_name: e.slack.workspace_name, workspace_url: e.slack.workspace_url, preview_frame: e.slack.preview_frame, volume_source: e.slack.volume_source, per_shot: e.slack.per_shot, file_links: e.slack.file_links, file_link_count: e.slack.file_link_count, folder_link: e.slack.folder_link, webhook_hint: settingsEnv.secretHint(secret('PUBLISH_SLACK_WEBHOOK_URL')), ready: !lp, ...(lp ? { problem: lp } : {}) },
    defaults: e.defaults,
  }
}

export interface SettingsInput {
  s3?: { layout?: string; bucket?: string; prefix?: string; region?: string; endpoint?: string; credentials?: string; presign_hours?: number; transfer?: string; access_key_id?: string; secret_access_key?: string }
  slack?: { channel?: string; username?: string; workspace_name?: string; workspace_url?: string; preview_frame?: boolean; volume_source?: boolean; file_links?: boolean; file_link_count?: number; folder_link?: boolean; per_shot?: boolean; webhook_url?: string }
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
  if ((i.s3 as { layout?: unknown } | undefined)?.layout !== undefined) { const l = (i.s3 as { layout?: unknown }).layout; if (l !== '' && l !== 'as-is' && l !== 'bkk-return') throw bad("s3.layout is 'as-is' or 'bkk-return'"); const o = ((st.s3 ??= {}) as Record<string, unknown>); if (l === '') delete o.layout; else o.layout = l; changedNames.push('s3.layout') }
  for (const k of ['channel', 'username', 'workspace_name', 'workspace_url'] as const) put('slack', k, i.slack?.[k])
  if (i.slack?.file_link_count !== undefined) {
    const n = i.slack.file_link_count
    if (!(typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 25)) throw bad('slack.file_link_count is a whole number from 1 to 25')
    ;((st.slack ??= {}) as Record<string, unknown>).file_link_count = n; changedNames.push('slack.file_link_count')
  }
  for (const k of ['preview_frame', 'volume_source', 'file_links', 'folder_link', 'per_shot'] as const) {
    const v = i.slack?.[k]; if (v === undefined) continue
    if (typeof v !== 'boolean') throw bad(`slack.${k} is true or false`)
    ;((st.slack ??= {}) as Record<string, unknown>)[k] = v; changedNames.push(`slack.${k}`)
  }
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
async function postSlack(text: string, blocks?: unknown[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const e = await effective(), hook = secret('PUBLISH_SLACK_WEBHOOK_URL')
  if (!hook) return { ok: false, error: slackProblem(e.slack) ?? 'Slack is not configured' }
  const body = JSON.stringify({ text, ...(blocks?.length ? { blocks } : {}), username: e.slack.username, ...(e.slack.channel ? { channel: e.slack.channel } : {}) })
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

// ----- Slack extras: a first-frame preview and the source on the volume -----
export interface PreviewSrc { abs: string; rel: string; shot: string; clip: string; kind: 'video' | 'dpx'; bytes: number }
const VIDEO_RE = /\.(mov|mp4|m4v|mxf|webm|avi|mkv)$/i
export const PREVIEW_MAX = 3, FFMPEG_MS = 30_000, CONSOLE_URL = 'https://console.runpod.io/user/storage'
const deliverShot = (rel: string): string | null => { const parts = rel.split('/'), i = parts.indexOf('deliver'); return i >= 0 && parts[i + 1] && /^v\d{3,}$/.test(parts[i + 2] ?? '') ? parts[i + 1].toLowerCase() : null }
const shotOfPath = (rel: string, clip: string): string => { const parts = rel.split('/'), i = parts.indexOf('deliver'); return i >= 0 && parts[i + 1] && /^v\d{3,}$/.test(parts[i + 2] ?? '') ? parts[i + 1].toLowerCase() : shotOf(clip, posix.dirname(rel) === '.' ? '' : posix.dirname(rel)) }
/** Which files can give a first frame, one per clip, the first three in the list: a video file (its first frame) or a DPX sequence (its lowest-numbered frame). Files that are not on this PC are never in the list. */
export function previewSources(items: { path: string; abs: string; bytes: number }[], max = PREVIEW_MAX): PreviewSrc[] {
  const found = new Map<string, PreviewSrc & { n?: number }>()
  for (const it of items) {
    const name = basename(it.path)
    if (VIDEO_RE.test(name)) { const clip = name.replace(VIDEO_RE, ''), key = `v:${posix.dirname(it.path)}/${clip}`; if (!found.has(key)) found.set(key, { abs: it.abs, rel: it.path, shot: shotOfPath(it.path, clip), clip, kind: 'video', bytes: it.bytes }) }
    else if (/\.dpx$/i.test(name)) {
      const m = DPX_FRAME.exec(name), clip = m ? m[1].replace(/[._-]+$/, '') : name.replace(/\.dpx$/i, ''), key = `d:${posix.dirname(it.path)}/${clip}`, n = m ? Number(m[3]) : 0, have = found.get(key)
      if (!have || n < (have.n ?? Infinity)) found.set(key, { abs: it.abs, rel: it.path, shot: shotOfPath(it.path, clip), clip, kind: 'dpx', bytes: it.bytes, n })
    }
  }
  return [...found.values()].slice(0, max).map(({ n: _n, ...x }) => x)
}
/** The volume folders the published files came from: a volume item's own folder, and the folder of a file this PC pulled from a pod (its sidecar says `adapter: pod`). Full volume paths, ending in /. */
export async function sourceFolders(items: { path: string; abs?: string; source?: 'pc' | 'volume'; source_key?: string }[]): Promise<string[]> {
  const out: string[] = []; let read = 0
  const add = (f: string) => { if (!out.includes(f)) out.push(f) }
  for (const it of items) {
    if (it.source === 'volume' && it.source_key) add(`${posix.dirname(it.source_key)}/`)
    else if (it.abs && VIDEO_RE.test(it.path) && read < 20) { read++; const m = await readJson<Record<string, unknown>>(`${it.abs}.meta.json`, {}); if (m.adapter === 'pod') add(`${VOLUME_OUTPUT}${posix.dirname(it.path) === '.' ? '' : `${posix.dirname(it.path)}/`}`) }
  }
  return out
}
type Block = Record<string, unknown>
const nowrap = (t: string, n = 2900) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
/** The "Source on the volume" lines: the volume's name and datacenter, where in it, the console's storage page and a copy-paste `aws s3 ls`. Never a key, never a signed URL. */
export async function volumeBlocks(folders: string[]): Promise<Block[]> {
  const id = deps.volumeId(); if (!folders.length || !id) return []
  const rec = await deps.volumeRecord(id).catch(() => null), dc = rec?.datacenter ?? '', shown = folders.slice(0, 3), more = folders.length - shown.length
  const text = `*Source on the volume:* ${rec?.name ?? id}${dc ? ` (${dc})` : ''} · ${shown.map((f) => `\`${f}\``).join(', ')}${more > 0 ? ` +${more} more` : ''} · <${CONSOLE_URL}|RunPod console: Storage>`
  const blocks: Block[] = [{ type: 'section', text: { type: 'mrkdwn', text: nowrap(text) } }]
  if (dc) { const l = dc.toLowerCase(); blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `\`aws s3 ls s3://${id}/${shown[0]} --endpoint-url https://s3api-${l}.runpod.io --region ${l}\`` }] }) }
  return blocks
}
interface PreviewShot { shot: string; clip: string; label: string; bytes: number; url: string }
const runFfmpeg = (bin: string, args: string[], ms = FFMPEG_MS): Promise<boolean> => new Promise((resolve) => {
  let c: ChildProcess; try { c = deps.spawn(bin, args, {}) } catch { return resolve(false) }
  const t = setTimeout(() => { try { c.kill('SIGKILL') } catch { /* gone */ } resolve(false) }, ms)
  c.stdout?.resume(); c.stderr?.resume()
  c.on('error', () => { clearTimeout(t); resolve(false) }); c.on('close', (code) => { clearTimeout(t); resolve(code === 0) })
})
export const previewArgs = (src: string, out: string): string[] => ['-y', '-nostdin', '-loglevel', 'error', '-i', src, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', out]   // a plain scale: no colour transform, like the proxies
/** Make, upload and presign the first-frame images of a run. Best effort: every problem is a quiet warning, never a failure. The temp files are removed. */
async function makePreviews(job: Job, a: Awaited<ReturnType<typeof s3Access>>, signal: AbortSignal): Promise<PreviewShot[]> {
  const v = job.view, warn = (m: string) => { v.warnings = [...new Set([...(v.warnings ?? []), m])] }
  const srcs = job.psrc ?? []
  if (!srcs.length) { if (job.volOnly) warn('Preview unavailable: the files are only on the volume (this version makes no frame from them)'); return [] }
  const bin = await deps.findFfmpeg().catch(() => null); if (!bin) { warn('No preview frame: ffmpeg is not installed'); return [] }
  const dir = join(configDir(), 'cache', 'publish-previews'), made: string[] = [], shots: PreviewShot[] = []
  try {
    await mkdir(dir, { recursive: true })
    for (const [i, src] of srcs.entries()) {
      if (signal.aborted) break
      const out = join(dir, `${v.job_id}${job.tag ?? ''}-${i}.jpg`); made.push(out)
      if (!(await runFfmpeg(bin, previewArgs(src.abs, out)))) { warn(`No preview frame for ${src.clip}: ffmpeg could not read it`); continue }
      const bytes = (await lstat(out).catch(() => null))?.size ?? 0; if (!bytes) { warn(`No preview frame for ${src.clip}: ffmpeg made no image`); continue }
      const name = `${src.clip}_preview.jpg`, key = `${job.prefix ?? ''}${src.shot}/${name}`
      const have = await deps.aws(['s3', 'ls', `s3://${a.bucket}/${key}`, ...a.common], a.env, { signal, stallMs: 30_000 }), same = have.code === 0 && new RegExp(`\\s${bytes}\\s`).test(have.stdout)
      if (!same) { const up = await deps.aws(['s3', 'cp', out, `s3://${a.bucket}/${key}`, ...a.common], a.env, { signal, stallMs: 60_000 }); if (up.code !== 0) { warn(`No preview frame for ${src.clip}: the image did not upload`); continue } }
      v.previews = [...(v.previews ?? []), { name, s3_key: key, bytes, preview: true }]
      const pre = await deps.aws(['s3', 'presign', `s3://${a.bucket}/${key}`, '--expires-in', String(a.presign_hours * 3600), ...a.common], a.env, { signal, stallMs: 30_000 }), url = pre.stdout.trim().split('\n')[0]
      if (pre.code === 0 && /^https:\/\//.test(url) && url.length < 3000) v.links.push({ path: name, url, expires_at: new Date(deps.now() + a.presign_hours * 3600_000).toISOString(), kind: 'preview' })
      if (pre.code === 0 && /^https:\/\//.test(url) && url.length < 3000) shots.push({ shot: src.shot, clip: src.clip, label: basename(src.rel), bytes: src.bytes, url }); else warn(`No preview image in Slack for ${src.clip}: the link could not be made`)
    }
  } catch { warn('No preview frame: something went wrong making it') } finally { for (const f of made) await rm(f, { force: true }).catch(() => undefined) }
  return shots
}
/** The blocks of a Slack post: the usual summary first, then for each preview a line (shot, file, size) and the image (an expiring URL), then the source on the volume. Under Slack's limits (50 blocks, 3000 characters a text). */
export function buildBlocks(text: string, previews: PreviewShot[], source: Block[], links: Block[] = []): Block[] | undefined {
  if (!previews.length && !source.length && !links.length) return undefined
  const blocks: Block[] = [{ type: 'section', text: { type: 'mrkdwn', text: nowrap(text) } }]
  for (const p of previews.slice(0, PREVIEW_MAX)) { blocks.push({ type: 'section', text: { type: 'mrkdwn', text: nowrap(`*${p.shot}* ${p.label} (${fmtSize(p.bytes)})`) } }); blocks.push({ type: 'image', image_url: p.url, alt_text: `${p.shot} first frame` }) }
  return [...blocks.slice(0, 1), ...links, ...blocks.slice(1), ...source].slice(0, 50)
}
/** What a post adds to its text: the previews (when the setting is on and S3 holds them) and the source on the volume (when on). */
async function slackExtras(job: Job, a: Awaited<ReturnType<typeof s3Access>> | null, text: string, signal: AbortSignal, linkSections: Block[] = []): Promise<Block[] | undefined> {
  let prev: PreviewShot[] = []
  if (job.psrc?.length || job.volOnly) { if (a) prev = await makePreviews(job, a, signal); else job.view.warnings = [...new Set([...(job.view.warnings ?? []), 'No preview frame: S3 is not a target (the image needs a place to be hosted)'])] }
  const source = job.folders?.length ? await volumeBlocks(job.folders) : []
  return buildBlocks(text, prev, source, linkSections)
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

// ----- the EDL judges each sequence of a return (ADR-050) -----
const overrideMap = (v: unknown): Record<string, boolean> => {
  if (v === undefined || v === null) return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('edl_override maps a sequence stem to true')
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x === true).map(([k]) => [k, true]))
}
const tcMap = (v: unknown): Record<string, string> => {
  if (v === undefined || v === null) return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('start_timecodes maps a sequence stem to HH:MM:SS:FF')
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => { if (typeof x !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d:\d\d$/.test(x)) throw bad(`start_timecodes: ${k} is HH:MM:SS:FF (non-drop, colons)`); return [k, x] }))
}
/** Each DPX sequence of the return judged on its own: its start timecode (field, DPX header, EDL), its frame count against the EDL cut, whether the EDL has it at all. A held-back sequence's files (and its movie) are marked `blocked`; the others go on. */
/** A round named `_TEST_...` (case-sensitive) is a test: the frame count is not checked against the EDL (a warning, a manifest note); everything else stays a block. A real round has no override like it. */
export const isTestRound = (round: string | null | undefined): boolean => typeof round === 'string' && round.startsWith('_TEST_')
async function judgeSequences(items: PlanItem[], kiOf: Map<PlanItem, layout.KeyInfo>, base: string, req: { edl_override?: unknown; start_timecodes?: unknown }, round: string | null): Promise<PubSeq[]> {
  await edl.ensure()
  const ov = overrideMap(req.edl_override), tcs = tcMap(req.start_timecodes), groups = new Map<string, { ki: layout.KeyInfo; n: number; first: PlanItem }>()
  for (const it of items) { const ki = kiOf.get(it); if (!ki || ki.role !== 'dpx' || it.skip === 'missing' || it.skip === 'weights') continue; const g = groups.get(ki.stem); if (g) g.n++; else groups.set(ki.stem, { ki, n: 1, first: it }) }
  const R = groups.size ? await import('./renders.js') : null, out: PubSeq[] = [], held = new Map<string, string>()
  for (const [stem, g] of groups) {
    let headerTc: string | null = null
    if (g.first.source !== 'volume' && base) { const hb = await readHeadBytes(join(base, g.first.path)); headerTc = (hb && R ? R.parseDpxInfo(hb) : null)?.timecode ?? null }
    const a = tunnelj.assess({ name: stem, ...(g.ki.clip !== stem ? { clip_name: g.ki.clip } : {}), frames: g.n, ...(tcs[stem] ? { start_timecode: tcs[stem] } : {}), header_tc: headerTc, override: !!ov[stem] || !!ov[g.ki.clip], waiveFrames: isTestRound(round), strict: true })
    const reason = a.blocked ? tunnelj.blockReasons(a) : undefined, notes = [...a.notes, ...(a.start_timecode ? [`start timecode ${a.start_timecode} (${a.timecode_source})`] : [])]
    out.push({ stem, clip: g.ki.clip, shot: g.ki.shot, frames: g.n, expected_frames: a.expected_frames, edl_element: a.edl_element, start_timecode: a.start_timecode, timecode_source: a.timecode_source, flags: a.flags, blocked: a.blocked, files: g.n, ...(a.overridden ? { override: a.overridden } : {}), notes, ...(reason ? { reason } : {}) })
    if (reason) { held.set(stem, reason); held.set(g.ki.clip, reason) }
    await new Promise<void>((r) => setImmediate(r))
  }
  for (const it of items) { const ki = kiOf.get(it); const why = ki && (held.get(ki.stem) ?? held.get(ki.clip)); if (why && it.skip !== 'missing' && it.skip !== 'weights') { it.skip = 'blocked'; it.reason = why } }
  return out.sort((x, y) => x.shot.localeCompare(y.shot) || x.clip.localeCompare(y.clip))
}

// ----- plan -----
export interface PlanItem { /** the name on disk when the upload renames it (a clip name) */ renamed_from?: string; shot?: string; path: string; bytes: number; s3_key: string; skip: 'same size already there' | 'weights' | 'missing' | 'blocked' | null; /** why it is blocked (the sequence's flags) */ reason?: string; /** where the file is read from: this PC (default) or the volume, streamed through this PC */ source?: 'pc' | 'volume'; source_key?: string }
export type ItemIn = string | { where: 'volume'; path: string; /** only the frames `<stem>.<n>.dpx` of this folder */ stem?: string }
export interface Plan {
  ok: boolean; blockers: string[]; items: PlanItem[]; total_bytes: number; files: number
  s3: { dest: string; count: number; new_bytes: number } | null
  slack: { channel: string; to: string; preview: string; /** what links the post will carry */ links: { folder: boolean; files: number; expires_at: string | null }; /** how many first-frame images the post will carry (0 when none can be made) */ preview_frames: number; /** the plain reason when the first frame is wanted but none can be made, else null */ preview_problem: string | null; /** whether the post will include the 'Source on the volume' block */ volume_source: boolean } | null
  /** quiet notes about the plan (for example why there is no preview) */ warnings: string[]
  /** the first-frame images that go up next to the files (listed apart from the files) */ previews: { name: string; s3_key: string }[]
  refused: { path: string; reason: string }[]
  /** files that go from the volume through this PC (nothing is copied here) */ streamed_files: number; streamed_bytes: number
  /** the destination layout and, for the BKK return, the round the keys sit in */ layout: layout.Layout; round: string | null
  /** the BKK return: each sequence judged against the EDL (flags as the renders), and whether it is held back */ sequences?: PubSeq[]; edl?: edl.EdlStatus
}
export interface PubSeq { stem: string; clip: string; shot: string; frames: number; expected_frames: number | null; edl_element: tunnelj.EdlRow | null; start_timecode: string | null; timecode_source: tunnelj.TimecodeSource | null; flags: tunnelj.Flag[]; blocked: boolean; files: number; override?: { stem: string; frames: number; expected: number }; /** what the manifest's notes will carry */ notes: string[]; /** why its files are not sent */ reason?: string }
export interface PlanRequest { /** the BKK return: a sequence stem -> true to deliver it although its frame count differs from the EDL cut (recorded in the manifest notes) */ edl_override?: Record<string, boolean>; /** the BKK return: a sequence stem -> its start timecode (else the DPX header's, else the EDL's source-in) */ start_timecodes?: Record<string, string>; /** the BKK return: the round (a folder under the prefix) the files go into; required for that layout */ round?: string; /** the BKK return: sequence stem -> the clip name it is delivered as (frames on disk are never renamed) */ clip_names?: Record<string, string>; /** per run: a first-frame preview in the Slack post (default: the setting) */ preview_frame?: boolean; items?: unknown /* ItemIn[] */; targets?: unknown; message?: string; shot_hint?: string; approved_by?: string }
const targetsOf = (t: unknown): Target[] => {
  if (!Array.isArray(t) || !t.length || t.some((x) => x !== 's3' && x !== 'slack')) throw bad("targets is a list of 's3' and/or 'slack'")
  return [...new Set(t)] as Target[]
}
export const fmtSize = (b: number): string => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`

interface MsgInfo { first: { path: string; bytes: number; key: string }[]; count: number; bytes: number; dest: string }
export function renderMessage(template: string, o: { approved_by: string; info: MsgInfo; /** the file link lines (what {links} becomes) */ linkText?: string; /** the folder link lines (what {folders} becomes) */ folderText?: string; /** add them at the end when the template has no placeholder for them */ append?: boolean; date: string }): string {
  const files = o.info.first.map((f) => `• ${basename(f.path)} (${fmtSize(f.bytes)})`).join('\n') + (o.info.count > o.info.first.length ? `\n…and ${o.info.count - o.info.first.length} more` : '')
  const links = o.linkText ?? '', folders = o.folderText ?? ''
  let body = template.replace(/\{(approved_by|count|size|dest|files|links|folders|date)\}/g, (_m, k: string) => ({ approved_by: o.approved_by, count: String(o.info.count), size: fmtSize(o.info.bytes), dest: o.info.dest, files, links, folders, date: o.date } as Record<string, string>)[k])
  if (o.append) { if (folders && !template.includes('{folders}')) body += `\n${folders}`; if (links && !template.includes('{links}')) body += `\n${links}` }
  body = body.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')
  return `${TITLE}\n${body}${template.includes('{approved_by}') ? '' : `\nApproved by ${o.approved_by}`}`.trim()
}

// ----- links in a Slack post: the destination folder (the AWS console, access controlled) and expiring links to the first files -----
export interface LinkPlan { file_links: boolean; count: number; folder_link: boolean; files: { path: string; key: string; name: string; bytes: number }[]; folders: { key: string; label: string }[] }
const NOT_LINKED = (name: string) => name === 'DELIVERY.md' || /\.meta\.json$/i.test(name) || /_preview\.jpg$/i.test(name) || isWeight(name)
/** From the files of a run: which can get a link (not the sidecars, DELIVERY.md or previews), and the first five folders they sit in. */
export function linkPlanOf(items: { path: string; s3_key: string; bytes: number }[], prefix: string, s: { file_links: boolean; file_link_count: number; folder_link: boolean }): LinkPlan {
  const files = items.filter((i) => !NOT_LINKED(basename(i.path))).map((i) => ({ path: i.path, key: i.s3_key, name: basename(i.path), bytes: i.bytes }))
  const folders: LinkPlan['folders'] = []
  for (const i of items) {
    const key = `${posix.dirname(i.s3_key)}/`; if (folders.some((f) => f.key === key) || folders.length >= 5) continue
    const parts = key.slice(prefix.length).split('/').filter(Boolean), last = parts[parts.length - 1] ?? ''
    folders.push({ key, label: parts.length >= 2 && /^v\d{3,}$/.test(last) ? `${parts[parts.length - 2]} ${last}` : parts.slice(-2).join(' ') || prefix.replace(/\/$/, '') || 'destination' })
  }
  return { file_links: s.file_links, count: s.file_link_count, folder_link: s.folder_link, files, folders }
}
/** `https://s3.console.aws.amazon.com/s3/buckets/<bucket>?prefix=<folder>/&region=<region>`: permanent, never signed, opens for people with access to the bucket. */
export const consoleFolderUrl = (bucket: string, key: string, region: string): string => `https://s3.console.aws.amazon.com/s3/buckets/${bucket}?prefix=${encodeURIComponent(key).replace(/%2F/g, '/')}&region=${region}`
const chunkLines = (head: string, lines: string[]): Block[] => {
  const out: Block[] = []; let cur = head
  for (const l of lines) { if (cur.length + l.length + 1 > 2800 && cur !== head) { out.push({ type: 'section', text: { type: 'mrkdwn', text: cur } }); cur = '' } cur = cur ? `${cur}\n${l}` : l }
  if (cur) out.push({ type: 'section', text: { type: 'mrkdwn', text: cur } })
  return out
}
/** Make the folder links and the file links of a post. A link that cannot be made is left out with a warning; nothing is ever written to a log or History. */
async function makeLinks(job: Job, a: Awaited<ReturnType<typeof s3Access>> | null, signal: AbortSignal): Promise<{ links: JobView['links']; folderText: string; linkText: string; sections: Block[] }> {
  const lp = job.lp, v = job.view, empty = { links: [] as JobView['links'], folderText: '', linkText: '', sections: [] as Block[] }
  if (!lp || !a) return empty
  const warn = (m: string) => { v.warnings = [...new Set([...(v.warnings ?? []), m])] }
  const exp = deps.now() + a.presign_hours * 3600_000, expD = new Date(exp).toISOString(), day = expD.slice(0, 10)
  const folderLines = lp.folder_link && !a.endpoint ? lp.folders.map((f) => `Folder: <${consoleFolderUrl(a.bucket, f.key, a.region)}|${f.label}> (s3://${a.bucket}/${f.key})`) : []
  const links: JobView['links'] = lp.folder_link && !a.endpoint ? lp.folders.map((f) => ({ path: f.key, url: consoleFolderUrl(a.bucket, f.key, a.region), expires_at: '', kind: 'folder' as const })) : [], fileLines: string[] = []
  if (lp.file_links) {
    for (const f of lp.files.slice(0, lp.count)) {
      if (signal.aborted) break
      const r = await deps.aws(['s3', 'presign', `s3://${a.bucket}/${f.key}`, '--expires-in', String(a.presign_hours * 3600), ...a.common], a.env, { signal, stallMs: 30_000 })
      const url = r.stdout.trim().split('\n')[0]
      if (r.code === 0 && /^https?:\/\//.test(url)) { links.push({ path: f.path, url, expires_at: expD, kind: 'file' }); fileLines.push(`• <${url}|${f.name}> (${fmtSize(f.bytes)}, expires ${day})`) } else warn(`No link for ${f.name}: it could not be made`)
    }
    if (lp.files.length > lp.count) fileLines.push(`+${lp.files.length - lp.count} more${folderLines.length ? ' (the folder link covers them)' : ''}`)
  }
  const sections = [...(folderLines.length ? chunkLines('', folderLines) : []), ...(fileLines.length ? chunkLines(`*Files* (links expire ${day})`, fileLines) : [])]
  return { links, folderText: folderLines.join('\n'), linkText: fileLines.join('\n'), sections }
}

// ----- the volume's output/ (read-only, over the app's RunPod S3 access) -----
export const VOLUME_OUTPUT = 'comfy-shared/output/'
type VolAccess = { ok: true; id: string; secret: string; endpoint: string; bucket: string; region: string } | { ok: false; reason: string }
const volumeAccess = async (): Promise<VolAccess> => { const v = deps.volumeId(); return v ? deps.volumeAccess(v) : { ok: false, reason: 'No Shared or network volume is set (Default Configuration)' } }
/** One `aws s3 ls` of a volume prefix: its sub-folders and files (a recursive listing has the files only, with full keys). */
async function volLs(a: Extract<VolAccess, { ok: true }>, prefix: string, recursive: boolean, signal?: AbortSignal): Promise<{ dirs: string[]; files: { key: string; bytes: number; modified: string }[] }> {
  const r = await deps.aws(['s3', 'ls', `s3://${a.bucket}/${prefix}`, ...(recursive ? ['--recursive'] : []), '--endpoint-url', a.endpoint, '--region', a.region], { AWS_ACCESS_KEY_ID: a.id, AWS_SECRET_ACCESS_KEY: a.secret }, { signal, stallMs: 90_000 })
  if (signal?.aborted) throw new CoreError(499, 'The listing was cancelled')
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

/** What a Slack post will carry, for a plan: the first-frame sources, why there are none, and whether the volume source shows. */
async function slackPlan(o: { targets: Target[]; pf: boolean; vs: boolean; local: { path: string; abs: string; bytes: number }[]; hasVolume: boolean; folders: string[] }): Promise<{ psrc: PreviewSrc[]; problem: string | null; volume_source: boolean; lines: string[] }> {
  const slack = o.targets.includes('slack')
  let psrc: PreviewSrc[] = [], problem: string | null = null
  if (slack && o.pf) {
    if (!o.targets.includes('s3')) problem = 'Previews need S3 as a target too (the image needs a place to be hosted)'
    else { psrc = previewSources(o.local); if (!psrc.length) problem = o.local.length || !o.hasVolume ? 'No local video or sequence in the selection' : 'The selection is only on the volume (streamed)' }
    if (psrc.length && !(await deps.findFfmpeg().catch(() => null))) { psrc = []; problem = 'ffmpeg is not installed on this PC (brew install ffmpeg)' }
  }
  const volume_source = slack && o.vs && o.folders.length > 0
  const lines = [...(psrc.length ? [`With a preview of the first frame of ${psrc[0].clip}${psrc.length > 1 ? ` (and ${psrc.length - 1} more)` : ''}`] : []), ...(volume_source ? ['With the source location on the volume'] : [])]
  return { psrc, problem, volume_source, lines }
}

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
    const valid: string[] = [], stems = new Map<string, string>()
    for (const raw of volItems) {
      const o = raw as { where?: string; path?: unknown; stem?: unknown }, rel = o && typeof o === 'object' && o.where === 'volume' ? cleanRel(o.path) : null
      if (rel === null || rel === '') refused.push({ path: String(typeof o === 'object' ? (o as { path?: string })?.path ?? '' : o).slice(0, 200), reason: 'Not a path inside the volume output/ (items are a string, or { where: "volume", path } with no .. and no leading slash)' })
      else { valid.push(rel); if (typeof o.stem === 'string' && o.stem) stems.set(rel, o.stem) }
    }
    const va = valid.length ? await volumeAccess() : null
    if (va && !va.ok) blockers.push(`The volume cannot be read: ${va.reason}`)
    else if (va) for (const rel of valid) {
      let found: { key: string; bytes: number }[] = []
      try {
        found = (await volLs(va, `${VOLUME_OUTPUT}${rel}/`, true)).files
        const stem = stems.get(rel); if (stem) { const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+\\.dpx$`); found = found.filter((f) => re.test(basename(f.key)) && posix.dirname(f.key) === `${VOLUME_OUTPUT}${rel}`) }
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
  if (!items.some((i) => i.skip !== 'missing' && i.skip !== 'weights' && i.skip !== 'blocked')) blockers.push('Nothing to publish: no files were found in what you chose')
  // the BKK return layout: `<prefix><round>/<shot>/...` (frames named after their clip), and ONE listing of the round for the same-size skip
  let roundName: string | null = null, clipNames: Record<string, string> = {}, pubSeqs: PubSeq[] | undefined
  const kiOf = new Map<PlanItem, layout.KeyInfo>()
  if (e.s3.layout === 'bkk-return' && targets.includes('s3') && !sp) {
    roundName = layout.validateRound(req.round); clipNames = layout.validateClipNames(req.clip_names)
    for (const it of items) { const ki = layout.layoutKey({ prefix, round: roundName, path: it.path, clipNames, shotOf, deliverShot }); it.s3_key = ki.key; it.shot = ki.shot; kiOf.set(it, ki); if (ki.renamed_from) it.renamed_from = ki.renamed_from }
    pubSeqs = await judgeSequences(items, kiOf, base, req, roundName)
    roots.length = 0; roots.push({ prefix: `${prefix}${roundName}/`, recursive: true })
    if (pubSeqs?.some((x) => x.blocked) && !items.some((i) => i.skip !== 'missing' && i.skip !== 'weights' && i.skip !== 'blocked')) blockers.push(`Every sequence is held back: ${pubSeqs.filter((x) => x.blocked).slice(0, 3).map((x) => `${x.clip}: ${x.reason}`).join(' | ')}`)
  }
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
  const send = items.filter((i) => i.skip === null), real = items.filter((i) => i.skip !== 'missing' && i.skip !== 'weights' && i.skip !== 'blocked')
  const total_bytes = real.reduce((a, i) => a + i.bytes, 0), dest = `s3://${e.s3.bucket || '(bucket)'}/${prefix}`
  const info: MsgInfo = { first: real.slice(0, SLACK_FILES).map((i) => ({ path: i.path, bytes: i.bytes, key: i.s3_key })), count: real.length, bytes: total_bytes, dest }
  const to = `${e.slack.workspace_name || 'Slack'}: ${e.slack.channel || "(the webhook's own channel)"}`
  const template = req.message?.trim() ? req.message : e.defaults.message
  void sendable
  const localReal = real.filter((i) => i.source !== 'volume'), absOf = (i: PlanItem) => (base ? join(base, i.path) : i.path)
  const pf = typeof req.preview_frame === 'boolean' ? req.preview_frame : e.slack.preview_frame
  const folders = e.slack.volume_source && targets.includes('slack') ? await sourceFolders(real.map((i) => ({ path: i.path, ...(i.source ? { source: i.source } : {}), ...(i.source_key ? { source_key: i.source_key } : {}), ...(i.source !== 'volume' && base ? { abs: join(base, i.path) } : {}) }))) : []
  const sp2 = await slackPlan({ targets, pf, vs: e.slack.volume_source, local: localReal.map((i) => ({ path: i.path, abs: absOf(i), bytes: i.bytes })), hasVolume: real.some((i) => i.source === 'volume'), folders })
  const lkp = linkPlanOf(real.map((i) => ({ path: i.path, s3_key: i.s3_key, bytes: i.bytes })), prefix, e.slack)
  const linkInfo = { folder: lkp.folder_link && !e.s3.endpoint && lkp.folders.length > 0, files: lkp.file_links ? Math.min(lkp.count, lkp.files.length) : 0, expires_at: lkp.file_links && lkp.files.length ? new Date(deps.now() + e.s3.presign_hours * 3600_000).toISOString() : null }
  const linkLine = linkInfo.folder || linkInfo.files ? [`With ${linkInfo.folder ? `a link to the destination folder${linkInfo.files ? ' and ' : ''}` : ''}${linkInfo.files ? `links to the first ${linkInfo.files} file${linkInfo.files === 1 ? '' : 's'}, expiring ${linkInfo.expires_at!.slice(0, 10)}` : ''}`] : []
  const psrc = sp2.psrc, extraLines = [...linkLine, ...sp2.lines]
  return {
    ok: !blockers.length && !refused.length, blockers, items, total_bytes, files: real.length,
    streamed_files: send.filter((i) => i.source === 'volume').length, streamed_bytes: send.filter((i) => i.source === 'volume').reduce((a, i) => a + i.bytes, 0),
    s3: targets.includes('s3') ? { dest, count: send.length, new_bytes: send.reduce((a, i) => a + i.bytes, 0) } : null,
    previews: psrc.map((x) => ({ name: `${x.clip}_preview.jpg`, s3_key: `${prefix}${x.shot}/${x.clip}_preview.jpg` })),
    warnings: sp2.problem ? [sp2.problem] : [],
    slack: targets.includes('slack') ? { channel: e.slack.channel, to, preview_frames: psrc.length, preview_problem: sp2.problem, volume_source: sp2.volume_source, links: linkInfo, preview: `To ${to}\n\n${renderMessage(template, { approved_by: req.approved_by?.trim() || '(the approver you name)', info, date: new Date(deps.now()).toISOString().slice(0, 10) })}${extraLines.length ? `\n${extraLines.join('\n')}` : ''}` } : null,
    refused, layout: e.s3.layout, round: roundName, ...(pubSeqs ? { sequences: pubSeqs, edl: edl.status() } : {}),
  }
}

// ----- jobs -----
export type JobState = 'queued' | 'uploading' | 'posting' | 'done' | 'done_with_warning' | 'failed' | 'cancelled'
/** One shot of a publish run: its own state, progress, errors and Slack message; retried or cancelled alone. */
export interface ChildView {
  id: string; parent_id: string; shot: string; clip: string; state: 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled'
  /** files to upload, uploaded, bytes of those, bytes sent, bytes a second, the file being sent, files already there */ files: number; files_done: number; bytes: number; bytes_done: number; rate: number; current: string; skipped: number
  error?: string; warnings: string[]; approved_by: string; slack: { state: 'skipped' | 'sent' | 'failed'; error?: string }; /** how many files have a sha256 (the BKK return) */ sha256: number
}
export interface JobView {
  /** what this run was asked to do, kept with the record so a shot that failed can be sent again after a restart (never in status: `retryable` says it is there) */ request?: RunRequest; retryable?: boolean
  /** for a failed job: the failure in words (stage, message, recovery, retryable) */ failure?: failures.Explained
  /** who started it: the window, an MCP tool call (client name), Auto-publish, the backfill; `external` = another process owns it */ origin?: jobsregistry.Origin; mcp_client?: string; external?: boolean; /** what this is, for the Queue: a publish run (scans and inventories are not in this list) */ kind: 'publish'; /** what started it: a person ('manual'), the backfill, or Auto-publish */ trigger: 'manual' | 'backfill' | 'auto-publish'; /** one child per shot, in the order they run */ children: ChildView[]; /** how many children upload at once */ streams: number; counts: { queued: number; uploading: number; done: number; failed: number; cancelled: number }
  job_id: string; state: JobState; targets: Target[]; approved_by: string; started_at: string; finished_at: string
  files_total: number; files_done: number; bytes_total: number; bytes_done: number; rate_bps: number; current: string; skipped: number; dest: string
  /** how the files that live on the volume got to the bucket: from a pod on the volume ('pod', with its name) or streamed through this PC ('pc'); `files` says which carried each one (and its sha256) */
  adapter: 'pod' | 'pc'; pod?: string; pod_files: number; pc_files: number; files: JobFile[]
  /** the BKK return: the shots run with an EDL frame-count override (also in the manifest notes) */ edl_overrides?: { stem: string; frames: number; expected: number }[]; /** the BKK return: the key of the RETURN-MANIFEST.json written for the run */ manifest?: { updated: boolean; shots: number; path: string; error?: string }; /** how many files have a sha256 (the BKK return), and the first thousand of them */ sha256_count?: number; results?: { path: string; bytes: number; sha256: string }[]; /** quiet notes (no preview frame: ffmpeg is not installed) */ warnings?: string[]; /** the preview images uploaded next to the files; never counted in the file totals */ previews?: { name: string; s3_key: string; bytes: number; preview: true }[]; note?: string; links: { path: string; url: string; expires_at: string; /** a file link (expiring), the destination folder (permanent) or a preview image (expiring) */ kind: 'file' | 'folder' | 'preview' }[]; slack: { state: 'skipped' | 'sent' | 'failed'; error?: string }; error?: string; summary: string
}
/** how the files that live on the volume got to the bucket: see ADR-050, amendment "transfer adapters" */
export interface JobFile { path: string; adapter: 'pod' | 'pc'; sha256?: string; shot?: string }
interface Group { child: ChildView; items: PlanItem[]; send: PlanItem[]; ac: AbortController; info: MsgInfo; lp?: LinkPlan; psrc?: PreviewSrc[]; folders?: string[]; partial: Map<string, number>; doneBytes: number; t0: number }
interface Job { /** the transfer adapter chosen for the volume files (once per job) */ route?: Promise<Route>; stopTrack?: () => void; groups: Group[]; streams: number; perShot: boolean; /** the raw trigger (History): auto-publish, auto-publish:manual, render ... */ trig?: string; tag?: string; /** the BKK return: the round, its files and the hashes made while they were read */ ret?: { /** sequence stem or clip -> the notes the manifest carries (EDL override, low resolution, start timecode) */ seq: Map<string, string[]>; round: string; prefix: string; items: PlanItem[]; clipNames: Record<string, string> }; hashes: Map<string, string>; lp?: LinkPlan; psrc?: PreviewSrc[]; volOnly?: boolean; folders?: string[]; prefix?: string; slackText?: string; view: JobView; abort: AbortController; info: MsgInfo; template: string; started: number; done: Promise<void> }
const jobs = new Map<string, Job>()
let finished: (JobView & { info?: MsgInfo; template?: string; slackText?: string })[] = []
let seq = 0
let loaded: Promise<void> | null = null
const iso = () => new Date(deps.now()).toISOString()
const counts = (kids: ChildView[]): JobView['counts'] => ({ queued: kids.filter((k) => k.state === 'queued').length, uploading: kids.filter((k) => k.state === 'uploading').length, done: kids.filter((k) => k.state === 'done').length, failed: kids.filter((k) => k.state === 'failed').length, cancelled: kids.filter((k) => k.state === 'cancelled').length })
const copy = (v: JobView): JobView => ({ ...v, children: (v.children ?? []).map((c) => ({ ...c, warnings: [...c.warnings], slack: { ...c.slack } })), counts: counts(v.children ?? []), warnings: [...(v.warnings ?? [])], links: v.links.map((l) => ({ ...l })), slack: { ...v.slack }, files: (v.files ?? []).map((f) => ({ ...f })) })
const ensureLoaded = (): Promise<void> => (loaded ??= readJson<(JobView & { info?: MsgInfo })[]>(jobsFile(), []).then((j) => { if (Array.isArray(j) && !finished.length) finished = j.slice(0, KEEP_JOBS) }))
let writing: Promise<void> = Promise.resolve()
const persist = (): void => { writing = writing.then(() => writeJson(jobsFile(), finished.map((f) => ({ ...f, links: f.links.map((l) => ({ ...l, url: '' })) }))).catch(() => undefined)) }
export const settled = async (): Promise<void> => { for (const j of jobs.values()) await j.done; await writing }

/** The volume's id (the Shared, else the default one), and a one-level listing under comfy-shared/output/ (read-only, abortable), for Auto-publish's volume scan. */
export const volumeIdNow = (): string => deps.volumeId()
export async function volumeBrowse(rel: string, signal?: AbortSignal): Promise<{ dirs: string[]; files: { name: string; bytes: number; key: string }[] }> {
  const a = await volumeAccess(); if (!a.ok) throw new CoreError(503, a.reason)
  const prefix = `${VOLUME_OUTPUT}${rel.replace(/^\/+/, '').replace(/\/*$/, '/')}`, ls = await volLs(a, prefix, false, signal)
  return { dirs: ls.dirs, files: ls.files.map((f) => ({ name: f.key.slice(prefix.length), bytes: f.bytes, key: f.key.slice(VOLUME_OUTPUT.length) })) }
}
/** A small object of the volume (at most `max` bytes), read through `aws s3 cp ... -`. */
export async function volumeReadText(relKey: string, max = 256 * 1024, signal?: AbortSignal): Promise<string | null> {
  const a = await volumeAccess(); if (!a.ok) throw new CoreError(503, a.reason)
  const r = await deps.aws(['s3', 'cp', `s3://${a.bucket}/${VOLUME_OUTPUT}${relKey}`, '-', '--endpoint-url', a.endpoint, '--region', a.region], { AWS_ACCESS_KEY_ID: a.id, AWS_SECRET_ACCESS_KEY: a.secret }, { ...(signal ? { signal } : {}), stallMs: 30_000 })
  return r.code === 0 && Buffer.byteLength(r.stdout) <= max ? r.stdout : null
}
export const validateRound = layout.validateRound, validateClipNames = layout.validateClipNames
/** From memory, instantly: running jobs first, then the newest finished. */
const who2 = (v: JobView) => v.approved_by
/** Publish jobs another process owns, from the registry file (`external: true`). */
const externalViews = (): JobView[] => jobsregistry.externals('publish').filter((x) => !jobs.has(x.id)).map((x) => ({ job_id: x.id, kind: 'publish', trigger: (x.trigger as JobView['trigger']) ?? 'manual', children: [], streams: 1, counts: { queued: 0, uploading: 0, done: 0, failed: 0, cancelled: 0 }, state: (x.interrupted ? 'failed' : x.state) as JobState, targets: [], approved_by: x.approved_by ?? '', started_at: x.started_at, finished_at: x.interrupted ? new Date().toISOString() : '', files_total: x.progress?.total ?? 0, files_done: x.progress?.done ?? 0, bytes_total: 0, bytes_done: 0, rate_bps: 0, current: x.label, skipped: 0, dest: '', links: [], slack: { state: 'skipped' }, summary: x.label, ...(x.interrupted ? { error: 'The process that was running this job stopped: it was interrupted' } : {}), origin: x.origin, ...(x.mcp_client ? { mcp_client: x.mcp_client } : {}), external: true }) as unknown as JobView)
/** `summary: true` is what the window polls every second: per job the file list (`files`, one entry per file with its sha256) and `results` (up to 1,000 more) are left out, with `sha256_count` and the counts kept, so a few big jobs are not 350 KB of JSON cloned and serialized each second. A job asked for by id, and every MCP call, is whole. */
const slim = (v: JobView): JobView => {
  const n = typeof v.sha256_count === 'number' ? v.sha256_count : ((v.files ?? []).filter((f) => f && f.sha256).length || undefined)
  const { results: _r, ...rest } = v
  return { ...rest, files: [], ...(n !== undefined ? { sha256_count: n } : {}) } as JobView
}
export function status(jobId?: string, opts: { summary?: boolean } = {}): { jobs: JobView[] } {
  void ensureLoaded()
  const all = [...[...jobs.values()].map((j) => j.view), ...externalViews(), ...finished]
  const summary = !!opts.summary && !jobId
  return { jobs: (jobId ? all.filter((v) => v.job_id === jobId) : all).map((v) => copy(summary ? slim(v) : v)).map((v) => { if ((v.state === 'failed' || v.state === 'done_with_warning') && v.error && !v.failure) v.failure = failures.explain(v.error, { stage: /slack/i.test(v.error) ? 'transfer' : 'transfer' }); for (const c of v.children) if (c.state === 'failed' && c.error && !(c as { failure?: unknown }).failure) (c as { failure?: failures.Explained }).failure = failures.explain(c.error, { stage: 'transfer' }); const { request, ...rest } = v; return { ...rest, retryable: !!request } }) }   // the request stays in the record; the page is told only whether a shot can be sent again
}
export function cancel(id: string): JobView {
  const [parent, idx] = id.includes(':') ? [id.slice(0, id.lastIndexOf(':')), Number(id.slice(id.lastIndexOf(':') + 1))] : [id, -1]
  const j = jobs.get(parent)
  if (!j) { const f = finished.find((v) => v.job_id === parent); if (f) return copy(f); const ext = externalViews().find((v) => v.job_id === parent) ?? (jobsregistry.knows(parent) ? status(parent).jobs[0] : undefined); if (ext) { void jobsregistry.requestCancel(parent).catch(() => undefined); return { ...ext, state: 'cancelled' as JobState } }; throw new CoreError(404, `No such publish job: ${id}`) }
  if (idx >= 0) {   // one shot: the others go on
    const g = j.groups[idx]; if (!g) throw new CoreError(404, `No such shot in ${parent}: ${id}`)
    if (g.child.state === 'queued' || g.child.state === 'uploading') { g.ac.abort(); g.child.state = 'cancelled' }
    return copy(j.view)
  }
  j.abort.abort(); return copy(j.view)
}
const retained = new Map<string, Job>()
/** Try one failed (or cancelled) shot again, alone: what is already in the bucket with the same size is not sent again. */
export async function retry(o: { child_id?: string } | string): Promise<{ job_id: string; child_id: string }> {
  const id = typeof o === 'string' ? o : String(o?.child_id ?? ''), i = id.lastIndexOf(':'), parent = id.slice(0, i), idx = Number(id.slice(i + 1))
  const job = retained.get(parent)
  if (!job && i >= 0) {   // the app was restarted since: the job is only a record, so the shot is sent again as a new job from the request it started with (what is already in the bucket with the same size is not sent again)
    const old = (await ensureLoaded(), finished).find((x) => x.job_id === parent), kid = old?.children?.[idx]
    if (!old || !kid) throw new CoreError(404, `No such publish shot: ${id}`)
    if (kid.state !== 'failed' && kid.state !== 'cancelled') throw bad('Only a failed or cancelled shot can be tried again')
    const req = old.request; if (!req) throw bad('This job was started by an older version of the app and cannot be tried again: publish the shot again from Outputs')
    const items = Array.isArray(req.items) ? req.items : [], want = String(kid.shot).toLowerCase(), mine = items.filter((it) => `${it.path} ${it.stem ?? ''}`.toLowerCase().includes(want))
    const r = await run({ ...req, items: mine.length ? mine : items }); return { job_id: r.job_id, child_id: `${r.job_id}:0` }
  }
  if (!job || i < 0) throw new CoreError(404, `No such publish shot: ${id}`)
  const g = job.groups[idx]; if (!g) throw new CoreError(404, `No such shot in ${parent}: ${id}`)
  if (g.child.state !== 'failed' && g.child.state !== 'cancelled') throw bad('Only a failed or cancelled shot can be tried again')
  const a = await s3Access(), there = await listDestination({ ...a, prefix: job.ret ? `${job.ret.prefix}${job.ret.round}/` : a.prefix })
  for (const it of g.items) if (it.skip === null && there.get(it.s3_key) === it.bytes) it.skip = 'same size already there'
  g.send = g.items.filter((it) => it.skip === null); g.child.files = g.send.length; g.child.bytes = g.send.reduce((x, it) => x + it.bytes, 0); g.child.skipped = g.items.filter((it) => it.skip === 'same size already there').length
  Object.assign(g.child, { state: 'queued', files_done: 0, bytes_done: 0, rate: 0, current: '' }); delete g.child.error; g.partial.clear(); g.doneBytes = 0; g.ac = new AbortController()
  const v = job.view; finished = finished.filter((x) => x.job_id !== parent); jobs.set(parent, job)
  job.abort = new AbortController(); job.abort.signal.addEventListener('abort', () => { for (const x of job.groups) x.ac.abort() }, { once: true })
  Object.assign(v, { state: 'uploading', finished_at: '', error: undefined, summary: '' }); v.counts = counts(v.children)
  const targets = v.targets
  job.done = (async () => {
    const src = g.send.some((it) => it.source === 'volume') ? await volumeAccess() : null
    if (src && !src.ok) throw new Error(`The volume cannot be read: ${redact(src.reason)}`)
    await runGroup(job, g, a, src, targets); progressOf(job); await finishParent(job, a, targets)
  })().catch((err) => { v.state = 'failed'; v.error = redact((err as Error).message) }).finally(() => end(job, true))
  return { job_id: parent, child_id: id }
}

export interface RunRequest extends PlanRequest { /** how many shots upload at once (default 1, at most sync_parallel) */ streams?: number; approved_by?: string; /** what started it (History: `trigger`), e.g. 'auto-publish' */ trigger?: string; /** a sentence for the History detail (who approved what) */ note?: string }
const itemShot = (it: PlanItem): string => it.shot ?? deliverShot(it.path) ?? shotOf(basename(it.path).replace(/(\.\d+)?\.[^.]*$/, ''), posix.dirname(it.path) === '.' ? '' : posix.dirname(it.path))
/** One child per shot (the files of a run grouped by the shot they belong to), each with its own progress and, for a per-shot Slack, its own links, previews and source. */
async function makeGroups(job: Job, real: PlanItem[], send: PlanItem[], e: Awaited<ReturnType<typeof effective>>, req: RunRequest): Promise<void> {
  const by = new Map<string, PlanItem[]>(); for (const it of real) { const k = itemShot(it); (by.get(k) ?? by.set(k, []).get(k)!).push(it) }
  const sendSet = new Set(send), v = job.view, base = deps.outputRoot() ?? '', pf = typeof req.preview_frame === 'boolean' ? req.preview_frame : e.slack.preview_frame
  const clipNames = layout.validateClipNames(req.clip_names)
  let n = 0
  for (const [shot, items] of by) {
    const gsend = items.filter((i) => sendSet.has(i)), id = `${v.job_id}:${n++}`
    const ki = layout.layoutKey({ prefix: e.s3.prefix, round: job.ret?.round ?? '-', path: items[0].path, clipNames, shotOf, deliverShot })
    const child: ChildView = { id, parent_id: v.job_id, shot, clip: ki.clip, state: 'queued', files: gsend.length, files_done: 0, bytes: gsend.reduce((x, i) => x + i.bytes, 0), bytes_done: 0, rate: 0, current: '', skipped: items.filter((i) => i.skip === 'same size already there').length, warnings: [], approved_by: v.approved_by, slack: { state: 'skipped' }, sha256: 0 }
    const g: Group = { child, items, send: gsend, ac: new AbortController(), info: { first: items.slice(0, SLACK_FILES).map((i) => ({ path: i.path, bytes: i.bytes, key: i.s3_key })), count: items.length, bytes: items.reduce((x, i) => x + i.bytes, 0), dest: job.info.dest }, partial: new Map(), doneBytes: 0, t0: deps.now() }
    if (job.perShot) {
      g.lp = linkPlanOf(items.map((i) => ({ path: i.path, s3_key: i.s3_key, bytes: i.bytes })), e.s3.prefix, e.slack)
      if (pf) { g.psrc = previewSources(items.filter((i) => i.source !== 'volume').map((i) => ({ path: i.path, abs: join(base, i.path), bytes: i.bytes }))) }
      if (e.slack.volume_source) g.folders = await sourceFolders(items.map((i) => ({ path: i.path, ...(i.source ? { source: i.source } : {}), ...(i.source_key ? { source_key: i.source_key } : {}), ...(i.source !== 'volume' && base ? { abs: join(base, i.path) } : {}) })))
    }
    job.groups.push(g); v.children.push(child)
  }
  job.abort.signal.addEventListener('abort', () => { for (const g of job.groups) g.ac.abort() }, { once: true })
  v.counts = counts(v.children)
}
export async function run(req: RunRequest): Promise<{ job_id: string }> {
  const who = (req?.approved_by ?? '').trim()
  if (!who) throw bad(NEEDS_NAME)
  const targets = targetsOf(req.targets)
  const p = await plan({ ...req, targets, approved_by: who })   // never trusts the page's plan
  if (p.refused.length) throw bad(`Cannot publish: ${p.refused.slice(0, 3).map((r) => `${r.path}: ${r.reason}`).join('; ')}${p.refused.length > 3 ? ` (and ${p.refused.length - 3} more)` : ''}`)
  if (p.blockers.length) throw bad(`Cannot publish: ${p.blockers.join('; ')}`)
  const e = await effective(), real = p.items.filter((i) => i.skip !== 'missing' && i.skip !== 'weights' && i.skip !== 'blocked')
  const send = targets.includes('s3') ? p.items.filter((i) => i.skip === null) : []
  const id = `publish-${deps.now().toString(36)}-${(seq++).toString(36)}`
  const info: MsgInfo = { first: real.slice(0, SLACK_FILES).map((i) => ({ path: i.path, bytes: i.bytes, key: i.s3_key })), count: real.length, bytes: p.total_bytes, dest: p.s3?.dest ?? `s3://${e.s3.bucket || '(not uploaded)'}/${e.s3.prefix}` }
  const view: JobView = { request: { ...req }, job_id: id, state: 'queued', targets, approved_by: who, started_at: iso(), finished_at: '', files_total: send.length, files_done: 0, bytes_total: send.reduce((a, i) => a + i.bytes, 0), bytes_done: 0, rate_bps: 0, current: '', skipped: p.items.filter((i) => i.skip === 'same size already there').length, dest: info.dest, links: [], slack: { state: 'skipped' }, summary: '', adapter: 'pc', pod_files: 0, pc_files: 0, files: [], kind: 'publish', trigger: /^auto-publish/.test(String(req.trigger ?? '')) ? 'auto-publish' : 'manual', children: [], streams: 1, counts: { queued: 0, uploading: 0, done: 0, failed: 0, cancelled: 0 }, ...(req.note ? { note: String(req.note).slice(0, 300) } : {}) }
  const job: Job = { groups: [], streams: 1, perShot: false, ...(req.trigger ? { trig: String(req.trigger).slice(0, 60) } : {}), hashes: new Map(), view, abort: new AbortController(), info, template: req.message?.trim() ? req.message : e.defaults.message, prefix: e.s3.prefix, started: deps.now(), done: Promise.resolve() }
  { const o = (p.sequences ?? []).flatMap((x) => (x.override ? [x.override] : [])); if (o.length) view.edl_overrides = o }
  job.streams = Math.max(1, Math.min(Math.floor(Number(req.streams) || 1), deps.parallel())); view.streams = job.streams; job.perShot = targets.includes('slack') && e.slack.per_shot
  if (p.round && targets.includes('s3')) job.ret = { seq: new Map((p.sequences ?? []).flatMap((x) => [[x.stem, x.notes], [x.clip, x.notes]] as [string, string[]][])), round: p.round, prefix: e.s3.prefix, items: p.items.filter((i) => i.skip !== 'missing' && i.skip !== 'weights' && i.skip !== 'blocked'), clipNames: layout.validateClipNames(req.clip_names) }
  if (targets.includes('slack')) {   // what the post adds to its text (decided now, from the plan: nothing is read again at post time)
    const base = deps.outputRoot() ?? '', local = real.filter((i) => i.source !== 'volume')
    if (typeof req.preview_frame === 'boolean' ? req.preview_frame : e.slack.preview_frame) { job.psrc = previewSources(local.map((i) => ({ path: i.path, abs: join(base, i.path), bytes: i.bytes }))); job.volOnly = !job.psrc.length && real.some((i) => i.source === 'volume') }
    if (e.slack.volume_source) job.folders = await sourceFolders(real.map((i) => ({ path: i.path, ...(i.source ? { source: i.source } : {}), ...(i.source_key ? { source_key: i.source_key } : {}), ...(i.source !== 'volume' && base ? { abs: join(base, i.path) } : {}) })))
  }
  job.lp = linkPlanOf(real.map((i) => ({ path: i.path, s3_key: i.s3_key, bytes: i.bytes })), e.s3.prefix, e.slack)
  await makeGroups(job, real, send, e, req)
  jobs.set(id, job)
  { const who = history.currentOrigin(), origin: jobsregistry.Origin = /^auto-publish/.test(String(req.trigger ?? '')) ? 'auto-publish' : who?.source === 'mcp' ? 'mcp' : 'window'
    view.origin = origin; if (origin === 'mcp' && who?.client) view.mcp_client = who.client
    job.stopTrack = jobsregistry.track({ id, kind: 'publish', trigger: view.trigger, origin, ...(view.mcp_client ? { client: view.mcp_client } : {}), label: `publish ${send.length} file${send.length === 1 ? '' : 's'} to ${targets.join(' + ')}`, approved_by: who2(view), started_at: view.started_at, view: () => ({ state: view.state, progress: { done: view.files_done, total: view.files_total, unit: 'files' } }), cancel: () => { try { cancel(id) } catch { /* over */ } } })
    if (origin === 'mcp') history.record({ kind: 'change', area: 'configuration', action: 'started by MCP', what: `publish ${send.length} file${send.length === 1 ? '' : 's'} to ${targets.join(' + ')}`, detail: `${view.mcp_client ? `client ${view.mcp_client}; ` : ''}approved by ${view.approved_by}; job ${id}` }) }
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

const progressOf = (job: Job): void => {
  const v = job.view, kids = job.groups
  if (!kids.length) return
  v.files_done = kids.reduce((n, g) => n + g.child.files_done, 0); v.bytes_done = kids.reduce((n, g) => n + g.child.bytes_done, 0)
  const s = (deps.now() - job.started) / 1000; v.rate_bps = s > 0 ? Math.round(v.bytes_done / s) : 0
  v.current = job.groups.find((g) => g.child.state === 'uploading')?.child.current ?? ''
}
/** Upload one shot's files: this PC's by `aws s3 cp` (with a sha256 made while the file is read) and the volume's streamed through this PC. Returns the first failure, or ''. */
async function uploadGroup(job: Job, g: Group, a: Awaited<ReturnType<typeof s3Access>>, src: VolAccess | null): Promise<string> {
  const c = g.child, ac = g.ac; let failure = '', next = 0, nextVol = 0
  const refresh = () => { c.bytes_done = [...g.partial.values()].reduce((x, y) => x + y, 0) + g.doneBytes; const s = (deps.now() - g.t0) / 1000; c.rate = s > 0 ? Math.round(c.bytes_done / s) : 0; progressOf(job) }
  const pcList = g.send.filter((i) => i.source !== 'volume'), volList = g.send.filter((i) => i.source === 'volume')
  const streamWorker = async () => {   // volume files: two piped aws commands, nothing is kept on this PC
    while (!failure && !ac.signal.aborted) {
      const it = volList[nextVol++]; if (!it) return
      c.current = basename(it.path)
      let r: { ok: boolean; error: string; sha256?: string }
      try {
        const route = await (job.route ??= chooseRoute(a, job.view, job.abort.signal))
        r = await volumeCopy(it, { a, s: src as Extract<VolAccess, { ok: true }>, route, v: job.view, signal: ac.signal, shot: g.child.shot, onBytes: (n) => { g.partial.set(it.path, Math.min(n, it.bytes)); refresh() } })
      } catch (e) { r = { ok: false, error: redact((e as Error).message) } }
      g.partial.delete(it.path)
      if (r.ok) { if (job.ret && r.sha256) { job.hashes.set(it.s3_key, r.sha256); c.sha256++ } g.doneBytes += it.bytes; c.files_done++; refresh() } else if (!ac.signal.aborted) failure = `${basename(it.path)}: ${r.error}`
    }
  }
  const worker = async () => {
    while (!failure && !ac.signal.aborted) {
      const it = pcList[next++]; if (!it) return
      c.current = basename(it.path)
      const hp = job.ret ? layout.hashFile(join(root(), it.path), ac.signal).catch(() => 'n/a') : null   // the hash is made while the file is read for the upload (a second reader, chunked)
      const r = await deps.aws(['s3', 'cp', join(root(), it.path), `s3://${a.bucket}/${it.s3_key}`, ...a.common], a.env, {
        signal: ac.signal, stallMs: STALL_MS,   // silence for this long means stalled: per progress line, never a total time
        onData: (d) => { const n = parseProgress(d); if (n !== null) { g.partial.set(it.path, Math.min(n, it.bytes)); refresh() } },
      })
      g.partial.delete(it.path); const sha = hp ? await hp : null
      if (r.code === 0) { if (sha) { job.hashes.set(it.s3_key, sha); c.sha256++ } g.doneBytes += it.bytes; c.files_done++; refresh() }
      else if (!ac.signal.aborted) failure = `${basename(it.path)}: ${awsText(r)}`
    }
  }
  await Promise.all([...Array.from({ length: pcList.length ? Math.max(1, Math.min(deps.parallel(), pcList.length)) : 0 }, worker), ...Array.from({ length: volList.length ? Math.max(1, Math.min(deps.parallel(), STREAM_MAX, volList.length)) : 0 }, streamWorker)])
  c.current = ''
  return failure
}
/** One shot, start to end: upload, then (the BKK return) its sha256s into the round's manifest, then its Slack message when there is one per shot. A failed shot adds nothing to the manifest. */
async function runGroup(job: Job, g: Group, a: Awaited<ReturnType<typeof s3Access>>, src: VolAccess | null, targets: Target[]): Promise<void> {
  const c = g.child
  if (job.abort.signal.aborted || g.ac.signal.aborted || c.state === 'cancelled') { c.state = 'cancelled'; return }
  c.state = 'uploading'; g.t0 = deps.now(); progressOf(job)
  try {
    const failure = g.send.length ? await uploadGroup(job, g, a, src) : ''
    if (g.ac.signal.aborted) { c.state = 'cancelled'; return }
    if (failure) { c.state = 'failed'; c.error = failure; return }
    if (job.ret) await finishReturn(job, g, a, g.ac.signal)
    if (g.ac.signal.aborted) { c.state = 'cancelled'; return }
    c.state = 'done'
    if (job.perShot && targets.includes('slack')) await postChildSlack(job, g, a)
  } catch (e) { if (g.ac.signal.aborted) c.state = 'cancelled'; else { c.state = 'failed'; c.error = redact((e as Error).message); if (job.ret && /RETURN-MANIFEST|manifest/i.test(c.error)) job.view.manifest = { updated: false, shots: job.view.manifest?.shots ?? 0, path: `${job.ret.prefix}${job.ret.round}/${layout.MANIFEST}`, error: c.error } } } finally { c.current = ''; progressOf(job) }
}
async function postChildSlack(job: Job, g: Group, a: Awaited<ReturnType<typeof s3Access>>): Promise<void> {
  const v = job.view, idx = job.groups.indexOf(g), sub: Job = { ...job, info: g.info, ...(g.lp ? { lp: g.lp } : {}), ...(g.psrc ? { psrc: g.psrc } : {}), ...(g.folders ? { folders: g.folders } : {}), tag: `-${idx}` }
  const lk = await makeLinks(sub, a, g.ac.signal); for (const l of lk.links) v.links.push(l)
  const date = iso().slice(0, 10), head = (t: string) => t.replace(TITLE, `${TITLE} · ${g.child.shot}`)
  const bare = head(renderMessage(job.template, { approved_by: v.approved_by, info: g.info, date })), full = head(renderMessage(job.template, { approved_by: v.approved_by, info: g.info, linkText: lk.linkText, folderText: lk.folderText, append: true, date }))
  const blocks = await slackExtras(sub, a, bare, g.ac.signal, lk.sections).catch(() => undefined)
  const r = await postSlack(full, blocks)
  g.child.slack = r.ok ? { state: 'sent' } : { state: 'failed', error: r.error }
}
async function pool<T>(list: T[], n: number, work: (x: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, list.length)) }, async () => { while (next < list.length) { const x = list[next++]; await work(x) } }))
}

async function go(job: Job, send: PlanItem[], targets: Target[], nothing: boolean): Promise<void> {
  const v = job.view, ac = job.abort
  void nothing
  const a = targets.includes('s3') ? await s3Access() : null
  const kids = job.groups.map((g) => g.child)
  if (a) {
    v.state = 'uploading'
    const volList = send.filter((i) => i.source === 'volume'), src = volList.length ? await volumeAccess() : null
    if (src && !src.ok) throw new Error(`The volume cannot be read: ${redact(src.reason)}`)
    await pool(job.groups, job.streams, (g) => runGroup(job, g, a, src, targets))
    settleAdapter(v)
  } else for (const k of kids) k.state = 'done'
  progressOf(job)
  return finishParent(job, a, targets)
}
/** After the children: the parent's state, its own Slack message (one per run, when there is not one per shot) and its summary. */
async function finishParent(job: Job, a: Awaited<ReturnType<typeof s3Access>> | null, targets: Target[]): Promise<void> {
  const v = job.view, ac = job.abort, kids = job.groups.map((g) => g.child)
  v.current = ''; v.counts = counts(kids)
  if (ac.signal.aborted) { v.state = 'cancelled'; v.summary = `Cancelled after ${v.files_done} of ${v.files_total} files`; return }
  const failed = kids.filter((k) => k.state === 'failed'), cancelled = kids.filter((k) => k.state === 'cancelled'), done = kids.filter((k) => k.state === 'done')
  if (failed.length) { v.state = 'failed'; v.error = failed[0].error; v.summary = `${done.length} of ${kids.length} shot${kids.length === 1 ? '' : 's'} uploaded (${v.files_done} of ${v.files_total} files); ${failed.map((k) => k.shot).join(', ')} failed. Nothing more was posted to Slack${job.perShot ? ' for the failed shot' : ''}.`; return }
  if (kids.length && cancelled.length === kids.length) { v.state = 'cancelled'; v.summary = 'Every shot was cancelled'; return }
  if (job.perShot && targets.includes('slack')) { const bad = kids.find((k) => k.slack.state === 'failed'); v.slack = bad ? { state: 'failed', ...(bad.slack.error ? { error: bad.slack.error } : {}) } : done.every((k) => k.slack.state === 'sent') && done.length ? { state: 'sent' } : { state: 'skipped' } }
  else if (!cancelled.length) {
    const lk = await makeLinks(job, a, ac.signal)
    for (const l of lk.links) v.links.push(l)
    if (targets.includes('slack')) {
      v.state = 'posting'
      const date = iso().slice(0, 10), bare = job.slackText ?? renderMessage(job.template, { approved_by: v.approved_by, info: job.info, date })
      const full = job.slackText ? [job.slackText, lk.folderText, lk.linkText].filter(Boolean).join('\n') : renderMessage(job.template, { approved_by: v.approved_by, info: job.info, linkText: lk.linkText, folderText: lk.folderText, append: true, date })
      const blocks = await slackExtras(job, a, bare, ac.signal, lk.sections).catch(() => undefined)
      const r = await postSlack(full, blocks)
      v.slack = r.ok ? { state: 'sent' } : { state: 'failed', error: r.error }
    }
  }
  const up = a ? `${v.files_done} file${v.files_done === 1 ? '' : 's'} uploaded${v.skipped ? `, ${v.skipped} already there` : ''} (${fmtSize(v.bytes_done)}) to ${v.dest}${kids.length > 1 ? ` in ${kids.length} shots` : ''}${cancelled.length ? `; ${cancelled.length} shot${cancelled.length === 1 ? '' : 's'} cancelled` : ''}` : ''
  if (v.slack.state === 'failed') { v.state = a ? 'done_with_warning' : 'failed'; v.error = v.slack.error; v.summary = `${up}${up ? '. ' : ''}${a ? 'The files are up, but the Slack message failed: ' : 'The Slack message failed: '}${v.slack.error}. It can be sent again.` }
  else { v.state = cancelled.length ? 'done_with_warning' : 'done'; v.summary = `${up}${up && v.slack.state === 'sent' ? '; ' : ''}${v.slack.state === 'sent' ? 'posted to Slack' : ''}` }
}

// ----- the BKK return: sha256 of every file, RETURN-MANIFEST.json (bh-return-1) merged into the round, and the round's inventory -----
async function readHeadBytes(path: string, n = 2048): Promise<Uint8Array | null> {
  try { const { open } = await import('node:fs/promises'); const fh = await open(path, 'r'); try { const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, 0); return new Uint8Array(b.subarray(0, bytesRead)) } finally { await fh.close() } } catch { return null }
}
/** What the manifest says about one published file: for a DPX frame the header's size and bit depth and the frame rate from the clip name, for a movie its sidecar. Never invented: a field that is not known is left out. */
async function mediaOf(it: PlanItem, ki: layout.KeyInfo, base: string | null, count: Map<string, number>, headers: Map<string, Awaited<ReturnType<typeof readHeadBytes>>>, R: typeof import('./renders.js')): Promise<layout.MediaInfo | undefined> {
  if (ki.role === 'dpx') {
    if (it.source === 'volume' || !base) return { codec: 'dpx', frames: count.get(ki.clip) ?? 1, fps: R.rationalFps(R.fpsOf(ki.stem)) }
    const hk = `${ki.clip}`; if (!headers.has(hk)) headers.set(hk, await readHeadBytes(join(base, it.path)))
    const h = headers.get(hk) ? R.parseDpxInfo(headers.get(hk)!) : null
    return { codec: 'dpx', frames: count.get(ki.clip) ?? 1, fps: R.rationalFps(R.fpsOf(ki.stem)), ...(h ? { width: h.width, height: h.height, bit_depth: h.bits } : {}) }
  }
  if (ki.role === 'proxy-h264' || ki.role === 'review') {
    const meta = base && it.source !== 'volume' ? await readJson<Record<string, unknown>>(join(base, `${it.path}.meta.json`), {}) : {}
    const num = (k: string) => (typeof meta[k] === 'number' ? (meta[k] as number) : undefined)
    const fps = typeof meta.fps === 'number' ? R.rationalFps(String(meta.fps)) : R.rationalFps(R.fpsOf(ki.stem)), outs = Array.isArray(meta.outputs) ? (meta.outputs as { codec?: string }[]) : []
    return { ...(num('width') ? { width: num('width') } : {}), ...(num('height') ? { height: num('height') } : {}), fps, ...(num('frames') !== undefined ? { frames: num('frames') } : {}), codec: outs[0]?.codec === 'prores422hq' || /\.mov$/i.test(it.path) ? 'prores422hq' : 'h264', bit_depth: /\.mov$/i.test(it.path) ? 10 : 8, working_space: meta.preset === 'tunnel' ? (meta.colour_block ? (meta.colour_block as { working_space: string }).working_space : 'Rec.709 tagged') : 'n/a', ...(meta.colour_block ? { colour: meta.colour_block as { working_space: string; transfer: string; proxy: string } } : {}), ...(Array.isArray(meta.manifest_notes) ? { notes: (meta.manifest_notes as unknown[]).map(String) } : {}) }
  }
  return undefined
}
async function readText(a: Awaited<ReturnType<typeof s3Access>>, key: string, signal: AbortSignal): Promise<string | null> {
  const r = await deps.aws(['s3', 'cp', `s3://${a.bucket}/${key}`, '-', ...a.common], a.env, { signal, stallMs: 60_000 })
  if (r.code === 0) return r.stdout
  if (/404|NoSuchKey|Not Found|does not exist/i.test(`${r.stderr}${r.stdout}`)) return null
  throw new CoreError(502, `The round's ${basename(key)} could not be read: ${awsText(r)}`)
}
async function putText(a: Awaited<ReturnType<typeof s3Access>>, key: string, text: string, signal: AbortSignal): Promise<void> {
  const r = await streamCopy({ args: [], env: {} }, { args: ['s3', 'cp', '-', `s3://${a.bucket}/${key}`, '--expected-size', String(Buffer.byteLength(text)), ...a.common], env: a.env }, { signal, stallMs: 60_000, stdin: text })
  if (!r.ok) throw new CoreError(502, `${basename(key)} could not be uploaded: ${r.error}`)
}
const retLocks = new Map<string, Promise<unknown>>()
/** One writer at a time per round: children of any run that publish into the same round never overwrite each other's items (read, merge, write inside the lock). */
function withRetLock<T>(key: string, fn: () => Promise<T>): Promise<T> { const prev = retLocks.get(key) ?? Promise.resolve(), run = prev.then(fn, fn); retLocks.set(key, run.catch(() => undefined)); return run }
/** After one shot's files are up: sha256 for each, its items merged into the round's RETURN-MANIFEST.json, and the round's inventory rewritten. A manifest already there that cannot be read is a 409. */
async function finishReturn(job: Job, g: Group, a: Awaited<ReturnType<typeof s3Access>>, signal: AbortSignal): Promise<void> {
  const ret = job.ret!, v = job.view, base = deps.outputRoot(), R = await import('./renders.js'), root = `${ret.prefix}${ret.round}/`, items = g.items
  g.child.current = layout.MANIFEST
  const kis = items.map((it) => layout.layoutKey({ prefix: ret.prefix, round: ret.round, path: it.path, clipNames: ret.clipNames, shotOf, deliverShot }))
  const count = new Map<string, number>(); for (const ki of kis) if (ki.role === 'dpx') count.set(ki.clip, (count.get(ki.clip) ?? 0) + 1)
  const headers = new Map<string, Awaited<ReturnType<typeof readHeadBytes>>>(), files: layout.ManifestFile[] = []
  for (const [i, it] of items.entries()) {
    const ki = kis[i]; let sha = job.hashes.get(it.s3_key)
    if (!sha) sha = it.source !== 'volume' && base ? await layout.hashFile(join(base, it.path), signal).catch(() => 'n/a') : 'n/a'   // already there with the same size: hashed here when the file is on this PC
    if (sha !== 'n/a') g.child.sha256 = Math.max(g.child.sha256, 0) + (job.hashes.has(it.s3_key) ? 0 : 1)
    const media = await mediaOf(it, ki, base, count, headers, R)
    const seqNotes = ret.seq.get(ki.stem) ?? ret.seq.get(ki.clip)
    files.push({ ...(seqNotes?.length && ki.role === 'dpx' ? { notes: seqNotes } : {}), key: it.s3_key, shot: ki.shot, clip: ki.clip, stem: ki.stem, role: ki.role, sha256: sha, bytes: it.bytes, ...(media ? { media } : {}), ...(ki.renamed_from ? { renamed_from: ki.renamed_from } : {}) })
    if (i % 100 === 99) await yieldLoop()
  }
  const built = layout.buildItems(files, root), pod = (await deps.podInfo(items.map((i) => i.path)).catch(() => null)) ?? layout.NO_POD
  const manifestKey = `${root}${layout.MANIFEST}`, shots = new Set(files.map((f) => f.shot)), date = iso().slice(0, 10), csvKey = `${root}_inventory_${date}.csv`, head = 'shot,name,role,frames,bytes,sha256'
  const cell = (x: string | number) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x))
  const rows = files.filter((f) => f.role !== 'sidecar').map((f) => [f.shot, basename(f.key), f.role, f.media?.frames ?? '', f.bytes, f.sha256].map((x) => cell(x as string | number)).join(','))
  await withRetLock(`${a.bucket}/${root}`, async () => {
    const existing = await readText(a, manifestKey, signal)
    const merged = layout.mergeManifest(existing, { round: ret.round, returned_by: v.approved_by, now: deps.now(), pod, items: built })
    const old = (await readText(a, csvKey, signal).catch(() => null)) ?? '', kept = old.split('\n').slice(1).filter((l) => l.trim() && !shots.has(l.split(',')[0]))
    await putText(a, manifestKey, `${JSON.stringify(merged, null, 2)}\n`, signal)
    await putText(a, csvKey, `${[head, ...kept, ...rows].join('\n')}\n`, signal)
  })
  v.manifest = { updated: true, shots: (v.manifest?.shots ?? 0) + 1, path: manifestKey }; g.child.current = ''
  v.sha256_count = (v.sha256_count ?? 0) + files.filter((f) => f.sha256 !== 'n/a').length
  v.results = [...(v.results ?? []), ...files.map((f) => ({ path: f.key, bytes: f.bytes, sha256: f.sha256 }))].slice(0, 1000)
}
/** The rounds already in the destination (a one-level listing of the prefix), newest name first, for the window's suggestions. */
export async function rounds(): Promise<{ rounds: { name: string; modified?: string }[] }> {
  const e = await effective(), p = s3Problem(e.s3); if (p) throw bad(`S3 is not configured: ${p}`)
  const a = await s3Access(), ls = await deps.aws(['s3', 'ls', `s3://${a.bucket}/${a.prefix}`, ...a.common], a.env, { stallMs: 30_000 })
  if (ls.code !== 0 && !(ls.code === 1 && !ls.stdout.trim() && !ls.stderr.trim())) throw new CoreError(502, awsText(ls))
  const names = ls.stdout.split('\n').map((l) => /^\s*PRE (.+)\/$/.exec(l)?.[1]).filter((x): x is string => !!x && layout.ROUND_RE.test(x))
  return { rounds: names.sort((x, y) => y.localeCompare(x)).slice(0, 200).map((name) => ({ name })) }
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
  const job: Job = { groups: [], streams: 1, perShot: false, hashes: new Map(), ...(f.slackText ? { slackText: f.slackText } : {}), view: v, abort: new AbortController(), info, template: f.template ?? (await effective()).defaults.message, started: deps.now(), done: Promise.resolve() }
  { const e2 = await effective(); job.prefix = e2.s3.prefix; job.lp = linkPlanOf(info.first.map((x) => ({ path: x.path, s3_key: x.key, bytes: x.bytes })), e2.s3.prefix, e2.slack) }
  finished = finished.filter((x) => x.job_id !== f.job_id)
  jobs.set(v.job_id, job)
  const targets = f.targets.includes('s3') ? f.targets : f.targets
  job.done = go(job, [], targets, false).catch((err) => { v.state = 'failed'; v.error = redact((err as Error).message) }).finally(() => end(job, true))
  return { job_id: v.job_id }
}

function end(job: Job, again = false): void {
  const v = job.view; v.finished_at = iso(); job.stopTrack?.()
  jobs.delete(v.job_id); if (job.groups.length) { retained.set(v.job_id, job); while (retained.size > KEEP_JOBS) retained.delete(retained.keys().next().value as string) }
  finished.unshift({ ...copy(v), info: job.info, template: job.template, ...(job.slackText ? { slackText: job.slackText } : {}) }); finished.length = Math.min(finished.length, KEEP_JOBS)
  history.record({ kind: 'job', job: 'publish', state: v.state === 'cancelled' ? 'cancelled' : v.state === 'failed' ? 'failed' : 'done', started_at: v.started_at, what: `${again ? 'publish message again' : 'publish'} ${v.files_total} file${v.files_total === 1 ? '' : 's'} to ${v.targets.join(' + ')}`, files: v.files_done, bytes: v.bytes_done,
    detail: `${v.note ? `${v.note}; ` : ''}${v.dest}; ${v.summary}${v.pod_files + v.pc_files ? `; ${v.pod_files ? `${v.pod_files} via pod ${v.pod ?? ''}`.trim() : ''}${v.pod_files && v.pc_files ? ', ' : ''}${v.pc_files ? `${v.pc_files} via this PC` : ''}` : ''}`.slice(0, 600), approved_by: v.approved_by, ...(job.trig ? { trigger: job.trig } : {}), ...(v.error ? { error: redact(v.error) } : {}) })
  persist()
}

/** Forget everything in memory (tests). */
export function reset(): void { retained.clear(); retLocks.clear(); sizeCache.clear(); sizeRuns.clear(); scans.clear(); scanSeq = 0; jobs.clear(); finished = []; loaded = null; seq = 0; writing = Promise.resolve(); setDeps(null) }

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
export interface BackfillRequest { /** the BKK return round the rows publish into */ round?: string; clip_names?: Record<string, string>; preview_frame?: boolean; job_id?: string; rows?: string[]; all?: boolean; targets?: unknown; destination_prefix?: string; message?: string; approved_by?: string }
export interface BackfillItem extends PlanItem { row: string; shot: string; from: 'pc' | 'volume'; source_key?: string; local_path?: string }
export interface BackfillPlan extends Omit<Plan, 'items'> { prefix: string; items: BackfillItem[]; bucket: string; dest: string; inventory_key: string; excluded_weights: number }
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
  let roundName: string | null = null
  if (e.s3.layout === 'bkk-return' && targets.includes('s3') && !sp) {   // the rows publish into the round, in the BKK layout (the clip names apply too)
    roundName = layout.validateRound(req.round); const cn = layout.validateClipNames(req.clip_names)
    for (const it of items) { const ki = layout.layoutKey({ prefix, round: roundName, path: it.path, clipNames: cn, shotOf, deliverShot }); it.s3_key = ki.key; if (ki.renamed_from) it.renamed_from = ki.renamed_from }
  }
  const date = new Date(deps.now()).toISOString().slice(0, 10), inventory_key = `${prefix}${roundName ? `${roundName}/` : ''}_inventory_${date}.csv`
  if (targets.includes('s3') && !sp && !blockers.length) {
    try {
      const a = await s3Access(), there = await listDestination({ ...a, prefix: roundName ? `${prefix}${roundName}/` : prefix })
      for (const it of items) if (there.get(it.s3_key) === it.bytes) it.skip = 'same size already there'
    } catch (err) { blockers.push(`Could not read the destination: ${redact((err as Error).message)}`) }
  }
  const send = items.filter((i) => i.skip === null), total_bytes = items.reduce((a, i) => a + i.bytes, 0), dest = `s3://${e.s3.bucket || '(bucket not confirmed)'}/${prefix}`
  const shots = new Map<string, { files: number; bytes: number }>()
  for (const i of send) { const s = shots.get(i.shot) ?? { files: 0, bytes: 0 }; s.files++; s.bytes += i.bytes; shots.set(i.shot, s) }
  const to = `${e.slack.workspace_name || 'Slack'}: ${e.slack.channel || "(the webhook's own channel)"}`
  const bpf = typeof req.preview_frame === 'boolean' ? req.preview_frame : e.slack.preview_frame, vfolders = new Set<string>(); for (const r of rows) for (const f of r.files) if (f.volume?.key) vfolders.add(`${posix.dirname(f.volume.key)}/`)
  const blp = linkPlanOf(items.filter((i) => i.skip !== 'weights').map((i) => ({ path: i.path, s3_key: i.s3_key, bytes: i.bytes })), prefix, e.slack)
  const blinks = { folder: blp.folder_link && !e.s3.endpoint && blp.folders.length > 0, files: blp.file_links ? Math.min(blp.count, blp.files.length) : 0, expires_at: blp.file_links && blp.files.length ? new Date(deps.now() + e.s3.presign_hours * 3600_000).toISOString() : null }
  const sp2 = await slackPlan({ targets, pf: bpf, vs: e.slack.volume_source, local: items.filter((i) => i.from === 'pc' && i.local_path).map((i) => ({ path: i.path, abs: i.local_path!, bytes: i.bytes })), hasVolume: items.some((i) => i.from === 'volume'), folders: e.slack.volume_source ? [...vfolders] : [] })
  return {
    ok: !blockers.length && !refused.length, blockers, items, total_bytes, files: items.length, refused, excluded_weights: excluded, streamed_files: send.filter((i) => i.from === 'volume').length, streamed_bytes: send.filter((i) => i.from === 'volume').reduce((x, i) => x + i.bytes, 0), bucket: e.s3.bucket, dest, inventory_key,
    s3: targets.includes('s3') ? { dest, count: send.length, new_bytes: send.reduce((a, i) => a + i.bytes, 0) } : null,
    layout: e.s3.layout, round: roundName, previews: sp2.psrc.map((x) => ({ name: `${x.clip}_preview.jpg`, s3_key: `${prefix}${x.shot}/${x.clip}_preview.jpg` })), prefix, warnings: sp2.problem ? [sp2.problem] : [],
    slack: targets.includes('slack') ? { channel: e.slack.channel, to, preview_frames: sp2.psrc.length, preview_problem: sp2.problem, volume_source: sp2.volume_source, links: blinks, preview: `To ${to}\n\n${backfillText({ approved_by: req.approved_by?.trim() || '(the approver you name)', shots, files: send.length, bytes: send.reduce((a, i) => a + i.bytes, 0), dest, uploadedNote: 'will be' })}${[...(blinks.folder || blinks.files ? [`With ${blinks.folder ? `a link to the destination folder${blinks.files ? ' and ' : ''}` : ''}${blinks.files ? `links to the first ${blinks.files} files, expiring ${blinks.expires_at!.slice(0, 10)}` : ''}`] : []), ...sp2.lines].map((l) => `\n${l}`).join('')}` } : null,
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
async function volumeCopy(it: { path: string; s3_key: string; bytes: number; source_key?: string }, c: { a: DestAccess; s: SrcOk; route: Route; v: JobView; signal: AbortSignal; shot?: string; onBytes: (n: number) => void }): Promise<{ ok: boolean; error: string; sha256?: string }> {
  const rec = (adapter: 'pod' | 'pc', sha256?: string) => { if (adapter === 'pod') c.v.pod_files++; else c.v.pc_files++; if (c.v.files.length < FILE_CAP) c.v.files.push({ path: it.path, adapter, ...(sha256 ? { sha256 } : {}), ...(c.shot ? { shot: c.shot } : {}) }) }
  if (c.route.pod && it.bytes <= PUT_MAX_BYTES) {
    const r = await podPut(c.route.pod, it, c.a, c.signal)
    if (r.ok) { c.onBytes(it.bytes); rec('pod', r.sha256); return { ok: true, error: '', ...(r.sha256 ? { sha256: r.sha256 } : {}) } }
    if (c.signal.aborted) return { ok: false, error: 'cancelled' }
    if (c.route.mode === 'pod') return { ok: false, error: `via pod ${c.route.pod.name}: ${r.error}` }
  } else if (c.route.pod && c.route.mode === 'pod') return { ok: false, error: 'larger than 5 GiB, which one signed upload cannot carry; set Transfer to Auto or This PC' }
  const hasher = createHash('sha256')
  const r = await streamCopy({ args: ['s3', 'cp', `s3://${c.s.bucket}/${it.source_key}`, '-', '--endpoint-url', c.s.endpoint, '--region', c.s.region], env: { AWS_ACCESS_KEY_ID: c.s.id, AWS_SECRET_ACCESS_KEY: c.s.secret } },
    { args: ['s3', 'cp', '-', `s3://${c.a.bucket}/${it.s3_key}`, '--expected-size', String(it.bytes), ...c.a.common], env: c.a.env },
    { signal: c.signal, stallMs: STALL_MS, onBytes: c.onBytes, onChunk: (b) => { hasher.update(b) } })
  const sha256 = r.ok ? hasher.digest('hex') : undefined
  if (r.ok) rec('pc', sha256)
  return { ...r, ...(sha256 ? { sha256 } : {}) }
}

/** Run one streamed copy: `aws s3 cp s3://src/key -` piped into `aws s3 cp - s3://dest/key --expected-size N`. No temp file, nothing buffered: the pipe moves it chunk by chunk. A stall timer per file, not a total. */
export function streamCopy(a: { args: string[]; env: Record<string, string> }, b: { args: string[]; env: Record<string, string> }, o: { signal?: AbortSignal; stallMs: number; onBytes?: (n: number) => void; /** each chunk of the download as it passes (the sha256 is made here, in the stream) */ onChunk?: (b: Buffer) => void; stdin?: string }): Promise<{ ok: boolean; error: string }> {
  return new Promise((resolve) => {
    const src = o.stdin === undefined ? deps.spawn('aws', a.args, a.env) : null, dst = deps.spawn('aws', b.args, b.env)
    let sent = 0, stalled = false, finished = false, timer: NodeJS.Timeout | null = null, err = ''
    const codes: (number | null | undefined)[] = []
    const kill = () => { for (const c of [src, dst]) { try { c?.kill('SIGKILL') } catch { /* gone */ } } }
    const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { stalled = true; kill() }, o.stallMs) }
    const done = (ok: boolean, error: string) => { if (finished) return; finished = true; if (timer) clearTimeout(timer); o.signal?.removeEventListener('abort', kill); resolve({ ok, error }) }
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
      src.stdout?.on('data', (d: Buffer) => { sent += d.length; arm(); o.onChunk?.(d); o.onBytes?.(sent) })
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
  const view: JobView = { job_id: id, state: 'queued', targets, approved_by: who, started_at: iso(), finished_at: '', files_total: send.length, files_done: 0, bytes_total: send.reduce((a, i) => a + i.bytes, 0), bytes_done: 0, rate_bps: 0, current: '', skipped: p.items.filter((i) => i.skip === 'same size already there').length, dest: p.dest, links: [], slack: { state: 'skipped' }, summary: '', adapter: 'pc', pod_files: 0, pc_files: 0, files: [], kind: 'publish', trigger: 'backfill', children: [], streams: 1, counts: { queued: 0, uploading: 0, done: 0, failed: 0, cancelled: 0 } }
  const job: Job = { groups: [], streams: 1, perShot: false, trig: 'backfill', hashes: new Map(), view, abort: new AbortController(), info, template: '', prefix: p.prefix, started: deps.now(), done: Promise.resolve() }
  { const by = new Map<string, BackfillItem[]>(); for (const it of p.items) (by.get(it.shot) ?? by.set(it.shot, []).get(it.shot)!).push(it)
    let n = 0; for (const [shot, its] of by) { const gs = its.filter((i) => i.skip === null); view.children.push({ id: `${id}:${n++}`, parent_id: id, shot, clip: shot, state: 'queued', files: gs.length, files_done: 0, bytes: gs.reduce((x, i) => x + i.bytes, 0), bytes_done: 0, rate: 0, current: '', skipped: its.length - gs.length, warnings: [], approved_by: who, slack: { state: 'skipped' }, sha256: 0 }) }
    view.counts = counts(view.children) }
  if (targets.includes('slack')) {
    if (typeof req.preview_frame === 'boolean' ? req.preview_frame : e.slack.preview_frame) { job.psrc = previewSources(p.items.filter((i) => i.from === 'pc' && i.local_path).map((i) => ({ path: i.path, abs: i.local_path!, bytes: i.bytes }))); job.volOnly = !job.psrc.length && p.items.some((i) => i.from === 'volume') }
    if (e.slack.volume_source) { const fs = new Set<string>(); for (const r of rows) for (const f of r.files) if (f.volume?.key) fs.add(`${posix.dirname(f.volume.key)}/`); job.folders = [...fs] }
  }
  job.lp = linkPlanOf(p.items.filter((i) => i.skip !== 'weights').map((i) => ({ path: i.path, s3_key: i.s3_key, bytes: i.bytes })), p.prefix, e.slack)
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
      const kid = v.children.find((c) => c.shot === it.shot); if (kid) { if (ok) { kid.files_done++; kid.bytes_done += it.bytes; kid.state = 'uploading' } else if (!ac.signal.aborted) { kid.state = 'failed'; kid.error = `${basename(it.path)}: ${why}` } }
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
    v.current = ''; settleAdapter(v); for (const k of v.children) if (k.state !== 'failed') k.state = ac.signal.aborted ? 'cancelled' : 'done'; v.counts = counts(v.children)
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
    const lk = await makeLinks(job, a, ac.signal); for (const l of lk.links) v.links.push(l)
    const blocks = await slackExtras(job, a, job.slackText, ac.signal, lk.sections).catch(() => undefined)
    const r = await postSlack([job.slackText, lk.folderText, lk.linkText].filter(Boolean).join('\n'), blocks)
    v.slack = r.ok ? { state: 'sent' } : { state: 'failed', error: r.error }
  }
  const up = a ? `${v.files_done} file${v.files_done === 1 ? '' : 's'} uploaded${v.skipped ? `, ${v.skipped} already there` : ''} (${fmtSize(v.bytes_done)}) to ${v.dest}` : ''
  if (v.slack.state === 'failed') { v.state = a ? 'done_with_warning' : 'failed'; v.error = v.slack.error; v.summary = `${up}. The files are up, but the Slack message failed: ${v.slack.error}. It can be sent again.` }
  else { v.state = 'done'; v.summary = `${up}${v.slack.state === 'sent' ? '; posted to Slack' : ''}` }
}

export const resetBackfill = (): void => { scans.clear(); scanSeq = 0 }

/** The local ComfyUI-Shared output/ folder (or null), for modules that read what is to be published. */
export const localOutputRoot = (): string | null => deps.outputRoot()
/** Post one line to the connected Slack channel (the same webhook, timeout and redaction as a publish). Never throws. */
export async function notifySlack(text: string): Promise<{ ok: boolean; error?: string }> {
  const r = await postSlack(text); return r.ok ? { ok: true } : { ok: false, error: r.error }
}

// ----- dry run: the whole pipeline except the writes (docs/ADR-050) -----
export interface DryRunPlan {
  bucket: string; prefix: string; round: string | null
  files: { key: string; bytes: number; action: 'upload' | 'skip same size' }[]
  /** where the RETURN-MANIFEST.json and the round's inventory would be written (nothing is written in a dry run) */ manifest_key: string | null; inventory_key: string | null
  total_bytes: number; total_files: number
  access: { ok: boolean; checked_at: string; detail: string }
  /** the sequences the EDL judged (flags), and the notes the manifest would carry */ sequences?: PubSeq[]
}
/** Can the destination prefix be LISTED with the configured credentials? Writes nothing. Write access cannot be proven without writing, and says so. */
export async function dryAccess(): Promise<DryRunPlan['access']> {
  const at = new Date(deps.now()).toISOString()
  try {
    const a = await s3Access(), r = await deps.aws(['s3api', 'list-objects-v2', '--bucket', a.bucket, '--prefix', a.prefix, '--max-items', '1', ...a.common], a.env, { stallMs: 30_000 })
    const note = 'write access is not proven in a dry run (nothing is written)'
    return r.code === 0 ? { ok: true, checked_at: at, detail: `can list s3://${a.bucket}/${a.prefix}: yes; ${note}` } : { ok: false, checked_at: at, detail: `cannot list s3://${a.bucket}/${a.prefix}: ${awsText(r)}; ${note}` }
  } catch (e) { return { ok: false, checked_at: at, detail: `the destination could not be checked: ${redact((e as Error).message).slice(0, 200)}` } }
}
/** The plan of a live upload with its exact keys, the manifest and inventory keys, and the access check: for a dry-run entry. Nothing is uploaded or created. */
export async function dryRun(req: PlanRequest): Promise<DryRunPlan> {
  const p = await plan({ ...req, targets: ['s3'] }), e = await effective(), real = p.items.filter((i) => i.skip !== 'missing' && i.skip !== 'weights' && i.skip !== 'blocked')
  const root = p.round ? `${e.s3.prefix}${p.round}/` : null, date = new Date(deps.now()).toISOString().slice(0, 10)
  const files = real.map((i) => ({ key: i.s3_key, bytes: i.bytes, action: (i.skip === 'same size already there' ? 'skip same size' : 'upload') as 'upload' | 'skip same size' }))
  return { bucket: e.s3.bucket, prefix: e.s3.prefix, round: p.round, files, manifest_key: root ? `${root}${layout.MANIFEST}` : null, inventory_key: root ? `${root}_inventory_${date}.csv` : null, total_bytes: real.reduce((a, i) => a + i.bytes, 0), total_files: real.length, access: await dryAccess(), ...(p.sequences ? { sequences: p.sequences } : {}) }
}
