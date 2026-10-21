import { test, expect, modal } from './fixtures'
import { t } from './i18n'

const openVolumes = async (page) => {
  await page.getByTestId('open-volumes').click()
  const dialog = modal(page, t('volumes.title'))
  await expect(dialog).toBeVisible()
  return dialog
}
const volume = (dialog, id) => dialog.locator('[data-testid="volume"]', { has: dialog.page().locator(`[data-id="${id}"]`) }).first()

test.describe('volumes', () => {
  test('lists the account\'s volumes with cost, datacenter, S3 and the pods on each', async ({ page }) => {
    await page.goto('/')
    const dialog = await openVolumes(page)
    const v1 = dialog.locator('[data-testid="volume"][data-id="vol1"]')
    await expect(v1.getByTestId('volume-name')).toHaveText('comfy-workspace')
    await expect(v1.getByTestId('volume-facts')).toHaveText(t('volumes.facts', { size: 120, dc: 'EU-RO-1', cost: '8.40' }))
    await expect(v1.getByTestId('volume-s3')).toBeVisible()
    await expect(v1.getByTestId('volume-pod')).toHaveCount(2)
    await expect(v1.locator('[data-testid="volume-pod"][data-pod="pod-aaaaaaaa"]')).toContainText('ComfyUI-Dev · running')
    await expect(v1.locator('[data-testid="volume-pod"][data-pod="pod-cccccccc"]')).toContainText(t('volumes.configOnly'))
    await expect(v1.getByTestId('volume-delete')).toBeDisabled()   // a pod is attached
    const v2 = dialog.locator('[data-testid="volume"][data-id="vol2"]')
    await expect(v2.getByTestId('volume-pods')).toContainText(t('volumes.noPods'))
    await expect(v2.getByTestId('volume-s3')).toHaveCount(0)
  })

  test('use as default writes the volume and its datacenter into the Default Configuration', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openVolumes(page)
    await dialog.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-use-default').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.volumeDefault', { name: 'comfy-workspace', dc: 'EU-RO-1' }))
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/volumes/vol1/default')).toBe(true)
    await expect(dialog.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-default')).toBeVisible()
    expect(api.state.mounts.config.network_volume_id).toBe('vol1'); expect(api.state.mounts.config.data_center_id).toBe('EU-RO-1')
  })

  test('creates, grows and deletes a volume; deleting one with a pod is refused', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openVolumes(page)
    await dialog.getByTestId('volume-new-name').fill('plates')
    await dialog.getByTestId('volume-new-size').fill('200')
    await dialog.getByTestId('volume-new-dc').selectOption('EU-RO-1')
    await dialog.getByTestId('volume-create').click()
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '/volumes').body).toEqual({ name: 'plates', size_gb: 200, datacenter: 'EU-RO-1' })
    const created = dialog.locator('[data-testid="volume"]', { hasText: 'plates' })
    await expect(created.getByTestId('volume-facts')).toContainText('200 GB in EU-RO-1')
    await created.getByTestId('volume-resize').click()
    await created.getByTestId('volume-resize-input').fill('300')
    await created.getByTestId('volume-resize-save').click()
    await expect(created.getByTestId('volume-facts')).toContainText('300 GB')
    page.on('dialog', (d) => d.accept())
    await dialog.locator('[data-testid="volume"][data-id="vol2"]').getByTestId('volume-delete').click()
    await expect(dialog.locator('[data-testid="volume"][data-id="vol2"]')).toHaveCount(0)
    expect(api.calls.some((c) => c.method === 'DELETE' && c.path === '/volumes/vol2')).toBe(true)
  })
})
