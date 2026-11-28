import { test, expect, podCard, openVolumeSync, openVolumes } from './fixtures'
import { t } from './i18n'

// Auto sync (docs/ADR-046, ADR-068): the Auto Sync switch on the volume row (Network Volumes > Sync Rules), the green Sync button on the card, and the banner under the nav bar.
const DEV = 'pod-aaaaaaaa', BATCH = 'pod-bbbbbbbb'
const item = (over = {}) => ({ pod_id: DEV, pod_name: 'ComfyUI-Dev', volume_id: 'vol1', state: 'syncing', direction: 'pull', files_done: 12, files_total: 25, bytes_done: 1.1 * 1024 ** 3, bytes_total: 1.2 * 1024 ** 3, rate_bps: 38 * 1024 ** 2, current: 'output/r1/frame_0012.png', pending_bytes: 0, started_at: new Date().toISOString(), summary: '', error: '', conflicts: [], ...over })
const setStatus = (api, items, paused = false) => { api.state.autosync = { ...(api.state.autosync || { settings: {} }), status: { paused, items } } }
const callsTo = (api, method, path) => api.calls.filter((c) => c.method === method && c.path === path)
const openSync = async (page) => openVolumeSync(page)
// Auto sync lives on the volume rows now (Network Volumes > the row's Sync Rules > Auto Sync); the setting is the volume's and covers every pod on it
const openRules = async (page, id = 'vol1') => { await openVolumes(page); const sec = page.locator(`[data-testid="volume"][data-id="${id}"]`).getByTestId('volume-sync-rules'); if ((await sec.getAttribute('data-open')) !== 'true') await sec.getByTestId('collapsible-toggle').click(); return sec }   // the section remembers it is open
const syncBtn = (page, name = 'ComfyUI-Dev') => podCard(page, name).getByTestId('pod-autosync-status')   // Lucas, 2026-11-28: no Auto Sync badge on the pod card at all (the banner and the window show it)

test('Volume row: Auto Sync with Pull ticked and Push unticked by default, help for every pod on the volume; the Sync window has no per-pod block', async ({ page }) => {
  await page.goto('/')
  const sec = await openRules(page)
  // Push (leaves the volume) has On Change to This PC (the pull flag); Pull (arrives) has On Change from This PC (the push flag): both off until Auto Sync is on
  await expect(sec.getByTestId('sync-push').getByTestId('volume-autosync-pull')).not.toBeChecked()
  await expect(sec.getByTestId('sync-pull').getByTestId('volume-autosync-push')).not.toBeChecked()
  await expect(sec.getByTestId('volume-autosync-help')).toContainText('Applies to every pod on this volume.')
  await expect(sec.getByTestId('volume-autosync-help')).toContainText(t('autosync.help'))
  await expect(sec.getByTestId('volume-rules-summary')).toContainText('Auto Sync Off')
  await expect(syncBtn(page)).toHaveCount(0)
  const d = page.locator('[data-testid="volume"][data-id="vol1"]'); await d.getByTestId('volume-sync-btn').click()
  await expect(page.getByTestId('sync-modal')).toBeVisible(); await expect(page.locator('[data-testid^="sync-autosync"]')).toHaveCount(0)
})

test('Volume row: saving with no name is refused inline; with a name it is saved for the volume and stays so after a reload (no badge on the card); unticking returns it to normal', async ({ page, api }) => {
  await page.goto('/')
  let sec = await openRules(page)
  await sec.getByTestId('volume-autosync-pull').check()
  await page.getByTestId('volumes-save').click()
  await expect(sec.getByTestId('volume-autosync-error')).toContainText(t('autosync.needName'))
  expect(callsTo(api, 'PUT', '/autosync/volume')).toHaveLength(0)
  await sec.getByTestId('volume-autosync-approved-by').fill('Lucas')
  await page.getByTestId('volumes-save').click()
  await expect(page.getByTestId('volumes-saved')).toBeVisible()
  expect(callsTo(api, 'PUT', '/autosync/volume')[0].body).toMatchObject({ volume_id: 'vol1', enabled: true, pull: true, push: false, approved_by: 'Lucas' })
  await expect(sec.getByTestId('volume-rules-summary')).toContainText('Auto Sync On')
  await page.keyboard.press('Escape')
  await expect(syncBtn(page)).toHaveCount(0)   // nothing on the card
  await page.reload()
  await expect(syncBtn(page)).toHaveCount(0)
  sec = await openRules(page)
  await expect(sec.getByTestId('volume-autosync-pull')).toBeChecked()
  await expect(sec.getByTestId('volume-autosync-approved-by')).toHaveValue('Lucas')
  await sec.getByTestId('volume-autosync-pull').uncheck()
  await page.getByTestId('volumes-save').click()
  await expect(page.getByTestId('volumes-saved')).toBeVisible()
  expect(callsTo(api, 'PUT', '/autosync/volume').at(-1).body.enabled).toBe(false)
  await page.keyboard.press('Escape')
  await expect(syncBtn(page)).toHaveCount(0)
})

test('Volume row: a core 400 for the missing name is shown inline', async ({ page }) => {
  await page.goto('/')
  const sec = await openRules(page)
  await sec.getByTestId('volume-autosync-pull').check()
  await sec.getByTestId('volume-autosync-approved-by').fill('x')
  await page.route('**/autosync/volume', (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 400, json: { detail: 'Auto sync needs the name of who says yes' } }) : r.fallback()))
  await page.getByTestId('volumes-save').click()
  await expect(sec.getByTestId('volume-autosync-error')).toContainText('needs the name')
})

test('Volume row: the approver is remembered from the other approvals and the newest status of its pods shows', async ({ page, api }) => {
  await page.addInitScript(() => localStorage.setItem('runpod-manager.approved-by', 'Brynley'))
  setStatus(api, [item({ state: 'done', finished_at: new Date(Date.now() + 3600e3).toISOString(), summary: 'Pulled 25 files (1.2 GB) to output/' })])
  api.state.autosync.volumeItems = { vol1: [{ pod_id: DEV, state: 'done', summary: 'Pulled 25 files (1.2 GB) to output/' }] }
  await page.goto('/')
  const sec = await openRules(page)
  await expect(sec.getByTestId('volume-autosync-approved-by')).toHaveValue('Brynley')
  await expect(sec.getByTestId('volume-autosync-status')).toContainText('Pulled 25 files')
  await expect(sec.getByTestId('volume-autosync-status')).toHaveAttribute('data-state', 'done')
  await expect(sec.getByTestId('volume-rules-summary')).toContainText('(done)')
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

test('Banner: an error shows in the banner and there is no badge on the card', async ({ page, api }) => {
  api.state.autosync = { settings: { [DEV]: { enabled: true, pull: true, push: false, approved_by: 'Lucas' } }, status: { paused: false, items: [item({ state: 'error', error: 'disk full' })] } }
  await page.goto('/')
  await expect(syncBtn(page)).toHaveCount(0)   // no badge on the card; the banner carries the error
  await expect(page.getByTestId('autosync-banner')).toContainText('disk full')
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

test('Banner: a click on a row opens the Sync window of that pod\'s volume', async ({ page, api }) => {
  setStatus(api, [item()])
  await page.goto('/')
  await page.getByTestId('autosync-row').click()
  await expect(page.getByTestId('sync-modal')).toContainText('Sync comfy-workspace')   // the volume the pod is on
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
  const sec = await openRules(page)
  await expect(sec.getByTestId('volume-autosync-pull')).not.toBeChecked()
  await sec.getByTestId('volume-autosync-pull').check()
  await sec.getByTestId('volume-autosync-approved-by').fill('Lucas')
  await page.getByTestId('volumes-save').click()
  await expect(sec.getByTestId('volume-autosync-error')).toContainText('Restart the app')
  expect(errors).toEqual([])
})
