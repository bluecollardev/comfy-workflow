/**
 * Export and import of the Default Configuration as one JSON file (docs/ADR-023).
 *
 * The file is DATA: parsed, checked, previewed per section and only then written, through the same `mounts.put` the panel's Save uses (normalize,
 * validate, save). It never carries a secret: not the RunPod, Panama, console or Anthropic keys, not git tokens, and not an environment variable
 * whose name looks like one. Not exported at all: the no-spend switch (`dry_run`), per-pod configurations, adapters, git accounts and repositories.
 * Before an import writes anything the current configuration is copied to <config dir>/backups, newest ten kept, and `undoImport` puts it back.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bad } from './errors.js'
import * as mounts from './mounts.js'
import { APP_DIR, backupsDir } from './paths.js'
import * as settings from './settings.js'

export const FORMAT = 'runpod-pod-manager-config'
export const VERSION = 1
export const MAX_BYTES = 2 * 1024 * 1024   // a configuration is a few KB; refuse anything near a megabyte as "not a configuration"
export const KEEP_BACKUPS = 10

export type SectionKey = 'volume' | 'image' | 'env' | 'pod_defaults' | 'mcp' | 'folders' | 'panama'
interface SectionDef { label: string; fields: (keyof mounts.MountsConfig)[]; machine?: boolean; account?: boolean; note?: string }
export const SECTIONS: Record<SectionKey, SectionDef> = {
  volume: { label: 'Volume and datacenter', fields: ['network_volume_id', 'mount_path', 'data_center_id'], account: true },
  image: { label: 'Image and registry login', fields: ['image', 'registry_auth_id'], account: true },
  env: { label: 'Environment', fields: ['env'] },
  pod_defaults: { label: 'Pod defaults', fields: ['idle_stop_minutes', 'sync_parallel', 'sync_shared', 'pull_shared', 'apply_by_default', 'required', 'links'] },
  mcp: { label: 'MCP servers', fields: ['mcp_http'] },
  folders: { label: 'Folders', fields: ['folders', 'custom'], machine: true },
  panama: { label: 'Panama bucket, region and profile', fields: [] },
}
export const SECTION_KEYS = Object.keys(SECTIONS) as SectionKey[]
const CONFIG_KEYS = new Set<string>(['folders', 'custom', 'network_volume_id', 'mount_path', 'data_center_id', 'links', 'env', 'apply_by_default', 'required', 'image', 'registry_auth_id', 'idle_stop_minutes', 'pull_shared', 'sync_shared', 'sync_parallel', 'dry_run', 'mcp_http'])
const TOP_KEYS = new Set(['format', 'version', 'exported_at', 'app_version', 'config', 'panama', 'secrets_set', 'env_omitted', 'not_exported'])
/** Listed in every export, so a reader knows what to set up again by hand. */
export const NOT_EXPORTED = ['the no-spend switch (dry_run)', 'per-pod configurations', 'adapters you wrote', 'git accounts and repositories (they hold tokens)', 'every key and token']
const SECRET_NAMES = ['RUNPOD_API_KEY', 'RUNPOD_S3_ACCESS_KEY', 'RUNPOD_S3_SECRET_KEY', 'ANTHROPIC_API_KEY', 'PANAMA_CONSOLE_KEY', 'PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY']
/** An environment variable name that looks like it holds a secret: left out of an export, and dropped from an import. */
export const looksSecret = (name: string) => /(SECRET|TOKEN|PASSW|CREDENTIAL|PRIVATE|AUTH|API[_-]?KEY|ACCESS[_-]?KEY|(^|_)KEY($|_))/i.test(name)

const appVersion = (): string => { try { return JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')).version || 'unknown' } catch { return 'unknown' } }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const panamaNow = () => { const g = settings.get(); return { bucket: g.panama_bucket, region: g.panama_region, profile: g.panama_profile } }
const pick = (cfg: mounts.MountsConfig, fields: (keyof mounts.MountsConfig)[]) => Object.fromEntries(fields.map((f) => [f, cfg[f]]))

export interface ConfigFile {
  format: typeof FORMAT; version: number; exported_at: string; app_version: string
  config: Record<string, unknown>; panama: { bucket: string; region: string; profile: string }
  secrets_set: string[]; env_omitted: string[]; not_exported: string[]
}

/** The file name the Save dialog offers. */
export const suggestedName = (now = new Date()) => `pod-manager-config-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`

/** The Default Configuration as a file's content. No secret, no dry_run; the names of the secrets that are set here, so the importer knows what to enter again. */
export function exportConfig(opts: { appVersion?: string; now?: Date } = {}): ConfigFile {
  const { dry_run: _dry, ...cfg } = mounts.load()
  const env: Record<string, string> = {}, omitted: string[] = []
  for (const [k, v] of Object.entries(cfg.env)) { if (looksSecret(k)) omitted.push(k); else env[k] = String(v) }
  return {
    format: FORMAT, version: VERSION, exported_at: (opts.now ?? new Date()).toISOString(), app_version: opts.appVersion || appVersion(),
    config: { ...cfg, env }, panama: panamaNow(),
    secrets_set: SECRET_NAMES.filter((n) => !!settings.lookup(n)), env_omitted: omitted, not_exported: [...NOT_EXPORTED],
  }
}

// ----- checking a file -----

const checkType = (key: string, v: unknown): string | null => {
  const str = (x: unknown) => typeof x === 'string'
  const strArr = (x: unknown) => Array.isArray(x) && x.every(str)
  switch (key) {
    case 'network_volume_id': case 'mount_path': case 'data_center_id': case 'image': case 'registry_auth_id': return str(v) ? null : `${key} must be text`
    case 'idle_stop_minutes': case 'sync_parallel': return typeof v === 'number' && Number.isFinite(v) ? null : `${key} must be a number`
    case 'apply_by_default': return typeof v === 'boolean' ? null : `${key} must be true or false`
    case 'sync_shared': case 'pull_shared': return strArr(v) ? null : `${key} must be a list of folder names`
    case 'folders': return isObj(v) && Object.values(v).every(str) ? null : 'folders must map names to paths (text)'
    case 'required': return isObj(v) && Object.values(v).every((x) => typeof x === 'boolean') ? null : 'required must map folder names to true or false'
    case 'custom': case 'links': return Array.isArray(v) && v.every(isObj) ? null : `${key} must be a list of entries`
    case 'env': return isObj(v) && Object.values(v).every((x) => ['string', 'number', 'boolean'].includes(typeof x)) ? null : 'env must map names to text'
    case 'mcp_http': return isObj(v) && Object.values(v).every(isObj) ? null : 'mcp_http must map each server to its settings'
    default: return null
  }
}

export interface PlanSection { key: SectionKey; label: string; changed: boolean; current: unknown; incoming: unknown; machine_specific: boolean; account_specific: boolean; default_checked: boolean; error: string | null; note: string | null }
export interface ImportPlan {
  ok: boolean; errors: string[]; warnings: string[]; sections: PlanSection[]
  source: { app_version: string | null; exported_at: string | null; secrets_set: string[]; env_omitted: string[] }
}

/** What an import would do, changing nothing: errors that stop it, warnings, and one entry per section the file carries, with current and incoming values. */
export function planImport(file: unknown): ImportPlan {
  const plan: ImportPlan = { ok: false, errors: [], warnings: [], sections: [], source: { app_version: null, exported_at: null, secrets_set: [], env_omitted: [] } }
  const fail = (m: string) => { plan.errors.push(m); return plan }
  let size = 0
  try { size = JSON.stringify(file)?.length ?? 0 } catch { return fail('That is not a configuration file.') }
  if (size > MAX_BYTES) return fail(`That file is ${Math.round(size / 1024)} KB: far too large to be a configuration, so it was not read.`)
  if (!isObj(file)) return fail('That is not a configuration file: it is not a JSON object.')
  if (file.format !== FORMAT) return fail(`That is not a pod manager configuration file (its "format" is ${JSON.stringify(file.format ?? null)}, not "${FORMAT}").`)
  if (typeof file.version !== 'number' || !Number.isInteger(file.version) || file.version < 1) return fail('That file has no valid "version".')
  if (file.version > VERSION) return fail(`That file is version ${file.version}; this app reads up to version ${VERSION}. Update the app, then import it.`)
  if (!isObj(file.config)) return fail('That file has no "config" section.')
  plan.source = {
    app_version: typeof file.app_version === 'string' ? file.app_version : null, exported_at: typeof file.exported_at === 'string' ? file.exported_at : null,
    secrets_set: Array.isArray(file.secrets_set) ? file.secrets_set.filter((x): x is string => typeof x === 'string').slice(0, 50) : [], env_omitted: [],
  }
  for (const k of Object.keys(file)) if (!TOP_KEYS.has(k)) plan.warnings.push(`Ignored "${k}": not part of this format.`)
  const inc: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(file.config)) {
    if (k === 'dry_run') { plan.warnings.push('Ignored "dry_run": the no-spend switch is never imported.'); continue }
    if (!CONFIG_KEYS.has(k)) { plan.warnings.push(`Ignored config.${k}: not a setting this version has.`); continue }
    const t = checkType(k, v)
    if (t) { plan.errors.push(`config.${k}: ${t}.`); continue }
    inc[k] = v
  }
  if (isObj(inc.env)) {   // never take a secret from a file, whatever it is called
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(inc.env)) { if (looksSecret(k)) plan.source.env_omitted.push(k); else env[k] = String(v) }
    inc.env = env
    if (plan.source.env_omitted.length) plan.warnings.push(`Not imported: ${plan.source.env_omitted.length} environment variable(s) whose names look like secrets (${plan.source.env_omitted.slice(0, 5).join(', ')}).`)
  }
  if (plan.errors.length) return plan

  const current = mounts.load()
  for (const key of SECTION_KEYS) {
    const def = SECTIONS[key]
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
    if (key === 'env') { const keep = Object.fromEntries(Object.entries(current.env).filter(([k]) => looksSecret(k))); (incoming.env as Record<string, string>) = { ...(incoming.env as object), ...keep } as Record<string, string> }
    const changed = !same(cur, incoming)
    const mirror = key === 'folders' ? [...Object.values(normalized.folders), ...normalized.custom.map((c) => c.local)].some((p) => p && mounts.inMirror(p)) : false
    plan.sections.push({
      key, label: def.label, changed, current: cur, incoming, machine_specific: !!def.machine, account_specific: !!def.account, default_checked: changed && !def.machine && !err, error: err,
      note: mirror ? 'A folder in this file points into Binc\'s read-only mirror: a run will not write there (it falls back to ~/ComfyUI-Shared in dev mode, and is refused in prod).' : def.machine ? 'Paths from another machine.' : def.account ? 'Ids that belong to the exporting RunPod account; they may not exist in yours.' : null,
    })
  }
  if (!plan.sections.length) plan.warnings.push('The file carries no settings this version can import.')
  plan.ok = true
  return plan
}

// ----- applying, backing up, undoing -----

interface Backup { at: string; mounts: mounts.MountsConfig; panama: { bucket: string; region: string; profile: string } }
export interface BackupInfo { file: string; name: string; at: string }
const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-')

export function listBackups(): BackupInfo[] {
  const dir = backupsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => /^mounts-.+\.json$/.test(n)).sort().reverse().map((name) => ({ file: join(dir, name), name, at: name.slice(7, -5) }))
}

function writeBackup(now = new Date()): string {
  const dir = backupsDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `mounts-${stamp(now)}.json`)
  const b: Backup = { at: now.toISOString(), mounts: mounts.load(), panama: panamaNow() }
  writeFileSync(file, JSON.stringify(b, null, 2) + '\n', { mode: 0o600 })
  for (const old of listBackups().slice(KEEP_BACKUPS)) { try { unlinkSync(old.file) } catch { /* a backup that cannot be pruned stays */ } }
  return file
}

const setPanama = (p: { bucket: string; region: string; profile: string }) => settings.set({ panama_bucket: p.bucket, panama_region: p.region, panama_profile: p.profile })

/** Write the checked sections. Everything is validated first; the current configuration is backed up; then it is saved through `mounts.put`. */
export function applyImport(file: unknown, opts: { sections: string[]; now?: Date }) {
  const plan = planImport(file)
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
    if (s.key === 'panama') continue
    for (const [f, v] of Object.entries(s.incoming as Record<string, unknown>)) next[f] = v
  }
  const cfg = mounts.validate(mounts.normalize(next as Partial<mounts.MountsConfig>))   // the panel's own check, on the merged result
  const panama = chosen.find((s) => s.key === 'panama')
  const backup = writeBackup(opts.now)
  const payload = mounts.put(cfg)
  if (panama) setPanama(panama.incoming as { bucket: string; region: string; profile: string })
  return { payload, backup, applied: chosen.map((s) => s.key), settings: settings.get() }
}

/** Put back the configuration as it was before the last import, and drop that backup so a second undo goes one step further. */
export function undoImport() {
  const last = listBackups()[0]
  if (!last) throw bad('Nothing to undo: there is no backup.')
  let b: Backup
  try { b = JSON.parse(readFileSync(last.file, 'utf8')) } catch (e) { throw bad(`${last.name} cannot be read: ${(e as Error).message}`) }
  const payload = mounts.put(b.mounts)
  if (b.panama) setPanama(b.panama)
  try { unlinkSync(last.file) } catch { /* it stays; harmless */ }
  return { payload, restored: last.name, settings: settings.get() }
}
