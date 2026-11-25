import { test, expect, podCard, modal, cfgTab } from './fixtures'
import { formatBytes } from '../src/sync-progress'
import { t } from './i18n'

// Sync: also remove left-out folders from the volume (v1.5.0): the option, the red preview, the name and the explicit tick, the request, the delete events, and the configuration's default.
// The sync calls are the window.__e2eSync stand-in (src/api/sync.js); its count returns would_delete for what the exclusions cover, and free_after decides over_capacity.
const TB = 1e12, GB = 1e9, POD = 'pod-aaaaaaaa'
const calls = (api, method, path) => api.calls.filter((c) => c.method === method && c.path === path)
const startBtn = (d) => d.locator('.modal-footer .btn-warning')

async function openSync(page, { onVolume = [{ step: 'project', path: '/workspace/project/CANALV2', bytes: 1.1 * TB }], send = 300 * GB, free = 100 * GB, capacity = 1.5 * TB, old = false, nothing = false, saved = [] } = {}) {
  await page.addInitScript((o) => {
    const listeners = []
    window.__counts = []
    window.__e2eEmit = (ev) => listeners.forEach((f) => f(ev))
    window.__e2eSync = {
      plan: async () => ({ steps: [{ key: 'project', local: '/Users/me/project', remote: '/workspace/project' }], transport: { kind: 'ssh', reason: 'ssh' }, shared: null }),
      folders: async () => ({ steps: [{ key: 'project', local: '/Users/me/project', folders: [{ name: 'CANALV2', bytes: null }, { name: 'scripts', bytes: null }] }] }),
      count: async (req) => {
        window.__counts.push(req)
        const covered = req.direction === 'push' && [...(req.exclude || []), ...o.saved].includes('/CANALV2/')   // (the core adds the saved patterns itself)
        const base = { total_files: 1000, total_bytes: o.send, scanned_files: 1000, capacity_bytes: o.capacity }
        if (!o.old && req.delete_excluded && covered) {
          const wd = o.nothing ? [] : o.onVolume
          const wb = wd.length ? (wd.every((w) => w.bytes != null) ? wd.reduce((n, w) => n + w.bytes, 0) : null) : 0
          const freeAfter = o.free + (wb || 0)
          return { pending: false, all: { ...base, free_bytes: freeAfter, over_capacity: o.send > freeAfter, would_delete: wd, would_delete_bytes: wb } }
        }
        return { pending: false, all: { ...base, free_bytes: o.free, over_capacity: o.send > o.free, ...(o.old || !req.delete_excluded ? {} : { would_delete: [], would_delete_bytes: 0 }) } }
      },
      start: async (req) => { window.__started = req; return { ok: true } }, cancel: async () => ({ ok: true }), state: async () => ({ running: false, events: [] }), onEvent: (cb) => { listeners.push(cb); return () => {} },
      measure: async () => ({ bytes: 0 }), measureCancel: async () => {},
    }
  }, { onVolume, send, free, capacity, old, nothing, saved })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-sync').click()
  const d = page.getByTestId('sync-modal')
  await expect(d.getByTestId('sync-plan-counts')).toContainText('files')
  return d
}
const emit = (page, ev) => page.evaluate((e) => window.__e2eEmit(e), { id: POD, ...ev })
const ready = async (d) => { await d.locator('[data-testid="sync-exclude-folder"][data-name="CANALV2"]').check(); await d.getByTestId('sync-exclude-delete').check() }

test('the option is off by default with its one-line warning; nothing is requested for deletion', async ({ page }) => {
  const d = await openSync(page)
  await expect(d.getByTestId('sync-exclude-delete')).not.toBeChecked()
  await expect(d.getByTestId('sync-exclude-delete-warning')).toHaveText('Deletes what is already on the volume that matches the left-out folders. Nothing else on the volume is touched.')
  await expect(d.getByTestId('sync-delete-preview')).toHaveCount(0)
  expect((await page.evaluate(() => window.__counts)).every((c) => !c.delete_excluded)).toBe(true)
})

test('ticking it re-counts with delete_excluded and shows the red block with each path, its size and the total', async ({ page }) => {
  const d = await openSync(page, { onVolume: [{ step: 'project', path: '/workspace/project/CANALV2', bytes: 1.1 * TB }, { step: 'project', path: '/workspace/project/old', bytes: null }] })
  await ready(d)
  const p = d.getByTestId('sync-delete-preview')
  await expect(p).toBeVisible(); await expect(p).toHaveClass(/border-danger/)
  await expect(p).toContainText('Will be removed from the volume')
  await expect(d.getByTestId('sync-delete-path')).toHaveText([`/workspace/project/CANALV2 — ${formatBytes(1.1 * TB)}`, '/workspace/project/old — (size unknown)'])
  await expect(d.getByTestId('sync-delete-total')).toHaveText('Total: (size unknown)')   // one size is unknown: no total is invented
  expect((await page.evaluate(() => window.__counts.at(-1)))).toMatchObject({ delete_excluded: true, exclude: ['/CANALV2/'] })
})

test('the total shows when every size is known; the over-capacity alert is cleared by the core\'s free_after', async ({ page }) => {
  const d = await openSync(page)   // sends 300 GB into 100 GB free: refused, until 1.1 TB is removed first
  await d.locator('[data-testid="sync-exclude-folder"][data-name="CANALV2"]').check()
  await expect(d.getByTestId('sync-over-capacity')).toBeVisible()
  await d.getByTestId('sync-exclude-delete').check()
  await expect(d.getByTestId('sync-delete-total')).toHaveText(`Total: ${formatBytes(1.1 * TB)}`)
  await expect(d.getByTestId('sync-over-capacity')).toHaveCount(0)
  await d.getByTestId('sync-exclude-delete').uncheck()
  await expect(d.getByTestId('sync-over-capacity')).toBeVisible()   // and back
})

test('Start waits for a name and the explicit "I understand"; the request carries delete_excluded and approved_by', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('c')) { localStorage.removeItem('runpod-manager.approved-by'); sessionStorage.setItem('c', '1') } })
  const d = await openSync(page)
  await ready(d)
  await expect(d.getByTestId('sync-delete-approved-hint')).toHaveText('Deleting needs who says yes')
  await expect(startBtn(d)).toBeDisabled()
  await d.getByTestId('sync-delete-approved-by').fill('Brynley')
  await expect(d.getByTestId('sync-delete-approved-hint')).toHaveCount(0)
  await expect(startBtn(d)).toBeDisabled()   // the name alone is not enough
  await d.getByTestId('sync-delete-confirm').check()
  await expect(d.getByTestId('sync-delete-confirm')).toBeChecked(); await expect(startBtn(d)).toBeEnabled()
  await startBtn(d).click()
  await expect.poll(() => page.evaluate(() => window.__started)).toBeTruthy()
  expect(await page.evaluate(() => window.__started)).toMatchObject({ delete_excluded: true, approved_by: 'Brynley', exclude: ['/CANALV2/'], direction: 'push' })
  expect(await page.evaluate(() => localStorage.getItem('runpod-manager.approved-by'))).toBe('Brynley')   // remembered
})

test('the confirmation tick starts over when the option is toggled; unticking the option sends no delete request', async ({ page }) => {
  const d = await openSync(page, { send: 50 * GB })
  await ready(d)
  await d.getByTestId('sync-delete-approved-by').fill('B'); await d.getByTestId('sync-delete-confirm').check()
  await d.getByTestId('sync-exclude-delete').uncheck(); await d.getByTestId('sync-exclude-delete').check()
  await expect(d.getByTestId('sync-delete-confirm')).not.toBeChecked(); await expect(startBtn(d)).toBeDisabled()
  await d.getByTestId('sync-exclude-delete').uncheck()
  await expect(startBtn(d)).toBeEnabled()
  await startBtn(d).click()
  await expect.poll(() => page.evaluate(() => window.__started)).toBeTruthy()
  expect(await page.evaluate(() => window.__started)).not.toHaveProperty('delete_excluded')
})

test('with nothing to remove the option is a quiet no-op: a plain line, no name asked, Start stays on', async ({ page }) => {
  const d = await openSync(page, { nothing: true, send: 10 * GB })
  await ready(d)
  await expect(d.getByTestId('sync-delete-nothing')).toHaveText('Nothing to remove')
  await expect(d.getByTestId('sync-delete-preview')).toHaveCount(0); await expect(d.getByTestId('sync-delete-approved-by')).toHaveCount(0)
  await expect(startBtn(d)).toBeEnabled()
})

test('it is never offered for a pull', async ({ page }) => {
  const d = await openSync(page)
  await expect(d.getByTestId('sync-exclude-delete')).toBeVisible()
  await d.getByTestId('sync-direction').locator('label').last().click()
  await expect(d.getByTestId('sync-exclude')).toHaveCount(0); await expect(d.getByTestId('sync-exclude-delete')).toHaveCount(0)
})

test('delete events show in the steps: removing, removed in green, then the copy', async ({ page }) => {
  const d = await openSync(page)
  await ready(d); await d.getByTestId('sync-delete-approved-by').fill('B'); await d.getByTestId('sync-delete-confirm').check()
  await startBtn(d).click()
  await expect(d.getByTestId('sync-status')).toBeVisible()
  await emit(page, { kind: 'delete', key: 'project', path: '/workspace/project/CANALV2', bytes: 1.1 * TB, state: 'removing', text: 'removing /workspace/project/CANALV2' })
  await expect(d.getByTestId('sync-delete-event')).toHaveText('Removing /workspace/project/CANALV2…')
  await emit(page, { kind: 'delete', key: 'project', path: '/workspace/project/CANALV2', bytes: 1.1 * TB, state: 'removed', text: 'removed' })
  const e = d.getByTestId('sync-delete-event')
  await expect(e).toHaveCount(1)   // the same path updates its row
  await expect(e).toHaveText(`Removed /workspace/project/CANALV2 (${formatBytes(1.1 * TB)})`); await expect(e).toHaveAttribute('data-state', 'removed'); await expect(e).toHaveClass(/text-success/)
})

test('a failed removal is red and the run stops there with the message', async ({ page }) => {
  const d = await openSync(page)
  await ready(d); await d.getByTestId('sync-delete-approved-by').fill('B'); await d.getByTestId('sync-delete-confirm').check()
  await startBtn(d).click()
  await expect(d.getByTestId('sync-status')).toBeVisible()
  await emit(page, { kind: 'delete', key: 'project', path: '/workspace/project/CANALV2', bytes: null, state: 'failed', text: 'Permission denied' })
  await emit(page, { kind: 'error', code: 'delete_failed', text: 'Could not remove /workspace/project/CANALV2: Permission denied. Nothing was copied.' })
  const e = d.getByTestId('sync-delete-event')
  await expect(e).toHaveText('Could not remove /workspace/project/CANALV2: Permission denied'); await expect(e).toHaveClass(/text-danger/)
  await expect(d.getByTestId('sync-status')).toContainText('Nothing was copied')
  await expect(d.getByTestId('sync-file')).toHaveCount(0)   // no copy began
})

test('a core without the fields hides the option quietly once it answers without would_delete', async ({ page }) => {
  const d = await openSync(page, { old: true })
  await d.getByTestId('sync-exclude-delete').click()
  await expect(d.getByTestId('sync-exclude-delete-block')).toHaveCount(0)
  await expect(d.getByTestId('sync-delete-preview')).toHaveCount(0); await expect(d.getByTestId('sync-plan-error')).toHaveCount(0)
  await expect(d.getByTestId('sync-exclude')).toBeVisible()   // the Leave out section itself stays
})

test('Remember for this pod also saves sync_exclude_delete; a saved true pre-ticks the option', async ({ page, api }) => {
  api.state.podConfigs[POD] = { ...api.state.mounts.config, mount_path: '/custom' }
  const own = JSON.parse(JSON.stringify(api.state.podConfigs[POD]))
  const d = await openSync(page)
  await ready(d); await d.getByTestId('sync-delete-approved-by').fill('B'); await d.getByTestId('sync-delete-confirm').check()
  await d.getByTestId('sync-exclude-remember').check()
  await startBtn(d).click()
  await expect.poll(() => calls(api, 'PUT', `/pods/${POD}/config`).length).toBe(1)
  expect(calls(api, 'PUT', `/pods/${POD}/config`)[0].body).toEqual({ ...own, sync_exclude: ['/CANALV2/'], sync_exclude_delete: true })
})

test('the saved default (the configuration\'s sync_exclude_delete) pre-ticks the option; the pod\'s own value wins', async ({ page, api }) => {
  api.state.mounts.config.sync_exclude = ['/CANALV2/']; api.state.mounts.config.sync_exclude_delete = true
  const d = await openSync(page, { saved: ['/CANALV2/'] })
  await expect(d.getByTestId('sync-exclude-delete')).toBeChecked()
  await expect(d.getByTestId('sync-delete-preview')).toBeVisible()   // the saved pattern covers CANALV2 and the count asked for deletion
})

test('the saved default is overridden by the pod\'s own configuration', async ({ page, api }) => {
  api.state.mounts.config.sync_exclude_delete = true
  api.state.podConfigs[POD] = { ...api.state.mounts.config, sync_exclude_delete: false }
  const d = await openSync(page)
  await expect(d.getByTestId('sync-exclude-delete')).not.toBeChecked()
})

test.describe('Configuration: remove left-out folders', () => {
  const openDefault = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'folders'); return d }
  const openPod = async (page) => { await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click(); const d = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' })); await cfgTab(d, 'folders'); return d }
  test('unticked and untouched: no key is saved; ticked saves true, reloads ticked, and unticking a stored one saves false', async ({ page, api }) => {
    let d = await openDefault(page)
    await expect(d.getByTestId('config-sync-exclude-delete')).not.toBeChecked()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body).not.toHaveProperty('sync_exclude_delete')
    d = await openDefault(page)
    await d.getByTestId('config-sync-exclude-delete').check()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[1].body.sync_exclude_delete).toBe(true)
    await page.reload(); await page.getByTestId('open-config').click()
    d = modal(page, t('config.title')); await cfgTab(d, 'folders')
    await expect(d.getByTestId('config-sync-exclude-delete')).toBeChecked()
    await d.getByTestId('config-sync-exclude-delete').uncheck()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts').at(-1).body.sync_exclude_delete).toBe(false)
  })
  test('the label says it asks who says yes each time; a pod\'s own configuration has it and starts from the Default\'s', async ({ page, api }) => {
    api.state.mounts.config.sync_exclude_delete = true
    const p = await openPod(page)
    await expect(p.getByTestId('config-sync-exclude-delete')).toBeChecked()
    await expect(p.getByTestId('config-sync-exclude').locator('xpath=..')).toContainText('Remove left-out folders from the volume on every push (asks who says yes each time)')
    await p.getByTestId('config-sync-exclude-delete').uncheck(); await p.getByTestId('config-apply').click(); await expect(p).toBeHidden()
    expect(api.state.podConfigs[POD].sync_exclude_delete).toBe(false)
  })
})
