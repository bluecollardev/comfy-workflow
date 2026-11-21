/**
 * Re-attach to chunked runs after a restart (ADR-056, "Re-attach after a restart"). Only the APP calls `adoptAll`, once, when it starts (electron/core.cjs): the stdio MCP server and the
 * CLI never adopt, so a run is only ever continued by one process. For each record in `<config>/chunk-runs/` whose owner is gone (chunkrecord.adoptable):
 *
 *   1. claim it (an exclusive lock file; a second pass or a second process loses),
 *   2. find its pod: gone -> the run is `interrupted` with that reason, as before; stopped -> resumed (never deleted) and waited for; running -> used,
 *   3. start a new run job for the rest of the run's graphs with `resume` set for the interrupted one: autochunk then waits for the prompts still on the pod, counts the chunks that finished,
 *      submits again (once) the ones the pod lost, and carries on from the first chunk that has not run (frames already written are never written again: a chunk owns its start number),
 *   4. link the queue task (queue.reattachTask) so the Queue shows it running with its chunk progress, and keep the record's lock until the new run has its own record.
 *
 * A run that was started by code without records has nothing here: it stays `interrupted` and a Retry starts the element over, as before.
 */
import { CoreError } from './errors.js'
import * as chunkrecord from './chunkrecord.js'
import * as pods from './pods.js'
import * as queue from './queue.js'
import * as runflows from './runflows.js'
import * as history from './history.js'

export interface Report { id: string; path: string; outcome: 'adopted' | 'interrupted' | 'skipped'; reason: string; job_id?: string }
export interface Deps {
  list: typeof chunkrecord.list
  pod: (id: string) => Promise<{ status: string; name: string; web_ui_url?: string | null }>
  resume: (id: string) => Promise<unknown>
  run: (podId: string, paths: string[], o: runflows.RunOpts) => Promise<{ id: string }>
  job: (id: string) => { state: string; error?: string } | null
  link: typeof queue.reattachTask
  sleep: (ms: number) => Promise<void>
  /** how long a stopped pod may take to come up, and how often to ask */ podWaitMs: number; podPollMs: number
  /** how often the watcher looks at the new run while the old record is still held */ watchMs: number
  runOpts?: runflows.RunOpts
}
const real = (): Deps => ({
  list: chunkrecord.list,
  pod: (id) => pods.get(id), resume: (id) => pods.resume(id),
  run: (podId, paths, o) => runflows.run(podId, paths, o), job: (id) => runflows.job(id), link: queue.reattachTask,
  sleep: (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.() }),
  podWaitMs: 5 * 60_000, podPollMs: 5_000, watchMs: 10_000,
})
const say = (rec: chunkrecord.ChunkRunRecord, text: string, state: 'done' | 'failed' = 'done'): void => {
  try { history.record({ kind: 'change', area: 'queue', action: 'chunked run re-attached', what: rec.path, detail: text, pod_id: rec.pod_id, ...(state === 'failed' ? { error: text } : {}) } as never) } catch { /* the History never blocks this */ }
}

let busy: Promise<Report[]> | null = null
/** Adopt every adoptable run. One pass at a time in a process; safe to call again (a run this process already took is skipped). */
export function adoptAll(over: Partial<Deps> = {}): Promise<Report[]> {
  if (busy) return busy
  busy = pass({ ...real(), ...over }).finally(() => { busy = null })
  return busy
}

async function pass(d: Deps): Promise<Report[]> {
  const out: Report[] = []
  const { records, corrupt } = await d.list()
  for (const n of corrupt) out.push({ id: n, path: '', outcome: 'interrupted', reason: 'the record is unreadable: the run cannot be continued (a Retry starts it over)' })
  for (const rec of records) {
    if (rec.state !== 'running') continue   // failed ones are kept for diagnosis only
    if (rec.state === 'running' && !rec.checkpoint && chunkrecord.ownerGone(rec)) {
      // the owner is gone before it planned anything: nothing was submitted that we know of
      out.push(await interrupted(rec, 'the process stopped before the first chunk was planned')); continue
    }
    const why = chunkrecord.whyNot(rec)
    if (why) { out.push({ id: rec.id, path: rec.path, outcome: 'skipped', reason: why }); continue }
    if (!(await chunkrecord.claim(rec.id))) { out.push({ id: rec.id, path: rec.path, outcome: 'skipped', reason: 'another process took it' }); continue }
    out.push(await adopt(d, rec))
  }
  return out
}

async function interrupted(rec: chunkrecord.ChunkRunRecord, reason: string): Promise<Report> {
  // kept for diagnosis, never adopted again; the task stays `interrupted` (queue.load) with its own words
  await chunkrecord.markFailed(rec, reason); await chunkrecord.release(rec.id)
  say(rec, `could not re-attach ${rec.path}: ${reason}`, 'failed')
  return { id: rec.id, path: rec.path, outcome: 'interrupted', reason }
}

async function adopt(d: Deps, rec: chunkrecord.ChunkRunRecord): Promise<Report> {
  // 2. the pod
  let pod: Awaited<ReturnType<Deps['pod']>>
  try { pod = await d.pod(rec.pod_id) } catch (e) {
    const gone = e instanceof CoreError ? e.status === 404 : /\b404\b|not found|no such pod/i.test((e as Error).message)
    if (gone) return interrupted(rec, `pod ${rec.pod_name || rec.pod_id} is gone`)
    await chunkrecord.release(rec.id)   // RunPod did not answer: not a verdict, the next start tries again
    return { id: rec.id, path: rec.path, outcome: 'skipped', reason: `could not look at pod ${rec.pod_id}: ${(e as Error).message}` }
  }
  if (pod.status !== 'running') {
    try { await d.resume(rec.pod_id) } catch (e) { return interrupted(rec, `pod ${pod.name} is ${pod.status} and could not be started: ${(e as Error).message}`) }
    const until = Date.now() + d.podWaitMs
    for (;;) {
      await d.sleep(d.podPollMs)
      try { pod = await d.pod(rec.pod_id) } catch { /* asked again */ }
      if (pod.status === 'running' && pod.web_ui_url) break
      if (Date.now() > until) return interrupted(rec, `pod ${pod.name} did not come up within ${Math.round(d.podWaitMs / 60000)} minutes`)
    }
  }
  // 3. the rest of the run, the interrupted graph first, resumed
  const paths = rec.job_paths.slice(rec.index)
  let job: { id: string }
  try { job = await d.run(rec.pod_id, paths, { ...(d.runOpts ?? {}), meta: rec.meta, ...(rec.ranges ? { ranges: rec.ranges } : {}), resume: { [rec.path]: { cp: rec.checkpoint!, from: rec.id } } }) } catch (e) { return interrupted(rec, `the run could not be started again: ${(e as Error).message}`) }
  const done = Object.values(rec.checkpoint!.states).filter((s) => s.state === 'done').length, total = rec.checkpoint!.plan.length
  const text = `re-attached after restart: ${rec.path}, chunk ${Math.min(total, done + 1)} of ${total} (${done} done)`
  say(rec, text)
  // 4. the task
  if (rec.meta?.task_id) d.link(rec.meta.task_id, rec.job_id, job.id, text)
  void watch(d, rec, job.id)
  return { id: rec.id, path: rec.path, outcome: 'adopted', reason: text, job_id: job.id }
}

/** The old record is replaced by the new run's own (runflows.runChunked removes it, via `adopted_from`); if the new run ends without ever writing one, close the old record as failed. */
async function watch(d: Deps, rec: chunkrecord.ChunkRunRecord, jobId: string): Promise<void> {
  for (;;) {
    await d.sleep(d.watchMs)
    if (!(await chunkrecord.read(rec.id))) return   // the new run replaced it
    const j = d.job(jobId)
    if (!j) return
    if (j.state !== 'running') {
      // finished: its own record is gone on success; if ours is still here the run failed before it had one
      const left = await chunkrecord.read(rec.id)
      if (left) { await interrupted(rec, j.error || `the continued run ${j.state} before it could take over the record`) }
      return
    }
  }
}
