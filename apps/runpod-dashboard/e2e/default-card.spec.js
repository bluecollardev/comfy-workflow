import { test, expect, cfgTab, openCreatePod } from './fixtures'
import { t } from './i18n'

// The default card (Default Configuration > Options): one system-wide setting for the card a new pod gets when none is chosen; the create form starts on it.
const configModal = (page) => page.locator('.modal.show', { has: page.getByTestId('config-modal') })

test('Default card: pick the RTX PRO 6000, save, and the configuration carries default_gpu; the create form starts on it', async ({ page, api }) => {
  await page.goto('/')
  await page.getByTestId('open-config').click()
  const dialog = configModal(page)
  await cfgTab(dialog, 'options')
  const sel = dialog.getByTestId('cfg-default-gpu')
  await expect(sel).toBeVisible()
  await expect(dialog.getByText(t('config.defaultGpu'))).toBeVisible()
  await sel.selectOption('rtxpro6000')
  await dialog.getByTestId('config-save').click()
  await expect(dialog).toBeHidden()
  const puts = api.calls.filter((c) => c.method === 'PUT' && c.path === '/mounts')
  expect(puts[puts.length - 1].body).toMatchObject({ default_gpu: 'rtxpro6000' })
  await page.getByTestId('open-config').click()
  await cfgTab(configModal(page), 'options')
  await expect(configModal(page).getByTestId('cfg-default-gpu')).toHaveValue('rtxpro6000')   // kept
  await configModal(page).getByTestId('config-save').click()
  await openCreatePod(page)
  await expect(page.getByTestId('pod-gpu-chosen')).toHaveAttribute('data-value', 'rtxpro6000')   // the form starts on the default card
})
