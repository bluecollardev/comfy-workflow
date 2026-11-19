import { test, expect, modal } from './fixtures'
import { t } from './i18n'

// Network Volumes also lists the BH exchange bucket, with Explore: a read-only browser of the bucket (folders in, breadcrumb up, filter, pages).
const openVolumes = async (page) => {
  await page.getByTestId('open-shared').click()
  await page.getByTestId('shared-volumes').click()
  const dialog = modal(page, t('volumes.title'))
  await expect(dialog).toBeVisible()
  return dialog
}

test('the BH bucket entry says the keys are missing and Explore is off until they are set', async ({ page }) => {
  await page.goto('/')
  const dialog = await openVolumes(page)
  await expect(dialog.getByTestId('volume-bh')).toBeVisible()
  await expect(dialog.getByTestId('volume-bh-keys')).toContainText('not set')
  await expect(dialog.getByTestId('volume-bh-explore')).toBeDisabled()
  await expect(dialog.getByTestId('volume').first()).toBeVisible()   // the RunPod volumes are still there
})

test('Explore opens the bucket: into a folder, back by the breadcrumb, filter, pages', async ({ page, api }) => {
  api.state.panama = { configured: true }
  await page.goto('/')
  const dialog = await openVolumes(page)
  await expect(dialog.getByTestId('volume-bh-facts')).toContainText('bh-panama-exchange-610140802195')
  await dialog.getByTestId('volume-bh-explore').click()
  const m = page.getByTestId('bucket-modal')
  await expect(m).toBeVisible()
  await expect(m.locator('[data-testid="bucket-row"][data-name="rounds"]')).toBeVisible()
  await m.locator('[data-testid="bucket-row"][data-name="returns"]').getByTestId('bucket-folder').click()
  await m.locator('[data-testid="bucket-row"][data-name="BKK"]').getByTestId('bucket-folder').click()
  await expect(m.getByTestId('bucket-crumb-current')).toHaveAttribute('data-prefix', 'returns/BKK/')
  await expect(m.getByTestId('bucket-row')).toHaveCount(100)   // 2 folders + 130 files, 100 to a page
  await expect(m.getByTestId('bucket-page')).toContainText('2')
  await m.getByTestId('bucket-next').click()
  await expect(m.getByTestId('bucket-row')).toHaveCount(32)
  await m.getByTestId('bucket-filter').fill('take-007')
  await expect(m.getByTestId('bucket-row')).toHaveCount(1)
  await expect(m.getByTestId('bucket-row')).toContainText('8 KB')
  await m.getByTestId('bucket-filter').fill('zzz')
  await expect(m.getByTestId('bucket-nomatch')).toBeVisible()
  await m.getByTestId('bucket-filter').fill('shot-001')
  await m.getByTestId('bucket-folder').click()
  await expect(m.locator('[data-testid="bucket-row"][data-name="v001.exr"]')).toBeVisible()
  await m.locator('[data-testid="bucket-crumb"][data-prefix="returns/"]').click()
  await expect(m.locator('[data-testid="bucket-row"][data-name="BKK"]')).toBeVisible()
  await m.locator('[data-testid="bucket-crumb"][data-prefix=""]').click()
  await expect(m.locator('[data-testid="bucket-row"][data-name="rounds"]')).toBeVisible()
  expect(api.calls.filter((c) => c.path === '/panama/browse').every((c) => c.method === 'GET')).toBe(true)
})
