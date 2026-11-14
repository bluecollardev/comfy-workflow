import { test, expect, modal, answerConfirm } from './fixtures'
import { t } from './i18n'

const openVolumes = async (page) => {
  await page.getByTestId('open-volumes').click()
  const dialog = modal(page, t('volumes.title'))
  await expect(dialog).toBeVisible()
  return dialog
}
const volume = (dialog, id) => dialog.locator('[data-testid="volume"]', { has: dialog.page().locator(`[data-id="${id}"]`) }).first()

test.describe('volumes: browse and erase', () => {
  test('a volume the S3 API can read says it needs no pod', async ({ page }) => {
    await page.goto('/')
    const dialog = await openVolumes(page)
    await dialog.locator('[data-testid="volume"][data-id="vol2"]').getByTestId('volume-browse').click()
    await expect(page.getByTestId('volume-files-plan')).toContainText('no pod')
    await expect(page.getByTestId('volume-s3-note')).toHaveCount(0)
  })

  test('every action button keeps its icon and text on one row, at a narrow window too', async ({ page }) => {
    for (const w of [1100, 700]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto('/')
      const dialog = await openVolumes(page)
      const row = dialog.locator('[data-testid="volume"][data-id="vol1"]')
      for (const id of ['volume-browse', 'volume-resize', 'volume-erase', 'volume-delete', 'volume-use-default']) {
        const b = row.getByTestId(id)
        if (!(await b.count())) continue
        expect((await b.boundingBox()).height, `${id} at ${w}px`).toBeLessThan(36)   // a button with its icon on top of its text is about twice that
      }
    }
  })

  test('Browse lists a volume\'s folders with sizes; Erase needs folders, your name and the volume\'s name typed back, then reports what it freed', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openVolumes(page)
    await dialog.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-browse').click()
    const files = page.getByTestId('volume-files-modal')
    await expect(files.getByTestId('volume-files-plan')).toContainText('RTX 2000 Ada')   // where it runs and the price, before anything starts
    await expect(files.getByTestId('volume-s3-note')).toContainText('S3 keys')   // and why it is not the S3 API
    await files.getByTestId('volume-files-start').click()
    await expect(files.getByTestId('volume-files-row')).toHaveCount(5)
    await expect(files.getByTestId('volume-files-summary')).toContainText('5.0 GB')
    await expect(files.locator('[data-testid="volume-files-row"][data-path="comfy-shared/temp/rounds"]')).toContainText('3.0 GB')
    await files.getByText('Close', { exact: true }).click()
    await dialog.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-erase').click()
    const er = page.getByTestId('volume-erase-modal')
    await expect(er.locator('[data-testid="volume-erase-option"] input:checked')).toHaveCount(0)   // nothing is ticked for you
    await expect(er.getByTestId('volume-erase-go')).toBeDisabled()
    for (const k of ['rounds', 'inputs', 'workflows', 'output']) await er.locator(`[data-testid="volume-erase-option"][data-key="${k}"] input`).check()
    await er.getByTestId('volume-erase-by').fill('Lucas')
    await er.getByTestId('volume-erase-name').fill('wrong')
    await expect(er.getByTestId('volume-erase-go')).toBeDisabled()   // the name has to match exactly
    await er.getByTestId('volume-erase-scan').click()
    await expect(er.locator('[data-testid="volume-erase-option"][data-key="output"]').getByTestId('volume-erase-size')).toContainText('1.0 GB')
    await er.getByTestId('volume-erase-name').fill('comfy-workspace')
    await expect(er.getByTestId('volume-erase-go')).toBeEnabled()
    await er.getByTestId('volume-erase-go').click()
    await expect(er.getByTestId('volume-erase-job')).toContainText('Erased')
    expect(api.state.erased).toMatchObject({ id: 'vol1', keys: ['rounds', 'inputs', 'workflows', 'output'], approved_by: 'Lucas', confirm_name: 'comfy-workspace' })
  })
})

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
    await dialog.locator('[data-testid="volume"][data-id="vol2"]').getByTestId('volume-delete').click()
    await answerConfirm(page, true)
    await expect(dialog.locator('[data-testid="volume"][data-id="vol2"]')).toHaveCount(0)
    expect(api.calls.some((c) => c.method === 'DELETE' && c.path === '/volumes/vol2')).toBe(true)
  })
})
