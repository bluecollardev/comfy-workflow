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
  return `mutation { podFindAndDeployOnDemand(input: { ${f.join(', ')} }) { id imageName env machineId machine { podHostId } } }`
}

export interface RawPod {
  id: string; name: string; desiredStatus?: string; imageName?: string; gpuCount?: number; costPerHr?: number
  uptimeSeconds?: number; volumeInGb?: number; volumeMountPath?: string; machine?: { gpuDisplayName?: string } | null
  runtime?: { ports?: { ip: string; isIpPublic: boolean; privatePort: number; publicPort: number; type: string }[]; uptimeInSeconds?: number } | null
}

const POD_FIELDS = 'id name desiredStatus imageName gpuCount costPerHr uptimeSeconds volumeInGb volumeMountPath machine { gpuDisplayName } runtime { uptimeInSeconds ports { ip isIpPublic privatePort publicPort type } }'

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
