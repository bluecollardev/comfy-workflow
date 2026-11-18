import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as queue from '../src/queue.js'
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
function world(pool: { id: string; name: string; state: 'running' | 'starting' | 'off' }[] = [], price = 4) {
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
    createPod: async (name, round, gpu) => { const fm = (w as any).freeLeft as Record<string, number> | undefined; (w as any).asked = [...((w as any).asked ?? []), gpu]; if (fm && gpu && gpu in fm) { if (fm[gpu] <= 0) throw new CoreError(502, `No card available right now: tried ${gpu} on SECURE`, 'no_card'); fm[gpu]-- } if ((w as any).transient) throw new CoreError(502, 'RunPod 500'); if ((w as any).noCard) throw new Error('No card available right now: tried rtxpro6000 on SECURE'); (w.gpuOf ||= {})[`new${w.created.length + 1}`] = gpu; const id = `new${w.created.length + 1}`; w.created.push(id); (w.rounds ||= {})[id] = round; w.pods.push({ id, name, state: 'running', price }); w.ready.add(id); return { id, name } },
    assignShot: (id, round, shot) => { (w.shotOf ||= {})[id] = `${round}/${shot}` },
    stopPod: async (id) => { w.stopped.push(id) },
    pull: async (_r: string, shots?: string[]) => { (w as any).pulledShots = shots; return { id: 'pj1' } },
    pullJob: (() => ({ id: 'pj1', state: w.pull.state, pod_id: 'pullpod', pod_name: 'pull', gpu: 'RTX 4090', price_per_hour: 0.34, files: 9, place: w.pull.place, error: w.pull.state === 'failed' ? 'aws failed' : undefined })) as never,
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
