/**
 * Pods as the dashboard sees them: create with the mount configuration applied, list, stop,
 * resume, delete. The same request shape and the same rules as the Python API: the image must
 * be pullable, the GPU comes from the small-card table, the per-pod volume is 0 beside the
 * network volume, required folders must be mapped, a pod with an idle stop is registered.
 */
import { CoreError, bad } from './errors.js'
import * as gpus from './gpus.js'
import * as idle from './idle.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import * as rp from './runpod.js'
import * as dry from './dry.js'

export const PREBUILT_IMAGE = 'ashleykza/comfyui:latest'   // the stock image: no packs, ignores COMFY_LINKS

/** The ports a pod exposes and which one is ComfyUI's web UI. Our image serves ComfyUI on 8188; the stock
 *  image puts it behind nginx on 3001 (and Jupyter on 8888). The web port is read back from the pod's own
 *  port list, so the link is right whatever the image. */
export const OUR_PORTS = '8188/http,22/tcp'
export const PREBUILT_PORTS = '3001/http,8888/http,22/tcp'
export const portsFor = (imageName: string) => (imageName === PREBUILT_IMAGE ? PREBUILT_PORTS : OUR_PORTS)
export const webPortOf = (ports: string | null | undefined, fallback = 8188): number => {
  const m = /(\d+)\/http/.exec(ports || '')
  return m ? Number(m[1]) : fallback
}

export interface CreatePodRequest {
  name: string; gpu?: string; gpu_count?: number; instance_type?: 'on-demand' | 'spot'; volume_gb?: number; disk_gb?: number
  image?: string; env_vars?: Record<string, string>; build_args?: Record<string, string>; pip_requirements?: string
  custom_nodes?: { name: string; url: string; branch: string; path: string }[]; start_ssh?: boolean; start_jupyter?: boolean
  apply_mounts?: boolean | null; idle_stop_minutes?: number | null
  data_center_id?: string | null   // where to create the pod when no network volume pins it; the volume's datacenter wins otherwise
  config?: Partial<mounts.MountsConfig> | null   // this pod's own configuration (the Default Configuration's shape); null = the default
}
export interface PodStatus {
  id: string; name: string; status: 'running' | 'stopped' | 'starting'; gpu: string; vram: number
  uptime_seconds: number | null; web_ui_url: string | null; ssh_command: string; idle_stop_minutes: number
  console_url?: string; status_text?: string; comfy_ready?: boolean | null   // null = not probed
  custom_config?: boolean   // created with its own configuration, kept for Recreate
  image?: string            // the image the pod boots (the card's Dockerfile link)
  port_mismatch?: boolean   // the pod does not expose the port its image serves ComfyUI on; only Recreate fixes it
}

/** The image a pod boots. `configured` is ours from the mount configuration; it must be a reference a pod can
 *  pull, i.e. carry a registry or namespace: a bare local name means it has not been pushed yet. */
export function resolveImage(choice: string | undefined, cfg: mounts.MountsConfig): string {
  const image = ({ configured: cfg.image, prebuilt: PREBUILT_IMAGE } as Record<string, string>)[choice || 'configured'] ?? (choice || '')
  const ref = image.trim()
  if (!ref) throw bad('No image: set one in Configuration or pick one in the form')
  if (!ref.includes('/')) throw bad(`${ref} is a local image name; a pod cannot pull it. Push it to the registry Binc names (apps/comfy-app/build.sh, then docker push) and set that reference in Configuration.`)
  return ref
}

/** What the API sends RunPod for a request, with the mount configuration applied. Pure, so it is testable. */
export function plan(req: CreatePodRequest, cfg: mounts.MountsConfig, credentialsEnv: Record<string, string> = {}): { input: rp.CreatePodInput; idleMinutes: number } {
  const env: Record<string, string> = { ...(req.env_vars || {}) }
  for (const [k, v] of Object.entries(req.build_args || {})) if (!(k in env)) env[k] = v   // ARG overrides reach the pod as env; explicit env wins
  if (req.pip_requirements) env.CUSTOM_PIP_REQUIREMENTS = req.pip_requirements
  if (req.custom_nodes?.length) env.CUSTOM_NODES = JSON.stringify(req.custom_nodes)
  for (const [k, v] of Object.entries(credentialsEnv)) env[k] = v
  if (req.start_jupyter) env.START_JUPYTER = '1'

  const apply = req.apply_mounts == null ? cfg.apply_by_default : req.apply_mounts
  let volumeGb = req.volume_gb ?? 0
  const volume: Partial<rp.CreatePodInput> = {}
  if (apply) {
    const missing = mounts.missingRequired(cfg)
    if (missing.length) throw bad(`Not mapped on this PC: ${missing.join(', ')}. Map them in Configuration (gear icon); in dev mode (COMFY_MODE=dev) plates are optional.`)
    const ov = mounts.podOverrides(cfg)
    for (const [k, v] of Object.entries(ov.env)) if (!(k in env)) env[k] = v
    if (ov.registry_auth_id) volume.containerRegistryAuthId = ov.registry_auth_id   // a private registry: RunPod pulls with its saved credential
    if (ov.network_volume_id) {
      volume.networkVolumeId = ov.network_volume_id; volume.volumeMountPath = ov.volume_mount_path
      if (ov.data_center_id) volume.dataCenterId = ov.data_center_id
      volume.cloudType = 'SECURE'   // network volumes live in the secure cloud only
      volumeGb = 0   // the network volume carries the data; a per-pod volume beside it is billed for nothing
    }
  }
  if (!volume.networkVolumeId && req.data_center_id) volume.dataCenterId = req.data_center_id
  const imageName = resolveImage(req.image, cfg)
  const gpuKey = req.gpu || gpus.DEFAULT_GPU
  let gpuTypeId: string
  if (gpuKey === gpus.AUTO) gpuTypeId = gpus.AUTO   // resolved against stock at creation
  else { try { gpuTypeId = gpus.runpodId(gpuKey) } catch (e) { throw bad((e as Error).message) } }
  const idleMinutes = req.idle_stop_minutes == null ? cfg.idle_stop_minutes : req.idle_stop_minutes
  return {
    input: {
      name: req.name, imageName, gpuTypeId,
      cloudType: ({ 'on-demand': 'SECURE', spot: 'COMMUNITY' } as const)[req.instance_type || 'spot'] || 'ALL',
      gpuCount: req.gpu_count ?? 1, volumeInGb: volumeGb, containerDiskInGb: req.disk_gb ?? 20,
      startSsh: req.start_ssh !== false, ports: portsFor(imageName), env, ...volume,
    },
    idleMinutes,
  }
}

/** Create a pod from the dashboard's request. */
/** The configuration a request runs under: its own, validated, or the Default Configuration. No-spend mode is
 *  app-wide, so it always comes from the default. */
export function effectiveConfig(req: CreatePodRequest): { cfg: mounts.MountsConfig; own: boolean } {
  const base = mounts.load()
  if (!req.config) return { cfg: base, own: false }
  const cfg = mounts.validate(mounts.normalize({ ...req.config, dry_run: base.dry_run }))
  return { cfg, own: true }
}

export async function create(req: CreatePodRequest, client?: rp.RunPodClient, credentialsEnv: Record<string, string> = {}): Promise<PodStatus> {
  if (!req.name?.trim()) throw bad('A pod needs a name')
  const { cfg, own } = effectiveConfig(req)
  const { input, idleMinutes } = plan(req, cfg, credentialsEnv)
  if (mounts.dryRun(cfg)) {
    const p = dry.create({ name: req.name, gpu: req.gpu, gpu_count: input.gpuCount, image: input.imageName, idle_stop_minutes: idleMinutes > 0 ? idleMinutes : 0 })
    if (own) podconfigs.set(p.id, cfg)
    return { ...p, custom_config: own }
  }
  const { pod, gpuId } = await deployWithFallback(input, client)
  if (idleMinutes > 0) idle.register(pod.id, idleMinutes)
  if (own) podconfigs.set(pod.id, cfg)
  const key = gpuKey(gpuId)
  return {
    id: pod.id, name: req.name, status: 'starting', gpu: `${key} x${input.gpuCount}`,
    vram: gpus.vram(key) * (input.gpuCount || 1), uptime_seconds: 0,
    web_ui_url: idle.proxyUrl(pod.id, webPortOf(input.ports)), ssh_command: `ssh root@${pod.id}.proxy.runpod.io`, idle_stop_minutes: idleMinutes > 0 ? idleMinutes : 0, comfy_ready: false,
  }
}

const gpuKey = (id: string) => Object.entries(gpus.GPUS).find(([, g]) => g.id === id)?.[0] || id
/** RunPod's words for "no card on that host / in that cloud": a create moves to the next card, a resume needs recreate. */
export const NO_STOCK = /no longer any instances available|not enough|no instances/i

/** The cards to try, cheapest in stock first, for `auto`; the one asked for otherwise. With a datacenter
 *  (a network volume pins the pod there) only the cards that datacenter has right now count as in stock. */
export async function candidates(gpuTypeId: string, client?: rp.RunPodClient, dataCenterId?: string): Promise<string[]> {
  if (gpuTypeId !== gpus.AUTO) return [gpuTypeId]
  const ids = Object.values(gpus.GPUS).map((g) => g.id)
  let stock: rp.GpuStock[] = []
  try { stock = await rp.gpuStock(ids, client) } catch { /* no stock answer: try them all in table order */ }
  let here: Set<string> | null = null
  if (dataCenterId) { try { here = new Set(await rp.datacenterStock(dataCenterId, client)) } catch { /* no answer: fall back to global stock */ } }
  const inStock = stock.filter((g) => g.stock && g.price != null && (!here || here.has(g.id))).sort((a, b) => (a.price as number) - (b.price as number)).map((g) => g.id)
  return [...inStock, ...ids.filter((id) => !inStock.includes(id))]
}

/** Deploy on the first card RunPod will give; a "no instances" answer moves to the next card, then to the other cloud. */
async function deployWithFallback(input: rp.CreatePodInput, client?: rp.RunPodClient): Promise<{ pod: { id: string }; gpuId: string }> {
  const cards = await candidates(input.gpuTypeId, client, input.dataCenterId)
  const clouds: rp.CreatePodInput['cloudType'][] = input.gpuTypeId === gpus.AUTO && !input.networkVolumeId ? [input.cloudType, input.cloudType === 'SECURE' ? 'COMMUNITY' : 'SECURE'] : [input.cloudType]
  let last: Error | null = null
  for (const cloudType of clouds) {
    for (const gpuTypeId of cards) {
      try {
        const pod = await rp.createPod({ ...input, gpuTypeId, cloudType }, client)
        return { pod, gpuId: gpuTypeId }
      } catch (e) {
        last = e as Error
        if (!NO_STOCK.test(last.message)) throw last   // anything but stock is a real error
      }
    }
  }
  throw new CoreError(502, `No card available right now: tried ${cards.map(gpuKey).join(', ')} on ${clouds.join(' and ')}. RunPod: ${last?.message}`)
}

/** A RunPod pod as the dashboard shows it. */
export function toStatus(p: rp.RawPod): PodStatus {
  const uptime = p.runtime?.uptimeInSeconds ?? p.uptimeSeconds ?? null
  const running = uptime != null && uptime > 0
  const wanted = (p.desiredStatus || '').toUpperCase() === 'RUNNING'
  return {
    id: p.id, name: p.name || 'Unknown', status: running ? 'running' : wanted ? 'starting' : 'stopped',
    gpu: p.machine?.gpuDisplayName || String(p.gpuCount ?? '?'), vram: gpus.vram(p.machine?.gpuDisplayName || '') || 24,
    uptime_seconds: uptime, web_ui_url: running ? idle.proxyUrl(p.id, webPortOf(p.ports)) : null,
    ssh_command: `ssh root@${p.id}.proxy.runpod.io`, idle_stop_minutes: idle.entry(p.id)?.minutes ?? 0, comfy_ready: null,
    custom_config: podconfigs.has(p.id), image: p.imageName || undefined,
    port_mismatch: (p.imageName || '') === PREBUILT_IMAGE && !/3001\/http/.test(p.ports || ''),
    console_url: consoleUrl(p.id), status_text: p.lastStatusChange || p.desiredStatus || '',
  }
}

const isDry = () => mounts.dryRun(mounts.load())
/** Does ComfyUI answer on the pod's web port yet? RunPod's proxy answers 502 with a waiting page until the service is up. */
export async function comfyReady(url: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await fetchFn(`${url.replace(/\/$/, '')}/system_stats`, { method: 'GET', signal: AbortSignal.timeout(4000) })
    return r.status === 200
  } catch { return false }
}

export const list = async (client?: rp.RunPodClient): Promise<PodStatus[]> => {
  if (isDry()) return dry.list().map((p) => ({ ...p, custom_config: podconfigs.has(p.id) }))
  const pods = (await rp.listPods(client)).map(toStatus)
  await Promise.all(pods.map(async (p) => { if (p.status === 'running' && p.web_ui_url) p.comfy_ready = await comfyReady(p.web_ui_url, client?.fetchFn || fetch) }))
  return pods
}

export async function get(podId: string, client?: rp.RunPodClient): Promise<PodStatus> {
  if (isDry()) { const p = dry.list().find((x) => x.id === podId); if (!p) throw new CoreError(404, `Pod ${podId} not found`); return p }
  const p = await rp.getPod(podId, client)
  if (!p) throw new CoreError(404, `Pod ${podId} not found`)
  return toStatus(p)
}

export function stats(pods: PodStatus[]) {
  return {
    total_pods: pods.length, running_pods: pods.filter((p) => p.status === 'running').length,
    stopped_pods: pods.filter((p) => p.status === 'stopped').length, total_vram: pods.reduce((s, p) => s + (p.vram || 0), 0),
  }
}

/** RunPod's network volume price: USD 0.07 per GB a month for the first TB, 0.05 beyond (docs.runpod.io/storage/s3-api, 2026-10-21). */
export const volumeCostPerMonth = (sizeGb: number) => Math.round((Math.min(sizeGb, 1000) * 0.07 + Math.max(sizeGb - 1000, 0) * 0.05) * 100) / 100

export interface VolumeInfo { id: string; name: string; size_gb: number; datacenter: string; cost_per_month: number; s3: boolean }
/** The configured network volume (or the one asked for) with what it costs a month; null when RunPod has no such volume. */
export async function volumeInfo(id?: string, client?: rp.RunPodClient): Promise<VolumeInfo | null> {
  const vid = (id ?? (mounts.load().network_volume_id || '')).trim()
  if (!vid) return null
  if (isDry()) return { id: vid, name: 'simulated', size_gb: 100, datacenter: 'CA-MTL-1', cost_per_month: volumeCostPerMonth(100), s3: false }
  const v = await rp.networkVolume(vid, client)
  return v && { id: v.id, name: v.name, size_gb: v.size, datacenter: v.dataCenterId, cost_per_month: volumeCostPerMonth(v.size), s3: S3_DATACENTERS.has(v.dataCenterId) }
}

export async function dashboard(client?: rp.RunPodClient) {
  const pods = await list(client)
  return { stats: stats(pods), pods, dry_run: isDry() }
}

export async function stop(podId: string, client?: rp.RunPodClient) { if (isDry()) return dry.stop(podId); await rp.stopPod(podId, client); return { message: `Pod ${podId} stopped`, pod_id: podId } }
export async function resume(podId: string, client?: rp.RunPodClient) { if (isDry()) return dry.resume(podId); await rp.resumePod(podId, 1, client); return { message: `Pod ${podId} resumed`, pod_id: podId } }
export async function remove(podId: string, client?: rp.RunPodClient) { podconfigs.forget(podId); if (isDry()) { idle.forget(podId); return dry.remove(podId) } await rp.terminatePod(podId, client); idle.forget(podId); return { message: `Pod ${podId} deleted`, pod_id: podId } }

/** Change a pod's idle stop: registered for the watch (0 = never, dropped from it); a simulated pod's record follows,
 *  so what `get` shows is what was set in no-spend mode too. */
export async function setIdleStop(podId: string, minutes: number, client?: rp.RunPodClient): Promise<{ pod_id: string; idle_stop_minutes: number }> {
  if (!Number.isInteger(minutes) || minutes < 0) throw bad('idle_stop_minutes is 0 (never) or a whole number of minutes')
  await get(podId, client)   // a clear 404 rather than a registry entry for a pod that is not there
  idle.register(podId, minutes)
  if (isDry()) dry.setIdle(podId, minutes)
  return { pod_id: podId, idle_stop_minutes: minutes }
}

/** A pod's own configuration, or null when it uses the Default Configuration. */
export const config = (podId: string) => podconfigs.get(podId)
/** Give a pod its own configuration (applied when it is recreated), or null to put it back on the default. */
export function setConfig(podId: string, cfg: Partial<mounts.MountsConfig> | null) {
  if (!cfg) { podconfigs.forget(podId); return { pod_id: podId, custom_config: false, config: null } }
  const base = mounts.load()
  const full = mounts.validate(mounts.normalize({ ...cfg, dry_run: base.dry_run }))
  podconfigs.set(podId, full)
  return { pod_id: podId, custom_config: true, config: full }
}

/** The two callbacks the idle loop needs, over RunPod. */
/** The pods RunPod wants running, with their uptime (0 while still starting), for the idle watch. */
export const runningIds = (client?: rp.RunPodClient) => async (): Promise<idle.Running> => {
  if (isDry()) return dry.runningIds()
  const out = new Map<string, number | null>()
  for (const p of await rp.listPods(client)) {
    const uptime = p.runtime?.uptimeInSeconds ?? p.uptimeSeconds ?? 0
    if (uptime > 0 || (p.desiredStatus || '').toUpperCase() === 'RUNNING') out.set(p.id, uptime)
  }
  return out
}
export const stopper = (client?: rp.RunPodClient) => async (id: string) => { if (isDry()) { dry.stop(id); return } await rp.stopPod(id, client) }

export interface PodDetails {
  id: string; name: string; status: string; status_text: string; cost_per_hr: number | null; cloud: string; datacenter: string
  gpu: string; gpu_count: number; image: string; disk_gb: number; volume_gb: number; created_at: string; actions: string[]
  console_url: string; web_ui_url: string | null; ssh_command: string
}

/** The pod in RunPod's console: the pods page with the id as a query (Lucas, 2026-10-19). */
export const consoleUrl = (id: string) => `https://console.runpod.io/pods?id=${encodeURIComponent(id)}`

/** The pod as RunPod describes it: the status text people see in the console, the price, the place, the card. */
export async function details(podId: string, client?: rp.RunPodClient): Promise<PodDetails> {
  if (isDry()) {
    const p = dry.list().find((x) => x.id === podId)
    if (!p) throw new CoreError(404, `Pod ${podId} not found`)
    return { id: p.id, name: p.name, status: p.status === 'stopped' ? 'EXITED' : 'RUNNING', status_text: `Simulated (no-spend mode); ${p.status}`, cost_per_hr: 0, cloud: 'NONE', datacenter: 'local', gpu: p.gpu, gpu_count: 1, image: 'simulated', disk_gb: 0, volume_gb: 0, created_at: '', actions: [], console_url: consoleUrl(p.id), web_ui_url: p.web_ui_url, ssh_command: p.ssh_command }
  }
  const r = await rp.podDetails(podId, client)
  const running = (r.desiredStatus || '').toUpperCase() === 'RUNNING'
  return {
    id: r.id, name: r.name || '', status: r.desiredStatus || '', status_text: r.lastStatusChange || '', cost_per_hr: r.cost ?? r.costPerHr ?? null,
    cloud: r.cloud || '', datacenter: r.dataCenterId || '', gpu: r.gpu?.id || '', gpu_count: r.gpu?.count ?? 1, image: r.image || r.imageName || '',
    disk_gb: r.disk ?? 0, volume_gb: r.volume ?? 0, created_at: r.createdAt || '', actions: r.actions || [],
    console_url: consoleUrl(r.id), web_ui_url: running ? idle.proxyUrl(r.id) : null, ssh_command: `ssh root@${r.id}.proxy.runpod.io`,
  }
}

/** The log stream, or a few simulated lines in no-spend mode. */
export async function logs(podId: string, opts: { tail?: number; since?: string; source?: string }, onEvent: (e: rp.LogEvent) => void, signal?: AbortSignal, client?: rp.RunPodClient): Promise<void> {
  if (isDry()) {
    const now = new Date().toISOString()
    for (const line of ['no-spend mode: this pod is simulated', 'create container (simulated)', 'start container: begin (simulated)', 'ComfyUI listening on 0.0.0.0:8188 (simulated)']) onEvent({ source: 'system', line, ts: now })
    return
  }
  return rp.streamLogs(podId, opts, onEvent, signal, client)
}

/** RunPod pins a stopped pod to its host; when that host has no free GPU, Resume fails. Recreate makes a
 *  fresh pod with the same name, image, card choice, disk and idle stop on whatever host is free, and
 *  terminates the old one. With no per-pod volume nothing is lost; a network volume follows the new pod. */
export async function recreate(podId: string, client?: rp.RunPodClient): Promise<PodStatus> {
  if (isDry()) {
    const old = dry.list().find((x) => x.id === podId)
    if (!old) throw new CoreError(404, `Pod ${podId} not found`)
    const own = podconfigs.get(podId)
    dry.remove(podId); podconfigs.forget(podId)
    const fresh = dry.create({ name: old.name, gpu: gpuKey(old.gpu.split(' x')[0]) || gpus.DEFAULT_GPU, gpu_count: 1, image: 'simulated', idle_stop_minutes: old.idle_stop_minutes })
    if (own) podconfigs.set(fresh.id, own)
    return { ...fresh, custom_config: !!own }
  }
  const d = await details(podId, client)
  const key = gpuKey(d.gpu)
  const req: CreatePodRequest = {
    name: d.name || 'pod', gpu: key in gpus.GPUS ? key : gpus.AUTO, gpu_count: d.gpu_count || 1,
    instance_type: d.cloud === 'COMMUNITY' ? 'spot' : 'on-demand', image: d.image || 'configured', disk_gb: d.disk_gb || 20,
    idle_stop_minutes: idle.entry(podId)?.minutes ?? null, apply_mounts: null, config: podconfigs.get(podId),
  }
  const fresh = await create(req, client)
  await rp.terminatePod(podId, client)
  idle.forget(podId); podconfigs.forget(podId)
  return fresh
}

export interface GpuMenuEntry { value: string; text: string; price: number | null; stock: string | null; in_stock: boolean }

/** The GPU menu with what RunPod has in stock right now and the on-demand price; `auto` first. Without a key or on an error the plain menu. */
/** Datacenters that serve a network volume over RunPod's S3 API (docs.runpod.io/storage/s3-api, 2026-10-21). */
export const S3_DATACENTERS = new Set(['EU-CZ-1', 'EU-RO-1', 'EUR-IS-1', 'EUR-NO-1', 'US-CA-2', 'US-GA-2', 'US-IL-1', 'US-KS-2', 'US-MD-1', 'US-MO-1', 'US-MO-2', 'US-NC-1', 'US-NC-2', 'US-NE-1', 'US-WA-1'])

export interface DatacenterEntry { value: string; text: string; s3: boolean; cards: { key: string; name: string; vram: number; price: number; stock: string }[] }
/** The datacenter menu for the Configuration panel: every listed datacenter, S3 support, and our cards in stock there
 *  with the secure-cloud price per hour, cheapest first. Datacenters with a card in stock come first. */
let dcCache: { at: number; value: { datacenters: DatacenterEntry[]; live: boolean } } | null = null   // a few seconds to build; five minutes is fresh enough for stock
export async function datacenters(client?: rp.RunPodClient): Promise<{ datacenters: DatacenterEntry[]; live: boolean }> {
  if (!client && dcCache && Date.now() - dcCache.at < 300_000) return dcCache.value
  if (isDry()) return { datacenters: [{ value: 'CA-MTL-1', text: 'CA-MTL-1 · simulated', s3: false, cards: [] }, { value: 'EU-RO-1', text: 'EU-RO-1 · S3 · simulated', s3: true, cards: [] }], live: false }
  let stock: rp.DatacenterPrices[]
  try { stock = await rp.datacenterPrices(Object.values(gpus.GPUS).map((g) => g.id), client) } catch { return { datacenters: [], live: false } }
  const entries = stock.map((dc) => {
    const cards = dc.cards.map((c) => ({ key: gpuKey(c.id), name: gpus.GPUS[gpuKey(c.id)]?.name || c.id, vram: gpus.vram(gpuKey(c.id)), price: c.price as number, stock: c.stock as string })).sort((a, b) => a.price - b.price)
    const s3 = S3_DATACENTERS.has(dc.id)
    const text = [dc.id, cards.length ? cards.slice(0, 3).map((c) => `${c.name} $${c.price}/h ${c.stock}`).join(', ') : 'none of our cards in stock', s3 ? 'S3' : null].filter(Boolean).join(' · ')
    return { value: dc.id, text, s3, cards }
  })
  entries.sort((a, b) => (b.cards.length ? 1 : 0) - (a.cards.length ? 1 : 0) || (a.cards[0]?.price ?? 9) - (b.cards[0]?.price ?? 9) || a.value.localeCompare(b.value))
  const value = { datacenters: entries, live: true }
  if (!client) dcCache = { at: Date.now(), value }
  return value
}

/** With a network volume configured the prices are the secure-cloud prices in its datacenter, what such a pod pays;
 *  else RunPod's lowest price anywhere. `dataCenterId` overrides the configured one. */
export async function gpuMenu(client?: rp.RunPodClient, dataCenterId?: string): Promise<{ default: string; gpus: GpuMenuEntry[]; live: boolean; datacenter: string | null }> {
  const plain = gpus.menu().map((m) => ({ ...m, price: null, stock: null, in_stock: m.value === gpus.AUTO }))
  if (isDry()) return { default: gpus.DEFAULT_GPU, gpus: plain.map((m) => ({ ...m, in_stock: true, stock: 'simulated' })), live: false, datacenter: null }
  const cfg = mounts.load()
  const dc = dataCenterId ?? (cfg.network_volume_id ? cfg.data_center_id : '')
  let stock: rp.GpuStock[]
  try {
    if (dc) {
      const [here] = await rp.datacenterPrices(Object.values(gpus.GPUS).map((g) => g.id), client, [dc])
      stock = (here?.cards || []).map((c) => ({ id: c.id, price: c.price, stock: c.stock, secure: true, community: false }))
    } else stock = await rp.gpuStock(Object.values(gpus.GPUS).map((g) => g.id), client)
  } catch { return { default: gpus.DEFAULT_GPU, gpus: plain, live: false, datacenter: dc || null } }
  const byId = new Map(stock.map((s) => [s.id, s]))
  return {
    default: gpus.DEFAULT_GPU, live: true, datacenter: dc || null,
    gpus: plain.map((m) => {
      if (m.value === gpus.AUTO) return m
      const s = byId.get(gpus.GPUS[m.value].id)
      const inStock = !!(s?.stock && s.price != null)
      return { ...m, price: s?.price ?? null, stock: s?.stock ?? null, in_stock: inStock, text: inStock ? `${m.text} · $${s!.price}/h · ${s!.stock} stock` : `${m.text} · none in stock` }
    }),
  }
}
