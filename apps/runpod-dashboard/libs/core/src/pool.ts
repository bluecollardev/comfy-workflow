/**
 * The agent pool (docs/ADR-002): a set of pods with a label, each one an "agent" of a kind
 * (image-gen, video-gen, upscale). The MCP server's create/stop/resume/delete/health tools act on
 * it. The Python pool manager kept the pool in memory and lost it on every restart; here it lives
 * in ~/.config/runpod-pod-manager/pool.json, so a pool outlives the stdio server Claude Code
 * starts and stops per session. The pods are the core's (pods.ts), so no-spend mode, the idle
 * watch and the mount configuration apply to an agent exactly as to any pod the dashboard makes.
 *
 * The spend gate is not here: governance.namedYes is the caller's check, before create().
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bad, CoreError } from './errors.js'
import * as gpus from './gpus.js'
import * as idle from './idle.js'
import * as mounts from './mounts.js'
import * as pods from './pods.js'
import { configDir } from './paths.js'
import type { RunPodClient } from './runpod.js'

export interface AgentConfig { agent_name: string; gpu_type?: string; storage_gb?: number }
export interface PoolAgent {
  agent_id: string; pod_id: string; agent_name: string; gpu_type: string
  status: string   // the pod's last known status: starting, running, stopped, or missing when RunPod no longer has it
  created_at: string; comfyui_url: string; api_url: string; ssh_command: string; health: Record<string, unknown> | null
}
export interface PoolStatus { total_agents: number; running_agents: number; stopped_agents: number; agents: PoolAgent[]; total_cost_per_hour: number; created_at: string }

export const file = () => process.env.POOL_FILE || join(configDir(), 'pool.json')
export const dryRun = () => mounts.dryRun(mounts.load())
/** The cards an agent may ask for: the dashboard's table plus `auto`; a full RunPod id also passes (gpus.runpodId). */
export const GPU_TYPES = [gpus.AUTO, ...Object.keys(gpus.GPUS)]

export function load(): PoolAgent[] {
  const f = file()
  if (!existsSync(f)) return []
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return [] }
}
function save(agents: PoolAgent[]) {
  const f = file()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(agents, null, 2) + '\n')
}
export const agents = (): PoolAgent[] => load()

export function agent(agentId: string): PoolAgent {
  const a = load().find((x) => x.agent_id === agentId)
  if (!a) throw new CoreError(404, `Agent not found: ${agentId}`)
  return a
}
function update(agentId: string, patch: Partial<PoolAgent>): PoolAgent {
  const all = load()
  const a = all.find((x) => x.agent_id === agentId)
  if (!a) throw new CoreError(404, `Agent not found: ${agentId}`)
  Object.assign(a, patch); save(all)
  return a
}

/** Ours when it has been pushed somewhere a pod can pull it, else the stock ComfyUI image: the Python booted
 *  RunPod's stock template, and an agent must be creatable on a PC that has not built and pushed an image yet. */
export function imageChoice(cfg: mounts.MountsConfig): 'configured' | 'prebuilt' {
  try { pods.resolveImage('configured', cfg); return 'configured' } catch { return 'prebuilt' }
}

/** Create an agent's pod and record it. Runs once the named yes is in hand (governance.namedYes). */
export async function create(cfg: AgentConfig, client?: RunPodClient): Promise<PoolAgent> {
  const agentName = (cfg.agent_name || '').trim()
  if (!agentName) throw bad('An agent needs a name (agent_name)')
  const storage = cfg.storage_gb ?? 100
  if (!Number.isInteger(storage) || storage < 50 || storage > 500) throw bad('storage_gb must be a whole number between 50 and 500')
  const gpu = cfg.gpu_type || gpus.DEFAULT_GPU
  const all = load()
  const pod = await pods.create({ name: `comfy-${agentName}-${all.length}`, gpu, volume_gb: storage, image: imageChoice(mounts.load()) }, client)
  const url = pod.web_ui_url || idle.proxyUrl(pod.id)   // null while a simulated pod boots; the proxy URL is fixed by the id either way
  const a: PoolAgent = {
    agent_id: `${agentName}-${pod.id.slice(0, 8)}`, pod_id: pod.id, agent_name: agentName, gpu_type: gpu, status: pod.status,
    created_at: new Date().toISOString(), comfyui_url: url, api_url: url,   // ComfyUI is the agent's API: /prompt, /history, /system_stats
    ssh_command: pod.ssh_command, health: null,
  }
  all.push(a); save(all)
  return a
}

export async function stop(agentId: string, client?: RunPodClient): Promise<PoolAgent> {
  const a = agent(agentId)
  await pods.stop(a.pod_id, client)
  return update(agentId, { status: 'stopped' })
}
export async function resume(agentId: string, client?: RunPodClient): Promise<PoolAgent> {
  const a = agent(agentId)
  await pods.resume(a.pod_id, client)
  return update(agentId, { status: 'starting' })
}
export async function remove(agentId: string, client?: RunPodClient): Promise<PoolAgent> {
  const a = agent(agentId)
  await pods.remove(a.pod_id, client)
  save(load().filter((x) => x.agent_id !== agentId))
  return a
}

/** Every agent's status read back from its pod; a pod RunPod no longer has is `missing`, not dropped, so it is visible. */
export async function refresh(client?: RunPodClient): Promise<PoolAgent[]> {
  const all = load()
  for (const a of all) {
    try { a.status = (await pods.get(a.pod_id, client)).status } catch (e) { if ((e as CoreError).status === 404) a.status = 'missing'; else throw e }
  }
  save(all)
  return all
}

const billing = (status: string) => status === 'running' || status === 'starting'   // a starting pod is already billed

async function costPerHour(podId: string, client?: RunPodClient): Promise<number | null> {
  try { return (await pods.details(podId, client)).cost_per_hr } catch { return null }
}

/** The pool as a whole: counts, the agents, what the running ones cost per hour right now. */
export async function status(client?: RunPodClient): Promise<PoolStatus> {
  const all = await refresh(client)
  let cost = 0
  for (const a of all) if (billing(a.status)) cost += (await costPerHour(a.pod_id, client)) ?? 0
  const running = all.filter((a) => billing(a.status)).length
  return { total_agents: all.length, running_agents: running, stopped_agents: all.length - running, agents: all, total_cost_per_hour: cost, created_at: new Date().toISOString() }
}

/** One agent with its pod's live status folded in. */
export async function info(agentId: string, client?: RunPodClient): Promise<Record<string, unknown>> {
  const a = agent(agentId)
  const live = await pods.get(a.pod_id, client)
  update(agentId, { status: live.status })
  return { ...a, ...live, status: live.status, cost_per_hour: billing(live.status) ? await costPerHour(a.pod_id, client) : 0 }
}

/** Does the agent's ComfyUI answer? Recorded on the agent, as the Python did. */
export async function healthCheck(agentId: string, fetchFn: typeof fetch = fetch, client?: RunPodClient): Promise<{ healthy: boolean; agent: PoolAgent }> {
  const a = agent(agentId)
  const healthy = dryRun() ? !!(await pods.get(a.pod_id, client)).comfy_ready : await pods.comfyReady(a.comfyui_url, fetchFn)
  const health = { status: healthy ? 200 : 'unreachable', url: `${a.comfyui_url}/system_stats`, timestamp: new Date().toISOString() }
  return { healthy, agent: update(agentId, { health }) }
}

/** Queue a workflow (API format) on the agent's ComfyUI; the job id is ComfyUI's prompt_id. */
export async function submitJob(agentId: string, workflowJson: string, promptName?: string, fetchFn: typeof fetch = fetch): Promise<{ job_id: string; agent_id: string; api_url: string; status_url: string; simulated?: boolean }> {
  const a = agent(agentId)
  let prompt: unknown
  try { prompt = JSON.parse(workflowJson) } catch { throw bad('workflow_json is not valid JSON (ComfyUI API format expected)') }
  if (dryRun()) {
    const id = `dry-job-${Math.random().toString(36).slice(2, 10)}`
    return { job_id: id, agent_id: a.agent_id, api_url: `${a.api_url}/prompt`, status_url: `${a.api_url}/history/${id}`, simulated: true }
  }
  const r = await fetchFn(`${a.api_url}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, client_id: 'runpod-pod-manager', extra_data: promptName ? { name: promptName } : undefined }), signal: AbortSignal.timeout(15_000) })
  if (r.status !== 200) throw new CoreError(502, `ComfyUI refused the workflow (HTTP ${r.status}): ${(await r.text()).slice(0, 500)}`)
  const body = (await r.json()) as { prompt_id?: string }
  if (!body.prompt_id) throw new CoreError(502, 'ComfyUI answered without a prompt_id')
  return { job_id: body.prompt_id, agent_id: a.agent_id, api_url: `${a.api_url}/prompt`, status_url: `${a.api_url}/history/${body.prompt_id}` }
}

/** A job's state from ComfyUI's history: PENDING until it is there, then its status string and the outputs. */
export async function jobStatus(agentId: string, jobId: string, fetchFn: typeof fetch = fetch): Promise<{ status: string; outputs: unknown[]; simulated?: boolean }> {
  const a = agent(agentId)
  if (dryRun()) return { status: 'COMPLETED', outputs: [], simulated: true }
  const r = await fetchFn(`${a.api_url}/history/${encodeURIComponent(jobId)}`, { signal: AbortSignal.timeout(15_000) })
  if (r.status !== 200) throw new CoreError(502, `ComfyUI history answered HTTP ${r.status}`)
  const entry = ((await r.json()) as Record<string, { status?: { status_str?: string; completed?: boolean }; outputs?: Record<string, unknown> }>)[jobId]
  if (!entry) return { status: 'PENDING', outputs: [] }
  const status = (entry.status?.status_str || (entry.status?.completed ? 'success' : 'running')).toUpperCase()
  return { status: status === 'SUCCESS' ? 'COMPLETED' : status, outputs: Object.entries(entry.outputs || {}).map(([node_id, out]) => ({ node_id, ...(out as object) })) }
}
