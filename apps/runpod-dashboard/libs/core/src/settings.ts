/**
 * Settings that are secrets or machine-wide: the RunPod API key. Stored in
 * ~/.config/runpod-pod-manager/.env, the file the Electron shell and the deprecated Python
 * backend already read at start, so one place serves every runtime. Setting a key also puts it
 * in this process's environment, so the next RunPod call uses it without a restart.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bad } from './errors.js'
import { configDir } from './paths.js'

export const file = () => process.env.SETTINGS_ENV_FILE || join(configDir(), '.env')
const KEYS = ['RUNPOD_API_KEY', 'RUNPOD_S3_ACCESS_KEY', 'RUNPOD_S3_SECRET_KEY'] as const   // the S3 pair: uploads onto a volume with no pod (ADR-007 G)

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
  return { s3_keys_set: !!s3, s3_access_key_hint: hint(process.env.RUNPOD_S3_ACCESS_KEY || stored.RUNPOD_S3_ACCESS_KEY || ''), runpod_api_key_set: !!key, runpod_api_key_hint: hint(key), source: process.env.RUNPOD_API_KEY && !stored.RUNPOD_API_KEY ? 'environment' : stored.RUNPOD_API_KEY ? file() : 'none' }
}

/** Store a secret. An empty value leaves the stored one alone; `null` removes it. */
export function set(values: { runpod_api_key?: string | null; runpod_s3_access_key?: string | null; runpod_s3_secret_key?: string | null }) {
  const updates: Record<string, string> = {}
  for (const [field, name] of [['runpod_s3_access_key', 'RUNPOD_S3_ACCESS_KEY'], ['runpod_s3_secret_key', 'RUNPOD_S3_SECRET_KEY']] as const) {
    const v = values[field]
    if (v === null) updates[name] = ''
    else if (v && v.trim()) { if (/\s/.test(v.trim())) throw bad(`${name}: no spaces`); updates[name] = v.trim() }
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
