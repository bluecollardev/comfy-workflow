import { test, expect, modal, cfgTab } from './fixtures'
import { t } from './i18n'

// Every save says what happened: the time and the sections that changed after the core was asked again; a failure is red and stays; a save the core answered but did not keep is not called saved.
const open = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'folders'); return d }
const toast = (page) => page.locator('.toast')

test.describe('Save feedback', () => {
  test('success: a toast with the time and the sections that changed, after the configuration was reloaded', async ({ page, api }) => {
    const d = await open(page)
    await d.getByTestId('config-sync-exclude').fill('CANALV2/')
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    const tt = toast(page).filter({ hasText: 'Configuration saved' }).first()
    await expect(tt).toContainText(/Configuration saved \d{2}:\d{2}:\d{2}: (Sync|Settings)/)
    expect(api.calls.filter((c) => c.method === 'GET' && c.path === '/mounts').length).toBeGreaterThanOrEqual(2)   // asked again after the PUT
  })
  test('a save that changed nothing says so', async ({ page, api }) => {
    let d = await open(page)
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    await expect(toast(page).filter({ hasText: 'Configuration saved' }).first()).toContainText('nothing changed')
  })
  test('failure: a red toast with the core\'s message that stays, and the window stays open with the reason inline', async ({ page, api }) => {
    api.state.mountsFail = 'The configuration file is read-only'
    const d = await open(page)
    await d.getByTestId('config-sync-exclude').fill('CANALV2/'); await d.getByTestId('config-save').click()
    await expect(d).toBeVisible(); await expect(d.getByTestId('config-error')).toContainText('The configuration file is read-only')
    const bad = toast(page).filter({ hasText: 'The configuration file is read-only' }).first(); await expect(bad).toBeVisible(); await expect(bad).toHaveClass(/text-bg-danger|bg-danger/)
    await page.waitForTimeout(5000); await expect(bad).toBeVisible()   // longer than a success toast
  })
  test('the core answered but kept nothing: not called saved; the window stays open with the reason', async ({ page, api }) => {
    api.state.mountsIgnore = true
    const d = await open(page)
    await d.getByTestId('config-sync-exclude').fill('CANALV2/'); await d.getByTestId('config-save').click()
    await expect(d.getByTestId('config-error')).toContainText('The core answered but did not change: sync_exclude')
    await expect(toast(page).filter({ hasText: 'Configuration saved' })).toHaveCount(0)
  })
})
