import { test, expect } from '@playwright/test'
import { launchApp, openCreatePod, podCard, toast } from './app.js'
import { t } from '../e2e/i18n.js'

// Every call a card and the form make over IPC, in the real app, pods simulated (no-spend mode).
// A dispatch table that loses a call shows up here as the page's "no core call …" error.
test.describe('card actions over IPC', () => {
  let ctx
  test.beforeAll(async () => { ctx = await launchApp({ dry: true }) })
  test.afterAll(async () => { await ctx.app.close() })

  test('launches a pod from the form and the card shows it', async () => {
    const { page } = ctx
    await openCreatePod(page)
    await page.locator('#pod-name').fill('Sim-Card')
    await page.locator('#pod-image').selectOption('prebuilt')
    await page.getByTestId('pod-submit').click()
    await expect(toast(page).first()).toContainText(t('toast.podCreated', { name: 'Sim-Card' }))
    await expect(podCard(page, 'Sim-Card')).toBeVisible()
  })

  test('details, the idle stop and the logs modal answer over IPC', async () => {
    const { page } = ctx
    const card = podCard(page, 'Sim-Card')
    await card.getByTestId('pod-details-toggle').click()
    await expect(card.getByTestId('pod-details-status')).toContainText(/Simulated/)   // pods.details
    await card.getByTestId('pod-details-toggle').click()
    await card.getByTestId('pod-idle-edit').click()
    await card.getByTestId('pod-idle-input').fill('12')
    await card.getByTestId('pod-idle-save').click()                                    // pods.setIdle
    await expect(toast(page).last()).toContainText(t('toast.idleSet', { n: 12 }))
    await expect(card.getByTestId('pod-idle')).toContainText(t('pod.idleAfter', { n: 12 }))
    await card.getByTestId('pod-logs-toggle').click()
    const logs = page.locator('.modal.show', { hasText: t('pod.logsTitle', { name: 'Sim-Card' }) })
    await expect(logs).toBeVisible()
    await logs.getByRole('button', { name: 'Close' }).first().click().catch(() => page.keyboard.press('Escape'))
    await expect(logs).toBeHidden()
  })

  test('a pod gets its own configuration from the card, and Recreate carries it', async () => {
    const { page } = ctx
    const card = podCard(page, 'Sim-Card')
    await card.getByTestId('pod-config').click()                                       // pods.config
    const panel = page.locator('.modal.show', { has: page.getByTestId('config-modal-pod') })
    await expect(panel).toBeVisible()
    await panel.getByTestId('cfg-idle').fill('7')
    await panel.getByTestId('config-apply').click()                                    // pods.setConfig
    await expect(toast(page).last()).toContainText(t('toast.podConfigSet'))
    await expect(card.getByTestId('pod-config-badge')).toBeVisible()
    await card.getByTestId('pod-stop').click()
    await expect(card.getByTestId('pod-status')).toHaveText('stopped')
    page.once('dialog', (d) => d.accept())
    await card.getByTestId('pod-recreate').click()                                     // pods.recreate
    await expect(toast(page).last()).toContainText(t('toast.podRecreated'))
    await expect(card.getByTestId('pod-status')).toHaveText(/starting|running/)
    await expect(card.getByTestId('pod-config-badge')).toBeVisible()                  // the own configuration moved to the new pod
  })

  test('volumes and datacenters answer over IPC', async () => {
    const { page } = ctx
    await page.getByTestId('open-volumes').click()
    const volumes = page.locator('.modal.show', { hasText: t('volumes.title') })
    await expect(volumes).toBeVisible()
    await volumes.getByTestId('volume-new-name').fill('sim-vol')
    await volumes.getByTestId('volume-new-dc').selectOption('EU-RO-1')               // pods.datacenters (simulated menu)
    await volumes.getByTestId('volume-create').click()                                // volumes.create
    await expect(volumes.locator('[data-testid="volume"]', { hasText: 'sim-vol' })).toBeVisible()
    await volumes.locator('[data-testid="volume"]', { hasText: 'sim-vol' }).getByTestId('volume-use-default').click()   // volumes.useAsDefault
    await expect(toast(page).last()).toContainText('sim-vol')
    await volumes.getByRole('button', { name: t('volumes.done') }).click()
    await expect(volumes).toBeHidden()
    await page.getByTestId('open-config').click()
    const dialog = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await expect(dialog.getByTestId('cfg-dc')).toHaveValue('EU-RO-1')
    await expect(dialog.getByTestId('cfg-volume').locator('option', { hasText: 'sim-vol' })).toHaveCount(1)
    await dialog.getByTestId('config-close').click()
  })

  test('the Connect modal lists accounts and repositories over IPC', async () => {
    const { page } = ctx
    await page.getByTestId('open-connect').click()
    const connect = page.locator('.modal.show', { hasText: t('connect.title') })
    await expect(connect.getByTestId('connect-accounts')).toContainText('No accounts connected')    // git.accounts
    await connect.getByRole('tab', { name: t('connect.repositories') }).click()
    await expect(connect.getByTestId('connect-repositories')).toContainText('No repositories attached yet')   // repositories.list
    await connect.getByRole('button', { name: t('connect.done') }).click()
  })

  test('Sync: a confirmation with the plan and the transport, then the run with files, progress and the bar on the card', async () => {
    const { page, configDir } = ctx
    await page.getByTestId('open-config').click()
    const dialog = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await dialog.getByTestId('folder-row-project').getByTestId('folder-local').fill(configDir)   // something to copy
    await dialog.getByTestId('config-save').click()
    await expect(dialog).toBeHidden()
    const card = podCard(page, 'Sim-Card')
    await card.getByTestId('pod-sync').click()
    const sync = page.locator('.modal.show', { hasText: t('sync.title', { name: 'Sim-Card' }) })
    await expect(sync.getByTestId('sync-confirm')).toContainText(t('sync.confirm'))
    await expect(sync.getByTestId('sync-step')).toHaveCount(1)                       // this pod has its own configuration (no project mapped there): the repo's workflows only
    await expect(sync.getByTestId('sync-transport')).toContainText('no-spend mode')
    await sync.getByTestId('sync-start').click()
    await expect(sync.getByTestId('sync-status')).toContainText(t('sync.finished', { steps: 1 }))
    await expect(sync.getByTestId('sync-file')).toHaveCount(3)
    await expect(sync.getByTestId('sync-counts')).toContainText(t('sync.countFiles', { n: 3 }))
    await expect(sync.getByTestId('sync-counts')).toContainText(t('sync.countErrors', { n: 0 }))
    await sync.locator('.btn-close').click()
    await expect(sync).toBeHidden()
    await expect(card.getByTestId('pod-progress-label')).not.toContainText(t('sync.countFiles', { n: 3 }).split(' ')[1])   // the run ended: no sync bar (a boot bar may show, the pod was just recreated)
    await expect(card.getByTestId('pod-sync')).toBeEnabled()
  })
})
