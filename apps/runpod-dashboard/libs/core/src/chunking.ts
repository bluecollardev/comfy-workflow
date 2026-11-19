/**
 * Chunked runs (docs/CHUNKING.md): a long frame sequence is run as consecutive ranges so system RAM never holds the whole shot.
 *  1. `plan` / `writeJobFiles`: split a range into chunks and write one job file per chunk into queue/<project>/in/.
 *  2. `run` (MCP run_shot_chunked): run the chunks one after another on a pod, patching the graph's range each time.
 *  3. The RAM guard: the pod's container memory (its cgroup, not the host's) is read over SSH while a chunk runs; past the limit
 *     the run is interrupted, ComfyUI is told to free memory, and the job stops saying which chunk and why.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CoreError } from './errors.js'
import * as history from './history.js'
import * as failures from './failures.js'
import * as mounts from './mounts.js'
import { REPO_ROOT } from './paths.js'
import * as podpull from './podpull.js'
import * as pods from './pods.js'
import * as rp from './runpod.js'
import * as runflows from './runflows.js'
import * as sync from './sync.js'

export const DEFAULT_RAM_GUARD_PCT = 85
export const DEFAULT_CHUNK = 100
export const MAX_CHUNKS = 2000

// ----- 1. the plan -----

export interface Chunk { n: number; first: number; last: number; count: number }
export function plan(first: number, last: number, chunk: number): Chunk[] {
  for (const [k, v] of [['first', first], ['last', last], ['chunk', chunk]] as const) if (!Number.isInteger(v) || v < 0) throw new CoreError(400, `${k} must be a whole number of 0 or more`)
  if (chunk < 1) throw new CoreError(400, 'chunk must be at least 1 frame')
  if (last < first) throw new CoreError(400, `last (${last}) is before first (${first})`)
  const out: Chunk[] = []
  for (let a = first; a <= last; a += chunk) {
    const b = Math.min(a + chunk - 1, last)
    out.push({ n: out.length + 1, first: a, last: b, count: b - a + 1 })
    if (out.length > MAX_CHUNKS) throw new CoreError(400, `That is more than ${MAX_CHUNKS} chunks: use a bigger chunk`)
  }
  return out
}

// ----- the graph's range -----

export interface Patched { unit: 'frame' | 'index'; nodes: string[] }
const isNode = (v: unknown): v is { class_type: string; inputs: Record<string, unknown> } => !!v && typeof v === 'object' && typeof (v as { class_type?: unknown }).class_type === 'string' && typeof (v as { inputs?: unknown }).inputs === 'object' && !!(v as { inputs?: unknown }).inputs
/**
 * Put a range into an API graph, in place. A graph with BincSeqToImage takes frame NUMBERS (the file names): first_frame, last_frame.
 * One with only BH_ReadSequence takes INDEXES into the served sequence: first_index, count. Neither is an error: nothing would be chunked.
 */
export function applyRange(api: Record<string, unknown>, first: number, last: number): Patched {
  const nodes = Object.entries(api).filter(([, v]) => isNode(v)) as [string, { class_type: string; inputs: Record<string, unknown> }][]
  const seq = nodes.filter(([, v]) => v.class_type === 'BincSeqToImage')
  if (seq.length) {
    for (const [, v] of seq) { v.inputs.first_frame = first; v.inputs.last_frame = last }
    return { unit: 'frame', nodes: seq.map(([id]) => id) }
  }
  const read = nodes.filter(([, v]) => v.class_type === 'BH_ReadSequence')
  if (read.length) {
    for (const [, v] of read) { v.inputs.first_index = first; v.inputs.count = last - first + 1 }
    return { unit: 'index', nodes: read.map(([id]) => id) }
  }
  throw new CoreError(422, 'The graph has no BincSeqToImage or BH_ReadSequence node, so there is no frame range to chunk. Run it with run_pod_workflows instead.')
}

// ----- 3. the RAM guard -----

export interface Ram { used: number; limit: number; pct: number; source: 'cgroup2' | 'cgroup1' }
/** Reads the container's own memory (not the host's, which psutil and ComfyUI's /system_stats report): cgroup v2, else v1. Prints `RAM <used> <limit>`. */
export const RAM_SCRIPT = `u=/sys/fs/cgroup/memory.current; l=/sys/fs/cgroup/memory.max
if [ -r "$u" ]; then echo "RAM2 $(cat $u) $(cat $l)"
elif [ -r /sys/fs/cgroup/memory/memory.usage_in_bytes ]; then echo "RAM1 $(cat /sys/fs/cgroup/memory/memory.usage_in_bytes) $(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)"
fi
`
/** A limit of `max` (v2) or a huge number (v1) means the container has none: then the host's MemTotal is not ours either, so it is unknown (null). */
export function parseRam(lines: string[]): Ram | null {
  for (const l of lines) {
    const m = /^RAM([12]) (\d+) (\d+|max)$/.exec(l.trim())
    if (!m) continue
    const used = Number(m[2]), limit = m[3] === 'max' ? 0 : Number(m[3])
    if (!limit || limit > 2 ** 50) return null
    return { used, limit, pct: Math.round((used / limit) * 1000) / 10, source: m[1] === '2' ? 'cgroup2' : 'cgroup1' }
  }
  return null
}
export type RamReader = (podId: string) => Promise<Ram | null>
/** The pod's container memory over SSH. Null when it cannot be read (the guard is then off, and says so). */
export const readRam: RamReader = async (podId) => {
  if (mounts.dryRun(mounts.load())) return { used: 40 * 2 ** 30, limit: 200 * 2 ** 30, pct: 20, source: 'cgroup2' }
  try {
    const raw = await rp.getPod(podId)
    const { host, port } = sync.sshTarget(raw!)
    const lines: string[] = []
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 30_000)
    try { await podpull.runSsh({ host, port, script: RAM_SCRIPT, onLine: (l) => lines.push(l), signal: ac.signal }) } finally { clearTimeout(t) }
    return parseRam(lines)
  } catch { return null }
}
export const gib = (b: number) => `${Math.round((b / 2 ** 30) * 10) / 10} GiB`
export const overLimit = (r: Ram | null, pct: number): boolean => !!r && r.pct >= pct

// ----- 2. running -----

export interface ChunkResult { /** the failure in words (stage, node, message, missing models, recovery, retryable) */ failure_text?: string; recovery?: string; retryable?: boolean; n: number; first: number; last: number; state: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; prompt_id?: string; seconds?: number; error?: string; outputs?: number; ram_pct?: number }
export interface ChunkJob {
  id: string; pod_id: string; pod_name: string; what: string; unit: 'frame' | 'index' | null; chunk: number; ram_guard_pct: number
  state: 'running' | 'done' | 'failed' | 'stopped' | 'cancelled'; started_at: string; finished_at?: string
  chunks: ChunkResult[]; ok: number; error?: string; ram?: { pct: number; used: string; limit: string; peak_pct: number } | null; ram_note?: string
}
export interface ChunkOpts extends runflows.RunOpts {
  /** The graph, API format. */ graph?: Record<string, unknown>
  /** Or a panel path (a UI graph on the pod, converted like run_pod_workflows does). */ path?: string
  first: number; last: number; chunk?: number; ramGuardPct?: number
  ram?: RamReader; guardEveryMs?: number
}
interface Internal { job: ChunkJob; abort: AbortController }
const jobs = new Map<string, Internal>()
const view = (i: Internal): ChunkJob => JSON.parse(JSON.stringify(i.job))
export const job = (id: string): ChunkJob | null => { const i = jobs.get(id); return i ? view(i) : null }
export function cancel(id: string): ChunkJob {
  const i = jobs.get(id); if (!i) throw new CoreError(404, `No such chunked run: ${id}`)
  if (i.job.state === 'running') i.abort.abort()
  return view(i)
}
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res) => { const t = setTimeout(res, ms); signal.addEventListener('abort', () => { clearTimeout(t); res() }, { once: true }) })

export async function run(podId: string, o: ChunkOpts): Promise<ChunkJob> {
  const size = o.chunk ?? DEFAULT_CHUNK
  const chunks = plan(o.first, o.last, size)
  const limit = o.ramGuardPct ?? DEFAULT_RAM_GUARD_PCT
  if (!(limit > 0 && limit <= 100)) throw new CoreError(400, 'ram_guard_pct must be between 1 and 100')
  if (!o.graph && !o.path) throw new CoreError(400, 'Give the graph (API format) or a panel path.')
  if (o.path && (!/\.json$/i.test(o.path) || o.path.includes('..') || o.path.startsWith('/'))) throw new CoreError(400, `Not a workflow path: ${o.path}`)
  const fetchFn = o.fetchFn ?? fetch
  const dry = mounts.dryRun(mounts.load())
  let base = 'http://simulated', podName = 'simulated'
  if (!dry) {
    const pod = await pods.get(podId, o.client)
    if (pod.status !== 'running' || !pod.web_ui_url) throw new CoreError(409, `Pod ${podId} is not running: start it to run a shot.`)
    base = pod.web_ui_url.replace(/\/$/, ''); podName = pod.name
  }
  const j: ChunkJob = {
    id: `chunk-${podId}-${Date.now()}`, pod_id: podId, pod_name: podName, what: o.path || 'graph', unit: null, chunk: size, ram_guard_pct: limit, state: 'running', started_at: new Date().toISOString(),
    chunks: chunks.map((c) => ({ n: c.n, first: c.first, last: c.last, state: 'pending' })), ok: 0,
  }
  const i: Internal = { job: j, abort: new AbortController() }
  jobs.set(j.id, i)
  const signal = i.abort.signal
  const readRamNow = o.ram ?? readRam
  let peak = 0
  const sample = async (): Promise<Ram | null> => {
    const r = await readRamNow(podId)
    if (r) { peak = Math.max(peak, r.pct); j.ram = { pct: r.pct, used: gib(r.used), limit: gib(r.limit), peak_pct: peak }; j.ram_note = undefined }
    else if (!j.ram) j.ram_note = 'The pod\'s container memory could not be read (no SSH, or no cgroup limit): the RAM guard is off for this run.'
    return r
  }
  const free = () => fetchFn(`${base}/free`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(30_000) }).catch(() => {})
  const interrupt = () => fetchFn(`${base}/interrupt`, { method: 'POST', signal: AbortSignal.timeout(30_000) }).catch(() => {})

  void (async () => {
    try {
      let api: Record<string, unknown> | null = null
      if (!dry) {
        if (o.graph) api = JSON.parse(JSON.stringify(o.graph))
        else api = (await runflows.apiGraph(podId, o.path!, base, o, fetchFn)).api
      } else api = o.graph ? JSON.parse(JSON.stringify(o.graph)) : null
      for (const r of j.chunks) {
        if (signal.aborted) { r.state = 'skipped'; continue }
        if (j.state !== 'running') { r.state = 'skipped'; continue }
        r.state = 'running'
        const t0 = Date.now()
        try {
          if (api) { const p = applyRange(api, r.first, r.last); j.unit = p.unit }
          if (dry) { await sleep(o.pollMs ?? 200, signal); r.state = 'done'; r.outputs = 1 }
          else {
            const q = await fetchFn(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: api, client_id: 'pod-manager-chunked', extra_data: { pod_manager: { chunk: r.n, first: r.first, last: r.last } } }), signal: AbortSignal.timeout(60_000) })
            const qb = await q.json().catch(() => ({}))
            if (q.status !== 200) throw new CoreError(400, runflows.describeRejection(qb).text)
            r.prompt_id = (qb as { prompt_id: string }).prompt_id
            let lastSample = 0
            for (;;) {
              if (signal.aborted) { await interrupt(); throw new CoreError(499, 'cancelled') }
              const x = await fetchFn(`${base}/history/${r.prompt_id}`, { signal: AbortSignal.timeout(30_000) })
              if (x.status !== 200) throw new CoreError(502, `ComfyUI answered HTTP ${x.status} for /history`)
              const out = runflows.outcomeOf(((await x.json()) as Record<string, Parameters<typeof runflows.outcomeOf>[0]>)?.[r.prompt_id])
              if (out) { r.outputs = out.outputs; if (out.error) throw new CoreError(500, out.error); break }
              if (Date.now() - lastSample >= (o.guardEveryMs ?? 10_000)) {
                lastSample = Date.now()
                const ram = await sample()
                if (ram) r.ram_pct = Math.max(r.ram_pct ?? 0, ram.pct)
                if (overLimit(ram, limit)) {
                  await interrupt(); await free()
                  throw new CoreError(507, `RAM guard: the container is at ${ram!.pct}% (${gib(ram!.used)} of ${gib(ram!.limit)}), over the ${limit}% limit, during chunk ${r.n} of ${j.chunks.length} (frames ${r.first}-${r.last}). Stopped before the kernel kills ComfyUI. Run again from frame ${r.first} with a smaller chunk (now ${size}).`)
                }
              }
              await sleep(o.pollMs ?? 2000, signal)
            }
            r.state = 'done'
          }
          r.seconds = Math.round((Date.now() - t0) / 100) / 10
          j.ok++
          // Between chunks: let ComfyUI drop what it holds, then look at the memory. If it did not fall, the next chunk would start on top of it.
          if (!dry && r.n < j.chunks.length) {
            await free(); await sleep(o.pollMs ?? 2000, signal)
            const after = await sample()
            if (overLimit(after, limit)) throw new CoreError(507, `RAM guard: after chunk ${r.n} (frames ${r.first}-${r.last}) the container still holds ${after!.pct}% (${gib(after!.used)} of ${gib(after!.limit)}) although ComfyUI was told to free memory: something is keeping it (a leak, or a node that caches). Stopped; restart ComfyUI, then continue from frame ${r.last + 1}.`)
          }
        } catch (e) {
          const cancelled = e instanceof CoreError && e.status === 499
          const guard = e instanceof CoreError && e.status === 507
          r.state = cancelled ? 'skipped' : 'failed'
          if (!cancelled) {
            r.error = (e as Error).message; j.error = r.error; j.state = guard ? 'stopped' : 'failed'
            const ex = failures.explain(r.error), rec = failures.record({ stage: ex.stage, message: r.error, job_id: j.id, graph: j.what, pod_id: podId, pod_name: j.pod_name, node_id: ex.node_id, node_type: ex.node_type, attempt: 1, quiet: true })
            r.recovery = rec.recovery; r.retryable = rec.retryable; r.failure_text = failures.describe(rec)
          }
          r.seconds ??= Math.round((Date.now() - t0) / 100) / 10
          history.record({ kind: 'job', job: 'run', state: cancelled ? 'cancelled' : 'failed', started_at: new Date(t0).toISOString(), what: `${j.what} chunk ${r.n}/${j.chunks.length} (${r.first}-${r.last})`, pod_id: podId, pod_name: podName, ...(r.error ? { error: r.error } : {}), detail: `${r.seconds}s` })
          continue
        }
        history.record({ kind: 'job', job: 'run', state: 'done', started_at: new Date(t0).toISOString(), what: `${j.what} chunk ${r.n}/${j.chunks.length} (${r.first}-${r.last})`, pod_id: podId, pod_name: podName, detail: `${r.seconds}s${r.prompt_id ? `; prompt ${r.prompt_id}` : ''}${r.ram_pct ? `; RAM ${r.ram_pct}%` : ''}` })
      }
      if (j.state === 'running') j.state = signal.aborted ? 'cancelled' : 'done'
      else if (signal.aborted && j.state !== 'failed' && j.state !== 'stopped') j.state = 'cancelled'
    } catch (e) {
      j.state = 'failed'; j.error = (e as Error).message
      for (const r of j.chunks) if (r.state === 'pending') r.state = 'skipped'
    }
    j.finished_at = new Date().toISOString()
  })()
  return view(i)
}

// ----- 1. job files (the queue script) -----

export interface JobFileOpts { project: string; shot: string; first: number; last: number; chunk?: number; graph_path?: string; pod_id?: string; machine?: string; dir?: string; now?: Date }
/** One brief per chunk in queue/<project>/in/. Never into canalv2/ (a mirror of Binc's queue: seeded by queue/sync.sh, never written by us) or an existing file. */
export function writeJobFiles(o: JobFileOpts): { dir: string; files: string[]; chunks: Chunk[] } {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(o.project)) throw new CoreError(400, 'project must be a folder name (letters, digits, - and _)')
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(o.shot)) throw new CoreError(400, 'shot must be a name (letters, digits, . - and _)')
  if (o.project.toLowerCase() === 'canalv2') throw new CoreError(403, 'queue/canalv2/ is Binc\'s queue, seeded by queue/sync.sh and never written by us. Use another project folder.')
  const chunks = plan(o.first, o.last, o.chunk ?? DEFAULT_CHUNK)
  const dir = o.dir ?? join(REPO_ROOT, 'queue', o.project, 'in')
  mkdirSync(dir, { recursive: true })
  const stamp = (o.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-').slice(0, 13)
  const pad = String(chunks.length).length
  const files: string[] = []
  for (const c of chunks) {
    const name = `${o.shot}_chunk-${String(c.n).padStart(pad, '0')}of${chunks.length}_${stamp}`
    const file = join(dir, `${name}.md`)
    if (existsSync(file)) throw new CoreError(409, `${file} already exists: nothing was overwritten`)
    writeFileSync(file, [
      `job: ${name}`, `shot: ${o.shot}`, `tool: pod-manager run_shot_chunked (this one range only)`, `machine: ${o.machine ?? 'a RunPod pod'}`,
      `inputs:`, `  graph: ${o.graph_path ?? '(the shot graph, set when the job is run)'}`, `  pod_id: ${o.pod_id ?? '(a running pod)'}`,
      `params: first=${c.first} last=${c.last} chunk=${c.count}   (chunk ${c.n} of ${chunks.length}, ${c.count} frames; the whole run is ${o.first}-${o.last})`,
      `run: run_shot_chunked { pod_id, ${o.graph_path ? `path: "${o.graph_path}", ` : ''}first: ${c.first}, last: ${c.last}, chunk: ${c.count} }`,
      `output: the graph's writer folder; frames are named by number, so the chunks land side by side`, `after: check the frames ${c.first}-${c.last} exist, then move this file to done/. Chunks are independent; run them in order.`, '',
    ].join('\n'))
    files.push(file)
  }
  return { dir, files, chunks }
}
