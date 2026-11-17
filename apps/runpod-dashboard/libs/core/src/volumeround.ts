/**
 * Rounds that already sit on a network volume (docs/ADR-044): Binc's graphs under `comfy-shared/workflows/<round>/<shot>/` on the
 * Shared volume. Everything here READS: it lists by prefix over RunPod's S3 API from this PC (no pod, no spend), asks the round
 * adapter (`brynley-rounds-layout`) what the listing is, and checks a round's models against the volume's model list. It never
 * writes, renames, moves or deletes anything on the volume (Binc's rules: nothing is overwritten; locked shots are never run).
 *
 * Listing speed: a listing of the whole volume pages 1,000 objects per call and takes minutes, so only
 * `comfy-shared/workflows/<round>/` is ever listed, and each round's listing is cached for a minute or two.
 */
import { CoreError, bad } from './errors.js'
import * as governance from './governance.js'
import * as history from './history.js'
import * as imports from './imports.js'
import * as mounts from './mounts.js'
import * as podpull from './podpull.js'

export const WORKFLOWS_KEY = 'comfy-shared/workflows'
/** Binc's rules: client-approved shots are never edited or run by us. The adapter says the same; this is the core's own copy, so a replaced adapter cannot unlock one. */
export const LOCKED_SHOTS = new Set(['cgi-042'])
/** Approved graphs live in `<shot>/04_GRAPH/` (area-pipeline): anything under it is locked. */
export const isLockedPath = (p: string): boolean => p.toUpperCase().split('/').includes('04_GRAPH')
/** How long a graph runs when the History has no run to go by. */
export const DEFAULT_SECONDS_PER_GRAPH = 600
export const CACHE_MS = 90_000

export interface VolumeOpts extends podpull.Opts { now?: () => Date; fresh?: boolean }
export interface RoundInfo extends imports.RoundDescription { volume_id: string; /** the graphs' paths as the pod's Workflows panel names them, per shot */ by_shot: Record<string, string[]> }

/** The volume a volume source reads when none is named: the Shared volume, else the default one. */
export function defaultVolumeId(): string { const c = mounts.load(); return (c.shared_volume_id || c.network_volume_id || '').trim() }

export const roundName = (r: string): string => { if (!/^[A-Za-z0-9][\w.-]{0,80}$/.test(r) || r.includes('..')) throw bad(`Not a round folder name: ${r}`); return r }

const cache = new Map<string, { at: number; files: { path: string; bytes: number }[] }>()
const listCache = new Map<string, { at: number; keys: { key: string; bytes: number; modified?: string }[] }>()
export const forgetCache = () => { cache.clear(); listCache.clear() }
const nowMs = (o: VolumeOpts) => (o.now ?? (() => new Date()))().getTime()

/** Whether the volume can be listed from here at no cost, and why not. */
export async function availability(volumeId?: string, opts: VolumeOpts = {}): Promise<{ ok: boolean; reason: string; volume_id: string }> {
  const id = (volumeId || defaultVolumeId()).trim()
  if (!id) return { ok: false, reason: 'No network volume: set a Shared or default volume in Configuration.', volume_id: '' }
  try { const a = await podpull.volumeS3(id, opts); return { ok: a.ok, reason: a.reason, volume_id: id } } catch (e) { return { ok: false, reason: (e as Error).message, volume_id: id } }
}

/** The files of one round, paths relative to the round folder. One prefix listing (cached for CACHE_MS). */
export async function roundFiles(volumeId: string, round: string, opts: VolumeOpts = {}): Promise<{ path: string; bytes: number }[]> {
  roundName(round)
  const key = `${volumeId}|${round}`, hit = cache.get(key)
  if (!opts.fresh && hit && nowMs(opts) - hit.at < CACHE_MS) return hit.files
  const prefix = `${WORKFLOWS_KEY}/${round}/`
  const keys = await podpull.listVolumeKeys(volumeId, prefix, { recursive: true }, opts)
  if (keys === null) throw new CoreError(409, (await availability(volumeId, opts)).reason || 'This volume cannot be listed over the S3 API.')
  const files = keys.filter((k) => k.key.startsWith(prefix) && !k.key.endsWith('/')).map((k) => ({ path: k.key.slice(prefix.length), bytes: k.bytes }))
  cache.set(key, { at: nowMs(opts), files })
  return files
}

/** Any prefix of a volume, listed read-only over the S3 API (`aws s3 ls`), cached for CACHE_MS. One level (`recursive: false`: folders end in a slash, bytes 0) or everything under it. Used by the outputs source (docs/ADR-045). */
export async function listPrefix(volumeId: string, prefix: string, o: { recursive?: boolean } = {}, opts: VolumeOpts = {}): Promise<{ key: string; bytes: number; modified?: string }[]> {
  const key = `${volumeId}|${prefix}|${o.recursive === false ? 'l1' : 'rec'}`, hit = listCache.get(key)
  if (!opts.fresh && hit && nowMs(opts) - hit.at < CACHE_MS) return hit.keys
  const keys = await podpull.listVolumeKeys(volumeId, prefix, o, opts)
  if (keys === null) throw new CoreError(409, (await availability(volumeId, opts)).reason || 'This volume cannot be listed over the S3 API.')
  listCache.set(key, { at: nowMs(opts), keys })
  return keys
}

/** What the round is, from its listing, by the round adapter; the locked rules are applied again here (the core does not trust a replaced adapter to lock). */
export async function describeRound(volumeId: string, round: string, opts: VolumeOpts = {}): Promise<RoundInfo> {
  const files = await roundFiles(volumeId, round, opts)
  const d = await imports.describeRound(files, { round })
  const locked = new Set([...d.locked, ...[...LOCKED_SHOTS].filter((s) => d.shots.includes(s))])
  for (const g of d.graphs) if (isLockedPath(g.path)) locked.add(g.shot)
  const graphs = d.graphs.map((g) => ({ ...g, locked: locked.has(g.shot) || isLockedPath(g.path) }))
  const by_shot: Record<string, string[]> = {}
  for (const g of graphs) (by_shot[g.shot] ||= []).push(g.path)
  return { ...d, volume_id: volumeId, locked: [...locked].sort(), graphs, by_shot }
}

/** The folders under comfy-shared/workflows/ (one level, one call). */
export async function roundFolders(volumeId: string, opts: VolumeOpts = {}): Promise<string[]> {
  const keys = await podpull.listVolumeKeys(volumeId, WORKFLOWS_KEY, { recursive: false }, opts)
  if (keys === null) throw new CoreError(409, (await availability(volumeId, opts)).reason)
  return keys.filter((k) => k.key.endsWith('/')).map((k) => k.key.slice(WORKFLOWS_KEY.length + 1).replace(/\/$/, '')).filter((n) => /^[A-Za-z0-9][\w.-]{0,80}$/.test(n)).sort()
}

// ----- the cost of running graphs (guard c) -----

/** The median seconds a graph took in the History's recorded runs (state done, a real duration), or null when none was recorded. */
export function medianSecondsPerGraph(): { seconds: number | null; samples: number } {
  const secs: number[] = []
  try {
    for (const e of history.list({ kind: 'job', limit: 5000 })) {
      if (e.kind !== 'job' || e.job !== 'run' || e.state !== 'done') continue
      const m = /(\d+(?:\.\d+)?)s\b/.exec(e.detail || '')
      const s = m ? Number(m[1]) : 0
      if (s >= 5) secs.push(s)   // a run under 5 s is a no-spend simulation, not a render
    }
  } catch { /* no History: the default stands */ }
  if (!secs.length) return { seconds: null, samples: 0 }
  secs.sort((a, b) => a - b)
  const mid = secs.length >> 1
  return { seconds: Math.round(secs.length % 2 ? secs[mid] : (secs[mid - 1] + secs[mid]) / 2), samples: secs.length }
}

/** What the USD 100 rule (Binc's agent-permissions) leaves: the agent spend cap minus what the History has spent; null when no cap is set. */
export function governanceRemainingUsd(): number | null {
  const cap = governance.spendCap()
  if (!cap) return null
  let spent = 0
  try { spent = history.spend().total } catch { /* no History */ }
  return Math.round((cap - spent) * 100) / 100
}

// ----- the preflight: the models a round's graphs name, against the volume's model list (read-only) -----

export interface ModelCheck { graph: string; models: string[]; missing: { name: string; node_type: string; reads: string[]; elsewhere: string[] }[]; error?: string }
export interface Preflight { round: string; volume_id: string; checked: number; total_graphs: number; graphs: ModelCheck[]; missing_total: number; note: string }

export interface ModelRef { name: string; node_type: string }
/** The models folders a loader node reads (ComfyUI's folder_paths). A loader not in the table is checked against every folder: a miss there is a real miss, a hit is not proof the folder is right. */
export const LOADER_FOLDERS: Record<string, string[]> = {
  CheckpointLoaderSimple: ['checkpoints'], CheckpointLoader: ['checkpoints'], ImageOnlyCheckpointLoader: ['checkpoints'], LTXVAudioVAELoader: ['checkpoints'], LTXVLoader: ['checkpoints'],
  UNETLoader: ['diffusion_models', 'unet'], DiffusionModelLoader: ['diffusion_models', 'unet'], VAELoader: ['vae'], LoraLoader: ['loras'], LoraLoaderModelOnly: ['loras'],
  CLIPLoader: ['text_encoders', 'clip'], DualCLIPLoader: ['text_encoders', 'clip'], TripleCLIPLoader: ['text_encoders', 'clip'], CLIPVisionLoader: ['clip_vision'],
  ControlNetLoader: ['controlnet'], UpscaleModelLoader: ['upscale_models'], StyleModelLoader: ['style_models'], GLIGENLoader: ['gligen'],
}
const MODEL_FILE = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i
/** The model files a graph names, with the node type that names each. Both ComfyUI formats: the UI graph (nodes[].type + widgets_values) and the API one ({id: {class_type, inputs}}). */
export function modelNamesOf(graph: unknown): ModelRef[] {
  const out = new Map<string, ModelRef>()
  const add = (v: unknown, type: string) => { if (typeof v === 'string' && v.length < 300 && MODEL_FILE.test(v)) { const name = v.replace(/\\/g, '/'); out.set(`${type}|${name}`, { name, node_type: type }) } }
  const g = graph as { nodes?: { type?: string; widgets_values?: unknown }[] } & Record<string, unknown>
  if (Array.isArray(g?.nodes)) for (const n of g.nodes) { const w = n?.widgets_values; if (Array.isArray(w)) w.forEach((v) => add(v, n.type || '')); else if (w && typeof w === 'object') Object.values(w).forEach((v) => add(v, n.type || '')) }
  else for (const n of Object.values(g || {})) { const nn = n as { class_type?: string; inputs?: Record<string, unknown> }; if (nn?.inputs && typeof nn.inputs === 'object') Object.values(nn.inputs).forEach((v) => add(v, nn.class_type || '')) }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.node_type.localeCompare(b.node_type))
}

/** Check ONE round's models, read-only: each graph's JSON is read from the volume (small files, over S3, no pod) and every model it names is looked up in the volume's model list (comfy-shared/models/<folder>/). A miss says where else the same file name is: the 2026-11-17 case, LTX23_audio_vae_bf16.safetensors only in models/vae/ while LTXVAudioVAELoader reads models/checkpoints/. Lazily, per round, on demand (at most `max_graphs`, default 60): never all the graphs of the volume at once. Nothing is changed, fetched or substituted. */
export async function preflightRound(volumeId: string, round: string, o: { shots?: string[]; max_graphs?: number } = {}, opts: VolumeOpts = {}): Promise<Preflight> {
  const info = await describeRound(volumeId, round, opts)
  const have = await podpull.modelsOnVolume(volumeId, opts)
  if (have === null) throw new CoreError(409, (await availability(volumeId, opts)).reason || 'The volume cannot be listed over the S3 API.')
  const inFolder = new Set(have.map((m) => `${m.folder}/${m.name}`))
  const folders = [...new Set(have.map((m) => m.folder))]
  const wanted = info.graphs.filter((g) => !o.shots?.length || o.shots.includes(g.shot)).slice(0, o.max_graphs ?? 60)
  const graphs: ModelCheck[] = []
  for (const g of wanted) {
    try {
      const text = await podpull.readVolumeText(volumeId, `${WORKFLOWS_KEY}/${g.path}`, opts)
      if (text === null) { graphs.push({ graph: g.path, models: [], missing: [], error: 'unreadable over S3' }); continue }
      const refs = modelNamesOf(JSON.parse(text))
      const missing: ModelCheck['missing'] = []
      for (const r of refs) {
        const reads = LOADER_FOLDERS[r.node_type] ?? folders
        if (reads.some((f) => inFolder.has(`${f}/${r.name}`))) continue
        const base = r.name.split('/').pop()!
        const elsewhere = have.filter((m) => m.name === r.name || m.name.split('/').pop() === base).map((m) => `models/${m.folder}/${m.name}`)
        if (!missing.some((x) => x.name === r.name && x.node_type === r.node_type)) missing.push({ name: r.name, node_type: r.node_type, reads: reads.map((f) => `models/${f}/`), elsewhere })
      }
      graphs.push({ graph: g.path, models: [...new Set(refs.map((r) => r.name))], missing })
    } catch (e) { graphs.push({ graph: g.path, models: [], missing: [], error: (e as Error).message }) }
  }
  return { round, volume_id: volumeId, checked: graphs.length, total_graphs: info.graphs.length, graphs, missing_total: graphs.reduce((a, g) => a + g.missing.length, 0), note: `Read-only: ${graphs.length} of ${info.graphs.length} graph(s) read from the volume, their model names looked up in comfy-shared/models/. "elsewhere" is a file of the same name in another folder than the loader reads. Nothing was changed, downloaded or substituted: fixing a miss is a separate step with its own named yes.` }
}
