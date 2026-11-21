import { test, expect, podCard } from './fixtures'
import fs from 'node:fs'
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

async function setup(page, api, extra = []) {
  const outputs = [...extra]
  for (let n = 0; n < N; n++) outputs.push({ filename: `${NAME}.${String(n).padStart(4, '0')}.dpx`, subfolder: SUB, type: 'output' })
  api.state.history.runs['pod-aaaaaaaa'] = [{ prompt_id: 'dddddddd-1111-2222', workflow: 'x.json', status: 'success', started_at: '2026-11-21T14:39:00Z', duration_s: 10, outputs }]
  const asked = [], jpgs = [], jpgSubs = [], webmReqs = []
  await page.context().route('**/view?*', (r) => {
    const f = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1])
    if (/\.webm$/.test(f)) {   // a real (tiny, VP8) video the page can decode, served with Range as the pod does
      webmReqs.push(f)
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
  expect(thumbReqs.length).toBeGreaterThanOrEqual(N)
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
