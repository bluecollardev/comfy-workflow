import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// ADR-058: each sequence in the Outputs modal fills one of four slots, Overall, Left Eye, Right Eye, Side By Side. A name with no token is the left eye (today's mono deliveries); an empty slot reads "Not Generated".
// The right eye and overall files do not exist yet, so these are fixture names.
const SUB = 'delivery_v008/clip'
const tinyDpx = () => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const seq = (stem, n = 3) => Array.from({ length: n }, (_, i) => ({ filename: `${stem}.${String(i).padStart(4, '0')}.dpx`, subfolder: SUB, type: 'output' }))
const run = (outputs) => ({ prompt_id: 'eeeeeeee-1111-2222', workflow: 'x.json', status: 'success', started_at: '2026-11-25T15:00:00Z', duration_s: 10, outputs })

async function open(page, api, outputs) {
  api.state.history.runs['pod-aaaaaaaa'] = [run(outputs)]
  await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tinyDpx() }))
  await page.addInitScript(() => { try { localStorage.setItem('outputs.showStereo', 'true') } catch {} })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  return page.getByTestId('pod-outputs-modal')
}

test('A mono delivery (no token) is the Left Eye; Overall and Right Eye read Not Generated', async ({ page, api }) => {
  const m = await open(page, api, seq('clip_v008'))
  await expect(m.getByTestId('outputs-eye-role')).toHaveCount(1)
  await expect(m.getByTestId('outputs-eye-role')).toHaveText('Left Eye')
  const empty = m.getByTestId('outputs-eye-slot')
  await expect(empty).toHaveCount(3)
  await expect(empty.nth(0)).toHaveAttribute('data-eye', 'overall')
  await expect(empty.nth(1)).toHaveAttribute('data-eye', 'right')
  await expect(empty.nth(0)).toContainText('Overall')
  await expect(empty.nth(0)).toContainText('Not Generated')
  await expect(empty.nth(1)).toContainText('Right Eye')
  await expect(empty.nth(1)).toContainText('Not Generated')
  // the filled slot keeps its tile, and an empty one is not a failure
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(1)
  await expect(m.getByTestId('outputs-seq-job-error')).toHaveCount(0)
})

test('A stereo element shows four filled slots in the order Overall, Left Eye, Right Eye, Side By Side, each with its own tile', async ({ page, api }) => {
  const m = await open(page, api, [...seq('clip_v008_R'), ...seq('clip_v008_L'), ...seq('clip_v008_PACK'), ...seq('clip_v008_SBS')])
  const roles = m.getByTestId('outputs-eye-role')
  await expect(roles).toHaveCount(4)
  await expect(roles).toHaveText(['Overall', 'Left Eye', 'Right Eye', 'Side By Side'])
  await expect(m.getByTestId('outputs-eye-slot')).toHaveCount(0)
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(4)
  await expect(m.getByTestId('outputs-seq-toggle')).toHaveCount(4)   // each slot collapses and expands on its own, as a sequence does today
  // the four slots' pictures sit on one row
  const tops = await m.locator('[data-testid="outputs-eye-card"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
  expect(tops).toHaveLength(4)
  expect(new Set(tops).size).toBe(1)
})

test('A right eye alone leaves Overall and Left Eye empty', async ({ page, api }) => {
  const m = await open(page, api, seq('clip_v008_RIGHT'))
  await expect(m.getByTestId('outputs-eye-role')).toHaveText('Right Eye')
  await expect(m.getByTestId('outputs-eye-slot')).toHaveCount(3)
  await expect(m.getByTestId('outputs-eye-slot').nth(1)).toHaveAttribute('data-eye', 'left')
  await expect(m.getByTestId('outputs-eye-placeholder')).toHaveCount(3)
})

test('Show Stereoscopic Outputs sits above Hide Empty Folders and turns the eye slots off and on', async ({ page, api }) => {
  const m = await open(page, api, seq('clip_v008'))
  const box = m.getByTestId('pod-outputs-show-stereo')
  await expect(box).toBeChecked()
  await expect(m.getByTestId('outputs-eye-slot')).toHaveCount(3)
  const above = await m.getByTestId('pod-outputs-stereo-toggle-row').boundingBox()
  const emptyRow = m.getByTestId('pod-outputs-empty-toggle-row')   // only with a volume listing: when it is there, the stereo row is above it
  if (await emptyRow.count()) expect(above.y).toBeLessThan((await emptyRow.boundingBox()).y)
  await box.uncheck()
  await expect(m.getByTestId('outputs-eye-slot')).toHaveCount(0)
  await expect(m.getByTestId('outputs-eye-role')).toHaveCount(0)
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(1)
  await box.check()
  await expect(m.getByTestId('outputs-eye-slot')).toHaveCount(3)
})

test('Row one holds the four pictures; the sequences (tile, previews, Load Frame Previews, expand/collapse) follow below at full width', async ({ page, api }) => {
  const m = await open(page, api, [...seq('clip_v008_R'), ...seq('clip_v008_L'), ...seq('clip_v008_PACK'), ...seq('clip_v008_SBS')])
  const cards = await m.getByTestId('outputs-eye-card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)))
  const tile = await m.locator('[data-testid="outputs-tile"][data-kind="dpx"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
  expect(new Set(cards).size).toBe(1)
  for (const t of tile) expect(t).toBeGreaterThanOrEqual(cards[0])
})

test('Every slot plays its own video: Overall, Left Eye, Right Eye and Side By Side, matched by the role in the name', async ({ page, api }) => {
  const vid = (n) => ({ filename: n, subfolder: SUB, type: 'output' })
  const m = await open(page, api, [...seq('clip_v008_R'), ...seq('clip_v008_L'), ...seq('clip_v008_PACK'), ...seq('clip_v008_SBS'), vid('clip_v008_R.mp4'), vid('clip_v008_L.mp4'), vid('clip_v008_PACK.mp4'), vid('clip_v008_SBS.mp4')])
  await expect(m.getByTestId('outputs-eye-video')).toHaveCount(4)
  await expect(m.getByTestId('outputs-eye-picture')).toHaveCount(0)
})

test('A right-eye video with no right-eye frames still shows in its slot', async ({ page, api }) => {
  const m = await open(page, api, [...seq('clip_v008_L'), { filename: 'clip_v008_R.mp4', subfolder: SUB, type: 'output' }])
  const right = m.locator('[data-testid="outputs-eye-slot"][data-role="right"], [data-testid="outputs-eye-card"][data-role="right"]')
  await expect(right.getByTestId('outputs-eye-video')).toHaveCount(1)
  await expect(right).not.toContainText('Not Generated')
})

test('Row two repeats the four slots as DPX previews, below the video row and above the sequences; an empty slot is a Not Generated placeholder', async ({ page, api }) => {
  const m = await open(page, api, [...seq('clip_v008_L'), ...seq('clip_v008_PACK')])
  const frames = m.getByTestId('outputs-eye-frame')
  await expect(frames).toHaveCount(4)
  const top = (l) => l.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
  const row1 = await top(m.getByTestId('outputs-eye-card').or(m.getByTestId('outputs-eye-slot')))
  const row2 = await top(frames)
  const seqs = await top(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]'))
  expect(new Set(row2).size).toBe(1)
  expect(row2[0]).toBeGreaterThan(Math.max(...row1))
  for (const t of seqs) expect(t).toBeGreaterThan(row2[0])
  await expect(frames.nth(0)).toHaveAttribute('data-role', 'overall')
  await expect(frames.nth(0).getByTestId('outputs-eye-frame-picture')).toHaveAttribute('data-state', 'filled')
  await expect(frames.nth(2).getByTestId('outputs-eye-frame-picture')).toHaveAttribute('data-state', 'empty')
})

// ADR-059 decisions 2-4: row two shows the First Frame (default) or the Fifth Frame of each sequence; remembered per viewer.
const mode = (m) => m.getByTestId('outputs-eye-frame-mode')
const pic = (m) => m.locator('[data-role="left"][data-testid="outputs-eye-frame"]').getByTestId('outputs-eye-frame-picture')

test('Frame mode: First Frame is the default and the picture opens the viewer at frame 1', async ({ page, api }) => {
  const m = await open(page, api, seq('clip_v008', 8))
  await expect(mode(m).getByTestId('outputs-eye-frame-mode-first')).toHaveAttribute('aria-pressed', 'true')
  await expect(mode(m).getByTestId('outputs-eye-frame-mode-fifth')).toHaveAttribute('aria-pressed', 'false')
  await expect(mode(m).getByTestId('outputs-eye-frame-mode-first')).toHaveText('First Frame')
  await expect(mode(m).getByTestId('outputs-eye-frame-mode-fifth')).toHaveText('Fifth Frame')
  await expect(m.getByTestId('outputs-eye-frame-load')).toHaveCount(0)
  await pic(m).click()
  await expect(page.getByTestId('dpx-viewer-frame')).toHaveText(/^Frame 1 \/ 8/)
})

test('Frame mode: Fifth Frame swaps the picture for Load Frame Previews (no preview yet) and opens the viewer at frame 5', async ({ page, api }) => {
  const m = await open(page, api, seq('clip_v008', 8))
  await mode(m).getByTestId('outputs-eye-frame-mode-fifth').click()
  await expect(mode(m).getByTestId('outputs-eye-frame-mode-fifth')).toHaveAttribute('aria-pressed', 'true')
  await expect(pic(m).getByTestId('outputs-eye-frame-load')).toHaveText('Load Frame Previews')
  await pic(m).click()
  await expect(page.getByTestId('dpx-viewer-frame')).toHaveText(/^Frame 5 \/ 8/)
})

test('Frame mode: fewer than five frames shows the last frame', async ({ page, api }) => {
  const m = await open(page, api, seq('clip_v008', 3))
  await mode(m).getByTestId('outputs-eye-frame-mode-fifth').click()
  await pic(m).click()
  await expect(page.getByTestId('dpx-viewer-frame')).toHaveText(/^Frame 3 \/ 3/)
})

test('Frame mode: the choice is remembered across a reload', async ({ page, api }) => {
  const m = await open(page, api, seq('clip_v008', 8))
  await mode(m).getByTestId('outputs-eye-frame-mode-fifth').click()
  await page.reload()
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m2 = page.getByTestId('pod-outputs-modal')
  await expect(mode(m2).getByTestId('outputs-eye-frame-mode-fifth')).toHaveAttribute('aria-pressed', 'true')
  await expect(pic(m2).getByTestId('outputs-eye-frame-load')).toBeVisible()
})

test('Each row has a heading (Video Outputs, DPX Frame Outputs, All Frames for the sequence) and the main video is not repeated beside the sequence', async ({ page, api }) => {
  const m = await open(page, api, [...seq('clip_v008_L'), { filename: 'clip_v008_L.mp4', subfolder: SUB, type: 'output' }])
  const h = m.getByTestId('outputs-eye-heading')
  await expect(h.nth(0)).toHaveText('Video Outputs')
  await expect(h.nth(1)).toHaveText('DPX Frame Outputs')
  await expect(h.nth(2)).toContainText('All Frames for clip_v008_L')
  await expect(m.getByTestId('outputs-main-video')).toHaveCount(0)
})
