import { test, expect, podCard, queueTab } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// Retry Failed on a finished Previews batch (Lucas, 2026-11-21: "in queue allow retry of Previews: 45 of 45 · 36 failed"): only the failed ones are asked again, on the same pod, as a new batch linked to the old one.
const px = makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const two = (i) => String(i + 1).padStart(2, '0')
const seqRun = (n) => ({ prompt_id: 'gggggggg-1111', workflow: 'rounds/r1/g.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 5, cost_estimate: 0,
  outputs: Array.from({ length: n }, (_, i) => ({ filename: `s${two(i)}_proxy.0000.dpx`, subfolder: `seqs/s${two(i)}`, type: 'output' })) })
const seqOf = (url) => { const m = decodeURIComponent(url).match(/s(\d\d)_proxy/); return m ? Number(m[1]) : 0 }

async function runBatch(page, api, failFirst) {
  api.state.history.runs['pod-aaaaaaaa'] = [seqRun(45)]
  const asked = []
  const mode = { failing: true }
  await page.context().route('**/view?*', (r) => {
    const n = seqOf(r.request().url()); asked.push(n)
    if (mode.failing && n <= failFirst) return r.fulfill({ status: 500, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'The file did not arrive in time' })
    return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px })
  })
  await page.addInitScript(() => { try { indexedDB.deleteDatabase('pod-manager-thumbs') } catch { /* none */ } })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Previews' }).click()
  await page.getByTestId('pod-outputs-previews-modal').getByTestId('pod-outputs-load-previews').click()
  await page.getByTestId('pod-outputs-previews-modal').locator('.modal-footer button').click(); await page.getByTestId('pod-outputs-modal').locator('.btn-close').click()
  return { asked, mode }
}
const openQueue = async (page) => { await queueTab(page, 'generations'); const q = page.getByTestId('queue-modal'); await expect(q).toBeVisible(); return q.getByTestId('queue-generations').getByTestId('generations-previews') }

test('a finished batch with failures: the reasons are grouped, Retry Failed asks again for exactly the failed ones on the same pod as a new batch linked to the old one', async ({ page, api }) => {
  const { asked, mode } = await runBatch(page, api, 36)
  const b = await openQueue(page)
  await expect(b).toHaveAttribute('data-state', 'done', { timeout: 30000 })
  await expect(b.getByTestId('generations-previews-line')).toHaveText('Previews: 45 of 45 · 36 failed')
  const g = b.getByTestId('previews-failure-group')
  await expect(g).toHaveCount(1); await expect(g).toHaveAttribute('data-count', '36')
  await expect(g.getByTestId('previews-failure-group-text')).toContainText(': 36')
  await expect(g.getByTestId('previews-failure-group-names')).toContainText('s01_proxy')
  const retry = b.getByTestId('previews-retry-failed')
  await expect(retry).toBeEnabled(); await expect(retry).toHaveText(/Retry Failed \(36\)/)
  const before = asked.length
  mode.failing = false
  await retry.click()
  await expect(b.getByTestId('generations-previews-retry-of')).toHaveText('retry of #1')
  await expect(b).toHaveAttribute('data-state', 'done', { timeout: 30000 })
  await expect(b.getByTestId('generations-previews-line')).toHaveText('Previews: 36 of 36')
  const again = asked.slice(before)
  expect(again).toHaveLength(36); expect(Math.max(...again)).toBeLessThanOrEqual(36); expect(new Set(again).size).toBe(36)   // none of the 9 that worked is read again
  await expect(b.getByTestId('previews-retry-failed')).toHaveCount(0)   // nothing failed this time
})

test('Retry Failed is off with a reason when its pod is stopped; Copy Failures is there', async ({ page, api }) => {
  const { asked } = await runBatch(page, api, 36)
  const b = await openQueue(page)
  await expect(b).toHaveAttribute('data-state', 'done', { timeout: 30000 })
  expect(asked.length).toBeGreaterThanOrEqual(45)
  await expect(b.getByTestId('previews-copy-failures')).toBeVisible()
  api.state.pods.find((p) => p.id === 'pod-aaaaaaaa').status = 'stopped'
  await page.getByTestId('queue-modal').locator('.btn-close').click()
  await page.getByTestId('refresh').click()
  const b2 = await openQueue(page)
  await expect(b2.getByTestId('previews-retry-failed')).toBeDisabled()
  await expect(b2.getByTestId('previews-retry-failed-why')).toHaveText('The pod is stopped: start it first')
})
