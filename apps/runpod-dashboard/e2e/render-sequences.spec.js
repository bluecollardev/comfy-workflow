import fs from 'node:fs'
import { test, expect, podCard, answerConfirm } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'
import { t } from './i18n'

// Render sequences (docs/ADR-048): the option in the Previews window, the tile badges, and the viewer playing the proxy. The core is faked (state.renders in e2e/fixtures.js).
const WEBM = fs.readFileSync(new URL('./media/tiny.webm', import.meta.url))   // 2 s, 64x48, 24 fps
const A = 'ARCHIVAL-085_MAIN_FINAL_V03_3840X2160_23.976_PRORES422HQ', B = 's2_proxy', C = 's3_proxy'
const frame = (name, n) => `${name}.${String(n).padStart(4, '0')}.dpx`
const run = (seqs) => ({ prompt_id: 'rrrrrrrr-1111-2222', workflow: 'rounds/r1/render.json', status: 'success', started_at: '2026-11-18T10:00:00Z', duration_s: 5, cost_estimate: 0,
  outputs: seqs.flatMap(([name, sub, n]) => Array.from({ length: n }, (_, k) => ({ filename: frame(name, k), subfolder: sub, type: 'output' }))) })
const SEQS = [[A, 'seqs/a', 3], [B, 'seqs/b', 3], [C, 'seqs/c', 3]]
const px = makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const key = (sub, name) => `${sub}/${name}`

/** Serves the DPX frames and, for .mp4 names, the tiny movie (with Range, as the pod's ComfyUI); local proxies are http://proxy.test/... */
async function serve(page) {
  const movie = (r, body) => {
    const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || ''), h = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' }
    if (!range) return r.fulfill({ status: 200, contentType: 'video/webm', headers: h, body })
    const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
    return r.fulfill({ status: 206, contentType: 'video/webm', headers: { ...h, 'content-range': `bytes ${a}-${b}/${body.length}` }, body: body.subarray(a, b + 1) })
  }
  await page.context().route('**/view?*', (r) => { const f = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1]); return /\.mp4$/.test(f) ? movie(r, WEBM) : r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }) })
  await page.context().route('http://proxy.test/**', (r) => movie(r, WEBM))
}
async function openOutputs(page, api, { seqs = SEQS, renders } = {}) {
  api.state.history.runs['pod-aaaaaaaa'].unshift(run(seqs))
  if (renders) api.state.renders = renders
  await serve(page)
  await page.addInitScript(() => { try { indexedDB.deleteDatabase('pod-manager-thumbs') } catch { /* none */ } })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(seqs.length)
  return m
}
const previews = (page) => page.getByTestId('pod-outputs-previews-modal')
async function openPreviews(page) { await page.getByTestId('pod-outputs-previews').click(); const p = previews(page); await expect(p.getByTestId('pod-outputs-render')).toBeVisible(); return p }
const planText = (p) => p.getByTestId('pod-outputs-render-plan')
const tile = (m, name) => m.locator(`[data-testid="outputs-tile"][title="${name}.####.dpx"]`)
const noPod = { pod: { ok: false, reason: 'Start the pod: rendering happens on the pod' }, local: { ok: true } }
const noFfmpeg = { code: 'no_ffmpeg', ok: false, reason: 'ffmpeg is not installed on this PC. Install it with Homebrew: brew install ffmpeg (Homebrew itself: https://brew.sh), then try again.', install_hint: 'brew install ffmpeg' }

test('Render option: the plan line, the defaults, and the plan request (width, per-sequence fps from the name, where)', async ({ page, api }) => {
  await openOutputs(page, api, { renders: { missing: {}, remote: { [key('seqs/b', B)]: true } } })
  const p = await openPreviews(page)
  await expect(planText(p)).toHaveText('3 sequences · 9 frames · rendered on the pod · 2 to render · 1 already done (skipped)')
  await expect(p.getByTestId('pod-outputs-render-width')).toHaveValue('source')   // IMAX 4K by default
  await expect(p.getByTestId('pod-outputs-render-downscale-hint')).toHaveCount(0)
  await expect(p.getByTestId('pod-outputs-render-fps')).toHaveValue('auto')
  await expect(p.getByTestId('pod-outputs-render-where')).toHaveValue('auto')
  await expect(p.getByTestId('pod-outputs-render-pull')).toBeChecked()
  await expect(p.getByTestId('pod-outputs-render-kind-proxy')).toBeChecked()
  const last = api.state.renders.planned.at(-1)
  expect(last.pod_id).toBe('pod-aaaaaaaa'); expect(last.width).toBe('source'); expect(last.where).toBe('auto')
  const byName = Object.fromEntries(last.sequences.map((s) => [s.name, s]))
  expect(byName[A]).toMatchObject({ dir: 'seqs/a', first: 0, last: 2, frames: 3, pad: 4, fps: 23.976 })   // from _23.976_ in the name
  expect(byName[B].fps).toBe(24)   // no rate in the name
  await expect(p.getByTestId('pod-outputs-render-width').locator('option')).toHaveText(['Source resolution (3840 x 2160)', 'HD (1920 px)', 'Medium (1280 px)', 'Small (960 px)'])
  await p.getByTestId('pod-outputs-render-width').selectOption('1920')
  await expect.poll(() => api.state.renders.planned.at(-1).width).toBe(1920)
  await expect(p.getByTestId('pod-outputs-render-downscale-hint')).toHaveText('Smaller files play faster; source resolution keeps the full 4K.')
  await expect(p.getByTestId('pod-outputs-render-fps').locator('option')).toHaveText(['Auto (from the name, else 24)', '23.976 fps', '24 fps', '25 fps', '30 fps'])
  await expect(p.getByTestId('pod-outputs-render-where').locator('option')).toHaveText([/Auto \(pod if running, else this PC\)/, /On the pod/, /On this PC/])
})

test('Render option: wording says Proxy, never calls it final or a delivery file, and the Load all previews option is still there', async ({ page, api }) => {
  await openOutputs(page, api)
  const p = await openPreviews(page)
  await expect(p.getByTestId('pod-outputs-load-previews')).toBeVisible()
  const text = (await p.getByTestId('pod-outputs-render').innerText()).replace(t('outputs.render.kindReview'), '').replaceAll(A, '')   // (the clip names are file names)
  expect(text).toMatch(/proxy/i); expect(text).not.toMatch(/final|delivery file|not a deliverable/i)
})

test('Adapters: availability lines with reasons; Auto with the pod stopped uses this PC; an explicit pod is refused with the pod reason; Auto is refused only when both fail', async ({ page, api }) => {
  await openOutputs(page, api, { renders: { adapters: noPod } })
  const p = await openPreviews(page)
  await expect(p.locator('[data-testid="pod-outputs-render-adapter"][data-id="pod"]')).toHaveAttribute('data-ok', 'false')
  await expect(p.locator('[data-testid="pod-outputs-render-adapter"][data-id="pod"]')).toContainText('Start the pod: rendering happens on the pod')
  await expect(p.locator('[data-testid="pod-outputs-render-adapter"][data-id="local"]')).toHaveAttribute('data-ok', 'true')
  await expect(planText(p)).toContainText('rendered on this PC')   // Auto: the pod cannot, this PC can
  await expect(p.getByTestId('pod-outputs-render-start')).toBeEnabled()
  await p.getByTestId('pod-outputs-render-where').selectOption('pod')
  await expect(p.getByTestId('pod-outputs-render-warning')).toContainText('Start the pod: rendering happens on the pod')
  await expect(p.getByTestId('pod-outputs-render-start')).toBeDisabled()
  api.state.renders.adapters = { pod: { ok: false, reason: 'Start the pod: rendering happens on the pod' }, local: { ok: false, reason: 'The frames are not on this PC yet: sync the outputs first, or render on the pod' } }
  await p.getByTestId('pod-outputs-render-where').selectOption('auto')
  await expect(p.getByTestId('pod-outputs-render-warning')).toHaveCount(2)
  await expect(p.getByTestId('pod-outputs-render-warning').nth(1)).toContainText('The frames are not on this PC yet')
  await expect(p.getByTestId('pod-outputs-render-start')).toBeDisabled()
})

test('Start: the request carries the sequences, width, fps, pull; unticking sends pull false; a fixed fps goes in the request', async ({ page, api }) => {
  await openOutputs(page, api)
  const p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-start').click()
  await expect.poll(() => api.state.renders.started.length).toBe(1)
  const a = api.state.renders.started[0]
  expect(a).toMatchObject({ pod_id: 'pod-aaaaaaaa', width: 'source', where: 'auto', pull: true, kind: 'proxy' })
  expect(a.fps).toBeUndefined(); expect(a.sequences.map((s) => s.name)).toEqual([A, B, C]); expect(a.sequences[0]).toMatchObject({ dir: 'seqs/a', first: 0, last: 2, frames: 3, pad: 4 })
  await p.getByTestId('pod-outputs-render-stop').click()
  await expect.poll(() => api.state.renders.cancelled.length).toBe(1)
  await p.getByTestId('pod-outputs-render-pull').uncheck()
  await p.getByTestId('pod-outputs-render-fps').selectOption('25')
  await p.getByTestId('pod-outputs-render-start').click()
  await expect.poll(() => api.state.renders.started.length).toBe(2)
  expect(api.state.renders.started[1]).toMatchObject({ pull: false, fps: 25 }); expect(api.state.renders.started[1].sequences.every((s) => s.fps === 25)).toBe(true)
})

test('Local: Where = On this PC sends where local with no pod_id and no pull, hides the sync box; the rows show a where badge', async ({ page, api }) => {
  await openOutputs(page, api, { renders: { adapters: noPod } })
  const p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-where').selectOption('local')
  await expect(p.getByTestId('pod-outputs-render-pull')).toHaveCount(0)
  await p.getByTestId('pod-outputs-render-start').click()
  await expect.poll(() => api.state.renders.started.length).toBe(1)
  const a = api.state.renders.started[0]
  expect(a.where).toBe('local'); expect(a.pod_id).toBeUndefined(); expect(a.pull).toBeUndefined()
  await expect(p.getByTestId('pod-outputs-render-seq').first().getByTestId('pod-outputs-render-seq-where')).toHaveText('this PC')
})

test('Progress: numbers and percent, per-sequence states with the error, a Syncing phase, Stop, the button status, then the summary', async ({ page, api }) => {
  const m = await openOutputs(page, api)
  const p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-start').click()
  await expect(p.getByTestId('pod-outputs-render-job')).toBeVisible()
  const j = api.state.renders.jobs[0]
  Object.assign(j, { frames_total: 412, frames_done: 140, rate_fps: 9.2, state: 'rendering' })
  j.sequences[0].state = 'rendered'; j.sequences[1].state = 'rendering'; j.sequences[1].frames_done = 40; j.sequences[1].frames_total = 100; j.sequences[2].state = 'failed'; j.sequences[2].error = 'ffmpeg failed (exit 1)'
  await expect(p.getByTestId('pod-outputs-render-status')).toHaveText('sequence 2 of 3 · frame 140 of 412 · 9 fps', { timeout: 6000 })
  await expect(p.getByTestId('pod-outputs-render-progress')).toHaveAttribute('data-percent', '34')
  await expect(p.getByTestId('pod-outputs-render-seq').nth(0)).toHaveAttribute('data-state', 'rendered')
  await expect(p.getByTestId('pod-outputs-render-seq').nth(1).getByTestId('pod-outputs-render-seq-state')).toHaveText('rendering 40 / 100')
  await expect(p.getByTestId('pod-outputs-render-seq').nth(2)).toHaveAttribute('data-state', 'failed')
  await expect(p.getByTestId('pod-outputs-render-seq-error')).toHaveText('ffmpeg failed (exit 1)')
  await expect(page.getByTestId('pod-outputs-render-button-status')).toHaveText('· Rendering 140 of 412')   // on the Previews button
  Object.assign(j, { state: 'pulling', frames_done: 412, pulled_files: 2, pulled_bytes: 3e6 })
  await expect(p.getByTestId('pod-outputs-render-syncing')).toContainText('Syncing to this PC', { timeout: 6000 })
  await expect(page.getByTestId('pod-outputs-render-button-status')).toHaveText('· Syncing to this PC')
  Object.assign(j, { state: 'done', finished_at: 'now', summary: '2 sequences rendered, 1 failed; 2 files synced (3 MB)' })
  await expect(p.getByTestId('pod-outputs-render-summary')).toHaveText('2 sequences rendered, 1 failed; 2 files synced (3 MB)', { timeout: 6000 })
  await expect(p.getByTestId('pod-outputs-render-stop')).toHaveCount(0)
  await expect(page.getByTestId('pod-outputs-render-button-status')).toHaveCount(0)
  await expect(p.getByTestId('pod-outputs-render-start')).toBeEnabled()
  void m
})

test('Closing the Previews window and the Outputs window mid-job loses nothing: reopening shows the job, which kept polling', async ({ page, api }) => {
  await openOutputs(page, api)
  let p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-start').click()
  await expect(p.getByTestId('pod-outputs-render-job')).toBeVisible()
  await previews(page).locator('.modal-footer button').click(); await expect(previews(page)).toBeHidden()
  await page.getByTestId('pod-outputs-modal').locator('.btn-close').click(); await expect(page.getByTestId('pod-outputs-modal')).toBeHidden()
  Object.assign(api.state.renders.jobs[0], { frames_total: 9, frames_done: 4 })
  await page.waitForTimeout(1500)   // the store polls with every window closed
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await expect(page.getByTestId('pod-outputs-render-button-status')).toHaveText('· Rendering 4 of 9')
  p = await openPreviews(page)
  await expect(p.getByTestId('pod-outputs-render-job')).toHaveAttribute('data-state', 'rendering')
  await expect(p.getByTestId('pod-outputs-render-progress')).toHaveAttribute('data-percent', '44')
  await expect(p.getByTestId('pod-outputs-render-stop')).toBeVisible()
  await expect(p.getByTestId('pod-outputs-render-start')).toBeDisabled()   // one job at a time
})

test('Tile badges: On this PC, Rendered (volume only), none; one batched proxies call for the window; Partial badge', async ({ page, api }) => {
  const m = await openOutputs(page, api, { renders: { proxies: { [key('seqs/a', A)]: { exists_local: true, local_url: 'http://proxy.test/a.webm', width: 1280, partial: true }, [key('seqs/b', B)]: { exists_remote: true, remote_ready: true, width: 1280 } } } })
  await expect(tile(m, A).getByTestId('outputs-dpx-rendered')).toHaveAttribute('data-where', 'local')
  await expect(tile(m, A).getByTestId('outputs-dpx-rendered')).toHaveText('On this PC')
  await expect(tile(m, A).getByTestId('outputs-dpx-partial')).toHaveText('Partial')
  await expect(tile(m, B).getByTestId('outputs-dpx-rendered')).toHaveAttribute('data-where', 'remote')
  await expect(tile(m, B).getByTestId('outputs-dpx-rendered')).toHaveText('Rendered')
  await expect(tile(m, B).getByTestId('outputs-dpx-partial')).toHaveCount(0)
  await expect(tile(m, C).getByTestId('outputs-dpx-rendered')).toHaveCount(0)
  expect(api.state.renders.proxyCalls).toHaveLength(1)
  expect(api.state.renders.proxyCalls[0].items).toEqual([{ dir: 'seqs/a', name: A }, { dir: 'seqs/b', name: B }, { dir: 'seqs/c', name: C }])
})

test('A job that ends refreshes the badges', async ({ page, api }) => {
  const m = await openOutputs(page, api)
  await expect(m.getByTestId('outputs-dpx-rendered')).toHaveCount(0)
  const p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-start').click()
  await expect(p.getByTestId('pod-outputs-render-job')).toBeVisible()
  api.state.renders.proxies[key('seqs/c', C)] = { exists_local: true, local_url: 'http://proxy.test/c.webm', width: 1280 }
  Object.assign(api.state.renders.jobs[0], { state: 'done', finished_at: 'now' })
  await expect(tile(m, C).getByTestId('outputs-dpx-rendered')).toHaveAttribute('data-where', 'local', { timeout: 8000 })
  expect(api.state.renders.proxyCalls.length).toBe(2)
})

test('Viewer: with a local proxy it opens in Rendered mode (a <video> on the local_url), Full resolution goes to the frames and back', async ({ page, api }) => {
  const m = await openOutputs(page, api, { renders: { proxies: { [key('seqs/b', B)]: { exists_local: true, local_url: 'http://proxy.test/b.webm', width: 1280 } } } })
  await tile(m, B).click()
  const v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-video')).toHaveAttribute('src', 'http://proxy.test/b.webm')
  await expect(v.getByTestId('dpx-viewer-rendered-badge')).toHaveText('Proxy 1280 px · on this PC')
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveCount(0)
  await expect(v.getByTestId('dpx-viewer-render-hint')).toHaveCount(0)
  await expect.poll(() => v.getByTestId('dpx-viewer-video').evaluate((e) => e.readyState)).toBeGreaterThanOrEqual(2)
  await v.getByTestId('dpx-viewer-rendered-play').click(); await expect(v.getByTestId('dpx-viewer-rendered-play')).toHaveAttribute('data-playing', 'true')
  await v.getByTestId('dpx-viewer-rendered-play').click()
  await v.getByTestId('dpx-viewer-full').click()
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveAttribute('data-drawn', '0')
  await expect(v.getByTestId('dpx-viewer-video')).toHaveCount(0)
  await expect(v.getByTestId('dpx-viewer-frame')).toContainText('1 / 3')   // the original frames
  await v.getByTestId('dpx-viewer-full').click()
  await expect(v.getByTestId('dpx-viewer-video')).toHaveAttribute('src', 'http://proxy.test/b.webm')
})

test('Viewer: a proxy only on the volume plays from the pod address; its badge says on the volume', async ({ page, api }) => {
  const m = await openOutputs(page, api, { renders: { proxies: { [key('seqs/b', B)]: { exists_remote: true, remote_ready: true, width: 1280 } } } })
  await tile(m, B).click()
  const v = page.getByTestId('dpx-viewer')
  const src = await v.getByTestId('dpx-viewer-video').getAttribute('src')
  expect(src).toContain('/view?'); expect(src).toContain(`filename=${B}_1280.mp4`); expect(decodeURIComponent(src)).toContain('subfolder=.proxies/seqs/b')
  await expect(v.getByTestId('dpx-viewer-rendered-badge')).toHaveText('Proxy 1280 px · on the volume')
  await expect.poll(() => v.getByTestId('dpx-viewer-video').evaluate((e) => e.readyState)).toBeGreaterThanOrEqual(2)
})

test('Viewer: no proxy keeps today\'s frame viewer plus a hint; Render this sequence starts a one-sequence job (kind proxy, where auto)', async ({ page, api }) => {
  const m = await openOutputs(page, api)
  await tile(m, C).click()
  const v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveAttribute('data-drawn', '0')
  await expect(v.getByTestId('dpx-viewer-full')).toHaveCount(0)
  await expect(v.getByTestId('dpx-viewer-render-hint')).toContainText('No proxy movie of this sequence yet')
  await v.getByTestId('dpx-viewer-render-this').click()
  await expect.poll(() => api.state.renders.started.length).toBe(1)
  const a = api.state.renders.started[0]
  expect(a.sequences).toHaveLength(1); expect(a.sequences[0]).toMatchObject({ dir: 'seqs/c', name: C }); expect(a).toMatchObject({ kind: 'proxy', where: 'auto', width: 'source', pod_id: 'pod-aaaaaaaa' })
  await expect(v.getByTestId('dpx-viewer-render-status')).toContainText('Rendering', { timeout: 5000 })
  await expect(v.getByTestId('dpx-viewer-render-this')).toHaveCount(0)
})

test('Viewer: Render this sequence with ffmpeg missing shows the same alert', async ({ page, api }) => {
  const m = await openOutputs(page, api, { renders: { startError: { detail: noFfmpeg.reason, code: 'no_ffmpeg' } } })
  await tile(m, C).click()
  const v = page.getByTestId('dpx-viewer')
  await v.getByTestId('dpx-viewer-render-this').click()
  await expect(v.getByTestId('pod-outputs-render-no-ffmpeg')).toContainText('ffmpeg is missing on this PC')
  await expect(v.getByTestId('pod-outputs-render-brew-command')).toHaveText('brew install ffmpeg')
})

test('23.976: the viewer takes the rate from the name, steps one frame at that rate, and counts the timecode at the true rate', async ({ page, api }) => {
  const m = await openOutputs(page, api, { renders: { proxies: { [key('seqs/a', A)]: { exists_local: true, local_url: 'http://proxy.test/a.webm', width: 1280 } } } })
  await tile(m, A).click()
  const v = page.getByTestId('dpx-viewer'), vid = v.getByTestId('dpx-viewer-video')
  await expect(v.getByTestId('dpx-viewer-rendered-fps')).toHaveValue('23.976')
  await expect.poll(() => vid.evaluate((e) => e.readyState)).toBeGreaterThanOrEqual(2)
  await vid.evaluate((e) => { e.pause(); e.currentTime = 0 })
  await page.keyboard.press('ArrowRight')
  const t1 = await vid.evaluate((e) => e.currentTime)
  expect(t1).toBeGreaterThan(1 / 23.976); expect(t1).toBeLessThan(2 / 23.976)   // one frame of 23.976 fps
  await vid.evaluate((e) => { e.currentTime = 1 })
  await expect(v.getByTestId('dpx-viewer-rendered-frame')).toContainText('00:00:23 /')   // frame 23 of the second, not 24
})

test('Clear rendered sequences: asks first (No does nothing), then shows what was removed; a note says the proxies stay on the volume', async ({ page, api }) => {
  await openOutputs(page, api, { renders: { cleared: { removed: 4, bytes: 2500000 } } })
  const p = await openPreviews(page)
  await expect(p.getByTestId('pod-outputs-render-clear-note')).toContainText('stay on the volume')
  await p.getByTestId('pod-outputs-render-clear').click(); await answerConfirm(page, false)
  expect(api.state.renders.clearCalls).toBe(0)
  await p.getByTestId('pod-outputs-render-clear').click(); expect(await answerConfirm(page, true)).toContain('stay on the volume')
  await expect(p.getByTestId('pod-outputs-render-cleared')).toHaveText('Removed 4 file(s), 3 MB')
  expect(api.state.renders.clearCalls).toBe(1)
})

test('An older core (no renders.*) says to restart, with no error and no badges; the Load all option still works', async ({ page, api }) => {
  api.state.rendersOld = true
  const m = await openOutputs(page, api)
  const p = await openPreviews(page)
  await expect(p.getByTestId('pod-outputs-render-restart')).toHaveText('Restart the app to use Render sequences')
  await expect(p.getByTestId('pod-outputs-render-start')).toHaveCount(0)
  await expect(m.getByTestId('outputs-dpx-rendered')).toHaveCount(0)
  await expect(p.getByTestId('pod-outputs-load-previews')).toBeEnabled()
})

test('ffmpeg missing: auto with the pod ok shows only a quiet note; this PC only shows the alert with the command, Copy puts exactly that on the clipboard, Check again clears it', async ({ page, api, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openOutputs(page, api, { renders: { adapters: { pod: { ok: true }, local: noFfmpeg } } })
  const p = await openPreviews(page)
  await expect(p.getByTestId('pod-outputs-render-no-ffmpeg-note')).toContainText('brew install ffmpeg')
  await expect(p.getByTestId('pod-outputs-render-no-ffmpeg')).toHaveCount(0)
  await expect(p.getByTestId('pod-outputs-render-start')).toBeEnabled()
  await p.getByTestId('pod-outputs-render-where').selectOption('local')
  const alert = p.getByTestId('pod-outputs-render-no-ffmpeg')
  await expect(alert).toContainText('ffmpeg is missing on this PC'); await expect(alert).toContainText('Homebrew')
  await expect(p.getByTestId('pod-outputs-render-brew-command')).toHaveText('brew install ffmpeg')
  await expect(p.getByTestId('pod-outputs-render-start')).toBeDisabled()
  await p.getByTestId('pod-outputs-render-copy-brew').click()
  await expect(p.getByTestId('pod-outputs-render-copy-brew')).toHaveText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('brew install ffmpeg')
  const before = api.state.renders.planned.length
  api.state.renders.adapters.local = { ok: true }   // after brew install
  await p.getByTestId('pod-outputs-render-check-again').click()
  await expect(alert).toHaveCount(0)
  expect(api.state.renders.planned.length).toBeGreaterThan(before)
  await expect(p.getByTestId('pod-outputs-render-start')).toBeEnabled()
})

test('ffmpeg missing and no pod: Auto shows the blocker; a broken ffmpeg shows its reason as is; a start that fails with no_ffmpeg shows the alert', async ({ page, api }) => {
  await openOutputs(page, api, { renders: { adapters: { pod: noPod.pod, local: noFfmpeg } } })
  const p = await openPreviews(page)
  await expect(p.getByTestId('pod-outputs-render-no-ffmpeg')).toHaveAttribute('data-kind', 'missing')
  await expect(p.getByTestId('pod-outputs-render-start')).toBeDisabled()
  api.state.renders.adapters.local = { ok: false, code: 'ffmpeg_broken', reason: 'ffmpeg crashed at start: dyld: Library not loaded' }
  await p.getByTestId('pod-outputs-render-where').selectOption('local')
  await expect(p.getByTestId('pod-outputs-render-check-again')).toBeVisible()
  await p.getByTestId('pod-outputs-render-check-again').click()
  await expect(p.getByTestId('pod-outputs-render-no-ffmpeg')).toHaveAttribute('data-kind', 'broken')
  await expect(p.getByTestId('pod-outputs-render-no-ffmpeg-text')).toHaveText('ffmpeg crashed at start: dyld: Library not loaded')
  await expect(p.getByTestId('pod-outputs-render-brew-command')).toHaveCount(0)
})

test('Incomplete sequences are listed with the missing ranges; Start waits for the partial box; allow_partial is sent; the plan counts complete and incomplete', async ({ page, api }) => {
  await openOutputs(page, api, { renders: { missing: { [key('seqs/b', B)]: [{ from: 101, to: 150 }, { from: 200, to: 200 }] } } })
  const p = await openPreviews(page)
  await expect(p.getByTestId('pod-outputs-render-incomplete')).toHaveText(`${B}: Incomplete: frames 101-150, 200 missing`)
  await expect(planText(p)).toContainText('2 complete · 1 incomplete')
  await expect(p.getByTestId('pod-outputs-render-allow-partial')).not.toBeChecked()
  await expect(p.getByTestId('pod-outputs-render-start')).toBeDisabled()
  await p.getByTestId('pod-outputs-render-allow-partial').check()
  await expect(p.getByTestId('pod-outputs-render-start')).toBeEnabled()
  await p.getByTestId('pod-outputs-render-start').click()
  await expect.poll(() => api.state.renders.started.length).toBe(1)
  expect(api.state.renders.started[0].allow_partial).toBe(true)
})

test('Review video: Kind radio, source-size defaults, codecs, approver required and remembered, incomplete blocks (no partial option), plan shows shot and next version, the request body, estimate and the fixed note', async ({ page, api }) => {
  await openOutputs(page, api, { renders: { nextVersion: 3, missing: { [key('seqs/c', C)]: [{ from: 1, to: 2 }] } } })
  let p = await openPreviews(page)
  await expect(p.getByTestId('pod-outputs-render-review-note')).toHaveCount(0)
  await p.getByTestId('pod-outputs-render-kind-review').check()
  const note = p.getByTestId('pod-outputs-render-review-note')
  await expect(note).toContainText("Spec is not set in Binc's deliverables list"); await expect(note).toContainText('source resolution'); await expect(note).not.toContainText('1920')
  await expect(note).toContainText("never sends deliverables to the client")
  await expect(p.getByTestId('pod-outputs-render-width')).toHaveValue('source')
  await expect(p.getByTestId('pod-outputs-render-width').locator('option').first()).toHaveText('Source resolution (3840 x 2160)')
  await expect(p.getByTestId('pod-outputs-render-codec-prores')).toBeChecked(); await expect(p.getByTestId('pod-outputs-render-codec-h264')).not.toBeChecked()   // ProRes by default
  await expect(p.getByTestId('pod-outputs-render-allow-partial')).toHaveCount(0)
  await expect(p.getByTestId('pod-outputs-render-approved-hint')).toHaveText('Type who says yes to make a review video.')
  await expect(p.getByTestId('pod-outputs-render-incomplete')).toHaveCount(1)
  await expect(p.getByTestId('pod-outputs-render-review-shot').first()).toContainText('archival-085 → v003')
  await expect(p.getByTestId('pod-outputs-render-review-shot').first()).toContainText('output/deliver/archival-085/v003/')
  await expect(p.getByTestId('pod-outputs-render-estimate').first()).toHaveText('slow: expect minutes per 100 frames')
  await p.getByTestId('pod-outputs-render-approved-by').fill('Brynley')
  await expect(p.getByTestId('pod-outputs-render-start')).toBeDisabled()   // C is incomplete and a review takes no partial
  api.state.renders.missing = {}
  await p.getByTestId('pod-outputs-render-width').selectOption('1920'); await p.getByTestId('pod-outputs-render-width').selectOption('source')   // re-plans
  await expect(p.getByTestId('pod-outputs-render-start')).toBeEnabled()
  await p.getByTestId('pod-outputs-render-codec-h264').check()
  await p.getByTestId('pod-outputs-render-start').click()
  await expect.poll(() => api.state.renders.started.length).toBe(1)
  const a = api.state.renders.started[0]
  expect(a).toMatchObject({ kind: 'review', approved_by: 'Brynley', width: 'source', codecs: ['h264', 'prores422hq'], pod_id: 'pod-aaaaaaaa', pull: true }); expect(a.allow_partial).toBeUndefined()
  // no H.264 and no ProRes: nothing to make
  await p.getByTestId('pod-outputs-render-codec-prores').uncheck(); await p.getByTestId('pod-outputs-render-codec-h264').uncheck()
  await expect(p.getByTestId('pod-outputs-render-start')).toBeDisabled()
  // the name is remembered
  await page.reload()
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-kind-review').check()
  await expect(p.getByTestId('pod-outputs-render-approved-by')).toHaveValue('Brynley')
  expect(await page.evaluate(() => localStorage.getItem('runpod-manager.approved-by'))).toBe('Brynley')
})

test('Review video: a finished job names the shot, version, folder and files (the .mov is not playable), and Play opens the viewer on the .mp4; badge and switch come from deliverables', async ({ page, api }) => {
  const del = { shot: 'archival-085', version: 3, file: `output/deliver/archival-085/v003/${A}.mp4`, exists_local: true, exists_remote: false, local_url: 'http://proxy.test/review.webm',
    files: [{ name: `${A}.mp4`, codec: 'h264', bytes: 10, local_url: 'http://proxy.test/review.webm' }, { name: `${A}.mov`, codec: 'prores422hq', bytes: 99 }] }
  const m = await openOutputs(page, api, { seqs: [[A, 'seqs/a', 3]], renders: { deliverables: [del], proxies: { [key('seqs/a', A)]: { exists_local: true, local_url: 'http://proxy.test/a.webm', width: 1280 } } } })
  await expect(tile(m, A).getByTestId('outputs-dpx-review')).toHaveText('Review v003')
  const p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-kind-review').check(); await p.getByTestId('pod-outputs-render-approved-by').fill('Brynley')
  await p.getByTestId('pod-outputs-render-codec-h264').check()
  await p.getByTestId('pod-outputs-render-start').click()
  await expect(p.getByTestId('pod-outputs-render-job')).toBeVisible()
  const j = api.state.renders.jobs[0]
  Object.assign(j, { state: 'done', finished_at: 'now', summary: '1 review video written' }); Object.assign(j.sequences[0], { state: 'rendered', shot: 'archival-085', version: 3, files: del.files })
  const done = p.getByTestId('pod-outputs-render-review-done')
  await expect(done).toContainText('Review video archival-085 v003: output/deliver/archival-085/v003/', { timeout: 6000 })
  await expect(p.getByTestId('pod-outputs-render-review-files')).toContainText(`${A}.mov · ProRes: not playable in the app`)
  await expect(p.getByTestId('pod-outputs-render-review-codecs')).toContainText('h264, prores422hq')
  await p.getByTestId('pod-outputs-render-review-play').click()
  const v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-video')).toHaveAttribute('src', 'http://proxy.test/review.webm')   // the .mp4, never the .mov
  await expect(v.getByTestId('dpx-viewer-rendered-badge')).toHaveText('Review v003 · on this PC')
  await expect(v.getByTestId('dpx-viewer-review-files')).toContainText('not playable in the app')
  await v.getByTestId('dpx-viewer-source-proxy').click()
  await expect(v.getByTestId('dpx-viewer-video')).toHaveAttribute('src', 'http://proxy.test/a.webm')
  await expect(v.getByTestId('dpx-viewer-rendered-badge')).toHaveText('Proxy 1280 px · on this PC')
  await v.getByTestId('dpx-viewer-source-review').click()
  await expect(v.getByTestId('dpx-viewer-video')).toHaveAttribute('src', 'http://proxy.test/review.webm')
})

test('Review video without a proxy: the viewer plays the review; opened by a click it starts on the proxy when there is one', async ({ page, api }) => {
  const del = { shot: 'archival-085', version: 2, file: `deliver/archival-085/v002/${A}.mp4`, exists_local: false, exists_remote: true }
  const m = await openOutputs(page, api, { seqs: [[A, 'seqs/a', 3]], renders: { deliverables: [del, { ...del, version: 1 }] } })
  await expect(tile(m, A).getByTestId('outputs-dpx-review')).toHaveText('Review v002')   // the latest version
  await tile(m, A).click()
  const v = page.getByTestId('dpx-viewer')
  const src = await v.getByTestId('dpx-viewer-video').getAttribute('src')
  expect(src).toContain(`filename=${encodeURIComponent(A)}.mp4`); expect(decodeURIComponent(src)).toContain('subfolder=deliver/archival-085/v002')
  await expect(v.getByTestId('dpx-viewer-rendered-badge')).toHaveText('Review v002 · on the volume')
  await expect(v.getByTestId('dpx-viewer-source')).toHaveCount(0)   // nothing to switch to
})

test('Review codecs: ProRes is ticked and H.264 is not by default, the body carries ["prores422hq"], and the hint shows only while ProRes is alone', async ({ page, api }) => {
  await openOutputs(page, api)
  const p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-kind-review').check()
  await expect(p.getByTestId('pod-outputs-render-codecs')).toContainText('ProRes 422 HQ MOV (conform / master file)'); await expect(p.getByTestId('pod-outputs-render-codecs')).toContainText('H.264 MP4 (plays in the app)')
  await expect(p.getByTestId('pod-outputs-render-prores-hint')).toHaveText('ProRes cannot be played in the app. Tick H.264 too to also get a file you can play here.')
  await p.getByTestId('pod-outputs-render-codec-h264').check()
  await expect(p.getByTestId('pod-outputs-render-prores-hint')).toHaveCount(0)
  await p.getByTestId('pod-outputs-render-codec-h264').uncheck()
  await expect(p.getByTestId('pod-outputs-render-prores-hint')).toBeVisible()
  await p.getByTestId('pod-outputs-render-approved-by').fill('Brynley')
  await p.getByTestId('pod-outputs-render-start').click()
  await expect.poll(() => api.state.renders.started.length).toBe(1)
  expect(api.state.renders.started[0].codecs).toEqual(['prores422hq'])
  await p.getByTestId('pod-outputs-render-stop').click()
  // the quick proxy never offers codecs: it stays H.264
  await p.getByTestId('pod-outputs-render-kind-proxy').check()
  await expect(p.getByTestId('pod-outputs-render-codecs')).toHaveCount(0)
})

test('Clip names: collapsed section prefilled with the sequence names; an edit is sent as clip_name only when it differs; the plan shows the output file names', async ({ page, api }) => {
  await openOutputs(page, api)
  const p = await openPreviews(page)
  const sec = p.getByTestId('pod-outputs-render-clipnames')
  await expect(sec).toHaveJSProperty('open', false)
  await expect(p.getByTestId('pod-outputs-render-outputs')).toContainText(`${A}.mp4`)   // proxy at source size: <clip>.mp4
  await sec.locator('summary').click()
  await expect(sec).toContainText('Outputs are named with the clip name so conform relinks. The frames are never renamed.')
  await expect(p.getByTestId('pod-outputs-render-clipname')).toHaveCount(3)
  await expect(p.getByTestId('pod-outputs-render-clipname').first()).toHaveValue(A)
  await p.getByTestId('pod-outputs-render-clipname').nth(1).fill('ARCHIVAL-077_B')
  await expect(p.getByTestId('pod-outputs-render-outputs')).toContainText('ARCHIVAL-077_B.mp4')
  await p.getByTestId('pod-outputs-render-kind-review').check()
  await expect(p.getByTestId('pod-outputs-render-outputs')).toContainText('ARCHIVAL-077_B.mov')
  await expect(p.getByTestId('pod-outputs-render-outputs')).toContainText(`${A}.mov`)
  await p.getByTestId('pod-outputs-render-kind-proxy').check()
  await p.getByTestId('pod-outputs-render-width').selectOption('1280')
  await expect(p.getByTestId('pod-outputs-render-outputs')).toContainText(`${A}_1280.mp4`)
  await p.getByTestId('pod-outputs-render-start').click()
  await expect.poll(() => api.state.renders.started.length).toBe(1)
  const seqs = api.state.renders.started[0].sequences
  expect(seqs[0].clip_name).toBeUndefined(); expect(seqs[1].clip_name).toBe('ARCHIVAL-077_B'); expect(seqs[2].clip_name).toBeUndefined()   // only the changed one
  await expect(p.getByTestId('pod-outputs-render-seq-clip')).toHaveText('→ ARCHIVAL-077_B')
})

test('Clip names: the core\'s rules are checked inline (empty, slash, .., characters, length) and Start waits; a core 400 shows inline', async ({ page, api }) => {
  await openOutputs(page, api)
  const p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-clipnames').locator('summary').click()
  const box = p.getByTestId('pod-outputs-render-clipname').first(), err = p.getByTestId('pod-outputs-render-clipname-error')
  for (const [value, text] of [['', 'A clip name cannot be empty.'], ['a/b', 'A clip name has no slashes or `..`.'], ['a..b', 'A clip name has no slashes or `..`.'], ['a\\b', 'A clip name has no slashes or `..`.'], ['a:b*', 'A clip name uses letters, digits and . _ - or spaces only.'], ['x'.repeat(201), 'A clip name is at most 200 characters.']]) {
    await box.fill(value)
    await expect(err).toHaveText(text); await expect(p.getByTestId('pod-outputs-render-start')).toBeDisabled()
  }
  await box.fill('ARCHIVAL-077_A v2.final')   // spaces, dots, underscores and dashes are fine
  await expect(err).toHaveCount(0); await expect(p.getByTestId('pod-outputs-render-start')).toBeEnabled()
  api.state.renders.startError = { detail: 'clip_name is already used by another sequence of this job' }
  await p.getByTestId('pod-outputs-render-start').click()
  await expect(p.getByTestId('pod-outputs-render-error')).toHaveText('clip_name is already used by another sequence of this job')
})

test('Viewer: a review with only a ProRes .mov says it cannot be played, names the file and offers Download; the tile badge stays', async ({ page, api }) => {
  const del = { shot: 'archival-085', version: 4, file: `output/deliver/archival-085/v004/${A}.mov`, exists_local: false, exists_remote: true, files: [{ name: `${A}.mov`, codec: 'prores422hq', bytes: 99 }] }
  const m = await openOutputs(page, api, { seqs: [[A, 'seqs/a', 3]], renders: { deliverables: [del] } })
  await expect(tile(m, A).getByTestId('outputs-dpx-review')).toHaveText('Review v004')
  await tile(m, A).click()
  const v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-review-mov')).toContainText('ProRes: not playable in the app')
  await expect(v.getByTestId('dpx-viewer-review-mov-name')).toHaveText(`${A}.mov`)
  await expect(v.getByTestId('dpx-viewer-video')).toHaveCount(0)   // nothing playable: the frames
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveAttribute('data-drawn', '0')
  const [dl] = await Promise.all([page.waitForEvent('popup').catch(() => null), v.getByTestId('dpx-viewer-review-download').click()])
  void dl
})

test('Pod CPU: 4 cores is amber, 16 is normal, an absent probe shows nothing; notes, the output estimate and the static hint show', async ({ page, api }) => {
  await openOutputs(page, api, { renders: { podCpu: { cores: 4, mem_mb: 16384, free_gb: 120 }, notes: ['This pod has 4 vCPUs: rendering will be slow.', 'About 6.2 GB will be synced to this PC.'], outputGb: 2.07 } })
  const p = await openPreviews(page)
  const cpu = p.getByTestId('pod-outputs-render-pod-cpu')
  await expect(cpu).toHaveText('Pod: 4 vCPUs · 16 GB RAM · 120 GB free'); await expect(cpu).toHaveAttribute('data-warn', 'true')
  await expect(p.getByTestId('pod-outputs-render-note')).toHaveText(['This pod has 4 vCPUs: rendering will be slow.', 'About 6.2 GB will be synced to this PC.'])
  await expect(p.getByTestId('pod-outputs-render-output-size')).toHaveText('about 6.2 GB of H.264')   // 3 sequences x 2.07
  await p.getByTestId('pod-outputs-render-kind-review').check()
  await expect(p.getByTestId('pod-outputs-render-output-size')).toHaveText('about 6.2 GB of ProRes')
  await expect(p.getByTestId('pod-outputs-render-cpu-hint')).toHaveText("Rendering uses the pod's CPU, not its GPU: a cheap card is fine, pick one with enough cores.")
  api.state.renders.podCpu = { cores: 16, mem_mb: 65536, free_gb: 300 }; api.state.renders.notes = []
  await p.getByTestId('pod-outputs-render-kind-proxy').check()
  await expect(cpu).toHaveText('Pod: 16 vCPUs · 64 GB RAM · 300 GB free'); await expect(cpu).toHaveAttribute('data-warn', 'false')
  await expect(p.getByTestId('pod-outputs-render-note')).toHaveCount(0)
  api.state.renders.podCpu = undefined; api.state.renders.outputGb = 0
  await p.getByTestId('pod-outputs-render-kind-review').check()
  await expect(p.getByTestId('pod-outputs-render-pod-cpu')).toHaveCount(0); await expect(p.getByTestId('pod-outputs-render-output-size')).toHaveCount(0)
  await expect(p.getByTestId('pod-outputs-render-cpu-hint')).toBeVisible()   // the hint is static
})

test('Job: the measured fps and an ETA show while it renders', async ({ page, api }) => {
  await openOutputs(page, api)
  const p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-start').click()
  await expect(p.getByTestId('pod-outputs-render-job')).toBeVisible()
  expect(await p.getByTestId('pod-outputs-render-eta').count()).toBe(0)   // no rate yet
  Object.assign(api.state.renders.jobs[0], { frames_total: 412, frames_done: 140, rate_fps: 9.2 })
  await expect(p.getByTestId('pod-outputs-render-eta')).toHaveText('about 30 s left', { timeout: 6000 })
  await expect(p.getByTestId('pod-outputs-render-status')).toContainText('9 fps')
})

test('switching to Review while its plan is still on the way never prints "undefined": a planning line shows, then each shot with its next version', async ({ page, api }) => {
  const m = await openOutputs(page, api)
  void m
  // hold the review plan back for a moment: the plan on screen is meanwhile the quick proxy's, which has no shot and no version
  await page.route('**/renders/plan', async (route) => {
    let kind = ''; try { kind = route.request().postDataJSON()?.kind } catch { /* no body */ }
    if (kind === 'review') await new Promise((r) => setTimeout(r, 1200))
    return route.fallback()
  })
  const p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-kind-review').check()
  const rows = p.getByTestId('pod-outputs-render-review-rows')
  await expect(rows.getByTestId('pod-outputs-render-review-planning')).toBeVisible()       // the planning line, not stale rows
  await expect(rows).not.toContainText('undefined')
  await expect(p.getByTestId('pod-outputs-render-review-shot')).toHaveCount(0)
  await expect(p.getByTestId('pod-outputs-render-review-shot').first()).toBeVisible({ timeout: 10000 })   // the plan arrived
  await expect(rows.getByTestId('pod-outputs-render-review-planning')).toHaveCount(0)
  await expect(rows).not.toContainText('undefined')
  const shot = await p.getByTestId('pod-outputs-render-review-shot').first().getAttribute('data-shot')
  expect(shot).toBeTruthy(); expect(shot).not.toBe('undefined')
})

test('Source size under the Size select: one size, two sizes as lines with counts, the downscale from/to, size not read, and the older core\'s per-sequence fallback', async ({ page, api }) => {
  await openOutputs(page, api)
  const p = await openPreviews(page)
  await expect(p.getByTestId('pod-outputs-render-source-line')).toHaveText(['3840 × 2160, 16-bit'])
  await p.getByTestId('pod-outputs-render-width').selectOption('1920')
  await expect(p.getByTestId('pod-outputs-render-source-line')).toHaveText(['from 3840 × 2160 to 1920 × 1080'])
  await p.getByTestId('pod-outputs-render-width').selectOption('960')
  await expect(p.getByTestId('pod-outputs-render-source-line')).toHaveText(['from 3840 × 2160 to 960 × 540'])
  api.state.renders.sources = { [key('seqs/b', B)]: { width: 1920, height: 1080, bits: 10 }, [key('seqs/c', C)]: { width: 1920, height: 1080, bits: 10 } }
  await p.getByTestId('pod-outputs-render-width').selectOption('source')
  await p.getByTestId('pod-outputs-render-fps').selectOption('25')   // a new plan
  await expect(p.getByTestId('pod-outputs-render-source-line')).toHaveText(['3840 × 2160 · 16-bit: 1 sequence', '1920 × 1080 · 10-bit: 2 sequences'])
  await p.getByTestId('pod-outputs-render-width').selectOption('1280')
  await expect(p.getByTestId('pod-outputs-render-source-line')).toHaveText(['from 3840 × 2160 to 1280 × 720 (1 sequence)', 'from 1920 × 1080 to 1280 × 720 (2 sequences)'])
  api.state.renders.noSource = true; api.state.renders.noSummary = true
  await p.getByTestId('pod-outputs-render-fps').selectOption('30')
  await expect(p.getByTestId('pod-outputs-render-source')).toHaveText('size not read')
})

test('Colour block: closed for a quick proxy, open for a Review; the groups, the conversion in plain words, the no-transform note and the verdict', async ({ page, api }) => {
  await openOutputs(page, api)
  const p = await openPreviews(page)
  const c = p.getByTestId('pod-outputs-render-colour')
  await expect(c).toHaveAttribute('data-open', 'false')
  await c.locator('summary').click(); await expect(c).toHaveAttribute('data-open', 'true')
  await expect(c.getByTestId('pod-outputs-render-colour-group')).toHaveCount(1)
  await expect(c.getByTestId('pod-outputs-render-colour-line')).toHaveText('Transfer: logarithmic · Colorimetric: unspecified video · RGB · 16-bit packed · big-endian')
  await expect(c.getByTestId('pod-outputs-render-colour-count')).toHaveText('3 sequences'); await expect(c.getByTestId('pod-outputs-render-colour-verdict')).toHaveText('Review allowed')
  await expect(c.getByTestId('pod-outputs-render-colour-conversion')).toHaveText('Conversion applied: none: a plain scale, no colour transform')
  await expect(c.getByTestId('pod-outputs-render-colour-note')).toHaveText("The app applies no colour transform; what you see in the proxy is the file's values scaled.")
  await p.getByTestId('pod-outputs-render-kind-review').check()
  await expect(c).toHaveAttribute('data-open', 'true')   // open for a Review
  await p.getByTestId('pod-outputs-render-kind-proxy').check()
  await expect(c).toHaveAttribute('data-open', 'false')
  api.state.renders.colours = { [key('seqs/c', C)]: { conversion: 'BT.709 matrix' } }
  await p.getByTestId('pod-outputs-render-fps').selectOption('25')
  await c.locator('summary').click()
  await expect(c.getByTestId('pod-outputs-render-colour-conversion')).toHaveText(['Conversion applied: none: a plain scale, no colour transform', 'Conversion applied: BT.709 matrix'])
})

test('A refused Review shows the reason and keeps Start off for a Review only; a quick proxy is not stopped by it', async ({ page, api }) => {
  await openOutputs(page, api, { renders: { refuse: { [key('seqs/b', B)]: 'a linear transfer is not a review source' } } })
  const p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-colour').locator('summary').click()
  const verdicts = p.getByTestId('pod-outputs-render-colour-verdict')
  await expect(verdicts).toHaveText(['Review allowed', 'Review refused: a linear transfer is not a review source'])
  await expect(p.getByTestId('pod-outputs-render-start')).toBeEnabled()   // a proxy plays anything
  await p.getByTestId('pod-outputs-render-kind-review').check(); await p.getByTestId('pod-outputs-render-approved-by').fill('B')
  await expect(p.getByTestId('pod-outputs-render-start')).toBeDisabled()
  await p.getByTestId('pod-outputs-render-kind-proxy').check()
  await expect(p.getByTestId('pod-outputs-render-start')).toBeEnabled()
})

test('The per-sequence table (name, size, transfer, colorimetric, bits, start timecode, verdict) with a filter, and Copy as text puts the block on the clipboard', async ({ page, api, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openOutputs(page, api, { renders: { refuse: { [key('seqs/c', C)]: 'not a review source' }, colours: { [key('seqs/b', B)]: { start_timecode: '02:00:00:00' } } } })
  const p = await openPreviews(page)
  await p.getByTestId('pod-outputs-render-colour').locator('summary').click()
  await p.getByTestId('pod-outputs-render-colour-rows-toggle').click()
  await expect(p.getByTestId('pod-outputs-render-colour-row')).toHaveCount(3)
  const rowB = p.locator(`[data-testid="pod-outputs-render-colour-row"][data-name="${B}"]`)
  await expect(rowB.locator('td')).toHaveText([B, '3840 × 2160', 'logarithmic', 'unspecified video', '16', '02:00:00:00', 'ok'])
  await expect(p.locator(`[data-testid="pod-outputs-render-colour-row"][data-name="${C}"] td`).last()).toHaveText('not a review source')
  await p.getByTestId('pod-outputs-render-colour-filter').fill('s2_')
  await expect(p.getByTestId('pod-outputs-render-colour-row')).toHaveCount(1)
  await p.getByTestId('pod-outputs-render-colour-copy').click()
  await expect(p.getByTestId('pod-outputs-render-colour-copy')).toHaveText('Copied')
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text.split('\n')).toEqual([
    '2 sequences: Transfer: logarithmic · Colorimetric: unspecified video · RGB · 16-bit packed · big-endian · 3840 × 2160 · Review allowed',
    '1 sequence: Transfer: logarithmic · Colorimetric: unspecified video · RGB · 16-bit packed · big-endian · 3840 × 2160 · Review refused: not a review source',
    'Conversion applied: none: a plain scale, no colour transform'])
})

test('A core without colour or summaries (older): the colour block is absent, the size comes from each sequence\'s own source, nothing breaks', async ({ page, api }) => {
  await openOutputs(page, api, { renders: { noColour: true, noSummary: true } })
  const p = await openPreviews(page)
  await expect(p.getByTestId('pod-outputs-render-colour')).toHaveCount(0)
  await expect(p.getByTestId('pod-outputs-render-source-line')).toHaveText(['3840 × 2160, 16-bit'])
  await expect(p.getByTestId('pod-outputs-render-start')).toBeEnabled()
})

test('rendering on this PC while previews are being generated shows a warning hint (not a block); the pod and a finished batch show none', async ({ page, api }) => {
  await openOutputs(page, api)
  // keep the preview batch running: every frame answers after a pause
  await page.route('**/view?*', async (route) => { await new Promise((r) => setTimeout(r, 1500)); return route.fallback() })
  const p = await openPreviews(page)
  const hint = p.getByTestId('pod-outputs-render-local-hint')
  await expect(hint).toHaveCount(0)                                                  // no batch yet
  await p.getByTestId('pod-outputs-load-previews').click()                           // Generate all previews: a running job
  await p.getByTestId('pod-outputs-render-where').selectOption('local')
  await expect(hint).toBeVisible()
  await expect(hint).toContainText('Rendering on this PC while previews are being generated slows both')
  await expect(p.getByTestId('pod-outputs-render-start')).not.toBeDisabled()          // a hint only: Start is not blocked by it
  await p.getByTestId('pod-outputs-render-where').selectOption('pod')
  await expect(hint).toHaveCount(0)                                                  // the pod has its own CPU
  await p.getByTestId('pod-outputs-render-where').selectOption('local')
  await expect(hint).toBeVisible()
  await p.getByTestId('pod-outputs-stop-previews').click()                           // the batch ends
  await expect(hint).toHaveCount(0)
})

