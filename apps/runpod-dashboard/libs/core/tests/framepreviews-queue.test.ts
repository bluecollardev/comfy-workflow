import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as fp from '../src/framepreviews.js'
import * as reg from '../src/jobsregistry.js'
import { scratch } from './helpers.js'

// The Queue's Generations rows for frame-previews jobs (Lucas, 2026-11-21: "i should see previews jobs in queue no? generations tab?", "thumbnails generation, frames generation etc"):
// the counters per kind (frames, thumbnails, posters), the rows of this process and of other processes, and cancelling either.
const hasPy = spawnSync('python3', ['-c', 'import numpy, PIL']).status === 0
const wait = async (id: string) => { for (let i = 0; i < 100 && (fp.status({ job_id: id }) as fp.Job).state === 'running'; i++) await new Promise((r) => setTimeout(r, 15)); return fp.status({ job_id: id }) as fp.Job }

describe('framepreviews: counters per kind and the Queue rows', () => {
  it('a job counts frames, thumbnails and posters apart (the totals still add them up), and the row says so', async () => {
    fp.setDeps({
      target: async () => ({ host: 'h', port: 22 }), outputDir: () => '/o',
      ssh: async ({ script, onLine }) => {
        if (script.includes('ffmpeg')) { for (const l of ['TOTAL 3', 'FAIL c.mp4.jpg ffmpeg failed', 'PREV 3/3 ok=1 skipped=1 failed=1', 'DONE ok=1 skipped=1 failed=1']) onLine(l); return { code: 0 } }
        for (const l of ['TOTAL 4', 'PREV 4/4 ok=1 skipped=3 failed=0 thumbs=4 tmade=3', 'DONE ok=1 skipped=3 failed=0 thumbs=4 tmade=3']) onLine(l)
        return { code: 0 }
      },
    })
    try {
      const j = await fp.start({ pod_id: 'p1', items: [{ src_dir: 'a/seq', frames: 4 }, { src_dir: 'a/vids', kind: 'posters', frames: 3 }] })
      expect([j.frames_total, j.posters_total]).toEqual([4, 3])   // known before the first line, from the callers' counts
      const s = await wait(j.id)
      expect(s).toMatchObject({ state: 'done', done: 2, skipped: 4, total: 7, frames_total: 4, frames_done: 4, frames_written: 1, thumbs_done: 4, thumbs_made: 3, posters_total: 3, posters_done: 2, posters_failed: 1 })
      const row = fp.jobsList().find((r) => r.job_id === j.id)!
      expect(row).toMatchObject({ external: false, trigger: 'manual', state: 'done', items: 2, frames_total: 4, frames_done: 4, thumbs_done: 4, thumbs_made: 3, posters_total: 3, posters_done: 2, posters_failed: 1, failed: 1, relaunchable: true })   // a poster failed: it can be run again
    } finally { fp.setDeps(null) }
  })
  it('a script that predates the thumbnail counters (PREV without thumbs=) still counts frames and leaves the thumbnail counters at 0', async () => {
    fp.setDeps({ target: async () => ({ host: 'h', port: 22 }), outputDir: () => '/o', ssh: async ({ onLine }) => { onLine('TOTAL 2'); onLine('PREV 2/2 ok=2 skipped=0 failed=0'); return { code: 0 } } })
    try { const s = await wait((await fp.start({ pod_id: 'p1', items: [{ src_dir: 'a/s' }] })).id); expect(s).toMatchObject({ frames_total: 2, frames_done: 2, frames_written: 2, thumbs_done: 0, thumbs_made: 0 }) } finally { fp.setDeps(null) }
  })
  it('jobsList: running first, relaunchable only when stopped with unfinished folders or failures, and a relaunch keeps the automatic trigger', async () => {
    const pods = async (): Promise<fp.PodInfo[]> => [{ id: 'p1', name: 'Landing', running: true, volume: 'v1' }]
    fp.setDeps({
      target: async () => ({ host: 'h', port: 22 }), outputDir: () => '/o', pods,
      ssh: async ({ script, onLine, signal }) => {
        if (script.includes('slow')) { await new Promise((res) => signal.addEventListener('abort', () => res(null))); return { code: 0 } }
        if (script.includes('seqB')) return { code: 255 }
        onLine('TOTAL 2'); onLine('PREV 2/2 ok=2 skipped=0 failed=0 thumbs=2 tmade=2'); return { code: 0 }
      },
    })
    try {
      const clean = await fp.start({ pod_id: 'p1', items: [{ src_dir: 'a/seqA' }], trigger: 'automatic' }); await wait(clean.id)
      const broke = await fp.start({ pod_id: 'p1', items: [{ src_dir: 'a/seqA' }, { src_dir: 'a/seqB' }], trigger: 'automatic' }); await wait(broke.id)
      const slow = await fp.start({ pod_id: 'p1', items: [{ src_dir: 'a/slow', frames: 5 }] })
      let rows = fp.jobsList()
      expect(rows[0]).toMatchObject({ job_id: slow.id, state: 'running', relaunchable: false })   // running first, and a running job cannot be run again
      expect(rows.find((r) => r.job_id === clean.id)).toMatchObject({ state: 'done', trigger: 'automatic', relaunchable: false })   // every folder finished, nothing failed
      expect(rows.find((r) => r.job_id === broke.id)).toMatchObject({ state: 'done', relaunchable: true })   // seqB never finished
      const again = await fp.relaunch({ job_id: broke.id }); expect(again.job).toMatchObject({ relaunch_of: broke.id, trigger: 'automatic' })
      await wait(again.job!.id)
      rows = fp.jobsList(); expect(rows.find((r) => r.job_id === again.job!.id)).toMatchObject({ relaunch_of: broke.id, trigger: 'automatic' })
      fp.cancel({ job_id: slow.id }); await wait(slow.id)
    } finally { fp.setDeps(null) }
  })
  it('a job of another process is a row from the shared record (external, with its counters); cancelAny asks its owner, and an unknown id is not ok', async () => {
    scratch()   // the config folder the shared record lives in
    reg.reset()   // the earlier tests asked for externals with the real clock: forget that refresh
    let pid = 100
    reg.setDeps({ pid: () => pid, now: () => Date.parse('2026-11-21T10:00:00Z'), alive: () => true, heartbeatMs: 10 })
    try {
      const stop = reg.track({ id: 'framepreviews-other-1', kind: 'volume', trigger: 'manual', origin: 'mcp', client: 'claude-code', label: 'frame previews 3 sequences', view: () => ({ state: 'running', progress: { done: 6, total: 12, unit: 'frames' }, previews: { pod_id: 'pod-x', frames_done: 6, frames_total: 12, thumbs_done: 4, posters_done: 1, posters_total: 2, failed: 0, current: 'a/seq' } }), cancel: () => undefined })
      await new Promise((r) => setTimeout(r, 60)); pid = 200; await reg.refresh()
      const row = fp.jobsList().find((r) => r.job_id === 'framepreviews-other-1')
      expect(row).toMatchObject({ external: true, origin: 'mcp', client: 'claude-code', state: 'running', pod_id: 'pod-x', frames_total: 12, frames_done: 6, thumbs_done: 4, posters_total: 2, posters_done: 1, current: 'a/seq', relaunchable: false })
      expect(await fp.cancelAny({ job_id: 'framepreviews-other-1' })).toEqual({ ok: true, own: false })
      expect(await fp.cancelAny({ job_id: 'nope' })).toEqual({ ok: false, own: false })
      pid = 100; stop()
    } finally { reg.reset() }
  })
  it.runIf(hasPy)('the real script reports how many thumbnails are there and how many it made this run (a re-run over old previews makes only the thumbnails)', () => {
    const d = scratch('framepreviews-thumbcounts'), src = join(d, 'src'), out = join(d, '.previews', 'src'); mkdirSync(src)
    const dpx = Buffer.alloc(2048 + 8 * 4 * 6); dpx.write('SDPX', 0); dpx.writeUInt32BE(2048, 4); dpx.writeUInt32BE(8, 772); dpx.writeUInt32BE(4, 776); dpx[800] = 50; dpx[803] = 16
    for (let i = 0; i < 2; i++) writeFileSync(join(src, `c.${String(i).padStart(4, '0')}.dpx`), dpx)
    const run = () => spawnSync('python3', ['-', src, out, 'gamma26', '1'], { input: fp.PYTHON, encoding: 'utf8' }).stdout
    expect(run()).toMatch(/PREV 2\/2 ok=2 skipped=0 failed=0 thumbs=2 tmade=2[\s\S]*DONE ok=2 skipped=0 failed=0 thumbs=2 tmade=2/)
    expect(run()).toMatch(/DONE ok=0 skipped=2 failed=0 thumbs=2 tmade=0/)   // everything is there: nothing made
    rmSync(join(out, 'thumbs'), { recursive: true, force: true })
    expect(run()).toMatch(/DONE ok=0 skipped=2 failed=0 thumbs=2 tmade=2/)   // old previews, no thumbnails: only the thumbnails are made
  }, 60_000)
  it('cleanPreviews keeps numbers and one short name, nothing else', () => {
    expect(reg.cleanPreviews({ pod_id: 'p'.repeat(60), frames_done: 2.6, frames_total: -1, thumbs_done: Number.NaN, posters_done: 1, posters_total: 3, failed: 0, current: 'x'.repeat(300) } as never))
      .toEqual({ pod_id: 'p'.repeat(40), frames_done: 3, frames_total: 0, thumbs_done: 0, posters_done: 1, posters_total: 3, failed: 0, current: 'x'.repeat(160) })
    expect(reg.cleanPreviews(undefined)).toBeUndefined()
  })
})
