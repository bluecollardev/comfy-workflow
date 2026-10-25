import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    await expect(card.getByTestId('pod-status')).toHaveText(/Starting|Running/)
    await expect(card.getByTestId('pod-idle')).toHaveText(t('pod.idleAfter', { n: 5 }))
    await expect(page.getByTestId('stat-total').getByTestId('stat-value')).toHaveText('1')

    await card.getByTestId('pod-stop').click()
    await expect(toast(page).last()).toContainText(t('toast.podStopped'))
    await expect(card.getByTestId('pod-status')).toHaveText(t('pod.statuses.stopped'))
    await card.getByTestId('pod-resume').click()
    await expect(toast(page).last()).toContainText(t('toast.podResumed'))
    await expect(card.getByTestId('pod-status')).toHaveText(/Starting|Running/)

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
    await dialog.getByTestId('cfg-tab-folders').click()   // Default Configuration is tabs on a wide screen
    await dialog.getByTestId('folder-row-project').getByTestId('folder-local').fill(configDir)
    await dialog.getByTestId('config-save').click()
    await expect(toast(page).last()).toContainText(t('toast.configSaved'))
    await expect(dialog).toBeHidden()
    await openCreatePod(page)
    await expect(page.getByTestId('pod-mounts-group')).toContainText(t('form.summaryMapped', { mapped: 1, total: 3, links: 0 }))
  })
})

// RUNPOD_DRY_RUN=1 in the environment forces no-spend mode: the switch says so and cannot turn it off.
test.describe('no-spend mode forced by the environment', () => {
  let ctx
  test.beforeAll(async () => { ctx = await launchApp({ dry: true }) })
  test.afterAll(async () => { await ctx.app.close() })

  test('the header says no-spend, and the Configuration switch is locked with the reason', async () => {
    const { page } = ctx
    await expect(page.getByTestId('no-spend-badge')).toHaveText(t('app.noSpend'))
    await page.getByTestId('open-config').click()
    const dialog = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await dialog.getByTestId('cfg-tab-options').click()
    await expect(dialog.getByTestId('cfg-dry-run')).toBeDisabled()                   // mounts.payload dry_run_forced, over IPC
    await expect(dialog.getByTestId('cfg-dry-forced')).toContainText('RUNPOD_DRY_RUN=1')
    await dialog.getByTestId('config-close').click()
  })
})

// Without the variable the switch is in charge, and the header follows a Save at once (the pod list is asked again, simulated pods replace real ones).
test.describe('no-spend mode from the switch', () => {
  let ctx
  test.beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runpod-key-'))
    writeFileSync(join(dir, '.env'), 'RUNPOD_API_KEY=rpa_0123456789ABCDEFXYZ1\n')   // a key, so the panel opens; no call is made with it once the mode is on
    ctx = await launchApp({ dry: false, env: { SETTINGS_ENV_FILE: join(dir, '.env') } })
  })
  test.afterAll(async () => { await ctx.app.close() })

  test('turning it on shows the badge without a refresh, and turning it off takes it away', async () => {
    const { page } = ctx
    await expect(page.getByTestId('no-spend-badge')).toHaveCount(0)
    await page.getByTestId('open-config').click()
    let dialog = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await dialog.getByTestId('cfg-tab-options').click()
    await expect(dialog.getByTestId('cfg-dry-run')).toBeEnabled()
    await expect(dialog.getByTestId('cfg-dry-forced')).toHaveCount(0)
    await dialog.getByTestId('cfg-dry-run').check()
    await dialog.getByTestId('config-save').click()
    await expect(page.getByTestId('no-spend-badge')).toHaveText(t('app.noSpend'))      // pods.dryRun followed the save
    await page.getByTestId('toast-close').first().click().catch(() => {})
    await page.getByTestId('open-config').click()
    dialog = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await dialog.getByTestId('cfg-tab-options').click()
    await expect(dialog.getByTestId('cfg-dry-run')).toBeChecked()
    await dialog.getByTestId('cfg-dry-run').uncheck()
    await dialog.getByTestId('config-save').click()
    await expect(page.getByTestId('no-spend-badge')).toHaveCount(0)
  })
})

