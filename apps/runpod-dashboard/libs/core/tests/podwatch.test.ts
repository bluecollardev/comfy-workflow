import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CoreError } from '../src/errors.js'
import * as history from '../src/history.js'
import * as podwatch from '../src/podwatch.js'
import * as pods from '../src/pods.js'
import * as ratelimit from '../src/ratelimit.js'
import { scratch } from './helpers.js'

// Retry later (ADR-042 section 19): a watch that retries a resume or a create until RunPod has a card. A fake clock and fake calls; nothing reaches RunPod.
let dir: string, t: number
const T0 = Date.parse('2026-11-16T10:00:00Z')
const advance = (s: number) => { t += s * 1000 }
const hostFull = () => new CoreError(409, 'There are not enough free GPUs on the host machine to start this pod.', 'host_full')
const noCard = () => new CoreError(502, 'No card available right now: tried a100 on SECURE. RunPod: There are no longer any instances available', 'no_card')

beforeEach(() => {
  dir = scratch(); process.env.POD_WATCHES_FILE = join(dir, 'pod-watches.json'); process.env.HISTORY_FILE = join(dir, 'history.jsonl')
  t = T0; process.env.RUNPOD_API_KEY = 'test'
  podwatch.setClock(() => t); ratelimit.setClock(() => t); ratelimit.reset()
})

/** Fake RunPod: a set of pods, a script of answers for resume and create. */
function fake(o: { resume?: (n: number) => void; create?: (n: number, pods: { id: string; name: string }[]) => void | { lost: true } } = {}) {
  const state = { resumes: [] as { id: string; note: string }[], creates: [] as { req: Record<string, unknown>; note: string }[], pods: [] as { id: string; name: string }[] }
  podwatch.setDeps({
    resume: async (id, note) => { state.resumes.push({ id, note }); o.resume?.(state.resumes.length) },
    create: async (req, note) => {
      state.creates.push({ req, note })
      const r = o.create?.(state.creates.length, state.pods)
      const pod = { id: `pod${state.pods.length + 1}`, name: String(req.name) }
      state.pods.push(pod)
      if (r && typeof r === 'object' && 'lost' in r) throw new TypeError('fetch failed')   // the pod was made but the answer was lost
      return pod
    },
    findByName: async (name) => state.pods.find((p) => p.name === name)?.id ?? null,
  })
  return state
}

describe('resume watch', () => {
  it('retries the same resume every interval until the host has a card, then is done, once', async () => {
    const s = fake({ resume: (n) => { if (n < 3) throw hostFull() } })
    const w = podwatch.watchResume('pod9', 'CanalV2-lores', 'Waiting for a free A100 SXM in EU-RO-1', { every_s: 60 })
    expect(w).toMatchObject({ kind: 'resume', state: 'waiting', every_s: 60, attempts: 0 })
    expect(await podwatch.tick()).toBe(0); expect(s.resumes).toHaveLength(0)   // not due yet
    advance(60); expect(await podwatch.tick()).toBe(1)
    expect(podwatch.list()[0]).toMatchObject({ state: 'waiting', attempts: 1 }); expect(podwatch.list()[0].last_error).toMatch(/not enough free GPUs/)
    advance(30); await podwatch.tick(); expect(s.resumes).toHaveLength(1)   // still waiting for its time
    advance(30); await podwatch.tick(); expect(s.resumes).toHaveLength(2)
    advance(60); await podwatch.tick()
    expect(s.resumes).toHaveLength(3); expect(s.resumes[2]).toEqual({ id: 'pod9', note: 'pod resumed after waiting 3 min' })
    expect(podwatch.list()[0]).toMatchObject({ state: 'done', attempts: 3 }); expect(podwatch.list()[0].detail).toMatch(/Resumed after waiting 3 min/)
    advance(600); await podwatch.tick(); expect(s.resumes).toHaveLength(3)   // done is done
    expect(history.list({ kind: 'change' }).some((e) => e.kind === 'change' && e.area === 'pod' && /done/.test(e.action))).toBe(true)
  })
  it('any answer but "no free GPU" stops it with the reason (a pod that is gone, a rejected key)', async () => {
    const s = fake({ resume: () => { throw new CoreError(404, 'Pod pod9 not found') } })
    podwatch.watchResume('pod9', 'p', 'x', { every_s: 60 })
    advance(60); await podwatch.tick()
    expect(podwatch.list()[0]).toMatchObject({ state: 'stopped' }); expect(podwatch.list()[0].detail).toMatch(/Stopped: Pod pod9 not found/)
    advance(600); await podwatch.tick(); expect(s.resumes).toHaveLength(1)
  })
  it('a dropped connection is not an answer: it waits and tries again', async () => {
    const s = fake({ resume: (n) => { if (n === 1) throw new TypeError('fetch failed') } })
    podwatch.watchResume('pod9', 'p', 'x', { every_s: 60 })
    advance(60); await podwatch.tick(); expect(podwatch.list()[0].state).toBe('waiting')
    advance(60); await podwatch.tick(); expect(podwatch.list()[0].state).toBe('done'); expect(s.resumes).toHaveLength(2)
  })
  it('RunPod\'s request limit is waited out, not hammered: no call until it lifts', async () => {
    const s = fake()
    podwatch.watchResume('pod9', 'p', 'x', { every_s: 60 })
    ratelimit.noteLimited('rate limit exceeded for the hour window', 300)
    advance(60); await podwatch.tick()
    expect(s.resumes).toHaveLength(0); expect(podwatch.list()[0].last_error).toMatch(/limiting requests/)
    const retry = Date.parse(podwatch.list()[0].next_at); expect(retry).toBeGreaterThan(t)   // pushed to the limiter's own time
    t = retry + 1000; ratelimit.reset(); await podwatch.tick()
    expect(s.resumes).toHaveLength(1); expect(podwatch.list()[0].state).toBe('done')
  })
  it('gives up after give_up_h and says so', async () => {
    const s = fake({ resume: () => { throw hostFull() } })
    podwatch.watchResume('pod9', 'p', 'x', { every_s: 60, give_up_h: 1 })
    for (let i = 0; i < 70; i++) { advance(60); await podwatch.tick() }
    expect(podwatch.list()[0]).toMatchObject({ state: 'expired' }); expect(podwatch.list()[0].detail).toMatch(/Gave up after 1/)
    const calls = s.resumes.length; advance(3600); await podwatch.tick(); expect(s.resumes).toHaveLength(calls)
    expect(history.list({ kind: 'change' }).some((e) => e.kind === 'change' && /gave up/.test(e.action))).toBe(true)
  })
  it('cancel stops it, by watch id or by pod id; a second watch for the same pod is refused', async () => {
    const s = fake({ resume: () => { throw hostFull() } })
    const w = podwatch.watchResume('pod9', 'p', 'x', { every_s: 60 })
    expect(() => podwatch.watchResume('pod9', 'p', 'x')).toThrow(/already waiting/)
    expect(podwatch.cancel('pod9').state).toBe('cancelled')
    advance(600); await podwatch.tick(); expect(s.resumes).toHaveLength(0)
    expect(() => podwatch.cancel('nope')).toThrow(/No such watch/); expect(podwatch.list()[0].id).toBe(w.id)
  })
  it('the interval and the limit are checked: not more often than every 60 s, at most 72 h', () => {
    expect(() => podwatch.watchResume('p', 'p', 'x', { every_s: 30 })).toThrow(/no more often than every 60/)
    expect(() => podwatch.watchResume('p', 'p', 'x', { give_up_h: 100 })).toThrow(/at most 72/)
    expect(() => podwatch.watchResume('p', 'p', 'x', { give_up_h: 0 })).toThrow(/at most 72/)
    expect(podwatch.watchResume('p', 'p', 'x').every_s).toBe(120)   // the default
  })
  it('survives a restart: the watch is in the file and a fresh process carries it on', async () => {
    fake({ resume: () => { throw hostFull() } })
    podwatch.watchResume('pod9', 'p', 'x', { every_s: 60 })
    const file = JSON.parse(readFileSync(join(dir, 'pod-watches.json'), 'utf8'))
    expect(file.watches).toHaveLength(1)
    // "restart": the module's memory is gone (new deps, nothing carried but the file)
    const s2 = fake()
    advance(60); await podwatch.tick()
    expect(s2.resumes).toEqual([{ id: 'pod9', note: 'pod resumed after waiting 1 min' }]); expect(podwatch.list()[0].state).toBe('done')
  })
  it('another process\'s fresh claim is left alone; a stale one is taken over', async () => {
    const s = fake()
    const w = podwatch.watchResume('pod9', 'p', 'x', { every_s: 60 })
    const file = join(dir, 'pod-watches.json'), raw = JSON.parse(readFileSync(file, 'utf8'))
    raw.watches[0].claim = { pid: process.pid + 1, at: new Date(T0 + 59_000).toISOString() }; writeFileSync(file, JSON.stringify(raw))
    advance(60); await podwatch.tick(); expect(s.resumes).toHaveLength(0)
    advance(400); await podwatch.tick(); expect(s.resumes).toHaveLength(1); expect(w.id).toBeTruthy()
  })
})

describe('create watch', () => {
  const REQ = { name: 'CanalV2-lores-v003-a-v27', gpu: 'a100', data_center_id: 'EU-RO-1' }
  it('sends the same request again until a card is free, then makes exactly one pod', async () => {
    const s = fake({ create: (n) => { if (n < 3) throw noCard() } })
    const w = podwatch.watchCreate(REQ, 'Waiting for a free A100 SXM in EU-RO-1', { every_s: 60 })
    expect(w).toMatchObject({ kind: 'create', name: REQ.name })
    for (let i = 0; i < 6; i++) { advance(60); await podwatch.tick() }
    expect(s.creates).toHaveLength(3); expect(s.creates.every((c) => JSON.stringify(c.req) === JSON.stringify(REQ))).toBe(true)
    expect(s.pods).toHaveLength(1)   // one pod, however long it waited
    expect(podwatch.list()[0]).toMatchObject({ state: 'done', pod_id: 'pod1', attempts: 3 }); expect(podwatch.list()[0].creating).toBeUndefined()
    expect(s.creates[2].note).toBe('pod created after waiting 3 min')
  })
  it('a definite "no card" clears the in-flight marker; the marker is on disk BEFORE the ask', async () => {
    const file = join(dir, 'pod-watches.json')
    let seen: unknown = null
    const s = fake({ create: () => { seen = JSON.parse(readFileSync(file, 'utf8')).watches[0].creating; throw noCard() } })
    podwatch.watchCreate(REQ, 'x', { every_s: 60 })
    advance(60); await podwatch.tick()
    expect(seen).toBeTruthy()   // written before RunPod was asked
    expect(podwatch.list()[0].creating).toBeUndefined(); expect(podwatch.list()[0].last_error).toMatch(/No card available/); expect(s.pods).toHaveLength(0)
  })
  it('a lost answer never makes a second pod: the next tick finds the pod by name and adopts it', async () => {
    const s = fake({ create: (n) => (n === 1 ? { lost: true } : undefined) })
    podwatch.watchCreate(REQ, 'x', { every_s: 60 })
    advance(60); await podwatch.tick()   // the pod was made, the answer was lost
    expect(s.pods).toHaveLength(1); expect(podwatch.list()[0]).toMatchObject({ state: 'waiting' }); expect(podwatch.list()[0].creating).toBeTruthy()
    advance(60); await podwatch.tick()
    expect(s.creates).toHaveLength(1)   // not asked again
    expect(podwatch.list()[0]).toMatchObject({ state: 'done', pod_id: 'pod1' }); expect(podwatch.list()[0].detail).toMatch(/found by name/)
  })
  it('a restart in the middle of a create (marker set, pod exists) adopts the pod instead of creating another', async () => {
    const s = fake()
    podwatch.watchCreate(REQ, 'x', { every_s: 60 })
    const file = join(dir, 'pod-watches.json'), raw = JSON.parse(readFileSync(file, 'utf8'))
    raw.watches[0].creating = new Date(T0).toISOString(); writeFileSync(file, JSON.stringify(raw))   // "the process died after asking"
    s.pods.push({ id: 'podX', name: REQ.name })
    advance(60); await podwatch.tick()
    expect(s.creates).toHaveLength(0); expect(podwatch.list()[0]).toMatchObject({ state: 'done', pod_id: 'podX' })
  })
  it('with the marker set and the pod not found, it asks again (and still only once at a time)', async () => {
    const s = fake()
    podwatch.watchCreate(REQ, 'x', { every_s: 60 })
    const file = join(dir, 'pod-watches.json'), raw = JSON.parse(readFileSync(file, 'utf8'))
    raw.watches[0].creating = new Date(T0).toISOString(); writeFileSync(file, JSON.stringify(raw))
    advance(60); await podwatch.tick()
    expect(s.creates).toHaveLength(1); expect(s.pods).toHaveLength(1); expect(podwatch.list()[0].state).toBe('done')
  })
  it('an error that is not "no card" (a bad request, no money) stops it with the reason', async () => {
    const s = fake({ create: () => { throw new CoreError(400, 'Your account balance is too low to rent a pod.') } })
    podwatch.watchCreate(REQ, 'x', { every_s: 60 })
    advance(60); await podwatch.tick()
    expect(podwatch.list()[0]).toMatchObject({ state: 'stopped' }); expect(podwatch.list()[0].detail).toMatch(/balance is too low/)
    advance(600); await podwatch.tick(); expect(s.creates).toHaveLength(1)
  })
  it('gives up after give_up_h; cancel while waiting; one watch per name', async () => {
    const s = fake({ create: () => { throw noCard() } })
    podwatch.watchCreate(REQ, 'x', { every_s: 60, give_up_h: 1 })
    expect(() => podwatch.watchCreate(REQ, 'x')).toThrow(/already waiting to be created/)
    for (let i = 0; i < 70; i++) { advance(60); await podwatch.tick() }
    expect(podwatch.list()[0].state).toBe('expired'); expect(s.pods).toHaveLength(0)
    const w2 = podwatch.watchCreate({ ...REQ, name: 'other' }, 'x', { every_s: 60 })
    expect(podwatch.cancel(w2.id).state).toBe('cancelled'); expect(podwatch.waiting()).toHaveLength(0)
  })
  it('cancelling while a create is in flight says to check the pod list', async () => {
    fake()
    const w = podwatch.watchCreate(REQ, 'x', { every_s: 60 })
    const file = join(dir, 'pod-watches.json'), raw = JSON.parse(readFileSync(file, 'utf8'))
    raw.watches[0].creating = new Date(T0).toISOString(); writeFileSync(file, JSON.stringify(raw))
    expect(podwatch.cancel(w.id).detail).toMatch(/check the pod list/)
  })
})

describe('what pods.ts tells the watch', () => {
  const ok = { status: 200, json: async () => ({ data: {} }) }
  it('a resume with no free GPU carries the code host_full; a missing pod does not', async () => {
    const f = (message: string) => ({ fetchFn: (async () => ({ status: 200, json: async () => ({ errors: [{ message }] }) })) as unknown as typeof fetch, apiKey: 't' })
    await expect(pods.resume('p1', f('There are not enough free GPUs on the host machine to start this pod.'))).rejects.toMatchObject({ code: 'host_full', status: 409 })
    await expect(pods.resume('p1', f('pod not found'))).rejects.not.toMatchObject({ code: 'host_full' })
    void ok
  })
  it('a create with no card in stock carries the code no_card', async () => {
    const fetchFn = (async (_u: string, init?: { body?: string }) => {
      const q = JSON.parse(init!.body!).query as string
      return { status: 200, json: async () => (q.includes('gpuTypes') ? { data: { gpuTypes: [] } } : { errors: [{ message: 'There are no longer any instances available with the requested specifications.' }] }) }
    }) as unknown as typeof fetch
    await expect(pods.create({ name: 't', gpu: 'auto' }, { fetchFn })).rejects.toMatchObject({ code: 'no_card', status: 502 })
  })
  it('createWhenFree and resumeWhenFree register watches; the label names the card and the place', async () => {
    const w = pods.createWhenFree({ name: 'n1', gpu: 'a100', data_center_id: 'EU-RO-1' })
    expect(w.label).toBe('Waiting for a free A100 SXM in EU-RO-1'); expect(pods.watches()).toHaveLength(1)
    expect(() => pods.createWhenFree({ name: '' })).toThrow(/needs a name/)
    expect(pods.cancelWatch(w.id).state).toBe('cancelled')
    expect(existsSync(join(dir, 'pod-watches.json'))).toBe(true)
  })
})
