/**
 * Export and import of the Default Configuration as one JSON file (docs/ADR-023).
 *
 * The file is DATA: parsed, checked, previewed per section and only then written, through the same `mounts.put` the panel's Save uses (normalize,
 * validate, save). By default (Lucas, 2026-11-03: "export adds tokens", "import reads") it also carries the keys and tokens (a `secrets` block: the RunPod,
 * S3, exchange-bucket, console and Anthropic keys and the git accounts' tokens, and the environment variables named like secrets), so one file sets up a whole
 * new computer; the export can leave them out. Nothing secret is ever shown: a plan masks every value to its last four characters, and no error, warning or
 * log line carries one. Not exported at all: the no-spend switch (`dry_run`), per-pod configurations, adapters and the attached repositories.
 * Before an import writes anything the current configuration AND its secrets are copied to <config dir>/backups (dir 0700, files 0600), newest ten kept,
 * and `undoImport` puts them back.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bad } from './errors.js'
import * as git from './git.js'
import * as history from './history.js'
import * as mounts from './mounts.js'
import { APP_DIR, backupsDir, configDir } from './paths.js'
import * as settings from './settings.js'

export const FORMAT = 'runpod-pod-manager-config'
export const VERSION = 1
export const MAX_BYTES = 2 * 1024 * 1024   // a configuration is a few KB; refuse anything near this as "not a configuration"
export const KEEP_BACKUPS = 10

export type SectionKey = 'volume' | 'image' | 'env' | 'pod_defaults' | 'mcp' | 'mcp_connections' | 'repositories' | 'wanted_models' | 'folders' | 'panama' | 'publish' | 'governance' | 'secrets'
interface SectionDef { label: string; fields: (keyof mounts.MountsConfig)[]; machine?: boolean; account?: boolean }
export const SECTIONS: Record<SectionKey, SectionDef> = {
  volume: { label: 'Volume and datacenter', fields: ['network_volume_id', 'mount_path', 'data_center_id', 'shared_volume_id'], account: true },
  image: { label: 'Image and registry login', fields: ['image', 'registry_auth_id'], account: true },
  env: { label: 'Environment', fields: ['env'] },
  pod_defaults: { label: 'Pod defaults', fields: ['idle_stop_minutes', 'models', 'sync_parallel', 'sync_shared', 'pull_shared', 'auto_sync', 'auto_publish', 'outputs', 'edl', 'delivery_prepare', 'render', 'sync_exclude', 'sync_exclude_delete', 'folder_excludes', 'apply_by_default', 'pull_any_card', 'default_gpu', 'default_cards', 'auto_cards', 'import_max_pods', 'import_cost_cap_usd', 'import_cap_enabled', 'required', 'links'] },
  mcp: { label: 'MCP servers', fields: ['mcp_http'] },
  mcp_connections: { label: 'MCP connections (the console this app uses)', fields: [] },
  repositories: { label: 'Repositories and accounts', fields: [] },
  wanted_models: { label: 'Wanted models (names, to load onto a Shared volume)', fields: ['wanted_models'] },
  folders: { label: 'Folders', fields: ['folders', 'custom'], machine: true },
  panama: { label: 'Panama bucket, region and profile', fields: [] },
  publish: { label: 'Publishing (S3 destination and Slack settings, no keys, no webhook)', fields: [] },
  governance: { label: 'Agent rules (system-wide)', fields: [] },
  secrets: { label: 'Keys and tokens', fields: [] },
}
export const SECTION_KEYS = Object.keys(SECTIONS) as SectionKey[]
const CONFIG_KEYS = new Set<string>(['auto_publish', 'outputs', 'edl', 'delivery_prepare', 'folders', 'custom', 'network_volume_id', 'shared_volume_id', 'mount_path', 'data_center_id', 'links', 'env', 'apply_by_default', 'pull_any_card', 'default_gpu', 'auto_cards', 'import_max_pods', 'import_cost_cap_usd', 'import_cap_enabled', 'required', 'image', 'registry_auth_id', 'idle_stop_minutes', 'models', 'wanted_models', 'pull_shared', 'sync_shared', 'sync_parallel', 'auto_sync', 'render', 'sync_exclude', 'sync_exclude_delete', 'folder_excludes', 'dry_run', 'mcp_http'])
const TOP_KEYS = new Set(['format', 'version', 'exported_at', 'app_version', 'config', 'panama', 'publish', 'needs', 'governance', 'mcp_connections', 'repositories', 'secrets_included', 'secrets', 'secrets_set', 'env_omitted', 'not_exported'])
/** Listed in every export, so a reader knows what to set up again by hand. */
export const NOT_EXPORTED = ['the no-spend switch (dry_run)', 'per-pod configurations', 'per-pod model choices (a pod id means nothing on another machine; the defaults travel)', 'adapters you wrote', 'which pod a repository is cloned onto (pod ids are not portable; the repository list itself travels)']
/** An environment variable name that looks like it holds a secret: with the keys included it travels in config.env like any other; without them it is left out. */
export const looksSecret = (name: string) => /(SECRET|TOKEN|PASSW|CREDENTIAL|PRIVATE|AUTH|API[_-]?KEY|ACCESS[_-]?KEY|(^|_)KEY($|_))/i.test(name)

/** What the UI, the CLI and every message may show of a secret: its last four characters (nothing but dots for a short one). */
export const maskSecret = (v: string) => (v.length >= 8 ? `••••${v.slice(-4)}` : '••••')

const appVersion = (): string => { try { return JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')).version || 'unknown' } catch { return 'unknown' } }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
import * as repos from './repositories.js'
import * as gpus from './gpus.js'
import * as wanted from './wanted.js'
import * as remote from './remote.js'
type PublicAccount = Omit<git.Account, 'token' | 'refresh_token'>
type RepoSection = { accounts: (PublicAccount & { token_set?: boolean })[]; repositories: repos.Repository[] }
type ConnSection = { console_url: string }
const connNow = (): ConnSection => ({ console_url: remote.url() })
const accountsNow = () => git.load().map(({ token, refresh_token, ...pub }) => ({ ...pub, token_set: !!token }))
const reposNow = (): RepoSection => ({ accounts: accountsNow(), repositories: repos.load() })
type Rules = { require_named_yes: boolean; spend_cap_usd: number; shell_guard?: boolean }
const rulesNow = (): Rules => settings.agentRules()
// ----- the publishing settings (docs/ADR-050): the NON-secret part of publish.json. The S3 keys and the Slack webhook live in the settings file and NEVER travel in a configuration file; only their names are listed (`needs`). -----
const PUBLISH_FIELDS: Record<string, Record<string, 'text' | 'bool' | 'int'>> = {
  s3: { bucket: 'text', prefix: 'text', region: 'text', endpoint: 'text', layout: 'text', credentials: 'text', presign_hours: 'int' },
  slack: { channel: 'text', username: 'text', workspace_name: 'text', workspace_url: 'text', preview_frame: 'bool', volume_source: 'bool', per_shot: 'bool', file_links: 'bool', file_link_count: 'int', folder_link: 'bool' },
}
export type PublishSection = { s3?: Record<string, unknown>; slack?: Record<string, unknown>; defaults?: { targets?: string[]; message?: string } }
const publishFile = () => process.env.PUBLISH_FILE || join(configDir(), 'publish.json')
/** A publish section checked against the same rules as publish.setSettings; keeps only the known non-secret fields. A bad value is an error that names the field. */
export function checkPublish(v: unknown): { value: PublishSection; error: string | null } {
  const out: PublishSection = {}
  if (!isObj(v)) return { value: out, error: 'publish is an object' }
  for (const [sec, fields] of Object.entries(PUBLISH_FIELDS)) {
    const src = v[sec]; if (src === undefined || src === null) continue
    if (!isObj(src)) return { value: out, error: `publish.${sec} is an object` }
    const dst: Record<string, unknown> = {}
    for (const [k, kind] of Object.entries(fields)) {
      const x = src[k]; if (x === undefined || x === null || x === '') continue
      const name = `publish.${sec}.${k}`
      if (kind === 'text') { if (typeof x !== 'string' || x.length > 2000 || /[\u0000-\u001f\u007f]/.test(x)) return { value: out, error: `${name} is text (no control characters)` }; dst[k] = x }
      else if (kind === 'bool') { if (typeof x !== 'boolean') return { value: out, error: `${name} is true or false` }; dst[k] = x }
      else { if (!(typeof x === 'number' && Number.isInteger(x))) return { value: out, error: `${name} is a whole number` }; dst[k] = x }
    }
    if (dst.layout !== undefined && dst.layout !== 'as-is' && dst.layout !== 'bkk-return') return { value: out, error: "publish.s3.layout is 'as-is' or 'bkk-return'" }
    if (dst.credentials !== undefined && dst.credentials !== 'app' && dst.credentials !== 'panama') return { value: out, error: "publish.s3.credentials is 'app' or 'panama'" }
    if (dst.presign_hours !== undefined && !((dst.presign_hours as number) >= 1 && (dst.presign_hours as number) <= 168)) return { value: out, error: 'publish.s3.presign_hours is a whole number from 1 to 168' }
    if (dst.file_link_count !== undefined && !((dst.file_link_count as number) >= 1 && (dst.file_link_count as number) <= 25)) return { value: out, error: 'publish.slack.file_link_count is a whole number from 1 to 25' }
    if (Object.keys(dst).length) out[sec as 's3' | 'slack'] = dst
  }
  if (isObj(v.defaults)) {
    const d: { targets?: string[]; message?: string } = {}
    if (v.defaults.targets !== undefined) { if (!Array.isArray(v.defaults.targets) || v.defaults.targets.some((t) => t !== 's3' && t !== 'slack')) return { value: out, error: "publish.defaults.targets is a list of 's3' and 'slack'" }; d.targets = [...new Set(v.defaults.targets as string[])] }
    if (v.defaults.message !== undefined && v.defaults.message !== '') { if (typeof v.defaults.message !== 'string' || v.defaults.message.length > 4000) return { value: out, error: 'publish.defaults.message is text' }; d.message = v.defaults.message }
    if (Object.keys(d).length) out.defaults = d
  }
  return { value: out, error: null }
}
const publishNow = (): PublishSection => { try { return checkPublish(JSON.parse(readFileSync(publishFile(), 'utf8'))).value } catch { return {} } }
const writePublish = (p: PublishSection) => { const f = publishFile(), t = `${f}.${process.pid}.tmp`; mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(t, JSON.stringify(p, null, 2) + '\n', { mode: 0o600 }); renameSync(t, f) }
/** The names of the publishing secrets that are set on this machine (never their values). */
const publishSecretsSet = () => ({ 'Slack webhook': !!settings.lookup('PUBLISH_SLACK_WEBHOOK_URL'), 'S3 keys': !!settings.lookup('PUBLISH_S3_ACCESS_KEY_ID') && !!settings.lookup('PUBLISH_S3_SECRET_ACCESS_KEY') })
/** What this machine still has unset, and the file cannot give: the UI says what to re-enter. */
const publishNeeds = (): string[] => Object.entries(publishSecretsSet()).filter(([, set]) => !set).map(([n]) => n)
const panamaNow = () => { const g = settings.get(); return { bucket: g.panama_bucket, region: g.panama_region, profile: g.panama_profile } }
const pick = (cfg: mounts.MountsConfig, fields: (keyof mounts.MountsConfig)[]) => Object.fromEntries(fields.map((f) => [f, cfg[f]]))
const short = (s: unknown, n = 60) => String(s).slice(0, n)

export interface SecretsBlock { settings: Record<string, string>; git_accounts: git.Account[] }
export interface ConfigFile {
  format: typeof FORMAT; version: number; exported_at: string; app_version: string
  config: Record<string, unknown>; panama: { bucket: string; region: string; profile: string }; /** the non-secret publishing settings */ publish?: PublishSection; /** the publishing secrets set on this machine and NOT in this file (names only) */ needs?: string[]; governance?: Rules; mcp_connections?: ConnSection; repositories?: RepoSection
  secrets_included: boolean; secrets?: SecretsBlock
  secrets_set: string[]; env_omitted: string[]; not_exported: string[]
}

/** The file name the Save dialog offers. */
export const suggestedName = (now = new Date()) => `pod-manager-config-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`

/** The Default Configuration as a file's content. With `includeSecrets` (the default) it carries the real keys and tokens in a `secrets` block and the secret-looking environment variables in config.env; without, none of them, only their names. Never dry_run. */
/** Auto-publish never travels turned on: an import forces it OFF, in dry-run, with no standing approval and no Tunnel; the window, the cap and the S3/Slack choice are imported. */
const importedAutoPublish = (v: unknown): mounts.AutoPublishConfig => {
  const a = mounts.normalizeAutoPublish(v), { standing: _s, ...rest } = a, { enabled_at: _e, ...gen } = a.generate   // Auto-generate keeps its preferences, but an import never switches on spend: it comes OFF and a pod becomes this PC (a pod needs a named save)
  return { ...rest, generate: { ...gen, enabled: false, where: 'local' as const }, enabled: false, dry_run: true, targets: { ...a.targets, tunnel: false } }
}
export function exportConfig(opts: { appVersion?: string; now?: Date; includeSecrets?: boolean } = {}): ConfigFile {
  const withSecrets = opts.includeSecrets !== false
  const { dry_run: _dry, ...cfg } = mounts.load()
  const env: Record<string, string> = {}, omitted: string[] = []
  for (const [k, v] of Object.entries(cfg.env)) { if (!withSecrets && looksSecret(k)) omitted.push(k); else env[k] = String(v) }
  const values = settings.secretValues(), accounts = git.load()
  const file: ConfigFile = {
    format: FORMAT, version: VERSION, exported_at: (opts.now ?? new Date()).toISOString(), app_version: opts.appVersion || appVersion(),
    config: { ...cfg, env, ...(cfg.auto_publish?.standing ? { auto_publish: { ...cfg.auto_publish, standing_informational: true } } : {}) }, panama: panamaNow(), publish: publishNow(), needs: Object.entries(publishSecretsSet()).filter(([, set]) => set).map(([n]) => n), governance: rulesNow(), mcp_connections: connNow(), repositories: reposNow(), secrets_included: withSecrets,
    secrets_set: [...Object.keys(values), ...accounts.map((a) => `git:${a.provider}/${a.username}`)], env_omitted: omitted, not_exported: [...NOT_EXPORTED],
  }
  if (withSecrets) file.secrets = { settings: values as Record<string, string>, git_accounts: accounts }
  return file
}

// ----- checking a file -----

const checkType = (key: string, v: unknown): string | null => {
  const str = (x: unknown) => typeof x === 'string'
  const strArr = (x: unknown) => Array.isArray(x) && x.every(str)
  switch (key) {
    case 'shared_volume_id': case 'network_volume_id': case 'mount_path': case 'data_center_id': case 'image': case 'registry_auth_id': return str(v) ? null : `${key} must be text`
    case 'idle_stop_minutes': case 'sync_parallel': return typeof v === 'number' && Number.isFinite(v) ? null : `${key} must be a number`
    case 'apply_by_default':
    case 'pull_any_card': return typeof v === 'boolean' ? null : `${key} must be true or false`
    case 'default_gpu': return str(v) && (v === 'auto' || (v as string) in gpus.GPUS) ? null : `${key} must be auto or a card of the table`
    case 'default_cards':
    case 'auto_cards': return strArr(v) && (v as string[]).every((k) => k in gpus.GPUS) ? null : `${key} must be a list of cards of the table`
    case 'import_max_pods': return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 20 ? null : `${key} must be a whole number from 1 to 20`
    case 'import_cost_cap_usd': return typeof v === 'number' && v > 0 ? null : `${key} must be a number above 0`
    case 'import_cap_enabled': return typeof v === 'boolean' ? null : `${key} must be true or false`
    case 'models': return v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every(str) && Object.keys(v as object).every((k) => k === 'vae' || k === 'diffusion_model') ? null : `${key} must be {vae, diffusion_model} as file names`
    case 'wanted_models': return wanted.checkList(v)
    case 'folder_excludes': return isObj(v) && Object.values(v).every(strArr) ? null : 'folder_excludes must map a folder (project, plates, comfy-shared, workflows) to a list of patterns'
    case 'sync_exclude_delete': return typeof v === 'boolean' ? null : 'sync_exclude_delete must be true or false'
    case 'sync_exclude': return strArr(v) ? null : 'sync_exclude must be a list of patterns (text)'
    case 'sync_shared': case 'pull_shared': return strArr(v) ? null : `${key} must be a list of folder names`
    case 'folders': return isObj(v) && Object.values(v).every(str) ? null : 'folders must map names to paths (text)'
    case 'required': return isObj(v) && Object.values(v).every((x) => typeof x === 'boolean') ? null : 'required must map folder names to true or false'
    case 'custom': case 'links': return Array.isArray(v) && v.every(isObj) ? null : `${key} must be a list of entries`
    case 'env': return isObj(v) && Object.values(v).every((x) => ['string', 'number', 'boolean'].includes(typeof x)) ? null : 'env must map names to text'
    case 'auto_sync': return isObj(v) && ['enabled', 'pull', 'push'].every((k) => v[k] === undefined || typeof v[k] === 'boolean') && (v.approved_by === undefined || str(v.approved_by)) ? null : 'auto_sync is { enabled, pull, push, approved_by }'
    case 'auto_publish': return isObj(v) && ['enabled', 'dry_run', 'dry_run_first', 'slack', 'require_approval'].every((k) => v[k] === undefined || typeof v[k] === 'boolean') && (v.targets === undefined || (isObj(v.targets) && Object.values(v.targets).every((x) => typeof x === 'boolean'))) && (v.round === undefined || typeof v.round === 'string') && (v.sources === undefined || (isObj(v.sources) && Object.values(v.sources).every((x) => typeof x === 'boolean'))) && (v.volume_scan_minutes === undefined || typeof v.volume_scan_minutes === 'number') && (v.generate === undefined || (isObj(v.generate) && Object.values(v.generate).every((x) => ['boolean', 'string', 'number'].includes(typeof x) || x === null))) && (v.include_dpx === undefined || typeof v.include_dpx === 'boolean') && (v.fix_dpx === undefined || typeof v.fix_dpx === 'boolean') && ['window_minutes', 'daily_cap'].every((k) => v[k] === undefined || (k === 'daily_cap' && v[k] === null) || (typeof v[k] === 'number' && Number.isFinite(v[k] as number))) && (v.scope === undefined || v.scope === 'edl' || v.scope === 'all') ? null : 'auto_publish is { enabled, dry_run, dry_run_first, window_minutes, daily_cap, scope: edl | all, targets: { s3, slack, tunnel } }'
    case 'edl': return isObj(v) && (v.source === null || v.source === undefined || isObj(v.source)) ? null : 'edl is { source: { bucket, key } | { file } | null }'
    case 'delivery_prepare': return isObj(v) && !('approved_by' in v) && (v.out_dir === undefined || typeof v.out_dir === 'string') && (v.colour_code === undefined || typeof v.colour_code === 'string') && ['gamma', 'fps'].every((k) => v[k] === undefined || typeof v[k] === 'number') && ['fps_source', 'timecode_source', 'frame_position'].every((k) => v[k] === undefined || typeof v[k] === 'string') && (v.skip_existing === undefined || typeof v.skip_existing === 'boolean') ? null : 'delivery_prepare is { out_dir, colour_code, gamma, fps_source, fps, timecode_source, frame_position, skip_existing } (no approved_by: a person\'s yes is never imported)'
    case 'outputs': return isObj(v) && Object.values(v).every((x) => typeof x === 'boolean') ? null : 'outputs is { hide_empty_folders }'
    case 'render': return isObj(v) && !('approved_by' in v) && !('allow_partial' in v) && (v.rec709 === undefined || typeof v.rec709 === 'boolean') && (v.publish === undefined || (isObj(v.publish) && Object.values(v.publish).every((x) => typeof x === 'boolean'))) ? null : 'render is { where, kind, proxy_width, review_width, codecs, fps, rec709, pull, skip_existing, publish: { s3, slack } } (no approver, no allow_partial)'
    case 'mcp_http': return isObj(v) && Object.values(v).every(isObj) ? null : 'mcp_http must map each server to its settings'
    default: return null
  }
}

/** One key or token in a preview: its name, its last four characters, whether importing it changes anything, and why not if it cannot be imported. Never the value. */
export interface SecretItem { name: string; hint: string; changed: boolean; error: string | null }
export interface PlanSection {
  key: SectionKey; label: string; changed: boolean; current: unknown; incoming: unknown; machine_specific: boolean; account_specific: boolean
  default_checked: boolean; error: string | null; note: string | null; items?: SecretItem[]
}
export interface ImportPlan {
  /** what the file lacks and this machine still has unset (names only), when the file has publishing settings */ needs?: string[]
  ok: boolean; errors: string[]; warnings: string[]; sections: PlanSection[]
  source: { app_version: string | null; exported_at: string | null; secrets_included: boolean; secrets_set: string[]; env_omitted: string[] }
}
/** What apply writes for the keys and tokens: only the entries that passed their checks. Held inside this module; never part of a plan. */
interface ParsedSecrets { settings: Record<string, string>; git: git.Account[]; skipped: string[] }

const checkAccount = (a: Record<string, unknown>): { account: git.Account | null; label: string; error: string | null } => {
  const provider = typeof a.provider === 'string' ? a.provider : '', username = typeof a.username === 'string' ? a.username : ''
  const label = `git:${short(provider, 20) || '?'}/${short(username, 40) || short(a.id, 40) || '?'}`
  const text = (k: string) => typeof a[k] === 'string' && (a[k] as string).length > 0
  for (const k of ['id', 'provider', 'host', 'username', 'token']) if (!text(k)) return { account: null, label, error: `${label}: "${k}" is missing or not text` }
  if (!(provider in git.providers())) return { account: null, label, error: `${label}: unknown provider` }
  const token = a.token as string
  if (/\s/.test(token) || token.length < 8) return { account: null, label, error: `${label}: the token is malformed (no spaces, at least 8 characters)` }
  const opt = (k: string) => (a[k] == null ? null : typeof a[k] === 'string' ? (a[k] as string) : undefined)
  const num = (k: string, d: number | null) => (a[k] == null ? d : typeof a[k] === 'number' && Number.isFinite(a[k]) ? (a[k] as number) : undefined)
  const refresh = opt('refresh_token'), name = opt('name'), avatar = opt('avatar_url'), profile = opt('profile_url'), expires = num('expires_at', null), connected = num('connected_at', Date.now() / 1000)
  if ([refresh, name, avatar, profile, expires, connected].includes(undefined as never)) return { account: null, label, error: `${label}: a field has the wrong type` }
  if (typeof refresh === 'string' && /\s/.test(refresh)) return { account: null, label, error: `${label}: the refresh token is malformed` }
  return { account: { id: a.id as string, provider, host: a.host as string, username, name: name as string | null, avatar_url: avatar as string | null, profile_url: profile as string | null, scope: typeof a.scope === 'string' ? a.scope : '', token, refresh_token: refresh as string | null, expires_at: expires as number | null, connected_at: connected as number }, label, error: null }
}

/** The plan with REAL values, for `applyImport` only. `planImport` is this with every secret masked. */
function buildPlan(file: unknown): { plan: ImportPlan; secrets: ParsedSecrets | null } {
  const plan: ImportPlan = { ok: false, errors: [], warnings: [], sections: [], source: { app_version: null, exported_at: null, secrets_included: false, secrets_set: [], env_omitted: [] } }
  const out = (secrets: ParsedSecrets | null = null) => ({ plan, secrets })
  const fail = (m: string) => { plan.errors.push(m); return out() }
  let size = 0
  try { size = JSON.stringify(file)?.length ?? 0 } catch { return fail('That is not a configuration file.') }
  if (size > MAX_BYTES) return fail(`That file is ${Math.round(size / 1024)} KB: far too large to be a configuration, so it was not read.`)
  if (!isObj(file)) return fail('That is not a configuration file: it is not a JSON object.')
  if (file.format !== FORMAT) return fail(`That is not a pod manager configuration file (its "format" is ${JSON.stringify(short(file.format ?? null, 40))}, not "${FORMAT}").`)
  if (typeof file.version !== 'number' || !Number.isInteger(file.version) || file.version < 1) return fail('That file has no valid "version".')
  if (file.version > VERSION) return fail(`That file is version ${file.version}; this app reads up to version ${VERSION}. Update the app, then import it.`)
  if (!isObj(file.config)) return fail('That file has no "config" section.')
  const names = (x: unknown) => (Array.isArray(x) ? x.filter((n): n is string => typeof n === 'string').map((n) => short(n, 80)).slice(0, 50) : [])
  plan.source = {
    app_version: typeof file.app_version === 'string' ? short(file.app_version, 40) : null, exported_at: typeof file.exported_at === 'string' ? short(file.exported_at, 40) : null,
    secrets_included: file.secrets !== undefined && file.secrets_included !== false, secrets_set: names(file.secrets_set), env_omitted: names(file.env_omitted),
  }
  for (const k of Object.keys(file)) if (!TOP_KEYS.has(k)) plan.warnings.push(`Ignored "${short(k)}": not part of this format.`)
  if (isObj(file.publish)) plan.needs = publishNeeds()
  const inc: Record<string, unknown> = {}
  let apWasOn = false, genWasOn = false
  for (const [k, v] of Object.entries(file.config)) {
    if (k === 'dry_run') { plan.warnings.push('Ignored "dry_run": the no-spend switch is never imported.'); continue }
    if (!CONFIG_KEYS.has(k)) { plan.warnings.push(`Ignored config.${short(k)}: not a setting this version has.`); continue }
    const t = checkType(k, v)
    if (t) { plan.errors.push(`config.${k}: ${t}.`); continue }
    if (k === 'auto_publish') { apWasOn = isObj(v) && v.enabled === true; genWasOn = isObj(v) && isObj(v.generate) && (v.generate.enabled === true || v.generate.where === 'pod'); inc[k] = importedAutoPublish(v); continue }
    inc[k] = v
  }
  if (isObj(inc.env)) inc.env = Object.fromEntries(Object.entries(inc.env).map(([k, v]) => [k, String(v)]))

  // the keys and tokens, if the file has them: each checked on its own, so one bad key is named and the others still import
  let secrets: ParsedSecrets | null = null
  const items: SecretItem[] = []
  if (file.secrets !== undefined) {
    if (!isObj(file.secrets)) plan.errors.push('"secrets" must be an object.')
    else {
      secrets = { settings: {}, git: [], skipped: [] }
      const cur = settings.secretValues()
      const given = file.secrets.settings
      if (given !== undefined && !isObj(given)) plan.errors.push('"secrets.settings" must map key names to values.')
      for (const [name, value] of Object.entries(isObj(given) ? given : {})) {
        if (!(name in settings.SECRET_FIELDS)) { plan.warnings.push(`Ignored secrets.settings.${short(name)}: not a key this app stores.`); continue }
        const err = settings.checkSecret(name, value)
        if (err) { items.push({ name, hint: '', changed: false, error: err }); secrets.skipped.push(name); continue }
        const v = (value as string).trim()
        secrets.settings[name] = v
        items.push({ name, hint: maskSecret(v), changed: cur[name as settings.SecretName] !== v, error: null })
      }
      const accts = file.secrets.git_accounts
      if (accts !== undefined && !Array.isArray(accts)) plan.errors.push('"secrets.git_accounts" must be a list.')
      const have = git.load()
      for (const a of Array.isArray(accts) ? accts : []) {
        if (!isObj(a)) { items.push({ name: 'git:?', hint: '', changed: false, error: 'a git account entry is not an object' }); secrets.skipped.push('git:?'); continue }
        const r = checkAccount(a)
        if (!r.account) { items.push({ name: r.label, hint: '', changed: false, error: r.error }); secrets.skipped.push(r.label); continue }
        secrets.git.push(r.account)
        const before = have.find((x) => x.id === r.account!.id)
        items.push({ name: r.label, hint: maskSecret(r.account.token), changed: !before || before.token !== r.account.token || before.refresh_token !== r.account.refresh_token, error: null })
      }
    }
  }
  if (plan.errors.length) return out()

  const current = mounts.load()
  for (const key of SECTION_KEYS) {
    const def = SECTIONS[key]
    if (key === 'secrets') {
      if (!secrets || !items.length) continue
      const ok = items.filter((i) => !i.error), bads = items.filter((i) => i.error)
      const changed = ok.some((i) => i.changed)
      const hints = (xs: SecretItem[]) => Object.fromEntries(xs.map((i) => [i.name, i.hint]))
      const now = settings.secretValues()
      const currentHints = Object.fromEntries([...Object.entries(now).map(([n, v]) => [n, maskSecret(v as string)]), ...git.load().map((a) => [`git:${a.provider}/${a.username}`, maskSecret(a.token)])])
      plan.sections.push({
        key, label: def.label, changed, current: currentHints, incoming: hints(ok), machine_specific: false, account_specific: false, default_checked: changed && !!ok.length,
        error: ok.length ? null : `None of the keys and tokens in the file can be imported (${bads.map((b) => b.name).join(', ')}).`,
        note: bads.length && ok.length ? `Not imported, malformed: ${bads.map((b) => b.name).join(', ')}.` : null, items,
      })
      continue
    }
    if (key === 'mcp_connections') {
      if (!isObj(file.mcp_connections)) continue
      const now = connNow()
      const incoming = { console_url: String(file.mcp_connections.console_url ?? now.console_url).trim() }
      let err: string | null = null
      try { remote.checkUrl(incoming.console_url) } catch (e) { err = (e as Error).message }
      plan.sections.push({ key, label: def.label, changed: !same(now, incoming), current: now, incoming, machine_specific: false, account_specific: false, default_checked: !err && !same(now, incoming), error: err, note: 'The console key is a secret: it travels in the Keys and tokens section.' })
      continue
    }
    if (key === 'repositories') {
      if (!isObj(file.repositories)) continue
      const f = file.repositories as Record<string, unknown>
      const now = reposNow()
      const bad: string[] = [], list: repos.Repository[] = []
      for (const r of Array.isArray(f.repositories) ? f.repositories : []) {
        if (!isObj(r) || typeof r.url !== 'string') { bad.push('an entry without a url'); continue }
        try { repos.check(r.url, typeof r.branch === 'string' ? r.branch : null) } catch (e) { bad.push(`${short(r.url)}: ${(e as Error).message}`); continue }
        list.push({ id: typeof r.id === 'string' && r.id ? r.id : repos.normalize(r.url), url: repos.normalize(r.url), branch: typeof r.branch === 'string' ? r.branch : 'main', name: typeof r.name === 'string' ? r.name : repos.repoName(r.url), host: typeof r.host === 'string' ? r.host : repos.hostOf(r.url), attached_at: Number(r.attached_at) || 0 })
      }
      const tokenFromFile = new Set((secrets?.git ?? []).map((a) => a.id))
      const accts: RepoSection['accounts'] = []
      for (const a of Array.isArray(f.accounts) ? f.accounts : []) {
        if (!isObj(a) || typeof a.id !== 'string' || typeof a.provider !== 'string' || typeof a.username !== 'string') { bad.push('an account entry without id, provider and username'); continue }
        const local = git.load().find((x) => x.id === a.id)
        accts.push({ id: a.id, provider: a.provider, host: String(a.host ?? ''), username: a.username, name: (a.name as string | null) ?? null, avatar_url: (a.avatar_url as string | null) ?? null, profile_url: (a.profile_url as string | null) ?? null, scope: String(a.scope ?? ''), expires_at: (a.expires_at as number | null) ?? null, connected_at: Number(a.connected_at) || 0, token_set: !!local?.token || tokenFromFile.has(a.id) })
      }
      const missing = accts.filter((a) => !a.token_set).map((a) => `${a.provider}/${a.username}`)
      const incoming: RepoSection = { accounts: accts, repositories: list }
      const noteParts = [...(missing.length ? [`Token missing for ${missing.join(', ')}: the account is listed, not connected, until its token is imported (Keys and tokens) or you connect it again.`] : []), ...(bad.length ? [`Not imported: ${bad.join('; ')}.`] : [])]
      plan.sections.push({ key, label: def.label, changed: list.some((r) => !now.repositories.some((x) => x.url === r.url && x.branch === r.branch)) || accts.some((a) => !now.accounts.some((x) => x.id === a.id)), current: now, incoming, machine_specific: false, account_specific: false, default_checked: true, error: null, note: noteParts.join(' ') || null })
      continue
    }
    if (key === 'governance') {
      if (!isObj(file.governance)) continue
      const now = rulesNow()
      const g = file.governance as Record<string, unknown>
      const incoming = { require_named_yes: g.require_named_yes ?? now.require_named_yes, spend_cap_usd: g.spend_cap_usd ?? now.spend_cap_usd, shell_guard: g.shell_guard ?? now.shell_guard }
      const err = settings.checkAgentRules(incoming)
      plan.sections.push({ key, label: def.label, changed: !same(now, incoming), current: now, incoming, machine_specific: false, account_specific: false, default_checked: !err && !same(now, incoming), error: err, note: null })
      continue
    }
    if (key === 'publish') {
      if (file.publish === undefined) continue
      const now = publishNow(), c = checkPublish(file.publish)
      plan.sections.push({ key, label: def.label, changed: !same(now, c.value), current: now, incoming: c.value, machine_specific: false, account_specific: false, default_checked: !c.error && !same(now, c.value), error: c.error, note: 'The S3 keys and the Slack webhook are never in a file: they stay as they are on this machine.' })
      continue
    }
    if (key === 'panama') {
      if (!isObj(file.panama)) continue
      const now = panamaNow()
      const incoming = { bucket: file.panama.bucket ?? now.bucket, region: file.panama.region ?? now.region, profile: file.panama.profile ?? now.profile }
      const err = (['bucket', 'region', 'profile'] as const).map((f) => settings.checkPanama(f, incoming[f])).find(Boolean) ?? null
      plan.sections.push({ key, label: def.label, changed: !same(now, incoming), current: now, incoming, machine_specific: false, account_specific: false, default_checked: !err && !same(now, incoming), error: err, note: null })
      continue
    }
    if (!def.fields.some((f) => f in inc)) continue
    const merged = { ...current, ...Object.fromEntries(def.fields.filter((f) => f in inc).map((f) => [f, inc[f]])) } as Partial<mounts.MountsConfig>
    if (key === 'wanted_models') merged.wanted_models = wanted.merge(current.wanted_models, wanted.normalizeList(inc.wanted_models))   // merged by repo, path and folder: what is here stays
    let err: string | null = null, normalized: mounts.MountsConfig
    try { normalized = mounts.validate(mounts.normalize(merged)) } catch (e) { err = (e as Error).message; normalized = mounts.normalize(merged) }
    const cur = pick(current, def.fields), incoming = pick(normalized, def.fields)
    if (key === 'env') {   // importing a file never deletes a secret already in the table just because the file does not mention it
      const keep = Object.fromEntries(Object.entries(current.env).filter(([k]) => looksSecret(k)))
      ;(incoming as Record<string, unknown>).env = { ...keep, ...(incoming.env as object) }
    }
    const changed = !same(cur, incoming)
    const mirror = key === 'folders' ? [...Object.values(normalized.folders), ...normalized.custom.map((c) => c.local)].some((p) => p && mounts.inMirror(p)) : false
    plan.sections.push({
      key, label: def.label, changed, current: cur, incoming, machine_specific: !!def.machine, account_specific: !!def.account, default_checked: changed && !def.machine && !err, error: err,
      note: [(mirror ? 'A folder in this file points into Binc\'s read-only mirror: a run will not write there (it falls back to ~/ComfyUI-Shared in dev mode, and is refused in prod).' : def.machine ? 'Paths from another machine.' : def.account ? 'Ids that belong to the exporting RunPod account; they may not exist in yours.' : null), key === 'pod_defaults' && apWasOn ? 'Auto-publish will be imported turned OFF (a standing approval never travels: a person turns it on again in the window).' : null, key === 'pod_defaults' && genWasOn ? 'Auto-generate will be imported turned OFF and on this PC: an import never switches on spend.' : null].filter(Boolean).join(' ') || null,
    })
  }
  if (!plan.sections.length) plan.warnings.push('The file carries no settings this version can import.')
  plan.ok = true
  return out(secrets)
}

/** The environment table with every secret-looking value reduced to its last four characters, for showing. */
const maskEnv = (env: unknown) => (isObj(env) ? Object.fromEntries(Object.entries(env).map(([k, v]) => [k, looksSecret(k) ? maskSecret(String(v)) : v])) : env)
const maskSection = (s: PlanSection): PlanSection => (s.key === 'env'
  ? { ...s, current: { ...(s.current as object), env: maskEnv((s.current as Record<string, unknown>).env) }, incoming: { ...(s.incoming as object), env: maskEnv((s.incoming as Record<string, unknown>).env) } }
  : s)

/** What an import would do, changing nothing: errors that stop it, warnings, and one entry per section the file carries, with current and incoming values. Every secret in it is masked to its last four characters. */
export function planImport(file: unknown): ImportPlan {
  const { plan } = buildPlan(file)
  return { ...plan, sections: plan.sections.map(maskSection) }
}

// ----- applying, backing up, undoing -----

interface Backup {
  at: string; /** the non-secret publishing settings as they were (never a key or a webhook) */ publish?: PublishSection; mounts: mounts.MountsConfig; panama: { bucket: string; region: string; profile: string }; governance?: Rules; console_url?: string; repositories?: repos.Repository[]
  /** The keys and tokens as they were (so Undo restores them too). Absent in a backup made before the export carried keys. */
  secrets?: { settings: Partial<Record<settings.SecretName, string>>; git_accounts: git.Account[] }
}
export interface BackupInfo { file: string; name: string; at: string }
const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-')

export function listBackups(): BackupInfo[] {
  const dir = backupsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => /^mounts-.+\.json$/.test(n)).sort().reverse().map((name) => ({ file: join(dir, name), name, at: name.slice(7, -5) }))
}

/** The backups hold keys now: the folder is 0700 and each file 0600. */
function writeBackup(now = new Date()): string {
  const dir = backupsDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)   // the mode option only applies to a folder this call creates
  const file = join(dir, `mounts-${stamp(now)}.json`)
  const b: Backup = { at: now.toISOString(), publish: publishNow(), mounts: mounts.load(), panama: panamaNow(), governance: rulesNow(), console_url: remote.url(), repositories: repos.load(), secrets: { settings: settings.storedSecretValues(), git_accounts: git.load() } }
  writeFileSync(file, JSON.stringify(b, null, 2) + '\n', { mode: 0o600 })
  chmodSync(file, 0o600)
  for (const old of listBackups().slice(KEEP_BACKUPS)) { try { unlinkSync(old.file) } catch { /* a backup that cannot be pruned stays */ } }
  return file
}

const setRules = (r: Rules) => settings.set({ agent_named_yes_required: r.require_named_yes, agent_spend_cap_usd: r.spend_cap_usd, ...(r.shell_guard === undefined ? {} : { agent_shell_guard: r.shell_guard }) })
const setPanama = (p: { bucket: string; region: string; profile: string }) => settings.set({ panama_bucket: p.bucket, panama_region: p.region, panama_profile: p.profile })

/** Write the checked sections. Everything is validated first; the current configuration and keys are backed up; then it is saved through `mounts.put`, `settings.set` and the git store. */
export function applyImport(file: unknown, opts: { sections: string[]; now?: Date }) {
  const { plan, secrets } = buildPlan(file)
  if (!plan.ok) throw bad(plan.errors.join(' '))
  const wanted = [...new Set(opts.sections)]
  const unknown = wanted.filter((s) => !SECTION_KEYS.includes(s as SectionKey))
  if (unknown.length) throw bad(`No such section: ${unknown.join(', ')}.`)
  const chosen = plan.sections.filter((s) => wanted.includes(s.key))
  if (!chosen.length) throw bad('No section selected, or none of the selected ones is in the file.')
  const refused = chosen.find((s) => s.error)
  if (refused) throw bad(`${refused.label}: ${refused.error}`)

  const current = mounts.load()
  const next: Record<string, unknown> = { ...current }
  for (const s of chosen) {
    if (s.key === 'publish' || s.key === 'panama' || s.key === 'governance' || s.key === 'mcp_connections' || s.key === 'repositories' || s.key === 'secrets') continue
    for (const [f, v] of Object.entries(s.incoming as Record<string, unknown>)) next[f] = v
  }
  const cfg = mounts.validate(mounts.normalize(next as Partial<mounts.MountsConfig>))   // the panel's own check, on the merged result
  const panama = chosen.find((s) => s.key === 'panama')
  const rules = chosen.find((s) => s.key === 'governance')
  const withSecrets = chosen.some((s) => s.key === 'secrets') && secrets
  const backup = writeBackup(opts.now)
  const payload = mounts.put(cfg, { quiet: true })
  history.record({ kind: 'change', area: 'configuration', action: 'imported from a file', what: chosen.map((s) => s.label).join(', ') })   // the section names only, never a value
  if (panama) setPanama(panama.incoming as { bucket: string; region: string; profile: string })
  const pub = chosen.find((s) => s.key === 'publish'); if (pub) writePublish({ ...publishNow(), ...(pub.incoming as PublishSection) })   // the non-secret settings only; the keys and the webhook are untouched
  if (rules) setRules(rules.incoming as Rules)
  const conn = chosen.find((s) => s.key === 'mcp_connections')
  if (conn) settings.set({ panama_console_url: (conn.incoming as ConnSection).console_url })
  const repoSec = chosen.find((s) => s.key === 'repositories')
  if (repoSec) {   // the repository list is merged by url and branch (what is here stays); accounts connect through their tokens, never from this section
    const have = repos.load(), next = [...have]
    for (const r of (repoSec.incoming as RepoSection).repositories) if (!next.some((x) => x.url === r.url && x.branch === r.branch)) next.push(r)
    repos.save(next)
  }
  if (withSecrets) {
    if (Object.keys(secrets.settings).length) settings.setSecrets(secrets.settings as Partial<Record<settings.SecretName, string>>)
    if (secrets.git.length) {
      const have = git.load(), byId = new Map(have.map((a) => [a.id, a]))
      for (const a of secrets.git) byId.set(a.id, a)
      git.save([...byId.values()])
    }
  }
  return { payload, backup, needs: publishNeeds(), applied: chosen.map((s) => s.key), skipped: withSecrets ? secrets.skipped : [], settings: settings.get() }
}

/** Put back the configuration, the exchange-bucket settings and the keys and tokens as they were before the last import, and drop that backup so a second undo goes one step further. */
export function undoImport() {
  const last = listBackups()[0]
  if (!last) throw bad('Nothing to undo: there is no backup.')
  let b: Backup
  try { b = JSON.parse(readFileSync(last.file, 'utf8')) } catch (e) { throw bad(`${last.name} cannot be read: ${(e as Error).message}`) }
  const payload = mounts.put(b.mounts, { quiet: true })
  history.record({ kind: 'change', area: 'configuration', action: 'restored from a backup', what: last.name })
  if (b.panama) setPanama(b.panama)
  if (b.publish) writePublish(b.publish)
  if (b.governance) setRules(b.governance)
  if (b.console_url) settings.set({ panama_console_url: b.console_url })
  if (b.repositories) repos.save(b.repositories)
  if (b.secrets) { settings.restoreSecrets(b.secrets.settings); git.save(b.secrets.git_accounts) }
  try { unlinkSync(last.file) } catch { /* it stays; harmless */ }
  return { payload, restored: last.name, settings: settings.get() }
}
