import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as failures from '../src/failures.js'
import * as history from '../src/history.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); failures.setClock(() => Date.parse('2026-11-19T12:00:00Z')) })
describe('the failures log', () => {
  it('a record has every field, is one JSON line, is secret and URL free, capped at 500 chars, and is listed newest first with filters; missing models and recovery are derived', async () => {
    const r = failures.record({ stage: 'validate', message: `Prompt outputs failed validation: node 12 (CheckpointLoaderSimple): Value not in list: ckpt_name: 'flux1-dev.safetensors' not in [] see https://x.example/a?X-Amz-Signature=abc ${'y'.repeat(600)}`, job_id: 'run-1', shot: 'enhance-146', graph: 'workflows/a.json', pod_id: 'p1', pod_name: 'CanalV2', node_id: '12', node_type: 'CheckpointLoaderSimple', log_tail: Array.from({ length: 30 }, (_, i) => `line ${i} token=supersecretvalue123`) })
    expect(Object.keys(r).sort()).toEqual(['at', 'attempt', 'gpu', 'graph', 'graph_version', 'id', 'job_id', 'log_tail', 'message', 'missing_models', 'node', 'node_id', 'node_type', 'pod_id', 'pod_name', 'recovery', 'retries', 'retryable', 'round', 'shot', 'stage', 'time'])
    expect(r.message.length).toBeLessThanOrEqual(500); expect(r.message).not.toMatch(/https?:|Signature/); expect(r.log_tail).toHaveLength(20); expect(r.log_tail.join(' ')).not.toContain('supersecretvalue123'); expect(r.missing_models).toEqual([{ name: 'flux1-dev.safetensors', where_on_volume: 'comfy-shared/models/checkpoints/flux1-dev.safetensors' }]); expect(r.retryable).toBe(false); expect(r.recovery).toMatch(/Missing model.*flux1-dev.*Not retried/)
    failures.record({ stage: 'execute', message: 'fetch failed ECONNRESET', job_id: 'run-2', shot: 'other-1' }); await failures.settled()
    const lines = readFileSync(join(dir, 'failures.jsonl'), 'utf8').trim().split('\n'); expect(lines).toHaveLength(2); expect(() => lines.forEach((l) => JSON.parse(l))).not.toThrow()
    expect((await failures.list({})).failures.map((f) => f.job_id)).toEqual(['run-2', 'run-1']); expect((await failures.list({ shot: 'enhance-146' })).failures).toHaveLength(1); expect((await failures.list({ job_id: 'run-2' })).failures[0].retryable).toBe(true); expect((await failures.list({ since: '2026-11-20' })).failures).toEqual([]); expect((await failures.list({ limit: 1 })).failures).toHaveLength(1)
    expect(history.list({ limit: 10 }).some((e) => e.kind === 'job' && /graph failed: workflows\/a\.json/.test(e.what))).toBe(true); expect(failures.describe(r)).toMatch(/stage: validate\nnode: 12 \(CheckpointLoaderSimple\)\nmessage: .*\nmissing model: flux1-dev\.safetensors \(belongs in comfy-shared\/models\/checkpoints\/flux1-dev\.safetensors\)\nretryable: no\nrecovery: /); expect(failures.describe({})).toMatch(/node: not obtained.*\nmessage: not obtained.*recovery: not obtained.*log tail: not obtained/s)
  })
  it('classify: a validation or load error is never retried; a transient cause is', () => {
    expect(failures.classify('validate', 'Prompt outputs failed validation').retryable).toBe(false); expect(failures.classify('load', 'The graph has no nodes list').retryable).toBe(false); expect(failures.classify('queue', 'ComfyUI answered HTTP 503').retryable).toBe(true); expect(failures.classify('execute', 'CUDA out of memory').retryable).toBe(false)
  })
})

describe('Retry (failures.retry)', () => {
  it('a record has id, at, node and retries; a graph or validation error is never retried; an unknown id is 404; an attempt past 3 is refused', async () => {
    const v = failures.record({ stage: 'validate', message: 'Prompt outputs failed validation', graph: 'a.json', pod_id: 'p1', node_id: '7', node_type: 'KSampler' }); expect(v).toMatchObject({ at: v.time, node: '7 (KSampler)', retries: 0 }); expect(v.id).toMatch(/^f-/)
    await failures.settled(); await expect(failures.retry(v.id)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/not retried: .*Not retried/) }); await expect(failures.retry('nope')).rejects.toMatchObject({ status: 404 })
    const t = failures.record({ stage: 'queue', message: 'ComfyUI answered HTTP 503', graph: 'a.json', pod_id: 'p1', attempt: 3 }); expect(t).toMatchObject({ retryable: true, retries: 2 }); await failures.settled(); await expect(failures.retry(t.id)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/tried 3 times/) })
  })
})
