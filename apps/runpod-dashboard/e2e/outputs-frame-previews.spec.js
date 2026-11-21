import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// Lucas, 2026-11-21: "94 of 94 frames show dpx frame previews if available", then "that's why these are jobs": the frame previews are made by a JOB on the pod (one small JPEG per frame,
// libs/core/src/framepreviews.ts), never by this PC pulling 8 to 50 MB frames. An expanded sequence counts and shows the previews that exist; Load Frame Previews starts the job for that
// sequence; the Generate window has the same job for every in-scope sequence behind a mode choice (Sequence Previews is today's behaviour).
const SUB = 'assembly_v024/review025_parts/split_cap120'
const NAME = 'v11_assembly_master_v024_review025_part32c06_depth-182'
const N = 20
const tinyDpx = () => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
// a 1x1 JPEG
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')

async function setup(page, api) {
  const outputs = []
  for (let n = 0; n < N; n++) outputs.push({ filename: `${NAME}.${String(n).padStart(4, '0')}.dpx`, subfolder: SUB, type: 'output' })
  api.state.history.runs['pod-aaaaaaaa'] = [{ prompt_id: 'dddddddd-1111-2222', workflow: 'x.json', status: 'success', started_at: '2026-11-21T14:39:00Z', duration_s: 10, outputs }]
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
