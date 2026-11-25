import { test, expect, podCard } from './fixtures'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'
const WEBM = fs.readFileSync(new URL('./media/tiny.webm', import.meta.url))   // 2 s, 64x48, 24 fps VP8

// Lucas, 2026-11-21: "94 of 94 frames show dpx frame previews if available", then "that's why these are jobs": the frame previews are made by a JOB on the pod (one small JPEG per frame,
// libs/core/src/framepreviews.ts), never by this PC pulling 8 to 50 MB frames. An expanded sequence counts and shows the previews that exist; Load Frame Previews starts the job for that
// sequence; the Generate window has the same job for every in-scope sequence behind a mode choice (Sequence Previews is today's behaviour).
const SUB = 'assembly_v024/review025_parts/split_cap120'
const NAME = 'v11_assembly_master_v024_review025_part32c06_depth-182'
const N = 20
const tinyDpx = () => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
// a 1x1 JPEG
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')

async function setup(page, api, extra = [], opts = {}) {
  const outputs = [...extra]
  if (opts.timeoutMs) await page.addInitScript((ms) => { globalThis.__VT_TIMEOUT_MS__ = ms }, opts.timeoutMs)   // a short capture limit for the time-out spec
  for (let n = 0; n < N; n++) outputs.push({ filename: `${NAME}.${String(n).padStart(4, '0')}.dpx`, subfolder: SUB, type: 'output' })
  api.state.history.runs['pod-aaaaaaaa'] = [{ prompt_id: 'dddddddd-1111-2222', workflow: 'x.json', status: 'success', started_at: '2026-11-21T14:39:00Z', duration_s: 10, outputs }]
  const asked = [], jpgs = [], jpgSubs = [], webmReqs = []
  await page.context().route('**/view?*', async (r) => {
    const f = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1])
    if (opts.custom && await opts.custom(f, r)) return   // a spec's own answer for one file
    if (/^ok_.*\.(png|webp)$/.test(f)) return r.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: JPG })   // a real image the page can show
    if (/^bad_.*\.(png|webp)$/.test(f)) return r.fulfill({ status: 404, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'no' })
    if (/\.webm$/.test(f)) {   // a real (tiny, VP8) video the page can decode, served with Range as the pod does
      webmReqs.push(f)
      if (opts.slowMs) await new Promise((res) => setTimeout(res, opts.slowMs))   // a slow link
      const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || ''), h = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' }
      if (!range) return r.fulfill({ status: 200, contentType: 'video/webm', headers: h, body: WEBM })
      const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), WEBM.length - 1) : WEBM.length - 1
      return r.fulfill({ status: 206, contentType: 'video/webm', headers: { ...h, 'content-range': `bytes ${a}-${b}/${WEBM.length}` }, body: WEBM.subarray(a, b + 1) })
    }
    if (/\.jpg$/.test(f)) { jpgs.push(f); jpgSubs.push(decodeURIComponent(/subfolder=([^&]*)/.exec(r.request().url())?.[1] || '')); return r.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: JPG }) }
    asked.push(f)
    return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tinyDpx() })
  })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  return { asked, jpgs, jpgSubs, webmReqs, modal: page.getByTestId('pod-outputs-modal') }
}

test('An expanded sequence says how many frames show previews, and the preview shows on that row only', async ({ page, api }) => {
  const { asked, modal } = await setup(page, api)
  // the tile's own preview (the first frame) is made on a click and goes into the cache
  await modal.getByTestId('outputs-dpx-load-preview').click()
  await expect(modal.getByTestId('outputs-dpx-thumb')).toBeVisible()
  const fetchedBefore = asked.length
  await modal.getByTestId('outputs-seq-toggle').click()
  await expect(modal.getByTestId('outputs-seq-frames')).toBeVisible()
  await expect(modal.getByTestId('outputs-seq-preview-count')).toHaveText(`1 of ${N} frames show previews`)
  await expect(modal.getByTestId('outputs-seq-frame-thumb')).toHaveCount(1)
  expect(asked.length).toBe(fetchedBefore)   // counting and showing them fetched nothing and generated nothing
})

test('Load Frame Previews starts a pod job for that sequence; the rows then show the pod\'s JPEGs and the count reaches N of N; this PC never fetches a frame', async ({ page, api }) => {
  const { asked, jpgs, modal } = await setup(page, api)
  await page.evaluate(() => { globalThis.__FP_POLL_MS__ = 50 })
  await modal.getByTestId('outputs-seq-toggle').click()
  await expect(modal.getByTestId('outputs-seq-preview-count')).toHaveText(`0 of ${N} frames show previews`)
  await expect(modal.getByTestId('outputs-seq-load-frames')).toHaveText('Load Frame Previews')
  await modal.getByTestId('outputs-seq-load-frames').click()
  await expect(modal.getByTestId('outputs-seq-preview-count')).toHaveText(`${N} of ${N} frames show previews`, { timeout: 15000 })
  await expect(modal.getByTestId('outputs-seq-frame-thumb')).toHaveCount(N)
  const start = api.state.fp.starts[0]
  expect(start.pod_id).toBe('pod-aaaaaaaa'); expect(start.skip_existing).toBe(true)
  expect(start.items).toEqual([{ src_dir: SUB, frames: N, stem: NAME }])
  expect(asked.filter((f) => /\.dpx$/.test(f))).toEqual([])   // no DPX frame was read over the network by this PC (the sequence's small .json colour record is, as always)
  expect(jpgs.length).toBeGreaterThanOrEqual(1); expect(jpgs[0]).toMatch(/\.jpg$/)
  // the JPEGs are read from the previews mirror tree, never from inside the frame folder
  expect(api.state.fp.lists.some((l) => l.names === true && l.items[0].src_dir === SUB)).toBe(true)
})

test('A frame the pod could not decode is marked with a warning and does not stop the others', async ({ page, api }) => {
  const { modal } = await setup(page, api)
  api.state.fp = { jobs: {}, written: {}, starts: [], lists: [], fail: { [SUB]: [3] } }
  await page.evaluate(() => { globalThis.__FP_POLL_MS__ = 50 })
  await modal.getByTestId('outputs-seq-toggle').click()
  await modal.getByTestId('outputs-seq-load-frames').click()
  await expect(modal.getByTestId('outputs-seq-preview-count')).toHaveText(`${N - 1} of ${N} frames show previews`, { timeout: 15000 })
  await expect(modal.getByTestId('outputs-seq-frame-warn')).toHaveCount(1)
  await expect(modal.getByTestId('outputs-seq-frame-warn')).toHaveAttribute('title', 'not a DPX')
})

test('Stop cancels the job from the header', async ({ page, api }) => {
  const { modal } = await setup(page, api)
  api.state.fpHold = true
  await modal.getByTestId('outputs-seq-toggle').click()
  await modal.getByTestId('outputs-seq-load-frames').click()
  await expect(modal.getByTestId('outputs-seq-stop-frames')).toBeVisible()
  await expect(modal.getByTestId('outputs-seq-job-progress')).toContainText(`of ${N}`)
  await modal.getByTestId('outputs-seq-stop-frames').click()
  expect(Object.values(api.state.fp.jobs)[0].state).toBe('cancelled')
  await expect(modal.getByTestId('outputs-seq-load-frames')).toBeVisible()
})

test('The Generate window has a mode choice: Sequence Previews as before, Frame Previews counts frames and runs the pod job over every in-scope sequence; Skip Existing applies to both; the choice is remembered', async ({ page, api }) => {
  await setup(page, api)
  await page.evaluate(() => { globalThis.__FP_POLL_MS__ = 50 })
  await page.getByTestId('pod-outputs-previews').click()
  const g = page.getByTestId('pod-outputs-previews-modal')
  // Sequence Previews is the default and unchanged
  await expect(g.getByTestId('pod-outputs-preview-mode')).toHaveAttribute('data-mode', 'sequence')
  await expect(g.getByTestId('pod-outputs-previews-option')).toHaveText('Load all previews')
  await expect(g.getByTestId('pod-outputs-load-previews')).toBeVisible()
  await expect(g.getByTestId('pod-outputs-previews-counts')).toContainText('ready ·')
  // Frame Previews: the label, the note, the counts (frames), the button
  await g.getByTestId('pod-outputs-mode-frame').click()
  await expect(g.getByTestId('pod-outputs-previews-option')).toHaveText('Load all frame previews')
  await expect(g.getByTestId('pod-outputs-previews-note')).toContainText('nothing large is read to this PC')
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText(`0 ready · ${N} waiting · 0 failed frames`)
  await expect(g.getByTestId('pod-outputs-load-previews')).toHaveCount(0)
  await expect(g.getByTestId('pod-outputs-load-frame-previews')).toHaveText(`Load All Frame Previews (${N})`)
  // Skip Existing unticked: the button says Regenerate and the job asks the pod to make every JPEG again
  await g.getByTestId('pod-outputs-previews-skip-existing').uncheck()
  await expect(g.getByTestId('pod-outputs-load-frame-previews')).toHaveText(`Regenerate All Frame Previews (${N})`)
  await g.getByTestId('pod-outputs-previews-skip-existing').check()
  await g.getByTestId('pod-outputs-load-frame-previews').click()
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText(`${N} ready · 0 waiting · 0 failed frames`, { timeout: 15000 })
  expect(api.state.fp.starts[0].items).toEqual([{ src_dir: SUB, frames: N, stem: NAME }]); expect(api.state.fp.starts[0].skip_existing).toBe(true)
  // nothing left to do: the button is disabled
  await expect(g.getByTestId('pod-outputs-load-frame-previews')).toBeDisabled()
  // the choice is remembered for the window session
  await g.getByRole('button', { name: 'Close', exact: true }).last().click(); await page.getByTestId('pod-outputs-previews').click()
  await expect(page.getByTestId('pod-outputs-previews-modal').getByTestId('pod-outputs-preview-mode')).toHaveAttribute('data-mode', 'frame')
  await page.getByTestId('pod-outputs-previews-modal').getByTestId('pod-outputs-mode-sequence').click()
  await expect(page.getByTestId('pod-outputs-previews-modal').getByTestId('pod-outputs-load-previews')).toBeVisible()
})

test('A failed Frame Previews job can be relaunched: same folders, finished frames skipped, no pod started; with no pod running the window says Resume A Pod first; Remove clears the job', async ({ page, api }) => {
  await setup(page, api)
  api.state.fpFailFirst = true
  await page.evaluate(() => { globalThis.__FP_POLL_MS__ = 50 })
  await page.getByTestId('pod-outputs-previews').click()
  const g = page.getByTestId('pod-outputs-previews-modal')
  await g.getByTestId('pod-outputs-mode-frame').click()
  await expect(g.getByTestId('pod-outputs-relaunch-frame-previews')).toHaveCount(0)   // nothing has run yet
  await g.getByTestId('pod-outputs-load-frame-previews').click()
  // the job fails (the pod went away): Relaunch and Remove appear, with what Relaunch does in the tooltip
  const relaunch = g.getByTestId('pod-outputs-relaunch-frame-previews')
  await expect(relaunch).toBeVisible({ timeout: 15000 })
  await expect(relaunch).toHaveText('Relaunch'); await expect(relaunch).toHaveAttribute('title', /finished frames are skipped.*no pod is started for you/)
  await expect(g.getByTestId('pod-outputs-remove-frame-job')).toHaveText('Remove')
  // no pod running: the answer names the stopped pod; a pod is never started by Relaunch; Resume Pod asks first
  api.state.fpNeedsPod = true
  await relaunch.click()
  const needs = g.getByTestId('pod-outputs-frames-needs-pod')
  await expect(needs).toContainText('No pod is running: Resume A Pod first'); await expect(needs).toContainText('ComfyUI-Landing')
  expect(api.state.fp.starts.length).toBe(1)   // nothing new was started
  let asked = ''
  page.once('dialog', async (d) => { asked = d.message(); await d.dismiss() })
  await g.getByTestId('pod-outputs-resume-pod').click()
  await expect.poll(() => asked).toContain('ComfyUI-Landing'); await expect(needs).toBeVisible()   // dismissed: still waiting
  // a pod is running now: Relaunch runs the same folders again as a new job (the old one is its relaunch_of) and the previews fill in
  api.state.fpNeedsPod = false
  await relaunch.click()
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText(`${N} ready · 0 waiting · 0 failed frames`, { timeout: 15000 })
  expect(api.state.fp.relaunches.length).toBe(2); expect(api.state.fp.relaunches[1].job_id).toBe('framepreviews-1')
  const again = Object.values(api.state.fp.jobs).find((j) => j.relaunch_of === 'framepreviews-1')
  expect(again.items.map((i) => i.src_dir)).toEqual([SUB]); expect(again.skip_existing).toBe(true)
  await expect(g.getByTestId('pod-outputs-needs-pod-row')).toHaveCount(0)
  // a finished job offers no Relaunch; Remove clears it from the window
  await expect(relaunch).toHaveCount(0)
  await g.getByTestId('pod-outputs-remove-frame-job').click()
  await expect(g.getByTestId('pod-outputs-remove-frame-job')).toHaveCount(0)
})

const allNames = () => Array.from({ length: N }, (_, n) => `${NAME}.${String(n).padStart(4, '0')}.jpg`)

test('Thumbnails first (Lucas, 2026-11-21: "I want the load for these previews faster"): with thumbnails on the pod the strip and the grid load the small ones, the tile shows the first frame\'s JPEG at once, and no DPX is read', async ({ page, api }) => {
  api.state.fp = { jobs: {}, written: { [SUB]: allNames() }, thumbs: { [SUB]: allNames() }, starts: [], lists: [], fail: {} }
  const { asked, jpgs, jpgSubs, modal } = await setup(page, api)
  await expect(modal.getByTestId('outputs-seq-strip')).toBeVisible()
  await expect(modal.getByTestId('outputs-seq-strip-frame').first()).toBeVisible()
  await expect(modal.getByTestId('outputs-dpx-quick')).toBeVisible()   // the first frame's 320 px JPEG, no click, no 50 MB frame
  await modal.getByTestId('outputs-seq-toggle').click()
  await expect(modal.getByTestId('outputs-seq-frame-thumb')).toHaveCount(N - 0, { timeout: 10000 })
  const thumbReqs = jpgSubs.filter((s) => /\/thumbs$/.test(s)), bigReqs = jpgSubs.filter((s) => !/\/thumbs$/.test(s))
  await expect.poll(() => jpgSubs.filter((s) => /\/thumbs$/.test(s)).length, { timeout: 10000 }).toBeGreaterThanOrEqual(N)   // the route handler answers asynchronously: wait for all N, never count at one instant
  expect(bigReqs.length).toBeLessThanOrEqual(2)   // only the tile's first frame (and at most one repeat) uses the 320 px image
  expect(new Set(jpgs).size).toBeLessThanOrEqual(N)
  expect(asked.filter((f) => /\.dpx$/.test(f))).toEqual([])
})

test('Without thumbnails the strip falls back to the 320 px JPEGs (nothing breaks before thumbnails exist)', async ({ page, api }) => {
  api.state.fp = { jobs: {}, written: { [SUB]: allNames() }, thumbs: {}, starts: [], lists: [], fail: {} }
  const { jpgSubs, modal } = await setup(page, api)
  await expect(modal.getByTestId('outputs-seq-strip')).toBeVisible()
  await expect(modal.getByTestId('outputs-seq-strip-frame').first()).toBeVisible()
  expect(jpgSubs.filter((s) => /\/thumbs$/.test(s))).toEqual([])   // nothing to load but the fallback
  expect(jpgSubs.length).toBeGreaterThan(0)
})

const VIDEO = { filename: 'review_final.mp4', subfolder: 'assembly_v024/review025_parts', type: 'output' }

test('Video tiles show the pod\'s poster JPEG with no capture; no player lives in the tile and a click opens the modal viewer', async ({ page, api }) => {
  api.state.fp = { jobs: {}, written: {}, thumbs: {}, posters: { [VIDEO.subfolder]: [`${VIDEO.filename}.jpg`] }, starts: [], lists: [], fail: {} }
  const { asked, jpgSubs, modal } = await setup(page, api, [VIDEO])
  const poster = modal.getByTestId('outputs-video-poster').first()
  await expect(poster).toBeVisible(); await expect(poster).toHaveAttribute('data-poster', 'yes')
  await expect(modal.getByTestId('outputs-video-poster-img').first()).toBeVisible()
  expect(jpgSubs.some((s) => /\.previews\/assembly_v024\/review025_parts\/posters$/.test(s))).toBe(true)   // the small poster JPEG was read
  expect(await page.evaluate(() => globalThis.__videoThumb.started)).toBe(0)   // a poster exists: nothing is captured
  await expect(modal.locator('video')).toHaveCount(0)   // no <video> in the tile
  expect(asked).not.toContain(VIDEO.filename)   // and the video file itself was not requested
  await poster.click()   // the click is the tile's: the modal viewer opens on the video
  await expect(page.getByTestId('output-viewer')).toBeVisible()
  await expect(page.getByTestId('output-viewer-video')).toHaveAttribute('src', /review_final\.mp4/)
  await expect(modal.getByTestId('outputs-video-player')).toHaveCount(0)
})

test('A video with no poster whose codec the page cannot decode keeps the film icon with a tooltip, is tried once (cached across opens), and the Load Frame Previews job asks the pod for its poster', async ({ page, api }) => {
  api.state.fp = { jobs: {}, written: {}, thumbs: {}, posters: {}, starts: [], lists: [], fail: {} }
  const { modal } = await setup(page, api, [VIDEO])   // the fake pod answers the .mp4 with bytes that are no movie
  await page.evaluate(() => { globalThis.__FP_POLL_MS__ = 50 })
  await expect(modal.getByTestId('outputs-video-poster').first()).toHaveAttribute('title', 'Preview not available in this player', { timeout: 15000 })
  await expect(modal.getByTestId('outputs-video-poster').first()).toHaveAttribute('data-poster', 'no')
  await expect(modal.getByTestId('outputs-video-poster-img')).toHaveCount(0); await expect(modal.getByTestId('outputs-video-frame-img')).toHaveCount(0); await expect(modal.locator('video')).toHaveCount(0)
  expect(await page.evaluate(() => ({ s: globalThis.__videoThumb.started, f: globalThis.__videoThumb.failed }))).toEqual({ s: 1, f: 1 })
  await page.getByTestId('pod-outputs-previews').click()
  const g = page.getByTestId('pod-outputs-previews-modal')
  await g.getByTestId('pod-outputs-mode-frame').click()
  await g.getByTestId('pod-outputs-load-frame-previews').click()
  await expect.poll(() => api.state.fp.starts.length).toBe(1)
  const items = api.state.fp.starts[0].items
  expect(items.find((i) => i.src_dir === VIDEO.subfolder)).toEqual({ src_dir: VIDEO.subfolder, kind: 'posters' })   // the same job, one item per video folder
  expect(items.find((i) => i.src_dir === SUB).kind).toBeUndefined()
})

// Lucas, 2026-11-21: "i wanted that to have a thumbnail of the first frame", "clicking the video should open up the modal player", a Main Video tile beside the sequence, the video's own aspect ratio,
// and the collapsed group filling a row. The fake pod serves a real tiny VP8 WebM (64x48, 4:3), so the page can capture its first frame.
const CLIPS = Array.from({ length: 12 }, (_, i) => ({ filename: `clip_${String(i).padStart(2, '0')}.webm`, subfolder: 'assembly_v024/movie', type: 'output' }))
const videoGroup = (modal) => modal.locator('[data-testid="outputs-group"][data-cat="video"]')

test('A collapsed Videos group fills one row (Main first) and ends with a "+N more" tile; the first frames are captured lazily, two at a time, nothing left playing, in the video\'s own 4:3 ratio, and Expand shows the rest', async ({ page, api }) => {
  api.state.fp = { jobs: {}, written: {}, thumbs: {}, posters: {}, starts: [], lists: [], fail: {} }
  const { modal } = await setup(page, api, CLIPS)
  const g = videoGroup(modal)
  await expect(g).toHaveAttribute('data-expanded', 'false')
  const strip = g.getByTestId('outputs-group-preview')
  await expect(strip).toBeVisible()
  const shown = Number(await strip.getAttribute('data-shown')), more = Number(await strip.getAttribute('data-more'))
  expect(shown).toBeGreaterThan(1); expect(more).toBeGreaterThan(0); expect(shown + more).toBe(CLIPS.length)   // a full row minus the '+N more' slot, and the rest counted
  await expect(strip.getByTestId('outputs-group-tile')).toHaveCount(shown)
  await expect(strip.getByTestId('outputs-group-more-tile')).toHaveText(`+${more} More`)
  await expect(strip.getByTestId('outputs-group-main-name')).toContainText('clip_00.webm')   // Main first
  await expect.poll(() => strip.locator('[data-poster="frame"]').count(), { timeout: 20000 }).toBe(shown)   // every visible tile got its first frame
  const st = await page.evaluate(() => globalThis.__videoThumb)
  expect(st.max).toBeLessThanOrEqual(2); expect(st.started).toBeLessThanOrEqual(shown + 1)   // two at a time, only the visible ones (the Main Video tile shares clip_00's capture)
  await expect(modal.locator('video')).toHaveCount(0)   // nothing left playing
  const box = await strip.getByTestId('outputs-video-poster').first().boundingBox()
  expect(Math.abs(box.width / box.height - 4 / 3)).toBeLessThan(0.06)   // the tile's own ratio, not a 16:9 box
  await expect(strip.getByTestId('outputs-video-poster').first()).toHaveAttribute('data-ratio', '1.333')
  await strip.getByTestId('outputs-group-tile').first().click()   // a tile opens the modal player
  await expect(page.getByTestId('output-viewer')).toBeVisible(); await expect(page.getByTestId('output-viewer-video')).toHaveAttribute('src', /clip_00\.webm/)
  await page.keyboard.press('Escape'); await expect(page.getByTestId('output-viewer')).toHaveCount(0)
  await strip.getByTestId('outputs-group-more-tile').click()   // '+N more' is Expand
  await expect(g).toHaveAttribute('data-expanded', 'true')
  await expect(g.getByTestId('outputs-group-row')).toHaveCount(CLIPS.length)
  await expect(g.getByTestId('outputs-group-shown')).toContainText(`${CLIPS.length} of ${CLIPS.length}`)
})

test('A second open reuses the captured first frames (no new capture), and the Main Video tile beside the sequence shows the main video with the same thumbnail and opens the player', async ({ page, api }) => {
  api.state.fp = { jobs: {}, written: {}, thumbs: {}, posters: {}, starts: [], lists: [], fail: {} }
  const { modal } = await setup(page, api, CLIPS)
  const main = modal.getByTestId('outputs-main-video')
  await expect(main).toBeVisible()
  await expect(main.getByTestId('outputs-main-video-label')).toHaveText('Main Video'); await expect(main.getByTestId('outputs-main-video-name')).toContainText('clip_00.webm')
  await expect(main.locator('[data-poster="frame"]')).toBeVisible({ timeout: 20000 })
  const seq = modal.getByTestId('outputs-tile').first(), a = await seq.boundingBox(), b = await main.boundingBox()
  expect(b.x).toBeGreaterThan(a.x + a.width - 2); expect(Math.abs(b.y - a.y)).toBeLessThan(4)   // directly beside the sequence tile, on its row
  await expect(modal.locator('video')).toHaveCount(0)
  const started = await page.evaluate(() => globalThis.__videoThumb.started)
  await page.keyboard.press('Escape')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await expect(modal.getByTestId('outputs-main-video').locator('[data-poster="frame"]')).toBeVisible()
  expect(await page.evaluate(() => globalThis.__videoThumb.started)).toBe(started)   // the cache answered: no new capture
  expect(await page.evaluate(() => globalThis.__videoThumb.hits)).toBeGreaterThan(0)
  await modal.getByTestId('outputs-main-video').click()
  await expect(page.getByTestId('output-viewer-video')).toHaveAttribute('src', /clip_00\.webm/)
})

test('No main video beside the sequence when the folder has no videos', async ({ page, api }) => {
  const { modal } = await setup(page, api)
  await expect(modal.getByTestId('outputs-tile').first()).toBeVisible()
  await expect(modal.getByTestId('outputs-main-video')).toHaveCount(0)
})

test('Generation Errors: hidden when nothing failed; after a failed Frame Previews job it shows collapsed with the folder, the reason and the time, and Relaunch runs the job again', async ({ page, api }) => {
  const { modal } = await setup(page, api)
  await expect(modal.getByTestId('pod-outputs-generation-errors')).toHaveCount(0)
  api.state.fpFailFirst = true
  await page.evaluate(() => { globalThis.__FP_POLL_MS__ = 50 })
  await page.getByTestId('pod-outputs-previews').click()
  const g = page.getByTestId('pod-outputs-previews-modal')
  await g.getByTestId('pod-outputs-mode-frame').click()
  await g.getByTestId('pod-outputs-load-frame-previews').click()
  await expect(g.getByTestId('pod-outputs-relaunch-frame-previews')).toBeVisible({ timeout: 15000 })
  await g.getByRole('button', { name: 'Close', exact: true }).last().click()
  const errs = modal.getByTestId('pod-outputs-generation-errors')
  await expect(errs).toBeVisible(); await expect(errs).toHaveJSProperty('open', false)   // collapsed by default
  await expect(modal.getByTestId('pod-outputs-generation-errors-summary')).toContainText('Generation Errors (1)')
  await modal.getByTestId('pod-outputs-generation-errors-summary').click()
  const row = modal.getByTestId('pod-outputs-generation-error').first()
  await expect(row).toContainText('the script ended with code 255'); await expect(row).toContainText(SUB)
  await expect(row).toContainText(/\d/)   // the time
  await modal.getByTestId('pod-outputs-errors-relaunch').click()
  await expect.poll(() => (api.state.fp.relaunches || []).length).toBe(1)
  await expect(modal.getByTestId('pod-outputs-generation-errors')).toHaveCount(0, { timeout: 15000 })   // the relaunch finished: nothing left to show
})

// Lucas, 2026-11-21: "main video should have a preview instead of a black box", "the icon should be a fallback", "do same for images", "we don't need the play button too, the icon is enough", and the run's data
// files as a `Data File` button and popup. A video tile shows its poster, else its captured first frame, else a shimmer while it is on its way; the film icon only after a definite failure; no corner button.
const CLIP = { filename: 'clip_a.webm', subfolder: 'assembly_v024/movie', type: 'output' }
const NOFP = () => ({ jobs: {}, written: {}, thumbs: {}, posters: {}, starts: [], lists: [], fail: {} })

test('A video tile with a real picture has no corner play button: a centred play glyph shows on hover only, and there is no film icon at rest', async ({ page, api }) => {
  api.state.fp = NOFP()
  const { modal } = await setup(page, api, [CLIP])
  const tile = modal.getByTestId('outputs-video-poster').first()
  await expect(tile).toHaveAttribute('data-poster', 'frame', { timeout: 20000 })
  await expect(tile.locator('.fa-circle-play')).toHaveCount(0)            // the corner button is gone
  await expect(tile.getByTestId('outputs-video-fallback')).toHaveCount(0) // no icon with a real picture
  const glyph = tile.locator('.vhover')
  await expect(glyph).toHaveCSS('opacity', '0')                            // at rest: nothing on the picture
  await tile.hover()
  await expect(glyph).toHaveCSS('opacity', '1')                            // hover: the centred play glyph
  const t = await tile.boundingBox(), g = await glyph.boundingBox()
  expect(Math.abs(g.x + g.width / 2 - (t.x + t.width / 2))).toBeLessThan(3); expect(Math.abs(g.y + g.height / 2 - (t.y + t.height / 2))).toBeLessThan(3)
})

test('While a capture is on its way the tile shows a shimmer, never the film icon; the frame replaces it', async ({ page, api }) => {
  api.state.fp = NOFP()
  const { modal } = await setup(page, api, [CLIP], { slowMs: 2500 })
  const tile = modal.getByTestId('outputs-video-poster').first()
  await expect(tile).toHaveAttribute('data-poster', 'pending')
  await expect(tile.getByTestId('outputs-video-loading')).toBeVisible()
  await expect(tile.getByTestId('outputs-video-fallback')).toHaveCount(0)
  await expect(tile).toHaveAttribute('data-poster', 'frame', { timeout: 20000 })
  await expect(tile.getByTestId('outputs-video-loading')).toHaveCount(0)
})

test('A capture that times out shows the film icon with a retry glyph (not the tile): one retry re-queues it, a second time-out leaves the icon without a retry; the tile still opens the player', async ({ page, api }) => {
  api.state.fp = NOFP()
  const { modal, webmReqs } = await setup(page, api, [CLIP], { slowMs: 3000, timeoutMs: 400 })
  const tile = modal.getByTestId('outputs-video-poster').first()
  await expect(tile).toHaveAttribute('data-poster', 'no', { timeout: 15000 })
  await expect(tile).toHaveAttribute('title', 'Preview timed out: Retry')
  await expect(tile.getByTestId('outputs-video-fallback')).toBeVisible()
  const retry = tile.getByTestId('outputs-video-retry')
  await expect(retry).toBeVisible(); await expect(retry).toHaveAttribute('aria-label', 'Retry Preview')
  const before = webmReqs.length
  await retry.click()
  await expect(page.getByTestId('output-viewer')).toHaveCount(0)           // the retry glyph is not the tile's click
  await expect.poll(() => webmReqs.length, { timeout: 10000 }).toBeGreaterThan(before)   // re-queued
  await expect(tile).toHaveAttribute('data-poster', 'no', { timeout: 15000 })
  await expect(tile.getByTestId('outputs-video-retry')).toHaveCount(0)      // one retry only
  await tile.click()
  await expect(page.getByTestId('output-viewer')).toBeVisible()             // the tile itself opens the modal player
})

test('Image tiles show the image itself (shimmer until it loads) and fall back to the image icon on an error; an image over 25 MB shows the icon with a tooltip and is never requested', async ({ page, api }) => {
  api.state.fp = NOFP()
  const imgs = [
    { filename: 'ok_a.png', subfolder: 'stills', type: 'output' },
    { filename: 'bad_b.png', subfolder: 'stills', type: 'output' },
    { filename: 'big_c.png', subfolder: 'stills', type: 'output', bytes: 30 * 1024 * 1024 },
  ]
  const { asked, modal } = await setup(page, api, imgs)
  const box = (n) => modal.getByTestId('outputs-image-box').nth(n)
  await expect(modal.getByTestId('outputs-image-box')).toHaveCount(3)
  await expect(box(0)).toHaveAttribute('data-state', 'ready', { timeout: 15000 })     // ok_a.png: a real thumbnail
  await expect(box(0).getByTestId('outputs-image-thumb')).toBeVisible()
  await expect(box(1)).toHaveAttribute('data-state', 'failed', { timeout: 15000 })    // bad_b.png: 404 -> the icon
  await expect(box(1).getByTestId('outputs-image-fallback')).toBeVisible()
  await expect(box(2)).toHaveAttribute('data-state', 'toobig')                         // big_c.png: over 25 MB -> icon + tooltip
  await expect(box(2)).toHaveAttribute('title', 'Too large to preview')
  expect(asked.filter((f) => f === 'big_c.png')).toEqual([])                          // never requested
})

test('Data files are one `Data File` button right of the Main Video tile (no Data File group in the body); a click opens a popup with the pretty-printed JSON, Copy and Download; Esc closes only the popup', async ({ page, api }) => {
  api.state.fp = NOFP()
  const DATA = { filename: 'run_meta.json', subfolder: 'assembly_v024/movie', type: 'output', bytes: 61 }
  const custom = async (f, r) => (f === 'run_meta.json' ? (await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"graph":"base_v008","frames":212,"nested":{"a":[1,2]}}' }), true) : false)
  const { modal } = await setup(page, api, [CLIP, DATA], { custom })
  await expect(modal.locator('[data-testid="outputs-group"][data-cat="data"]')).toHaveCount(0)   // no Data File group
  const btn = modal.getByTestId('outputs-data-button')
  await expect(btn).toHaveText('Data File')
  const main = modal.getByTestId('outputs-main-video'), a = await main.boundingBox(), b = await btn.boundingBox()
  expect(b.x).toBeGreaterThan(a.x + a.width - 2)                                    // directly to the RIGHT of the Main Video tile
  expect(Math.abs((b.y + b.height / 2) - (a.y + a.height / 2))).toBeLessThan(a.height / 2)   // on the same row, vertically within the tile
  await btn.click()
  const pop = page.getByTestId('datafile-modal')
  await expect(pop).toBeVisible()
  await expect(pop.getByTestId('datafile-title')).toHaveText('run_meta.json')
  await expect(pop.getByTestId('datafile-text')).toContainText('"frames": 212')      // pretty-printed (two-space indent), not the one-line original
  await expect(pop.getByTestId('datafile-copy')).toBeVisible(); await expect(pop.getByTestId('datafile-download')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  await expect(modal.getByTestId('outputs-gallery')).toBeVisible()                   // Esc closed the popup only
})

test('An error loading a data file shows the reason with Retry; a name with no text type is not a data file', async ({ page, api }) => {
  api.state.fp = NOFP()
  let hits = 0
  const custom = async (f, r) => {
    if (f !== 'flaky.json') return false
    hits++
    await (hits === 1 ? r.fulfill({ status: 500, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'x' }) : r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' }))
    return true
  }
  const { modal } = await setup(page, api, [CLIP, { filename: 'flaky.json', subfolder: 'assembly_v024/movie', type: 'output' }, { filename: 'blob.bin', subfolder: 'assembly_v024/movie', type: 'output', bytes: 2048 }], { custom })
  const btn = modal.getByTestId('outputs-data-button')
  await expect(btn).toHaveText('Data File')                                         // blob.bin has no data extension: only flaky.json counts
  await btn.click()
  const pop = page.getByTestId('datafile-modal')
  await expect(pop.getByTestId('datafile-error')).toBeVisible({ timeout: 10000 })
  await pop.getByTestId('datafile-retry').click()
  await expect(pop.getByTestId('datafile-text')).toContainText('"ok": true')
  await page.keyboard.press('Escape')
})

test('No Data File button when the run has no data file', async ({ page, api }) => {
  api.state.fp = NOFP()
  const { modal } = await setup(page, api, [CLIP])
  await expect(modal.getByTestId('outputs-main-video')).toBeVisible()
  await expect(modal.getByTestId('outputs-data-button')).toHaveCount(0)
})

// Lucas, 2026-11-21: the `Data File` button was "too tiny and doesn't work for me": it is a TILE now, like the old data-file tile (the filled file icon centred in a dark box), as tall as the sequence and Main Video
// pictures, about 9.5rem wide, a label under it, the whole tile the click target (mouse, Enter, Space).
test('The Data File is a tile right of the Main Video: filled file icon, the pictures share one height, a real mouse click by coordinates opens the popup, Enter and Space do too', async ({ page, api }) => {
  api.state.fp = NOFP()
  const DATA = { filename: 'run_meta.json', subfolder: 'assembly_v024/movie', type: 'output', bytes: 61 }
  const custom = async (f, r) => (f === 'run_meta.json' ? (await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"graph":"base_v008","frames":212}' }), true) : false)
  const { modal } = await setup(page, api, [CLIP, DATA], { custom })
  const tile = modal.getByTestId('outputs-data-button')
  await expect(tile).toBeVisible()
  await expect(tile.getByTestId('outputs-data-icon').locator('i.fa-solid.fa-file')).toBeVisible()   // the filled file icon
  await expect(tile.getByTestId('outputs-data-label')).toHaveText('Data File')
  const seqPic = await modal.getByTestId('outputs-dpx-placeholder').first().boundingBox(), icon = await tile.getByTestId('outputs-data-icon').boundingBox(), vid = await modal.getByTestId('outputs-main-video').getByTestId('outputs-video-poster').boundingBox()
  expect(Math.abs(icon.height - seqPic.height)).toBeLessThan(1); expect(Math.abs(vid.height - seqPic.height)).toBeLessThan(1)   // one picture height across the row
  const tb = await tile.boundingBox()
  expect(tb.width).toBeGreaterThan(130); expect(tb.width).toBeLessThan(175)                       // about the old tile (9.5rem)
  await expect(tile).toHaveCSS('cursor', 'pointer')
  await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2)                                // a real click at the tile's centre: nothing sits on top of it
  const pop = page.getByTestId('datafile-modal')
  await expect(pop).toBeVisible(); await expect(pop.getByTestId('datafile-text')).toContainText('"frames": 212')
  await page.keyboard.press('Escape'); await expect(pop).toHaveCount(0)
  await tile.focus(); await page.keyboard.press('Enter')
  await expect(pop).toBeVisible(); await page.keyboard.press('Escape'); await expect(pop).toHaveCount(0)
  await tile.focus(); await page.keyboard.press('Space')
  await expect(pop).toBeVisible(); await page.keyboard.press('Escape')
})

test('A slow data file ends in an error with Retry, never an endless spinner', async ({ page, api }) => {
  api.state.fp = NOFP()
  await page.addInitScript(() => { globalThis.__DATA_TIMEOUT_MS__ = 600 })
  let hits = 0
  const custom = async (f, r) => {
    if (f !== 'slow.json') return false
    hits++
    if (hits === 1) { await new Promise((res) => setTimeout(res, 3000)); await r.abort().catch(() => {}); return true }
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":1}' }); return true
  }
  const { modal } = await setup(page, api, [CLIP, { filename: 'slow.json', subfolder: 'assembly_v024/movie', type: 'output' }], { custom })
  await modal.getByTestId('outputs-data-button').click()
  const pop = page.getByTestId('datafile-modal')
  await expect(pop.getByTestId('datafile-error')).toContainText('did not arrive in time', { timeout: 10000 })
  await pop.getByTestId('datafile-retry').click()
  await expect(pop.getByTestId('datafile-text')).toContainText('"ok": 1')
})

// Lucas, 2026-11-21: "main video should match aspect video for preview, you made it skinnier": the picture box of a video takes the video's OWN aspect ratio (width = height x ratio), so a 16:9 poster is a
// 16:9 box, a 4:3 one 4:3, a portrait one 9:16; the Main Video tile's picture is as tall as the sequence tile's picture. PNGs of the wanted sizes are served as the pod's poster JPEGs (the page decodes by content).
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const pngChunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]) }
const png = (w, h) => {   // a flat grey RGB PNG of w x h
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x70); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}
const MV = { filename: 'main_one.mp4', subfolder: 'assembly_v024/movie', type: 'output' }
async function ratioRun(page, api, w, h) {
  api.state.fp = { jobs: {}, written: {}, thumbs: {}, posters: { [MV.subfolder]: [`${MV.filename}.jpg`] }, starts: [], lists: [], fail: {} }
  const body = png(w, h)
  const custom = async (f, r) => (f === `${MV.filename}.jpg` ? (await r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body }), true) : false)
  const { modal } = await setup(page, api, [MV], { custom })
  const main = modal.getByTestId('outputs-main-video')
  await expect(main).toBeVisible()
  const poster = main.getByTestId('outputs-video-poster')
  await expect(poster).toHaveAttribute('data-poster', 'yes', { timeout: 15000 })
  await expect.poll(async () => poster.getAttribute('data-ratio'), { timeout: 15000 }).toBe((w / h).toFixed(3))   // the poster's natural size is known
  return { modal, main, poster }
}
for (const [name, w, h] of [['16:9', 320, 180], ['4:3', 320, 240], ['portrait 9:16', 180, 320]]) {
  test(`Main Video tile: a ${name} poster gives a picture box of that ratio, as tall as the sequence tile's picture`, async ({ page, api }) => {
    const { modal, main, poster } = await ratioRun(page, api, w, h)
    const b = await poster.boundingBox(), tile = await main.boundingBox()
    expect(Math.abs(b.width / b.height / (w / h) - 1)).toBeLessThan(0.01)   // the video's own ratio, not squeezed to its caption (it was a 142 x 152 box for 16:9)
    const seqPic = await modal.getByTestId('outputs-dpx-placeholder').first().boundingBox()
    expect(Math.abs(b.height - seqPic.height)).toBeLessThan(1)               // as tall as the sequence tile's picture
    expect(tile.width).toBeGreaterThanOrEqual(b.width)                        // the tile holds the whole picture: nothing is clipped
  })
}

test('With Show Stereoscopic Outputs on, the Left Eye card plays the main video instead of a still', async ({ page, api }) => {
  await page.addInitScript(() => { try { localStorage.setItem('outputs.showStereo', 'true') } catch {} })
  api.state.fp = { jobs: {}, written: {}, thumbs: {}, posters: {}, starts: [], lists: [], fail: {} }
  const { modal } = await setup(page, api, CLIPS)
  const card = modal.locator('[data-testid="outputs-eye-card"][data-role="left"]')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('outputs-eye-video')).toBeVisible()
  await expect(card.getByTestId('outputs-eye-picture')).toHaveCount(0)
})
