/**
 * Mount configuration: the three folders on this PC that every runtime needs, and how a pod gets them.
 *
 * The app runs on one PC. On each PC the user maps three folders, anywhere on its disks: the
 * project tree, the served plates and ComfyUI-Shared. That mapping is the whole configuration
 * (~/.config/runpod-pod-manager/mounts.json). Everything else is derived: on this PC the folders
 * are used where they are through PROJECT_ROOT, PLATES_ROOT and COMFY_SHARED; on a pod the network
 * volume carries them at fixed places under the mount path, the same env points at them, and the
 * paths the project's own files declare (the job files' root line, the shots' SOURCES.csv, the
 * structure master) are linked onto them by the image's entrypoint (COMFY_LINKS).
 *
 * Same file formats and the same derivations as the Python module it replaces (docs/ADR-005).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { bad, CoreError } from './errors.js'
import { mirrorDir, mountsFile } from './paths.js'
import * as history from './history.js'
import * as settings from './settings.js'
import { folderShapes, shape } from './shape.js'

/** The ComfyUI-Shared subfolders a push can carry, in the order the panel shows them; and what carries by default: not `output`, which pods write and a push of it only sends the PC's own old renders up. */
export const SYNC_SHARED = ['input', 'models', 'output', 'workflows'] as const
export const SYNC_SHARED_DEFAULT = ['input', 'models', 'workflows'] as const
export const PULL_SHARED_DEFAULT = ['output'] as const
/** The pod image selected by default (ADR-020, ADR-024): ours, on GitHub's registry, built by Actions. A pod cannot pull a bare local name, so the default is the registry reference;
 *  COMFY_IMAGE overrides it, and an image saved in the Default Configuration wins over both. */
export const DEFAULT_IMAGE_REF = 'ghcr.io/bluecollardev/comfy-app:contract-v26'
export const DEFAULT_IMAGE = () => process.env.COMFY_IMAGE || DEFAULT_IMAGE_REF

export interface Link { path: string; target: string; required: boolean; mode: string; what: string; folder: string }
export interface CustomFolder { name: string; local: string; container: string; link: string; mode: string }
export interface MountsConfig {
  folders: Record<string, string>
  custom: CustomFolder[]
  network_volume_id: string
  mount_path: string
  data_center_id: string
  links: Link[]
  env: Record<string, string>
  apply_by_default: boolean
  /** Pull pods (the Pod download of a round, ADR-022/024) may take any NVIDIA card RunPod has free in the volume's datacenter, not only the table's ten; a pull needs no GPU. Default on. */
  pull_any_card: boolean
  /** Round import (ADR-038): how many pool pods one import may run at once, the dollar cap on one import's estimate, and whether those two limits apply at all (the governance cap does not depend on this). */
  import_max_pods: number
  import_cost_cap_usd: number
  import_cap_enabled: boolean
  required: Record<string, boolean>
  image: string
  registry_auth_id: string   // RunPod's saved credential for a private registry (saveRegistryAuth); '' for a public image
  idle_stop_minutes: number
  pull_shared: string[]      // which ComfyUI-Shared subfolders a pull brings back down (default: output)
  sync_shared: string[]      // which ComfyUI-Shared subfolders a push carries: input, models, output, workflows (a pod's own configuration can differ from the default)
  sync_parallel: number      // rsync streams at a time on a push (1..16); the uplink is the limit, streams keep it full across small files
  dry_run: boolean
  mcp_http: McpHttp          // the MCP servers the app itself serves over HTTP on 127.0.0.1 (Connect › MCP); off by default
}
export interface McpHttpEntry { enabled: boolean; port: number }
export type McpHttp = Record<'pod-manager' | 'comfy-bridge', McpHttpEntry>
export const MCP_HTTP_PORTS = { 'pod-manager': 8765, 'comfy-bridge': 8766 } as const
export const mcpHttpDefaults = (): McpHttp => ({ 'pod-manager': { enabled: false, port: MCP_HTTP_PORTS['pod-manager'] }, 'comfy-bridge': { enabled: false, port: MCP_HTTP_PORTS['comfy-bridge'] } })
export interface Declared { path: string; source: string; count: number }
export interface FolderRow {
  key: string; what: string; mode: string; required: boolean; custom?: boolean
  local: string; exists: boolean; mirror: boolean
  container: string; env_key: string; env_keys: string[]; declared: Declared | null
}

// ----- mode and what is required -----

/** No-spend mode: pods are simulated, nothing reaches RunPod. The configuration's switch, or RUNPOD_DRY_RUN=1. */
export const dryRun = (cfg?: MountsConfig): boolean => process.env.RUNPOD_DRY_RUN === '1' || !!cfg?.dry_run

/** COMFY_MODE: `dev` (default; a local run) or `prod` (every required folder must be mapped). */
export const mode = (): 'dev' | 'prod' => ((process.env.COMFY_MODE || 'dev').trim().toLowerCase() === 'prod' ? 'prod' : 'dev')

/** Who decides which folders are required: prod (all), env (COMFY_REQUIRE is set), or config (the panel's toggles). */
export function requireSource(): 'prod' | 'env' | 'config' {
  if (mode() === 'prod') return 'prod'
  return (process.env.COMFY_REQUIRE || '').trim() ? 'env' : 'config'
}

/** Which of the three folders must be mapped. Prod: all. Dev: COMFY_REQUIRE when set (`project,plates,comfy-shared`,
 *  `all`, `none`), else the toggles saved in the configuration, off by default: no plates on a dev machine yet. */
export function requiredKeys(cfg?: MountsConfig): Set<string> {
  const keys = new Set(folderShapes().map((m) => m.name))
  const src = requireSource()
  if (src === 'prod') return keys
  if (src === 'env') {
    const raw = (process.env.COMFY_REQUIRE || '').trim().toLowerCase()
    if (raw === 'all') return keys
    if (raw === 'none') return new Set()
    return new Set(raw.split(',').map((k) => k.trim()).filter((k) => keys.has(k)))
  }
  return new Set([...keys].filter((k) => cfg?.required?.[k] === true))
}

// ----- the configuration file -----

export function defaults(): MountsConfig {
  const names = folderShapes().map((m) => m.name)
  return {
    folders: Object.fromEntries(names.map((n) => [n, ''])),
    custom: [],
    network_volume_id: '',
    mount_path: '/workspace',
    data_center_id: '',
    links: [],
    env: {},
    apply_by_default: true,
    pull_any_card: true,
    import_max_pods: 2,
    import_cost_cap_usd: 50,
    import_cap_enabled: true,
    required: Object.fromEntries(names.map((n) => [n, false])),
    image: DEFAULT_IMAGE(),
    registry_auth_id: '',
    idle_stop_minutes: 30,
    sync_parallel: 8,   // streams at a time: the uplink is the limit and more streams keep it full across many small files (was 4)
    sync_shared: [...SYNC_SHARED_DEFAULT],
    pull_shared: [...PULL_SHARED_DEFAULT],
    dry_run: false,
    mcp_http: mcpHttpDefaults(),
  }
}

const normalizeLink = (l: Partial<Link>): Link => ({ path: l.path ?? '', target: l.target ?? '', required: l.required ?? true, mode: l.mode || 'rw', what: l.what ?? '', folder: l.folder ?? '' })
const normalizeCustom = (c: Partial<CustomFolder>): CustomFolder => ({ name: c.name ?? '', local: c.local ?? '', container: c.container ?? '', link: c.link ?? '', mode: c.mode || 'rw' })

/** mcp_http from any JSON: both endpoints present; a port that is not a whole number falls back to the default (validate() refuses it on a save). */
function normalizeMcpHttp(raw: unknown): McpHttp {
  const d = mcpHttpDefaults()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Partial<McpHttpEntry> | undefined>
  for (const id of Object.keys(d) as (keyof McpHttp)[]) {
    const e = r[id]
    if (e && typeof e === 'object') d[id] = { enabled: e.enabled === true, port: e.port === undefined ? d[id].port : (e.port as number) }
  }
  return d
}

/** A config from any JSON, with every field present (the Python model's defaults). */
export function normalize(data: Partial<MountsConfig>): MountsConfig {
  const d = defaults()
  return {
    ...d,
    ...data,
    folders: { ...d.folders, ...(data.folders || {}) },
    custom: (data.custom || []).map(normalizeCustom),
    links: (data.links || []).map(normalizeLink),
    env: { ...(data.env || {}) },
    required: { ...d.required, ...(data.required || {}) },
    image: data.image ?? d.image,
    registry_auth_id: (data.registry_auth_id ?? '').trim(),
    idle_stop_minutes: data.idle_stop_minutes ?? d.idle_stop_minutes,
    sync_parallel: data.sync_parallel ?? d.sync_parallel,
    pull_shared: Array.isArray(data.pull_shared) ? SYNC_SHARED.filter((x) => data.pull_shared!.includes(x)) : d.pull_shared,
    sync_shared: Array.isArray(data.sync_shared) ? SYNC_SHARED.filter((x) => data.sync_shared!.includes(x)) : d.sync_shared,
    pull_any_card: data.pull_any_card !== false,   // absent means on
    import_max_pods: Number.isInteger(data.import_max_pods) && (data.import_max_pods as number) >= 1 && (data.import_max_pods as number) <= 20 ? data.import_max_pods as number : 2,
    import_cost_cap_usd: typeof data.import_cost_cap_usd === 'number' && data.import_cost_cap_usd > 0 ? data.import_cost_cap_usd : 50,
    import_cap_enabled: data.import_cap_enabled !== false,   // absent means the cap is on
    dry_run: data.dry_run === true,
    mcp_http: normalizeMcpHttp(data.mcp_http),
  }
}

export function load(): MountsConfig {
  const file = mountsFile()
  if (!existsSync(file)) return defaults()
  let data: Partial<MountsConfig> & { links?: Partial<Link>[] }
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new CoreError(500, `${file} is not a valid mounts config: ${(e as Error).message}`)
  }
  if (!('folders' in data)) {   // a file from before the folder mapping: its links were the derived ones, now derived again
    const containers = new Set([...folderShapes().map((m) => m.container as string), '/workspace/CANALV2'])
    data.links = (data.links || []).filter((l) => !containers.has(l.target ?? ''))
  }
  return normalize(data)
}

export function save(cfg: MountsConfig): void {
  const file = mountsFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
}

export function reset(): MountsConfig {
  const file = mountsFile()
  if (existsSync(file)) unlinkSync(file)
  return defaults()
}

export const stored = () => existsSync(mountsFile())

// ----- what the project tree declares about its own paths -----

const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }
const readText = (p: string) => { try { return readFileSync(p, 'utf8') } catch { return '' } }

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1)
  let best: string | null = null, n = 0
  for (const [v, c] of counts) if (c > n) { best = v; n = c }
  return best
}

const entries = (dir: string) => { try { return readdirSync(dir, { withFileTypes: true }) } catch { return [] } }   // unreadable: skipped, never fatal

function walk(dir: string, out: string[] = []): string[] {
  for (const e of entries(dir)) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out); else out.push(p)
  }
  return out
}

/** True when a mapped folder points into Binc's mirror, where a run must not write. */
export function inMirror(local: string): boolean {
  if (!local) return false
  try {
    const target = resolve(local), mirror = resolve(mirrorDir())
    return target === mirror || target.startsWith(mirror + '/')
  } catch { return false }
}

/** The path the tree calls itself: the job files' `root:` line, else the structure master's `Root:`. */
export function declaredRoot(tree: string): Declared | null {
  const queue = join(tree, '04_TRACKER', 'queue')
  const roots: string[] = []
  if (isDir(queue)) {
    for (const f of walk(queue).filter((p) => p.endsWith('.md')).sort()) {
      for (const line of readText(f).split('\n')) {
        const m = /^root:\s*(\S+)/.exec(line)
        if (m) { roots.push(m[1].replace(/\/+$/, '')); break }
      }
    }
  }
  if (roots.length) return { path: mostCommon(roots) as string, source: "the tree's job files", count: roots.length }
  const policy = join(tree, '00_POLICY')
  if (isDir(policy)) {
    const masters = entries(policy).map((e) => e.name).filter((n) => /^structure_v.*\.md$/.test(n)).sort().reverse()
    for (const n of masters) {
      const m = /Root:\s*`([^`]+)`/.exec(readText(join(policy, n)))
      if (m) return { path: m[1].replace(/\/+$/, ''), source: "the tree's structure page", count: 1 }
    }
  }
  return null
}

/** A minimal CSV reader for SOURCES.csv: header row, comma separated, quotes honoured. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row) }
  const [header, ...body] = rows.filter((r) => r.length > 1 || (r[0] ?? '') !== '')
  if (!header) return []
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

/** The folder the shots' SOURCES.csv link their plates from: two levels above each eye folder. */
export function declaredPlates(tree: string): Declared | null {
  const found: string[] = []
  if (!isDir(tree)) return null
  for (const type of entries(tree).filter((e) => e.isDirectory())) {
    const typeDir = join(tree, type.name)
    for (const shot of entries(typeDir).filter((e) => e.isDirectory())) {
      const f = join(typeDir, shot.name, '02_SOURCE', 'SOURCES.csv')
      if (!existsSync(f)) continue
      for (const row of parseCsv(readText(f))) {
        const loc = (row.location || '').replace(/\/+$/, '')
        if (row.role === 'plate' && loc.startsWith('/')) found.push(dirname(dirname(loc)))
      }
    }
  }
  if (!found.length) return null
  return { path: mostCommon(found) as string, source: "the shots' source lists", count: found.length }
}

/** ComfyUI-Shared is `~/ComfyUI-Shared` on the tree's machine (structure master, systems page). */
export function declaredShared(root: string | null): Declared | null {
  const parts = (root || '').split('/')
  if (parts.length > 3 && parts[1] === 'home') return { path: `/home/${parts[2]}/ComfyUI-Shared`, source: "the tree's structure page", count: 1 }
  return null
}

/** Per folder key, the path the project's files name for it, read from the mapped project tree. */
export function declared(cfg: MountsConfig): Record<string, Declared | null> {
  const out: Record<string, Declared | null> = Object.fromEntries(folderShapes().map((m) => [m.name, null]))
  const tree = cfg.folders.project || ''
  if (!tree || !isDir(tree)) return out
  const root = declaredRoot(tree)
  out.project = root
  out.plates = declaredPlates(tree)
  out['comfy-shared'] = declaredShared(root ? root.path : null)
  return out
}

// ----- what a runtime receives -----

/** One row per folder for the panel: what it is, where it is on this PC, where a pod has it, what the project calls it. */
export function folderRows(cfg: MountsConfig): FolderRow[] {
  const dec = declared(cfg)
  const req = requiredKeys(cfg)
  const rows: FolderRow[] = folderShapes().map((m) => {
    const local = cfg.folders[m.name] || ''
    const envKeys = Object.keys(m.env || {})
    return {
      key: m.name, what: m.what || '', mode: m.mode || 'rw', required: req.has(m.name),
      local, exists: !!local && isDir(local), mirror: inMirror(local),
      container: m.container as string, env_key: envKeys[0] || '', env_keys: envKeys, declared: dec[m.name] ?? null,
    }
  })
  const base = (cfg.mount_path || '/workspace').replace(/\/+$/, '')
  for (const c of cfg.custom) {
    rows.push({
      key: c.name, what: '', mode: c.mode || 'rw', required: false, custom: true,
      local: c.local, exists: !!c.local && isDir(c.local), mirror: inMirror(c.local),
      container: c.container || `${base}/${c.name}`, env_key: '', env_keys: [],
      declared: c.link ? { path: c.link, source: 'the path typed here', count: 1 } : null,
    })
  }
  return rows
}

/** The links a pod makes: each declared path onto its folder's place on the volume, then the hand-added ones. */
export function allLinks(cfg: MountsConfig): Link[] {
  const links: Link[] = []
  for (const r of folderRows(cfg)) {
    if (r.declared) links.push({ path: r.declared.path, target: r.container, required: r.required, mode: r.mode, what: r.what, folder: r.key })
  }
  return [...links, ...cfg.links]
}

/** Env for a runtime on this PC: each folder's variable set to the local folder (launch.sh, compose.yml). */
export function localEnv(cfg: MountsConfig): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of folderRows(cfg)) if (r.local) for (const k of r.env_keys) out[k] = r.local
  return out
}

/** Env for a pod: each folder's variable set to its place on the volume. */
export function podEnv(cfg: MountsConfig): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of folderRows(cfg)) for (const k of r.env_keys) out[k] = r.container
  return out
}

/** COMFY_LINKS: 'path=target;path=target'. Paths may contain spaces; they may not contain ';' or '='. */
export function linksEnv(links: Link[]): string {
  const badOnes = links.filter((l) => /[;=]/.test(l.path) || /[;=]/.test(l.target)).map((l) => l.path)
  if (badOnes.length) throw bad(`';' and '=' cannot appear in a link: ${JSON.stringify(badOnes)}`)
  return links.map((l) => `${l.path}=${l.target}`).join(';')
}

export interface PodOverrides { env: Record<string, string>; network_volume_id?: string; volume_mount_path?: string; data_center_id?: string; registry_auth_id?: string }

/** What pod creation adds: RunPod volume fields and the env the image reads. */
export function podOverrides(cfg: MountsConfig): PodOverrides {
  const env = { ...podEnv(cfg), ...cfg.env }
  const links = allLinks(cfg)
  if (links.length) env.COMFY_LINKS = linksEnv(links)
  // S3_PULL (the image pulls from a bucket at start, ADR-015): give the pod the Panama keys the app holds, so nothing is typed twice.
  // They sit in the pod's environment on RunPod; a read-only key (the panama-pod one) is the point.
  if (env.S3_PULL?.trim() && !env.AWS_ACCESS_KEY_ID) {
    const id = settings.lookup('PANAMA_AWS_ACCESS_KEY_ID'), secret = settings.lookup('PANAMA_AWS_SECRET_ACCESS_KEY')
    if (id && secret) { env.AWS_ACCESS_KEY_ID = id; env.AWS_SECRET_ACCESS_KEY = secret; env.AWS_REGION ||= settings.lookup('PANAMA_S3_REGION') || 'us-west-2' }
  }
  const out: PodOverrides = { env }
  if (cfg.network_volume_id) { out.network_volume_id = cfg.network_volume_id; out.volume_mount_path = cfg.mount_path || '/workspace' }
  if (cfg.data_center_id) out.data_center_id = cfg.data_center_id
  if (cfg.registry_auth_id) out.registry_auth_id = cfg.registry_auth_id
  return out
}

/** Required folders (COMFY_REQUIRE, by mode) not mapped on this PC, by key. */
export const missingRequired = (cfg: MountsConfig): string[] => folderRows(cfg).filter((r) => r.required && !r.local).map((r) => r.key)

/** What the panel and the pod form read: the config, the mode, the rows, the links, what each runtime receives. */
export function payload(cfg: MountsConfig) {
  const sh = shape()
  return {
    config: cfg,
    mode: mode(),
    dry_run: dryRun(cfg),
    dry_run_forced: process.env.RUNPOD_DRY_RUN === '1',   // no-spend mode is on because of the environment: the switch cannot turn it off
    require: [...requiredKeys(cfg)].sort(),
    require_source: requireSource(),
    stored: stored(),
    store: mountsFile(),
    folders: folderRows(cfg),
    links: allLinks(cfg),
    local_env: localEnv(cfg),
    preview: podOverrides(cfg),
    catalog: { principle: sh.principle || '', runtimes: sh.runtimes || {} },
  }
}

/** The checks a save runs (the Python PUT): absolute folders, one-word unique custom names, no separators in links. */
export function validate(cfg: MountsConfig): MountsConfig {
  for (const [key, local] of [...Object.entries(cfg.folders), ...cfg.custom.map((c) => [c.name, c.local] as const)]) {
    if (local && !local.startsWith('/')) throw bad(`${key}: a folder is an absolute path on this PC, not ${JSON.stringify(local)}`)
  }
  const seen = new Set(Object.keys(cfg.folders))
  for (const c of cfg.custom) {
    if (!c.name.trim() || c.name.includes('/') || seen.has(c.name)) throw bad(`custom folder: a name is one word, not already used, not ${JSON.stringify(c.name)}`)
    seen.add(c.name)
    if (c.container && !c.container.startsWith('/')) throw bad(`${c.name}: the pod path is absolute, not ${JSON.stringify(c.container)}`)
  }
  linksEnv(allLinks(cfg))
  if (cfg.idle_stop_minutes < 0) throw bad('idle_stop_minutes is 0 (never) or a number of minutes')
  if (!Number.isInteger(cfg.sync_parallel) || cfg.sync_parallel < 1 || cfg.sync_parallel > 16) throw bad('sync_parallel is a whole number of parallel uploads, 1 to 16')
  const ports = new Set<number>()
  for (const [id, e] of Object.entries(cfg.mcp_http)) {
    if (!Number.isInteger(e.port) || e.port < 1024 || e.port > 65535) throw bad(`mcp_http.${id}.port is a whole number from 1024 to 65535, not ${JSON.stringify(e.port)}`)
    if (ports.has(e.port)) throw bad(`mcp_http: the two endpoints cannot share port ${e.port}`)
    ports.add(e.port)
  }
  return cfg
}

/** The payload for a configuration that is not saved: a pod's own configuration being edited. Validates it. */
export function preview(data: Partial<MountsConfig>) {
  return payload(validate(normalize(data)))
}

/** Save after validating; returns the payload the panel shows. */
export function put(data: Partial<MountsConfig>, opts: { quiet?: boolean } = {}) {
  const cfg = validate(normalize(data))
  save(cfg)
  if (!opts.quiet) history.record({ kind: 'change', area: 'configuration', action: 'saved', what: 'Default Configuration' })
  return payload(cfg)
}

/** Shell lines for a runtime on this PC. */
export function envLines(cfg: MountsConfig): { env: Record<string, string>; sh: string } {
  const env = localEnv(cfg)
  return { env, sh: Object.entries(env).map(([k, v]) => `export ${k}=${JSON.stringify(v)}\n`).join('') }
}

export const basenameOf = (p: string) => basename(p.replace(/\/+$/, ''))
