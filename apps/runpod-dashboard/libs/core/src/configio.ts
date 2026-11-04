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
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bad } from './errors.js'
import * as git from './git.js'
import * as history from './history.js'
import * as mounts from './mounts.js'
import { APP_DIR, backupsDir } from './paths.js'
import * as settings from './settings.js'

export const FORMAT = 'runpod-pod-manager-config'
export const VERSION = 1
export const MAX_BYTES = 2 * 1024 * 1024   // a configuration is a few KB; refuse anything near this as "not a configuration"
export const KEEP_BACKUPS = 10

export type SectionKey = 'volume' | 'image' | 'env' | 'pod_defaults' | 'mcp' | 'folders' | 'panama' | 'secrets'
interface SectionDef { label: string; fields: (keyof mounts.MountsConfig)[]; machine?: boolean; account?: boolean }
export const SECTIONS: Record<SectionKey, SectionDef> = {
  volume: { label: 'Volume and datacenter', fields: ['network_volume_id', 'mount_path', 'data_center_id'], account: true },
  image: { label: 'Image and registry login', fields: ['image', 'registry_auth_id'], account: true },
  env: { label: 'Environment', fields: ['env'] },
  pod_defaults: { label: 'Pod defaults', fields: ['idle_stop_minutes', 'sync_parallel', 'sync_shared', 'pull_shared', 'apply_by_default', 'pull_any_card', 'required', 'links'] },
  mcp: { label: 'MCP servers', fields: ['mcp_http'] },
  folders: { label: 'Folders', fields: ['folders', 'custom'], machine: true },
  panama: { label: 'Panama bucket, region and profile', fields: [] },
  secrets: { label: 'Keys and tokens', fields: [] },
}
export const SECTION_KEYS = Object.keys(SECTIONS) as SectionKey[]
const CONFIG_KEYS = new Set<string>(['folders', 'custom', 'network_volume_id', 'mount_path', 'data_center_id', 'links', 'env', 'apply_by_default', 'pull_any_card', 'required', 'image', 'registry_auth_id', 'idle_stop_minutes', 'pull_shared', 'sync_shared', 'sync_parallel', 'dry_run', 'mcp_http'])
const TOP_KEYS = new Set(['format', 'version', 'exported_at', 'app_version', 'config', 'panama', 'secrets_included', 'secrets', 'secrets_set', 'env_omitted', 'not_exported'])
/** Listed in every export, so a reader knows what to set up again by hand. */
export const NOT_EXPORTED = ['the no-spend switch (dry_run)', 'per-pod configurations', 'adapters you wrote', 'the repositories attached to pods']
/** An environment variable name that looks like it holds a secret: with the keys included it travels in config.env like any other; without them it is left out. */
export const looksSecret = (name: string) => /(SECRET|TOKEN|PASSW|CREDENTIAL|PRIVATE|AUTH|API[_-]?KEY|ACCESS[_-]?KEY|(^|_)KEY($|_))/i.test(name)

/** What the UI, the CLI and every message may show of a secret: its last four characters (nothing but dots for a short one). */
export const maskSecret = (v: string) => (v.length >= 8 ? `••••${v.slice(-4)}` : '••••')

const appVersion = (): string => { try { return JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')).version || 'unknown' } catch { return 'unknown' } }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const panamaNow = () => { const g = settings.get(); return { bucket: g.panama_bucket, region: g.panama_region, profile: g.panama_profile } }
const pick = (cfg: mounts.MountsConfig, fields: (keyof mounts.MountsConfig)[]) => Object.fromEntries(fields.map((f) => [f, cfg[f]]))
const short = (s: unknown, n = 60) => String(s).slice(0, n)

export interface SecretsBlock { settings: Record<string, string>; git_accounts: git.Account[] }
export interface ConfigFile {
  format: typeof FORMAT; version: number; exported_at: string; app_version: string
  config: Record<string, unknown>; panama: { bucket: string; region: string; profile: string }
  secrets_included: boolean; secrets?: SecretsBlock
  secrets_set: string[]; env_omitted: string[]; not_exported: string[]
}

/** The file name the Save dialog offers. */
export const suggestedName = (now = new Date()) => `pod-manager-config-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`

/** The Default Configuration as a file's content. With `includeSecrets` (the default) it carries the real keys and tokens in a `secrets` block and the secret-looking environment variables in config.env; without, none of them, only their names. Never dry_run. */
export function exportConfig(opts: { appVersion?: string; now?: Date; includeSecrets?: boolean } = {}): ConfigFile {
  const withSecrets = opts.includeSecrets !== false
  const { dry_run: _dry, ...cfg } = mounts.load()
  const env: Record<string, string> = {}, omitted: string[] = []
  for (const [k, v] of Object.entries(cfg.env)) { if (!withSecrets && looksSecret(k)) omitted.push(k); else env[k] = String(v) }
  const values = settings.secretValues(), accounts = git.load()
  const file: ConfigFile = {
    format: FORMAT, version: VERSION, exported_at: (opts.now ?? new Date()).toISOString(), app_version: opts.appVersion || appVersion(),
    config: { ...cfg, env }, panama: panamaNow(), secrets_included: withSecrets,
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
    case 'network_volume_id': case 'mount_path': case 'data_center_id': case 'image': case 'registry_auth_id': return str(v) ? null : `${key} must be text`
    case 'idle_stop_minutes': case 'sync_parallel': return typeof v === 'number' && Number.isFinite(v) ? null : `${key} must be a number`
    case 'apply_by_default':
    case 'pull_any_card': return typeof v === 'boolean' ? null : `${key} must be true or false`
    case 'sync_shared': case 'pull_shared': return strArr(v) ? null : `${key} must be a list of folder names`
    case 'folders': return isObj(v) && Object.values(v).every(str) ? null : 'folders must map names to paths (text)'
    case 'required': return isObj(v) && Object.values(v).every((x) => typeof x === 'boolean') ? null : 'required must map folder names to true or false'
    case 'custom': case 'links': return Array.isArray(v) && v.every(isObj) ? null : `${key} must be a list of entries`
    case 'env': return isObj(v) && Object.values(v).every((x) => ['string', 'number', 'boolean'].includes(typeof x)) ? null : 'env must map names to text'
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
  const inc: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(file.config)) {
    if (k === 'dry_run') { plan.warnings.push('Ignored "dry_run": the no-spend switch is never imported.'); continue }
    if (!CONFIG_KEYS.has(k)) { plan.warnings.push(`Ignored config.${short(k)}: not a setting this version has.`); continue }
    const t = checkType(k, v)
    if (t) { plan.errors.push(`config.${k}: ${t}.`); continue }
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
      note: mirror ? 'A folder in this file points into Binc\'s read-only mirror: a run will not write there (it falls back to ~/ComfyUI-Shared in dev mode, and is refused in prod).' : def.machine ? 'Paths from another machine.' : def.account ? 'Ids that belong to the exporting RunPod account; they may not exist in yours.' : null,
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
  at: string; mounts: mounts.MountsConfig; panama: { bucket: string; region: string; profile: string }
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
  const b: Backup = { at: now.toISOString(), mounts: mounts.load(), panama: panamaNow(), secrets: { settings: settings.storedSecretValues(), git_accounts: git.load() } }
  writeFileSync(file, JSON.stringify(b, null, 2) + '\n', { mode: 0o600 })
  chmodSync(file, 0o600)
  for (const old of listBackups().slice(KEEP_BACKUPS)) { try { unlinkSync(old.file) } catch { /* a backup that cannot be pruned stays */ } }
  return file
}

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
    if (s.key === 'panama' || s.key === 'secrets') continue
    for (const [f, v] of Object.entries(s.incoming as Record<string, unknown>)) next[f] = v
  }
  const cfg = mounts.validate(mounts.normalize(next as Partial<mounts.MountsConfig>))   // the panel's own check, on the merged result
  const panama = chosen.find((s) => s.key === 'panama')
  const withSecrets = chosen.some((s) => s.key === 'secrets') && secrets
  const backup = writeBackup(opts.now)
  const payload = mounts.put(cfg, { quiet: true })
  history.record({ kind: 'change', area: 'configuration', action: 'imported from a file', what: chosen.map((s) => s.label).join(', ') })   // the section names only, never a value
  if (panama) setPanama(panama.incoming as { bucket: string; region: string; profile: string })
  if (withSecrets) {
    if (Object.keys(secrets.settings).length) settings.setSecrets(secrets.settings as Partial<Record<settings.SecretName, string>>)
    if (secrets.git.length) {
      const have = git.load(), byId = new Map(have.map((a) => [a.id, a]))
      for (const a of secrets.git) byId.set(a.id, a)
      git.save([...byId.values()])
    }
  }
  return { payload, backup, applied: chosen.map((s) => s.key), skipped: withSecrets ? secrets.skipped : [], settings: settings.get() }
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
  if (b.secrets) { settings.restoreSecrets(b.secrets.settings); git.save(b.secrets.git_accounts) }
  try { unlinkSync(last.file) } catch { /* it stays; harmless */ }
  return { payload, restored: last.name, settings: settings.get() }
}
