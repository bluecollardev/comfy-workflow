import { test, expect } from '@playwright/test'
import { configModal, launchApp, openCreatePod, podCard, toast } from './app.js'
import { t } from '../e2e/i18n.js'

// The whole pod lifecycle in the real app, over IPC, with pods simulated. Nothing bills.
test.describe('the app in no-spend mode', () => {
  let ctx
  test.beforeAll(async () => { ctx = await launchApp({ dry: true }) })
  test.afterAll(async () => { await ctx.app.close() })

  test('boots on its own, says it is in no-spend mode, and answers over IPC', async () => {
    const { page } = ctx
    await expect(page.getByTestId('no-spend-badge')).toHaveText(t('app.noSpend'))
    expect(page.url().startsWith('file://')).toBe(true)
    await expect(page.getByTestId('stat-total').getByTestId('stat-value')).toHaveText('0')
  })

  test('creates, shows, stops, resumes and deletes a simulated pod with a toast each time', async () => {
    const { page } = ctx
    await openCreatePod(page)
    await page.locator('#pod-name').fill('Sim-One')
    await page.locator('#pod-image').selectOption('prebuilt')   // the default local tag is refused by design, even simulated
    await page.locator('#pod-idle').fill('5')
    await page.getByTestId('pod-submit').click()
    await expect(toast(page).first()).toContainText(t('toast.podCreated', { name: 'Sim-One' }))
    const card = podCard(page, 'Sim-One')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('pod-status')).toHaveText(/starting|running/)
    await expect(card.getByTestId('pod-idle')).toHaveText(t('pod.idleAfter', { n: 5 }))
    await expect(page.getByTestId('stat-total').getByTestId('stat-value')).toHaveText('1')

    await card.getByTestId('pod-stop').click()
    await expect(toast(page).last()).toContainText(t('toast.podStopped'))
    await expect(card.getByTestId('pod-status')).toHaveText('stopped')
    await card.getByTestId('pod-resume').click()
    await expect(toast(page).last()).toContainText(t('toast.podResumed'))
    await expect(card.getByTestId('pod-status')).toHaveText(/starting|running/)

    page.once('dialog', (d) => d.accept())
    await card.getByTestId('pod-delete').click()
    await expect(toast(page).last()).toContainText(t('toast.podDeleted'))
    await expect(card).toHaveCount(0)
  })

  test('the configuration panel maps a folder and saves over IPC', async () => {
    const { page, configDir } = ctx
    await page.getByTestId('open-config').click()
    const dialog = configModal(page)
    await expect(dialog.getByTestId('config-mode')).toHaveText('dev')
    await dialog.getByTestId('folder-row-project').getByTestId('folder-local').fill(configDir)
    await dialog.getByTestId('config-save').click()
    await expect(toast(page).last()).toContainText(t('toast.configSaved'))
    await expect(dialog).toBeHidden()
    await openCreatePod(page)
    await expect(page.getByTestId('pod-mounts-group')).toContainText(t('form.summaryMapped', { mapped: 1, total: 3, links: 0 }))
  })
})
