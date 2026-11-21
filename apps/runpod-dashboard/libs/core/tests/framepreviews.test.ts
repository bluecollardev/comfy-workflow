import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as fp from '../src/framepreviews.js'
import { scratch } from './helpers.js'

const hasPy = spawnSync('python3', ['-c', 'import numpy, PIL']).status === 0

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
    expect(readdirSync(out).sort()).toEqual([0, 1, 2, 3, 4].map((i) => `clip.${String(i).padStart(4, '0')}.jpg`))
    for (const f of readdirSync(out)) { const s = statSync(join(out, f)).size; expect(s).toBeGreaterThan(100); expect(s).toBeLessThan(30_000) }
    expect(existsSync(join(src, 'clip.0000.jpg'))).toBe(false)   // nothing is written into the frame folder
    const again = runPy(src, out)   // idempotent: the five that exist are skipped
    expect(again.stdout).toMatch(/DONE ok=0 skipped=5 failed=1/)
    expect(runPy(src, out, 'gamma26', '0').stdout).toMatch(/DONE ok=5 skipped=0 failed=1/)   // Skip Existing unticked: made again, replaced
    for (const tone of ['linear', 'none']) expect(runPy(src, join(d, 'o-' + tone), tone).stdout).toMatch(/DONE ok=5 skipped=0 failed=1/)
  }, 60_000)
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
      ssh: async ({ onLine }) => { for (const l of ['DIR a/x', 'NAME x.0000.jpg', 'NAME x.0001.jpg', 'DIR a/y', 'NAME y.0000.jpg']) onLine(l); return { code: 0 } },
    })
    try {
      const r = await fp.list({ pod_id: 'p1', items: [{ src_dir: 'a/x' }, { src_dir: 'a/y' }], names: true })
      expect(r.previews).toEqual({ 'a/x': { count: 2, names: ['x.0000.jpg', 'x.0001.jpg'] }, 'a/y': { count: 1, names: ['y.0000.jpg'] } })
      expect(r.subfolders['a/x']).toBe('.previews/a/x')
    } finally { fp.setDeps(null) }
  })
})
