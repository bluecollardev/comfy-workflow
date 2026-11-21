/**
 * The DPX of an Auto-publish upload are the CORRECTED copies (ADR-057 decision 7, ADR-055 section 13). The frames the pipeline writes carry the wrong header (linear flag,
 * no timecode); `dpxfix` writes a corrected copy under `output/<delivery_prepare.out_dir>/<clip>/`. Before a review's DPX can go into an upload plan this makes sure that
 * copy exists and is complete, exactly as the Prepare For Delivery window does it: `dpxfix.plan` first (clip name, start timecode and frame rate from the EDL, taken verbatim),
 * then `dpxfix.run` with the Default Configuration's delivery_prepare settings and the standing approver as the named yes. The upload then carries the copy, never the original.
 *
 *   - the sequence is not in the EDL, or its frames are not on the volume: the review goes as a video only, with the reason (`skipped`);
 *   - the plan carries a flag (frame count differs from the EDL cut, held back by the EDL check, no start timecode), there is no approver or no running pod, or the fix fails
 *     or does not read back right: the review is HELD (`held` has the reason) and nothing of it is uploaded;
 *   - in a dry run nothing is written: the plan runs (so the flags show), and the corrected copy is listed only when it is already there.
 * Nothing here deletes or overwrites an original frame.
 */
import * as dpxfix from './dpxfix.js'
import * as publish from './publish.js'

export interface SeqRef { /** the folder of the original frames under the volume's output/ (the review's sidecar) */ source_dir: string; /** the sequence's stem (the sidecar's name) */ name: string }
export interface Prepared {
  /** the publish items of the corrected copies (volume folders), empty when nothing can go */
  items: unknown[]
  /** the clips whose corrected copy was made or found complete */
  fixed: string[]
  /** why the whole review is held back; '' when it is not */
  held: string
  /** what a person may want to know (dry run: the copy is made at upload) */
  notes: string[]
  /** sequences that go as video only, with the reason */
  skipped: string[]
}
export interface Deps {
  plan: typeof dpxfix.plan
  run: typeof dpxfix.run
  /** running pods on the volume, best first (an idle pod before one that is rendering) */
  pods(): Promise<{ id: string; name: string }[]>
  /** is there something at this folder of the volume's output/ (dry run only)? */
  exists(dir: string, stem: string): Promise<boolean>
  /** the publish items of a corrected copy: the volume folder (streamed from the volume, never downloaded); tests give local paths */
  items(dir: string, stem: string): Promise<unknown[]>
}
const defaults = (): Deps => ({
  plan: (o) => dpxfix.plan(o),
  run: (o) => dpxfix.run(o),
  pods: () => publish.rankedPodsOnVolume(),
  items: async (dir, stem) => [{ where: 'volume', path: dir, stem }],
  exists: async (dir, stem) => { try { const p = await publish.plan({ items: [{ where: 'volume', path: dir, stem }], targets: ['s3'], round: '_TEST_plan' } as never); return p.items.length > 0 } catch { return false } },
})
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

let fixing = 0
/** How many sequences are being corrected right now (Auto-publish's status shows it). */
export const fixingCount = (): number => fixing
const done = new Map<string, number>()   // a copy made or found complete in this process: clip|frames|timecode|fps|settings -> frames
export function reset(): void { done.clear(); fixing = 0; deps = defaults() }

const msg = (e: unknown): string => String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 200)

/** `testRound`: the round is a `_TEST_` round, which waives only the frame count (ADR-050), as in the EDL check before. */
export async function prepare(o: { seqs: SeqRef[]; approvedBy: string; dry: boolean; testRound?: boolean }): Promise<Prepared> {
  const out: Prepared = { items: [], fixed: [], held: '', notes: [], skipped: [] }
  const seen = new Set<string>(), seqs = o.seqs.filter((s) => { const k = `${s.source_dir}|${s.name}`; if (seen.has(k)) return false; seen.add(k); return true })
  if (!seqs.length) return out
  let rows: dpxfix.PlanRow[]
  try { rows = (await deps.plan({ items: seqs.map((s) => ({ src_dir: s.source_dir, stem: s.name })) })).rows } catch (e) { out.held = `dpx fix: the plan could not be made: ${msg(e)}`; return out }
  const cfg = dpxfix.settings(), todo: { seq: SeqRef; row: dpxfix.PlanRow }[] = []
  for (let i = 0; i < seqs.length; i++) {
    const seq = seqs[i], row = rows[i]
    if (!row || !row.clip) { out.skipped.push(`${seq.name}: not in the EDL, its DPX frames are not uploaded`); continue }
    if (!row.frames) { out.skipped.push(`${seq.name}: no frames found on the volume, its DPX frames are not uploaded`); continue }
    if (!row.ok) { out.held = `dpx fix: ${row.clip}: ${row.why || 'held back by the EDL check'}`; return out }
    if (o.testRound && row.expected_frames !== null && row.frames !== row.expected_frames) out.notes.push(`${row.clip}: EDL frame count not checked in a test round: ${row.frames} frames, the cut has ${row.expected_frames}`)
    if (!o.testRound && row.expected_frames !== null && row.frames !== row.expected_frames) { out.held = `dpx fix: ${row.clip}: frame count ${row.frames} of ${row.expected_frames}`; return out }
    if (row.timecode_source === null && cfg.timecode_source !== 'zero') { out.held = `dpx fix: ${row.clip}: no start timecode`; return out }
    todo.push({ seq, row })
  }
  const itemsOf = (clip: string): Promise<unknown[]> => deps.items(`${cfg.out_dir}/${clip}`, clip)
  if (o.dry) {   // nothing is written: the copy is listed when it is already there
    for (const { row } of todo) { if (await deps.exists(`${cfg.out_dir}/${row.clip}`, row.clip)) out.items.push(...(await itemsOf(row.clip))); else out.notes.push(`${row.clip}: the corrected copy is made at upload`) }
    return out
  }
  if (!todo.length) return out
  const who = o.approvedBy.trim()
  if (!who) { out.held = 'dpx fix: no approver (the standing approval names nobody), so no copy is written'; return out }
  const pods = await deps.pods().catch(() => [] as { id: string; name: string }[])
  for (const { seq, row } of todo) {
    const key = `${row.clip}|${row.frames}|${row.start_timecode}|${row.fps}|${JSON.stringify(cfg)}`
    if (done.get(key) === row.frames) { out.items.push(...(await itemsOf(row.clip))); out.fixed.push(row.clip); continue }
    if (!pods.length) { out.held = 'dpx fix: no running pod on the volume to write the copy on (this app never starts one for it)'; return out }
    let res: Awaited<ReturnType<typeof dpxfix.run>> | null = null, why = ''
    fixing++
    try {
      // the plan's values verbatim, as the Prepare For Delivery window sends them; skip_existing only so that a copy that is already complete is read back, not written again
      res = await deps.run({ pod_id: pods[0].id, approved_by: who, items: [{ src_dir: seq.source_dir, clip: row.clip, start_timecode: row.start_timecode, fps: row.fps, skip_existing: true }] })
    } catch (e) { why = msg(e) } finally { fixing-- }
    const r = res?.results?.[0]
    if (!r || !r.ok || r.frames !== row.frames) { out.held = `dpx fix: ${row.clip}: ${why || r?.error || (r ? `${r.frames} of ${row.frames} frames` : 'no result')}`; return out }
    done.set(key, row.frames); out.items.push(...(await itemsOf(row.clip))); out.fixed.push(row.clip)
  }
  return out
}
