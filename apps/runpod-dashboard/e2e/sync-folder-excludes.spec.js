import { readFileSync } from 'node:fs'
import { test, expect, podCard, modal, cfgTab } from './fixtures'
import { t } from './i18n'

// Exclude by default, per mapped folder (v1.5.0): `folder_excludes` in the Default Configuration and a pod's own configuration, and the Sync window listing them per step.
const POD = 'pod-aaaaaaaa'
const calls = (api, method, path) => api.calls.filter((c) => c.method === method && c.path === path)
const openDefault = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'folders'); return d }
const openPod = async (page) => { await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click(); const d = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' })); await cfgTab(d, 'folders'); return d }
const field = (d, key) => d.locator(`[data-testid="config-folder-exclude"][data-folder="${key}"]`)

test.describe('Configuration: Exclude by default', () => {
  test('every mapped folder has its own field, with the help line; an untouched config sends no folder_excludes', async ({ page, api }) => {
    const d = await openDefault(page)
    for (const k of ['project', 'plates', 'comfy-shared']) { await expect(field(d, k)).toHaveValue(''); await expect(d.locator(`[data-testid="folder-exclude-block"][data-folder="${k}"]`)).toContainText('Exclude by default') }
    await expect(d.getByTestId('config-folder-exclude-help')).toHaveText('Patterns left out of every push of this folder (for example CANALV2/ on the project folder). They also apply with Remove from the volume.')
    await expect(d.getByTestId('config-folder-exclude-inherit')).toHaveCount(0)   // the Default inherits from nothing
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body).not.toHaveProperty('folder_excludes')
  })
  test('lines save per folder, reload, are in the export, and clearing a loaded key saves it as []', async ({ page, api }) => {
    let d = await openDefault(page)
    await field(d, 'project').fill('CANALV2/\n  *.tmp \n\nCANALV2/'); await field(d, 'plates').fill('scratch/')
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body.folder_excludes).toEqual({ project: ['CANALV2/', '*.tmp'], plates: ['scratch/'] })
    await page.reload(); await page.getByTestId('open-config').click()
    d = modal(page, t('config.title')); await cfgTab(d, 'folders')
    await expect(field(d, 'project')).toHaveValue('CANALV2/\n*.tmp'); await expect(field(d, 'plates')).toHaveValue('scratch/'); await expect(field(d, 'comfy-shared')).toHaveValue('')
    const [dl] = await Promise.all([page.waitForEvent('download'), d.getByTestId('cfg-io-export').click()])
    expect(JSON.parse(readFileSync(await dl.path(), 'utf8')).config.folder_excludes).toEqual({ project: ['CANALV2/', '*.tmp'], plates: ['scratch/'] })
    await field(d, 'plates').fill('')
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts').at(-1).body.folder_excludes).toEqual({ project: ['CANALV2/', '*.tmp'], plates: [] })
  })
  test('a bad pattern is refused inline, naming the folder, before any call', async ({ page, api }) => {
    const d = await openDefault(page)
    await field(d, 'plates').fill('ok/\n../etc')
    await d.getByTestId('config-save').click()
    await expect(d.locator('[data-testid="config-folder-exclude-error"][data-folder="plates"]')).toHaveText('plates: Exclude by default: ../etc: A pattern has no `..`, no line breaks and does not start with ~.')
    expect(calls(api, 'PUT', '/mounts')).toHaveLength(0)
    await field(d, 'plates').fill('ok/')
    await expect(d.getByTestId('config-folder-exclude-error')).toHaveCount(0)
  })
  test('the core\'s 400 naming the folder is shown', async ({ page }) => {
    const d = await openDefault(page)
    await field(d, 'project').fill('CANALV2/')
    await page.route('**/mounts', (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 400, json: { detail: 'folder_excludes.project: that pattern is too broad: 40 folders' } }) : r.fallback()))
    await d.getByTestId('config-save').click()
    await expect(d.getByTestId('config-error')).toContainText('folder_excludes.project: that pattern is too broad')
  })
  test('a pod\'s editor inherits the Default per key (hint and placeholder); typing replaces; Use the Default goes back; an empty list clears the key for the pod', async ({ page, api }) => {
    api.state.mounts.config.folder_excludes = { project: ['CANALV2/'], plates: ['scratch/'] }
    let p = await openPod(page)
    for (const k of ['project', 'plates', 'comfy-shared']) await expect(p.locator(`[data-testid="config-folder-exclude-inherit"][data-folder="${k}"]`)).toHaveText('Inherited from the Default')
    await expect(field(p, 'project')).toHaveAttribute('placeholder', 'CANALV2/'); await expect(field(p, 'project')).toHaveValue('')
    await field(p, 'project').fill('Binc/')   // replaces the Default's for this key
    await expect(p.locator('[data-testid="config-folder-exclude-inherit"][data-folder="project"]')).toHaveCount(0)
    await field(p, 'plates').fill('x/'); await p.locator('[data-testid="config-folder-exclude-use-default"][data-folder="plates"]').click()   // and back to inheriting
    await expect(p.locator('[data-testid="config-folder-exclude-inherit"][data-folder="plates"]')).toHaveCount(1)
    await field(p, 'comfy-shared').fill('a/'); await field(p, 'comfy-shared').fill('')   // typed then emptied: an empty list, which clears the key for this pod
    await p.getByTestId('config-apply').click(); await expect(p).toBeHidden()
    expect(api.state.podConfigs[POD].folder_excludes).toEqual({ project: ['Binc/'], 'comfy-shared': [] })   // plates inherits: not in the pod's own list
    p = await openPod(page)
    await expect(field(p, 'project')).toHaveValue('Binc/')
    await expect(p.locator('[data-testid="config-folder-exclude-inherit"][data-folder="plates"]')).toBeVisible()
    await expect(p.locator('[data-testid="config-folder-exclude-inherit"][data-folder="comfy-shared"]')).toHaveCount(0)   // its own empty list
    await expect(p.locator('[data-testid="config-folder-exclude-use-default"][data-folder="project"]')).toBeVisible()
  })
  test('an untouched pod configuration adds no folder_excludes', async ({ page, api }) => {
    api.state.mounts.config.folder_excludes = { project: ['CANALV2/'] }
    const p = await openPod(page)
    await p.getByTestId('config-apply').click(); await expect(p).toBeHidden()
    expect(calls(api, 'POST', '/mounts/preview').at(-1).body).not.toHaveProperty('folder_excludes')
  })
})

test.describe('the Sync window', () => {
  async function openSync(page, { saved = true } = {}) {
    await page.addInitScript((o) => {
      const listeners = []
      window.__counts = []
      window.__e2eSync = {
        plan: async () => ({ steps: [{ key: 'project', local: '/p', remote: '/workspace/project' }, { key: 'plates', local: '/q', remote: '/workspace/plates' }], transport: { kind: 'ssh', reason: 'ssh' }, shared: null }),
        count: async (req) => { window.__counts.push(req); return { pending: false, all: { total_files: 10, total_bytes: 1e9 } } },
        folders: async () => ({ steps: [{ key: 'project', local: '/p', folders: [{ name: 'CANALV2' }, { name: 'scripts' }], ...(o.saved ? { saved: ['CANALV2/', '*.tmp', '/Binc/'] } : {}) }, { key: 'plates', local: '/q', folders: [{ name: 'plate-a' }], ...(o.saved ? { saved: ['*.tmp'] } : {}) }] }),
        start: async (req) => { window.__started = req; return { ok: true } }, cancel: async () => ({ ok: true }), state: async () => ({ running: false, events: [] }), onEvent: (cb) => { listeners.push(cb); return () => {} },
        measure: async () => ({ bytes: 0 }), measureCancel: async () => {},
      }
    }, { saved })
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-sync').click()
    const d = page.getByTestId('sync-modal')
    await expect(d.getByTestId('sync-exclude')).toBeVisible()
    return d
  }
  const startBtn = (d) => d.locator('.modal-footer .btn-warning')
  test('each step lists its effective saved patterns, tagged saved; a folder they cover is pre-ticked and locked', async ({ page, api }) => {
    api.state.mounts.config.sync_exclude = ['*.tmp']
    const d = await openSync(page)
    const proj = d.locator('[data-testid="sync-exclude-step-saved"][data-step="project"]')
    await expect(proj).toContainText('Left out by default for project:')
    await expect(proj).toContainText('CANALV2/'); await expect(proj).toContainText('/Binc/'); await expect(proj).not.toContainText('*.tmp')   // the global one is listed with the other saved patterns
    await expect(proj.locator('.badge')).toHaveCount(2)
    await expect(d.locator('[data-testid="sync-exclude-step-saved"][data-step="plates"]')).toHaveCount(0)   // only the global *.tmp there
    const box = d.locator('[data-testid="sync-exclude-folder"][data-step="project"][data-name="CANALV2"]')
    await expect(box).toBeChecked(); await expect(box).toBeDisabled()
    await expect(d.locator('[data-testid="sync-exclude-folder"][data-step="project"][data-name="scripts"]')).not.toBeChecked()
    await expect(d.getByTestId('sync-exclude-canalv2')).toHaveCount(0)   // already left out by default: no chip
  })
  test('the per-folder saved patterns are not re-sent: exclude carries only this run\'s own', async ({ page }) => {
    const d = await openSync(page)
    await d.getByTestId('sync-exclude-add').fill('old/'); await d.getByTestId('sync-exclude-add').press('Enter')
    await expect(d.getByTestId('sync-exclude-patterns')).toContainText('old/')   // the pattern is in the run before Start: under a loaded machine the click came first and the run went out with none
    await startBtn(d).click()
    await expect.poll(() => page.evaluate(() => window.__started)).toBeTruthy()
    expect(await page.evaluate(() => window.__started.exclude)).toEqual(['old/'])
    expect((await page.evaluate(() => window.__counts)).every((c) => !(c.exclude || []).includes('CANALV2/'))).toBe(true)
  })
  test('a core that does not send saved per step (older) is ignored quietly', async ({ page }) => {
    const d = await openSync(page, { saved: false })
    await expect(d.getByTestId('sync-exclude-step-saved')).toHaveCount(0)
    await expect(d.getByTestId('sync-exclude-saved')).toHaveCount(0)
    await expect(d.getByTestId('sync-exclude-canalv2')).toBeVisible()   // the chip still offers CANALV2
    await expect(d.getByTestId('sync-plan-error')).toHaveCount(0)
  })
})
