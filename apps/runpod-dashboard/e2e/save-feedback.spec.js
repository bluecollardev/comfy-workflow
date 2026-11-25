import { test, expect, modal, cfgTab } from './fixtures'
import { t } from './i18n'

// Every save says what happened: the time and the sections that changed after the core was asked again; a failure is red and stays; a save the core answered but did not keep is not called saved.
const open = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'publishing'); return d }   // Render sequences is in Publishing now
const toast = (page) => page.locator('.toast')

test.describe('Save feedback', () => {
  test('success: a toast with the time and the sections that changed, after the configuration was reloaded', async ({ page, api }) => {
    const d = await open(page)
    await d.getByTestId('config-render-preset').selectOption('tunnel')
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    const tt = toast(page).filter({ hasText: 'Configuration saved' }).first()
    await expect(tt).toContainText(/Configuration saved \d{2}:\d{2}:\d{2}: Render/)
    expect(api.calls.filter((c) => c.method === 'GET' && c.path === '/mounts').length).toBeGreaterThanOrEqual(2)   // asked again after the PUT
  })
  test('a save that changed nothing says so; a Publishing/Auto-publish edit names its section', async ({ page, api }) => {
    let d = await open(page)
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    await expect(toast(page).filter({ hasText: 'Configuration saved' }).first()).toContainText('nothing changed')
    api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' } }
    await page.goto('/'); await page.getByTestId('open-config').click(); d = modal(page, t('config.title')); await cfgTab(d, 'publishing')
    await d.getByTestId('autopublish-window').fill('15'); await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    await expect(toast(page).filter({ hasText: 'Auto-publish' }).first()).toContainText(/Configuration saved \d{2}:\d{2}:\d{2}: Auto-publish/)
  })
  test('failure: a red toast with the core\'s message that stays, and the window stays open with the reason inline', async ({ page, api }) => {
    api.state.mountsFail = 'The configuration file is read-only'
    const d = await open(page)
    await d.getByTestId('config-render-preset').selectOption('tunnel'); await d.getByTestId('config-save').click()
    await expect(d).toBeVisible(); await expect(d.getByTestId('config-error')).toContainText('The configuration file is read-only')
    const bad = toast(page).filter({ hasText: 'The configuration file is read-only' }).first(); await expect(bad).toBeVisible(); await expect(bad).toHaveClass(/text-bg-danger|bg-danger/)
    await page.waitForTimeout(5000); await expect(bad).toBeVisible()   // longer than a success toast
  })
  test('the core answered but kept nothing: not called saved; the window stays open with the reason', async ({ page, api }) => {
    api.state.mountsIgnore = true
    const d = await open(page)
    await d.getByTestId('config-render-preset').selectOption('tunnel'); await d.getByTestId('config-save').click()
    await expect(d.getByTestId('config-error')).toContainText('The core answered but did not change: render')
    await expect(toast(page).filter({ hasText: 'Configuration saved' })).toHaveCount(0)
  })
})
