/**
 * Settings that are secrets or machine-wide: the RunPod API key (and the optional Anthropic key for writing adapters). Stored in
 * ~/.config/runpod-pod-manager/.env, the file the Electron shell and the deprecated Python
 * backend already read at start, so one place serves every runtime. Setting a key also puts it
 * in this process's environment, so the next RunPod call uses it without a restart.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bad } from './errors.js'
import { configDir } from './paths.js'

export const file = () => process.env.SETTINGS_ENV_FILE || join(configDir(), '.env')
/** The Panama exchange bucket the app is built to read (docs/ADR-016, ADR-021). Shown prefilled in Default Configuration; a value equal to its default is not stored. */
export const PANAMA_DEFAULTS = { bucket: 'bh-panama-exchange-610140802195', region: 'us-west-2', profile: 'panama' } as const
const PANAMA_PATTERNS = {
  bucket: [/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'a bucket name: lower case letters, digits, dots and hyphens, 3 to 63 characters'],
  region: [/^[a-z]{2}(-[a-z]+)+-\d$/, 'a region like us-west-2'],
  profile: [/^[A-Za-z0-9._-]{1,64}$/, 'an AWS profile name: letters, digits, dots, hyphens and underscores'],
} as const
/** The secrets this file holds, by the name they are stored under, and the field `set` takes them by (a configuration export carries these, docs/ADR-023). */
export const SECRET_FIELDS = {
  RUNPOD_API_KEY: 'runpod_api_key', RUNPOD_S3_ACCESS_KEY: 'runpod_s3_access_key', RUNPOD_S3_SECRET_KEY: 'runpod_s3_secret_key',
  PANAMA_AWS_ACCESS_KEY_ID: 'panama_aws_access_key', PANAMA_AWS_SECRET_ACCESS_KEY: 'panama_aws_secret_key', PANAMA_CONSOLE_KEY: 'panama_console_key', ANTHROPIC_API_KEY: 'anthropic_api_key',
} as const
export type SecretName = keyof typeof SECRET_FIELDS
export const SECRET_NAMES_LIST = Object.keys(SECRET_FIELDS) as SecretName[]
const MIN_LENGTH: Partial<Record<SecretName, number>> = { RUNPOD_API_KEY: 16, ANTHROPIC_API_KEY: 20, PANAMA_CONSOLE_KEY: 8 }

/** Whether `set` would accept this secret (null), or why not. The reason names the key and never contains the value. */
export function checkSecret(name: string, v: unknown): string | null {
  if (!(name in SECRET_FIELDS)) return `${name} is not a key this app stores`
  if (typeof v !== 'string') return `${name} must be text`
  const t = v.trim()
  if (!t) return `${name} is empty`
  if (/\s/.test(t)) return `${name} must not contain spaces`
  const min = MIN_LENGTH[name as SecretName]
  if (min && t.length < min) return `${name} is too short (at least ${min} characters)`
  return null
}

/** The stored secrets, by name: only those set (the environment first, then the file, as `lookup`). */
export function secretValues(): Partial<Record<SecretName, string>> {
  const out: Partial<Record<SecretName, string>> = {}
  for (const n of SECRET_NAMES_LIST) { const v = lookup(n); if (v) out[n] = v }
  return out
}

/** The secrets in the settings FILE only (not the environment): what an Undo puts back. */
export function storedSecretValues(): Partial<Record<SecretName, string>> {
  const stored = readEnvFile(), out: Partial<Record<SecretName, string>> = {}
  for (const n of SECRET_NAMES_LIST) if (stored[n]) out[n] = stored[n]
  return out
}

/** Put the secrets back EXACTLY as they were (those absent are removed), with no length check: they were already stored. Only Undo uses this. */
export function restoreSecrets(values: Partial<Record<SecretName, string>>): void {
  const updates: Record<string, string> = {}
  for (const n of SECRET_NAMES_LIST) updates[n] = values[n] ?? ''
  writeEnvFile(updates)
  for (const n of SECRET_NAMES_LIST) { if (updates[n]) process.env[n] = updates[n]; else delete process.env[n] }
}

/** Set (a string) or remove (null) several secrets at once, through `set`'s own checks. */
export function setSecrets(values: Partial<Record<SecretName, string | null>>) {
  const args: Record<string, string | null> = {}
  for (const [n, v] of Object.entries(values)) if (n in SECRET_FIELDS && v !== undefined) args[SECRET_FIELDS[n as SecretName]] = v
  return set(args)
}

/** Whether a Panama bucket, region or profile value would be accepted by `set` (null) or why not; changes nothing. Used to preview a configuration import. */
export function checkPanama(key: 'bucket' | 'region' | 'profile', v: unknown): string | null {
  if (typeof v !== 'string') return `Panama ${key} must be text`
  const t = v.trim()
  if (!t || t === PANAMA_DEFAULTS[key]) return null
  const [re, what] = PANAMA_PATTERNS[key]
  return re.test(t) ? null : `Panama ${key}: ${t.slice(0, 80)} is not ${what}`
}
const KEYS = ['PANAMA_S3_BUCKET', 'PANAMA_S3_REGION', 'PANAMA_S3_PROFILE', 'RUNPOD_API_KEY', 'RUNPOD_S3_ACCESS_KEY', 'RUNPOD_S3_SECRET_KEY', 'ANTHROPIC_API_KEY', 'PANAMA_CONSOLE_KEY', 'PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY'] as const   // ANTHROPIC_API_KEY: only for "Write an adapter with Claude" (ADR-008); optional   // the S3 pair: uploads onto a volume with no pod (ADR-007 G)

function readEnvFile(): Record<string, string> {
  const f = file()
  if (!existsSync(f)) return {}
  const out: Record<string, string> = {}
  for (const raw of readFileSync(f, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

function writeEnvFile(values: Record<string, string>) {
  const f = file()
  mkdirSync(dirname(f), { recursive: true })
  const lines = existsSync(f) ? readFileSync(f, 'utf8').split('\n') : []
  const done = new Set<string>()
  const out = lines.map((raw) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw)
    if (m && m[1] in values) { done.add(m[1]); return `${m[1]}=${values[m[1]]}` }
    return raw
  })
  for (const [k, v] of Object.entries(values)) if (!done.has(k)) out.push(`${k}=${v}`)
  writeFileSync(f, out.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 })
}

/** One value by name, the environment first, then the file: how the CLI finds the RunPod key and the sync finds the S3 keys. */
export const lookup = (name: string): string => process.env[name] || readEnvFile()[name] || ''

const hint = (v: string) => (v ? `••••${v.slice(-4)}` : '')

/** What the panel shows: whether each secret is set and its last four characters, never the value. */
export function get() {
  const stored = readEnvFile()
  const key = process.env.RUNPOD_API_KEY || stored.RUNPOD_API_KEY || ''
  const s3 = (process.env.RUNPOD_S3_ACCESS_KEY || stored.RUNPOD_S3_ACCESS_KEY || '') && (process.env.RUNPOD_S3_SECRET_KEY || stored.RUNPOD_S3_SECRET_KEY || '')
  const claude = process.env.ANTHROPIC_API_KEY || stored.ANTHROPIC_API_KEY || ''
  const panama = process.env.PANAMA_CONSOLE_KEY || stored.PANAMA_CONSOLE_KEY || ''
  const awsId = process.env.PANAMA_AWS_ACCESS_KEY_ID || stored.PANAMA_AWS_ACCESS_KEY_ID || ''
  const awsSecret = process.env.PANAMA_AWS_SECRET_ACCESS_KEY || stored.PANAMA_AWS_SECRET_ACCESS_KEY || ''
  const eff = (name: string, d: string) => process.env[name] || stored[name] || d
  const panamaCfg = { panama_bucket: eff('PANAMA_S3_BUCKET', PANAMA_DEFAULTS.bucket), panama_region: eff('PANAMA_S3_REGION', PANAMA_DEFAULTS.region), panama_profile: eff('PANAMA_S3_PROFILE', PANAMA_DEFAULTS.profile), panama_defaults: { ...PANAMA_DEFAULTS } }
  return { ...panamaCfg, panama_aws_keys_set: !!(awsId && awsSecret), panama_aws_access_key_hint: hint(awsId), panama_console_key_set: !!panama, panama_console_key_hint: hint(panama), anthropic_key_set: !!claude, anthropic_key_hint: hint(claude), s3_keys_set: !!s3, s3_access_key_hint: hint(process.env.RUNPOD_S3_ACCESS_KEY || stored.RUNPOD_S3_ACCESS_KEY || ''), runpod_api_key_set: !!key, runpod_api_key_hint: hint(key), source: process.env.RUNPOD_API_KEY && !stored.RUNPOD_API_KEY ? 'environment' : stored.RUNPOD_API_KEY ? file() : 'none' }
}

/** Store a secret. An empty value leaves the stored one alone; `null` removes it. */
export function set(values: { panama_bucket?: string | null; panama_region?: string | null; panama_profile?: string | null; anthropic_api_key?: string | null; runpod_api_key?: string | null; runpod_s3_access_key?: string | null; runpod_s3_secret_key?: string | null; panama_console_key?: string | null; panama_aws_access_key?: string | null; panama_aws_secret_key?: string | null }) {
  const updates: Record<string, string> = {}
  // The bucket, region and profile: ordinary settings, not secrets. A value equal to the built-in default (or empty, or null) removes the override.
  for (const [field, key, name] of [['panama_bucket', 'bucket', 'PANAMA_S3_BUCKET'], ['panama_region', 'region', 'PANAMA_S3_REGION'], ['panama_profile', 'profile', 'PANAMA_S3_PROFILE']] as const) {
    const v = (values as Record<string, string | null | undefined>)[field]
    if (v === undefined) continue
    const t = (v ?? '').trim()
    if (!t || t === PANAMA_DEFAULTS[key]) { updates[name] = ''; continue }
    const [re, what] = PANAMA_PATTERNS[key]
    if (!re.test(t)) throw bad(`${name}: ${t} is not ${what}`)
    updates[name] = t
  }
  for (const [field, name] of [['runpod_s3_access_key', 'RUNPOD_S3_ACCESS_KEY'], ['runpod_s3_secret_key', 'RUNPOD_S3_SECRET_KEY']] as const) {
    const v = values[field]
    if (v === null) updates[name] = ''
    else if (v && v.trim()) { if (/\s/.test(v.trim())) throw bad(`${name}: no spaces`); updates[name] = v.trim() }
  }
  for (const [field, name] of [['panama_aws_access_key', 'PANAMA_AWS_ACCESS_KEY_ID'], ['panama_aws_secret_key', 'PANAMA_AWS_SECRET_ACCESS_KEY']] as const) {
    const v = values[field]
    if (v === null) updates[name] = ''
    else if (v && v.trim()) { if (/\s/.test(v.trim())) throw bad(`${name}: no spaces`); updates[name] = v.trim() }
  }
  if (values.panama_console_key === null) updates.PANAMA_CONSOLE_KEY = ''
  else if (values.panama_console_key && values.panama_console_key.trim()) {
    const v = values.panama_console_key.trim()
    if (/\s/.test(v) || v.length < 8) throw bad('That does not look like a console key (no spaces)')
    updates.PANAMA_CONSOLE_KEY = v
  }
  if (values.anthropic_api_key === null) updates.ANTHROPIC_API_KEY = ''
  else if (values.anthropic_api_key && values.anthropic_api_key.trim()) {
    const v = values.anthropic_api_key.trim()
    if (/\s/.test(v) || v.length < 20) throw bad('That does not look like an Anthropic API key (no spaces, at least 20 characters)')
    updates.ANTHROPIC_API_KEY = v
  }
  if (values.runpod_api_key === null) updates.RUNPOD_API_KEY = ''
  else if (values.runpod_api_key) {
    const v = values.runpod_api_key.trim()
    if (/\s/.test(v) || v.length < 16) throw bad('That does not look like a RunPod API key (no spaces, at least 16 characters)')
    updates.RUNPOD_API_KEY = v
  }
  if (Object.keys(updates).length) {
    writeEnvFile(updates)
    for (const k of KEYS) if (k in updates) { if (updates[k]) process.env[k] = updates[k]; else delete process.env[k] }
  }
  return get()
}

/** Put the stored secrets into this process's environment where it carries none: what the MCP server and the
 *  CLI do at start, so the key the panel saved serves them too, without a shell exporting it. */
export function applyToEnv(): void {
  const stored = readEnvFile()
  for (const k of KEYS) if (!process.env[k] && stored[k]) process.env[k] = stored[k]
}

/** Where the Anthropic API is: the real one, or ANTHROPIC_API_URL (a stand-in for tests). */
export const anthropicBase = () => (process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com').replace(/\/+$/, '')

/** Does an Anthropic key work? The one given (a key typed in the panel, not stored), else the stored one. One cheap call (GET /v1/models, one row). Never throws: { ok, error? }. `fetchImpl` is for tests. */
export async function checkAnthropic(typed: string | null = null, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  const key = (typed || '').trim() || lookup('ANTHROPIC_API_KEY')
  if (!key) return { ok: false, error: 'No Anthropic API key is set' }
  if (/\s/.test(key) || /[^\x20-\x7e]/.test(key)) return { ok: false, error: 'That does not look like an Anthropic API key (no spaces or odd characters)' }
  try {
    const res = await fetchImpl(`${anthropicBase()}/v1/models?limit=1`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    return { ok: false, error: `Anthropic answered ${res.status}: ${body.error?.message || 'no detail'}` }
  } catch (e) { return { ok: false, error: `Could not reach Anthropic: ${(e as Error).message}` } }
}
