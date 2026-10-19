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
  let gpuTypeId: string
  try { gpuTypeId = gpus.runpodId(req.gpu || gpus.DEFAULT_GPU) } catch (e) { throw bad((e as Error).message) }
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
  const pod = await rp.createPod(input, client)
  if (idleMinutes > 0) idle.register(pod.id, idleMinutes)
  return {
    id: pod.id, name: req.name, status: 'starting', gpu: `${req.gpu || gpus.DEFAULT_GPU} x${input.gpuCount}`,
    vram: gpus.vram(req.gpu || gpus.DEFAULT_GPU) * (input.gpuCount || 1), uptime_seconds: 0,
    web_ui_url: idle.proxyUrl(pod.id), ssh_command: `ssh root@${pod.id}.proxy.runpod.io`, idle_stop_minutes: idleMinutes > 0 ? idleMinutes : 0,
  }
}

/** A RunPod pod as the dashboard shows it. */
export function toStatus(p: rp.RawPod): PodStatus {
  const uptime = p.runtime?.uptimeInSeconds ?? p.uptimeSeconds ?? null
  const running = uptime != null && uptime > 0
  return {
    id: p.id, name: p.name || 'Unknown', status: running ? 'running' : 'stopped',
    gpu: p.machine?.gpuDisplayName || String(p.gpuCount ?? '?'), vram: gpus.vram(p.machine?.gpuDisplayName || '') || 24,
    uptime_seconds: uptime, web_ui_url: running ? idle.proxyUrl(p.id) : null,
    ssh_command: `ssh root@${p.id}.proxy.runpod.io`, idle_stop_minutes: idle.entry(p.id)?.minutes ?? 0,
  }
}

export const list = async (client?: rp.RunPodClient): Promise<PodStatus[]> => (await rp.listPods(client)).map(toStatus)

export async function get(podId: string, client?: rp.RunPodClient): Promise<PodStatus> {
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
  return { stats: stats(pods), pods }
}

export async function stop(podId: string, client?: rp.RunPodClient) { await rp.stopPod(podId, client); return { message: `Pod ${podId} stopped`, pod_id: podId } }
export async function resume(podId: string, client?: rp.RunPodClient) { await rp.resumePod(podId, 1, client); return { message: `Pod ${podId} resumed`, pod_id: podId } }
export async function remove(podId: string, client?: rp.RunPodClient) { await rp.terminatePod(podId, client); idle.forget(podId); return { message: `Pod ${podId} deleted`, pod_id: podId } }

/** The two callbacks the idle loop needs, over RunPod. */
export const runningIds = (client?: rp.RunPodClient) => async () => new Set((await rp.listPods(client)).filter((p) => (p.runtime?.uptimeInSeconds ?? p.uptimeSeconds ?? 0) > 0).map((p) => p.id))
export const stopper = (client?: rp.RunPodClient) => async (id: string) => { await rp.stopPod(id, client) }
