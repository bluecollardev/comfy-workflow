import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as fp from '../src/framepreviews.js'
import { scratch } from './helpers.js'

const hasPy = spawnSync('python3', ['-c', 'import numpy, PIL']).status === 0
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

/** A 16-bit RGB DPX, big-endian, w x h, a gradient. */
const dpx16 = (w = 8, h = 4) => {
  const b = Buffer.alloc(2048 + w * h * 6); b.write('SDPX', 0)
  b.writeUInt32BE(2048, 4); b.writeUInt32BE(w, 772); b.writeUInt32BE(h, 776); b[800] = 50; b[803] = 16
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) b.writeUInt16BE(Math.min(65535, 8000 * (x + 1) + 3000 * y + 500 * c), 2048 + ((y * w + x) * 3 + c) * 2)
  return b
}
/** A 10-bit filled method A RGB DPX. */
const dpx10 = (w = 4, h = 2) => {
  const b = Buffer.alloc(2048 + w * h * 4); b.write('SDPX', 0)
  b.writeUInt32BE(2048, 4); b.writeUInt32BE(w, 772); b.writeUInt32BE(h, 776); b[800] = 50; b[803] = 10; b.writeUInt16BE(1, 804)
  for (let i = 0; i < w * h; i++) b.writeUInt32BE(((300 + i) << 22) | ((500 + i) << 12) | ((700 + i) << 2), 2048 + i * 4)
  return b
}
const runPy = (src: string, out: string, tone = 'gamma26', skip = '1') => spawnSync('python3', ['-', src, out, tone, skip], { input: fp.PYTHON, encoding: 'utf8' })

describe('framepreviews: frame previews made where the files are', () => {
  it('rel() accepts a plain folder under output/ and refuses anything else', () => {
    expect(fp.rel('assembly_v024/review025_parts/split_cap120')).toBe('assembly_v024/review025_parts/split_cap120')
    for (const bad of ['', '/abs/path', '../x', 'a/../b', 'a b', "a'; rm -rf /; '", 'a$(x)']) expect(() => fp.rel(bad)).toThrow()
  })
  it('the previews live in a mirror tree beside the deliveries, never inside the frame folder, and the JPEG name follows the frame', () => {
    expect(fp.previewSubfolder('_delivery_v11/CLIP')).toBe('.previews/_delivery_v11/CLIP')
    expect(fp.jpgName('CLIP.0106.dpx')).toBe('CLIP.0106.jpg')
  })
  it.runIf(hasPy)('the script writes one small JPEG per frame, skips frames that have one, never touches the sources, and reports a bad frame without stopping', () => {
    const d = scratch('framepreviews'), src = join(d, 'src'), out = join(d, '.previews', 'src'); mkdirSync(src)
    for (let i = 0; i < 4; i++) writeFileSync(join(src, `clip.${String(i).padStart(4, '0')}.dpx`), dpx16())
    writeFileSync(join(src, 'clip.0004.dpx'), dpx10())
    writeFileSync(join(src, 'clip.0005.dpx'), Buffer.from('not a dpx at all'))
    const r = runPy(src, out)
    expect(r.stdout).toMatch(/TOTAL 6/); expect(r.stdout).toMatch(/FAIL clip\.0005\.jpg not a DPX/); expect(r.stdout).toMatch(/DONE ok=5 skipped=0 failed=1/); expect(r.status).toBe(0)
    const jpgs = [0, 1, 2, 3, 4].map((i) => `clip.${String(i).padStart(4, '0')}.jpg`)
    expect(readdirSync(out).filter((f) => f.endsWith('.jpg')).sort()).toEqual(jpgs)   // the thumbnail tier is a folder beside them, never mixed in
    for (const f of jpgs) { const s = statSync(join(out, f)).size; expect(s).toBeGreaterThan(100); expect(s).toBeLessThan(30_000) }
    expect(readdirSync(join(out, 'thumbs')).sort()).toEqual(jpgs)   // one 160 px thumbnail per preview (a few KB)
    for (const f of jpgs) { const s = statSync(join(out, 'thumbs', f)).size; expect(s).toBeGreaterThan(100); expect(s).toBeLessThan(10_000) }
    const wide = spawnSync('python3', ['-c', 'import sys; from PIL import Image; print(Image.open(sys.argv[1]).size[0])', join(out, 'thumbs', jpgs[0])], { encoding: 'utf8' }); expect(wide.stdout.trim()).toBe('160')
    expect(existsSync(join(src, 'clip.0000.jpg'))).toBe(false)   // nothing is written into the frame folder
    const again = runPy(src, out)   // idempotent: the five that exist are skipped
    expect(again.stdout).toMatch(/DONE ok=0 skipped=5 failed=1/)
    rmSync(join(out, 'thumbs'), { recursive: true, force: true })   // previews made before the thumbnail tier existed: a re-run adds the thumbnails from the JPEGs and rewrites nothing else
    const before = statSync(join(out, jpgs[0])).mtimeMs
    expect(runPy(src, out).stdout).toMatch(/DONE ok=0 skipped=5 failed=1/)
    expect(readdirSync(join(out, 'thumbs')).sort()).toEqual(jpgs); expect(statSync(join(out, jpgs[0])).mtimeMs).toBe(before)
    expect(runPy(src, out, 'gamma26', '0').stdout).toMatch(/DONE ok=5 skipped=0 failed=1/)   // Skip Existing unticked: made again, replaced
    for (const tone of ['linear', 'none']) expect(runPy(src, join(d, 'o-' + tone), tone).stdout).toMatch(/DONE ok=5 skipped=0 failed=1/)
  }, 60_000)
  it.runIf(hasPy && hasFfmpeg)('posters: the first frame of each video becomes a 320 px JPEG under posters/, finished ones are skipped, a broken video is a FAIL line, and a video is never touched', () => {
    const d = scratch('framepreviews-posters'), src = join(d, 'vids'), out = join(d, '.previews', 'vids', 'posters'); mkdirSync(src)
    expect(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x48:rate=5', '-pix_fmt', 'yuv420p', join(src, 'a.mp4')]).status).toBe(0)
    writeFileSync(join(src, 'bad.mp4'), 'not a video'); writeFileSync(join(src, 'notes.txt'), 'x')
    const run = (skip = '1') => spawnSync('python3', ['-', src, out, 'gamma26', skip], { input: fp.POSTER_PY, encoding: 'utf8' })
    const r = run()
    expect(r.stdout).toMatch(/TOTAL 2/); expect(r.stdout).toMatch(/FAIL bad\.mp4\.jpg /); expect(r.stdout).toMatch(/DONE ok=1 skipped=0 failed=1/); expect(r.status).toBe(0)
    expect(readdirSync(out)).toEqual(['a.mp4.jpg']); expect(statSync(join(out, 'a.mp4.jpg')).size).toBeGreaterThan(100)
    expect(readdirSync(src).sort()).toEqual(['a.mp4', 'bad.mp4', 'notes.txt'])   // nothing is written into the video folder
    expect(run().stdout).toMatch(/DONE ok=0 skipped=1 failed=1/)
    const none = join(d, 'empty'); mkdirSync(none)
    const e = spawnSync('python3', ['-', none, join(d, 'o'), 'gamma26', '1'], { input: fp.POSTER_PY, encoding: 'utf8' }); expect(e.status).toBe(2)
  }, 60_000)
  it('an item of kind posters runs the poster script into <previews>/posters; list() returns the poster names', async () => {
    const seen: string[] = []
    fp.setDeps({ target: async () => ({ host: 'h', port: 22 }), outputDir: () => '/o', ssh: async ({ script, onLine }) => { seen.push(script); for (const l of ['TOTAL 1', 'PREV 1/1 ok=1 skipped=0 failed=0']) onLine(l); return { code: 0 } } })
    try {
      const j = await fp.start({ pod_id: 'p1', items: [{ src_dir: 'a/vids', kind: 'posters' }, { src_dir: 'a/seq', frames: 1 }] })
      await new Promise((r) => setTimeout(r, 50))
      expect(seen[0]).toContain("'/o/.previews/a/vids/posters'"); expect(seen[0]).toContain('ffmpeg')
      expect(seen[1]).toContain("'/o/.previews/a/seq'"); expect(seen[1]).not.toContain('/posters'); expect(seen[1]).toContain('numpy')
      expect((fp.status({ job_id: j.id }) as { items: { kind?: string }[] }).items[0].kind).toBe('posters')
    } finally { fp.setDeps(null) }
    fp.setDeps({ target: async () => ({ host: 'h', port: 22 }), outputDir: () => '/o', ssh: async ({ onLine }) => { for (const l of ['DIR a/vids', 'NAME x.0000.jpg', 'POSTER main.mp4.jpg']) onLine(l); return { code: 0 } } })
    try { expect((await fp.list({ pod_id: 'p1', items: [{ src_dir: 'a/vids' }], names: true })).previews['a/vids'].posters).toEqual(['main.mp4.jpg']) } finally { fp.setDeps(null) }
  })
  it.runIf(hasPy)('a folder with no frames is an error, not an empty success', () => {
    const d = scratch('framepreviews-empty'), src = join(d, 'src'); mkdirSync(src)
    const r = runPy(src, join(d, 'out')); expect(r.status).toBe(2); expect(r.stdout).toMatch(/ERR no frames/)
  })
  it('a job runs the script per sequence on the pod, counts frames, collects failures, and can be cancelled', async () => {
    const lines: string[] = []
    fp.setDeps({
      target: async () => ({ host: 'h', port: 22 }), outputDir: () => '/workspace/comfy-shared/output',
      ssh: async ({ script, onLine, signal }) => {
        lines.push(script)
        if (/seqB/.test(script)) { onLine('TOTAL 3'); onLine('FAIL x.0001.jpg not a DPX'); onLine('PREV 3/3 ok=2 skipped=0 failed=1'); return { code: 0 } }
        onLine('TOTAL 5'); onLine('PREV 5/5 ok=3 skipped=2 failed=0'); onLine('DONE ok=3 skipped=2 failed=0')
        if (/seqSlow/.test(script)) await new Promise((res) => signal.addEventListener('abort', () => res(null)))
        return { code: 0 }
      },
    })
    try {
      const j = await fp.start({ pod_id: 'p1', items: [{ src_dir: 'a/seqA', frames: 5 }, { src_dir: 'a/seqB' }] })
      for (let i = 0; i < 50 && (fp.status({ job_id: j.id }) as fp.Job).state === 'running'; i++) await new Promise((r) => setTimeout(r, 20))
      const s = fp.status({ job_id: j.id }) as fp.Job
      expect(s.state).toBe('done'); expect([s.done, s.skipped, s.failed.length, s.total]).toEqual([5, 2, 1, 8])
      expect(s.failed[0]).toEqual({ src_dir: 'a/seqB', frame: 'x.0001.jpg', reason: 'not a DPX' })
      expect(lines[0]).toContain("'/workspace/comfy-shared/output/a/seqA' '/workspace/comfy-shared/output/.previews/a/seqA' 'gamma26' '1'")
      const slow = await fp.start({ pod_id: 'p1', items: [{ src_dir: 'a/seqSlow', frames: 5 }] })
      await new Promise((r) => setTimeout(r, 40))
      expect(fp.cancel({ job_id: slow.id }).ok).toBe(true)
      for (let i = 0; i < 50 && (fp.status({ job_id: slow.id }) as fp.Job).state === 'running'; i++) await new Promise((r) => setTimeout(r, 20))
      expect((fp.status({ job_id: slow.id }) as fp.Job).state).toBe('cancelled')
      await expect(fp.start({ pod_id: 'p1', items: [{ src_dir: '../etc' }] })).rejects.toThrow()
      await expect(fp.start({ pod_id: 'p1', items: [{ src_dir: 'a' }], tone: 'sepia' })).rejects.toThrow(/tone/)
    } finally { fp.setDeps(null) }
  })
  it('a pod that is not running answers 409 with the reason and list() reads the counts and names from one listing', async () => {
    fp.setDeps({ target: async () => ({ reason: 'Start the pod: the previews are made on the pod' }) })
    await expect(fp.start({ pod_id: 'p1', items: [{ src_dir: 'a' }] })).rejects.toMatchObject({ status: 409 })
    fp.setDeps({
      target: async () => ({ host: 'h', port: 22 }), outputDir: () => '/o',
      ssh: async ({ onLine }) => { for (const l of ['DIR a/x', 'NAME x.0000.jpg', 'NAME x.0001.jpg', 'THUMB x.0000.jpg', 'DIR a/y', 'NAME y.0000.jpg']) onLine(l); return { code: 0 } },
    })
    try {
      const r = await fp.list({ pod_id: 'p1', items: [{ src_dir: 'a/x' }, { src_dir: 'a/y' }], names: true })
      expect(r.previews).toEqual({ 'a/x': { count: 2, names: ['x.0000.jpg', 'x.0001.jpg'], thumbs: ['x.0000.jpg'] }, 'a/y': { count: 1, names: ['y.0000.jpg'], thumbs: [] } })   // thumbs: which of them also have a thumbnail
      expect(r.subfolders['a/x']).toBe('.previews/a/x')
    } finally { fp.setDeps(null) }
  })
})

describe('framepreviews: relaunch', () => {
  const wait = async (id: string) => { for (let i = 0; i < 100 && (fp.status({ job_id: id }) as fp.Job).state === 'running'; i++) await new Promise((r) => setTimeout(r, 15)); return fp.status({ job_id: id }) as fp.Job }
  const pods = (over: Record<string, Partial<fp.PodInfo>> = {}): fp.PodInfo[] => [
    { id: 'p1', name: 'Landing', running: false, volume: 'v1', ...over.p1 }, { id: 'p2', name: 'Top', running: true, volume: 'v1', ...over.p2 },
    { id: 'foreign', name: 'Foreign', running: true, volume: 'v1', ...over.foreign }, { id: 'other', name: 'Other volume', running: true, volume: 'v9', ...over.other },
  ]
  /** a pod where the script dies with 255 on seqB, so the first job fails after seqA finished */
  const fakeSsh = (calls: { pod: string; script: string }[], failOn = 'seqB') => ({
    target: async (id: string) => ({ host: id, port: 22 }), outputDir: () => '/o',
    ssh: async ({ host, script, onLine }: { host: string; script: string; onLine: (l: string) => void }) => {
      calls.push({ pod: host, script })
      if (failOn && script.includes(failOn)) return { code: 255 }
      onLine('TOTAL 4'); onLine('PREV 4/4 ok=4 skipped=0 failed=0'); onLine('DONE ok=4 skipped=0 failed=0'); return { code: 0 }
    },
  })
  it('runs the folders that did not finish, with Skip Existing on and the same tone, and leaves out the folders that finished', async () => {
    const calls: { pod: string; script: string }[] = []
    fp.setDeps({ ...fakeSsh(calls), pods: async () => pods({ p1: { running: true } }) })
    try {
      const j = await wait((await fp.start({ pod_id: 'p1', items: [{ src_dir: 'a/seqA', frames: 4 }, { src_dir: 'a/seqB', frames: 4 }, { src_dir: 'a/seqC', frames: 4 }], tone: 'linear', skip_existing: false })).id)
      expect(j.done_dirs).toEqual(['a/seqA', 'a/seqC'])   // A and C ran clean; B ended with code 255
      expect(j.state).toBe('done'); expect(j.error).toMatch(/code 255 on a\/seqB/)
      calls.length = 0
      fp.setDeps({ ...fakeSsh(calls, ''), pods: async () => pods({ p1: { running: true } }) })
      const r = await fp.relaunch({ job_id: j.id })
      expect(r.ok).toBe(true); expect(r.job!.relaunch_of).toBe(j.id); expect(r.job!.items.map((i) => i.src_dir)).toEqual(['a/seqB'])
      expect(r.job!.skip_existing).toBe(true); expect(r.job!.tone).toBe('linear'); expect(r.job!.pod_id).toBe('p1')   // the old job's pod, it runs
      const done = await wait(r.job!.id)
      expect(done.state).toBe('done'); expect(done.done_dirs).toEqual(['a/seqB'])
      expect(calls.length).toBe(1); expect(calls[0].script).toContain("'linear' '1'")   // never makes a finished frame again
      expect((await fp.relaunch({ job_id: done.id })).nothing_to_do).toBe(true)   // everything finished: nothing to run
    } finally { fp.setDeps(null) }
  })
  it('picks a running pod on the same volume when the old pod is stopped, never an excluded one or one on another volume', async () => {
    const calls: { pod: string; script: string }[] = []
    fp.setDeps({ ...fakeSsh(calls), pods: async () => pods({ p1: { running: true } }) })
    try {
      const j = await wait((await fp.start({ pod_id: 'p1', items: [{ src_dir: 'a/seqB' }] })).id)
      expect(j.done_dirs).toEqual([])
      fp.setDeps({ ...fakeSsh(calls, ''), pods: async () => pods() })   // p1 is stopped now
      const r = await fp.relaunch({ job_id: j.id, exclude_pod_ids: ['foreign'] })
      expect(r.job!.pod_id).toBe('p2')   // not p1 (stopped), not foreign (excluded), not other (another volume)
      await wait(r.job!.id)
      const r2 = await fp.relaunch({ job_id: j.id, pod_id: 'foreign', exclude_pod_ids: ['foreign'] }).catch((e) => e)
      expect(r2.status).toBe(409)   // an excluded pod cannot be asked for either
      const r3 = await fp.relaunch({ job_id: j.id, pod_id: 'other' })
      expect(r3.job!.pod_id).toBe('other'); await wait(r3.job!.id)   // a person's explicit running pod is used
    } finally { fp.setDeps(null) }
  })
  it('answers needs_pod, naming the stopped pods, when none is running, and never starts or resumes one', async () => {
    const calls: { pod: string; script: string }[] = []
    fp.setDeps({ ...fakeSsh(calls), pods: async () => pods({ p1: { running: true } }) })
    try {
      const j = await wait((await fp.start({ pod_id: 'p1', items: [{ src_dir: 'a/seqB' }] })).id)
      let resumed = 0
      fp.setDeps({ ...fakeSsh(calls, ''), pods: async () => pods({ p2: { running: false }, foreign: { running: false }, other: { running: false } }) })
      const before = calls.length
      const r = await fp.relaunch({ job_id: j.id, exclude_pod_ids: ['foreign'] })
      expect(r.ok).toBe(false); expect(r.job).toBeUndefined()
      expect(r.needs_pod!.stopped.map((p) => p.id).sort()).toEqual(['p1', 'p2'])   // same volume, not the excluded one, not the other volume
      expect(r.needs_pod!.hint).toMatch(/never resumes a pod/); expect(calls.length).toBe(before); expect(resumed).toBe(0)
      const named = await fp.relaunch({ job_id: j.id, pod_id: 'p2' }); expect(named.needs_pod!.stopped).toEqual([{ id: 'p2', name: 'Top' }])
    } finally { fp.setDeps(null) }
  })
  it('refuses a job that is still running and a job it does not know', async () => {
    fp.setDeps({ target: async () => ({ host: 'h', port: 22 }), outputDir: () => '/o', pods: async () => pods(), ssh: async ({ signal }) => { await new Promise((res) => signal.addEventListener('abort', () => res(null))); return { code: 0 } } })
    try {
      const j = await fp.start({ pod_id: 'p2', items: [{ src_dir: 'a/seqSlow' }] })
      await expect(fp.relaunch({ job_id: j.id })).rejects.toMatchObject({ status: 409 })
      fp.cancel({ job_id: j.id }); await wait(j.id)
      await expect(fp.relaunch({ job_id: 'framepreviews-nope' })).rejects.toMatchObject({ status: 404 })
    } finally { fp.setDeps(null) }
  })
})
