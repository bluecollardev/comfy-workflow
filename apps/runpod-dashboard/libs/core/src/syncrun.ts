/**
 * Sync, run from the app: push the folders mapped on this PC onto the pod's network volume over
 * SSH (rsync, additive, never deletes), or pull the renders back. The plan comes from sync.ts; this
 * module runs it step by step in the main process, streaming every rsync line to the page, holding
 * the pod's idle stop while it runs (a stop mid-copy cut the first attempts), and restoring it after.
 * The run outlives the window that started it; cancel aborts the rsync. No-spend mode simulates.
 */
import { execFile, spawn } from 'node:child_process'
import { bad } from './errors.js'
import * as idle from './idle.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import * as rp from './runpod.js'
import * as sync from './sync.js'
import * as settings from './settings.js'
import { volumeInfo } from './pods.js'

export interface SyncRequest { pod_id: string; direction: 'push' | 'pull'; only?: string[]; plates?: boolean; approved_by?: string }
export interface SyncEvent {
  kind: 'plan' | 'step' | 'line' | 'file' | 'progress' | 'problem' | 'step-done' | 'done' | 'error'
  key?: string; local?: string; remote?: string; text?: string; code?: number; steps?: sync.Step[]; path?: string; percent?: number
}
export interface SyncResult { steps: number; failed: number; cancelled: boolean }

/** The effective configuration for a pod: its own, else the default. */
const configFor = (podId: string) => podconfigs.get(podId) ?? mounts.load()

/** What a run would copy, without running it (the confirmation shows this). */
export function planFor(req: SyncRequest): sync.Step[] {
  const cfg = configFor(req.pod_id)
  const only = new Set(req.only || [])
  if (req.direction === 'pull') return sync.pullPlan(cfg, sync.listShots(cfg.folders.project || ''), only)
  if (req.plates && !req.approved_by?.trim()) throw bad('Plates leaving this PC need a named yes: give approved_by (shared/governance/policy/agent-permissions.md)')
  return sync.plan(cfg, only, !!req.plates)
}

/** One rsync line as an event: a percentage is progress, an rsync complaint is a problem, a bare path is a file that landed. */
export function classify(line: string): Pick<SyncEvent, 'kind' | 'path' | 'percent' | 'text'> {
  const aws = line.match(/^(upload|download|copy): (.+?) to (.+)$/)
  if (aws) { const key = [aws[2], aws[3]].find((x) => x.startsWith('s3://')) || aws[3]; return { kind: 'file', path: key.replace(/^s3:\/\/[^/]+\//, ''), text: line } }
  const done = line.match(/^Completed ([\d.]+) ([KMGT]iB)\/~?([\d.]+) ([KMGT]iB)/)
  if (done) { const u: Record<string, number> = { KiB: 1, MiB: 1024, GiB: 1024 ** 2, TiB: 1024 ** 3 }; const a = Number(done[1]) * u[done[2]], b = Number(done[3]) * u[done[4]]; return { kind: 'progress', percent: b ? Math.min(100, Math.round((a / b) * 100)) : 0, text: line } }
  const pct = line.match(/(\d{1,3})%/)
  if (pct && /\d+\s+\d{1,3}%/.test(line)) return { kind: 'progress', percent: Math.min(100, Number(pct[1])), text: line }
  if (/^rsync(\(\d+\))?:|^rsync error|No such file|Permission denied|cannot run|Connection refused|unexpected end of file|failed/i.test(line)) return { kind: 'problem', text: line }
  if (/^(sending incremental|receiving incremental|building file list|sent \d|total size|delta-transmission|\$ |done$|\.\/$)/.test(line) || !line.trim()) return { kind: 'line', text: line }
  if (/^\S/.test(line) && !/\s{2,}/.test(line) && !/^Transferred|^Number of/.test(line)) return { kind: 'file', path: line, text: line }
  return { kind: 'line', text: line }
}

export interface Transport { kind: 'ssh' | 's3' | 'none'; reason: string; volume?: { id: string; datacenter: string; name: string }; host?: string; port?: number }
/** How this pod's volume can be reached now: SSH into the pod while it runs; RunPod's S3 API onto the volume when
 *  it is off and the volume's datacenter serves it (keys needed); else nothing, with the reason. */
export async function transportFor(podId: string, client?: rp.RunPodClient): Promise<Transport> {
  const cfg = configFor(podId)
  if (mounts.dryRun(mounts.load())) return { kind: 'ssh', reason: 'no-spend mode: the copy is simulated' }
  const raw = await rp.getPod(podId, client)
  if (!raw) return { kind: 'none', reason: `No pod ${podId}` }
  if ((raw.runtime?.uptimeInSeconds ?? 0) > 0) {
    try { const { host, port } = sync.sshTarget(raw); return { kind: 'ssh', reason: `over SSH into the running pod (${host}:${port})`, host, port } }
    catch (e) { return { kind: 'none', reason: (e as Error).message } }
  }
  const vid = raw.networkVolumeId || cfg.network_volume_id
  if (!vid) return { kind: 'none', reason: 'The pod is off and has no network volume: start it, or give it a volume' }
  const v = await volumeInfo(vid, client)
  if (!v) return { kind: 'none', reason: `The pod is off and its volume ${vid} is not on this account` }
  if (!v.s3) return { kind: 'none', reason: `The pod is off and ${v.name} lives in ${v.datacenter}, which does not serve the S3 API: start the pod, or use a volume in an S3 datacenter (ADR-007)` }
  const keys = sync.s3Env(settings.lookup)
  if (!keys.AWS_ACCESS_KEY_ID || !keys.AWS_SECRET_ACCESS_KEY) return { kind: 'none', reason: `The pod is off; ${v.name} takes uploads over S3 with no pod, but the S3 keys are not set: enter them in Default Configuration (RunPod console, Settings, S3 API keys)` }
  return { kind: 's3', reason: `over RunPod's S3 API onto ${v.name} in ${v.datacenter}, no pod needed`, volume: { id: v.id, datacenter: v.datacenter, name: v.name } }
}

const rsyncVersion = () => new Promise<string>((res) => execFile('rsync', ['--version'], { timeout: 10_000 }, (_e, out) => res(String(out || ''))))

function runCommand(cmd: string[], onLine: (text: string) => void, signal: AbortSignal, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env })
    let buf = ''
    const feed = (chunk: Buffer) => {
      buf += chunk.toString()
      const parts = buf.split(/\r\n|\r|\n/); buf = parts.pop() || ''
      for (const p of parts) if (p.trim()) onLine(p)
    }
    child.stdout.on('data', feed); child.stderr.on('data', feed)
    const kill = () => child.kill('SIGTERM')
    signal.addEventListener('abort', kill, { once: true })
    child.on('error', (e) => { onLine(`cannot run ${cmd[0]}: ${e.message}`); resolve(127) })
    child.on('close', (code) => { if (buf.trim()) onLine(buf); signal.removeEventListener('abort', kill); resolve(code ?? 1) })
  })
}

export async function run(req: SyncRequest, send: (e: SyncEvent) => void, signal: AbortSignal, client?: rp.RunPodClient): Promise<SyncResult> {
  const steps = planFor(req)
  send({ kind: 'plan', steps })
  if (!steps.length) throw bad('Nothing to copy: map the folders in Default Configuration first')
  const dry = mounts.dryRun(mounts.load())
  const result: SyncResult = { steps: steps.length, failed: 0, cancelled: false }
  const transport = await transportFor(req.pod_id, client)
  if (transport.kind === 'none') throw bad(transport.reason)
  send({ kind: 'line', text: `Copying ${transport.reason}` })
  const mountPath = configFor(req.pod_id).mount_path || '/workspace'
  const progress = dry || transport.kind !== 'ssh' ? '--progress' : sync.progressFlag(await rsyncVersion())
  const env = transport.kind === 's3' ? { ...process.env, ...sync.s3Env(settings.lookup) } : process.env
  const held = idle.entry(req.pod_id)?.minutes
  if (held) idle.register(req.pod_id, 0)   // not stopped mid-copy; restored below
  try {
    for (const step of steps) {
      if (signal.aborted) { result.cancelled = true; break }
      send({ kind: 'step', key: step.key, local: step.local, remote: step.remote })
      let code = 0
      if (dry) {
        send({ kind: 'line', key: step.key, text: `simulated: ${step.local} -> ${step.remote} (no-spend mode: nothing is copied)` })
        for (const [i, name] of ['models/checkpoints/sim.safetensors', 'input/frame_0001.png', 'input/frame_0002.png'].entries()) { send({ kind: 'file', key: step.key, path: name, text: name }); send({ kind: 'progress', key: step.key, percent: Math.round(((i + 1) / 3) * 100), text: `${i + 1}/3` }) }
      } else {
        const cmd = transport.kind === 's3'
          ? (req.direction === 'push' ? sync.s3Cmd(step.local, transport.volume!, step.remote, { mountPath }) : sync.s3PullCmd(transport.volume!, step.remote, step.local, { mountPath }))
          : (req.direction === 'push' ? sync.rsyncCmd(step.local, transport.host!, transport.port!, step.remote, { progress, verbose: true }) : sync.rsyncPullCmd(transport.host!, transport.port!, step.remote, step.local, { progress, verbose: true }))
        send({ kind: 'line', key: step.key, text: '$ ' + cmd.map((c) => (/\s/.test(c) ? JSON.stringify(c) : c)).join(' ') })
        code = await runCommand(cmd, (text) => send({ key: step.key, ...classify(text) }), signal, env)
      }
      if (code !== 0 && !signal.aborted) result.failed++
      send({ kind: 'step-done', key: step.key, code })
      if (signal.aborted) { result.cancelled = true; break }
    }
  } finally {
    if (held) idle.register(req.pod_id, held)
  }
  send({ kind: 'done', text: result.cancelled ? 'cancelled' : result.failed ? `${result.failed} of ${result.steps} folders failed` : `${result.steps} folders in step` })
  return result
}
