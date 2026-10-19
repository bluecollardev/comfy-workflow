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
import * as rp from './runpod.js'
import * as dry from './dry.js'

export const PREBUILT_IMAGE = 'ashleykza/comfyui:latest'   // the stock image: no packs, ignores COMFY_LINKS

export interface CreatePodRequest {
  name: string; gpu?: string; gpu_count?: number; instance_type?: 'on-demand' | 'spot'; volume_gb?: number; disk_gb?: number
  image?: string; env_vars?: Record<string, string>; build_args?: Record<string, string>; pip_requirements?: string
  custom_nodes?: { name: string; url: string; branch: string; path: string }[]; start_ssh?: boolean; start_jupyter?: boolean
  apply_mounts?: boolean | null; idle_stop_minutes?: number | null
}
export interface PodStatus {
  id: string; name: string; status: 'running' | 'stopped' | 'starting'; gpu: string; vram: number
  uptime_seconds: number | null; web_ui_url: string | null; ssh_command: string; idle_stop_minutes: number
  console_url?: string; status_text?: string
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
    if (ov.network_volume_id) {
      volume.networkVolumeId = ov.network_volume_id; volume.volumeMountPath = ov.volume_mount_path
      if (ov.data_center_id) volume.dataCenterId = ov.data_center_id
      volumeGb = 0   // the network volume carries the data; a per-pod volume beside it is billed for nothing
    }
  }
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
      startSsh: req.start_ssh !== false, ports: '8188/http,22/tcp', env, ...volume,
    },
    idleMinutes,
  }
}

/** Create a pod from the dashboard's request. */
export async function create(req: CreatePodRequest, client?: rp.RunPodClient, credentialsEnv: Record<string, string> = {}): Promise<PodStatus> {
  if (!req.name?.trim()) throw bad('A pod needs a name')
  const cfg = mounts.load()
  const { input, idleMinutes } = plan(req, cfg, credentialsEnv)
  if (mounts.dryRun(cfg)) return dry.create({ name: req.name, gpu: req.gpu, gpu_count: input.gpuCount, image: input.imageName, idle_stop_minutes: idleMinutes > 0 ? idleMinutes : 0 })
  const { pod, gpuId } = await deployWithFallback(input, client)
  if (idleMinutes > 0) idle.register(pod.id, idleMinutes)
  const key = gpuKey(gpuId)
  return {
    id: pod.id, name: req.name, status: 'starting', gpu: `${key} x${input.gpuCount}`,
    vram: gpus.vram(key) * (input.gpuCount || 1), uptime_seconds: 0,
    web_ui_url: idle.proxyUrl(pod.id), ssh_command: `ssh root@${pod.id}.proxy.runpod.io`, idle_stop_minutes: idleMinutes > 0 ? idleMinutes : 0,
  }
}

const gpuKey = (id: string) => Object.entries(gpus.GPUS).find(([, g]) => g.id === id)?.[0] || id
const NO_STOCK = /no longer any instances available|not enough|no instances/i

/** The cards to try, cheapest in stock first, for `auto`; the one asked for otherwise. */
export async function candidates(gpuTypeId: string, client?: rp.RunPodClient): Promise<string[]> {
  if (gpuTypeId !== gpus.AUTO) return [gpuTypeId]
  const ids = Object.values(gpus.GPUS).map((g) => g.id)
  let stock: rp.GpuStock[] = []
  try { stock = await rp.gpuStock(ids, client) } catch { /* no stock answer: try them all in table order */ }
  const inStock = stock.filter((g) => g.stock && g.price != null).sort((a, b) => (a.price as number) - (b.price as number)).map((g) => g.id)
  return [...inStock, ...ids.filter((id) => !inStock.includes(id))]
}

/** Deploy on the first card RunPod will give; a "no instances" answer moves to the next card, then to the other cloud. */
async function deployWithFallback(input: rp.CreatePodInput, client?: rp.RunPodClient): Promise<{ pod: { id: string }; gpuId: string }> {
  const cards = await candidates(input.gpuTypeId, client)
  const clouds: rp.CreatePodInput['cloudType'][] = input.gpuTypeId === gpus.AUTO ? [input.cloudType, input.cloudType === 'SECURE' ? 'COMMUNITY' : 'SECURE'] : [input.cloudType]
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
    uptime_seconds: uptime, web_ui_url: running ? idle.proxyUrl(p.id) : null,
    ssh_command: `ssh root@${p.id}.proxy.runpod.io`, idle_stop_minutes: idle.entry(p.id)?.minutes ?? 0,
    console_url: consoleUrl(p.id), status_text: p.lastStatusChange || p.desiredStatus || '',
  }
}

const isDry = () => mounts.dryRun(mounts.load())
export const list = async (client?: rp.RunPodClient): Promise<PodStatus[]> => (isDry() ? dry.list() : (await rp.listPods(client)).map(toStatus))

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

export async function dashboard(client?: rp.RunPodClient) {
  const pods = await list(client)
  return { stats: stats(pods), pods, dry_run: isDry() }
}

export async function stop(podId: string, client?: rp.RunPodClient) { if (isDry()) return dry.stop(podId); await rp.stopPod(podId, client); return { message: `Pod ${podId} stopped`, pod_id: podId } }
export async function resume(podId: string, client?: rp.RunPodClient) { if (isDry()) return dry.resume(podId); await rp.resumePod(podId, 1, client); return { message: `Pod ${podId} resumed`, pod_id: podId } }
export async function remove(podId: string, client?: rp.RunPodClient) { if (isDry()) { idle.forget(podId); return dry.remove(podId) } await rp.terminatePod(podId, client); idle.forget(podId); return { message: `Pod ${podId} deleted`, pod_id: podId } }

/** The two callbacks the idle loop needs, over RunPod. */
export const runningIds = (client?: rp.RunPodClient) => async () => (isDry() ? dry.runningIds() : new Set((await rp.listPods(client)).filter((p) => (p.runtime?.uptimeInSeconds ?? p.uptimeSeconds ?? 0) > 0).map((p) => p.id)))
export const stopper = (client?: rp.RunPodClient) => async (id: string) => { if (isDry()) { dry.stop(id); return } await rp.stopPod(id, client) }

export interface PodDetails {
  id: string; name: string; status: string; status_text: string; cost_per_hr: number | null; cloud: string; datacenter: string
  gpu: string; gpu_count: number; image: string; disk_gb: number; volume_gb: number; created_at: string; actions: string[]
  console_url: string; web_ui_url: string | null; ssh_command: string
}

export const consoleUrl = (id: string) => `https://www.runpod.io/console/pods/${id}`

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
    dry.remove(podId)
    return dry.create({ name: old.name, gpu: gpuKey(old.gpu.split(' x')[0]) || gpus.DEFAULT_GPU, gpu_count: 1, image: 'simulated', idle_stop_minutes: old.idle_stop_minutes })
  }
  const d = await details(podId, client)
  const key = gpuKey(d.gpu)
  const req: CreatePodRequest = {
    name: d.name || 'pod', gpu: key in gpus.GPUS ? key : gpus.AUTO, gpu_count: d.gpu_count || 1,
    instance_type: d.cloud === 'COMMUNITY' ? 'spot' : 'on-demand', image: d.image || 'configured', disk_gb: d.disk_gb || 20,
    idle_stop_minutes: idle.entry(podId)?.minutes ?? null, apply_mounts: null,
  }
  const fresh = await create(req, client)
  await rp.terminatePod(podId, client)
  idle.forget(podId)
  return fresh
}
