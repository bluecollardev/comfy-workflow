import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// Lucas, 2026-11-21: the Outputs entry `v11_assembly_master_v024_review025_part32c06_depth-182` (assembly_v024/review025_parts/split_cap120, pod CanalV2-fix-v020-a) is ONE run of 362 files:
// "this is a lot to preview at once". A DPX sequence can be collapsed to its one tile and expanded to a page of frames at a time; nothing is loaded per frame; the video players alive at once are capped.
const SUB = 'assembly_v024/review025_parts/split_cap120'
const seq = (part) => `v11_assembly_master_v024_review025_part32c0${part}_depth-182`
const frame = (part, n) => `${seq(part)}.${String(n).padStart(4, '0')}.dpx`
const tinyDpx = () => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })

/** 3 sequences of 120 frames and 2 review videos: 362 files, one run. */
const bigRun = () => {
  const outputs = []
  for (const part of [4, 5, 6]) for (let n = 0; n < 120; n++) outputs.push({ filename: frame(part, n), subfolder: SUB, type: 'output' })
  outputs.push({ filename: `${seq(6)}.mp4`, subfolder: SUB, type: 'output' }, { filename: `${seq(6)}.mov`, subfolder: SUB, type: 'output' })
  return { prompt_id: 'cccccccc-1111-2222', workflow: 'assembly_v024/review025_parts.json', status: 'success', started_at: '2026-11-21T14:39:00Z', duration_s: 131, outputs }
}

async function open(page, api, run, asked) {
  api.state.history.runs['pod-aaaaaaaa'].unshift(run)
  await page.context().route('**/view?*', (r) => {
    const name = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1])
    asked?.push(name)
    if (name.endsWith('.dpx')) return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tinyDpx() })
    return r.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: '' })
  })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  return page.getByTestId('pod-outputs-modal')
}

test('Outputs: a run of 362 files opens with its three sequences collapsed (one tile each, no frame list), the count and the Frames badge unchanged', async ({ page, api }) => {
  const asked = []
  const m = await open(page, api, bigRun(), asked)
  const dpxTiles = m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')
  await expect(dpxTiles).toHaveCount(3)
  for (let i = 0; i < 3; i++) await expect(dpxTiles.nth(i)).toHaveAttribute('data-frames', '120')
  await expect(dpxTiles.first().getByTestId('outputs-dpx-badge')).toHaveText('DPX · 120 frames')
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(0)                     // collapsed by default: more than 12 frames
  await expect(m.getByTestId('outputs-seq-frame')).toHaveCount(0)
  await expect(m.getByTestId('outputs-seq-toggle')).toHaveCount(3)
  await expect(m.getByTestId('outputs-seq-toggle').first()).toHaveText(/Expand/)
  await expect(m.getByTestId('outputs-seq-toggle').first()).toHaveAttribute('aria-expanded', 'false')
  await expect(m.getByTestId('outputs-seq-count')).toHaveText('3 sequence(s), 0 open')
  // nothing was asked for per frame: at most each sequence's first frame (its one poster), and the people's click is what loads it
  const frames = new Set(asked.filter((n) => n.endsWith('.dpx')))
  expect(frames.size).toBeLessThanOrEqual(3)
  for (const n of frames) expect(n).toMatch(/\.0000\.dpx$/)
})

test('Outputs: Expand lists the first 24 frames only, Show More adds 24, Collapse hides them; no frame is fetched by listing', async ({ page, api }) => {
  const asked = []
  const m = await open(page, api, bigRun(), asked)
  const before = new Set(asked.filter((n) => n.endsWith('.dpx'))).size
  const first = m.getByTestId('outputs-seq-toggle').first()
  await first.click()
  const panel = m.getByTestId('outputs-seq-frames')
  await expect(panel).toHaveCount(1)
  await expect(m.getByTestId('outputs-seq-frame')).toHaveCount(24)
  await expect(m.getByTestId('outputs-seq-frames-count')).toHaveText('24 of 120 frames')
  await expect(first).toHaveText(/Collapse/)
  await expect(first).toHaveAttribute('aria-expanded', 'true')
  await expect(m.getByTestId('outputs-seq-count')).toHaveText('3 sequence(s), 1 open')
  await expect(m.getByTestId('outputs-seq-frame').first()).toHaveText(/0000/)
  await m.getByTestId('outputs-seq-more').click()
  await expect(m.getByTestId('outputs-seq-frame')).toHaveCount(48)
  await expect(m.getByTestId('outputs-seq-frames-count')).toHaveText('48 of 120 frames')
  for (let i = 0; i < 3; i++) await m.getByTestId('outputs-seq-more').click()
  await expect(m.getByTestId('outputs-seq-frame')).toHaveCount(120)
  await expect(m.getByTestId('outputs-seq-more')).toHaveCount(0)                        // all listed: nothing more to show
  expect(new Set(asked.filter((n) => n.endsWith('.dpx'))).size).toBe(before)          // listing frames fetched none
  await first.click()
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(0)
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(3)   // still three tiles, still 120 frames each
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]').first()).toHaveAttribute('data-frames', '120')
})

test('Outputs: Expand All and Collapse All act on every sequence and drop single choices; a frame opens the viewer on that frame', async ({ page, api }) => {
  const m = await open(page, api, bigRun(), [])
  await m.getByTestId('outputs-seq-toggle').nth(1).click()
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(1)
  await m.getByTestId('outputs-expand-all').click()
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(3)
  await expect(m.getByTestId('outputs-seq-frame')).toHaveCount(72)                      // 3 x the first page
  await expect(m.getByTestId('outputs-seq-count')).toHaveText('3 sequence(s), 3 open')
  await m.getByTestId('outputs-collapse-all').click()
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(0)
  await expect(m.getByTestId('outputs-seq-count')).toHaveText('3 sequence(s), 0 open')
  await m.getByTestId('outputs-seq-toggle').nth(2).click()                              // one by hand after Collapse All
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(1)
  await m.getByTestId('outputs-seq-frame').nth(5).click()
  await expect(page.getByTestId('dpx-viewer-frame')).toHaveText(/6 \/ 120/)
  await expect(page.getByTestId('dpx-viewer-title')).toHaveText(frame(6, 5))
})

test('Outputs: a sequence of 12 frames or fewer starts expanded in the automatic mode', async ({ page, api }) => {
  const outputs = Array.from({ length: 12 }, (_, n) => ({ filename: frame(7, n), subfolder: SUB, type: 'output' }))
  const m = await open(page, api, { prompt_id: 'dddddddd-3333-4444', workflow: 'x.json', status: 'success', started_at: '2026-11-21T15:00:00Z', duration_s: 10, outputs }, [])
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(1)
  await expect(m.getByTestId('outputs-seq-frame')).toHaveCount(12)
  await expect(m.getByTestId('outputs-seq-more')).toHaveCount(0)
})

test('Outputs: 40 video files never make more than 6 players at once', async ({ page, api }) => {
  const outputs = Array.from({ length: 40 }, (_, n) => ({ filename: `review_${String(n).padStart(2, '0')}.mp4`, subfolder: SUB, type: 'output' }))
  const m = await open(page, api, { prompt_id: 'eeeeeeee-5555-6666', workflow: 'x.json', status: 'success', started_at: '2026-11-21T15:10:00Z', duration_s: 10, outputs }, [])
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="video"]')).toHaveCount(40)
  await expect(m.getByTestId('outputs-video-player').first()).toBeAttached()
  const most = async () => m.locator('video').count()
  expect(await most()).toBeLessThanOrEqual(6)
  await m.getByTestId('outputs-tile').last().scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  expect(await most()).toBeLessThanOrEqual(6)
  expect(await most()).toBeGreaterThan(0)
})
