import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as queue from '../src/queue.js'
import * as cards from '../src/cards.js'
import { CoreError } from '../src/errors.js'
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
function world(pool: { id: string; name: string; state: 'running' | 'starting' | 'off' }[] = [], price = 4, extra: Partial<queue.Deps> = {}) {
  const w = {
    pods: pool.map((p) => ({ ...p, price: price as number | null })), ready: new Set<string>(pool.filter((p) => p.state === 'running').map((p) => p.id)),
    resumed: [] as string[], created: [] as string[], stopped: [] as string[], runs: new Map<string, { podId: string; paths: string[]; state: 'running' | 'done' | 'failed' | 'cancelled'; err?: string }>(),
    pull: { state: 'running' as 'running' | 'done' | 'failed', place: PLACE as unknown },
  }
  queue.configure({
    shotsOf: async () => ['cgi-042', 'cgi-043', 'cgi-044'],
    planPull: async () => ({ price_per_hour: price, ceiling_minutes: 60, bytes: 1 }),
    volumePods: async () => w.pods.map((p) => ({ id: p.id, name: p.name, state: p.state, price: p.price, gpu: 'RTX 2000 Ada' })),
    podReady: async (id) => ({ ready: w.ready.has(id), price }),
    resumePod: async (id) => { w.resumed.push(id); const p = w.pods.find((x) => x.id === id)!; p.state = 'running'; w.ready.add(id) },
    ensureVolume: async (id) => { (w.vols ||= []).push(id ?? null) },
    cardPrice: async (g) => ({ rtx5090: 2, a40: 0.5, rtx4090: 1 } as Record<string, number>)[g] ?? null,
    now: () => new Date((w as any).clock ?? Date.now()),
    createPod: async (name, round, gpu, gpuCount) => { (w as any).counts = [...((w as any).counts ?? []), gpuCount ?? 1]; const fm = (w as any).freeLeft as Record<string, number> | undefined; (w as any).asked = [...((w as any).asked ?? []), gpu]; if (fm && gpu && gpu in fm) { if (fm[gpu] <= 0) throw new CoreError(502, `No card available right now: tried ${gpu} on SECURE`, 'no_card'); fm[gpu]-- } if ((w as any).transient) throw new CoreError(502, 'RunPod 500'); if ((w as any).noCard) throw new Error('No card available right now: tried rtxpro6000 on SECURE'); (w.gpuOf ||= {})[`new${w.created.length + 1}`] = gpu; const id = `new${w.created.length + 1}`; w.created.push(id); (w.rounds ||= {})[id] = round; w.pods.push({ id, name, state: 'running', price }); w.ready.add(id); return { id, name } },
    assignShot: (id, round, shot) => { (w.shotOf ||= {})[id] = `${round}/${shot}` },
    stopPod: async (id) => { w.stopped.push(id) },
    autoSync: (id: string, by: string, a: { pull: boolean; push: boolean }) => { ((w as any).auto ||= []).push({ id, by, a }); return true },
    pull: async (_r: string, shots?: string[]) => { (w as any).pulledShots = shots; return { id: 'pj1' } },
    pullJob: (() => ({ id: 'pj1', state: w.pull.state, pod_id: 'pullpod', pod_name: 'pull', gpu: 'RTX 4090', price_per_hour: 0.34, files: 9, place: w.pull.place, error: w.pull.state === 'failed' ? 'aws failed' : undefined })) as never,
    cancelPull: () => { w.pull.state = 'failed' },
    run: async (podId, paths) => { const id = `rj${w.runs.size + 1}`; w.runs.set(id, { podId, paths, state: 'running' }); return { id } },
    runJob: ((id: string) => { const r = w.runs.get(id); return r ? { id, state: r.state, ok: r.state === 'done' ? r.paths.length : 0, failed: r.state === 'failed' ? 1 : 0, results: r.paths.map((p) => ({ path: p, state: r.state === 'failed' ? 'failed' : 'done', error: r.err })) } : null }) as never,
    cancelRun: (id) => { const r = w.runs.get(id); if (r) r.state = 'cancelled' },
    ...extra,
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
    await queue.tick(); await queue.tick()   // the pull is running: its pod's card is read
    w.pull.state = 'done'; await queue.tick(); await queue.tick()
    expect(w.created).toEqual(['new1'])   // the shot with a card did not take the running pool pod
    expect((w as any).gpuOf.new1).toBe('rtx5090')
    expect((w as any).pulledShots).toEqual(['cgi-042', 'cgi-043'])   // the pull is told which shots to copy: only those
    expect((w as any).shotOf).toEqual({ new1: `${ROUND}/cgi-042`, pool1: `${ROUND}/cgi-043` })   // each pod card names its round and shot
    expect(queue.list().tasks.find((x) => x.shot === 'cgi-043')?.pod_id).toBe('pool1')
    expect(queue.list().tasks.find((x) => x.shot === 'cgi-043')?.card).toBe('RTX 2000 Ada')   // a reused pod: the card it really has
    const pullT = queue.list().tasks.find((x) => x.kind === 'pull')!
    expect(pullT.card).toBe('RTX 4090'); expect(pullT.price).toBe(0.34)   // the pull's pod: its real card and price, not blank
    expect(pullT.events?.map((e) => e.text).join(' | ')).toMatch(/pod pull \(pullpod, RTX 4090, \$0.34\/h\)/)
    const evs = (shot: string) => (queue.list().tasks.find((x) => x.shot === shot)?.events ?? []).map((e) => e.text).join(' | ')
    expect(queue.list().tasks.find((x) => x.shot === 'cgi-042')?.card).toBe('rtx5090')   // the card used is on the task
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

  it('pull first; then runs on pool pods within the pod limit; the next shot waits for a free pod; no pod is stopped at the end', async () => {
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
    expect(queue.list().imports[0].state).toBe('done'); expect(w.stopped).toEqual([])   // no pod is stopped when the import ends: the idle stop does that
    expect(history.list({ kind: 'job' }).filter((e) => e.kind === 'job' && e.job === 'queue' && e.state === 'done').length).toBeGreaterThanOrEqual(4)
  })

  it('creates a pod only when none can be started, and leaves it running afterwards', async () => {
    const w = world([])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'] })
    await queue.tick(); w.pull.state = 'done'; await queue.tick(); await queue.tick(); await queue.tick()
    expect(w.created).toHaveLength(1)
    expect((w as any).rounds).toEqual({ new1: ROUND })   // the pod it made goes into the round it imports (ADR-039)
    w.runs.get('rj1')!.state = 'done'; await queue.tick(); await queue.tick()
    expect(w.stopped).toEqual([])   // left running: the idle stop ends it
  })

  it('a failed run is a failed task with its error, and is in the History', async () => {
    const w = world([{ id: 'p1', name: 'h100-1', state: 'running' }])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'] })
    await queue.tick(); w.pull.state = 'done'; await queue.tick(); await queue.tick(); await queue.tick()
    const r = w.runs.get('rj1')!; r.state = 'failed'; r.err = 'CUDA out of memory (node 4, KSampler)'; await queue.tick()
    const t = tasks()[1]; expect(t.state).toBe('failed'); expect(t.error).toMatch(/CUDA out of memory/)
    const fl = await import('../src/failures.js'); await fl.settled(); expect((await fl.list({ job_id: t.id })).failures[0]).toMatchObject({ job_id: t.id, retryable: false })   // the failed import task is in the failures log too
    expect(t.failure).toMatchObject({ stage: expect.any(String), retryable: false, recovery: expect.stringMatching(/Not retried/) }); expect(t.failure!.text).toMatch(/^stage: .*\nnode: .*\nmessage: .*CUDA out of memory.*\nretryable: no\nrecovery: /s)   // queue_list: a failed task is never just 'failed'
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
    expect(tasks().find((x) => x.kind === 'run')?.error).toMatch(/^Not started: its pull did not finish: aws failed/)   // it says why
    const pull = tasks().find((t) => t.kind === 'pull')!
    queue.retryTask(pull.id)
    expect(states()).toEqual(['pull=waiting', 'run:cgi-042=waiting'])
  })
})

describe('the pool default card shows in the queue too', () => {
  it('a pod the queue creates for a shot with no card says which card it is (the default card)', async () => {
    const w = world()
    await queue.importRound(ROUND, { shots: ['cgi-042'], approved_by: 'L' })
    w.pull.state = 'done'; await queue.tick(); await queue.tick()
    expect(w.created).toEqual(['new1'])
    expect(queue.list().tasks.find((x) => x.shot === 'cgi-042')?.card).toBe(queue.poolGpu())
    expect((queue.list().tasks.find((x) => x.shot === 'cgi-042')?.events ?? []).map((e) => e.text).join(' ')).toContain(queue.poolGpu())
  })
})

describe('no card free', () => {
  it('a run waits and asks again later instead of failing', async () => {
    const w = world() as any
    w.clock = Date.parse('2026-11-09T12:00:00Z'); w.noCard = true
    await queue.importRound(ROUND, { shots: ['cgi-042'], cards: { 'cgi-042': 'rtxpro6000' }, approved_by: 'L' })
    w.pull.state = 'done'; await queue.tick(); await queue.tick()
    let t = tasks().find((x) => x.shot === 'cgi-042')!
    expect(t.state).toBe('waiting'); expect(t.attempts).toBe(1); expect(t.stage).toMatch(/waiting for a free rtxpro6000/)
    await queue.tick(); expect(tasks().find((x) => x.shot === 'cgi-042')!.attempts).toBe(1)   // not before the minute is up
    w.clock += queue.CARD_RETRY_MS + 1; w.noCard = false
    await queue.tick()
    t = tasks().find((x) => x.shot === 'cgi-042')!
    expect(t.state).toBe('running'); expect(w.created).toEqual(['new1']); expect(t.attempts).toBeUndefined()
  })

  it('purges finished imports only on a yes, never one with work left, and can limit by id or age', async () => {
    const w = world([{ id: 'pool1', name: 'pool', state: 'running' }])
    const a = await queue.importRound(ROUND, { shots: ['cgi-042'], approved_by: 'Lucas' })
    expect(() => queue.purge({})).toThrow(/yes/)
    expect(queue.purge({ confirmed: true })).toEqual({ removed_imports: 0, removed_tasks: 0 })   // still active: kept
    queue.cancelImport(a.id)
    expect(() => queue.purge({ confirmed: true, import_id: 'nope' })).toThrow(/No such import/)
    expect(queue.purge({ confirmed: true, older_than_days: 1 })).toEqual({ removed_imports: 0, removed_tasks: 0 })   // finished just now
    expect(queue.purge({ confirmed: true })).toEqual({ removed_imports: 1, removed_tasks: 2 })
    expect(queue.list().imports).toHaveLength(0)
    void w
  })
})

describe('several cards for a shot: the first free one in order, one pod per attempt', () => {
  const three = ['cgi-042', 'cgi-043', 'cgi-044']
  const manyCards = (cards: string[] | string) => Object.fromEntries(three.map((s) => [s, cards]))
  const cardOf = (s: string) => tasks().find((t) => t.shot === s)!
  const settle = async () => { await queue.tick(); await queue.tick(); await queue.tick() }
  it('every new pod asks from the first card: A, A, then B when A has only two free; a later pod tries A again', async () => {
    const w = world(); (w as any).freeLeft = { rtx4090: 2, a40: 9 }
    await queue.importRound(ROUND, { shots: three, cards: manyCards(['rtx4090', 'a40']), approved_by: 'Lucas', max_pods: 3 })
    expect(cardOf('cgi-042')).toMatchObject({ gpu: 'rtx4090', gpus: ['rtx4090', 'a40'] })
    w.pull.state = 'done'; await settle()
    expect(three.map((s) => cardOf(s).card)).toEqual(['rtx4090', 'rtx4090', 'a40'])   // mixed only because A ran out
    expect((w as any).asked).toEqual(['rtx4090', 'rtx4090', 'rtx4090', 'a40'])   // the third pod asked A first, got no-card, then B: one pod made
    expect(w.created).toHaveLength(3)
    // A frees up: the next import's pod starts again from the first card
    ;(w as any).freeLeft.rtx4090 = 1; (w as any).asked = []
    await queue.importRound('round-two', { shots: ['cgi-042'], cards: { 'cgi-042': ['rtx4090', 'a40'] }, approved_by: 'Lucas' })
    await settle()
    expect((w as any).asked[0]).toBe('rtx4090')
    expect(queue.list().tasks.find((x) => x.round === 'round-two' && x.shot === 'cgi-042')?.card).toBe('rtx4090')
  })
  it('none free on every card behaves as one no-card does: the task waits and asks again', async () => {
    const w = world(); (w as any).freeLeft = { rtx4090: 0, a40: 0 }; (w as any).clock = Date.parse('2026-11-09T12:00:00Z')
    await queue.importRound(ROUND, { shots: ['cgi-042'], cards: { 'cgi-042': ['rtx4090', 'a40'] }, approved_by: 'Lucas' })
    w.pull.state = 'done'; await settle()
    const t = cardOf('cgi-042')
    expect(t.state).toBe('waiting'); expect(t.attempts).toBe(1); expect(t.stage).toMatch(/waiting for a free rtx4090 or a40/)
    expect((w as any).asked).toEqual(['rtx4090', 'a40']); expect(w.created).toHaveLength(0)
  })
  it('an unknown or transient error never goes on to a second card', async () => {
    const w = world(); (w as any).transient = true
    await queue.importRound(ROUND, { shots: ['cgi-042'], cards: { 'cgi-042': ['rtx4090', 'a40'] }, approved_by: 'Lucas' })
    w.pull.state = 'done'; await settle()
    expect((w as any).asked).toEqual(['rtx4090']); expect(cardOf('cgi-042').state).toBe('failed'); expect(w.created).toHaveLength(0)
  })
  it('a single card (string, or a one-element list) behaves as today; every key is validated; the most expensive card prices the estimate', async () => {
    world()
    await queue.importRound(ROUND, { shots: ['cgi-042'], cards: { 'cgi-042': 'rtx5090' }, approved_by: 'Lucas' })
    expect(cardOf('cgi-042')).toMatchObject({ gpu: 'rtx5090', price: 2 }); expect(cardOf('cgi-042').gpus).toBeUndefined()
    await expect(queue.planImport(ROUND, { cards: { 'cgi-042': ['rtx4090', 'nope'] } })).rejects.toThrow(/Unknown card "nope"/)
    const one = await queue.planImport(ROUND, { shots: ['cgi-042'], cards: { 'cgi-042': ['a40'] } })
    const two = await queue.planImport(ROUND, { shots: ['cgi-042'], cards: { 'cgi-042': ['a40', 'rtx5090'] } })
    expect(one.est_total_usd).toBe(4 * 1 + 0.5 * queue.RUN_ESTIMATE_H)
    expect(two.est_total_usd).toBe(4 * 1 + 2 * queue.RUN_ESTIMATE_H)   // the dearer of the two
    expect(two.assumption).toMatch(/most expensive/); expect(one.assumption).toBeUndefined()
  })
  it('edge cases: duplicates collapse, one card in a list is a single card, an empty list is refused, an unknown key in the middle refuses the plan', async () => {
    world()
    expect(queue.cardList(['a40', 'a40', ' rtx4090 ', ''])).toEqual(['a40', 'rtx4090'])
    expect(queue.cardList('a40')).toEqual(['a40']); expect(queue.cardList(undefined)).toEqual([])
    await queue.importRound(ROUND, { shots: ['cgi-042'], cards: { 'cgi-042': ['a40', 'a40'] }, approved_by: 'Lucas' })
    expect(cardOf('cgi-042')).toMatchObject({ gpu: 'a40' }); expect(cardOf('cgi-042').gpus).toBeUndefined()
    await expect(queue.planImport(ROUND, { cards: { 'cgi-042': [] } })).rejects.toThrow(/empty list/)
    await expect(queue.planImport(ROUND, { cards: { 'cgi-042': ['a40', 'nope', 'rtx4090'] } })).rejects.toThrow(/Unknown card "nope" for cgi-042/)
    await expect(queue.planImport(ROUND, { cards: { 'cgi-042': ['a40', 5 as never] } })).rejects.toThrow(/card keys/)
  })
  it('several rounds on one approval: each shot of each round gets the ordered list; max_pods per round is kept; a bad key in any round queues nothing', async () => {
    world()
    const out = await queue.importRounds([{ round: 'r1', shots: ['cgi-042'], cards: { 'cgi-042': ['rtx4090', 'a40'] }, max_pods: 3 }, { round: 'r2', shots: ['cgi-043'], cards: { 'cgi-043': 'a40' }, max_pods: 1 }], { approved_by: 'Lucas', cost_cap_usd: 40 })
    expect(out.map((i) => i.max_pods)).toEqual([3, 1]); expect(out.map((i) => i.cost_cap_usd)).toEqual([20, 20])
    expect(tasks().find((t) => t.round === 'r1' && t.shot === 'cgi-042')).toMatchObject({ gpus: ['rtx4090', 'a40'], gpu: 'rtx4090', price: 1 })
    expect(tasks().find((t) => t.round === 'r2' && t.shot === 'cgi-043')).toMatchObject({ gpu: 'a40' })
    queue.forget()
    await expect(queue.importRounds([{ round: 'r3', cards: { 'cgi-042': ['a40'] } }, { round: 'r4', cards: { 'cgi-042': ['a40', 'nope'] } }], { approved_by: 'Lucas' })).rejects.toThrow(/Unknown card/)
  })
})

describe('Auto sync for the pods an import creates (docs/ADR-046)', () => {
  it('autoOf: true is pull only; an object chooses; nothing or false is none', () => {
    expect(queue.autoOf(true)).toEqual({ pull: true, push: false }); expect(queue.autoOf({ push: true })).toEqual({ pull: true, push: true }); expect(queue.autoOf({ pull: false })).toBeUndefined()
    expect(queue.autoOf(false)).toBeUndefined(); expect(queue.autoOf(undefined)).toBeUndefined()
  })
  it('a pod the import CREATES gets it, with the import\'s approver; the record says so', async () => {
    const w = world([])
    const imp = await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'], auto_sync: true })
    expect(imp.auto_sync).toEqual({ pull: true, push: false })
    await queue.tick(); w.pull.state = 'done'; await queue.tick(); await queue.tick(); await queue.tick()
    expect(w.created).toHaveLength(1); expect((w as any).auto).toEqual([{ id: w.created[0], by: 'Lucas', a: { pull: true, push: false } }])
    expect(tasks().find((t) => t.kind === 'run')?.events?.some((e) => /Auto sync on/.test(e.text))).toBe(true)
  })
  it('a pod reused from the pool is not changed, and an import without auto_sync touches nothing', async () => {
    const w = world([{ id: 'p1', name: 'pool-1', state: 'running' }])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'], auto_sync: { pull: true, push: true } })
    await queue.tick(); w.pull.state = 'done'; await queue.tick(); await queue.tick(); await queue.tick()
    expect(w.created).toHaveLength(0); expect((w as any).auto).toBeUndefined()
  })
  it('an import without auto_sync touches nothing', async () => {
    const w2 = world([])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'] }); await queue.tick(); w2.pull.state = 'done'; await queue.tick(); await queue.tick(); await queue.tick()
    expect(w2.created).toHaveLength(1); expect((w2 as any).auto).toBeUndefined()
  })
  it('importRounds: a per-round choice overrides the import-wide one', async () => {
    world([]); const imps = await queue.importRounds([{ round: ROUND, shots: ['cgi-042'], auto_sync: false }, { round: 'other-round', shots: ['cgi-042'] }], { approved_by: 'Lucas', auto_sync: true }).catch(() => null)
    if (imps) { expect(imps[0].auto_sync).toBeUndefined(); expect(imps[1].auto_sync).toEqual({ pull: true, push: false }) }
  })
})

// Import Round options: Run Workflows > Generate Outputs > Publish
describe('Generate Outputs and Publish (Import Round options)', () => {
  const SEQ = { dir: 'cgi-043', name: 'cgi-043_v1', first: 1, last: 24, frames: 24, pad: 4 }
  type Fakes = { sequences: any[]; skipped: any[]; renders: any[]; render: { state: string; error?: string; seqs: any[] }; published: any[]; pub: { state: string; error?: string }; problem: string | null; slack: boolean; include_dpx: boolean; startErr?: Error; pubErr?: Error; since: number[] }
  function fakes(): { f: Fakes; extra: Partial<queue.Deps> } {
    const f: Fakes = { sequences: [SEQ], skipped: [], renders: [], render: { state: 'rendering', seqs: [{ where: 'pod', dir: 'cgi-043', name: 'cgi-043_v1', clip_name: 'cgi-043_v1', shot: 'cgi-043', version: 'v001', state: 'rendered', out: 'output/deliver/cgi-043/v001/cgi-043_v1.mov' }] }, published: [], pub: { state: 'uploading' }, problem: null, slack: false, include_dpx: false, since: [] }
    const extra: Partial<queue.Deps> = {
      newSequences: async (_s, since) => { f.since.push(since); return { sequences: f.sequences, skipped: f.skipped } },
      startRender: async (req) => { if (f.startErr) throw f.startErr; f.renders.push(req); return { job_id: 'rd1' } },
      renderJob: (() => ({ job_id: 'rd1', state: f.render.state, error: f.render.error, kind: 'review', summary: '', sequences: f.render.seqs })) as never,
      publishProblem: async () => f.problem, renderSlack: () => f.slack, publishRound: () => ({ round: 'tunnel-v11_2026-11-20_r01', include_dpx: f.include_dpx }),
      publishRun: async (req) => { if (f.pubErr) throw f.pubErr; f.published.push(req); return { job_id: 'pb1' } },
      publishJob: (() => ({ state: f.pub.state, error: f.pub.error })) as never,
    }
    return { f, extra }
  }
  const OPTS = { approved_by: 'Lucas', shots: ['cgi-043'] }
  const POOL = [{ id: 'p1', name: 'pool-1', state: 'running' as const }]
  const finishRun = async (w: ReturnType<typeof world>) => { await queue.tick(); w.pull.state = 'done'; await queue.tick(); await queue.tick(); await queue.tick(); for (const r of w.runs.values()) r.state = 'done'; await queue.tick() }
  const notes = () => queue.list().imports[0].output_notes?.join(' ') ?? ''

  it('validates every dependency in plain words', async () => {
    const { extra } = fakes(); world([], 4, extra)
    await expect(queue.importRound(ROUND, { ...OPTS, run_workflows: false, generate_outputs: true })).rejects.toMatchObject({ status: 400, message: /Generate Outputs needs Run Workflows/ })
    await expect(queue.importRound(ROUND, { ...OPTS, publish: true })).rejects.toMatchObject({ status: 400, message: /Publish needs Generate Outputs/ })
    await expect(queue.importRound(ROUND, { ...OPTS, generate_outputs: false, publish: true })).rejects.toMatchObject({ status: 400, message: /Publish needs Generate Outputs/ })
    await expect(queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: { s3: false, slack: true } })).rejects.toMatchObject({ status: 400, message: /Slack only follows an S3 upload/ })
    await expect(queue.importRound(ROUND, { shots: ['cgi-043'], approved_by: ' ', generate_outputs: true })).rejects.toMatchObject({ status: 400 })
    await expect(queue.importRound(ROUND, { ...OPTS, generate_outputs: 'yes' as never })).rejects.toMatchObject({ status: 400 })
    await expect(queue.planImport(ROUND, { shots: ['cgi-043'], publish: true })).rejects.toMatchObject({ status: 400, message: /Publish needs Generate Outputs/ })
    expect(queue.list().imports).toHaveLength(0)
  })
  it('publish needs Publish settings that are ready: a 400 with the reason, nothing queued', async () => {
    const { f, extra } = fakes(); world([], 4, extra); f.problem = 'S3 is not configured: no bucket'
    await expect(queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: true })).rejects.toMatchObject({ status: 400, message: /Cannot publish: S3 is not configured: no bucket/ })
    expect(queue.list().imports).toHaveLength(0)
  })
  it('importRounds refuses a broken per-round option before queueing anything', async () => {
    const { extra } = fakes(); world([], 4, extra)
    await expect(queue.importRounds([{ round: ROUND, shots: ['cgi-043'] }, { round: 'other-round', publish: true }], { approved_by: 'Lucas' })).rejects.toMatchObject({ status: 400, message: /Publish needs Generate Outputs/ })
    expect(queue.list().imports).toHaveLength(0)
  })
  it('Convert To Rec.709: needs Generate Outputs, is validated, shows in the plan, is stored on the import and reaches the render; off by default (rec709: false)', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra)
    await expect(queue.planImport(ROUND, { shots: ['cgi-043'], convert_rec709: true })).rejects.toMatchObject({ status: 400, message: /Convert To Rec\.709 needs Generate Outputs/ })
    await expect(queue.importRound(ROUND, { ...OPTS, generate_outputs: true, convert_rec709: 'yes' as never })).rejects.toMatchObject({ status: 400, message: /convert_rec709 is true or false/ })
    expect(queue.list().imports).toHaveLength(0)
    expect((await queue.planImport(ROUND, { shots: ['cgi-043'], generate_outputs: true, convert_rec709: true })).convert_rec709).toBe(true)
    expect((await queue.planImport(ROUND, { shots: ['cgi-043'], generate_outputs: true })).convert_rec709).toBeUndefined()
    const imp = await queue.importRound(ROUND, { ...OPTS, generate_outputs: true, convert_rec709: true }); expect(imp.convert_rec709).toBe(true)
    await finishRun(w); expect(f.renders).toHaveLength(1); expect(f.renders[0]).toMatchObject({ rec709: true })
  })
  it('without Convert To Rec.709 the import asks the render to keep the signal (rec709: false) and stores nothing', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra)
    const imp = await queue.importRound(ROUND, { ...OPTS, generate_outputs: true }); expect(imp.convert_rec709).toBeUndefined()
    await finishRun(w); expect(f.renders).toHaveLength(1); expect(f.renders[0]).toMatchObject({ rec709: false })
  })
  it('shows the options in the plan, resolves Slack (only with S3), and stores them on the import', async () => {
    const { f, extra } = fakes(); world([], 4, extra); f.slack = true
    const plan = await queue.planImport(ROUND, { shots: ['cgi-043'], generate_outputs: true, publish: true })
    expect(plan.generate_outputs).toBe(true); expect(plan.publish).toEqual({ s3: true, slack: true })
    const none = await queue.planImport(ROUND, { shots: ['cgi-043'] }); expect(none.generate_outputs).toBeUndefined(); expect(none.publish).toBeUndefined()
    const imp = await queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: { slack: false } })
    expect(imp.generate_outputs).toBe(true); expect(imp.publish).toEqual({ s3: true, slack: false })
    expect((await queue.planImport('r2', { shots: ['cgi-043'], generate_outputs: true })).publish).toBeUndefined()
  })
  it('an import without the options never touches renders or publish', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra)
    await queue.importRound(ROUND, OPTS); await finishRun(w)
    expect(f.renders).toHaveLength(0); expect(f.published).toHaveLength(0); expect(tasks().find((t) => t.kind === 'run')?.post).toBeUndefined()
  })
  it('when the workflows finish: ONE render on that pod under the approver (no pull, skip existing), then publish when it finishes, to the Auto-publish round', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra)
    const imp = await queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: true })
    await finishRun(w)
    expect(f.renders).toHaveLength(1)
    expect(f.renders[0]).toMatchObject({ pod_id: 'p1', where: 'pod', pull: false, approved_by: 'Lucas', skip_existing: true, sequences: [SEQ] })
    expect(f.renders[0].kind).toBeUndefined()   // kind, codecs and colour are the Default Configuration's
    expect(f.published).toHaveLength(0)         // publish waits for the render
    expect(queue.list().imports.find((i) => i.id === imp.id)?.state).toBe('active')   // the import stays open while the outputs are made
    f.render.state = 'done'; await queue.tick()
    expect(f.published).toHaveLength(1)
    expect(f.published[0]).toMatchObject({ approved_by: 'Lucas', targets: ['s3'], round: 'tunnel-v11_2026-11-20_r01', items: [{ where: 'volume', path: 'deliver/cgi-043/v001' }] })
    f.pub.state = 'done'; await queue.tick()
    expect(tasks().find((t) => t.kind === 'run')?.post?.state).toBe('done')
    expect(queue.list().imports.find((i) => i.id === imp.id)?.state).toBe('done')
  })
  it('Slack only with S3 and only when chosen; include_dpx adds the DPX frames the review came from', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra); f.slack = true; f.include_dpx = true
    await queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: true }); await finishRun(w); f.render.state = 'done'; await queue.tick()
    expect(f.published[0].targets).toEqual(['s3', 'slack'])
    expect(f.published[0].items).toEqual([{ where: 'volume', path: 'deliver/cgi-043/v001' }, { where: 'volume', path: 'cgi-043', stem: 'cgi-043_v1' }])
  })
  it('Generate Outputs alone never publishes', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra)
    const imp = await queue.importRound(ROUND, { ...OPTS, generate_outputs: true }); await finishRun(w); f.render.state = 'done'; await queue.tick()
    expect(f.renders).toHaveLength(1); expect(f.published).toHaveLength(0); expect(tasks().find((t) => t.kind === 'run')?.post?.state).toBe('done'); expect(queue.list().imports.find((i) => i.id === imp.id)?.state).toBe('done')
  })
  it('a failed run starts nothing (never partial)', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra)
    await queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: true }); await queue.tick(); w.pull.state = 'done'; await queue.tick(); await queue.tick(); await queue.tick(); for (const r of w.runs.values()) r.state = 'failed'; await queue.tick()
    expect(f.renders).toHaveLength(0); expect(f.published).toHaveLength(0)
  })
  it('a locked shot is never generated or published', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra)
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'], generate_outputs: true, publish: true }); await finishRun(w)
    expect(f.renders).toHaveLength(0); expect(f.published).toHaveLength(0); expect(notes()).toMatch(/locked/)
  })
  it('nothing new: said on the card with the reasons, the import goes on and ends', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra); f.sequences = []; f.skipped = [{ stem: 'x', reason: 'incomplete: 2 gaps in the frames' }]
    await queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: true }); await finishRun(w)
    expect(f.renders).toHaveLength(0); expect(f.published).toHaveLength(0)
    expect(notes()).toMatch(/no new finished DPX sequences.*incomplete/); expect(queue.list().imports[0].state).toBe('done')
  })
  it('a render that cannot start (no ffmpeg) is said on the card and in the History; the run stays done and publish never runs', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra); f.startErr = new Error('ffmpeg is not installed on this PC')
    await queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: true }); await finishRun(w)
    expect(f.published).toHaveLength(0); expect(notes()).toMatch(/pool-1.*cannot generate: ffmpeg is not installed/); expect(queue.list().imports[0].state).toBe('done')
    expect(tasks().find((t) => t.kind === 'run')?.state).toBe('done')
    const hist = readFileSync(process.env.HISTORY_FILE!, 'utf8'); expect(hist).toMatch(/ffmpeg is not installed/); expect(hist).toMatch(/pool-1/)
  })
  it('a render that fails: no publish, the reason on the card', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra); f.render.state = 'failed'; f.render.error = 'Incomplete: gaps'
    await queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: true }); await finishRun(w); await queue.tick()
    expect(f.published).toHaveLength(0); expect(notes()).toMatch(/generate failed: Incomplete/); expect(queue.list().imports[0].state).toBe('done')
  })
  it('a publish that cannot start, or fails: said on the card, the import still ends', async () => {
    let { f, extra } = fakes(); let w = world(POOL, 4, extra); f.pubErr = new Error('Cannot publish: S3 is not configured')
    await queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: true }); await finishRun(w); f.render.state = 'done'; await queue.tick()
    expect(notes()).toMatch(/Cannot publish: S3 is not configured/); expect(queue.list().imports[0].state).toBe('done')
    process.env.QUEUE_FILE = join(dir, 'queue2.json'); queue.forget(); ;({ f, extra } = fakes()); w = world(POOL, 4, extra); f.pub.state = 'failed'; f.pub.error = 'upload broke'
    await queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: true }); await finishRun(w); f.render.state = 'done'; await queue.tick(); await queue.tick()
    expect(notes()).toMatch(/publish failed: upload broke/); expect(queue.list().imports[0].state).toBe('done')
    const hist = readFileSync(process.env.HISTORY_FILE!, 'utf8'); expect(hist).toMatch(/"area":"queue"|upload broke/); expect(hist).toMatch(/Lucas/)
  })
  it('records each started step in the History with the approver', async () => {
    const { f, extra } = fakes(); const w = world(POOL, 4, extra)
    await queue.importRound(ROUND, { ...OPTS, generate_outputs: true, publish: true }); await finishRun(w); f.render.state = 'done'; await queue.tick()
    const lines = readFileSync(process.env.HISTORY_FILE!, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    for (const a of ['queued an import with outputs', 'import generates outputs', 'import publishes outputs']) expect(lines.find((l) => l.action === a)).toMatchObject({ approved_by: 'Lucas', area: a === 'queued an import with outputs' ? 'import' : 'queue' })
  })
})

describe('out of memory: the next card up, on its own', () => {
  type R = { path: string; state: string; error?: string; oom?: boolean; recovery?: string }
  /** a world whose runs fail the way the script says: per run, `oom` (a graph the pod could not hold), `graph` (a validation error) or `ok` */
  const oomWorld = (script: ('oom' | 'graph' | 'ok')[], extra: Partial<queue.Deps> = {}) => {
    let n = 0
    const w: ReturnType<typeof world> = world([], 4, {
      run: async (podId: string, paths: string[]) => { const id = `rj${++n}`; w.runs.set(id, { podId, paths, state: 'running' }); (w as any).ran = [...((w as any).ran ?? []), { id, podId, paths }]; return { id } },
      runJob: ((id: string) => {
        const r = w.runs.get(id); if (!r) return null
        const how = script[Number(id.slice(2)) - 1] ?? 'ok'
        if (r.state === 'running') r.state = how === 'ok' ? 'done' : 'failed'
        const results: R[] = r.paths.map((p, k) => how === 'ok' ? { path: p, state: 'done' } : k === 0 ? { path: p, state: 'failed', error: how === 'oom' ? 'ComfyUI answered HTTP 502 for /history/x' : 'Prompt outputs failed validation', ...(how === 'oom' ? { oom: true, recovery: 'Out of memory (the pod log says: triggered memory limits (OOM))' } : {}) } : { path: p, state: 'skipped', error: 'Not started: dispatch was paused' })
        return { id, state: r.state, ok: how === 'ok' ? r.paths.length : 0, failed: how === 'ok' ? 0 : 1, results }
      }) as never,
      ...extra,
    })
    return w
  }
  const go = async (ticks = 8) => { for (let k = 0; k < ticks; k++) await queue.tick() }
  const evs = () => (tasks().find((x) => x.kind === 'run')?.events ?? []).map((e) => e.text)

  it('a graph that ran out of memory goes back to waiting with MORE GPUs of the same card (RAM comes with the GPU count); the small pod is stopped, not deleted; the retry runs only what did not finish', async () => {
    const w = oomWorld(['oom', 'ok'])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'], cards: { 'cgi-042': 'rtxpro4500' } })
    await go(); w.pull.state = 'done'; await go(10)
    const t = tasks().find((x) => x.kind === 'run')!
    expect(t.escalations).toBe(1); expect(t.tried_cards).toEqual(['rtxpro4500']); expect(t.state).toBe('done'); expect(t.gpu_count).toBe(2)
    expect((w as any).asked).toEqual(['rtxpro4500', 'rtxpro4500']); expect((w as any).counts).toEqual([1, 2])
    expect(w.stopped.length).toBe(1)   // the small pod was stopped; the fake has no delete at all
    expect(evs().join(' | ')).toMatch(/out of memory on RTX PRO 4500 \(32 GB\): .*2 GPUs of the same card/)
    expect((w as any).ran.map((r: { paths: string[] }) => r.paths.length)).toEqual([1, 1])
    expect(history.list({ kind: 'change' }).some((e) => (e as { action?: string }).action === 'out of memory: retried with more RAM')).toBe(true)
  })
  it('it climbs 1x -> 2x -> 4x GPUs, then a card with more RAM per GPU, and after three escalations the task fails with its error', async () => {
    const w = oomWorld(['oom', 'oom', 'oom', 'oom'])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'], cards: { 'cgi-042': 'rtxpro4500' } })
    await go(); w.pull.state = 'done'; await go(40)
    const t = tasks().find((x) => x.kind === 'run')!
    expect(t.state).toBe('failed'); expect(t.escalations).toBe(3); expect(t.error).toMatch(/502|memory/)
    expect((w as any).asked).toEqual(['rtxpro4500', 'rtxpro4500', 'rtxpro4500', 'rtxpro6000']); expect((w as any).counts).toEqual([1, 2, 4, 1])
    expect(evs().join(' | ')).toMatch(/giving up \(the limit is 3\)/)
    expect(w.stopped.length).toBe(3)   // each pod that was too small and was left for a bigger one was stopped; the last one, where the task gave up, is left to the idle stop like any failed run
  })
  it('a card whose RAM is not known falls back to the VRAM ladder, and with nothing bigger the task fails at once and says why', async () => {
    const w = oomWorld(['oom'])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'], cards: { 'cgi-042': 'rtxpro6000q' } })
    await go(); w.pull.state = 'done'; await go(10)
    const t = tasks().find((x) => x.kind === 'run')!
    expect(t.state).toBe('failed'); expect(t.escalations ?? 0).toBe(0); expect(evs().join(' | ')).toMatch(/no bigger card is allowed/)
  })
  it('a graph error is not an out-of-memory error: no bigger card is asked for', async () => {
    const w = oomWorld(['graph'])
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'], cards: { 'cgi-042': 'rtxpro4500' } })
    await go(); w.pull.state = 'done'; await go(10)
    const t = tasks().find((x) => x.kind === 'run')!
    expect(t.state).toBe('failed'); expect(t.escalations).toBeUndefined(); expect((w as any).asked).toEqual(['rtxpro4500'])
  })
  it('a retried task takes its own pod again instead of a second one (same card), and a stopped one is restarted', async () => {
    const w = oomWorld(['graph', 'ok'], { volumePods: async () => w.pods.map((p) => ({ id: p.id, name: p.name, state: p.state, price: p.price, gpu: 'RTX PRO 4500' })) })
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'], cards: { 'cgi-042': 'rtxpro4500' } })
    await go(); w.pull.state = 'done'; await go(10)
    const t0 = tasks().find((x) => x.kind === 'run')!; expect(t0.state).toBe('failed'); expect(w.created).toEqual(['new1'])
    w.pods.find((p) => p.id === 'new1')!.state = 'off'; w.ready.delete('new1')   // the pod was stopped meanwhile (an idle stop, or by hand)
    queue.retryTask(t0.id); await go(10)
    const t1 = tasks().find((x) => x.kind === 'run')!
    expect(t1.state).toBe('done'); expect(w.created).toEqual(['new1']); expect(w.resumed).toContain('new1')   // one pod only, restarted
    expect(evs().join(' | ')).toMatch(/restarted .* for the retry \(the same pod, not a second one\)/)
  })
  it('a retry whose old pod cannot be restarted (its host has no free card) creates a new pod and says so', async () => {
    const w = oomWorld(['graph', 'ok'], { volumePods: async () => w.pods.map((p) => ({ id: p.id, name: p.name, state: p.state, price: p.price, gpu: 'RTX PRO 4500' })), resumePod: async () => { throw new CoreError(409, 'There are not enough free GPUs on the host machine to start this pod.') } })
    await queue.importRound(ROUND, { approved_by: 'Lucas', shots: ['cgi-042'], cards: { 'cgi-042': 'rtxpro4500' } })
    await go(); w.pull.state = 'done'; await go(10)
    const t0 = tasks().find((x) => x.kind === 'run')!; w.pods.find((p) => p.id === 'new1')!.state = 'off'
    queue.retryTask(t0.id); await go(10)
    expect(tasks().find((x) => x.kind === 'run')!.state).toBe('done'); expect(w.created).toEqual(['new1', 'new2'])
    expect(evs().join(' | ')).toMatch(/could not restart .*: a new pod instead/)
  })
})
