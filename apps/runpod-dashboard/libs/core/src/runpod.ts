/**
 * RunPod's GraphQL API, the six calls the Python SDK wrapped, with the same mutations and the
 * same fields. One function per call, a fetch injected for tests, the API key from the
 * environment or the caller. Errors carry RunPod's own message.
 */
import { CoreError } from './errors.js'

export interface RunPodClient { apiKey?: string; fetchFn?: typeof fetch; baseUrl?: string }

const str = (v: string) => JSON.stringify(v)   // a GraphQL string literal, quotes and backslashes escaped

export async function graphql<T = unknown>(query: string, client: RunPodClient = {}): Promise<T> {
  const apiKey = client.apiKey || process.env.RUNPOD_API_KEY
  if (!apiKey) throw new CoreError(401, 'RUNPOD_API_KEY not set')
  const base = client.baseUrl || process.env.RUNPOD_API_BASE_URL || 'https://api.runpod.io'
  const res = await (client.fetchFn || fetch)(`${base}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'User-Agent': 'comfy-workflow pod manager' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  })
  if (res.status === 401) throw new CoreError(401, 'Unauthorized request, please check your API key.')
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (body.errors?.length) throw new CoreError(502, body.errors[0].message)
  return body.data as T
}

export interface CreatePodInput {
  name: string; imageName: string; gpuTypeId: string; cloudType?: 'ALL' | 'SECURE' | 'COMMUNITY'
  gpuCount?: number; volumeInGb?: number; containerDiskInGb?: number; ports?: string; volumeMountPath?: string
  env?: Record<string, string>; networkVolumeId?: string; dataCenterId?: string; startSsh?: boolean; supportPublicIp?: boolean
  containerRegistryAuthId?: string
}

/** The podFindAndDeployOnDemand mutation, field for field as the Python SDK builds it. */
export function deployMutation(i: CreatePodInput): string {
  const f = [`name: ${str(i.name)}`, `imageName: ${str(i.imageName)}`, `cloudType: ${i.cloudType || 'ALL'}`]
  if (i.startSsh !== false) f.push('startSsh: true')
  f.push(`gpuTypeId: ${str(i.gpuTypeId)}`, `supportPublicIp: ${i.supportPublicIp !== false}`)
  if (i.gpuCount != null) f.push(`gpuCount: ${i.gpuCount}`)
  if (i.volumeInGb != null) f.push(`volumeInGb: ${i.volumeInGb}`)
  f.push(i.dataCenterId ? `dataCenterId: ${str(i.dataCenterId)}` : 'dataCenterId: null')
  if (i.containerDiskInGb != null) f.push(`containerDiskInGb: ${i.containerDiskInGb}`)
  if (i.ports) f.push(`ports: ${str(i.ports.replace(/ /g, ''))}`)
  if (i.volumeMountPath) f.push(`volumeMountPath: ${str(i.volumeMountPath)}`)
  if (i.env) f.push(`env: [${Object.entries(i.env).map(([k, v]) => `{ key: ${str(k)}, value: ${str(String(v))} }`).join(', ')}]`)
  if (i.networkVolumeId) f.push(`networkVolumeId: ${str(i.networkVolumeId)}`)
  if (i.containerRegistryAuthId) f.push(`containerRegistryAuthId: ${str(i.containerRegistryAuthId)}`)
  return `mutation { podFindAndDeployOnDemand(input: { ${f.join(', ')} }) { id imageName env machineId machine { podHostId } } }`
}

export interface RawPod {
  id: string; name: string; desiredStatus?: string; lastStatusChange?: string; imageName?: string; gpuCount?: number; costPerHr?: number
  uptimeSeconds?: number; volumeInGb?: number; volumeMountPath?: string; ports?: string | null; machine?: { gpuDisplayName?: string } | null
  runtime?: { ports?: { ip: string; isIpPublic: boolean; privatePort: number; publicPort: number; type: string }[]; uptimeInSeconds?: number } | null
}

const POD_FIELDS = 'id name desiredStatus lastStatusChange imageName gpuCount costPerHr uptimeSeconds volumeInGb volumeMountPath ports machine { gpuDisplayName } runtime { uptimeInSeconds ports { ip isIpPublic privatePort publicPort type } }'

export async function createPod(input: CreatePodInput, client?: RunPodClient): Promise<{ id: string }> {
  const d = await graphql<{ podFindAndDeployOnDemand: { id: string } | null }>(deployMutation(input), client)
  if (!d?.podFindAndDeployOnDemand?.id) throw new CoreError(500, 'Failed to create pod')
  return d.podFindAndDeployOnDemand
}

export async function listPods(client?: RunPodClient): Promise<RawPod[]> {
  const d = await graphql<{ myself: { pods: RawPod[] } }>(`query myPods { myself { pods { ${POD_FIELDS} } } }`, client)
  return d?.myself?.pods || []
}

export async function getPod(podId: string, client?: RunPodClient): Promise<RawPod | null> {
  const d = await graphql<{ pod: RawPod | null }>(`query pod { pod(input: { podId: ${str(podId)} }) { ${POD_FIELDS} } }`, client)
  return d?.pod || null
}

export const stopPod = (podId: string, client?: RunPodClient) =>
  graphql(`mutation { podStop(input: { podId: ${str(podId)} }) { id desiredStatus } }`, client)

export const resumePod = (podId: string, gpuCount = 1, client?: RunPodClient) =>
  graphql(`mutation { podResume(input: { podId: ${str(podId)}, gpuCount: ${gpuCount} }) { id desiredStatus imageName env machineId machine { podHostId } } }`, client)

export const terminatePod = (podId: string, client?: RunPodClient) =>
  graphql(`mutation { podTerminate(input: { podId: ${str(podId)} }) }`, client)

export interface GpuStock { id: string; price: number | null; stock: string | null; secure: boolean; community: boolean }

/** What RunPod has in stock for a set of gpu ids, with the on-demand price. */
export async function gpuStock(ids: string[], client?: RunPodClient): Promise<GpuStock[]> {
  const d = await graphql<{ gpuTypes: { id: string; secureCloud: boolean; communityCloud: boolean; lowestPrice: { uninterruptablePrice: number | null; stockStatus: string | null } | null }[] }>(
    'query { gpuTypes { id secureCloud communityCloud lowestPrice(input:{gpuCount:1}) { uninterruptablePrice stockStatus } } }', client)
  const want = new Set(ids)
  return (d?.gpuTypes || []).filter((g) => want.has(g.id)).map((g) => ({ id: g.id, price: g.lowestPrice?.uninterruptablePrice ?? null, stock: g.lowestPrice?.stockStatus ?? null, secure: g.secureCloud, community: g.communityCloud }))
}

/** The cards one datacenter has available right now (a network volume pins pods to its datacenter). */
export async function datacenterStock(dataCenterId: string, client?: RunPodClient): Promise<string[]> {
  const d = await graphql<{ dataCenters: { id: string; gpuAvailability: { available: boolean; gpuTypeId: string }[] | null }[] }>(
    'query { dataCenters { id gpuAvailability { available gpuTypeId } } }', client)
  const dc = (d?.dataCenters || []).find((x) => x.id === dataCenterId)
  return (dc?.gpuAvailability || []).filter((g) => g.available).map((g) => g.gpuTypeId)
}

/** Every listed datacenter with, for the given cards, the secure-cloud price and stock there. One request:
 *  the lowestPrice query takes a dataCenterId, aliased once per datacenter. Secure cloud, because a network
 *  volume pins its pods there and that is the price they pay. */
export interface DatacenterPrices { id: string; cards: { id: string; price: number | null; stock: string | null }[] }
export async function datacenterPrices(want: string[], client?: RunPodClient, only?: string[]): Promise<DatacenterPrices[]> {
  const dcs = await graphql<{ dataCenters: { id: string; listed: boolean }[] }>('query { dataCenters { id listed } }', client)
  const ids = (dcs?.dataCenters || []).filter((d) => d.listed && (!only || only.includes(d.id))).map((d) => d.id)
  if (!ids.length) return []
  const alias = (id: string) => 'dc_' + id.replace(/[^A-Za-z0-9]/g, '_')
  const q = `query { ${ids.map((id) => `${alias(id)}: gpuTypes { id lowestPrice(input:{gpuCount:1, dataCenterId:${str(id)}, secureCloud:true}) { uninterruptablePrice stockStatus } }`).join(' ')} }`
  const d = await graphql<Record<string, { id: string; lowestPrice: { uninterruptablePrice: number | null; stockStatus: string | null } | null }[]>>(q, client)
  const w = new Set(want)
  return ids.map((id) => ({
    id,
    cards: (d?.[alias(id)] || []).filter((g) => w.has(g.id) && g.lowestPrice?.uninterruptablePrice != null && g.lowestPrice?.stockStatus)
      .map((g) => ({ id: g.id, price: g.lowestPrice!.uninterruptablePrice, stock: g.lowestPrice!.stockStatus })),
  }))
}

/** RunPod's v1 REST API (rest.runpod.io/v1): network volumes. */
export interface NetworkVolume { id: string; name: string; size: number; dataCenterId: string }
export async function networkVolume(id: string, client: RunPodClient = {}): Promise<NetworkVolume | null> {
  const apiKey = client.apiKey || process.env.RUNPOD_API_KEY
  if (!apiKey) throw new CoreError(401, 'RUNPOD_API_KEY not set')
  const base = client.baseUrl || process.env.RUNPOD_REST_BASE_URL || 'https://rest.runpod.io'
  const res = await (client.fetchFn || fetch)(`${base}/v1/networkvolumes/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  if (res.status === 404) return null
  if (!res.ok) throw new CoreError(502, `RunPod answered ${res.status} for volume ${id}`)
  return (await res.json()) as NetworkVolume
}

/** RunPod's v2 REST API (api.runpod.io/v2): the pod record with its status text, and the log stream. */
export async function rest<T = unknown>(path: string, client: RunPodClient = {}, init: RequestInit = {}): Promise<T> {
  const apiKey = client.apiKey || process.env.RUNPOD_API_KEY
  if (!apiKey) throw new CoreError(401, 'RUNPOD_API_KEY not set')
  const base = client.baseUrl || process.env.RUNPOD_API_BASE_URL || 'https://api.runpod.io'
  const res = await (client.fetchFn || fetch)(`${base}/v2${path}`, { ...init, headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(init.headers || {}) }, signal: init.signal ?? AbortSignal.timeout(30_000) })
  if (res.status === 401 || res.status === 403) throw new CoreError(res.status, 'RunPod refused the API key for this request')
  if (res.status === 404) throw new CoreError(404, `RunPod has no such pod (${path})`)
  if (!res.ok) throw new CoreError(502, `RunPod answered ${res.status} for ${path}`)
  return (await res.json()) as T
}

export interface PodRecord {
  id: string; name?: string; desiredStatus?: string; lastStatusChange?: string; image?: string; imageName?: string
  cost?: number; costPerHr?: number; cloud?: string; dataCenterId?: string; createdAt?: string; actions?: string[]
  gpu?: { id?: string; count?: number; memory?: number } | null; disk?: number; volume?: number; uptimeSeconds?: number
  ports?: unknown; publicIp?: string; portMappings?: Record<string, number>; env?: Record<string, string>
}
export const podDetails = (id: string, client?: RunPodClient) => rest<PodRecord>(`/pods/${encodeURIComponent(id)}`, client)

export interface LogEvent { source: 'container' | 'system' | string; line: string; ts: string }

/** Stream a pod's logs (Server-Sent Events): `tail` lines of backfill, then live, until the signal aborts. */
export async function streamLogs(id: string, opts: { tail?: number; since?: string; source?: string } = {}, onEvent: (e: LogEvent) => void, signal?: AbortSignal, client: RunPodClient = {}): Promise<void> {
  const apiKey = client.apiKey || process.env.RUNPOD_API_KEY
  if (!apiKey) throw new CoreError(401, 'RUNPOD_API_KEY not set')
  const base = client.baseUrl || process.env.RUNPOD_API_BASE_URL || 'https://api.runpod.io'
  const q = new URLSearchParams()
  if (opts.tail != null) q.set('tail', String(opts.tail))
  if (opts.since) q.set('since', opts.since)
  if (opts.source) q.set('source', opts.source)
  const res = await (client.fetchFn || fetch)(`${base}/v2/pods/${encodeURIComponent(id)}/logs?${q}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' }, signal })
  if (!res.ok || !res.body) throw new CoreError(res.status === 404 ? 404 : 502, `RunPod answered ${res.status} for the log stream`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
        const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')
        if (!data) continue
        try { onEvent(JSON.parse(data) as LogEvent) } catch { onEvent({ source: 'system', line: data, ts: '' }) }
      }
    }
  } catch (e) {
    if (!(signal?.aborted)) throw e
  }
}
