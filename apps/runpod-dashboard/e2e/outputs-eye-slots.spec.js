import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// ADR-058: each sequence in the Outputs modal fills one of three slots, Overall, Left Eye, Right Eye. A name with no token is the left eye (today's mono deliveries); an empty slot reads "Not rendered yet".
// The right eye and overall files do not exist yet, so these are fixture names.
const SUB = 'delivery_v008/clip'
const tinyDpx = () => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const seq = (stem, n = 3) => Array.from({ length: n }, (_, i) => ({ filename: `${stem}.${String(i).padStart(4, '0')}.dpx`, subfolder: SUB, type: 'output' }))
const run = (outputs) => ({ prompt_id: 'eeeeeeee-1111-2222', workflow: 'x.json', status: 'success', started_at: '2026-11-25T15:00:00Z', duration_s: 10, outputs })

async function open(page, api, outputs) {
  api.state.history.runs['pod-aaaaaaaa'] = [run(outputs)]
  await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tinyDpx() }))
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  return page.getByTestId('pod-outputs-modal')
}

test('A mono delivery (no token) is the Left Eye; Overall and Right Eye read Not rendered yet', async ({ page, api }) => {
  const m = await open(page, api, seq('clip_v008'))
  await expect(m.getByTestId('outputs-eye-role')).toHaveCount(1)
  await expect(m.getByTestId('outputs-eye-role')).toHaveText('Left Eye')
  const empty = m.getByTestId('outputs-eye-slot')
  await expect(empty).toHaveCount(2)
  await expect(empty.nth(0)).toHaveAttribute('data-eye', 'overall')
  await expect(empty.nth(1)).toHaveAttribute('data-eye', 'right')
  await expect(empty.nth(0)).toContainText('Overall')
  await expect(empty.nth(0)).toContainText('Not rendered yet')
  await expect(empty.nth(1)).toContainText('Right Eye')
  await expect(empty.nth(1)).toContainText('Not rendered yet')
  // the filled slot keeps its tile, and an empty one is not a failure
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(1)
  await expect(m.getByTestId('outputs-seq-job-error')).toHaveCount(0)
})

test('A stereo element shows three filled slots in the order Overall, Left Eye, Right Eye, each with its own tile', async ({ page, api }) => {
  const m = await open(page, api, [...seq('clip_v008_R'), ...seq('clip_v008_L'), ...seq('clip_v008_SBS')])
  const roles = m.getByTestId('outputs-eye-role')
  await expect(roles).toHaveCount(3)
  await expect(roles).toHaveText(['Overall', 'Left Eye', 'Right Eye'])
  await expect(m.getByTestId('outputs-eye-slot')).toHaveCount(0)
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(3)
  await expect(m.getByTestId('outputs-seq-toggle')).toHaveCount(3)   // each slot collapses and expands on its own, as a sequence does today
})

test('A right eye alone leaves Overall and Left Eye empty', async ({ page, api }) => {
  const m = await open(page, api, seq('clip_v008_RIGHT'))
  await expect(m.getByTestId('outputs-eye-role')).toHaveText('Right Eye')
  await expect(m.getByTestId('outputs-eye-slot')).toHaveCount(2)
  await expect(m.getByTestId('outputs-eye-slot').nth(1)).toHaveAttribute('data-eye', 'left')
})
