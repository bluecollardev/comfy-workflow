import { test, expect, cfgTab } from './fixtures'
import { t } from './i18n'

// The root setting "Pull pods may use any free card" in Default Configuration > Options (docs/ADR-024): on by default, saved with the rest of the configuration.
const configModal = (page) => page.locator('.modal.show', { has: page.getByTestId('config-modal') })

test('Pull pods may use any free card: on by default, switch it off, save, and the configuration carries pull_any_card false', async ({ page, api }) => {
  await page.goto('/')
  await page.getByTestId('open-config').click()
  const dialog = configModal(page)
  await cfgTab(dialog, 'options')
  const sw = dialog.getByTestId('cfg-pull-any-card')
  await expect(sw).toBeChecked()
  await expect(dialog.getByText(t('config.pullAnyCard'))).toBeVisible()
  await sw.uncheck()
  await dialog.getByTestId('cfg-apply-default').uncheck()   // the same quirk made 'Apply to new pods by default' impossible to switch off: an explicit false now
  await dialog.getByTestId('config-save').click()
  await expect(dialog).toBeHidden()
  const puts = api.calls.filter((c) => c.method === 'PUT' && c.path === '/mounts')
  expect(puts.length).toBeGreaterThan(0)
  expect(puts[puts.length - 1].body).toMatchObject({ pull_any_card: false, apply_by_default: false })   // an explicit false, not a missing key (a missing key means 'on')
  await page.getByTestId('open-config').click()
  await cfgTab(configModal(page), 'options')
  await expect(configModal(page).getByTestId('cfg-pull-any-card')).not.toBeChecked()   // kept
})
