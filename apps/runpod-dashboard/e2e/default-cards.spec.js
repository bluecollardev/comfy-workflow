import { test, expect, cfgTab, openCreatePod } from './fixtures'
import { t } from './i18n'

// Default Configuration > Default Pod Configuration: the datacenter and the cards of a new pod are one block, chosen in Choose Card (the Import Round window, ChooseCardModal).
// One card is the default card (default_gpu); several make the default `auto` with that list as auto_cards; none is Cheapest in Stock. The datacenter is the one the window's table shows.
const configModal = (page) => page.locator('.modal.show', { has: page.getByTestId('config-modal') })
const lastPut = (api) => api.calls.filter((c) => c.method === 'PUT' && c.path === '/mounts').at(-1).body
const open = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = configModal(page); await cfgTab(d, 'volume'); return d }
const chip = (page, card, dc) => page.getByTestId('choose-card-modal').locator(`[data-testid="dc-card-row"][data-card="${card}"] [data-testid="dc-chip"][data-dc="${dc}"]`)

test('The datacenter and the cards are one block with a Select Card(s) button; the old datacenter table, Default card select and Stock cards list are gone', async ({ page }) => {
  const d = await open(page)
  const b = d.getByTestId('cfg-cards-block')
  await expect(b).toContainText(t('config.cardsTitle')); await expect(b.getByTestId('cfg-choose-card-btn')).toHaveText(/Select Card\(s\)/)
  await expect(b.getByTestId('cfg-cards-dc')).toContainText(t('config.datacenterAny')); await expect(b.getByTestId('cfg-cards-chosen')).toContainText(t('config.cardsStock'))
  await expect(d.getByTestId('cfg-default-gpu')).toHaveCount(0); await expect(d.getByTestId('cfg-auto-cards')).toHaveCount(0); await expect(d.getByTestId('cfg-dc')).toHaveCount(0)
})

test('One card at a datacenter: the datacenter and default_gpu save together, and the create form starts on that card', async ({ page, api }) => {
  const d = await open(page)
  await d.getByTestId('cfg-choose-card-btn').click()
  await expect(page.getByTestId('choose-card-modal')).toBeVisible()
  await page.getByTestId('choose-card-modal').getByTestId('dc-dc-filter').selectOption('')   // All datacenters
  await chip(page, 'RTX 4090', 'EU-RO-1').click()
  await page.getByTestId('choose-card-modal').getByRole('button', { name: 'Use these cards' }).click()
  await expect(d.getByTestId('cfg-cards-dc')).toContainText('EU-RO-1'); await expect(d.getByTestId('cfg-cards-chosen')).toContainText('RTX 4090')
  await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
  expect(lastPut(api)).toMatchObject({ data_center_id: 'EU-RO-1', default_gpu: 'rtx4090' }); expect(lastPut(api).auto_cards || []).toEqual([])
  await page.getByTestId('open-config').click(); const d2 = configModal(page); await cfgTab(d2, 'volume')
  await expect(d2.getByTestId('cfg-cards-chosen')).toContainText('RTX 4090'); await expect(d2.getByTestId('cfg-cards-dc')).toContainText('EU-RO-1')   // kept
  await d2.getByTestId('config-save').click()
  await openCreatePod(page)
  await expect(page.getByTestId('pod-gpu-chosen')).toHaveAttribute('data-value', 'rtx4090')
})

test('The cards Cheapest in Stock tries are their own selection: Select Card(s) adds and removes cards wherever they are clicked, and auto_cards saves; the default card is not touched', async ({ page, api }) => {
  const d = await open(page)
  await expect(d.getByTestId('cfg-cards-stock')).toContainText(t('config.cardsStockBuiltin'))
  await d.getByTestId('cfg-choose-stock-btn').click()
  await page.getByTestId('choose-card-modal').getByTestId('dc-dc-filter').selectOption('')
  await chip(page, 'RTX 4090', 'EU-RO-1').click(); await chip(page, 'RTX 4000 Ada', 'EU-RO-1').click(); await chip(page, 'A40', 'CA-MTL-1').click()
  await page.getByTestId('choose-card-modal').getByRole('button', { name: 'Use these cards' }).click()
  await expect(d.getByTestId('cfg-cards-stock')).toContainText('RTX 4090 24 GB, RTX 4000 Ada 20 GB, A40 48 GB')
  await expect(d.getByTestId('cfg-cards-dc')).toContainText(t('config.datacenterAny'))   // the stock list belongs to no datacenter
  await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
  expect(lastPut(api)).toMatchObject({ auto_cards: ['rtx4090', 'rtx4000ada', 'a40'] })
})
