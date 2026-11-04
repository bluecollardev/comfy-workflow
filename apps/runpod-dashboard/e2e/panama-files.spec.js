import { test, expect, podCard } from './fixtures'
import { modal } from './fixtures'
import { t } from './i18n'

// Clicking a round opens a modal with its files as a folder tree (read-only listing of the bucket).
test('a round opens a file explorer modal: folders open and close, a file already on this PC is marked', async ({ page, api }) => {
  api.state.mounts.config.folders['comfy-shared'] = '/Users/lucas/ComfyUI-Shared'
  api.state.panama = { configured: true }
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
  const dialog = modal(page, t('import.title'))
  await dialog.getByTestId('import-source-panama').click()
  await dialog.locator('[data-testid="panama-round"][data-round="brynley-comfy-2026-10-23"]').getByTestId('panama-browse').click()
  const files = page.getByTestId('round-files-modal')
  await expect(files).toBeVisible()
  await expect(files.getByTestId('round-files-summary')).toContainText('4')
  const tree = files.getByTestId('round-files')
  await expect(tree.getByTestId('round-files-row')).toHaveCount(5)
  await tree.locator('[data-path="03_INBOX"]').click()   // collapse the folder
  await expect(tree.getByTestId('round-files-row')).toHaveCount(3)
  await tree.locator('[data-path="03_INBOX"]').click()
  await expect(tree.locator('[data-path="03_INBOX/ENTRY.md"]')).toHaveAttribute('data-status', 'copy')
  await expect(tree.locator('[data-path="03_INBOX/shot-001.exr"]')).toHaveAttribute('data-status', '')
})
