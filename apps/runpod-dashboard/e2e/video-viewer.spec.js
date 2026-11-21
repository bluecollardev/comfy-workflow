import fs from 'node:fs'
import { test, expect, podCard } from './fixtures'

// The Outputs viewer's video player (docs/ADR-037 amendment 2026-11-17): the shared transport bar (Play/Pause on Space, frame step, speed, Loop, timecode) and the message for a codec the engine cannot play.
const WEBM = fs.readFileSync(new URL('./media/tiny.webm', import.meta.url))   // 2 s, 64x48, 24 fps VP8, made with ffmpeg testsrc
let delay = 0
async function open(page, api, name) {
  api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'ffffffff-1111-2222', workflow: 'rounds/r1/v/clip.json', status: 'success', started_at: '2026-11-17T10:00:00Z', duration_s: 3, cost_estimate: 0,
    outputs: [{ filename: 'clip.webm', subfolder: 'v', type: 'output' }, { filename: 'broken.mov', subfolder: 'v', type: 'output' }] })
  await page.context().route('**/view?*', async (r) => {   // with Range support, as the pod's ComfyUI has; `delay` makes the pod slow to answer
    if (delay) await new Promise((x) => setTimeout(x, delay))
    const f = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1]), body = f === 'clip.webm' ? WEBM : Buffer.from('this is not a movie, ProRes or otherwise')
    const type = f === 'clip.webm' ? 'video/webm' : 'video/quicktime', range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '')
    const h = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' }
    if (!range) return r.fulfill({ status: 200, contentType: type, headers: h, body })
    const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
    return r.fulfill({ status: 206, contentType: type, headers: { ...h, 'content-range': `bytes ${a}-${b}/${body.length}` }, body: body.subarray(a, b + 1) })
  })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  // the name opens the viewer; a click on a video's picture plays it inline since the thumbnails change (a poster, no player until play: outputs-frame-previews.spec.js)
  await page.getByTestId('pod-outputs-modal').locator(`[title="${name}"]:is([data-testid="outputs-tile"], [data-testid="outputs-group-row"])`).locator('.gname, [data-testid="outputs-tile-name"]').first().click()
  return page.getByTestId('output-viewer')
}
const vid = (v) => v.getByTestId('output-viewer-video')
const state = (v) => vid(v).evaluate((e) => ({ t: e.currentTime, paused: e.paused, rate: e.playbackRate, loop: e.loop, d: e.duration, ready: e.readyState }))

test('video viewer: Space plays and pauses, arrows step one frame (Shift ten) at the chosen fps, speed and Loop apply, the timecode follows', async ({ page, api }) => {
  const v = await open(page, api, 'clip.webm')
  await expect.poll(async () => (await state(v)).ready).toBeGreaterThanOrEqual(2)
  await vid(v).evaluate((e) => e.pause())
  const play = v.getByTestId('output-viewer-tp-play')
  await expect(play).toHaveAttribute('data-playing', 'false')
  await page.keyboard.press('Space'); await expect(play).toHaveAttribute('data-playing', 'true')
  await expect.poll(async () => (await state(v)).t).toBeGreaterThan(0.1)   // it is playing
  await page.keyboard.press('Space'); await expect(play).toHaveAttribute('data-playing', 'false'); expect((await state(v)).paused).toBe(true)
  await play.click(); await expect(play).toHaveAttribute('data-playing', 'true'); await play.click()   // the button does the same
  await vid(v).evaluate((e) => { e.currentTime = 0 })
  await expect(v.getByTestId('output-viewer-tp-frame')).toContainText('00:00:00 / 00:02:00')   // mm:ss:ff at 24 fps
  await page.keyboard.press('ArrowRight')
  let s = await state(v); expect(s.t).toBeGreaterThan(0.04); expect(s.t).toBeLessThan(0.084)   // one frame at 24 fps
  await page.keyboard.press('Shift+ArrowRight')
  s = await state(v); expect(s.t).toBeGreaterThan(0.45); expect(s.t).toBeLessThan(0.5)   // and ten more
  await expect(v.getByTestId('output-viewer-tp-frame')).toContainText('00:00:11 /')
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft')
  s = await state(v); expect(s.t).toBeGreaterThan(0.37); expect(s.t).toBeLessThan(0.42)
  await v.getByTestId('output-viewer-tp-fps').selectOption('25')
  await vid(v).evaluate((e) => { e.currentTime = 1 }); await page.keyboard.press('ArrowRight')
  s = await state(v); expect(s.t).toBeGreaterThan(1.04); expect(s.t).toBeLessThan(1.08)   // 1/25 s
  await v.getByTestId('output-viewer-tp-next').click()   // the transport's own step button (not the file's Next)
  expect((await state(v)).t).toBeGreaterThan(1.08)
  await v.getByTestId('output-viewer-tp-speed').selectOption('0.5'); expect((await state(v)).rate).toBe(0.5)
  await v.getByTestId('output-viewer-tp-speed').selectOption('2'); expect((await state(v)).rate).toBe(2)
  await expect(v.getByTestId('output-viewer-tp-loop')).toBeChecked(); expect((await state(v)).loop).toBe(true)
  await v.getByTestId('output-viewer-tp-loop').uncheck(); expect((await state(v)).loop).toBe(false)
  await v.getByTestId('output-viewer-tp-slider').fill('0.5'); expect(Math.abs((await state(v)).t - 0.5)).toBeLessThan(0.05)   // the scrubber seeks (needs Range, served above)
  await expect(v.getByTestId('output-viewer-codec')).toHaveCount(0)
  await expect(v.getByTestId('output-viewer-open')).toBeVisible(); await expect(v.getByTestId('output-viewer-download')).toBeVisible()
  await page.keyboard.press('Escape'); await expect(v).toHaveCount(0)
})

test('video viewer: a file the engine cannot decode shows the codec message with Download and DJV instead of a black frame', async ({ page, api }) => {
  const v = await open(page, api, 'broken.mov')
  await expect(v.getByTestId('output-viewer-codec')).toContainText('cannot be played')
  await expect(v.getByTestId('output-viewer-codec')).toContainText('DJV')
  await expect(v.getByTestId('output-viewer-download')).toBeVisible()
  await expect(v.getByTestId('output-viewer-tp-play')).toBeDisabled()
})

test('video viewer: says "Loading video…" while the video is on its way, then shows the player', async ({ page, api }) => {
  delay = 1500
  try {
    const v = await open(page, api, 'clip.webm')
    await expect(v.getByTestId('output-viewer-loading')).toHaveText('Loading video…')
    await expect(v.getByTestId('output-viewer-loading')).toBeHidden({ timeout: 10000 })
    await expect.poll(async () => (await state(v)).ready).toBeGreaterThanOrEqual(2)
  } finally { delay = 0 }
})

test('video viewer: a codec the engine cannot play replaces "Loading video…" with its own message', async ({ page, api }) => {
  const v = await open(page, api, 'broken.mov')
  await expect(v.getByTestId('output-viewer-codec')).toBeVisible({ timeout: 10000 })
  await expect(v.getByTestId('output-viewer-loading')).toHaveCount(0)
})
