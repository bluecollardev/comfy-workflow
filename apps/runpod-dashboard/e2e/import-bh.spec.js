import { test, expect, modal } from './fixtures'
import { podCard } from './fixtures'
import { t } from './i18n'

// Import Shot Pack with the BH source (docs/ADR-016): the source picker, and the pod card's Import from BH button.
// Both appear only when the Panama bucket is configured (an AWS profile); otherwise the modal is the folder import, as before.
const dialogOf = (page) => modal(page, t('import.title'))

test.describe('Import from BH', () => {
  test('Panama not configured: no BH button, and Import Shot Pack goes straight to the folder import', async ({ page, api }) => {
    api.state.mounts.config.folders['comfy-shared'] = '/Users/lucas/ComfyUI-Shared'
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    await expect(card.getByTestId('pod-import')).toBeVisible()
    await expect(card.getByTestId('pod-import-bh')).toHaveCount(0)
    await card.getByTestId('pod-import').click()
    const dialog = dialogOf(page)
    await expect(dialog.getByTestId('import-pane')).toBeVisible()
    await expect(dialog.getByTestId('import-source-picker')).toHaveCount(0)
  })

  test('configured: Import Shot Pack asks for the source; Folder opens the folder import, Panama lists the rounds', async ({ page, api }) => {
    api.state.mounts.config.folders['comfy-shared'] = '/Users/lucas/ComfyUI-Shared'
    api.state.panama = { configured: true }
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
    const dialog = dialogOf(page)
    await expect(dialog.getByTestId('import-source-picker')).toBeVisible()
    await dialog.getByTestId('import-source-folder').click()
    await expect(dialog.getByTestId('import-pane')).toBeVisible()
    await dialog.getByTestId('import-source-change').click()
    await dialog.getByTestId('import-source-panama').click()
    await expect(dialog.getByTestId('panama-round')).toHaveCount(2)
    await expect(dialog.locator('[data-testid="panama-round"][data-round="brynley-inbox-2026-10-28-v001"]').getByTestId('panama-staged')).toBeVisible()
  })

  test('the pod card\'s Import from BH opens the modal already on the Panama source, and Use for import hands the folder to the import', async ({ page, api }) => {
    api.state.mounts.config.folders['comfy-shared'] = '/Users/lucas/ComfyUI-Shared'
    api.state.panama = { configured: true }
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import-bh').click()
    const dialog = dialogOf(page)
    await expect(dialog.getByTestId('panama-pane')).toBeVisible()
    await expect(dialog.getByTestId('import-source-picker')).toHaveCount(0)
    await dialog.locator('[data-testid="panama-round"][data-round="brynley-inbox-2026-10-28-v001"]').getByTestId('panama-use').click()
    await expect(dialog.getByTestId('import-pane')).toBeVisible()
    await expect(dialog.getByTestId('import-folder')).toHaveValue('/Users/lucas/panama-rounds/brynley-inbox-2026-10-28-v001')
  })

  test('a running download has a Cancel; it stops, says what stays, and the round can be downloaded again', async ({ page, api }) => {
    api.state.panama = { configured: true, slow: true }
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import-bh').click()
    const dialog = dialogOf(page)
    await dialog.locator('[data-testid="panama-round"][data-round="brynley-comfy-2026-10-23"]').getByTestId('panama-pull').click()
    await expect(dialog.getByTestId('panama-job-state')).toHaveText(t('panama.state.running'))
    await expect(dialog.getByTestId('panama-job-header').getByTestId('panama-cancel')).toBeVisible()   // in the card's header, not inline under it
    await dialog.getByTestId('panama-cancel').click()
    await expect(dialog.getByTestId('panama-job-state')).toHaveText(t('panama.state.cancelled'))
    await expect(dialog.getByTestId('panama-job-cancelled')).toBeVisible()
    await expect(dialog.getByTestId('panama-cancel')).toHaveCount(0)
    expect(api.state.panama.cancelled).toBe('brynley-comfy-2026-10-23-1')
    await expect(dialog.locator('[data-testid="panama-round"][data-round="brynley-comfy-2026-10-23"]').getByTestId('panama-pull')).toBeEnabled()
  })
})
