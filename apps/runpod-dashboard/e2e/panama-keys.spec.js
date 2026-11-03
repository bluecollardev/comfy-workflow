import { test, expect } from './fixtures'
import { podCard } from './fixtures'

// The Panama bucket (BH) configured in the app (docs/ADR-015, ADR-016): keys entered once in Default Configuration, the pull setting saved as the
// pod's S3_PULL, and the BH source turning on without any AWS profile on this PC.
const configModal = (page) => page.locator('.modal.show', { has: page.getByTestId('config-modal') })

test('keys entered in Default Configuration are stored (last four only), save S3_PULL as a pod variable, and turn the Panama source on in Import Shot Pack', async ({ page, api }) => {
  api.state.mounts.config.folders['comfy-shared'] = '/Users/lucas/ComfyUI-Shared'
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()   // no keys, no profile: the Panama card is there but disabled, with the way to set it up
  await expect(page.getByTestId('import-source-panama')).toBeDisabled()
  await expect(page.getByTestId('import-source-panama-setup')).toBeVisible()
  await page.locator('.modal.show').getByRole('button', { name: 'Done' }).click()

  await page.getByTestId('open-config').click()
  const dialog = configModal(page)
  await expect(dialog.getByTestId('cfg-panama-group')).toContainText('Not set')
  await dialog.getByTestId('cfg-panama-access').fill('AKIAEXAMPLE1234')
  await dialog.getByTestId('cfg-panama-secret').fill('example-secret-value')
  await dialog.getByTestId('cfg-panama-pull').fill('bh-panama-exchange-610140802195/rounds/brynley-inbox-2026-10-28-v001=/workspace/comfy-shared/input/brynley-inbox-2026-10-28-v001')
  await dialog.getByTestId('config-save').click()
  await expect(dialog).toBeHidden()

  const settings = api.calls.find((c) => c.method === 'PUT' && c.path === '/settings' && c.body?.panama_aws_access_key)
  expect(settings.body).toMatchObject({ panama_aws_access_key: 'AKIAEXAMPLE1234', panama_aws_secret_key: 'example-secret-value' })
  const mountsPut = api.calls.find((c) => c.method === 'PUT' && c.path === '/mounts')
  expect(mountsPut.body.env.S3_PULL).toContain('brynley-inbox-2026-10-28-v001')
  expect(JSON.stringify(mountsPut.body)).not.toMatch(/AKIAEXAMPLE|example-secret/)         // the keys never ride in the mounts file

  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
  await expect(page.getByTestId('import-source-panama')).toBeEnabled()   // BH is on now, with no AWS profile involved
  await page.locator('.modal.show').getByRole('button', { name: 'Done' }).click()

  await page.getByTestId('open-config').click()
  await expect(configModal(page).getByTestId('cfg-panama-group')).toContainText('••••1234')
  await expect(configModal(page).getByTestId('cfg-panama-group')).not.toContainText('AKIAEXAMPLE')
  await expect(configModal(page).getByTestId('cfg-panama-pull')).toHaveValue(/brynley-inbox/)
})
