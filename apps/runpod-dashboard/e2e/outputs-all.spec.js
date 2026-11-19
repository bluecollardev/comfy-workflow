import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// "All outputs" lists the WHOLE comfy-shared/output/ tree (`all: true`), whatever folder the pod's shot pre-selected, with a loader, Stop, a timeout with Retry, a cap message and an instant switch back (docs/ADR-051). The core is faked (state.s3Outputs).
const FILES = [
  { key: 'proxy_v004/archival-084/x/x.png', bytes: 10, modified: '2026-11-15T08:00:00' },
  { key: 'proxy_v004/archival-084/x/x2.png', bytes: 10, modified: '2026-11-15T08:01:00' },
  { key: 'proxy_v005/archival-080/y/y.png', bytes: 10, modified: '2026-11-17T12:00:00' },
  { key: 'delivery_v003_tests/t/t.png', bytes: 10, modified: '2026-11-01T08:00:00' },
  { key: 'zzz_empty/e/e.png', bytes: 10, modified: '2026-10-01T08:00:00' },
]
const stopAll = (api) => { for (const p of api.state.pods) { p.status = 'stopped'; p.web_ui_url = null; p.uptime_seconds = null } }
const allCalls = (api) => api.state.outputCalls.filter((c) => c.all)
const modalOf = (page) => page.getByTestId('pod-outputs-modal')
async function open(page, api, s3 = {}, { shot = 'archival-084' } = {}) {
  stopAll(api); api.state.history.runs = {}
  const dev = api.state.pods.find((p) => p.name === 'ComfyUI-Dev'); dev.round = 'r1'; dev.shot = shot
  api.state.s3Outputs = { files: FILES, ...s3 }
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = modalOf(page)
  await expect(m.getByTestId('pod-outputs-volume')).toBeVisible()
  await expect(m.getByTestId('pod-outputs-crumb')).toHaveText(['output', 'proxy_v004', 'archival-084'])   // the pod's shot pre-selects the folder
  return m
}
const dirs = (m) => m.getByTestId('pod-outputs-folder-name')

test.describe('All outputs', () => {
  test('All outputs is the default: opening asks for the whole tree at once (all=1, no prefix, whatever folder the pod\'s shot pre-selected), with the loader and live counts, then lists every folder; the header and folder buttons come from the full listing', async ({ page, api }) => {
    const m = await open(page, api, { allJob: true, allSteps: 3, folderInfo: { zzz_empty: { empty: true } } })
    await expect(m.getByTestId('pod-outputs-scope-all')).toHaveClass(/active/); await expect(m.getByTestId('pod-outputs-scope-folder')).not.toHaveClass(/active/)
    await expect(m.getByTestId('pod-outputs-all-loading')).toBeVisible()
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(0)   // nothing of the one-folder listing leaks in while the full one runs
    await expect(m.getByTestId('pod-outputs-scope-count')).toHaveCount(0)
    await expect(m.getByTestId('pod-outputs-all-loading-text')).toContainText('Listing every folder on the volume… 1,234 files in 17 folders so far')
    await expect(m.getByTestId('pod-outputs-all-loading-text')).toContainText('files in', { timeout: 6000 })
    await expect(m.getByTestId('pod-outputs-all-loading')).toHaveCount(0, { timeout: 8000 })
    expect(allCalls(api)).toHaveLength(1); const c = allCalls(api).at(-1)
    expect(c.all).toBe('1'); expect(c).not.toHaveProperty('prefix')
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(4)   // x/, y/, t/ and e/: every folder of the tree
    await expect(m.getByTestId('pod-outputs-folder-name')).toHaveText(['y', 'x', 't', 'e'])   // newest first
    await expect(m.getByTestId('pod-outputs-scope-count')).toContainText('5 file(s) shown of 5 total')
    await expect(m.getByTestId('pod-outputs-folder')).toHaveText(['delivery_v003_tests', 'proxy_v004', 'proxy_v005'])   // root folders of the full listing; the empty one is hidden
    await expect(m.getByTestId('pod-outputs-empty-hidden')).toContainText('1')
    await m.getByTestId('pod-outputs-hide-empty').uncheck(); await expect(m.getByTestId('pod-outputs-folder')).toHaveCount(4)
    await expect(m.getByTestId('pod-outputs-breadcrumb')).toHaveClass(/opacity-50/)   // the pre-selected folder is shown greyed
  })
  test('back to "Just in the folder I pick": the pre-selected folder\'s files only, instantly and without a new request; All outputs again is instant too while the result is fresh', async ({ page, api }) => {
    const m = await open(page, api, { allJob: true, allSteps: 1 })
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(4, { timeout: 8000 })
    const n = api.state.outputCalls.length
    await m.getByTestId('pod-outputs-scope-folder').click()
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1); await expect(m.getByTestId('pod-outputs-breadcrumb')).not.toHaveClass(/opacity-50/)
    await m.getByTestId('pod-outputs-scope-all').click()
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(4); await expect(m.getByTestId('pod-outputs-all-loading')).toHaveCount(0)
    expect(api.state.outputCalls.length).toBe(n)   // both from the cache
  })
  test('after navigating into another folder, clicking All outputs lists the whole tree', async ({ page, api }) => {
    const m = await open(page, api, { allJob: true, allSteps: 1 })
    await m.locator('[data-testid="pod-outputs-crumb"][data-prefix=""]').click()
    await m.locator('[data-testid="pod-outputs-folder"][data-name="proxy_v005"]').click()
    await m.locator('[data-testid="pod-outputs-folder"][data-name="archival-080"]').click()
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1)
    await m.getByTestId('pod-outputs-scope-all').click()
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(4, { timeout: 8000 }); expect(allCalls(api).at(-1)).not.toHaveProperty('prefix')
  })
  test('a listing the core does as a plain call (no job) works the same', async ({ page, api }) => {
    const m = await open(page, api, { allDelayMs: 600 })
    await m.getByTestId('pod-outputs-scope-all').click()
    await expect(m.getByTestId('pod-outputs-all-loading-text')).toHaveText('Listing every folder on the volume…')   // no progress to show
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(4, { timeout: 6000 })
  })
  test('Stop keeps what is loaded and says so; the folder scope then All outputs again restarts the listing; the core is told to cancel', async ({ page, api }) => {
    const m = await open(page, api, { allJob: true, allHang: true })
    await m.getByTestId('pod-outputs-scope-all').click()
    await expect(m.getByTestId('pod-outputs-all-loading')).toBeVisible()
    await m.getByTestId('pod-outputs-all-stop').click()
    await expect(m.getByTestId('pod-outputs-all-loading')).toHaveCount(0); await expect(m.getByTestId('pod-outputs-all-stopped')).toHaveText('Stopped: showing the top level')
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1)   // what was loaded: the folder listing
    await expect.poll(() => api.state.allCancels).toEqual(['olist-1'])
    expect(allCalls(api)).toHaveLength(1)
    api.state.s3Outputs.allHang = false; api.state.s3Outputs.allSteps = 1
    await m.getByTestId('pod-outputs-scope-folder').click(); await m.getByTestId('pod-outputs-scope-all').click()
    await expect(m.getByTestId('pod-outputs-all-loading')).toBeVisible()   // not stuck on the stopped state
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(4, { timeout: 8000 }); expect(allCalls(api)).toHaveLength(2)
    await expect(m.getByTestId('pod-outputs-all-stopped')).toHaveCount(0)
  })
  test('Stop, then All outputs clicked again straight away restarts too', async ({ page, api }) => {
    const m = await open(page, api, { allJob: true, allHang: true })
    await m.getByTestId('pod-outputs-scope-all').click(); await m.getByTestId('pod-outputs-all-stop').click()
    api.state.s3Outputs.allHang = false; api.state.s3Outputs.allSteps = 1
    await m.getByTestId('pod-outputs-scope-all').click()
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(4, { timeout: 8000 })
  })
  test('a listing that takes too long ends with the reason and Retry; clicking All outputs or Retry lists again', async ({ page, api }) => {
    await page.addInitScript(() => { window.__e2eAllTimeoutMs = 1500 })
    const m = await open(page, api, { allJob: true, allHang: true })
    await m.getByTestId('pod-outputs-scope-all').click()
    await expect(m.getByTestId('pod-outputs-all-error-text')).toHaveText('Listing every folder took longer than 2 minutes and was given up.', { timeout: 8000 })
    await expect(m.getByTestId('pod-outputs-all-loading')).toHaveCount(0)
    api.state.s3Outputs.allHang = false; api.state.s3Outputs.allSteps = 1
    await m.getByTestId('pod-outputs-scope-all').click()   // the toggle retries
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(4, { timeout: 8000 }); await expect(m.getByTestId('pod-outputs-all-error')).toHaveCount(0)
  })
  test('Retry after a failure lists again', async ({ page, api }) => {
    const m = await open(page, api, { allJob: true, allFail: true })
    await m.getByTestId('pod-outputs-scope-all').click()
    await expect(m.getByTestId('pod-outputs-all-error-text')).toHaveText('S3 refused the listing (SlowDown)', { timeout: 6000 })
    api.state.s3Outputs.allFail = false; api.state.s3Outputs.allSteps = 1
    await m.getByTestId('pod-outputs-all-retry').click()
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(4, { timeout: 8000 })
  })
  test('clicking All outputs again while the listing runs follows it: one listing only', async ({ page, api }) => {
    const m = await open(page, api, { allJob: true, allSteps: 3 })
    await m.getByTestId('pod-outputs-scope-all').click(); await m.getByTestId('pod-outputs-scope-all').click(); await m.getByTestId('pod-outputs-scope-all').click()
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(4, { timeout: 10000 })
    expect(allCalls(api)).toHaveLength(1)
  })
  test('the cap is said honestly: Showing 3 of 41,213 files: open a folder to see the rest', async ({ page, api }) => {
    const m = await open(page, api, { allCap: 3, allTotal: 41213 })
    await m.getByTestId('pod-outputs-scope-all').click()
    await expect(m.getByTestId('pod-outputs-capped')).toHaveText('Showing 3 of 41,213 files: open a folder to see the rest', { timeout: 6000 })
  })
  test('an older core that ignores all falls back to the folder scope (the old behaviour): no loader, no error, one request for all', async ({ page, api }) => {
    const m = await open(page, api, { noAll: true })
    await expect(m.getByTestId('pod-outputs-scope-folder')).toHaveClass(/active/, { timeout: 6000 }); await expect(m.getByTestId('pod-outputs-all-loading')).toHaveCount(0); await expect(m.getByTestId('pod-outputs-all-error')).toHaveCount(0)
    await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1)
    await m.getByTestId('pod-outputs-scope-all').click(); expect(allCalls(api)).toHaveLength(1)   // not asked again and again
  })
  test('the Generate window\'s All outputs lists the whole tree too and its counts show the spinner and "checking…" until it is done', async ({ page, api }) => {
    const m = await open(page, api, { allJob: true, allSteps: 3 })
    await page.getByTestId('pod-outputs-previews').click()
    const g = page.getByTestId('pod-outputs-previews-modal')
    await g.getByTestId('pod-outputs-generate-scope-all-radio').click()
    await expect(g.getByTestId('generate-counts-loading')).toBeVisible()
    await expect(g.getByTestId('pod-outputs-previews-counts')).toContainText('checking… ready · checking… waiting · checking… failed')
    await expect(g.getByTestId('generate-scope-loading')).toBeVisible()
    await expect(g.getByTestId('generate-counts-loading')).toHaveCount(0, { timeout: 10000 })
    await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveAttribute('data-final', 'true'); await expect(g.getByTestId('pod-outputs-previews-counts')).toContainText('0 ready · 0 waiting · 0 failed')
    await expect(g.getByTestId('generate-scope-loading')).toHaveCount(0)
    expect(allCalls(api)).toHaveLength(1)
  })
})

test.describe('the previews counts line shows when it is not final', () => {
  const px = makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
  const seq = (name, sub, n) => Array.from({ length: n }, (_, k) => ({ filename: `${name}.${String(k).padStart(4, '0')}.dpx`, subfolder: sub, type: 'output' }))
  async function openDpx(page, api, delay) {
    api.state.history.runs['pod-aaaaaaaa'] = [{ prompt_id: 'sc000000-1111', workflow: 'x.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 5, cost_estimate: 0, outputs: [...seq('a_proxy', 'p/a', 3), ...seq('b_proxy', 'p/b', 2)] }]
    await page.context().route('**/view?*', async (r) => { if (delay) await new Promise((res) => setTimeout(res, delay)); await r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }).catch(() => {}) })
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
    await page.getByTestId('pod-outputs-previews').click()
    return page.getByTestId('pod-outputs-previews-modal')
  }
  test('the numbers are final with no spinner once nothing loads; while a batch runs the spinner stays beside live numbers (not placeholders)', async ({ page, api }) => {
    const g = await openDpx(page, api, 700)
    await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveAttribute('data-final', 'true', { timeout: 10000 })
    await expect(g.getByTestId('generate-counts-loading')).toHaveCount(0)
    await expect(g.getByTestId('pod-outputs-previews-counts')).toContainText('0 ready · 2 waiting · 0 failed')
    await g.getByTestId('pod-outputs-load-previews').click()
    await expect(g.getByTestId('generate-counts-loading')).toBeVisible()
    await expect(g.getByTestId('pod-outputs-previews-counts')).toContainText('waiting'); await expect(g.getByTestId('pod-outputs-previews-counts')).not.toContainText('checking…')
    await expect(g.getByTestId('generate-counts-loading')).toHaveCount(0, { timeout: 15000 })
    await expect(g.getByTestId('pod-outputs-previews-counts')).toContainText('2 ready · 0 waiting · 0 failed')
  })
})
