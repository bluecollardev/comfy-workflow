import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as chunking from '../src/chunking.js'
import { scratch } from './helpers.js'
import * as mounts from '../src/mounts.js'
import { mountsFile } from '../src/paths.js'
import * as podpull from '../src/podpull.js'
import * as pods from '../src/pods.js'
import * as rp from '../src/runpod.js'
import * as settings from '../src/settings.js'
import * as sync from '../src/sync.js'

// The proof against RunPod for chunked runs and the RAM guard (docs/CHUNKING.md): one real pod with the stock image, a 12-frame sequence of 64x64 DPX
// files written on it, run as 3 chunks of 4. Costs a few minutes of the cheapest card. Runs only with RUNPOD_LIVE=1 (`./start.sh chunk-live`, which loads
// RUNPOD_API_KEY from .env). It never pushes memory anywhere near a limit: the guard is proved by giving it a limit of 0.1%, below what an idle container holds, not by using RAM.
const LIVE = !!process.env.RUNPOD_LIVE
describe.skipIf(!LIVE)('chunked runs on a real pod', () => {
  let podId = ''
  // the pod is always deleted, and a dropped connection (`fetch failed`) is retried: a pod left behind bills
  afterAll(async () => {
    if (!podId || process.env.RUNPOD_LIVE_KEEP) return
    for (let n = 1; n <= 8; n++) {
      try { await pods.remove(podId); return } catch (e) { console.error(`delete ${podId}, try ${n}: ${(e as Error).message}`); await new Promise((r) => setTimeout(r, 15_000)) }
    }
    console.error(`!!! pod ${podId} was NOT deleted: delete it in the app`)
  }, 300_000)

  const ssh = async (script: string): Promise<string[]> => {
    const { host, port } = sync.sshTarget((await rp.getPod(podId))!)
    const lines: string[] = []
    const { code } = await podpull.runSsh({ host, port, script, onLine: (l) => lines.push(l), signal: AbortSignal.timeout(120_000) })
    if (code) throw new Error(`ssh exited ${code}: ${lines.join(' | ')}`)
    return lines
  }

  it('makes a pod, reads its container memory, runs 3 chunks, and the guard stops a run when the limit is low', async () => {
    // This test saves a configuration and makes a pod. It must never touch the app's real Default Configuration (a run once did, by being started
    // without the core suite's setup file): work in a scratch config directory, and refuse to go on if that did not happen.
    scratch()
    expect(process.env.POD_MANAGER_CONFIG_DIR, 'the live test would use the real configuration directory').not.toBe(join(homedir(), '.config', 'runpod-pod-manager'))
    expect(mountsFile(), 'the live test would write the real mounts.json').not.toContain(join('.config', 'runpod-pod-manager'))
    // the key: the environment, else the app's own settings (the test's config directory is a scratch one, so look in the real one for it, read-only)
    if (!process.env.RUNPOD_API_KEY) {
      const was = process.env.SETTINGS_ENV_FILE
      process.env.SETTINGS_ENV_FILE = join(homedir(), '.config', 'runpod-pod-manager', '.env')
      try { const k = settings.lookup('RUNPOD_API_KEY'); if (k) process.env.RUNPOD_API_KEY = k } finally { if (was === undefined) delete process.env.SETTINGS_ENV_FILE; else process.env.SETTINGS_ENV_FILE = was }
    }
    expect(process.env.RUNPOD_API_KEY, 'no RUNPOD_API_KEY in the environment, .env or the app settings').toBeTruthy()
    // the image is private (ghcr.io): the pod needs RunPod's saved registry login, the Default Configuration's Registry auth ID. This test's config is a scratch one, so
    // take it from RUNPOD_REGISTRY_AUTH_ID or from the app's own Default Configuration; with neither, stop BEFORE a pod is made (it would sit unable to pull, and bill).
    let registry = process.env.RUNPOD_REGISTRY_AUTH_ID || ''
    if (!registry) { try { registry = JSON.parse(readFileSync(join(homedir(), '.config', 'runpod-pod-manager', 'mounts.json'), 'utf8')).registry_auth_id || '' } catch { /* none */ } }
    expect(registry, 'no registry login: set RUNPOD_REGISTRY_AUTH_ID, or the Registry auth ID in Default Configuration (the image is private)').toBeTruthy()
    const cfg = mounts.defaults(); cfg.dry_run = false; cfg.registry_auth_id = registry; mounts.save(cfg)
    const made = await pods.create({ name: 'Live-Chunking', gpu: 'auto', instance_type: 'on-demand', idle_stop_minutes: 10, apply_mounts: false })
    podId = made.id
    console.log(`live chunking: pod ${podId}`)

    // running, with ComfyUI answering
    let base = ''
    const t0 = Date.now()
    let lastLog = 0
    for (;;) {
      const p = await pods.get(podId).catch((e) => { console.error(`pod poll: ${(e as Error).message}`); return null })   // a dropped connection is not a failed pod
      let stats: number | string = '-'
      if (p && p.status === 'running' && p.web_ui_url) {
        base = p.web_ui_url.replace(/\/$/, '')
        const r = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(15_000) }).catch((e) => ({ status: `${(e as Error).message}` }))
        stats = r.status
        if (stats === 200) break
      }
      if (Date.now() - lastLog > 45_000) { lastLog = Date.now(); console.log(`live chunking: ${Math.round((Date.now() - t0) / 1000)}s  status=${p?.status ?? '?'}  url=${p?.web_ui_url ?? '-'}  system_stats=${stats}`) }
      if (Date.now() - t0 > 20 * 60_000) throw new Error(`the pod did not come up with ComfyUI in 20 minutes (status ${p?.status ?? '?'}, system_stats ${stats})`)
      await new Promise((r) => setTimeout(r, 10_000))
    }
    console.log(`live chunking: ComfyUI answered after ${Math.round((Date.now() - t0) / 1000)}s`)

    // 1. the pod's own container memory, over SSH: a real cgroup reading
    const ram = await chunking.readRam(podId)
    expect(ram, 'the pod reported no container memory limit').not.toBeNull()
    expect(ram!.limit).toBeGreaterThan(2 ** 30); expect(ram!.pct).toBeGreaterThan(0); expect(ram!.pct).toBeLessThan(50)   // an idle pod: nowhere near full
    console.log(`live chunking: container RAM ${chunking.gib(ram!.used)} of ${chunking.gib(ram!.limit)} (${ram!.pct}%), ${ram!.source}`)

    // 2. twelve tiny frames (64x64), named by number, where BH_ReadSequence reads them
    const out = await ssh(`mkdir -p /tmp/chunkproof && cd /tmp/chunkproof && rm -f *.dpx && $(command -v python3 || command -v python) - <<'PY'
import numpy as np, OpenImageIO as oiio
for n in range(1, 13):
    px = np.full((64, 64, 3), n / 20.0, dtype=np.float32)
    o = oiio.ImageOutput.create('/tmp/chunkproof/f.%04d.dpx' % n); s = oiio.ImageSpec(64, 64, 3, 'uint16'); o.open('/tmp/chunkproof/f.%04d.dpx' % n, s); o.write_image(px); o.close()
print('FRAMES', len(__import__('os').listdir('/tmp/chunkproof')))
PY`)
    expect(out.join('\n')).toContain('FRAMES 12')

    const graph = () => ({
      '1': { class_type: 'BH_ReadSequence', inputs: { folder: '/tmp/chunkproof', pattern: 'f.*.dpx', first_index: 0, count: 0, proxy_scale: 1, encoding: 'linear (no conversion)', ref_white: 685, ref_black: 95, gamma: 0.6 } },
      '2': { class_type: 'BincSeqToImage', inputs: { seq: ['1', 0], first_frame: 1, last_frame: 1 } },
      '3': { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: 'chunkproof' } },
    })
    const finish = async (id: string) => { for (let n = 0; n < 600; n++) { const j = chunking.job(id)!; if (j.state !== 'running') return j; await new Promise((r) => setTimeout(r, 1000)) } throw new Error('the chunked run did not finish in 10 minutes') }

    // 3. three chunks of four, in order, with the memory read between them
    const ok = await finish((await chunking.run(podId, { graph: graph(), first: 1, last: 12, chunk: 4, guardEveryMs: 2000 })).id)
    expect(ok.error, ok.error).toBeUndefined(); expect(ok.state).toBe('done'); expect(ok.ok).toBe(3); expect(ok.unit).toBe('frame')
    expect(ok.chunks.map((c) => [c.first, c.last, c.state])).toEqual([[1, 4, 'done'], [5, 8, 'done'], [9, 12, 'done']])
    expect(ok.ram?.peak_pct).toBeLessThan(50); expect(ok.ram_note).toBeUndefined()
    const saved = await ssh(`ls /workspace/comfy-shared/output /opt/ComfyUI/output 2>/dev/null | grep -c chunkproof || true`)
    expect(Number(saved.join('').trim().split('\n').pop())).toBe(12)   // 3 chunks x 4 frames, each a saved image

    // 4. the guard: a limit of 0.1% (an idle container holds about 0.8%) trips on the first reading, long before any real pressure; the run stops with the frame to resume from
    const stopped = await finish((await chunking.run(podId, { graph: graph(), first: 1, last: 12, chunk: 4, ramGuardPct: 0.1, guardEveryMs: 0 })).id)
    expect(stopped.state).toBe('stopped'); expect(stopped.error).toMatch(/RAM guard/)
    expect(stopped.chunks.some((c) => c.state === 'skipped')).toBe(true)   // it did not go on to the end
  }, 40 * 60_000)
})
