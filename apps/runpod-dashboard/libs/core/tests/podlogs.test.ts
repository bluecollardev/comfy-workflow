import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as podlogs from '../src/podlogs.js'
import { scratch } from './helpers.js'

describe('podlogs: kept, never deleted', () => {
  beforeEach(() => { process.env.POD_LOGS_DIR = scratch('podlogs'); podlogs.setDeps({ now: () => new Date('2026-11-20T15:48:12Z'), name: (id) => (id === 'abc123' ? 'queue-brynley comfy/2026' : id), container: async () => [{ ts: '2026-11-20T15:48:00Z', source: 'container', line: 'ComfyUI listening' }, { ts: '2026-11-20T15:48:05Z', source: 'system', line: 'start container' }], comfy: async () => ['2026-11-20T15:48:01Z [info] got prompt', '[error] CUDA out of memory'] }) })
  afterEach(() => { podlogs.setDeps(null); delete process.env.POD_LOGS_DIR })
  it('save writes the container, system and ComfyUI logs with the pod, the time and the reason, under a safe name', async () => {
    const r = await podlogs.save('abc123', { reason: 'end of run task t-1 (archival-168): done' })
    expect(r).toMatchObject({ name: 'queue-brynley_comfy_2026_abc123_154812.log', lines: 4 }); expect(r.path).toContain('2026-11-20')
    const text = readFileSync(r.path, 'utf8')
    expect(text).toContain('pod abc123 (queue-brynley comfy/2026)'); expect(text).toContain('why end of run task t-1 (archival-168): done'); expect(text).toContain('container ComfyUI listening'); expect(text).toContain('[error] CUDA out of memory'); expect(text).toMatch(/RunPod container and system log \(2 lines\)/)
  })
  it('a second save in the same second never goes over the first', async () => {
    const a = await podlogs.save('abc123'), b = await podlogs.save('abc123')
    expect(b.path).not.toBe(a.path); expect(readFileSync(a.path, 'utf8')).toContain('why asked for')
    expect((await podlogs.list({ pod_id: 'abc123' })).logs).toHaveLength(2)
  })
  it('list covers every saved log, newest first by file time, and can be narrowed to a pod; read gives the text or its tail; a bad name is refused', async () => {
    await podlogs.save('abc123'); podlogs.setDeps({ now: () => new Date('2026-11-20T16:00:00Z') }); await podlogs.save('zzz9')
    const all = await podlogs.list(); expect(all.logs).toHaveLength(2); expect(all.logs.map((l) => l.name).sort()[1]).toMatch(/zzz9_zzz9_160000\.log$/)
    expect((await podlogs.list({ pod_id: 'abc123' })).logs).toHaveLength(1)
    const r = await podlogs.read(all.logs[0].name, { tail: 2 }); expect(r.text.split('\n').length).toBeLessThanOrEqual(2)
    await expect(podlogs.read('../../etc/passwd')).rejects.toMatchObject({ status: 400 }); await expect(podlogs.read('2026-11-20/nope.log')).rejects.toMatchObject({ status: 404 })
    await expect(podlogs.save('a;b')).rejects.toMatchObject({ status: 400 })
  })
  it('purge deletes only when a person confirmed: one pod\'s logs or all of them; an empty day folder goes with them', async () => {
    await podlogs.save('abc123'); await podlogs.save('abc123'); podlogs.setDeps({ now: () => new Date('2026-11-21T09:00:00Z') }); await podlogs.save('zzz9')
    await expect(podlogs.purge({ pod_id: 'abc123' })).rejects.toMatchObject({ status: 400 }); expect((await podlogs.list()).logs).toHaveLength(3)
    await expect(podlogs.purge({ pod_id: '../x', confirmed: true })).rejects.toMatchObject({ status: 400 })
    expect(await podlogs.purge({ pod_id: 'abc123', confirmed: true })).toMatchObject({ deleted: 2 }); const left = (await podlogs.list()).logs; expect(left).toHaveLength(1); expect(left[0].name).toContain('zzz9')
    expect(await podlogs.purge({ confirmed: true })).toMatchObject({ deleted: 1 }); expect((await podlogs.list()).logs).toHaveLength(0)
  })
})
