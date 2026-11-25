import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// DPX first-frame previews load by themselves (Lucas, 2026-11-25: "auto load", the first frame preloaded), top to bottom, one at a time, and a reopened window uses the cache. The other specs run click-only (window.__AUTO_CAP__ = 0 in the fixture).
const seqRun = (i, n = 3) => ({ prompt_id: `seq${i}0000-1111`, workflow: `rounds/r1/s${i}.json`, status: 'success', started_at: `2026-11-17T${String(10 + i).padStart(2, '0')}:00:00Z`, duration_s: 5, cost_estimate: 0,
  outputs: Array.from({ length: n }, (_, k) => ({ filename: `s${i}_proxy.${String(k).padStart(4, '0')}.dpx`, subfolder: `seqs/s${i}`, type: 'output' })) })
const dpx = () => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 30000 + x * 500 : 20000) })

test('DPX previews load by themselves, top to bottom, with no click; reopening reads the cache and fetches nothing', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'] = [{ ...seqRun(1), outputs: Array.from({ length: 4 }, (_, i) => seqRun(i + 1).outputs).flat() }]
  const order = []
  await page.context().route('**/view?*', async (r) => {
    const name = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1])
    if (name.endsWith('.json')) return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' })
    if (/\.0000\.dpx$/.test(name)) order.push(name.split('_')[0])
    return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: dpx() })
  })
  await page.addInitScript(() => { window.__AUTO_CAP__ = Infinity; try { indexedDB.deleteDatabase('pod-manager-thumbs') } catch { /* none */ } })
  await page.setViewportSize({ width: 1400, height: 1800 })   // only tiles on screen load, so all four must be in view
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('outputs-dpx-thumb')).toHaveCount(4)   // no click, no Load preview button
  await expect(m.getByTestId('outputs-dpx-load-preview')).toHaveCount(0)
  expect([...order].sort()).toEqual(['s1', 's2', 's3', 's4'])
  expect(order).toEqual(['s1', 's2', 's3', 's4'])   // top to bottom
  const before = order.length
  await m.locator('.btn-close').click(); await expect(m).toBeHidden()
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await expect(page.getByTestId('pod-outputs-modal').getByTestId('outputs-dpx-thumb')).toHaveCount(4)
  expect(order.length).toBe(before)   // nothing fetched again
})
