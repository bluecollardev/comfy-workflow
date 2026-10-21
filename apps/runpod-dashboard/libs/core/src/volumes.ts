/**
 * Network volumes: the account's volumes with what each costs a month, which datacenter and
 * whether it takes uploads over RunPod's S3 API, which pods are attached to it (RunPod's
 * networkVolumeId per pod) and which pods' own configurations name it, and which one the
 * Default Configuration uses. Create, resize, delete, and "use as default". A volume with a
 * pod attached cannot be deleted here on purpose: delete or recreate the pod first.
 *
 * No-spend mode keeps simulated volumes in dry-volumes.json beside the simulated pods.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bad } from './errors.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import { S3_DATACENTERS, volumeCostPerMonth } from './pods.js'
import * as dry from './dry.js'
import * as rp from './runpod.js'
import { configDir } from './paths.js'

export interface VolumePod { id: string; name: string; status: string; via: 'runpod' | 'config' }
export interface Volume {
  id: string; name: string; size_gb: number; datacenter: string; cost_per_month: number; s3: boolean
  is_default: boolean       // the Default Configuration's volume
  pods: VolumePod[]         // attached on RunPod ('runpod'), or named by a pod's own configuration ('config')
}

const isDry = () => mounts.dryRun(mounts.load())
const dryFile = () => process.env.DRY_VOLUMES_FILE || join(configDir(), 'dry-volumes.json')
function dryLoad(): rp.NetworkVolume[] { try { return existsSync(dryFile()) ? JSON.parse(readFileSync(dryFile(), 'utf8')) : [] } catch { return [] } }
function drySave(v: rp.NetworkVolume[]) { mkdirSync(dirname(dryFile()), { recursive: true }); writeFileSync(dryFile(), JSON.stringify(v, null, 2)) }

const validate = (name: string, size: number, dc: string) => {
  if (!name?.trim()) throw bad('A volume needs a name')
  if (!Number.isInteger(size) || size < 10 || size > 4000) throw bad('Size is a whole number of GB, 10 to 4000')
  if (!dc?.trim()) throw bad('A volume lives in one datacenter: choose it')
}

/** Every volume of the account with its cost and its pods. */
export async function list(client?: rp.RunPodClient): Promise<Volume[]> {
  const cfg = mounts.load()
  const byVolume = new Map<string, VolumePod[]>()
  const add = (vid: string, p: VolumePod) => { if (!byVolume.has(vid)) byVolume.set(vid, []); const l = byVolume.get(vid)!; if (!l.some((x) => x.id === p.id)) l.push(p) }
  let volumes: rp.NetworkVolume[]
  if (isDry()) {
    volumes = dryLoad()
    for (const p of dry.list()) { const own = podconfigs.get(p.id); const vid = own?.network_volume_id || cfg.network_volume_id; if (vid) add(vid, { id: p.id, name: p.name, status: p.status, via: own ? 'config' : 'runpod' }) }
  } else {
    const [vols, pods] = await Promise.all([rp.listNetworkVolumes(client), rp.listPods(client)])
    volumes = vols
    for (const p of pods) {
      const status = (p.runtime?.uptimeInSeconds ?? 0) > 0 ? 'running' : (p.desiredStatus || '').toUpperCase() === 'RUNNING' ? 'starting' : 'stopped'
      if (p.networkVolumeId) add(p.networkVolumeId, { id: p.id, name: p.name, status, via: 'runpod' })
      const own = podconfigs.get(p.id)
      if (own?.network_volume_id && own.network_volume_id !== p.networkVolumeId) add(own.network_volume_id, { id: p.id, name: p.name, status, via: 'config' })
    }
  }
  return volumes.map((v) => ({
    id: v.id, name: v.name, size_gb: v.size, datacenter: v.dataCenterId, cost_per_month: volumeCostPerMonth(v.size), s3: S3_DATACENTERS.has(v.dataCenterId),
    is_default: v.id === cfg.network_volume_id, pods: byVolume.get(v.id) || [],
  })).sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name))
}

export async function create(input: { name: string; size_gb: number; datacenter: string }, client?: rp.RunPodClient): Promise<Volume> {
  validate(input.name, input.size_gb, input.datacenter)
  let v: rp.NetworkVolume
  if (isDry()) { v = { id: `dry-vol-${Date.now().toString(36)}`, name: input.name.trim(), size: input.size_gb, dataCenterId: input.datacenter }; drySave([...dryLoad(), v]) }
  else v = await rp.createNetworkVolume({ name: input.name.trim(), size: input.size_gb, dataCenterId: input.datacenter }, client)
  return (await list(client)).find((x) => x.id === v.id) || { id: v.id, name: v.name, size_gb: v.size, datacenter: v.dataCenterId, cost_per_month: volumeCostPerMonth(v.size), s3: S3_DATACENTERS.has(v.dataCenterId), is_default: false, pods: [] }
}

/** A volume only grows (RunPod never shrinks one). */
export async function resize(id: string, size_gb: number, client?: rp.RunPodClient): Promise<Volume> {
  const current = (await list(client)).find((v) => v.id === id)
  if (!current) throw bad(`No network volume ${id}`)
  if (!Number.isInteger(size_gb) || size_gb <= current.size_gb) throw bad(`A volume only grows: ${current.size_gb} GB now, so more than that`)
  if (size_gb > 4000) throw bad('4000 GB is the most RunPod allows')
  if (isDry()) drySave(dryLoad().map((v) => (v.id === id ? { ...v, size: size_gb } : v)))
  else await rp.updateNetworkVolume(id, { size: size_gb }, client)
  return (await list(client)).find((v) => v.id === id)!
}

/** Refused while a pod is attached: the data would go with it. */
export async function remove(id: string, client?: rp.RunPodClient): Promise<{ removed: string; was_default: boolean }> {
  const current = (await list(client)).find((v) => v.id === id)
  if (!current) throw bad(`No network volume ${id}`)
  const attached = current.pods.filter((p) => p.via === 'runpod')
  if (attached.length) throw bad(`${current.name} is attached to ${attached.map((p) => p.name).join(', ')}: delete or recreate those pods first`)
  if (isDry()) drySave(dryLoad().filter((v) => v.id !== id))
  else await rp.deleteNetworkVolume(id, client)
  if (current.is_default) { const cfg = mounts.load(); mounts.put({ ...cfg, network_volume_id: '', data_center_id: '' }) }
  return { removed: id, was_default: current.is_default }
}

/** Make this the Default Configuration's volume: its id and its datacenter, together, since a volume pins both. */
export async function useAsDefault(id: string, client?: rp.RunPodClient): Promise<Volume> {
  const current = (await list(client)).find((v) => v.id === id)
  if (!current) throw bad(`No network volume ${id}`)
  const cfg = mounts.load()
  mounts.put({ ...cfg, network_volume_id: id, data_center_id: current.datacenter })
  return { ...current, is_default: true }
}
