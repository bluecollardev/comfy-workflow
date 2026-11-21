import { test, expect, podCard, fileTiles } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// The Outputs gallery shows a DPX sequence (what OCIOWrite writes) as ONE tile and opens a quick-look viewer that decodes the frames in the page (src/utils/dpx.js; docs/ADR-037 amendment 2026-11-17).
const SUB = 'proxy_v004/archival-080/archival-080_a_v004_dpx16'
const frameName = (n) => `archival-080_a_v004_proxy.${String(n).padStart(4, '0')}.dpx`
const dpx = (n) => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? Math.min(65535, (n + 1) * 20000 + x * 500) : c === 1 ? 30000 + y * 1000 : 0) })   // frame n is redder by n; it varies across the picture (a flat frame would be flagged empty)

test('Outputs: a DPX sequence is one tile with a frame count; the viewer decodes the frame, steps with Next and the arrow keys, and keeps Open and Download', async ({ page, api }) => {
  const outputs = [0, 1, 2].map((n) => ({ filename: frameName(n), subfolder: SUB, type: 'output' }))
  api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'dddddddd-1111-2222', workflow: 'rounds/r1/archival-080/proxy.json', status: 'success', started_at: '2026-11-17T10:00:00Z', duration_s: 80, cost_estimate: 0.02,
    outputs: [...outputs, { filename: 'archival-080_a_v004_proxy.json', subfolder: SUB, type: 'output' }, { filename: 'still_0001.png', subfolder: '', type: 'output' }] })
  const asked = []
  await page.context().route('**/view?*', (r) => {
    const m = /filename=([^&]+)/.exec(r.request().url()), name = decodeURIComponent(m[1]), fr = /\.(\d+)\.dpx$/.exec(name)
    asked.push(name)
    if (fr) return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: dpx(Number(fr[1])) })
    return r.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: '{}' })
  })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  const tiles = fileTiles(m)
  await expect(tiles.filter({ has: page.getByTestId('outputs-dpx-placeholder') })).toHaveCount(1)   // three frames, one tile
  const tile = m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')
  await expect(tile).toHaveCount(1)
  await expect(tile.getByTestId('outputs-dpx-badge')).toHaveText('DPX · 3 frames')
  await expect(tile).toHaveAttribute('data-frames', '3')
  await expect(m.locator('[data-testid="outputs-group-row"][title$=".json"]')).toHaveCount(1)   // the sidecar is a row of the Data group, the png a row of the Images group
  await expect(tiles).toHaveCount(4 /* dpx, json, png, plate of the older run */)
  await tile.getByTestId('outputs-dpx-load-preview').click()   // previews load on a click (nothing loads by itself)
  await expect(tile.getByTestId('outputs-dpx-thumb')).toBeVisible()   // the first frame is the tile's preview (docs/ADR-045)
  expect([...new Set(asked.filter((n) => n.endsWith('.dpx')))]).toEqual([frameName(0)])   // never all the frames for a tile: the first only
  await expect(m.getByTestId('outputs-zip').first()).toBeVisible()   // Download all (zip) is still offered (disabled outside the app); the zip takes every file

  await tile.click()
  const v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-frame')).toHaveText(/1 \/ 3/)
  const canvas = v.getByTestId('dpx-viewer-canvas')
  await expect(canvas).toHaveAttribute('data-drawn', '0')
  const read = () => canvas.evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; return { w: c.width, h: c.height, r: d[0], g: d[1], sum: d.reduce((a, b, i) => a + (i % 4 === 3 ? 0 : b), 0) } })
  const f0 = await read()
  expect(f0.w).toBe(16); expect(f0.h).toBe(8); expect(f0.sum).toBeGreaterThan(0)   // not black
  expect(f0.r).toBeGreaterThan(70); expect(f0.r).toBeLessThan(90)   // 20000 / 65535 * 255 = 78
  await expect(v.getByTestId('dpx-viewer-prev')).toBeDisabled()
  await v.getByTestId('dpx-viewer-next').click()
  await expect(v.getByTestId('dpx-viewer-frame')).toHaveText(/2 \/ 3/)
  await expect(canvas).toHaveAttribute('data-drawn', '1')
  expect((await read()).r).toBeGreaterThan(f0.r + 50)   // frame 1 is redder
  await expect(v.getByTestId('dpx-viewer-title')).toHaveText(frameName(1))
  await expect(v.getByTestId('dpx-viewer-open')).toHaveAttribute('href', new RegExp(`filename=${frameName(1).replace(/\./g, '\\.')}`))   // Open and Download act on the current frame
  await page.keyboard.press('ArrowRight')
  await expect(v.getByTestId('dpx-viewer-frame')).toHaveText(/3 \/ 3/)
  await expect(v.getByTestId('dpx-viewer-next')).toBeDisabled()
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft')
  await expect(v.getByTestId('dpx-viewer-frame')).toHaveText(/1 \/ 3/)
  await v.getByTestId('dpx-viewer-slider').fill('2')
  await expect(v.getByTestId('dpx-viewer-frame')).toHaveText(/3 \/ 3/)
  await expect(v.getByTestId('dpx-viewer-download')).toBeVisible()
  const popup = page.waitForEvent('popup')
  await v.getByTestId('dpx-viewer-download').click()
  const tab = await popup
  await expect.poll(() => tab.url()).toContain(`filename=${frameName(2)}`)
  await expect(v.getByTestId('dpx-viewer-error')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(v).toHaveCount(0)
  await expect(m).toBeVisible()   // Esc closed the viewer, not the window under it
})

test('Outputs: a frame the pod cannot give shows an error line, and a lone .dpx is a one-frame viewer', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'eeeeeeee-1111-2222', workflow: 'rounds/r1/x/y.json', status: 'success', started_at: '2026-11-17T10:00:00Z', duration_s: 1, cost_estimate: 0, outputs: [{ filename: 'single.dpx', subfolder: '', type: 'output' }] })
  await page.route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/x-dpx', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from('JUNKJUNK') }))
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const tile = page.getByTestId('pod-outputs-modal').locator('[data-testid="outputs-tile"][data-kind="dpx"]')
  await expect(tile.getByTestId('outputs-dpx-badge')).toHaveText('DPX')
  await tile.click()
  const v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-error')).toContainText('bad magic')
  await expect(v.getByTestId('dpx-viewer-frame')).toHaveText(/1 \/ 1/)
  await expect(v.getByTestId('dpx-viewer-next')).toHaveCount(0)
  await expect(v.getByTestId('dpx-viewer-download')).toBeVisible()
})

// Playback (docs/ADR-037 amendment): Play/Pause/Space at the chosen fps, Loop, the cache, and "Buffering frame n" while a frame is late; never more than two requests to the pod at once.
async function openSequence(page, api, { delayMs = 0 } = {}) {
  api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'dddddddd-1111-2222', workflow: 'rounds/r1/archival-080/proxy.json', status: 'success', started_at: '2026-11-17T10:00:00Z', duration_s: 80, cost_estimate: 0.02,
    outputs: [0, 1, 2].map((n) => ({ filename: frameName(n), subfolder: SUB, type: 'output' })) })
  const stat = { live: 0, peak: 0 }
  await page.context().route('**/view?*', async (r) => {
    const name = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1]), fr = /\.(\d+)\.dpx$/.exec(name)
    stat.live++; stat.peak = Math.max(stat.peak, stat.live)
    if (delayMs && fr && Number(fr[1]) === 2) await new Promise((res) => setTimeout(res, delayMs))
    stat.live--
    return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: fr ? dpx(Number(fr[1])) : Buffer.from('{}') })
  })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await page.getByTestId('pod-outputs-modal').locator('[data-testid="outputs-tile"][data-kind="dpx"]').click()
  const v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveAttribute('data-drawn', '0')
  await v.getByTestId('dpx-viewer-frame').evaluate((el) => { window.__seen = []; new MutationObserver(() => window.__seen.push(el.textContent.trim())).observe(el, { childList: true, characterData: true, subtree: true }) })
  return { v, stat }
}

test('DPX playback: Play advances the frames, Pause stops, Space toggles, Loop wraps, a manual step pauses, and Play caches the sequence', async ({ page, api }) => {
  const { v, stat } = await openSequence(page, api)
  const play = v.getByTestId('dpx-viewer-play'), label = v.getByTestId('dpx-viewer-frame')
  await expect(v.getByTestId('dpx-viewer-fps')).toHaveValue('24'); await expect(v.getByTestId('dpx-viewer-loop')).toBeChecked()   // 24 fps, Loop on
  await v.getByTestId('dpx-viewer-fps').selectOption('30')
  await play.click()
  await expect(play).toHaveAttribute('data-playing', 'true')
  await expect.poll(() => page.evaluate(() => window.__seen.join('|'))).toMatch(/3 \/ 3.*1 \/ 3/)   // it reached the end and wrapped to the start
  await expect(v.getByTestId('dpx-viewer-cache-status')).toContainText('3 of 3')   // Play started the caching by itself
  await play.click()
  await expect(play).toHaveAttribute('data-playing', 'false')
  const at = await label.textContent(); await page.waitForTimeout(300); expect(await label.textContent()).toBe(at)   // paused: the frame holds
  await page.keyboard.press('Space'); await expect(play).toHaveAttribute('data-playing', 'true')
  await page.keyboard.press('Space'); await expect(play).toHaveAttribute('data-playing', 'false')
  await page.keyboard.press('Space'); await expect(play).toHaveAttribute('data-playing', 'true')
  await page.keyboard.press('ArrowRight'); await expect(play).toHaveAttribute('data-playing', 'false')   // any manual step pauses
  await v.getByTestId('dpx-viewer-slider').fill('0')
  await v.getByTestId('dpx-viewer-loop').uncheck()
  await play.click()   // without Loop it stops on the last frame
  await expect(label).toHaveText(/3 \/ 3/); await expect(play).toHaveAttribute('data-playing', 'false')
  await play.click(); await expect(label).toHaveText(/3 \/ 3/)   // Play on the last frame starts again, and ends there again
  expect(stat.peak).toBeLessThanOrEqual(2)
  await page.keyboard.press('Escape'); await expect(v).toHaveCount(0)
})

test('DPX playback: a late frame holds the playhead on "Buffering frame n", never skips, and never more than two requests at once', async ({ page, api }) => {
  const { v, stat } = await openSequence(page, api, { delayMs: 1500 })
  await v.getByTestId('dpx-viewer-fps').selectOption('30')
  await v.getByTestId('dpx-viewer-play').click()
  await expect(v.getByTestId('dpx-viewer-status')).toHaveText('Buffering frame 3')
  await expect(v.getByTestId('dpx-viewer-frame')).toHaveText(/2 \/ 3/)   // held on the previous frame
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveAttribute('data-drawn', '1')
  await expect(v.getByTestId('dpx-viewer-status')).toHaveCount(0, { timeout: 8000 })   // it arrived: playback continues
  expect(await page.evaluate(() => window.__seen.join('|'))).toMatch(/^Frame 2 \/ 3\|Frame 3 \/ 3/)   // 1 -> 2 -> 3 in order
  expect(stat.peak).toBeLessThanOrEqual(2)
  await page.keyboard.press('Escape')
})

// Empty frames: all black, truncated and missing frames get a banner instead of an unexplained black canvas; once loaded or cached they are counted (viewer and tile) and Previous/Next problem jump to them.
test('DPX empty frames: banners for black, truncated and missing; a count in the viewer and on the tile; Next/Previous problem navigation; playback goes over them', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'dddddddd-1111-2222', workflow: 'rounds/r1/archival-080/proxy.json', status: 'success', started_at: '2026-11-17T10:00:00Z', duration_s: 80, cost_estimate: 0.02,
    outputs: [0, 1, 2, 3].map((n) => ({ filename: frameName(n), subfolder: SUB, type: 'output' })) })
  await page.context().route('**/view?*', (r) => {
    const mm = /\.(\d+)\.dpx/.exec(decodeURIComponent(r.request().url())); const h = { 'access-control-allow-origin': '*' }
    if (!mm) return r.fulfill({ status: 200, contentType: 'image/png', headers: h, body: '' })   // the older run's thumbnail
    const n = Number(mm[1])
    if (n === 3) return r.fulfill({ status: 404, headers: h, body: 'not found' })
    const body = n === 1 ? makeDpx({ width: 16, height: 8, bits: 16, fn: () => 0 }) : n === 2 ? dpx(2).subarray(0, 2500) : dpx(0)
    return r.fulfill({ status: 200, contentType: 'image/png', headers: h, body })
  })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal'), tile = m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')
  await expect(tile.getByTestId('outputs-dpx-problems')).toHaveCount(0)   // nothing is known before a frame is loaded
  await tile.click()
  const v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveAttribute('data-drawn', '0')
  await expect(v.getByTestId('dpx-viewer-banner')).toHaveCount(0)   // a normal frame is not flagged
  await expect(v.getByTestId('dpx-viewer-stats')).toContainText('mean')
  await v.getByTestId('dpx-viewer-cache').click()
  await expect(v.getByTestId('dpx-viewer-cache-status')).toContainText('4 of 4 cached')
  await expect(v.getByTestId('dpx-viewer-problems')).toHaveText('3 of 4 frames empty')
  await v.getByTestId('dpx-viewer-next-problem').click()
  await expect(v.getByTestId('dpx-viewer-frame')).toHaveText(/2 \/ 4/)
  await expect(v.getByTestId('dpx-viewer-banner')).toHaveText('Empty frame: all black')
  await v.getByTestId('dpx-viewer-next-problem').click()
  await expect(v.getByTestId('dpx-viewer-banner')).toHaveText(/Truncated: 2500 of \d+ bytes/)
  await v.getByTestId('dpx-viewer-next-problem').click()
  await expect(v.getByTestId('dpx-viewer-banner')).toHaveText('Missing: the pod has no such file')
  await expect(v.getByTestId('dpx-viewer-error')).toHaveCount(0)
  await expect(v.getByTestId('dpx-viewer-next-problem')).toBeDisabled()
  await v.getByTestId('dpx-viewer-prev-problem').click(); await v.getByTestId('dpx-viewer-prev-problem').click()
  await expect(v.getByTestId('dpx-viewer-prev-problem')).toBeDisabled()   // frame 2 is the first problem
  await expect(v.getByTestId('dpx-viewer-frame')).toHaveText(/2 \/ 4/)
  await v.getByTestId('dpx-viewer-slider').fill('0'); await expect(v.getByTestId('dpx-viewer-banner')).toHaveCount(0)
  await v.getByTestId('dpx-viewer-fps').selectOption('30'); await v.getByTestId('dpx-viewer-play').click()
  await expect.poll(() => page.evaluate(() => 1) && v.getByTestId('dpx-viewer-frame').textContent()).toMatch(/4 \/ 4/)   // it plays over the empty frames
  await v.getByTestId('dpx-viewer-play').click()
  await page.keyboard.press('Escape')
  await expect(tile.getByTestId('outputs-dpx-problems')).toHaveText('3 of 4 frames empty')   // the tile remembers
})

test('DPX: a frame the page cannot reach says so ("Could not reach the pod file"), not a bare "Failed to fetch"', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'eeeeeeee-1111-2222', workflow: 'rounds/r1/x/y.json', status: 'success', started_at: '2026-11-17T10:00:00Z', duration_s: 1, cost_estimate: 0, outputs: [{ filename: 'single.dpx', subfolder: '', type: 'output' }] })
  await page.context().route('**/view?*', (r) => (r.request().url().includes('single.dpx') ? r.abort('failed') : r.fulfill({ status: 200, contentType: 'image/png', body: '' })))
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await page.getByTestId('pod-outputs-modal').locator('[data-testid="outputs-tile"][data-kind="dpx"]').click()
  const e = page.getByTestId('dpx-viewer').getByTestId('dpx-viewer-error')
  await expect(e).toContainText('Could not reach the pod file')
  await expect(e).not.toHaveText('Failed to fetch')
})

// Sequence previews (docs/ADR-045): the first frame of a sequence, lazily, six at a time by themselves, cached across opens.
const seqRun = (i, n = 3) => ({ prompt_id: `seq${i}0000-1111`, workflow: `rounds/r1/s${i}.json`, status: 'success', started_at: `2026-11-17T${String(10 + i).padStart(2, '0')}:00:00Z`, duration_s: 5, cost_estimate: 0,
  outputs: Array.from({ length: n }, (_, k) => ({ filename: `s${i}_proxy.${String(k).padStart(4, '0')}.dpx`, subfolder: `seqs/s${i}`, type: 'output' })) })
/** The Previews button opens the Previews window (Load all previews, Render sequences). */
const openPreviews = async (page) => { await page.getByTestId('pod-outputs-previews').click(); await expect(page.getByTestId('pod-outputs-previews-modal')).toBeVisible(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Previews' }).click() }   // the Previews tab (the window opens on Render Sequences)
const flat = () => makeDpx({ width: 16, height: 8, bits: 16, fn: () => 0 })

test('DPX previews: nothing loads by itself, even scrolling; a click loads one tile once; Load all loads the rest one at a time; reopening uses the cache; an empty first frame says so', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'] = [{ ...seqRun(1), outputs: Array.from({ length: 30 }, (_, i) => seqRun(i + 1).outputs).flat() }]   // thirty sequences: some far below the fold
  const hits = {}
  let live = 0, peak = 0
  await page.context().route('**/view?*', async (r) => {
    const name = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1]); if (name.endsWith('.json')) return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no record' })   // the colour record (a small .json read for the chips) is not a frame: not counted
    hits[name] = (hits[name] || 0) + 1
    live++; peak = Math.max(peak, live); await new Promise((res) => setTimeout(res, 20)); live--
    const empty = name.startsWith('s2_')
    return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: empty ? flat() : dpx(0) })
  })
  await page.addInitScript(() => { try { indexedDB.deleteDatabase('pod-manager-thumbs') } catch { /* none */ } })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('outputs-tile')).toHaveCount(30)
  await expect(m.getByTestId('outputs-dpx-load-preview').first()).toBeVisible({ timeout: 15000 })   // every tile waits for a click
  await m.getByTestId('outputs-tile').last().scrollIntoViewIfNeeded()   // scrolling to the end costs nothing
  await page.waitForTimeout(800)
  expect(Object.keys(hits)).toHaveLength(0)
  // one click, one frame, once
  await m.getByTestId('outputs-dpx-load-preview').first().click()
  await expect.poll(() => Object.keys(hits).length, { timeout: 15000 }).toBe(1)
  await expect(m.getByTestId('outputs-dpx-thumb').first()).toBeVisible({ timeout: 15000 })
  expect(Object.keys(hits)[0].endsWith('.0000.dpx')).toBe(true)
  // Load all: the rest, one frame at a time, each once (s2's first frame is flat: a badge, not a black square)
  await openPreviews(page)
  await page.getByTestId('pod-outputs-previews-modal').getByTestId('pod-outputs-load-previews').click()
  await expect.poll(() => Object.keys(hits).length, { timeout: 30000 }).toBe(30)
  expect(peak).toBe(1); expect(Object.values(hits).every((n) => n === 1)).toBe(true)
  await expect(m.getByTestId('outputs-dpx-thumb-empty')).toHaveCount(1)
  // close and reopen: what was made comes from the cache with no new request
  const before = { ...hits }
  await page.getByTestId('pod-outputs-previews-modal').locator('.modal-footer button').click(); await expect(page.getByTestId('pod-outputs-previews-modal')).toBeHidden()   // the Previews window first, then the Outputs window
  await m.locator('.btn-close').click(); await expect(m).toBeHidden()
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await expect.poll(async () => m.getByTestId('outputs-dpx-thumb').count(), { timeout: 15000 }).toBeGreaterThan(15)   // the cache fills the tiles in view at once
  await m.getByTestId('outputs-tile').last().scrollIntoViewIfNeeded()
  await expect.poll(async () => m.getByTestId('outputs-dpx-thumb').count(), { timeout: 15000 }).toBe(29)   // and the rest as they scroll in
  for (const n of Object.keys(before)) if (!n.startsWith('s2_')) expect(hits[n], n).toBe(before[n])
})

// A preview or a list never spins forever (docs/ADR-045): a visible end for every case.
const savedSeq = (volume = 'vol1') => ({ prompt_id: 'sv000000-1111', workflow: 'rounds/r1/archival-080/proxy.json', started_at: '2026-11-17T10:00:00Z', duration_s: 5, pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', volume_id: volume, datacenter: 'EU-RO-1', recorded_at: '2026-11-17T10:01:00Z',
  files: [0, 1, 2].map((n) => ({ filename: frameName(n), subfolder: SUB, type: 'output' })) })
const stopAll = (api) => { for (const p of api.state.pods) { p.status = 'stopped'; p.web_ui_url = null; p.uptime_seconds = null } }

test('previews: with no pod and no S3 keys the tile says why instead of spinning, and nothing is requested', async ({ page, api }) => {
  stopAll(api); api.state.history.runs = {}; api.state.history.saved = [savedSeq()]
  let asked = 0
  await page.context().route('**/view?*', (r) => { asked++; return r.abort() })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('outputs-dpx-thumb-nobase')).toBeVisible()
  await expect(m.getByTestId('outputs-dpx-thumb-nobase')).toHaveAttribute('title', /Start a pod on .* or set the S3 keys to see previews/)
  await expect(m.getByTestId('outputs-dpx-thumb-loading')).toHaveCount(0)
  expect(asked).toBe(0)
})

test('previews: a fetch that rejects ends in a retry icon with the reason in its title', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'] = [{ ...seqRun(1), outputs: seqRun(1).outputs }]
  await page.context().route('**/view?*', (r) => r.abort())
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await m.getByTestId('outputs-dpx-load-preview').first().click()   // previews load on a click
  await expect(m.getByTestId('outputs-dpx-thumb-retry')).toBeVisible()
  await expect(m.getByTestId('outputs-dpx-thumb-retry')).toHaveAttribute('title', /Could not reach/)
  await expect(m.getByTestId('outputs-dpx-thumb-loading')).toHaveCount(0)
})

test('previews: a pod that answers 404 for the file says the pod does not serve it', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'] = [{ ...seqRun(1), outputs: seqRun(1).outputs }]
  await page.context().route('**/view?*', (r) => r.fulfill({ status: 404, body: 'nope', headers: { 'access-control-allow-origin': '*' } }))
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await page.getByTestId('pod-outputs-modal').getByTestId('outputs-dpx-load-preview').first().click()   // previews load on a click
  await expect(page.getByTestId('pod-outputs-modal').getByTestId('outputs-dpx-thumb-retry')).toHaveAttribute('title', /does not serve this file \(is it stopped\?\)/)
})

test('previews: a route that never answers is ended by the timeout (shortened for the test)', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'] = [{ ...seqRun(1), outputs: seqRun(1).outputs }]
  await page.addInitScript(() => { window.__THUMB_TIMEOUTS__ = { firstByte: 300, whole: 800, list: 300 } })
  await page.context().route('**/view?*', () => new Promise(() => {}))   // hangs
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await m.getByTestId('outputs-dpx-load-preview').first().click()   // previews load on a click
  await expect(m.getByTestId('outputs-dpx-thumb-loading')).toBeVisible()
  await expect(m.getByTestId('outputs-dpx-thumb-retry')).toBeVisible({ timeout: 5000 })
  await expect(m.getByTestId('outputs-dpx-thumb-retry')).toHaveAttribute('title', /did not arrive in time/)
  await expect(m.getByTestId('outputs-dpx-thumb-loading')).toHaveCount(0)
})

test('the volume listing never spins forever: saved runs stay and an error line shows', async ({ page, api }) => {
  stopAll(api); api.state.history.runs = {}; api.state.history.saved = [savedSeq()]
  await page.addInitScript(() => { window.__THUMB_TIMEOUTS__ = { list: 400 } })
  await page.route('**/history/outputs*', () => new Promise(() => {}))
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('pod-outputs-volume-error')).toContainText('did not answer', { timeout: 5000 })
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1)
  await expect(m.getByTestId('pod-outputs-volume-loading')).toHaveCount(0)
})

test('an older running app (no core call) says to restart instead of spinning', async ({ page, api }) => {
  stopAll(api); api.state.history.runs = {}; api.state.history.saved = [savedSeq()]
  await page.route('**/history/outputs*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'no core call history.listOutputs' }) }))
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await expect(page.getByTestId('pod-outputs-modal').getByTestId('pod-outputs-volume-error')).toHaveText('Restart the app to enable previews from the volume.')
})

test('DPX previews: a preview you asked for is NOT cancelled by scrolling away, and Load all keeps loading tiles that scroll into view later', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'] = [{ ...seqRun(1), outputs: Array.from({ length: 30 }, (_, i) => seqRun(i + 1).outputs).flat() }]
  const hits = {}; let aborted = 0
  await page.context().route('**/view?*', async (r) => {
    const name = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1]); if (name.endsWith('.json')) return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no record' })   // the colour record (a small .json read for the chips) is not a frame: not counted
    hits[name] = (hits[name] || 0) + 1
    await new Promise((res) => setTimeout(res, 250))   // slow enough that the person scrolls away while it is being made
    const empty = name.startsWith('s2_')
    try { await r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: empty ? flat() : dpx(0) }) } catch { aborted++ }
  })
  await page.addInitScript(() => { try { indexedDB.deleteDatabase('pod-manager-thumbs') } catch { /* none */ } })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('outputs-tile')).toHaveCount(30)
  await expect(m.getByTestId('outputs-dpx-load-preview').first()).toBeVisible({ timeout: 15000 })
  // ask for the first tile, then scroll far away while it is still being made: it must finish anyway
  await m.getByTestId('outputs-dpx-load-preview').first().click()
  await m.getByTestId('outputs-tile').last().scrollIntoViewIfNeeded()
  await page.waitForTimeout(900)
  await m.getByTestId('outputs-tile').first().scrollIntoViewIfNeeded()
  await expect(m.getByTestId('outputs-dpx-thumb').first()).toBeVisible({ timeout: 15000 })   // done, not back to "Load preview"
  expect(Object.values(hits).every((n) => n === 1)).toBe(true)
  // Load all, then scroll to the end and back: every tile ends with its preview, each frame fetched once
  await openPreviews(page)
  await page.getByTestId('pod-outputs-previews-modal').getByTestId('pod-outputs-load-previews').click()
  await m.getByTestId('outputs-tile').last().scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  await m.getByTestId('outputs-tile').first().scrollIntoViewIfNeeded()
  await expect.poll(() => Object.keys(hits).length, { timeout: 30000 }).toBe(30)
  await expect.poll(async () => m.getByTestId('outputs-dpx-thumb').count(), { timeout: 30000 }).toBe(29)
  await expect(m.getByTestId('outputs-dpx-load-preview')).toHaveCount(0)   // nothing is left asking for another click
  expect(Object.values(hits).every((n) => n === 1)).toBe(true)
})

// The Previews window (Load all previews): a batch reaches tiles never scrolled into view, a cached sequence costs no download, the failed count, Stop, the batch ending by itself, the counts line, the progress.
const manySeqs = (n) => [{ ...seqRun(1), outputs: Array.from({ length: n }, (_, i) => seqRun(i + 1).outputs).flat() }]
const pv = (page) => page.getByTestId('pod-outputs-previews-modal')
async function previewsPage(page, api, { n = 12, delayMs = 40, fail = () => false, empty = () => false } = {}) {
  api.state.history.runs['pod-aaaaaaaa'] = manySeqs(n)
  const hits = {}
  await page.context().route('**/view?*', async (r) => {
    const name = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1]); if (name.endsWith('.json')) return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no record' })   // the colour record (a small .json read for the chips) is not a frame: not counted
    hits[name] = (hits[name] || 0) + 1
    await new Promise((res) => setTimeout(res, delayMs))
    if (fail(name)) return r.fulfill({ status: 500, body: 'boom' }).catch(() => {})
    return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: empty(name) ? flat() : dpx(0) }).catch(() => {})
  })
  await page.addInitScript(() => { try { indexedDB.deleteDatabase('pod-manager-thumbs') } catch { /* none */ } })   // an empty cache for this test
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('outputs-tile')).toHaveCount(n)
  return { m, hits }
}

test('Previews window: Generate all reaches tiles that were never scrolled into view; the counts line and the progress follow; the batch ends by itself and a failed one is counted', async ({ page, api }) => {
  const { m, hits } = await previewsPage(page, api, { n: 12, fail: (name) => name.startsWith('s3_'), empty: (name) => name.startsWith('s2_') })
  await openPreviews(page)
  const p = pv(page)
  await expect(p.getByTestId('pod-outputs-previews-counts')).toHaveText('0 ready · 12 waiting · 0 failed')
  await expect(p.getByTestId('pod-outputs-previews-progress')).toHaveCount(0)
  expect(Object.keys(hits)).toHaveLength(0)   // opening the window costs nothing
  await p.getByTestId('pod-outputs-load-previews').click()
  await expect(p.getByTestId('pod-outputs-previews-progress')).toBeVisible()
  await expect.poll(async () => Number(await p.getByTestId('pod-outputs-previews-progress').getAttribute('data-percent')), { timeout: 15000 }).toBeGreaterThan(0)   // it moves
  await expect(p.getByTestId('pod-outputs-previews-progress')).toHaveCount(0, { timeout: 30000 })   // and ends by itself: no Stop needed
  await expect(p.getByTestId('pod-outputs-stop-previews')).toHaveCount(0)
  expect(Object.keys(hits).length).toBeGreaterThanOrEqual(12)   // every sequence was asked for, the last ones never scrolled to
  await expect(p.getByTestId('pod-outputs-previews-counts')).toHaveText('11 ready · 0 waiting · 1 failed')   // the flat first frame counts as ready; the 500 is failed (and can be tried again)
  await expect(p.getByTestId('pod-outputs-load-previews')).toBeEnabled()
  await expect(p).toContainText('1 failed')
  void m
})

test('Previews window: the progress bar reports data-percent up to 100 while a batch runs', async ({ page, api }) => {
  await previewsPage(page, api, { n: 6, delayMs: 150 })
  await openPreviews(page)
  const bar = pv(page).getByTestId('pod-outputs-previews-progress')
  await pv(page).getByTestId('pod-outputs-load-previews').click()
  const seen = new Set()
  await expect.poll(async () => { const v = await bar.getAttribute('data-percent', { timeout: 150 }).catch(() => null); if (v !== null) seen.add(Number(v)); return bar.count() }, { timeout: 30000, intervals: [50] }).toBe(0)
  expect(Math.max(...seen)).toBeGreaterThan(0); expect([...seen].every((v) => v >= 0 && v <= 100)).toBe(true); expect(seen.size).toBeGreaterThan(2)
  await expect(pv(page).getByTestId('pod-outputs-previews-counts')).toHaveText('6 ready · 0 waiting · 0 failed')
  await expect(pv(page).getByTestId('pod-outputs-load-previews')).toBeDisabled()   // nothing left to make
})

test('Previews window: Stop ends the batch and nothing restarts when you scroll afterwards', async ({ page, api }) => {
  const { m, hits } = await previewsPage(page, api, { n: 12, delayMs: 300 })
  await openPreviews(page)
  await pv(page).getByTestId('pod-outputs-load-previews').click()
  await expect.poll(() => Object.keys(hits).length, { timeout: 10000 }).toBeGreaterThan(0)
  await pv(page).getByTestId('pod-outputs-stop-previews').click()
  await expect(pv(page).getByTestId('pod-outputs-previews-progress')).toHaveCount(0)
  await expect(pv(page).getByTestId('pod-outputs-stop-previews')).toHaveCount(0)
  await page.waitForTimeout(700)   // whatever was in flight settles
  const after = Object.keys(hits).length
  expect(after).toBeLessThan(12)
  await pv(page).locator('.modal-footer button').click(); await expect(pv(page)).toBeHidden()
  await m.getByTestId('outputs-tile').last().scrollIntoViewIfNeeded()
  await m.getByTestId('outputs-tile').nth(5).scrollIntoViewIfNeeded()
  await page.waitForTimeout(900)
  expect(Object.keys(hits).length).toBe(after)   // scrolling starts nothing
  await openPreviews(page)
  await expect(pv(page).getByTestId('pod-outputs-load-previews')).toBeEnabled()   // the rest is still waiting for a click
})

test('Previews window: a sequence already in the cache costs no download when Generate all runs again', async ({ page, api }) => {
  const { m, hits } = await previewsPage(page, api, { n: 4, delayMs: 20 })
  await openPreviews(page)
  await pv(page).getByTestId('pod-outputs-load-previews').click()
  await expect(pv(page).getByTestId('pod-outputs-previews-counts')).toHaveText('4 ready · 0 waiting · 0 failed', { timeout: 20000 })
  const before = { ...hits }
  expect(Object.keys(before)).toHaveLength(4)
  await pv(page).locator('.modal-footer button').click(); await expect(pv(page)).toBeHidden()
  await m.locator('.btn-close').click(); await expect(m).toBeHidden()
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await openPreviews(page)
  if (await pv(page).getByTestId('pod-outputs-load-previews').isEnabled()) await pv(page).getByTestId('pod-outputs-load-previews').click()   // tiles out of view are made now: from the cache
  await expect(pv(page).getByTestId('pod-outputs-previews-counts')).toHaveText('4 ready · 0 waiting · 0 failed', { timeout: 20000 })
  expect(hits).toEqual(before)   // all four came from the cache
})
