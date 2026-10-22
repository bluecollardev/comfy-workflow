import { test, expect, openCreatePod, modal } from './fixtures'
import { t } from './i18n'

const CONFIGURED = 'ghcr.io/example/comfy-app:v26'
const STOCK = 'ashleykza/comfyui:latest'

test.describe('the Dockerfile modal', () => {
  test('opens from the create form on the configured image; the dropdown swaps the content per image', async ({ page, api }) => {
    await page.goto('/')
    await openCreatePod(page)
    await page.getByTestId('pod-image-dockerfile').click()
    const dialog = modal(page, t('dockerfile.title'))
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('dockerfile-image')).toHaveValue(CONFIGURED)
    await expect(dialog.getByTestId('dockerfile-built')).toContainText(`Reconstructed from ${CONFIGURED}`)
    await expect(dialog.getByTestId('dockerfile-built')).toContainText('COPY packs /opt/ComfyUI/custom_nodes/')
    await dialog.getByTestId('dockerfile-image').selectOption(STOCK)           // another image: the content swaps
    await expect(dialog.getByTestId('dockerfile-built')).toContainText('RUN stock-install')
    await expect(dialog.getByTestId('dockerfile-built')).not.toContainText('COPY packs')
    expect(api.calls.filter((c) => c.path === '/images/dockerfile').map((c) => c.query.image)).toEqual([CONFIGURED, STOCK])
    await dialog.getByRole('tab', { name: t('dockerfile.source') }).click()
    await expect(dialog.getByTestId('dockerfile-source')).toContainText('upstream comfyui-docker')   // the stock image's source, from its repository
    await expect(dialog.getByTestId('dockerfile-source-link').first()).toHaveAttribute('href', /ashleykleynhans\/comfyui-docker/)
    await dialog.getByTestId('dockerfile-image').selectOption(CONFIGURED)                       // swapping images keeps the Source tab
    await expect(dialog.getByTestId('dockerfile-source')).toContainText('the repo Dockerfile')   // ours: this repo's
    await dialog.getByTestId('dockerfile-image').selectOption(STOCK)
    await dialog.getByRole('tab', { name: t('dockerfile.config') }).click()
    await expect(dialog.getByTestId('dockerfile-env')).toHaveText('WEB_PORT=3001')
    await expect(dialog.getByTestId('dockerfile-config')).toContainText('3001/tcp')
  })

  test('a typed image appears in the menu; an unreadable one says why and keeps the source', async ({ page }) => {
    await page.goto('/')
    await openCreatePod(page)
    await page.locator('#pod-image').selectOption('custom')
    await page.locator('#pod-image-uri').fill('docker.io/me/missing:1')
    await page.getByTestId('pod-image-dockerfile').click()
    const dialog = modal(page, t('dockerfile.title'))
    await expect(dialog.getByTestId('dockerfile-image')).toHaveValue('docker.io/me/missing:1')
    await expect(dialog.getByTestId('dockerfile-error')).toContainText('manifest unknown')
    await dialog.getByRole('tab', { name: t('dockerfile.source') }).click()
    await expect(dialog.getByTestId('dockerfile-source-note')).toContainText('No source repository is known')   // said, not hidden
  })

  test('the Default Configuration image field has the button too', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('open-config').click()
    await page.getByTestId('cfg-image-dockerfile').click()
    await expect(modal(page, t('dockerfile.title')).getByTestId('dockerfile-image')).toHaveValue(CONFIGURED)
  })

  test('a pod card has an Image row with a Dockerfile link that opens the same modal on the pod\'s image', async ({ page }) => {
    await page.goto('/')
    const card = page.locator('[data-testid="pod-card"][data-name="ComfyUI-Dev"]')
    await expect(card.getByTestId('pod-image-ref')).toHaveText(CONFIGURED)
    await card.getByTestId('pod-dockerfile').click()
    const dialog = modal(page, t('dockerfile.title'))
    await expect(dialog.getByTestId('dockerfile-image')).toHaveValue(CONFIGURED)
    await expect(dialog.getByTestId('dockerfile-image').locator('option').first()).toHaveText(t('dockerfile.optThisPod', { ref: CONFIGURED }))
    await expect(dialog.getByTestId('dockerfile-built')).toContainText(`Reconstructed from ${CONFIGURED}`)
  })
})
