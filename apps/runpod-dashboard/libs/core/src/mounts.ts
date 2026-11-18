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
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { bad, CoreError } from './errors.js'
import { mirrorDir, mountsFile } from './paths.js'
import * as wanted from './wanted.js'
import * as gpus from './gpus.js'
import * as history from './history.js'
import * as settings from './settings.js'
import { folderShapes, shape } from './shape.js'

/** The ComfyUI-Shared subfolders a push can carry, in the order the panel shows them; and what carries by default: not `output`, which pods write and a push of it only sends the PC's own old renders up. */
export const SYNC_SHARED = ['input', 'models', 'output', 'workflows'] as const
export const SYNC_SHARED_DEFAULT = ['input', 'models', 'workflows'] as const
export const PULL_SHARED_DEFAULT = ['output'] as const
/** The pod image selected by default (ADR-020, ADR-024): ours, on GitHub's registry, built by Actions. A pod cannot pull a bare local name, so the default is the registry reference;
 *  COMFY_IMAGE overrides it, and an image saved in the Default Configuration wins over both. */
/** Pinned by digest (ADR-020 amendment 2026-11-15): the contract-v26 tag is re-pushed on every rebuild, a digest is not. Bump it with a release when a new build is trusted. */
export const DEFAULT_IMAGE_REF = 'ghcr.io/bluecollardev/comfy-app@sha256:c0b6ec76db493318d0b28b5e9905523abe0cfb2246baca92326044dc462d5969'
export const DEFAULT_IMAGE = () => process.env.COMFY_IMAGE || DEFAULT_IMAGE_REF

export interface Link { path: string; target: string; required: boolean; mode: string; what: string; folder: string }
export interface CustomFolder { name: string; local: string; container: string; link: string; mode: string }
/** Auto sync for the pods a configuration creates (docs/ADR-046): applied to each new pod right after it is created. Turning it on needs the name of who says yes. */
export interface AutoSyncConfig { enabled: boolean; pull: boolean; push: boolean; approved_by: string }
export const AUTO_SYNC_DEFAULT: AutoSyncConfig = { enabled: false, pull: true, push: false, approved_by: '' }
export const normalizeAutoSync = (v: unknown): AutoSyncConfig => {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<AutoSyncConfig>
  return { enabled: o.enabled === true, pull: o.pull === undefined ? true : o.pull === true, push: o.push === true, approved_by: typeof o.approved_by === 'string' ? o.approved_by.trim() : '' }
}
/** How DPX sequences are rendered into mp4 for playback and review (docs/ADR-048): where, which kind, the sizes, the codecs, the frame rate, whether the proxies are pulled to this PC. NEVER holds an approver or an allow_partial default: a review needs a named yes on each run, and partial is chosen per run. */
export interface RenderSettings { where: 'auto' | 'pod' | 'local'; kind: 'proxy' | 'review'; proxy_width: 'source' | 960 | 1280 | 1920; review_width: 'source' | 960 | 1280 | 1920; codecs: ('h264' | 'prores422hq')[]; fps: 'auto' | number; pull: boolean }
export const RENDER_DEFAULT: RenderSettings = { where: 'auto', kind: 'proxy', proxy_width: 'source', review_width: 'source', codecs: ['prores422hq'], fps: 'auto', pull: true }
export const RENDER_WIDTHS = ['source', 960, 1280, 1920] as const
export const RENDER_CODECS = ['h264', 'prores422hq'] as const
export function normalizeRender(v: unknown): RenderSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>, d = RENDER_DEFAULT
  const width = (x: unknown, dflt: RenderSettings['proxy_width']) => ((RENDER_WIDTHS as readonly unknown[]).includes(x) ? x : (RENDER_WIDTHS as readonly unknown[]).includes(Number(x)) && x !== '' && x !== null ? Number(x) : x === undefined ? dflt : x) as RenderSettings['proxy_width']
  return {
    where: (o.where === undefined ? d.where : o.where) as RenderSettings['where'], kind: (o.kind === undefined ? d.kind : o.kind) as RenderSettings['kind'], proxy_width: width(o.proxy_width, d.proxy_width), review_width: width(o.review_width, d.review_width),
    codecs: (Array.isArray(o.codecs) ? [...new Set(o.codecs as RenderSettings['codecs'])] : [...d.codecs]), fps: (o.fps === undefined ? d.fps : o.fps) as RenderSettings['fps'], pull: o.pull === undefined ? d.pull : (o.pull as boolean),
  }
}
export function validateRender(r: RenderSettings): void {
  if (!['auto', 'pod', 'local'].includes(r.where)) throw bad('render.where is auto, pod or local')
  if (!['proxy', 'review'].includes(r.kind)) throw bad('render.kind is proxy or review')
  for (const k of ['proxy_width', 'review_width'] as const) if (!(RENDER_WIDTHS as readonly unknown[]).includes(r[k])) throw bad(`render.${k} is source, 960, 1280 or 1920`)
  if (!Array.isArray(r.codecs) || !r.codecs.length || r.codecs.some((c) => !(RENDER_CODECS as readonly string[]).includes(c))) throw bad('render.codecs is a non-empty list of h264, prores422hq')
  if (!(r.fps === 'auto' || (typeof r.fps === 'number' && Number.isFinite(r.fps) && r.fps >= 1 && r.fps <= 240))) throw bad('render.fps is auto or a number from 1 to 240')
  if (typeof r.pull !== 'boolean') throw bad('render.pull is true or false')
}
/** Patterns a push leaves out (rsync semantics, relative to each step's local root): a leading `/` anchors to the root, a trailing `/` means folders only, otherwise it matches at any depth. They only ever REMOVE things from a push; nothing on the volume is deleted. */
export const EXCLUDE_MAX = 100, EXCLUDE_LEN = 200
export function validateExcludes(list: unknown, field = 'sync_exclude'): string[] {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) throw bad(`${field} is a list of folder or file patterns`)
  if (list.length > EXCLUDE_MAX) throw bad(`${field}: at most ${EXCLUDE_MAX} patterns`)
  const out: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') throw bad(`${field}: each pattern is text`)
    const p = raw.trim()
    if (!p) throw bad(`${field}: a pattern is not empty`)
    if (p.length > EXCLUDE_LEN) throw bad(`${field}: a pattern is at most ${EXCLUDE_LEN} characters`)
    // eslint-disable-next-line no-control-regex
    if (/[\u0000\n\r]/.test(p)) throw bad(`${field}: a pattern has no NUL or line break`)
    if (p.split('/').includes('..')) throw bad(`${field}: a pattern has no .. segment (${JSON.stringify(p.slice(0, 60))})`)
    if (p.startsWith('~')) throw bad(`${field}: a pattern does not start with ~ (${JSON.stringify(p.slice(0, 60))})`)
    if (!out.includes(p)) out.push(p)
  }
  return out
}
/** Per-folder exclusion defaults, keyed by the push step (the mapped folder row): patterns relative to THAT step's root. A pod's own map replaces the Default's per key; keys it lacks fall back to the Default's; an empty list in the pod clears that key for the pod. */
export const FOLDER_EXCLUDE_KEYS = ['project', 'plates', 'comfy-shared', 'workflows'] as const
export const FOLDER_EXCLUDE_TOTAL = 300
export function normalizeFolderExcludes(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const k of FOLDER_EXCLUDE_KEYS) { const l = (v as Record<string, unknown>)[k]; if (Array.isArray(l)) out[k] = [...new Set(l.map((x) => (typeof x === 'string' ? x.trim() : x)))].filter((x) => x !== '') as string[] }
  return out
}
export function validateFolderExcludes(m: Record<string, string[]> | undefined): void {
  let total = 0
  for (const [k, l] of Object.entries(m ?? {})) { total += validateExcludes(l, `folder_excludes.${k}`).length }
  if (total > FOLDER_EXCLUDE_TOTAL) throw bad(`folder_excludes: at most ${FOLDER_EXCLUDE_TOTAL} patterns in all`)
}
export interface MountsConfig {
  folders: Record<string, string>
  custom: CustomFolder[]
  /** The volume that holds the shared models (ADR-042): marked Shared in the Volumes list and never deleted from there; '' = none chosen (the models go to the Default Configuration's volume) */
  shared_volume_id: string
  /** The model files wanted on a Shared volume, as Hugging Face coordinates (ADR-042 section 12); travels in the export, tied to no volume */
  wanted_models: wanted.WantedModel[]
  network_volume_id: string
  mount_path: string
  data_center_id: string
  links: Link[]
  env: Record<string, string>
  apply_by_default: boolean
  /** Pull pods (the Pod download of a round, ADR-022/024) may take any NVIDIA card RunPod has free in the volume's datacenter, not only the table's ten; a pull needs no GPU. Default on. */
  pull_any_card: boolean
  /** The card a new pod gets when the caller names none: a key of the card table (gpus.ts) or `auto` (the cheapest in stock). System-wide, not per pod. Default the RTX PRO 6000. */
  default_gpu: string
  /** Round import (ADR-038): how many pool pods one import may run at once, the dollar cap on one import's estimate, and whether those two limits apply at all (the governance cap does not depend on this). */
  import_max_pods: number
  import_cost_cap_usd: number
  import_cap_enabled: boolean
  required: Record<string, boolean>
  image: string
  registry_auth_id: string   // RunPod's saved credential for a private registry (saveRegistryAuth); '' for a public image
  idle_stop_minutes: number
  /** The VAE and diffusion model a pod's workflows use unless the pod has its own choice (ADR-042); '' = the graph's own */
  models: { vae: string; diffusion_model: string }
  pull_shared: string[]      // which ComfyUI-Shared subfolders a pull brings back down (default: output)
  sync_shared: string[]      // which ComfyUI-Shared subfolders a push carries: input, models, output, workflows (a pod's own configuration can differ from the default)
  sync_parallel: number      // rsync streams at a time on a push (1..16); the uplink is the limit, streams keep it full across small files
  /** Auto sync for each pod created under this configuration (default off; Pull on, Push off); enabled needs approved_by */
  auto_sync?: AutoSyncConfig
  /** Patterns a push leaves out (see validateExcludes); a pod's own configuration may carry its own (it replaces the default's) */
  sync_exclude?: string[]
  /** A push with exclusions also REMOVES what the patterns match on the volume (a targeted, guarded removal, never rsync --delete-excluded); default off; the run still needs a named yes */
  sync_exclude_delete?: boolean
  /** Per-folder exclusion defaults (see normalizeFolderExcludes), added to `sync_exclude` for that step only */
  folder_excludes?: Record<string, string[]>
  /** Render settings for DPX sequences (ADR-048); a pod's own configuration may carry its own */
  render?: RenderSettings
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
    shared_volume_id: '',
    wanted_models: [],
    network_volume_id: '',
    mount_path: '/workspace',
    data_center_id: '',
    links: [],
    env: {},
    apply_by_default: true,
    pull_any_card: true,
    default_gpu: 'rtxpro6000',
    import_max_pods: 2,
    import_cost_cap_usd: 50,
    import_cap_enabled: true,
    required: Object.fromEntries(names.map((n) => [n, false])),
    image: DEFAULT_IMAGE(),
    registry_auth_id: '',
    idle_stop_minutes: 30,
    models: { vae: '', diffusion_model: '' },
    sync_parallel: 8,   // streams at a time: the uplink is the limit and more streams keep it full across many small files (was 4)
    sync_shared: [...SYNC_SHARED_DEFAULT],
    pull_shared: [...PULL_SHARED_DEFAULT],
    auto_sync: { ...AUTO_SYNC_DEFAULT },
    render: { ...RENDER_DEFAULT, codecs: [...RENDER_DEFAULT.codecs] },
    sync_exclude: [],
    sync_exclude_delete: false,
    folder_excludes: {},
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
    wanted_models: wanted.normalizeList(data.wanted_models),
    models: { vae: String(data.models?.vae ?? '').trim(), diffusion_model: String(data.models?.diffusion_model ?? '').trim() },
    sync_parallel: data.sync_parallel ?? d.sync_parallel,
    pull_shared: Array.isArray(data.pull_shared) ? SYNC_SHARED.filter((x) => data.pull_shared!.includes(x)) : d.pull_shared,
    sync_shared: Array.isArray(data.sync_shared) ? SYNC_SHARED.filter((x) => data.sync_shared!.includes(x)) : d.sync_shared,
    pull_any_card: data.pull_any_card !== false,   // absent means on
    default_gpu: typeof data.default_gpu === 'string' && data.default_gpu.trim() ? data.default_gpu.trim() : d.default_gpu,   // absent or empty: the default; an unknown card is refused by validate
    import_max_pods: Number.isInteger(data.import_max_pods) && (data.import_max_pods as number) >= 1 && (data.import_max_pods as number) <= 20 ? data.import_max_pods as number : 2,
    import_cost_cap_usd: typeof data.import_cost_cap_usd === 'number' && data.import_cost_cap_usd > 0 ? data.import_cost_cap_usd : 50,
    import_cap_enabled: data.import_cap_enabled !== false,   // absent means the cap is on
    auto_sync: normalizeAutoSync(data.auto_sync),
    render: normalizeRender(data.render),
    sync_exclude: Array.isArray(data.sync_exclude) ? [...new Set(data.sync_exclude.map((x) => (typeof x === 'string' ? x.trim() : x)))].filter((x) => x !== '') as string[] : [],
    sync_exclude_delete: data.sync_exclude_delete === true,
    folder_excludes: normalizeFolderExcludes(data.folder_excludes),
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

/** A directory entry that is a folder, following a symlink to a folder (stat); a broken link or an unreadable one is not a folder. */
export const isDirFollow = (parent: string, e: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }): boolean => {
  if (e.isDirectory()) return true
  if (!e.isSymbolicLink()) return false
  try { return statSync(join(parent, e.name)).isDirectory() } catch { return false }
}
const WALK_DEPTH = 12
/** The tree readers below run when a folder is chosen (folderRows -> declared) in the main process: on a slow or sleeping volume they stop after a time budget (set by `declared`) and report what they found so far, instead of freezing the window. */
let budgetUntil = Infinity
const overBudget = () => Date.now() > budgetUntil
/** Every file under a folder, following links to folders safely: depth-bounded and loop-safe (a folder is entered once, by its realpath). */
function walk(dir: string, out: string[] = [], seen = new Set<string>(), depth = 0): string[] {
  let real = dir; try { real = realpathSync(dir) } catch { return out }
  if (seen.has(real) || depth > WALK_DEPTH || overBudget()) return out
  seen.add(real)
  for (const e of entries(dir)) {
    const p = join(dir, e.name)
    if (isDirFollow(dir, e)) walk(p, out, seen, depth + 1); else if (!e.isSymbolicLink() || isFileLink(p)) out.push(p)
  }
  return out
}
const isFileLink = (p: string) => { try { return statSync(p).isFile() } catch { return false } }

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
  for (const type of entries(tree).filter((e) => isDirFollow(tree, e))) {
    if (overBudget()) break
    const typeDir = join(tree, type.name)
    for (const shot of entries(typeDir).filter((e) => isDirFollow(typeDir, e))) {
      if (overBudget()) break
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
  budgetUntil = Date.now() + 400   // a time budget for the whole read
  try {
    const root = declaredRoot(tree)
    out.project = root
    out.plates = declaredPlates(tree)
    out['comfy-shared'] = declaredShared(root ? root.path : null)
  } finally { budgetUntil = Infinity }
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

/** ComfyUI's memory flags for every pod: free each node's output once it is used and unload models after a run, so system RAM
 *  does not climb until the container is OOM-killed (exit 137). A pod's own COMFY_ARGS (even empty) replaces it; add --lowvram there. */
export const DEFAULT_COMFY_ARGS = '--cache-lru 1 --disable-smart-memory'

/** What pod creation adds: RunPod volume fields and the env the image reads. */
export function podOverrides(cfg: MountsConfig): PodOverrides {
  const env: Record<string, string> = { COMFY_ARGS: DEFAULT_COMFY_ARGS, ...podEnv(cfg), ...cfg.env }
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
  if (cfg.default_gpu !== gpus.AUTO && !(cfg.default_gpu in gpus.GPUS)) throw bad(`default_gpu is auto or one of ${Object.keys(gpus.GPUS).join(', ')}, not ${JSON.stringify(cfg.default_gpu)}`)
  if (cfg.idle_stop_minutes < 0) throw bad('idle_stop_minutes is 0 (never) or a number of minutes')
  if (!Number.isInteger(cfg.sync_parallel) || cfg.sync_parallel < 1 || cfg.sync_parallel > 16) throw bad('sync_parallel is a whole number of parallel uploads, 1 to 16')
  if (cfg.render) validateRender(cfg.render)
  validateExcludes(cfg.sync_exclude)
  validateFolderExcludes(cfg.folder_excludes)
  if (cfg.auto_sync?.enabled && !cfg.auto_sync.approved_by.trim()) throw bad('Auto sync needs the name of who says yes')
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
