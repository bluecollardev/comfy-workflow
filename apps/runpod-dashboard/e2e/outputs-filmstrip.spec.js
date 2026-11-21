import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// Lucas, 2026-11-21: "in each row we're showing the first frame. if dpx sequences are rendered, show them beside the first frame to fill the row". A DPX sequence's row (collapsed or open)
// keeps the first-frame tile at the left and shows the frames that HAVE a preview (the pod's JPEGs) as a filmstrip beside it: evenly spaced across the sequence, as many as fit the row, the
// frame number under each, a click opens the viewer on that frame. Only frames with a preview; no placeholders; no request but the tiny JPEGs.
const SUB = 'assembly_v024/review025_parts/split_cap120'
const NAME = 'v11_assembly_master_v024_review025_part32c06_depth-182'
const N = 20
const tinyDpx = () => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
const jpg = (n) => `${NAME}.${String(n).padStart(4, '0')}.jpg`

/** `have` = the frame numbers whose JPEG the pod already holds. */
async function setup(page, api, have) {
  const outputs = []
  for (let n = 0; n < N; n++) outputs.push({ filename: `${NAME}.${String(n).padStart(4, '0')}.dpx`, subfolder: SUB, type: 'output' })
  api.state.history.runs['pod-aaaaaaaa'] = [{ prompt_id: 'dddddddd-1111-2222', workflow: 'x.json', status: 'success', started_at: '2026-11-21T14:39:00Z', duration_s: 10, outputs }]
  api.state.fp = { jobs: {}, written: { [SUB]: have.map(jpg) }, starts: [], lists: [], fail: {} }
  const asked = [], jpgs = []
  await page.context().route('**/view?*', (r) => {
    const f = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1])
    if (/\.jpg$/.test(f)) { jpgs.push(f); return r.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: JPG }) }
    asked.push(f)
    return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tinyDpx() })
  })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  return { asked, jpgs, modal: page.getByTestId('pod-outputs-modal') }
}
const indexes = async (modal) => (await modal.getByTestId('outputs-seq-strip-frame').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-index')))))

test('Twenty frames with previews: the collapsed row shows the fitted number of frames in order, spread across the sequence, beside the first-frame tile', async ({ page, api }) => {
  const { modal, asked } = await setup(page, api, Array.from({ length: N }, (_, i) => i))
  const strip = modal.getByTestId('outputs-seq-strip')
  await expect(strip).toBeVisible()
  await expect(modal.getByTestId('outputs-tile')).toBeVisible()                       // the first-frame tile stays at the left
  await expect(modal.getByTestId('outputs-seq-frames')).toHaveCount(0)                // collapsed: the strip is the point, the list below is not there
  const fit = Number(await strip.getAttribute('data-fit'))
  expect(fit).toBeGreaterThanOrEqual(1); expect(fit).toBeLessThanOrEqual(12)
  const want = Math.min(fit, N - 1)                                                   // 19 frames have a preview besides the first
  await expect(modal.getByTestId('outputs-seq-strip-frame')).toHaveCount(want)
  const ix = await indexes(modal)
  expect([...ix].sort((a, b) => a - b)).toEqual(ix)                                   // in order
  expect(ix[0]).toBeGreaterThan(0)                                                    // the first frame is the tile, not repeated
  if (want < N - 1) {
    expect(ix[ix.length - 1]).toBe(N - 1)                                             // from the front of the sequence to its end
    const gaps = ix.slice(1).map((v, i) => v - ix[i])
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)              // evenly spaced
  }
  await expect(modal.getByTestId('outputs-seq-strip-frame').first().locator('.sfno')).toHaveText(String(ix[0]).padStart(4, '0'))   // the frame number under each thumbnail
  expect(asked.filter((f) => /\.dpx$/.test(f))).toEqual([])                           // no DPX frame was read over the network for the strip
})

test('The strip follows the row width: a narrower window shows fewer frames, a wider one more', async ({ page, api }) => {
  const { modal } = await setup(page, api, Array.from({ length: N }, (_, i) => i))
  const strip = modal.getByTestId('outputs-seq-strip')
  await expect(strip).toBeVisible()
  await page.setViewportSize({ width: 1500, height: 800 })
  await expect.poll(async () => Number(await strip.getAttribute('data-fit'))).toBeGreaterThanOrEqual(2)
  const wide = Number(await strip.getAttribute('data-fit'))
  await page.setViewportSize({ width: 760, height: 800 })
  await expect.poll(async () => Number(await strip.getAttribute('data-fit'))).toBeLessThan(wide)
  const narrow = Number(await strip.getAttribute('data-fit'))
  await expect(modal.getByTestId('outputs-seq-strip-frame')).toHaveCount(Math.min(narrow, N - 1))
})

test('Only frames that have a preview are shown: three previews, three thumbnails, in order; no placeholders', async ({ page, api }) => {
  const { modal } = await setup(page, api, [5, 10, 15])
  await expect(modal.getByTestId('outputs-seq-strip-frame')).toHaveCount(3)
  expect(await indexes(modal)).toEqual([5, 10, 15])
})

test('With no previews there is no strip, only the first-frame tile', async ({ page, api }) => {
  const { modal } = await setup(page, api, [])
  await expect(modal.getByTestId('outputs-tile')).toBeVisible()
  await expect(modal.getByTestId('outputs-seq-strip')).toHaveCount(0)
  await expect(modal.getByTestId('outputs-seq-strip-frame')).toHaveCount(0)
})

test('A click on a strip frame opens the DPX viewer on that frame', async ({ page, api }) => {
  const { modal } = await setup(page, api, [5, 10, 15])
  await modal.getByTestId('outputs-seq-strip-frame').nth(1).click()
  await expect(page.getByTestId('dpx-viewer-frame')).toHaveText(new RegExp(`11 / ${N}`))
  await expect(page.getByTestId('dpx-viewer-title')).toHaveText(`${NAME}.0010.dpx`)
})

test('The strip also shows on an open sequence, above the frame list', async ({ page, api }) => {
  const { modal } = await setup(page, api, [2, 4, 6])
  await modal.getByTestId('outputs-seq-toggle').click()
  await expect(modal.getByTestId('outputs-seq-frames')).toBeVisible()
  await expect(modal.getByTestId('outputs-seq-strip-frame')).toHaveCount(3)
})
