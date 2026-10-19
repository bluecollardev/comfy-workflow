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
import { folderShapes, shape } from './shape.js'

export const DEFAULT_IMAGE = () => process.env.COMFY_IMAGE || 'comfy-app:contract-v26'   // ours; pushed to a registry before a pod can pull it

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
  required: Record<string, boolean>
  image: string
  idle_stop_minutes: number
  dry_run: boolean
}
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
    required: Object.fromEntries(names.map((n) => [n, false])),
    image: DEFAULT_IMAGE(),
    idle_stop_minutes: 30,
    dry_run: false,
  }
}

const normalizeLink = (l: Partial<Link>): Link => ({ path: l.path ?? '', target: l.target ?? '', required: l.required ?? true, mode: l.mode || 'rw', what: l.what ?? '', folder: l.folder ?? '' })
const normalizeCustom = (c: Partial<CustomFolder>): CustomFolder => ({ name: c.name ?? '', local: c.local ?? '', container: c.container ?? '', link: c.link ?? '', mode: c.mode || 'rw' })

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
    idle_stop_minutes: data.idle_stop_minutes ?? d.idle_stop_minutes,
    dry_run: data.dry_run === true,
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

export interface PodOverrides { env: Record<string, string>; network_volume_id?: string; volume_mount_path?: string; data_center_id?: string }

/** What pod creation adds: RunPod volume fields and the env the image reads. */
export function podOverrides(cfg: MountsConfig): PodOverrides {
  const env = { ...podEnv(cfg), ...cfg.env }
  const links = allLinks(cfg)
  if (links.length) env.COMFY_LINKS = linksEnv(links)
  const out: PodOverrides = { env }
  if (cfg.network_volume_id) { out.network_volume_id = cfg.network_volume_id; out.volume_mount_path = cfg.mount_path || '/workspace' }
  if (cfg.data_center_id) out.data_center_id = cfg.data_center_id
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
  return cfg
}

/** Save after validating; returns the payload the panel shows. */
export function put(data: Partial<MountsConfig>) {
  const cfg = validate(normalize(data))
  save(cfg)
  return payload(cfg)
}

/** Shell lines for a runtime on this PC. */
export function envLines(cfg: MountsConfig): { env: Record<string, string>; sh: string } {
  const env = localEnv(cfg)
  return { env, sh: Object.entries(env).map(([k, v]) => `export ${k}=${JSON.stringify(v)}\n`).join('') }
}

export const basenameOf = (p: string) => basename(p.replace(/\/+$/, ''))
