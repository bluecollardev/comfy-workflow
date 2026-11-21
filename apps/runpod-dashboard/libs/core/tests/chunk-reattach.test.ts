import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as autochunk from '../src/autochunk.js'
import * as chunkrecord from '../src/chunkrecord.js'
import { CoreError } from '../src/errors.js'
import * as graphchunks from '../src/graphchunks.js'
import * as jobsregistry from '../src/jobsregistry.js'
import * as mounts from '../src/mounts.js'
import * as queue from '../src/queue.js'
import * as reattach from '../src/reattach.js'
import * as runflows from '../src/runflows.js'
import { scratch } from './helpers.js'

// ADR-056, "Re-attach after a restart": a chunked run leaves a small record; a new process adopts it, waits for what is on the pod, submits what was lost (once), continues from the first
// chunk that has not run, and never submits a finished chunk again. A fake ComfyUI that outlives the "processes"; no pod.
const GiB = 2 ** 30
let dir: string
const PATH = 'base_v008/cgi-072/cgi-072__backhalf-b__base_v008.json'
beforeEach(() => {
  dir = scratch(); process.env.HISTORY_FILE = join(dir, 'history.jsonl'); process.env.DRY_PODS_FILE = join(dir, 'dry-pods.json'); process.env.POD_MANAGER_CONFIG_DIR = dir
  delete process.env.CHUNKED_RUNS; autochunk.resetMemory(); runflows.resetDurations(); chunkrecord.setDeps(null); jobsregistry.reset(); queue.forget()
  const cfg = mounts.defaults(); cfg.dry_run = false; mounts.save(cfg)
})
afterEach(() => { delete process.env.POD_MANAGER_CONFIG_DIR; chunkrecord.setDeps(null); jobsregistry.reset(); queue.reset(); queue.forget() })

const FIRST = 1, LAST = 100   // a 100-frame window
const uiGraph = () => ({ nodes: [
  { id: 1, type: 'OCIORead', widgets_values: ['/x/c.mp4', 'video', 'a', 'b', true, FIRST, LAST, 0, 'error', 'hold', 24] },
  { id: 14, type: 'OCIOWrite', widgets_values: ['none', 'g', 'g', 'sequence', 'dpx', 'prores_4444', '16', 'zip', false, 1, LAST - FIRST + 1, 0, 1, false, false, 'delivery_v008/C', 'C', false] },
], links: [] })
const apiGraph = () => ({ '1': { class_type: 'OCIORead', inputs: { start_frame: FIRST, end_frame: LAST } }, '14': { class_type: 'OCIOWrite', inputs: { first_frame: 1, last_frame: LAST - FIRST + 1, start_number: 0, source_start: 1, filename: 'C' } } })

interface P { id: string; first: number; last: number; startNumber: number; state: 'running' | 'done' | 'gone' }
/** A ComfyUI that keeps its prompts when "the process" dies. `hold` keeps a prompt running until `release`; `auto` finishes a prompt after one poll. */
function pod() {
  const prompts: P[] = []; const polled = new Set<string>(); const hold = new Set<number>(); let auto = true
  const fetchFn = (async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url), json = (status: number, body: unknown) => ({ status, ok: status === 200, json: async () => body })
    if (u.includes('/api/userdata/')) return json(200, uiGraph())
    if (u.endsWith('/prompt') && init?.method === 'POST') {
      const p = JSON.parse(init.body!).prompt as ReturnType<typeof apiGraph>
      const r = p['1'].inputs as { start_frame: number }, w = p['14'].inputs as { first_frame: number; last_frame: number; start_number: number }
      const id = `p${prompts.length + 1}`; prompts.push({ id, first: r.start_frame + (w.first_frame - 1), last: r.start_frame + (w.last_frame - 1), startNumber: w.start_number, state: 'running' })
      return json(200, { prompt_id: id })
    }
    if (u.includes('/history/')) {
      const id = u.split('/history/')[1], p = prompts.find((x) => x.id === id)
      if (!p || p.state === 'gone') return json(200, {})
      if (p.state === 'running' && auto && !hold.has(prompts.indexOf(p) + 1) && polled.has(id)) p.state = 'done'
      polled.add(id)
      return p.state === 'done' ? json(200, { [id]: { status: { status_str: 'success', completed: true }, outputs: { '14': { images: [{ filename: `C.${String(p.startNumber).padStart(4, '0')}.dpx`, subfolder: 'delivery_v008/C', type: 'output' }] } } } }) : json(200, {})
    }
    if (u.endsWith('/queue')) return json(200, { queue_running: prompts.filter((p) => p.state === 'running').map((p) => [0, p.id]), queue_pending: [] })
    if (u.endsWith('/interrupt') || u.endsWith('/free')) return json(200, {})
    throw new Error('unexpected ' + u)
  }) as unknown as typeof fetch
  return { prompts, fetchFn, hold, setAuto: (v: boolean) => { auto = v },
    finish: (n: number) => { prompts[n - 1].state = 'done' }, lose: (n: number) => { prompts[n - 1].state = 'gone' } }
}
const podClient = () => ({ fetchFn: (async () => ({ status: 200, ok: true, json: async () => ({ data: { pod: { id: 'pod1', name: 'cgi-072', desiredStatus: 'RUNNING', imageName: 'i', runtime: { uptimeInSeconds: 5, ports: [] }, machine: { gpuDisplayName: 'H100' }, costPerHr: 3.99 } } }) })) as unknown as typeof fetch, apiKey: 't' })
const ramOf = async () => ({ used: 5 * GiB, limit: 100 * GiB, pct: 5 })
const opts = (w: ReturnType<typeof pod>, extra: Record<string, unknown> = {}) => ({ client: podClient(), fetchFn: w.fetchFn, ram: ramOf, pollMs: 2, backoffMs: [5, 5], waitComfyMs: 10, convert: async () => apiGraph(), ...extra }) as never
const wait = async (f: () => boolean | Promise<boolean>, what: string) => { for (let n = 0; n < 600; n++) { if (await f()) return; await new Promise((r) => setTimeout(r, 10)) } throw new Error('timed out waiting for ' + what) }
const doneJob = async (id: string) => { await wait(() => runflows.job(id)!.state !== 'running', 'the run to end'); return runflows.job(id)! }
const recFile = () => { const d = join(dir, 'chunk-runs'); return existsSync(d) ? readdirSync(d).filter((n) => n.endsWith('.json')) : [] }
const readRec = (n: string) => JSON.parse(readFileSync(join(dir, 'chunk-runs', n), 'utf8')) as chunkrecord.ChunkRunRecord
// the graph's RAM per frame is already known (a previous run): no probe, chunks of 44 frames (1.0 GiB per frame in 100 GiB at 60%, 8 frames of pad each side)
const known = async () => { await autochunk.remember(PATH, { per_frame_gib: 1, ram_gib: 100, chunk: 0, frames: 18, measured_at: new Date().toISOString() }) }
/** The first process dies mid-run: its record as it was (with a dead owner), the run itself ended without cleaning up, the prompts stay on the pod. */
async function kill(jobId: string) {
  const f = recFile()[0], text = readFileSync(join(dir, 'chunk-runs', f), 'utf8')
  runflows.cancel(jobId); await doneJob(jobId)
  const rec = JSON.parse(text) as chunkrecord.ChunkRunRecord
  writeFileSync(join(dir, 'chunk-runs', f), JSON.stringify({ ...rec, owner: { pid: 2147483000, host: hostname() }, heartbeat_at: new Date(Date.now() - 600_000).toISOString() }))
  return f
}
const adoptDeps = (w: ReturnType<typeof pod>, extra: Partial<reattach.Deps> = {}): Partial<reattach.Deps> => ({
  pod: async () => ({ status: 'running', name: 'cgi-072', web_ui_url: 'http://pod' }), resume: async () => undefined,
  run: (podId, paths, o) => runflows.run(podId, paths, { ...(opts(w) as object), ...o }) as never,
  job: (id) => runflows.job(id), link: () => true, sleep: async () => undefined, podWaitMs: 50, podPollMs: 1, watchMs: 5, ...extra,
})

describe('the record of a chunked run', () => {
  it('is written as the plan and the chunks change, shows up in running_jobs, and is removed when the run ends', async () => {
    await known(); const w = pod(); w.hold.add(2)
    const j = await runflows.run('pod1', [PATH], opts(w, { meta: { task_id: 't1', import_id: 'i1' } }))
    await wait(() => w.prompts.length === 2, 'the second chunk')
    await wait(() => recFile().length === 1 && Object.keys(readRec(recFile()[0]).checkpoint?.states ?? {}).length === 2, 'the record')
    const rec = readRec(recFile()[0])
    expect(rec).toMatchObject({ version: 1, job_id: j.id, pod_id: 'pod1', path: PATH, index: 0, job_paths: [PATH], state: 'running', meta: { task_id: 't1', import_id: 'i1' } })
    expect(rec.owner.pid).toBe(process.pid)
    expect(rec.checkpoint!.phase).toBe('main'); expect(rec.checkpoint!.plan.map((c) => `${c.first}-${c.last}`)).toEqual(['1-44', '45-88', '89-100'])
    expect(Object.values(rec.checkpoint!.states).map((s) => s.state).sort()).toEqual(['done', 'running'])
    expect(JSON.stringify(rec)).not.toMatch(/apiKey|secret|token|password|authorization/i)   // ids, numbers and the pod's public address only
    w.hold.delete(2)
    expect((await doneJob(j.id)).state).toBe('done')
    expect(recFile()).toEqual([])   // finished: nothing to adopt
  })
  it('a failed run keeps its record for diagnosis and is never adopted; a cancelled one leaves none', async () => {
    await known(); const w = pod(); const j = await runflows.run('pod1', [PATH], opts(w, { convert: async () => { throw new CoreError(422, 'cannot convert') }, convertTries: 1 }))
    expect((await doneJob(j.id)).state).toBe('failed'); expect(recFile()).toEqual([])   // never planned: no record at all
    const w2 = pod(); w2.hold.add(1)
    const j2 = await runflows.run('pod1', [PATH], opts(w2)); await wait(() => recFile().length === 1, 'the record'); runflows.cancel(j2.id); await doneJob(j2.id)
    expect(recFile()).toEqual([])
  })
  it('whyNot: a live owner is never adopted; a dead owner, a stale heartbeat or another host is', async () => {
    const base: chunkrecord.ChunkRunRecord = { version: 1, id: 'a__0', job_id: 'a', pod_id: 'p', pod_name: 'n', base_url: 'u', path: PATH, job_paths: [PATH], index: 0, started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), owner: { pid: 4242, host: hostname() }, state: 'running', checkpoint: { version: 1, phase: 'main', win: { first: 1, last: 10, startNumber: 0, sourceStart: 1 }, pad: 8, guardPct: 85, targetPct: 60, maxChunk: 50, size: 10, plan: [{ n: 1, first: 1, last: 10, readFirst: 1, readLast: 10, startNumber: 0 }], states: {} } }
    chunkrecord.setDeps({ alive: () => true })
    expect(chunkrecord.whyNot(base)).toMatch(/still running it/)                                                  // alive and fresh
    chunkrecord.setDeps({ alive: () => false }); expect(chunkrecord.whyNot(base)).toBe('')                       // dead pid
    chunkrecord.setDeps({ alive: () => true, now: () => Date.now() + 5 * 60_000 }); expect(chunkrecord.whyNot(base)).toBe('')   // silent for minutes
    chunkrecord.setDeps(null); chunkrecord.setDeps({ alive: () => true }); expect(chunkrecord.whyNot({ ...base, owner: { pid: 4242, host: 'elsewhere' } })).toMatch(/host elsewhere/)
    expect(chunkrecord.whyNot({ ...base, state: 'failed', error: 'x' })).toMatch(/failed/)
    chunkrecord.setDeps({ alive: () => false }); expect(chunkrecord.whyNot({ ...base, checkpoint: undefined })).toMatch(/no plan yet/)
  })
})

describe('autochunk.runGraph with a checkpoint', () => {
  it('skips a finished chunk, waits for the prompt still on the pod, submits only the chunk nobody had started', async () => {
    const submitted: string[] = [], polls: string[] = []
    const cp: autochunk.Checkpoint = { version: 1, phase: 'main', win: { first: 1, last: 100, startNumber: 0, sourceStart: 1 }, pad: 8, guardPct: 85, targetPct: 60, maxChunk: 50, size: 44,
      plan: graphchunks.planGraphChunks({ first: 1, last: 100, startNumber: 0 }, 44, 8), states: { '1-44': { state: 'done', prompt_id: 'p1' }, '45-88': { state: 'running', prompt_id: 'p2' } } }
    const said: string[] = []
    const sum = await autochunk.runGraph({
      path: PATH, ui: uiGraph(), api: apiGraph(), say: (t) => said.push(t), sleep: async () => undefined, pollMs: 1, resume: cp,
      submit: async (a) => { const n = a['14'] as { inputs: { start_number: number } }; submitted.push(`start ${n.inputs.start_number}`); return 'p3' },
      outcome: async (id) => { polls.push(id); return id === 'p2' && polls.filter((x) => x === 'p2').length < 3 ? null : 'done' },
      ram: async () => ({ used: GiB, limit: 100 * GiB, pct: 1 }), interrupt: async () => undefined, free: async () => undefined, adopt: () => undefined,
    })
    expect(submitted).toEqual(['start 88'])   // only chunk 89-100
    expect(polls).toContain('p2'); expect(sum).toMatchObject({ mode: 'chunked', chunks: 3 })
    expect(said.join('\n')).toMatch(/re-attached after a restart/)
  })
  it('a prompt the pod lost is submitted again, once', async () => {
    const submitted: number[] = []
    const cp: autochunk.Checkpoint = { version: 1, phase: 'main', win: { first: 1, last: 20, startNumber: 0, sourceStart: 1 }, pad: 8, guardPct: 85, targetPct: 60, maxChunk: 50, size: 10,
      plan: graphchunks.planGraphChunks({ first: 1, last: 20, startNumber: 0 }, 10, 8), states: { '1-10': { state: 'running', prompt_id: 'old' } } }
    const sum = await autochunk.runGraph({
      path: PATH, ui: { ...uiGraph(), nodes: [{ id: 1, type: 'OCIORead', widgets_values: ['/x/c.mp4', 'video', 'a', 'b', true, 1, 20, 0, 'error', 'hold', 24] }, { id: 14, type: 'OCIOWrite', widgets_values: ['none', 'g', 'g', 'sequence', 'dpx', 'prores_4444', '16', 'zip', false, 1, 20, 0, 1, false, false, 'delivery_v008/C', 'C', false] }] }, api: apiGraph(), say: () => undefined, sleep: async () => undefined, pollMs: 1, resume: cp,
      submit: async (a) => { submitted.push((a['14'] as { inputs: { start_number: number } }).inputs.start_number); return `n${submitted.length}` },
      outcome: async (id) => (id === 'old' ? { error: 'ComfyUI restarted while the graph ran: prompt old is gone' } : 'done'),
      ram: async () => ({ used: GiB, limit: 100 * GiB, pct: 1 }), interrupt: async () => undefined, free: async () => undefined,
    })
    expect(submitted).toEqual([0, 10]); expect(sum.chunks).toBe(2)   // chunk 1 again (once), then chunk 2
  })
})

describe('adopting a run after a restart', () => {
  it('waits for the running prompt, never resubmits a finished chunk, finishes the plan, links the task and replaces the record', async () => {
    await known(); const w = pod(); w.hold.add(2)
    const j = await runflows.run('pod1', [PATH], opts(w, { meta: { task_id: 't1', import_id: 'i1' } }))
    await wait(() => w.prompts.length === 2, 'chunk 2 submitted'); await wait(() => Object.keys(recFile().length ? readRec(recFile()[0]).checkpoint?.states ?? {} : {}).length === 2, 'the record')
    await kill(j.id)
    // the process is gone: chunk 1 finished (p1), chunk 2 (p2) is still running on the pod
    expect(w.prompts.map((p) => p.state)).toEqual(['done', 'running'])
    const linked: unknown[][] = []
    const rs = await reattach.adoptAll(adoptDeps(w, { link: (...a) => { linked.push(a); return true } }))
    expect(rs).toHaveLength(1); expect(rs[0]).toMatchObject({ outcome: 'adopted', path: PATH }); expect(rs[0].reason).toMatch(/re-attached after restart.*chunk 2 of 3/)
    expect(linked).toEqual([['t1', j.id, rs[0].job_id, expect.stringMatching(/re-attached after restart/)]])
    await wait(() => w.prompts.length >= 2, 'the adopted run polling'); w.finish(2)          // the pod finishes the chunk nobody was watching
    const done = await doneJob(rs[0].job_id!)
    expect(done.state).toBe('done'); expect(done.log.map((l) => l.text).join('\n')).toMatch(/re-attached after a restart/)
    // exactly one prompt per chunk: p1 (before), p2 (before), p3 (the adopter's third chunk): nothing submitted twice
    expect(w.prompts.map((p) => `${p.first}-${p.last}`)).toEqual(['1-44', '45-88', '89-100'])
    expect(recFile()).toEqual([])   // the old record is closed, the new run removed its own at the end
  })
  it('a prompt that was running and is gone from the pod is submitted again, once', async () => {
    await known(); const w = pod(); w.hold.add(2)
    const j = await runflows.run('pod1', [PATH], opts(w)); await wait(() => w.prompts.length === 2, 'chunk 2'); await wait(() => Object.keys(recFile().length ? readRec(recFile()[0]).checkpoint?.states ?? {} : {}).length === 2, 'the record')
    await kill(j.id); w.lose(2); w.hold.clear()   // the pod restarted: ComfyUI forgot prompt 2
    const rs = await reattach.adoptAll(adoptDeps(w))
    expect(rs[0].outcome).toBe('adopted')
    expect((await doneJob(rs[0].job_id!)).state).toBe('done')
    expect(w.prompts.map((p) => `${p.first}-${p.last}`)).toEqual(['1-44', '45-88', '45-88', '89-100'])   // chunk 2 twice (the lost one and its resubmission), the others once
  })
  it('a chunk that finished while nobody was watching is counted, not run again', async () => {
    await known(); const w = pod(); w.hold.add(2)
    const j = await runflows.run('pod1', [PATH], opts(w)); await wait(() => w.prompts.length === 2, 'chunk 2'); await wait(() => Object.keys(recFile().length ? readRec(recFile()[0]).checkpoint?.states ?? {} : {}).length === 2, 'the record')
    await kill(j.id); w.finish(2); w.hold.clear()
    const rs = await reattach.adoptAll(adoptDeps(w)); expect((await doneJob(rs[0].job_id!)).state).toBe('done')
    expect(w.prompts.map((p) => `${p.first}-${p.last}`)).toEqual(['1-44', '45-88', '89-100'])
  })
  it('a pod that is gone makes the run interrupted, with the reason, and it is not tried again', async () => {
    await known(); const w = pod(); w.hold.add(2)
    const j = await runflows.run('pod1', [PATH], opts(w)); await wait(() => w.prompts.length === 2, 'chunk 2'); await wait(() => Object.keys(recFile().length ? readRec(recFile()[0]).checkpoint?.states ?? {} : {}).length === 2, 'the record')
    const f = await kill(j.id); let linked = 0
    const rs = await reattach.adoptAll(adoptDeps(w, { pod: async () => { throw new CoreError(404, 'no such pod') }, link: () => { linked++; return true } }))
    expect(rs[0]).toMatchObject({ outcome: 'interrupted' }); expect(rs[0].reason).toMatch(/is gone/); expect(linked).toBe(0)
    expect(readRec(f)).toMatchObject({ state: 'failed' }); expect(readRec(f).error).toMatch(/is gone/)
    expect(await reattach.adoptAll(adoptDeps(w))).toEqual([])   // a failed record is only for diagnosis
  })
  it('a stopped pod is resumed (never deleted) and waited for', async () => {
    await known(); const w = pod(); w.hold.add(2)
    const j = await runflows.run('pod1', [PATH], opts(w)); await wait(() => w.prompts.length === 2, 'chunk 2'); await wait(() => Object.keys(recFile().length ? readRec(recFile()[0]).checkpoint?.states ?? {} : {}).length === 2, 'the record')
    await kill(j.id); w.hold.clear(); let status = 'stopped', resumed = 0
    const rs = await reattach.adoptAll(adoptDeps(w, { pod: async () => ({ status, name: 'cgi-072', web_ui_url: status === 'running' ? 'http://pod' : null }), resume: async () => { resumed++; status = 'running' } }))
    expect(resumed).toBe(1); expect(rs[0].outcome).toBe('adopted'); expect((await doneJob(rs[0].job_id!)).state).toBe('done')
  })
  it('two passes (or two processes) never adopt the same run', async () => {
    await known(); const w = pod(); w.hold.add(2)
    const j = await runflows.run('pod1', [PATH], opts(w)); await wait(() => w.prompts.length === 2, 'chunk 2'); await wait(() => Object.keys(recFile().length ? readRec(recFile()[0]).checkpoint?.states ?? {} : {}).length === 2, 'the record')
    const f = await kill(j.id); const id = f.replace(/\.json$/, '')
    // another process wins the lock first
    chunkrecord.setDeps({ pid: () => process.ppid, alive: () => true }); expect(await chunkrecord.claim(id)).toBe(true)   // a process that is really alive (our parent)
    chunkrecord.setDeps({ pid: () => process.ppid + 7, alive: () => true }); expect(await chunkrecord.claim(id)).toBe(false)   // the second one loses
    chunkrecord.setDeps(null)
    let runs = 0
    const rs = await reattach.adoptAll(adoptDeps(w, { run: async () => { runs++; return { id: 'x' } } }))
    expect(rs[0]).toMatchObject({ outcome: 'skipped' }); expect(runs).toBe(0)   // this process finds the lock held by a live process and leaves the run alone
    // two passes in one process are one pass
    chunkrecord.setDeps({ alive: (pid) => pid !== 2147483000 }); await chunkrecord.release(id)
    const a = reattach.adoptAll(adoptDeps(w, { run: async () => { runs++; return { id: 'y' } } })), b = reattach.adoptAll(adoptDeps(w, { run: async () => { runs++; return { id: 'z' } } }))
    expect(a).toBe(b); await a; expect(runs).toBe(1)
  })
  it('a record whose process was alive and fresh is left to its owner', async () => {
    await known(); const w = pod(); w.hold.add(2)
    await runflows.run('pod1', [PATH], opts(w)); await wait(() => w.prompts.length === 2, 'chunk 2'); await wait(() => Object.keys(recFile().length ? readRec(recFile()[0]).checkpoint?.states ?? {} : {}).length === 2, 'the record')
    const rs = await reattach.adoptAll(adoptDeps(w)); expect(rs[0]).toMatchObject({ outcome: 'skipped' }); expect(rs[0].reason).toMatch(/running it/)
    w.hold.clear(); runflows.cancel(runflows.latest('pod1')!.id)
  })
  it('a record with no plan whose owner is gone is closed, not adopted', async () => {
    mkdirSync(join(dir, 'chunk-runs'), { recursive: true })
    writeFileSync(join(dir, 'chunk-runs', 'old__0.json'), JSON.stringify({ version: 1, id: 'old__0', job_id: 'old', pod_id: 'p', pod_name: 'n', base_url: 'u', path: PATH, job_paths: [PATH], index: 0, started_at: new Date().toISOString(), heartbeat_at: new Date(Date.now() - 600_000).toISOString(), owner: { pid: 2147483000, host: hostname() }, state: 'running' }))
    writeFileSync(join(dir, 'chunk-runs', 'bad__0.json'), '{ not json')
    const rs = await reattach.adoptAll(adoptDeps(pod()))
    expect(rs.map((r) => r.outcome).sort()).toEqual(['interrupted', 'interrupted']); expect(readRec('old__0.json').state).toBe('failed')
  })
})

describe('the queue task is taken back', () => {
  it('an interrupted run task is running again on the new job; a task a person already retried is left alone', () => {
    const f = join(dir, 'queue.json')
    writeFileSync(f, JSON.stringify({ version: 1, imports: [{ id: 'i1', state: 'done', round: 'base_v008', shots: [], started_pods: [] }], tasks: [
      { id: 't1', import_id: 'i1', round: 'base_v008', shot: 'cgi-072', kind: 'run', state: 'running', depends_on: [], pod_id: 'pod1', pod_name: 'n', job_id: 'run-old', phase: 'job', graphs: [PATH], started_at: new Date().toISOString() },
      { id: 't2', import_id: 'i1', round: 'base_v008', shot: 'x', kind: 'run', state: 'waiting', depends_on: [], pod_id: null, pod_name: null, job_id: undefined, graphs: [] },
    ] }))
    queue.forget()
    expect(queue.list().tasks.find((t) => t.id === 't1')!.state).toBe('interrupted')   // what the load does to a task that was running
    expect(queue.reattachTask('t2', 'run-old', 'run-new', 'x')).toBe(false)             // not interrupted: left alone
    expect(queue.reattachTask('t1', 'run-other', 'run-new', 'x')).toBe(false)           // another job's task
    expect(queue.reattachTask('t1', 'run-old', 'run-new', 're-attached after restart: chunk 2 of 3')).toBe(true)
    const t = queue.list().tasks.find((x) => x.id === 't1')!
    expect(t).toMatchObject({ state: 'running', job_id: 'run-new', phase: 'job' }); expect(t.error).toBeUndefined()
    expect(t.events!.at(-1)!.text).toMatch(/re-attached after restart/); expect(queue.list().imports[0].state).toBe('active')
  })
})
