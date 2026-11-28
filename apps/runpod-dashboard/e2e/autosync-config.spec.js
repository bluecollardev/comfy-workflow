import { readFileSync } from 'node:fs'
import { test, expect, podCard, modal, cfgTab } from './fixtures'
import { t } from './i18n'

// Auto sync in configuration and import (docs/ADR-046 section 3, 5): the Default Configuration and a pod's own configuration carry `auto_sync`; Import Round step 3 can ask for it on the pods an import creates.
const calls = (api, method, path) => api.calls.filter((c) => c.method === method && c.path === path)

async function toStep3(page, n = 1) {
  await page.goto('/')
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  for (let i = 0; i < n; i++) await dlg.getByTestId('import-round-option').nth(i).locator('input').check()
  await dlg.getByTestId('import-round-next').click()
  await dlg.getByTestId('import-round-next').click()
  await dlg.getByTestId('import-round-run').check()   // Auto sync is offered once Run Workflows is ticked
  await dlg.getByTestId('import-round-volume').selectOption('vol1')
  return dlg
}
const start = async (page, dlg) => { await dlg.getByTestId('import-round-approved-by').fill('Lucas'); await dlg.getByTestId('import-round-start').click(); await expect(dlg).toBeHidden() }

test.describe('Import Round step 3', () => {
  test('shows the checkbox unticked with its hint; push appears only once ticked', async ({ page }) => {
    const dlg = await toStep3(page)
    await expect(dlg.getByTestId('import-round-autosync')).not.toBeChecked()
    await expect(dlg.getByTestId('import-round-autosync-push')).toHaveCount(0)
    await expect(dlg.getByTestId('import-round-autosync-block')).toContainText(t('importRound.autoSync'))
    await expect(dlg.getByTestId('import-round-autosync-hint')).toHaveText(t('importRound.autoSyncHint'))
    await expect(dlg.getByTestId('import-round-autosync-line')).toHaveCount(0)
    await dlg.getByTestId('import-round-autosync').check()
    await expect(dlg.getByTestId('import-round-autosync-push')).not.toBeChecked()
    await expect(dlg.getByTestId('import-round-autosync-line')).toHaveText(t('importRound.autoSyncLine'))
    await dlg.getByTestId('import-round-autosync-push').check()
    await expect(dlg.getByTestId('import-round-autosync-line')).toHaveText(t('importRound.autoSyncLinePush'))
  })

  test('unticked: no auto_sync key on the plan or the import', async ({ page, api }) => {
    const dlg = await toStep3(page)
    await expect.poll(() => calls(api, 'POST', '/queue/plan').length).toBeGreaterThan(0)
    await start(page, dlg)
    await expect.poll(() => calls(api, 'POST', '/queue/import-many').length).toBe(1)
    for (const c of [...calls(api, 'POST', '/queue/plan'), ...calls(api, 'POST', '/queue/import-many')]) {
      expect(c.body).not.toHaveProperty('auto_sync')
      for (const i of c.body.items || []) expect(i).not.toHaveProperty('auto_sync')
    }
  })

  test('ticked: auto_sync true on the plan, every item and the options; the Approved by name is the import\'s', async ({ page, api }) => {
    const dlg = await toStep3(page)
    await dlg.getByTestId('import-round-autosync').check()
    await expect.poll(() => calls(api, 'POST', '/queue/plan').some((c) => c.body.auto_sync === true)).toBe(true)
    await start(page, dlg)
    const imp = calls(api, 'POST', '/queue/import-many')[0].body
    expect(imp.auto_sync).toBe(true)
    expect(imp.approved_by).toBe('Lucas')
    expect(imp.items.length).toBe(1)
    for (const i of imp.items) expect(i.auto_sync).toBe(true)
  })

  test('push ticked sends { pull: true, push: true }', async ({ page, api }) => {
    const dlg = await toStep3(page)
    await dlg.getByTestId('import-round-autosync').check()
    await dlg.getByTestId('import-round-autosync-push').check()
    await expect.poll(() => calls(api, 'POST', '/queue/plan').some((c) => c.body.auto_sync?.push === true)).toBe(true)
    await start(page, dlg)
    const imp = calls(api, 'POST', '/queue/import-many')[0].body
    expect(imp.auto_sync).toEqual({ pull: true, push: true })
    for (const i of imp.items) expect(i.auto_sync).toEqual({ pull: true, push: true })
  })

  test('several rounds: every item carries it', async ({ page, api }) => {
    const dlg = await toStep3(page, 2)
    await dlg.getByTestId('import-round-autosync').check()
    await start(page, dlg)
    const imp = calls(api, 'POST', '/queue/import-many')[0].body
    expect(imp.items.length).toBe(2)
    for (const i of imp.items) expect(i.auto_sync).toBe(true)
  })

  test('ticked with no Approved by name: the existing hint covers it and Import is disabled', async ({ page }) => {
    const dlg = await toStep3(page)
    await page.evaluate(() => localStorage.removeItem('runpod-manager.approved-by'))
    await dlg.getByTestId('import-round-approved-by').fill('')
    await dlg.getByTestId('import-round-autosync').check()
    await expect(dlg.getByTestId('import-round-start')).toBeDisabled()
    await expect(dlg.getByTestId('import-round-hint')).toHaveText(t('importRound.hintApprove'))
  })
})

// Auto sync is set on the volume rows now (e2e/autosync.spec.js); a configuration only keeps what is stored in it.
test.describe('Default Configuration', () => {
  const open = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'folders'); return d }

  test('has no Auto sync block (it lives on the volume rows)', async ({ page }) => {
    const dlg = await open(page)
    await expect(dlg.getByTestId('config-autosync')).toHaveCount(0); await expect(dlg.locator('[data-testid^="config-autosync"]')).toHaveCount(0)
  })

  test('an untouched Default Configuration does not add the object to what is saved', async ({ page, api }) => {
    const dlg = await open(page)
    await dlg.getByTestId('config-save').click()
    await expect(dlg).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body).not.toHaveProperty('auto_sync')
  })

  test('a stored value is kept as it is when saved and the exported file carries it', async ({ page, api }) => {
    api.state.mounts.config.auto_sync = { enabled: true, pull: true, push: false, approved_by: 'Brynley' }
    const dlg = await open(page)
    await expect(dlg.getByTestId('config-autosync-enabled')).toHaveCount(0)
    const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByTestId('cfg-io-export').click()])
    const exp = JSON.parse(readFileSync(await download.path(), 'utf8'))
    expect(exp.config.auto_sync).toEqual({ enabled: true, pull: true, push: false, approved_by: 'Brynley' })
    await dlg.getByTestId('config-save').click()
    await expect(dlg).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body.auto_sync).toEqual({ enabled: true, pull: true, push: false, approved_by: 'Brynley' })
  })
})

test.describe('a pod\'s own configuration', () => {
  test('has no Auto sync block either', async ({ page }) => {
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click()
    const panel = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' }))
    await cfgTab(panel, 'folders')
    await expect(panel.locator('[data-testid^="config-autosync"]')).toHaveCount(0)
  })
})
