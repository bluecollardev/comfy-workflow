import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as dpxprep from '../src/dpxprep.js'
import * as dpxfix from '../src/dpxfix.js'
import * as mounts from '../src/mounts.js'
import { scratch } from './helpers.js'

// ADR-057 decision 7: Auto-publish uploads the CORRECTED copies. Fakes only: the plan and the run of dpxfix, the pods.
let runs: dpxfix.FixItem[][], pods: { id: string; name: string }[], exists: boolean
const SEQ = { source_dir: 'delivery_v008/CLIP_A', name: 'CLIP_A' }
const row = (o: Partial<dpxfix.PlanRow> = {}): dpxfix.PlanRow => ({ src_dir: SEQ.source_dir, stem: SEQ.name, clip: 'CLIP_A_FINAL_V01', frames: 70, expected_frames: 70, start_timecode: '00:00:03:01', timecode_source: 'EDL', fps: 23.976, ok: true, why: '', ...o })
const fake = (r: dpxfix.PlanRow[], run?: (items: dpxfix.FixItem[]) => dpxfix.FixResult[] | Promise<dpxfix.FixResult[]>) => dpxprep.setDeps({
  plan: async () => ({ rows: r, settings: dpxfix.settings() }),
  run: async (o) => { runs.push(o.items!); const results = await (run ? run(o.items!) : o.items!.map((i) => ({ clip: i.clip, frames: r[0].frames, out_dir: `_delivery_v11/${i.clip}`, ok: true }))); return { results, out_root: '', settings: dpxfix.settings() } },
  pods: async () => pods,
  exists: async () => exists,
})
beforeEach(() => { process.env.POD_MANAGER_CONFIG_DIR = scratch(); dpxprep.reset(); runs = []; pods = [{ id: 'p1', name: 'pod one' }]; exists = false })
afterEach(() => { dpxprep.reset(); delete process.env.POD_MANAGER_CONFIG_DIR })

describe('dpxprep.prepare: the corrected copy is what goes', () => {
  it('a clean plan runs the fix with the plan values verbatim and the named approver, then the items are the corrected folder, never the original', async () => {
    fake([row()])
    const p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false })
    expect(p.held).toBe(''); expect(p.fixed).toEqual(['CLIP_A_FINAL_V01'])
    expect(p.items).toEqual([{ where: 'volume', path: `${mounts.DELIVERY_PREPARE_DEFAULT.out_dir}/CLIP_A_FINAL_V01`, stem: 'CLIP_A_FINAL_V01' }])
    expect(JSON.stringify(p.items)).not.toMatch(/delivery_v008/)
    expect(runs).toEqual([[{ src_dir: SEQ.source_dir, clip: 'CLIP_A_FINAL_V01', start_timecode: '00:00:03:01', fps: 23.976, skip_existing: true }]])   // the plan's values, nothing else overridden
  })
  it('a copy made in this process is not made again', async () => {
    fake([row()]); await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false }); const again = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false })
    expect(runs).toHaveLength(1); expect(again.items).toHaveLength(1)
  })
  it('a flagged plan holds the review with the reason and writes nothing: frame count, held by the EDL, no start timecode', async () => {
    fake([row({ frames: 60, expected_frames: 70 })]); let p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false })
    expect(p.held).toBe('dpx fix: CLIP_A_FINAL_V01: frame count 60 of 70'); expect(p.items).toEqual([]); expect(runs).toEqual([])
    fake([row({ ok: false, why: 'start timecode missing from the EDL' })]); p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false }); expect(p.held).toMatch(/dpx fix: CLIP_A_FINAL_V01: start timecode missing/)
    fake([row({ timecode_source: null })]); p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false }); expect(p.held).toMatch(/no start timecode/); expect(runs).toEqual([])
  })
  it('a _TEST_ round waives only the frame count and says so', async () => {
    fake([row({ frames: 60, expected_frames: 70 })]); const p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false, testRound: true })
    expect(p.held).toBe(''); expect(p.notes.join()).toMatch(/not checked in a test round: 60 frames, the cut has 70/); expect(runs).toHaveLength(1)
  })
  it('a sequence that is not in the EDL, or has no frames, is video only with the reason, not held', async () => {
    fake([row({ clip: '' })]); let p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false })
    expect(p.held).toBe(''); expect(p.items).toEqual([]); expect(p.skipped.join()).toMatch(/CLIP_A: not in the EDL/); expect(runs).toEqual([])
    fake([row({ frames: 0, expected_frames: null })]); p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false }); expect(p.items).toEqual([]); expect(p.skipped.join()).toMatch(/no frames found on the volume/)
  })
  it('no approver or no running pod holds the review and writes nothing', async () => {
    fake([row()]); let p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: '  ', dry: false }); expect(p.held).toMatch(/no approver/); expect(runs).toEqual([])
    pods = []; p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false }); expect(p.held).toMatch(/no running pod on the volume/); expect(runs).toEqual([])
  })
  it('a fix that fails, throws or does not read back all the frames holds the review', async () => {
    fake([row()], (items) => items.map((i) => ({ clip: i.clip, frames: 70, out_dir: 'x', ok: false, error: 'CHECK 69/70 headers right' }))); let p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false })
    expect(p.held).toBe('dpx fix: CLIP_A_FINAL_V01: CHECK 69/70 headers right'); expect(p.items).toEqual([])
    dpxprep.reset(); fake([row()], () => { throw new Error('ssh dropped') }); p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false }); expect(p.held).toMatch(/ssh dropped/)
    dpxprep.reset(); fake([row()], (items) => items.map((i) => ({ clip: i.clip, frames: 69, out_dir: 'x', ok: true }))); p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false }); expect(p.held).toMatch(/69 of 70 frames/)
    expect(dpxprep.fixingCount()).toBe(0)   // the counter always comes back down
  })
  it('the fixing count is up while the copy is being made', async () => {
    let during = -1; fake([row()], async (items) => { during = dpxprep.fixingCount(); return items.map((i) => ({ clip: i.clip, frames: 70, out_dir: 'x', ok: true })) })
    await dpxprep.prepare({ seqs: [SEQ], approvedBy: 'Lucas', dry: false }); expect(during).toBe(1); expect(dpxprep.fixingCount()).toBe(0)
  })
  it('a dry run writes nothing: the flags show, the corrected folder is listed only when it is already there', async () => {
    fake([row()]); let p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: '', dry: true })
    expect(runs).toEqual([]); expect(p.items).toEqual([]); expect(p.notes.join()).toMatch(/the corrected copy is made at upload/)
    exists = true; p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: '', dry: true }); expect(p.items).toHaveLength(1)
    fake([row({ frames: 60, expected_frames: 70 })]); p = await dpxprep.prepare({ seqs: [SEQ], approvedBy: '', dry: true }); expect(p.held).toMatch(/frame count 60 of 70/); expect(runs).toEqual([])
  })
})
