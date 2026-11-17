import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './app.js'

// The s3file:// protocol (docs/ADR-045): a volume's output files with no pod. No network here: the guard refuses before anything is fetched, and with no S3 keys
// the answer is a clear status, never a crash. The volume is "known" because a saved run names it.
const VOL = 'testvol123'
const O = 'comfy-shared/output'
test.describe('s3file:// in the real app', () => {
  let ctx
  test.beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runpod-manager-s3file-')), f = join(dir, 'output-runs.json')
    writeFileSync(f, JSON.stringify({ runs: [{ prompt_id: 'p1', workflow: null, started_at: '2026-11-17T09:00:00Z', duration_s: 1, pod_id: 'pod1', pod_name: 'x', volume_id: VOL, datacenter: 'EU-RO-1', recorded_at: '2026-11-17T09:00:00Z', files: [{ filename: 'a.png', subfolder: 's', type: 'output' }] }] }))
    ctx = await launchApp({ dry: true, env: { OUTPUT_RUNS_FILE: f, RUNPOD_S3_ACCESS_KEY: '', RUNPOD_S3_SECRET_KEY: '' } })
  })
  test.afterAll(async () => { await ctx.app.close() })

  const get = (page, url, init) => page.evaluate(async ([u, i]) => { try { const r = await fetch(u, i); return { status: r.status, text: (await r.text()).slice(0, 300) } } catch (e) { return { error: String(e) } } }, [url, init])
  const addr = (vol, key) => `s3file://${vol}/${encodeURIComponent(key)}`

  test('a key outside comfy-shared/output/ is a 403, whatever the volume', async () => {
    for (const key of ['comfy-shared/models/x.safetensors', 'comfy-shared/workflows/r/a.json', `${O}/../models/x`, `${O}/a/../../x`]) {
      const r = await get(ctx.page, addr(VOL, key)); expect(r.status, key).toBe(403)
    }
  })
  test('another volume and a write are refused', async () => {
    expect((await get(ctx.page, addr('someothervol', `${O}/a.png`))).status).toBe(403)
    expect((await get(ctx.page, addr(VOL, `${O}/a.png`), { method: 'PUT', body: 'x' })).status).toBe(405)
    expect((await get(ctx.page, addr(VOL, `${O}/a.png`), { method: 'DELETE' })).status).toBe(405)
  })
  test('a key under output with no S3 keys set answers a clear 409 naming the keys, and never a presigned URL', async () => {
    const r = await get(ctx.page, addr(VOL, `${O}/p/a.dpx`))
    expect(r.status).toBe(409); expect(r.text).toMatch(/S3_ACCESS_KEY/); expect(r.text).not.toMatch(/Authorization|X-Amz|https?:/)
    const read = await ctx.page.evaluate(async (u) => window.core.files.read(u), addr(VOL, `${O}/p/a.dpx`)).catch((e) => ({ thrown: String(e) }))
    expect(JSON.stringify(read)).not.toMatch(/X-Amz/)
  })
})
