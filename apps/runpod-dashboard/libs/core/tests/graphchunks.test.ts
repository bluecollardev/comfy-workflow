import { describe, expect, it } from 'vitest'
import * as gc from '../src/graphchunks.js'
import * as cards from '../src/cards.js'

const ui = (first = 88, last = 720) => ({ nodes: [
  { id: 1, type: 'OCIORead', widgets_values: ['/x/clip.mp4', 'video', 'a', 'b', true, first, last, 0, 'error', 'hold', 23.976] },
  { id: 2, type: 'ImageScale', widgets_values: ['bicubic', 3840, 2160, 'disabled'] },
  { id: 14, type: 'OCIOWrite', widgets_values: ['none', 'g', 'g', 'sequence', 'dpx', 'prores_4444', '16', 'zip', false, 1, last - first + 1, 0, 1, false, false, 'delivery_v008/CLIP', 'CLIP', false] },
] })

describe('describeGraph', () => {
  it('reads the window and the numbering', () => {
    expect(gc.describeGraph(ui())).toMatchObject({ readId: '1', writeId: '14', first: 88, last: 720, count: 633, startNumber: 0, sourceStart: 1, filename: 'CLIP' })
  })
  it('refuses graphs it cannot narrow without changing the result', () => {
    expect(() => gc.describeGraph({})).toThrow(/Not a UI graph/)
    expect(() => gc.describeGraph(ui(0, 0))).toThrow(/no frame window/)
    const g = ui(); (g.nodes[2].widgets_values as unknown[])[8] = true
    expect(() => gc.describeGraph(g)).toThrow(/auto_range/)
    const h = ui(); h.nodes.pop()
    expect(() => gc.describeGraph(h)).toThrow(/exactly one/)
  })
})

describe('planGraphChunks and narrowGraph', () => {
  const win = gc.describeGraph(ui())
  const chunks = gc.planGraphChunks(win, 50, 8)
  it('makes 633 frames in 13 chunks with no gap and no repeat', () => {
    expect(chunks).toHaveLength(13)
    expect(chunks[12]).toMatchObject({ first: 688, last: 720 })
    expect(() => gc.checkCoverage(chunks, 88, 720)).not.toThrow()
  })
  it('the first and last chunk read no pad beyond the graph window; inner ones read 8 each side', () => {
    expect(chunks[0]).toMatchObject({ first: 88, readFirst: 88, readLast: 145, startNumber: 0 })
    expect(chunks[1]).toMatchObject({ first: 138, readFirst: 130, startNumber: 50 })
    expect(chunks[12]).toMatchObject({ readLast: 720 })
  })
  it('a narrowed copy reads the padded window and writes only the owned frames, numbered as the whole run would', () => {
    const src = ui(), before = JSON.stringify(src)
    const g = gc.narrowGraph(src, chunks[1]) as ReturnType<typeof ui>
    expect(JSON.stringify(src)).toBe(before)
    const r = g.nodes[0].widgets_values as unknown[], w = g.nodes[2].widgets_values as unknown[]
    expect([r[5], r[6]]).toEqual([130, 195])
    expect([w[9], w[10], w[11], w[12]]).toEqual([9, 58, 50, 1])   // batch = 130..195; owned 138..187 = batch frames 9..58; files 50..99
    expect(g.nodes[1]).toEqual(src.nodes[1]); expect(w.slice(13)).toEqual((src.nodes[2].widgets_values as unknown[]).slice(13))
  })
  it('every chunk, narrowed, writes file numbers that tile 0..632 once and name the right source frames', () => {
    const files: string[] = []
    for (const c of chunks) {
      const g = gc.narrowGraph(ui(), c) as ReturnType<typeof ui>
      const r = g.nodes[0].widgets_values as number[], w = g.nodes[2].widgets_values as number[]
      for (let f = w[9]; f <= w[10]; f++) {
        const sourceFrame = r[5] + (f - 1), fileNo = w[11] + (f - w[9])
        expect(fileNo).toBe(sourceFrame - 88)
        files.push(`CLIP.${String(fileNo).padStart(4, '0')}.dpx`)
      }
    }
    expect(() => gc.checkWritten(files, 0, 633)).not.toThrow()
  })
  it('narrowApi does the same on an API graph', () => {
    const api = { 1: { class_type: 'OCIORead', inputs: { start_frame: 88, end_frame: 720 } }, 14: { class_type: 'OCIOWrite', inputs: { first_frame: 1, last_frame: 633, start_number: 0 } } }
    const n = gc.narrowApi(api, chunks[1]) as typeof api
    expect(n[1].inputs).toEqual({ start_frame: 130, end_frame: 195 }); expect(n[14].inputs).toEqual({ first_frame: 9, last_frame: 58, start_number: 50 })
    expect(api[1].inputs.start_frame).toBe(88)
  })
  it('a short graph is one chunk; names go next to the graph', () => {
    expect(gc.planGraphChunks({ first: 1, last: 40, startNumber: 0 })).toHaveLength(1)
    expect(gc.chunkPath('base_v008/p/p__f23__base_v008.json', 3)).toBe('base_v008/p/p__f23__base_v008__chunk03.json')
  })
})

describe('the merge check', () => {
  it('names a gap, a repeat and a short or long end', () => {
    expect(() => gc.checkCoverage([{ n: 1, first: 1, last: 10 }, { n: 2, first: 12, last: 20 }], 1, 20)).toThrow(/gap: frames 11-11/)
    expect(() => gc.checkCoverage([{ n: 1, first: 1, last: 10 }, { n: 2, first: 10, last: 20 }], 1, 20)).toThrow(/repeat/)
    expect(() => gc.checkCoverage([{ n: 1, first: 1, last: 10 }], 1, 20)).toThrow(/gap: frames 11-20/)
    expect(() => gc.checkCoverage([{ n: 1, first: 1, last: 25 }], 1, 20)).toThrow(/past the last/)
  })
  it('checkWritten finds a missing, an extra and a doubled file number', () => {
    expect(() => gc.checkWritten(['a.0000.dpx', 'a.0002.dpx'], 0, 3)).toThrow(/missing 1/)
    expect(() => gc.checkWritten(['a.0000.dpx', 'a.0001.dpx', 'a.0005.dpx'], 0, 2)).toThrow(/unexpected 5/)
    expect(() => gc.checkWritten(['a.0000.dpx', 'a_x.0000.dpx'], 0, 1)).toThrow(/twice/)
  })
})

describe('RAM sizing', () => {
  it('chunkFor keeps the peak under 60% of the RAM', () => {
    const GiB = 2 ** 30, ram = 116.4 * GiB, per = 1.9 * GiB, base = 10 * GiB
    const owned = gc.chunkFor(ram, per, base, 8)
    expect(gc.estimatePeak(owned + 16, per, base)).toBeLessThanOrEqual(ram * 0.6)
    expect(gc.chunkFor(ram, 100 * GiB, 0)).toBe(gc.MIN_CHUNK_FRAMES)
    expect(() => gc.chunkFor(0, 1)).toThrow()
  })
})

describe('the live guard', () => {
  const win = { first: 1, last: 100 }
  const mk = (rams: (number | null)[], outcomes: ('done' | { error: string } | null)[]) => {
    const log: string[] = []; let r = 0, o = 0; const submitted: unknown[] = []
    const deps: gc.RunDeps = {
      build: async (c) => ({ c }), submit: async (api) => { submitted.push(api); return `p${submitted.length}` },
      outcome: async () => outcomes[Math.min(o++, outcomes.length - 1)], ram: async () => rams[Math.min(r++, rams.length - 1)],
      interrupt: async () => { log.push('interrupt') }, free: async () => { log.push('free') }, sleep: async () => {},
    }
    return { log, submitted, deps }
  }
  it('runs every chunk and the chunks make the whole range', async () => {
    const chunks = gc.planGraphChunks({ first: 1, last: 100, startNumber: 0 }, 50, 8)
    const out = await gc.runChunks(mk([40], [null, 'done']).deps, chunks, { win })
    expect(out.ok).toBe(true); expect(() => gc.checkCoverage(out.final, 1, 100)).not.toThrow()
  })
  it('interrupts at 85% and resubmits the chunk as two halves that still tile the range', async () => {
    const chunks = gc.planGraphChunks({ first: 1, last: 100, startNumber: 0 }, 50, 8)
    const { deps, log } = mk([90, 30], [null, 'done'])   // chunk 1: running, RAM 90 -> interrupt; then every poll says done
    const out = await gc.runChunks(deps, chunks, { win })
    expect(log.slice(0, 2)).toEqual(['interrupt', 'free'])
    expect(out.attempts[0].state).toBe('split'); expect(out.ok).toBe(true)
    expect(out.final.map((c) => [c.first, c.last, c.startNumber])).toEqual([[1, 25, 0], [26, 50, 25], [51, 100, 50]])
    expect(() => gc.checkCoverage(out.final, 1, 100)).not.toThrow()
  })
  it('fails with 507 when the smallest chunk is still over the guard', async () => {
    const out = await gc.runChunks(mk([95], [null]).deps, gc.planGraphChunks({ first: 1, last: 6, startNumber: 0 }, 6, 0), { win: { first: 1, last: 6 } })
    expect(out.ok).toBe(false); expect(out.attempts[0].error).toMatch(/smallest chunk/)
  })
  it('a ComfyUI error stops the run and keeps its text', async () => {
    const out = await gc.runChunks(mk([10], [{ error: 'boom' }]).deps, gc.planGraphChunks({ first: 1, last: 100, startNumber: 0 }, 50, 0), { win })
    expect(out.ok).toBe(false); expect(out.attempts).toHaveLength(1); expect(out.attempts[0].error).toBe('boom')
  })
})

describe('escalation by GPU count (ADR-056 2.4)', () => {
  it('smaller chunk first, then 1 -> 2 -> 4 GPUs of the same card, then a card with more RAM per GPU, then nothing', () => {
    expect(cards.escalateRam({ card: 'rtxpro4500', gpuCount: 1, chunk: 50 })).toMatchObject({ kind: 'chunk', chunk: 25 })
    expect(cards.escalateRam({ card: 'rtxpro4500', gpuCount: 1, chunk: 10 })).toMatchObject({ kind: 'gpus', card: 'rtxpro4500', gpuCount: 2 })
    expect(cards.escalateRam({ card: 'rtxpro4500', gpuCount: 2, chunk: 5 })).toMatchObject({ kind: 'gpus', gpuCount: 4 })
    expect(cards.escalateRam({ card: 'rtxpro4500', gpuCount: 4, chunk: 5 })).toMatchObject({ kind: 'card', card: 'rtxpro6000', gpuCount: 1 })
    expect(cards.escalateRam({ card: 'rtxpro6000wk', gpuCount: 4, chunk: 5 })).toBeNull()
  })
})
