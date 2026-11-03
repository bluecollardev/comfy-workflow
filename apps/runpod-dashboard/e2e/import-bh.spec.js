import { test, expect, modal } from './fixtures'
import { podCard } from './fixtures'
import { t } from './i18n'

// Import Shot Pack with the BH source (docs/ADR-016): the source picker, and the pod card's Import from BH button.
// Both appear only when the Panama bucket is configured (an AWS profile); otherwise the modal is the folder import, as before.
const dialogOf = (page) => modal(page, t('import.title'))

test.describe('Import from BH', () => {
  test('one Import Shot Pack button; the source picker is always first, and without Panama set up its card is disabled with the way to set it up', async ({ page, api }) => {
    api.state.mounts.config.folders['comfy-shared'] = '/Users/lucas/ComfyUI-Shared'
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    await expect(card.getByTestId('pod-import')).toBeVisible()
    await expect(card.getByTestId('pod-import-bh')).toHaveCount(0)   // there is no second button
    await card.getByTestId('pod-import').click()
    const dialog = dialogOf(page)
    await expect(dialog.getByTestId('import-source-picker')).toBeVisible()
    await expect(dialog.getByTestId('import-pane')).toHaveCount(0)
    await expect(dialog.getByTestId('import-source-panama')).toBeDisabled()
    await expect(dialog.getByTestId('import-source-panama-setup')).toBeVisible()
    await dialog.getByTestId('import-source-folder').click()   // the folder / zip source still works, and can go back to the picker
    await expect(dialog.getByTestId('import-pane')).toBeVisible()
    await dialog.getByTestId('import-source-change').click()
    await expect(dialog.getByTestId('import-source-picker')).toBeVisible()
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
    await expect(dialog.getByTestId('panama-round')).toHaveCount(3)
    await expect(dialog.locator('[data-testid="panama-round"][data-round="brynley-inbox-2026-10-28-v001"]').getByTestId('panama-staged')).toBeVisible()
  })

  test('the Panama source lists the rounds, and Import Package hands the staged folder to the import', async ({ page, api }) => {
    api.state.mounts.config.folders['comfy-shared'] = '/Users/lucas/ComfyUI-Shared'
    api.state.panama = { configured: true }
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
    const dialog = dialogOf(page)
    await dialog.getByTestId('import-source-panama').click()
    await expect(dialog.getByTestId('panama-pane')).toBeVisible()
    const staged = dialog.locator('[data-testid="panama-round"][data-round="brynley-inbox-2026-10-28-v001"]')
    const at = async (id) => (await staged.getByTestId(id).boundingBox()).x
    expect(await at('panama-staged')).toBeLessThan(await at('panama-pull'))   // the downloaded badge comes before the buttons
    await staged.getByTestId('panama-use').click()
    await expect(dialog.getByTestId('import-pane')).toBeVisible()
    await expect(dialog.getByTestId('import-folder')).toHaveValue('/Users/lucas/panama-rounds/brynley-inbox-2026-10-28-v001')
  })

  test('a running download has a Cancel; it stops, says what stays, and the round can be downloaded again', async ({ page, api }) => {
    api.state.panama = { configured: true, slow: true }
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
    const dialog = dialogOf(page)
    await dialog.getByTestId('import-source-panama').click()
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

  test('the list says what is on this PC: none, partial with the counts, or downloaded; the buttons follow (Download, Resume, Re-Download)', async ({ page, api }) => {
    api.state.panama = { configured: true }
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
    const dialog = dialogOf(page)
    await dialog.getByTestId('import-source-panama').click()
    const row = (name) => dialog.locator(`[data-testid="panama-round"][data-round="${name}"]`)
    await expect(row('brynley-comfy-2026-10-23').getByTestId('panama-pull')).toHaveText(t('panama.download'))
    await expect(row('brynley-comfy-2026-10-23').getByTestId('panama-use')).toHaveCount(0)
    await expect(row('brynley-comfy-2026-10-20').getByTestId('panama-partial')).toContainText('391')
    await expect(row('brynley-comfy-2026-10-20').getByTestId('panama-partial')).toContainText('1283')
    await expect(row('brynley-comfy-2026-10-20').getByTestId('panama-pull')).toHaveText(t('panama.resume'))
    await expect(row('brynley-comfy-2026-10-20').getByTestId('panama-use')).toHaveCount(0)   // a partial round cannot be imported
    await expect(row('brynley-inbox-2026-10-28-v001').getByTestId('panama-staged')).toBeVisible()
    await expect(row('brynley-inbox-2026-10-28-v001').getByTestId('panama-pull')).toHaveText(t('panama.again'))
  })

  test('Delete frees the downloaded copy from this computer, after a confirmation that names the size; Keep leaves it', async ({ page, api }) => {
    api.state.panama = { configured: true }
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
    const dialog = dialogOf(page)
    await dialog.getByTestId('import-source-panama').click()
    const row = (name) => dialog.locator(`[data-testid="panama-round"][data-round="${name}"]`)
    await expect(row('brynley-comfy-2026-10-23').getByTestId('panama-delete')).toHaveCount(0)   // nothing on disk, nothing to delete
    await expect(row('brynley-comfy-2026-10-20').getByTestId('panama-on-disk')).toContainText('8.1 GB')
    await row('brynley-comfy-2026-10-20').getByTestId('panama-delete').click()   // a partial copy can be deleted too
    await expect(dialog.getByTestId('panama-delete-confirm')).toContainText('brynley-comfy-2026-10-20')
    await expect(dialog.getByTestId('panama-delete-confirm')).toContainText('8.1 GB')
    await dialog.getByTestId('panama-delete-no').click()
    await expect(dialog.getByTestId('panama-delete-confirm')).toHaveCount(0)
    expect(api.state.panama.deleted || []).toEqual([])
    await row('brynley-comfy-2026-10-20').getByTestId('panama-delete').click()
    await dialog.getByTestId('panama-delete-yes').click()
    await expect(dialog.getByTestId('panama-delete-confirm')).toHaveCount(0)
    expect(api.state.panama.deleted).toEqual(['brynley-comfy-2026-10-20'])
    await expect(row('brynley-comfy-2026-10-20').getByTestId('panama-partial')).toHaveCount(0)   // back to nothing on disk
    await expect(row('brynley-comfy-2026-10-20').getByTestId('panama-pull')).toHaveText(t('panama.download'))
    await expect(row('brynley-comfy-2026-10-20').getByTestId('panama-delete')).toHaveCount(0)
  })

  test('a download shows a progress bar and the files as they arrive, like the Sync window', async ({ page, api }) => {
    api.state.panama = { configured: true, slow: true }
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
    const dialog = dialogOf(page)
    await dialog.getByTestId('import-source-panama').click()
    await dialog.locator('[data-testid="panama-round"][data-round="brynley-comfy-2026-10-23"]').getByTestId('panama-pull').click()
    await expect(dialog.getByTestId('panama-bar')).toBeVisible()
    await expect(dialog.getByTestId('panama-bar')).toHaveAttribute('data-indeterminate', 'false')   // aws told us the total, so it is a real fraction
    await expect(dialog.getByTestId('panama-bar').locator('.progress-bar')).toHaveAttribute('style', /width:\s*33%/)
    await expect(dialog.getByTestId('panama-progress-detail')).toContainText('2.9 GB of 8.8 GB')
    await expect(dialog.getByTestId('panama-progress-detail')).toContainText('12 left')
    await expect(dialog.getByTestId('panama-progress-detail')).toContainText('/s')
    await expect(dialog.getByTestId('panama-file')).toHaveCount(3)
    await expect(dialog.getByTestId('panama-files')).toContainText('cgi-042/final/cgi-042_main_final_v01.mp4')
  })
})

