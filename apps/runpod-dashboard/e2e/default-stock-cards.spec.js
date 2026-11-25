import { test, expect, cfgTab } from './fixtures'
import { t } from './i18n'

// Default Configuration > Options: the stock default cards, the cards "Cheapest in Stock" tries. Shown pre-filled with the built-in stock list, editable, saved as auto_cards (empty = stock).
const configModal = (page) => page.locator('.modal.show', { has: page.getByTestId('config-modal') })

test('Stock default cards: pre-filled with the stock list, a change saves auto_cards, Reset goes back to the stock list', async ({ page, api }) => {
  await page.goto('/')
  await page.getByTestId('open-config').click()
  const dialog = configModal(page)
  await cfgTab(dialog, 'options')
  await expect(dialog.getByText(t('config.autoCards'))).toBeVisible()
  await expect(dialog.getByTestId('cfg-auto-cards-state')).toHaveText(t('config.autoCardsStock'))
  await expect(dialog.getByTestId('cfg-auto-card-box-rtx4090')).toBeChecked()      // a stock card
  await expect(dialog.getByTestId('cfg-auto-card-box-rtxpro6000')).not.toBeChecked() // an explicit-only card
  await expect(dialog.getByTestId('cfg-auto-cards-reset')).toBeDisabled()

  await dialog.getByTestId('cfg-auto-card-box-a4000').uncheck()
  await dialog.getByTestId('cfg-auto-card-box-rtxpro6000').check()
  await expect(dialog.getByTestId('cfg-auto-cards-state')).toContainText('2')
  await dialog.getByTestId('config-save').click()
  await expect(dialog).toBeHidden()
  const puts = api.calls.filter((c) => c.method === 'PUT' && c.path === '/mounts')
  expect(puts[puts.length - 1].body.auto_cards).toEqual(['rtx4090', 'rtxpro6000'])

  await page.getByTestId('open-config').click()
  await cfgTab(configModal(page), 'options')
  await configModal(page).getByTestId('cfg-auto-cards-reset').click()
  await expect(configModal(page).getByTestId('cfg-auto-card-box-a4000')).toBeChecked()
  await expect(configModal(page).getByTestId('cfg-auto-card-box-rtxpro6000')).not.toBeChecked()
  await configModal(page).getByTestId('config-save').click()
  const puts2 = api.calls.filter((c) => c.method === 'PUT' && c.path === '/mounts')
  expect(puts2[puts2.length - 1].body.auto_cards).toEqual([])
})
