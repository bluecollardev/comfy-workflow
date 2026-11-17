import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import * as outputruns from '../src/outputruns.js'
import * as comfyruns from '../src/comfyruns.js'
import { outputRunsFile } from '../src/paths.js'
import { scratch } from './helpers.js'

const ctx = { pod_id: 'pod1', pod_name: 'ComfyUI-Dev', volume_id: 'vol1', datacenter: 'EU-RO-1' }
const run = (id: string, t = 0, extra: object = {}) => ({ prompt_id: id, status: 'success', workflow: 'rounds/r1/a.json', started_at: new Date(Date.UTC(2026, 10, 17, 10, 0, t)).toISOString(), duration_s: 5, outputs: [{ filename: `${id}.png`, subfolder: 'shots', type: 'output' }], ...extra })

beforeEach(() => { scratch(); delete process.env.OUTPUT_RUNS_FILE; outputruns.setStopReader(async () => null) })

describe('outputruns recorder', () => {
  it('records a successful run with its pod, volume, workflow and files, and dedupes by prompt_id', () => {
    expect(outputruns.record(ctx, [run('a', 1), run('b', 2)])).toBe(2)
    outputruns.record({ ...ctx, pod_name: 'Renamed' }, [run('a', 1)])
    const s = outputruns.saved()
    expect(s.map((r) => r.prompt_id)).toEqual(['b', 'a'])   // newest first
    expect(s[1]).toMatchObject({ pod_id: 'pod1', pod_name: 'Renamed', volume_id: 'vol1', datacenter: 'EU-RO-1', workflow: 'rounds/r1/a.json', duration_s: 5, files: [{ filename: 'a.png', subfolder: 'shots', type: 'output' }] })
    expect(typeof s[1].recorded_at).toBe('string')
  })
  it('keeps only type output files and only successful runs with at least one file', () => {
    outputruns.record(ctx, [
      run('mixed', 1, { outputs: [{ filename: 'keep.png', type: 'output', subfolder: '' }, { filename: 'tmp.png', type: 'temp', subfolder: '' }, { filename: 'in.png', type: 'input', subfolder: '' }] }),
      run('failed', 2, { status: 'error' }), run('running', 3, { status: 'running' }), run('empty', 4, { outputs: [] }), run('temponly', 5, { outputs: [{ filename: 't.png', type: 'temp', subfolder: '' }] }),
    ])
    const s = outputruns.saved()
    expect(s.map((r) => r.prompt_id)).toEqual(['mixed'])
    expect(s[0].files).toEqual([{ filename: 'keep.png', subfolder: '', type: 'output' }])
  })
  it('keeps the newest 500 runs and at most 500 files a run', () => {
    outputruns.record(ctx, Array.from({ length: 510 }, (_, i) => run(`r${i}`, 0, { started_at: new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString() })))
    const s = outputruns.saved()
    expect(s).toHaveLength(500); expect(s[0].prompt_id).toBe('r509'); expect(s.some((r) => r.prompt_id === 'r9')).toBe(false); expect(s.some((r) => r.prompt_id === 'r10')).toBe(true)
    outputruns.record(ctx, [run('big', 0, { started_at: '2027-01-01T00:00:00Z', outputs: Array.from({ length: 700 }, (_, i) => ({ filename: `f${i}.dpx`, type: 'output', subfolder: 's' })) })])
    expect(outputruns.saved()[0].files).toHaveLength(500)
  })
  it('writes atomically (no temp file left) and survives a corrupt file by starting empty', () => {
    outputruns.record(ctx, [run('a', 1)])
    const f = outputRunsFile()
    expect(existsSync(f)).toBe(true)
    expect(readdirSync(dirname(f)).filter((n) => n.endsWith('.tmp'))).toEqual([])
    expect(JSON.parse(readFileSync(f, 'utf8')).runs).toHaveLength(1)
    writeFileSync(f, '{ this is not json')
    expect(outputruns.saved()).toEqual([])
    expect(outputruns.record(ctx, [run('b', 2)])).toBe(1)
    expect(outputruns.saved().map((r) => r.prompt_id)).toEqual(['b'])
  })
  it('never throws, and writes no secrets', () => {
    process.env.OUTPUT_RUNS_FILE = '/proc/definitely/not/writable/x.json'
    expect(() => outputruns.record(ctx, [run('a')])).not.toThrow()
    expect(() => outputruns.record(ctx, null as never)).not.toThrow()
    delete process.env.OUTPUT_RUNS_FILE
    outputruns.record(ctx, [run('a')])
    expect(readFileSync(outputRunsFile(), 'utf8')).not.toMatch(/api[_-]?key|token|secret/i)
  })
  it('reads by pod or by volume: a pod on the same volume sees the volume\'s runs', () => {
    outputruns.record(ctx, [run('a', 1)])
    outputruns.record({ pod_id: 'pod2', volume_id: 'vol2' }, [run('b', 2)])
    outputruns.record({ pod_id: 'pod3' }, [run('c', 3)])
    expect(outputruns.saved({ pod_id: 'pod1' }).map((r) => r.prompt_id)).toEqual(['a'])
    expect(outputruns.saved({ pod_id: 'podX', volume_id: 'vol1' }).map((r) => r.prompt_id)).toEqual(['a'])
    expect(outputruns.saved({ pod_id: 'pod3', volume_id: 'vol2' }).map((r) => r.prompt_id)).toEqual(['c', 'b'])
    expect(outputruns.saved()).toHaveLength(3)
  })
})

describe('outputruns hooks', () => {
  const historyFetch = (h: object, ok = true) => (async () => (ok ? new Response(JSON.stringify(h), { status: 200 }) : new Response('', { status: 500 }))) as unknown as typeof fetch
  it('records a graph writer\'s sequence with its folder (finishedRuns reads the history)', async () => {
    const api = { '7': { class_type: 'OCIOWrite', inputs: { output_folder: 'deliveries/a', filename: 'plate', write_sidecar: true } } }
    const h = { w1: { prompt: [1, 'w1', api, {}], outputs: { '7': { saved: ['plate.0001.dpx'], count: [3] } }, status: { status_str: 'success', completed: true, messages: [['execution_start', { timestamp: 1 }], ['execution_success', { timestamp: 2001 }]] } } }
    const runs = await comfyruns.finishedRuns('http://pod', historyFetch(h))
    outputruns.record(ctx, runs)
    expect(outputruns.saved()[0].files).toEqual([{ filename: 'plate.0001.dpx', subfolder: 'deliveries/a', type: 'output' }, { filename: 'plate.0002.dpx', subfolder: 'deliveries/a', type: 'output' }, { filename: 'plate.0003.dpx', subfolder: 'deliveries/a', type: 'output' }, { filename: 'plate.json', subfolder: 'deliveries/a', type: 'output' }])
  })
  it('before a stop: records what the pod\'s history shows', async () => {
    outputruns.setStopReader(async (id) => ({ ctx: { pod_id: id, pod_name: 'P', volume_id: 'v' }, runs: [run('s1', 1)] }))
    await outputruns.beforeStop('pod9')
    expect(outputruns.saved({ pod_id: 'pod9' }).map((r) => r.prompt_id)).toEqual(['s1'])
  })
  it('before a stop: a failing or hanging read is skipped and the caller carries on', async () => {
    outputruns.setStopReader(async () => { throw new Error('unreachable') })
    await expect(outputruns.beforeStop('pod9')).resolves.toBeUndefined()
    expect(outputruns.saved()).toEqual([])
  })
  it('pods.stop and the idle watch stop record first, then stop even when the read fails', async () => {
    const pods = await import('../src/pods.js')
    process.env.RUNPOD_API_KEY = 'k'; delete process.env.RUNPOD_DRY_RUN
    const order: string[] = []
    outputruns.setStopReader(async () => { order.push('read'); throw new Error('boom') })
    const client = { fetchFn: (async (_u: string, init?: { body?: string }) => { const q = String(init?.body || ''); if (q.includes('podStop')) order.push('stop'); return new Response(JSON.stringify({ data: { podStop: { id: 'p1' }, pod: { id: 'p1', name: 'P', desiredStatus: 'EXITED' } } }), { status: 200 }) }) as unknown as typeof fetch }
    await pods.stop('p1', client)
    await pods.stopper(client)('p2')
    expect(order).toEqual(['read', 'stop', 'read', 'stop'])
  })
})
