import { beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as comfyruns from '../src/comfyruns.js'
import { CoreError } from '../src/errors.js'
import { scratch } from './helpers.js'

const T0 = Date.UTC(2026, 10, 4, 10, 0, 0)
const HISTORY = {
  'p-old': { outputs: { '9': { images: [{ filename: 'a_00001.png', type: 'output', subfolder: 'x' }], gifs: [{ filename: 'a.gif', type: 'output', subfolder: '' }] } }, status: { status_str: 'success', completed: true, messages: [['execution_start', { timestamp: T0 }], ['execution_success', { timestamp: T0 + 12_500 }]] } },
  'p-bad': { outputs: {}, status: { status_str: 'error', completed: false, messages: [['execution_start', { timestamp: T0 + 60_000 }], ['execution_error', { timestamp: T0 + 61_000, exception_message: 'CUDA out of memory' }]] } },
}
const QUEUE = { queue_running: [[1, 'p-run', {}]], queue_pending: [[2, 'p-wait', {}]] }

function fakeFetch(): typeof fetch {
  return (async (url: string) => {
    const body = String(url).includes('/history') ? HISTORY : String(url).includes('/queue') ? QUEUE : null
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('', { status: 404 })
  }) as unknown as typeof fetch
}
const client = (status: string, ports = '8188/http') => ({ fetchFn: (async (url: string) => new Response(JSON.stringify({ data: { pod: { id: 'abc', name: 'P', desiredStatus: status, ports: [ports], runtime: status === 'RUNNING' ? { uptimeInSeconds: 5, ports: [{ ip: '1.2.3.4', isIpPublic: true, privatePort: 8188, publicPort: 8188, type: 'http' }] } : null, machine: { gpuDisplayName: 'A40' }, costPerHr: 1 } } }), { status: 200 })) as unknown as typeof fetch, apiKey: 'k' } as never)

let dir: string
beforeEach(() => { dir = scratch(); process.env.POD_NAMES_FILE = join(dir, 'names.json'); delete process.env.RUNPOD_DRY_RUN; process.env.RUNPOD_API_KEY = 'k' })

describe('comfyruns', () => {
  it('needs a running pod', async () => {
    await expect(comfyruns.runs('abc', client('EXITED'), fakeFetch())).rejects.toMatchObject({ status: 409, message: 'Pod abc is not running: start it to read its ComfyUI history' })
    await expect(comfyruns.runs('abc', client('EXITED'), fakeFetch())).rejects.toBeInstanceOf(CoreError)
  })
  it('lists queued and running first, then finished runs newest first, with outputs, duration and error', async () => {
    const r = await comfyruns.runs('abc', client('RUNNING'), fakeFetch())
    expect(r.map((x) => [x.prompt_id, x.status])).toEqual([['p-wait', 'pending'], ['p-run', 'running'], ['p-bad', 'error'], ['p-old', 'success']])
    const ok = r.find((x) => x.prompt_id === 'p-old')!
    expect(ok.started_at).toBe('2026-11-04T10:00:00.000Z'); expect(ok.duration_s).toBe(12.5)
    expect(ok.outputs).toEqual([{ filename: 'a_00001.png', type: 'output', subfolder: 'x' }, { filename: 'a.gif', type: 'output', subfolder: '' }])
    const bad = r.find((x) => x.prompt_id === 'p-bad')!
    expect(bad.error).toBe('CUDA out of memory'); expect(bad.duration_s).toBe(1)
    // the pod costs $1/h: a 12.5 s run is $0.0035, a 1 s run $0.0003; a run with no duration has no estimate
    expect(ok.cost_estimate).toBe(0.0035); expect(bad.cost_estimate).toBe(0.0003)
    expect(r.find((x) => x.prompt_id === 'p-run')!.cost_estimate).toBeNull()
  })
})

const TB_LIST = ['  File "/comfy/execution.py", line 327, in execute\n', '    output_data = func(**inputs)\n', 'torch.OutOfMemoryError: CUDA out of memory.\n']
const BAD_HISTORY = { 'p-x': { outputs: {}, status: { status_str: 'error', completed: false, messages: [['execution_start', { prompt_id: 'p-x', timestamp: T0 }], ['execution_cached', { nodes: [], timestamp: T0 + 1 }], ['execution_error', { prompt_id: 'p-x', node_id: '12', node_type: 'KSampler', executed: [], exception_message: 'CUDA out of memory.\n', exception_type: 'torch.OutOfMemoryError', traceback: TB_LIST, current_inputs: { huge: 'x'.repeat(5000) }, timestamp: T0 + 2000 }]] } } }
const hist = (h: unknown): typeof fetch => (async (url: string) => (String(url).includes('/history') ? new Response(JSON.stringify(h), { status: 200 }) : new Response('', { status: 404 }))) as unknown as typeof fetch

describe('comfyruns messages and error_detail', () => {
  it('gives the timeline and the failure detail', async () => {
    const [r] = await comfyruns.runs('abc', client('RUNNING'), hist(BAD_HISTORY))
    expect(r.messages.map((m) => m.type)).toEqual(['execution_start', 'execution_cached', 'execution_error'])
    expect(r.messages[0].ts).toBe('2026-11-04T10:00:00.000Z')
    expect(r.messages[2].data.timestamp).toBeUndefined(); expect(r.messages[2].data.current_inputs).toBeUndefined(); expect(r.messages[2].data.node_type).toBe('KSampler')
    expect(r.error_detail).toEqual({ message: 'CUDA out of memory.', node_id: '12', node_type: 'KSampler', exception_type: 'torch.OutOfMemoryError', traceback: TB_LIST })
    expect(r.error).toBe('CUDA out of memory.')
  })
  it('success runs have no error_detail; queued ones an empty timeline', async () => {
    const r = await comfyruns.runs('abc', client('RUNNING'), fakeFetch())
    expect(r.find((x) => x.prompt_id === 'p-old')!.error_detail).toBeUndefined()
    expect(r.find((x) => x.prompt_id === 'p-wait')!.messages).toEqual([])
  })
})

const RAW = { entries: [
  { t: '2026-11-04T15:00:00.000001', m: '\u001b[32m[INFO]\u001b[0m starting\n' },
  { t: '2026-11-04T15:00:01.000001', m: 'UserWarning: something deprecated\n' },
  { t: '2026-11-04T15:00:02.000001', m: 'Traceback (most recent call last):\n  File "a.py", line 1, in x\n    boom()\nValueError: bad\n' },
  { t: '2026-11-04T15:00:03.000001', m: 'Import times for custom nodes ok\n' },
], size: { cols: 80, rows: 10 } }
const logFetch = (raw: number, text: number): typeof fetch => (async (url: string) => String(url).endsWith('/internal/logs/raw') ? (raw === 200 ? new Response(JSON.stringify(RAW)) : new Response('', { status: raw })) : text === 200 ? new Response('plain ok\nFailed to import X\nWARNING: low vram\n') : new Response('', { status: text })) as unknown as typeof fetch

describe('comfyruns.logs', () => {
  it('needs a running pod', async () => {
    await expect(comfyruns.logs('abc', {}, client('EXITED'), logFetch(200, 200))).rejects.toMatchObject({ status: 409, message: 'Pod abc is not running: start it to read its ComfyUI history' })
  })
  it('reads the raw entries, splits lines, strips colour and classifies', async () => {
    const r = await comfyruns.logs('abc', {}, client('RUNNING'), logFetch(200, 404))
    expect(r.truncated).toBe(false)
    expect(r.entries.map((e) => e.level)).toEqual(['info', 'warning', 'error', 'error', 'error', 'error', 'info'])
    expect(r.entries[0]).toEqual({ ts: '2026-11-04T15:00:00.000001', level: 'info', text: '[INFO] starting' })
    expect(r.entries.at(-1)!.text).toBe('Import times for custom nodes ok')
  })
  it('filters by level', async () => {
    const w = await comfyruns.logs('abc', { level: 'warnings' }, client('RUNNING'), logFetch(200, 404))
    expect(w.entries.map((e) => e.level)).toEqual(['warning', 'error', 'error', 'error', 'error'])
    const e = await comfyruns.logs('abc', { level: 'errors' }, client('RUNNING'), logFetch(200, 404))
    expect(e.entries.every((x) => x.level === 'error')).toBe(true); expect(e.entries).toHaveLength(4)
  })
  it('keeps the newest lines and says it cut older ones', async () => {
    const r = await comfyruns.logs('abc', { lines: 2 }, client('RUNNING'), logFetch(200, 404))
    expect(r.truncated).toBe(true); expect(r.entries).toHaveLength(2); expect(r.entries.at(-1)!.text).toBe('Import times for custom nodes ok')
  })
  it('falls back to the plain text log', async () => {
    const r = await comfyruns.logs('abc', {}, client('RUNNING'), logFetch(404, 200))
    expect(r.entries.map((e) => [e.ts, e.level, e.text])).toEqual([[null, 'info', 'plain ok'], [null, 'error', 'Failed to import X'], [null, 'warning', 'WARNING: low vram']])
  })
  it('says clearly when the ComfyUI has no log endpoint', async () => {
    await expect(comfyruns.logs('abc', {}, client('RUNNING'), logFetch(404, 404))).rejects.toMatchObject({ status: 501, message: expect.stringContaining('no log endpoint') })
  })
  it('refuses an unknown level', async () => {
    await expect(comfyruns.logs('abc', { level: 'loud' as never }, client('RUNNING'), logFetch(200, 200))).rejects.toMatchObject({ status: 400 })
  })
})
