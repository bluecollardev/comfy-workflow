import { test, expect } from '@playwright/test'
import { launchApp, openCreatePod, podCard, toast } from './app.js'

// The whole pod lifecycle in the real app, over IPC, with pods simulated. Nothing bills.
test.describe('the app in no-spend mode', () => {
  let ctx
  test.beforeAll(async () => { ctx = await launchApp({ dry: true }) })
  test.afterAll(async () => { await ctx.app.close() })

  test('boots on its own, says it is in no-spend mode, and answers over IPC', async () => {
    const { page } = ctx
    await expect(page.locator('.navbar')).toContainText('no-spend mode')
    expect(page.url().startsWith('file://')).toBe(true)
    await expect(page.locator('.stat-card').first()).toContainText('0')
  })

  test('creates, shows, stops, resumes and deletes a simulated pod with a toast each time', async () => {
    const { page } = ctx
    await openCreatePod(page)
    await page.getByLabel('Name').fill('Sim-One')
    await page.getByLabel('Image', { exact: true }).selectOption('prebuilt')   // the default local tag is refused by design, even simulated
    await page.getByLabel('Idle stop (minutes)').first().fill('5')
    await page.locator('form button[type=submit]').click()
    await expect(toast(page).first()).toContainText('Pod Sim-One created')
    const card = podCard(page, 'Sim-One')
    await expect(card).toBeVisible()
    await expect(card).toContainText(/starting|running/)
    await expect(card).toContainText('after 5 quiet min')
    await expect(page.locator('.stat-card').first()).toContainText('1')

    await card.getByRole('button', { name: 'Stop' }).click()
    await expect(toast(page).last()).toContainText('Pod stopped')
    await expect(card).toContainText('stopped')
    await card.getByRole('button', { name: 'Resume' }).click()
    await expect(toast(page).last()).toContainText('Pod resumed')
    await expect(card).toContainText(/starting|running/)

    page.once('dialog', (d) => d.accept())
    await card.getByRole('button', { name: 'Delete' }).click()
    await expect(toast(page).last()).toContainText('Pod deleted')
    await expect(card).toHaveCount(0)
  })

  test('the configuration panel maps a folder and saves over IPC', async () => {
    const { page } = ctx
    await page.getByRole('button', { name: 'Configuration' }).click()
    const dialog = page.locator('.modal.show', { hasText: 'Configuration' })
    await expect(dialog).toContainText('Mode dev')
    await dialog.locator('tr', { hasText: 'Project tree' }).getByPlaceholder('not mapped').fill(ctx.configDir)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(toast(page).last()).toContainText('Configuration saved')
    await expect(dialog).toBeHidden()
    await openCreatePod(page)
    await expect(page.locator('form')).toContainText('1/3 folder(s) mapped')
  })
})
