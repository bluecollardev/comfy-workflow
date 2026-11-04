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
  })
})
