import { test, expect, podCard } from './fixtures'
import { t } from './i18n'

// Auto sync (docs/ADR-046): the checkbox in the Sync window, the green Sync button on the card, and the banner under the nav bar.
const DEV = 'pod-aaaaaaaa', BATCH = 'pod-bbbbbbbb'
const item = (over = {}) => ({ pod_id: DEV, pod_name: 'ComfyUI-Dev', volume_id: 'vol1', state: 'syncing', direction: 'pull', files_done: 12, files_total: 25, bytes_done: 1.1 * 1024 ** 3, bytes_total: 1.2 * 1024 ** 3, rate_bps: 38 * 1024 ** 2, current: 'output/r1/frame_0012.png', pending_bytes: 0, started_at: new Date().toISOString(), summary: '', error: '', conflicts: [], ...over })
const setStatus = (api, items, paused = false) => { api.state.autosync = { ...(api.state.autosync || { settings: {} }), status: { paused, items } } }
const callsTo = (api, method, path) => api.calls.filter((c) => c.method === method && c.path === path)
const openSync = async (page, name = 'ComfyUI-Dev') => { await podCard(page, name).getByTestId('pod-sync').click(); return page.getByTestId('sync-modal') }
const syncBtn = (page, name = 'ComfyUI-Dev') => podCard(page, name).getByTestId('pod-sync')

test('Sync window: the Auto sync checkbox with Pull ticked and Push unticked by default', async ({ page }) => {
  await page.goto('/')
  const dlg = await openSync(page)
  await expect(dlg.getByTestId('sync-autosync')).not.toBeChecked()
  await expect(dlg.getByTestId('sync-autosync-pull')).toBeChecked()
  await expect(dlg.getByTestId('sync-autosync-push')).not.toBeChecked()
  await expect(dlg.getByTestId('sync-autosync-section')).toContainText(t('autosync.help'))
  await expect(syncBtn(page)).not.toHaveAttribute('data-autosync', 'true')
})

test('Sync window: saving with no name is refused inline; with a name the card button turns green and stays so after a reload; unticking returns it to normal', async ({ page, api }) => {
  await page.goto('/')
  let dlg = await openSync(page)
  await dlg.getByTestId('sync-autosync').check()
  await dlg.getByTestId('sync-autosync-save').click()
  await expect(dlg.getByTestId('sync-autosync-error')).toContainText(t('autosync.needName'))
  expect(callsTo(api, 'PUT', '/autosync')).toHaveLength(0)
  await dlg.getByTestId('sync-autosync-approved-by').fill('Lucas')
  await dlg.getByTestId('sync-autosync-save').click()
  await expect(dlg.getByTestId('sync-autosync-saved')).toBeVisible()
  expect(callsTo(api, 'PUT', '/autosync')[0].body).toMatchObject({ pod_id: DEV, enabled: true, pull: true, push: false, approved_by: 'Lucas' })
  await page.keyboard.press('Escape')
  await expect(syncBtn(page)).toHaveAttribute('data-autosync', 'true')
  await expect(syncBtn(page)).toHaveClass(/btn-success/)
  await expect(syncBtn(page)).toHaveAttribute('title', /Auto sync on/)
  await expect(syncBtn(page, 'ComfyUI-Batch')).not.toHaveAttribute('data-autosync', 'true')   // only this pod
  await page.reload()
  await expect(syncBtn(page)).toHaveAttribute('data-autosync', 'true')
  dlg = await openSync(page)
  await expect(dlg.getByTestId('sync-autosync')).toBeChecked()
  await expect(dlg.getByTestId('sync-autosync-approved-by')).toHaveValue('Lucas')
  await dlg.getByTestId('sync-autosync').uncheck()
  await dlg.getByTestId('sync-autosync-save').click()
  await expect(dlg.getByTestId('sync-autosync-saved')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(syncBtn(page)).not.toHaveAttribute('data-autosync', 'true')
  await expect(syncBtn(page)).toHaveClass(/btn-outline-light/)
})

test('Sync window: the approver is remembered from the other approvals and the last summary shows in the window', async ({ page, api }) => {
  await page.addInitScript(() => localStorage.setItem('runpod-manager.approved-by', 'Brynley'))
  setStatus(api, [item({ state: 'done', finished_at: new Date(Date.now() + 3600e3).toISOString(), summary: 'Pulled 25 files (1.2 GB) to output/' })])
  await page.goto('/')
  const dlg = await openSync(page)
  await expect(dlg.getByTestId('sync-autosync-approved-by')).toHaveValue('Brynley')
  await expect(dlg.getByTestId('sync-autosync-status')).toContainText('Pulled 25 files')
})

test('Banner: nothing while idle', async ({ page, api }) => {
  setStatus(api, [item({ state: 'idle' })])
  await page.goto('/')
  await expect(page.getByTestId('pod-card').first()).toBeVisible()
  await expect(page.getByTestId('autosync-banner')).toHaveCount(0)
})

test('Banner: progress sits below the nav bar and above the summary cards, with the numbers and the bar percent', async ({ page, api }) => {
  setStatus(api, [item()])
  await page.goto('/')
  const banner = page.getByTestId('autosync-banner')
  await expect(banner).toBeVisible()
  const row = banner.getByTestId('autosync-item')
  await expect(row).toHaveAttribute('data-state', 'syncing')
  await expect(row).toContainText('ComfyUI-Dev')
  await expect(row).toContainText('12 of 25 files')
  await expect(row).toContainText('1.1 GB of 1.2 GB')
  await expect(row).toContainText('38.0 MB/s')
  await expect(row).toContainText('output/r1/frame_0012.png')
  await expect(banner.getByTestId('autosync-bar')).toHaveAttribute('data-percent', '92')
  const nav = await page.locator('nav.navbar').first().boundingBox()
  const b = await banner.boundingBox()
  const stats = await page.getByText(t('stats.total'), { exact: true }).first().boundingBox()
  expect(b.y).toBeGreaterThanOrEqual(nav.y + nav.height - 1)
  expect(b.y + b.height).toBeLessThanOrEqual(stats.y)
  const order = await page.evaluate(() => { const a = document.querySelector('[data-testid="autosync-banner"]'), s = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent === 'Total pods'); return !!(a.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) })
  expect(order).toBe(true)
})

test('Banner: a progress update arrives by itself', async ({ page, api }) => {
  setStatus(api, [item({ files_done: 1, bytes_done: 0.1 * 1024 ** 3 })])
  await page.goto('/')
  await expect(page.getByTestId('autosync-item')).toContainText('1 of 25 files')
  api.state.autosync.status.items[0].files_done = 20
  await expect(page.getByTestId('autosync-item')).toContainText('20 of 25 files', { timeout: 15000 })
})

test('Banner: waiting says which pod', async ({ page, api }) => {
  setStatus(api, [item({ state: 'waiting' })])
  await page.goto('/')
  await expect(page.getByTestId('autosync-text')).toHaveText(t('autosync.waiting', { pod: 'ComfyUI-Dev' }))
})

test('Banner: a done item shows the summary in success style and goes by itself', async ({ page, api }) => {
  await page.addInitScript(() => { window.__autosyncDoneMs = 3000 })
  setStatus(api, [item({ state: 'done', finished_at: new Date().toISOString(), summary: 'Pulled 25 files (1.2 GB) to output/' })])
  await page.goto('/')
  const row = page.getByTestId('autosync-item')
  await expect(row).toContainText('Pulled 25 files (1.2 GB) to output/')
  await expect(row).toHaveClass(/alert-success/)
  await expect(page.getByTestId('autosync-banner')).toHaveCount(0, { timeout: 8000 })
})

test('Banner: an error persists with the reason and file; Retry asks for a sync now; Dismiss removes it', async ({ page, api }) => {
  setStatus(api, [item({ state: 'error', error: 'connection reset', current: 'output/a.png', finished_at: new Date(Date.now() - 600e3).toISOString() })])
  await page.goto('/')
  const row = page.getByTestId('autosync-item')
  await expect(row).toHaveClass(/alert-danger/)
  await expect(row).toContainText('connection reset')
  await expect(row).toContainText('output/a.png')
  await page.waitForTimeout(2500)
  await expect(row).toBeVisible()   // errors stay until dismissed
  await page.getByTestId('autosync-retry').click()
  await expect.poll(() => callsTo(api, 'POST', '/autosync/sync-now').length).toBe(1)
  expect(callsTo(api, 'POST', '/autosync/sync-now')[0].body).toEqual({ pod_id: DEV })
  await page.getByTestId('autosync-dismiss').click()
  await expect.poll(() => callsTo(api, 'POST', '/autosync/dismiss').length).toBe(1)
  expect(callsTo(api, 'POST', '/autosync/dismiss')[0].body).toEqual({ pod_id: DEV })
  await expect(page.getByTestId('autosync-banner')).toHaveCount(0)
})

test('Banner: an error also turns that pod\'s Sync button amber when auto sync is on', async ({ page, api }) => {
  api.state.autosync = { settings: { [DEV]: { enabled: true, pull: true, push: false, approved_by: 'Lucas' } }, status: { paused: false, items: [item({ state: 'error', error: 'disk full' })] } }
  await page.goto('/')
  await expect(syncBtn(page)).toHaveAttribute('data-autosync-state', 'error')
  await expect(syncBtn(page)).toHaveClass(/btn-warning/)
  await expect(syncBtn(page)).toHaveAttribute('title', /disk full/)
})

test('Banner: needs_approval asks; Pull sends yes, Skip sends no', async ({ page, api }) => {
  setStatus(api, [item({ state: 'needs_approval', pending_bytes: 7.2 * 1024 ** 3 })])
  await page.goto('/')
  await expect(page.getByTestId('autosync-text')).toHaveText(t('autosync.approve', { size: '7.2 GB', pod: 'ComfyUI-Dev' }))
  await page.getByTestId('autosync-approve-yes').click()
  await expect.poll(() => callsTo(api, 'POST', '/autosync/approve').length).toBe(1)
  expect(callsTo(api, 'POST', '/autosync/approve')[0].body).toEqual({ pod_id: DEV, yes: true })
  setStatus(api, [item({ state: 'needs_approval', pending_bytes: 7.2 * 1024 ** 3 })])
  await expect(page.getByTestId('autosync-approve-no')).toBeVisible()
  await page.getByTestId('autosync-approve-no').click()
  await expect.poll(() => callsTo(api, 'POST', '/autosync/approve').length).toBe(2)
  expect(callsTo(api, 'POST', '/autosync/approve')[1].body).toEqual({ pod_id: DEV, yes: false })
})

test('Banner: Pause sends pause(true) and the banner offers Resume, which sends pause(false)', async ({ page, api }) => {
  setStatus(api, [item()])
  await page.goto('/')
  await page.getByTestId('autosync-pause').click()
  await expect.poll(() => callsTo(api, 'POST', '/autosync/pause').length).toBe(1)
  expect(callsTo(api, 'POST', '/autosync/pause')[0].body).toEqual({ on: true })
  await expect(page.getByTestId('autosync-pause')).toHaveText(t('autosync.resume'))
  await page.getByTestId('autosync-pause').click()
  await expect.poll(() => callsTo(api, 'POST', '/autosync/pause').length).toBe(2)
  expect(callsTo(api, 'POST', '/autosync/pause')[1].body).toEqual({ on: false })
})

test('Banner: paused with nothing running says so and offers Resume', async ({ page, api }) => {
  setStatus(api, [], true)
  await page.goto('/')
  await expect(page.getByTestId('autosync-paused')).toContainText(t('autosync.paused'))
  await page.getByTestId('autosync-resume').click()
  await expect.poll(() => callsTo(api, 'POST', '/autosync/pause').length).toBe(1)
  expect(callsTo(api, 'POST', '/autosync/pause')[0].body).toEqual({ on: false })
})

test('Banner: rows for several pods stack; conflicts are a small line with a title', async ({ page, api }) => {
  setStatus(api, [item({ conflicts: [{ path: 'output/x.png', reason: 'both changed' }, { path: 'output/y.png', reason: 'both changed' }] }), item({ pod_id: BATCH, pod_name: 'ComfyUI-Batch', state: 'waiting' })])
  await page.goto('/')
  await expect(page.getByTestId('autosync-item')).toHaveCount(2)
  const [a, b] = [await page.getByTestId('autosync-item').nth(0).boundingBox(), await page.getByTestId('autosync-item').nth(1).boundingBox()]
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1)
  const c = page.getByTestId('autosync-conflicts')
  await expect(c).toHaveText(t('autosync.conflicts', { n: 2 }))
  await expect(c).toHaveAttribute('title', /output\/x\.png/)
})

test('Banner: a click on a row opens that pod\'s Sync window', async ({ page, api }) => {
  setStatus(api, [item()])
  await page.goto('/')
  await page.getByTestId('autosync-row').click()
  await expect(page.getByTestId('sync-modal')).toContainText('ComfyUI-Dev')
})

test('Failing status calls and an older core cause no errors and no banner', async ({ page, api }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  api.state.failures['GET /autosync/status'] = 'boom'
  await page.goto('/')
  await expect(page.getByTestId('pod-card').first()).toBeVisible()
  await page.waitForTimeout(2500)
  await expect(page.getByTestId('autosync-banner')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('An older core ("no core call autosync.*"): defaults, no banner, and saving says to restart the app', async ({ page, api }) => {
  api.state.autosyncOld = true
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByTestId('autosync-banner')).toHaveCount(0)
  const dlg = await openSync(page)
  await expect(dlg.getByTestId('sync-autosync')).not.toBeChecked()
  await dlg.getByTestId('sync-autosync').check()
  await dlg.getByTestId('sync-autosync-approved-by').fill('Lucas')
  await dlg.getByTestId('sync-autosync-save').click()
  await expect(dlg.getByTestId('sync-autosync-error')).toContainText('Restart the app')
  expect(errors).toEqual([])
})
