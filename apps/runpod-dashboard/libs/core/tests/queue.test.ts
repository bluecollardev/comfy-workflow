import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as queue from '../src/queue.js'
import { scratch } from './helpers.js'

// The round-import queue (docs/ADR-038): importing a round queues a pull and one run per shot; pool pods take the runs, within a pod limit and a dollar cap. No pod, no RunPod: fakes for every outside effect.
let dir: string
beforeEach(() => {
  dir = scratch(); process.env.HISTORY_FILE = join(dir, 'history.jsonl'); process.env.QUEUE_FILE = join(dir, 'queue.json')
  const cfg = mounts.defaults(); cfg.dry_run = false; mounts.save(cfg); queue.forget()
})
afterEach(() => { queue.stop(); queue.reset(); queue.forget() })

const ROUND = 'brynley-comfy-2026-10-22'
const PLACE = { graphs: [{ shot: 'cgi-042', name: 'a.json', path: '/workspace/comfy-shared/workflows/rounds/r/a.json' }, { shot: 'cgi-043', name: 'b.json', path: '/workspace/comfy-shared/workflows/rounds/r/b.json' }, { shot: 'cgi-044', name: 'c.json', path: '/workspace/comfy-shared/workflows/rounds/r/c.json' }], linked: 9 }

/** A world: three shots, a pool of pods in the given states, a pull job and run jobs the test moves along by hand. */
function world(pool: { id: string; name: string; state: 'running' | 'starting' | 'off' }[] = [], price = 4) {
  const w = {
    pods: pool.map((p) => ({ ...p, price: price as number | null })), ready: new Set<string>(pool.filter((p) => p.state === 'running').map((p) => p.id)),
    resumed: [] as string[], created: [] as string[], stopped: [] as string[], runs: new Map<string, { podId: string; paths: string[]; state: 'running' | 'done' | 'failed' | 'cancelled'; err?: string }>(),
    pull: { state: 'running' as 'running' | 'done' | 'failed', place: PLACE as unknown },
  }
  queue.configure({
    shotsOf: async () => ['cgi-042', 'cgi-043', 'cgi-044'],
    planPull: async () => ({ price_per_hour: price, ceiling_minutes: 60, bytes: 1 }),
    volumePods: async () => w.pods.map((p) => ({ id: p.id, name: p.name, state: p.state, price: p.price })),
    podReady: async (id) => ({ ready: w.ready.has(id), price }),
    resumePod: async (id) => { w.resumed.push(id); const p = w.pods.find((x) => x.id === id)!; p.state = 'running'; w.ready.add(id) },
    ensureVolume: async (id) => { (w.vols ||= []).push(id ?? null) },
    cardPrice: async (g) => (g === 'rtx5090' ? 2 : null),
    createPod: async (name, round, gpu) => { (w.gpuOf ||= {})[`new${w.created.length + 1}`] = gpu; const id = `new${w.created.length + 1}`; w.created.push(id); (w.rounds ||= {})[id] = round; w.pods.push({ id, name, state: 'running', price }); w.ready.add(id); return { id, name } },
    stopPod: async (id) => { w.stopped.push(id) },
    pull: async () => ({ id: 'pj1' }),
    pullJob: (() => ({ id: 'pj1', state: w.pull.state, pod_id: 'pullpod', pod_name: 'pull', files: 9, place: w.pull.place, error: w.pull.state === 'failed' ? 'aws failed' : undefined })) as never,
    cancelPull: () => { w.pull.state = 'failed' },
    run: async (podId, paths) => { const id = `rj${w.runs.size + 1}`; w.runs.set(id, { podId, paths, state: 'running' }); return { id } },
    runJob: ((id: string) => { const r = w.runs.get(id); return r ? { id, state: r.state, ok: r.state === 'done' ? r.paths.length : 0, failed: r.state === 'failed' ? 1 : 0, results: r.paths.map((p) => ({ path: p, state: r.state === 'failed' ? 'failed' : 'done', error: r.err })) } : null }) as never,
    cancelRun: (id) => { const r = w.runs.get(id); if (r) r.state = 'cancelled' },
  })
  return w
}
const tasks = () => queue.list().tasks
const states = () => tasks().map((t) => `${t.kind}${t.shot ? ':' + t.shot : ''}=${t.state}`)

describe('a card for a shot', () => {
  it('prices the chosen card into the estimate, refuses an unknown card, and gives that shot a pod of its own with that card', async () => {
    const w = world([{ id: 'pool1', name: 'pool', state: 'running' }])
    const p = await queue.planImport(ROUND, { shots: ['cgi-042'], cards: { 'cgi-042': 'rtx5090' } })
    expect(p.est_total_usd).toBe(4 * 1 + 2 * queue.RUN_ESTIMATE_H)   // the pull at the pool price, the run at the card's
    await expect(queue.planImport(ROUND, { cards: { 'cgi-042': 'nope' } })).rejects.toThrow(/Unknown card/)
    await queue.importRound(ROUND, { shots: ['cgi-042', 'cgi-043'], cards: { 'cgi-042': 'rtx5090' }, approved_by: 'Lucas' })
    expect(queue.list().tasks.find((x) => x.shot === 'cgi-042')).toMatchObject({ gpu: 'rtx5090', price: 2 })
    expect(queue.list().tasks.find((x) => x.shot === 'cgi-043')?.gpu).toBeUndefined()
    w.pull.state = 'done'; await queue.tick(); await queue.tick()
    expect(w.created).toEqual(['new1'])   // the shot with a card did not take the running pool pod
    expect((w as any).gpuOf.new1).toBe('rtx5090')
    expect(queue.list().tasks.find((x) => x.shot === 'cgi-043')?.pod_id).toBe('pool1')
    const evs = (shot: string) => (queue.list().tasks.find((x) => x.shot === shot)?.events ?? []).map((e) => e.text).join(' | ')
    expect(evs('cgi-042')).toMatch(/created pod .*rtx5090/)   // what happened to a task is kept, with times
    expect(evs('cgi-043')).toMatch(/reusing the pod pool/)
  })
})

describe('planning', () => {
  it('lists the shots, estimates the cost and applies the caps from the Default Configuration', async () => {
    world()
    const p = await queue.planImport(ROUND)
    expect(p).toMatchObject({ shots: ['cgi-042', 'cgi-043', 'cgi-044'], price_per_hour: 4, max_pods: 2, cost_cap_usd: 50, cap_enabled: true, over_cap: false })
    expect(p.est_total_usd).toBe(4 * (1 + 3 * queue.RUN_ESTIMATE_H))
    expect((await queue.planImport(ROUND, { shots: ['cgi-043'] })).shots).toEqual(['cgi-043'])
    expect((await queue.planImport(ROUND, { cost_cap_usd: 5 })).over_cap).toBe(true)
  })
  it('the setting that switches the cap off removes the pod limit and the dollar cap', async () => {
    world(); const cfg = mounts.load(); cfg.import_cap_enabled = false; mounts.save(cfg)
    expect(await queue.planImport(ROUND)).toMatchObject({ cap_enabled: false, max_pods: null, cost_cap_usd: null, over_cap: false })
  })
  it('the settings default to 2 pods, 50 dollars, cap on, and bad values fall back', () => {
    expect(mounts.defaults()).toMatchObject({ import_max_pods: 2, import_cost_cap_usd: 50, import_cap_enabled: true })
    expect(mounts.normalize({ import_max_pods: 0, import_cost_cap_usd: -1 } as never)).toMatchObject({ import_max_pods: 2, import_cost_cap_usd: 50 })
  })
})

describe('importing', () => {
  it('needs a name behind the spend, makes a pull and one run per shot, and refuses a second active import of the round', async () => {
    world()
    await expect(queue.importRound(ROUND, {})).rejects.toThrow(/approved_by/)
    await queue.importRound(ROUND, { approved_by: 'Lucas' })
    expect(states()).toEqual(['pull=waiting', 'run:cgi-042=waiting', 'run:cgi-043=waiting', 'run:cgi-044=waiting'])
    await expect(queue.importRound(ROUND, { approved_by: 'Lucas' })).rejects.toThrow(/already being imported/)
  })

  it('pull first; then runs on pool pods within the pod limit; the next shot waits for a free pod; pods it started are stopped at the end, the one already running is not', async () => {
    const w = world([{ id: 'p1', name: 'h100-1', state: 'running' }, { id: 'p2', name: 'h100-2', state: 'off' }])
    await queue.importRound(ROUND, { approved_by: 'Lucas' })
    await queue.tick(); expect(states()[0]).toBe('pull=running'); expect(w.runs.size).toBe(0)   // the runs wait for the pull
    w.pull.state = 'done'; await queue.tick()
    expect(tasks()[0].state).toBe('done'); expect(tasks()[1].graphs).toEqual(['rounds/r/a.json'])   // each run got its shot's placed graphs
    await queue.tick()   // runs acquire pods: limit 2, so two of three
    expect(states().filter((s) => s.endsWith('running'))).toHaveLength(2); expect(w.resumed).toEqual(['p2'])   // the stopped pod is restarted, the running one reused
    await queue.tick()   // both pods ready: the runs start
    expect([...w.runs.values()].map((r) => r.podId).sort()).toEqual(['p1', 'p2'])
    w.runs.get('rj1')!.state = 'done'; await queue.tick()   // one finishes: the third shot takes its pod
    await queue.tick(); await queue.tick()
    for (const r of w.runs.values()) r.state = 'done'
    await queue.tick(); await queue.tick()
    expect(states()).toEqual(['pull=done', 'run:cgi-042=done', 'run:cgi-043=done', 'run:cgi-044=done'])
    expect(queue.list().imports[0].state).toBe('done'); expect(w.stopped).toEqual(['p2'])   // p1 was already running: left alone
    expect(history.list({ kind: 'job' }).filter((e) => e.kind === 'job' && e.job === 'queue' && e.state === 'done').length).toBeGreaterThanOrEqual(4)
  })

  it('creates a pod only when none can be started, and stops it afterwards', async () => {
    const w = world([])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'] })
    await queue.tick(); w.pull.state = 'done'; await queue.tick(); await queue.tick(); await queue.tick()
    expect(w.created).toHaveLength(1)
    expect((w as any).rounds).toEqual({ new1: ROUND })   // the pod it made goes into the round it imports (ADR-039)
    w.runs.get('rj1')!.state = 'done'; await queue.tick(); await queue.tick()
    expect(w.stopped).toEqual(['new1'])
  })

  it('a failed run is a failed task with its error, and is in the History', async () => {
    const w = world([{ id: 'p1', name: 'h100-1', state: 'running' }])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'] })
    await queue.tick(); w.pull.state = 'done'; await queue.tick(); await queue.tick(); await queue.tick()
    const r = w.runs.get('rj1')!; r.state = 'failed'; r.err = 'CUDA out of memory (node 4, KSampler)'; await queue.tick()
    const t = tasks()[1]; expect(t.state).toBe('failed'); expect(t.error).toMatch(/CUDA out of memory/)
    expect(history.list({ kind: 'job' }).find((e) => e.kind === 'job' && e.job === 'queue' && e.state === 'failed')).toMatchObject({ error: expect.stringMatching(/CUDA/) })
  })

  it('a failed pull fails the runs that wait for it', async () => {
    const w = world([{ id: 'p1', name: 'h100-1', state: 'running' }])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'] })
    await queue.tick(); w.pull.state = 'failed'; await queue.tick(); await queue.tick()
    expect(states()).toEqual(['pull=failed', 'run:cgi-042=failed']); expect(queue.list().imports[0].state).toBe('done')
  })
})

describe('the cap', () => {
  it('a run that would pass the dollar cap is held, not started; Retry after raising the cap runs it', async () => {
    const w = world([{ id: 'p1', name: 'h100-1', state: 'running' }])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'], cost_cap_usd: 1 })   // one run is estimated at 4 * 0.5 = 2 dollars
    await queue.tick(); w.pull.state = 'done'; await queue.tick(); await queue.tick()
    const t = tasks()[1]; expect(t.state).toBe('held'); expect(t.held_reason).toMatch(/cap/); expect(w.runs.size).toBe(0)
    queue.setImportLimits(queue.list().imports[0].id, { cost_cap_usd: 100 })
    queue.retryTask(t.id); await queue.tick(); await queue.tick()
    expect(w.runs.size).toBe(1)
  })
  it('with the cap off in the setting, nothing is held and every shot runs at once', async () => {
    const cfg = mounts.load(); cfg.import_cap_enabled = false; mounts.save(cfg)
    const w = world([{ id: 'p1', name: 'a', state: 'running' }, { id: 'p2', name: 'b', state: 'running' }, { id: 'p3', name: 'c', state: 'running' }])
    await queue.importRound(ROUND, { approved_by: 'Lucas' })
    await queue.tick(); w.pull.state = 'done'; await queue.tick(); await queue.tick(); await queue.tick()
    expect(w.runs.size).toBe(3)
  })
})

describe('cancelling, retrying and restarting', () => {
  it('cancel import stops the running pull and cancels everything waiting', async () => {
    const w = world([{ id: 'p1', name: 'h100-1', state: 'running' }])
    const imp = await queue.importRound(ROUND, { approved_by: 'Lucas' })
    await queue.tick(); queue.cancelImport(imp.id)
    expect(states().every((s) => s.endsWith('cancelled'))).toBe(true); expect(w.pull.state).toBe('failed')
  })
  it('a task that was running when the app stopped comes back interrupted, and Retry puts it back to waiting', async () => {
    writeFileSync(process.env.QUEUE_FILE!, JSON.stringify({ version: 1, imports: [{ id: 'i', round: ROUND, approved_by: 'L', created_at: 'x', state: 'active', max_pods: 2, cost_cap_usd: 50, cap_enabled: true, est_total_usd: 1, spent_usd: 0, started_pods: [], price_per_hour: 4 }], tasks: [{ id: 't1', import_id: 'i', round: ROUND, shot: null, kind: 'pull', state: 'running', depends_on: [], pod_id: null, pod_name: null }] }))
    queue.forget(); world()
    expect(tasks()[0]).toMatchObject({ state: 'interrupted' }); expect(tasks()[0].error).toMatch(/app stopped/)
    queue.retryTask('t1'); expect(tasks()[0].state).toBe('waiting')
  })
})

describe('several rounds on one approval', () => {
  it('queues one import per round, splits the dollar cap, and queues nothing when a round or card is bad', async () => {
    world()
    await expect(queue.importRounds([{ round: 'r1' }, { round: 'r1' }], { approved_by: 'L' })).rejects.toThrow(/twice/)
    await expect(queue.importRounds([{ round: 'r1' }], {})).rejects.toThrow(/approved_by/)
    await expect(queue.importRounds([{ round: 'r1' }, { round: 'r2', cards: { 'cgi-042': 'nope' } }], { approved_by: 'L' })).rejects.toThrow(/Unknown card/)
    expect(queue.list().imports).toHaveLength(0)   // nothing was queued
    const out = await queue.importRounds([{ round: 'r1', shots: ['cgi-042'] }, { round: 'r2', max_pods: 3 }], { approved_by: 'L', cost_cap_usd: 40 })
    expect(out.map((i) => [i.round, i.cost_cap_usd])).toEqual([['r1', 20], ['r2', 20]])
    expect(out[1].max_pods).toBe(3)
  })
})

describe('the volume for an import', () => {
  it('is checked before anything is queued and can be named; a missing one queues nothing', async () => {
    const w = world()
    await queue.importRounds([{ round: 'r1' }, { round: 'r2' }], { approved_by: 'L', volume_id: 'vol9' })
    expect((w as any).vols[0]).toBe('vol9')
    queue.configure({ ensureVolume: async () => { throw new Error('The network volume "x" is not one of your volumes') } })
    await expect(queue.importRounds([{ round: 'r3' }], { approved_by: 'L' })).rejects.toThrow(/not one of your volumes/)
    expect(queue.list().imports.map((i) => i.round)).not.toContain('r3')
  })
})

describe('retrying a pull', () => {
  it('puts back the runs that failed only because the pull did not finish', async () => {
    const w = world()
    await queue.importRound(ROUND, { shots: ['cgi-042'], approved_by: 'L' })
    w.pull.state = 'failed'; await queue.tick(); await queue.tick()
    expect(states()).toEqual(['pull=failed', 'run:cgi-042=failed'])
    const pull = tasks().find((t) => t.kind === 'pull')!
    queue.retryTask(pull.id)
    expect(states()).toEqual(['pull=waiting', 'run:cgi-042=waiting'])
  })
})
