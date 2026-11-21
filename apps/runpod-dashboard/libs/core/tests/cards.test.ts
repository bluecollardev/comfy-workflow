import { describe, expect, it } from 'vitest'
import * as cards from '../src/cards.js'
import { GPUS } from '../src/gpus.js'

describe('the card ladder', () => {
  it('every ladder card exists in the table and has the size of its tier; none is excluded', () => {
    for (const t of cards.LADDER) for (const c of t.cards) { expect(GPUS[c], c).toBeTruthy(); expect(GPUS[c].vram, c).toBe(t.gb); expect(cards.EXCLUDED.has(c), c).toBe(false) }
  })
  it('B200, B300 and the H200s are never offered, whatever the starting card', () => {
    for (const start of ['rtxpro4500', 'rtx4090', 'a6000', 'a100', undefined]) { const l = cards.escalate(start); for (const x of ['b200', 'b300', 'h200', 'h200nvl']) expect(l).not.toContain(x) }
  })
  it('32 GB goes to 48, then 80, then 96 GB, in tier order', () => {
    const l = cards.escalate('rtxpro4500'), gbs = l.map((c) => GPUS[c].vram)
    expect(gbs[0]).toBe(48); expect([...gbs].sort((a, b) => a - b)).toEqual(gbs); expect(new Set(gbs)).toEqual(new Set([48, 80, 96]))
    expect(l).not.toContain('rtxpro4500')
  })
  it('a card is found by key, RunPod id or name, and only bigger cards follow', () => {
    expect(cards.escalate('RTX PRO 4500')).toEqual(cards.escalate('rtxpro4500'))
    expect(cards.escalate('NVIDIA RTX PRO 4500 Blackwell')).toEqual(cards.escalate('rtxpro4500'))
    expect(cards.escalate('a100').every((c) => GPUS[c].vram > 80)).toBe(true)
    expect(cards.escalate('rtxpro6000')).toEqual([])   // nothing bigger that is allowed: the task fails with its error
  })
  it('cards the task already tried are not offered again', () => {
    const l = cards.escalate('rtxpro4500', ['rtxpro5000', 'l40s'])
    expect(l).not.toContain('rtxpro5000'); expect(l).not.toContain('l40s'); expect(l[0]).toBe('rtx6000ada')
  })
  it('names a card with its size for the events', () => { expect(cards.nameOf('rtxpro4500')).toBe('RTX PRO 4500 (32 GB)'); expect(cards.nameOf(undefined)).toBe('the pool card') })
})

describe('telling the failures apart', () => {
  it('the pod log saying the container hit its memory limit is out of memory, with the proof', () => {
    const r = cards.classify({ message: 'ComfyUI answered HTTP 502 for /history/abc', podLog: ['2026-11-20T23:45:02Z system WARN: container is unhealthy: exit code 137: (docker kill?); triggered memory limits (OOM)'] })
    expect(r.kind).toBe('oom'); expect(r.why).toMatch(/memory limits/)
  })
  it('cgroup OOM kills count as out of memory', () => expect(cards.classify({ message: 'ComfyUI answered HTTP 502', oomKills: 2 }).kind).toBe('oom'))
  it('a CUDA or host out-of-memory error text is out of memory', () => {
    expect(cards.classify({ message: 'CUDA out of memory. Tried to allocate 2.00 GiB' }).kind).toBe('oom')
    expect(cards.classify({ message: 'torch.OutOfMemoryError: Allocation on device' }).kind).toBe('oom')
  })
  it('a 502 with no memory evidence is transient; with a pod restart it is a restart', () => {
    expect(cards.classify({ message: 'ComfyUI answered HTTP 502 for /history/x' }).kind).toBe('transient')
    expect(cards.classify({ message: 'ComfyUI answered HTTP 502 for /history/x', uptimeReset: true }).kind).toBe('restart')
    expect(cards.classify({ message: 'ComfyUI restarted while the graph ran: prompt x is gone' }).kind).toBe('restart')
  })
  it('a timeout of the poll or the conversion is transient', () => {
    expect(cards.classify({ message: 'The operation was aborted due to timeout' }).kind).toBe('transient')
    expect(cards.classify({ message: 'The pod could not convert the graph: Page.wait_for_function: Timeout 60000ms exceeded.' }).kind).toBe('transient')
  })
  it('a graph error is a graph error, even when the pod log has nothing', () => {
    expect(cards.classify({ message: "Value not in list: ckpt_name: 'x.safetensors' not in [a, b]" }).kind).toBe('graph')
    expect(cards.classify({ message: 'Prompt outputs failed validation: Required input is missing' }).kind).toBe('graph')
  })
  it('memory evidence beats a transient-looking message (the 502 is the symptom)', () => {
    expect(cards.classify({ message: 'The operation was aborted due to timeout', podLog: ['container is unhealthy: triggered memory limits (OOM)'] }).kind).toBe('oom')
  })
})
