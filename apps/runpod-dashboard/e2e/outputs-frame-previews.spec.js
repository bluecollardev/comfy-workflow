import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// Lucas, 2026-11-21: "94 of 94 frames show dpx frame previews if available". An expanded DPX sequence says how many of its frames have a preview in the app's cache and shows
// that preview on the frame row; nothing is generated for it. Today the cache only ever holds a sequence's FIRST frame (the tile's own preview), so a fresh sequence reads
// "1 of N" once the tile has its preview and "0 of N" before.
const SUB = 'assembly_v024/review025_parts/split_cap120'
const NAME = 'v11_assembly_master_v024_review025_part32c06_depth-182'
const N = 20
const tinyDpx = () => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })

test('An expanded sequence says how many frames show previews, and the preview shows on that row only', async ({ page, api }) => {
  const outputs = []
  for (let n = 0; n < N; n++) outputs.push({ filename: `${NAME}.${String(n).padStart(4, '0')}.dpx`, subfolder: SUB, type: 'output' })
  api.state.history.runs['pod-aaaaaaaa'] = [{ prompt_id: 'dddddddd-1111-2222', workflow: 'x.json', status: 'success', started_at: '2026-11-21T14:39:00Z', duration_s: 10, outputs }]
  const asked = []
  await page.context().route('**/view?*', (r) => {
    asked.push(decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1]))
    return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tinyDpx() })
  })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const modal = page.getByTestId('pod-outputs-modal')

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
