import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// Lucas, 2026-11-25: "on app refresh why do we have to reload all the previews, add a cache for this that survives restart." The small preview pictures (the pod's frame JPEGs, posters, thumbnails) are
// kept as bytes in IndexedDB (src/utils/imgcache.js, docs/ADR-060): after a reload they show with no /view request; a changed size/time is a miss; blocked storage still renders.
const SUB = 'assembly_v024/review025_parts/split_cap120'
const NAME = 'v11_assembly_master_v024_review025_part32c06_depth-182'
const N = 12
const tinyDpx = () => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')

async function setup(page, api, { blockStorage = false } = {}) {
  const outputs = []
  for (let n = 0; n < N; n++) outputs.push({ filename: `${NAME}.${String(n).padStart(4, '0')}.dpx`, subfolder: SUB, type: 'output' })
  api.state.history.runs['pod-aaaaaaaa'] = [{ prompt_id: 'dddddddd-1111-2222', workflow: 'x.json', status: 'success', started_at: '2026-11-21T14:39:00Z', duration_s: 10, outputs }]
  const seen = { jpgs: [] }
  await page.context().route('**/view?*', (r) => {
    const f = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1])
    if (/\.jpg$/.test(f)) { seen.jpgs.push(f); return r.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: JPG }) }
    return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tinyDpx() })
  })
  if (blockStorage) await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get() { throw new Error('blocked') } }) })
  return seen
}
async function open(page) {
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const modal = page.getByTestId('pod-outputs-modal')
  await expect(async () => {
    if (!(await modal.getByTestId('outputs-seq-frames').isVisible())) await modal.getByTestId('outputs-seq-toggle').click({ timeout: 2000 })
    await expect(modal.getByTestId('outputs-seq-frames')).toBeVisible({ timeout: 1500 })
  }).toPass({ timeout: 15000 })
  return modal
}
async function makePreviews(page, modal) {
  await page.evaluate(() => { globalThis.__FP_POLL_MS__ = 50 })
  await modal.getByTestId('outputs-seq-load-frames').click()
  await expect(modal.getByTestId('outputs-seq-preview-count')).toHaveText(`${N} of ${N} frames show previews`, { timeout: 15000 })
  await expect(modal.getByTestId('outputs-seq-frame-thumb')).toHaveCount(N)
}

test('after a reload the frame previews come from the cache: no /view request for a picture the page already had', async ({ page, api }) => {
  const seen = await setup(page, api)
  let modal = await open(page)
  await makePreviews(page, modal)
  await expect.poll(() => seen.jpgs.length).toBeGreaterThanOrEqual(N)
  await page.waitForTimeout(300)   // the last pictures are written to IndexedDB
  const before = seen.jpgs.length
  await page.reload()
  modal = await open(page)
  await expect(modal.getByTestId('outputs-seq-preview-count')).toHaveText(`${N} of ${N} frames show previews`, { timeout: 15000 })
  await expect(modal.getByTestId('outputs-seq-frame-thumb')).toHaveCount(N)
  await expect(modal.getByTestId('outputs-seq-frame-thumb').first()).toHaveAttribute('src', /^blob:/)
  expect(seen.jpgs.length).toBe(before)
})

test('a picture whose size or time changed is fetched again, and Clear Preview Cache forgets them all', async ({ page, api }) => {
  const seen = await setup(page, api)
  const modal = await open(page)
  await makePreviews(page, modal)
  await page.waitForTimeout(300)
  const r = await page.evaluate(async () => {
    const m = await import('/src/utils/imgcache.js')
    const url = `https://pod-x-8188.proxy.runpod.net/view?filename=stamp-test.jpg&subfolder=s&type=output`
    const b1 = await m.loadImage(url, { stamp: '10:a' }), b2 = await m.loadImage(url, { stamp: '10:a' }), b3 = await m.loadImage(url, { stamp: '11:a' })
    return [!!b1, !!b2, !!b3]
  })
  expect(r).toEqual([true, true, true])
  expect(seen.jpgs.filter((f) => f === 'stamp-test.jpg').length).toBe(2)   // the second ask was the cache; the changed stamp went to the pod again
  const stats = await page.evaluate(async () => (await import('/src/utils/imgcache.js')).sharedImages().stats())
  expect(stats.count).toBeGreaterThanOrEqual(N)
  await modal.getByTestId('pod-outputs-clear-previews').click()
  await expect.poll(async () => page.evaluate(async () => (await import('/src/utils/imgcache.js')).sharedImages().stats().then((s) => s.count))).toBe(0)
})

test('with storage blocked the previews still render (from the pod, as before)', async ({ page, api }) => {
  await setup(page, api, { blockStorage: true })
  const modal = await open(page)
  await makePreviews(page, modal)
  await expect(modal.getByTestId('outputs-seq-frame-thumb').first()).toBeVisible()
})
