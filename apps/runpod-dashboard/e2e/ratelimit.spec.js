import { test, expect, openModels } from './fixtures'
import { t } from './i18n'

// RunPod's request limit (ADR-042 section 18): one calm banner while it holds, and an unreadable volume list is never "no volume".

test.describe('RunPod request limit', () => {
  test('no banner while RunPod answers; one line under the nav bar while it limits, with the window, the age of what is shown and the retry time', async ({ page, api }) => {
    await page.goto('/')
    await expect(page.getByTestId('rate-limit-banner')).toHaveCount(0)
    api.state.ratelimit = { limited: true, window: 'hour', retry_at: '2026-11-16T09:30:00.000Z', since: '2026-11-16T09:00:00.000Z', stale_age_s: 420, message: 'rate limit exceeded for the hour window' }
    const at = new Date('2026-11-16T09:30:00.000Z').toTimeString().slice(0, 5)
    const banner = page.getByTestId('rate-limit-banner')
    await expect(banner).toBeVisible({ timeout: 10000 })   // asked every 5 seconds, from the core's memory
    await expect(banner).toContainText(t('rate.window_hour'))
    await expect(banner).toContainText('7 Min Ago')
    await expect(banner).toContainText(at)
    api.state.ratelimit = null
    await expect(banner).toHaveCount(0, { timeout: 10000 })
  })

  test('the volume list cannot be read (RunPod limits requests): Models still loads onto the stored Shared volume', async ({ page, api }) => {
    api.state.volumesFail = true
    api.state.mounts.config.shared_volume_id = 'vol1'
    api.state.mounts.config.network_volume_id = 'vol1'
    api.state.mounts.config.data_center_id = 'EU-RO-1'
    await page.goto('/')
    await openModels(page)
    const m = page.getByTestId('models-modal')
    await expect(m.getByTestId('models-target')).toContainText('vol1')
    await expect(m.getByTestId('models-target')).not.toContainText(t('models.targetNone'))
  })

  test('"There is no volume to load onto" appears only when no volume id is stored at all', async ({ page, api }) => {
    api.state.volumesFail = true
    api.state.mounts.config.shared_volume_id = ''
    api.state.mounts.config.network_volume_id = ''
    await page.goto('/')
    await openModels(page)
    await expect(page.getByTestId('models-modal').getByTestId('models-target')).toContainText(t('models.targetNone'))
  })
})
