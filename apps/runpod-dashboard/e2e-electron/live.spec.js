import { test, expect } from '@playwright/test'
import { launchApp, openCreatePod, podCard, toast } from './app.js'

// The proof against RunPod: the real app, the real account (RUNPOD_API_KEY from the repo's .env),
// one real pod with the stock image, stopped and deleted by the test itself. Costs minutes of
// one GPU. Runs only with RUNPOD_LIVE=1; `./start.sh e2e-live` sets it.
test.describe('RunPod, live', () => {
  test.skip(!process.env.RUNPOD_LIVE, 'set RUNPOD_LIVE=1 to run the live proof (it spends)')
  let ctx
  test.beforeAll(async () => { ctx = await launchApp({ dry: false, live: true }) })
  test.afterAll(async () => {
    // never leave the proof pod running: whatever happened, stop and delete anything named Live-Proof
    const { page, app } = ctx
    try {
      for (const action of ['Stop', 'Delete']) {
        const card = podCard(page, 'Live-Proof')
        if (await card.count()) {
          const btn = card.getByRole('button', { name: action })
          if (await btn.count()) { page.once('dialog', (d) => d.accept()); await btn.click(); await toast(page).last().waitFor() }
        }
      }
    } finally { await app.close() }
  })

  test('creates a real pod, sees it running with a ComfyUI URL, stops it and deletes it', async () => {
    const { page } = ctx
    await expect(page.locator('.navbar')).not.toContainText('no-spend mode')
    await openCreatePod(page)
    await page.getByLabel('Name').fill('Live-Proof')
    await page.getByLabel('GPU', { exact: true }).selectOption('rtx4090')
    await page.getByLabel('Instance type').selectOption('on-demand')   // secure cloud: community had no instance on 2026-10-19
    await page.getByLabel('Image', { exact: true }).selectOption('prebuilt')
    await page.getByLabel('Idle stop (minutes)').first().fill('5')
    await page.locator('form button[type=submit]').click()
    const first = toast(page).first()
    await expect(first).toBeVisible()
    const text = await first.textContent()
    expect(text, `RunPod answered: ${text}`).toContain('Pod Live-Proof created')

    const card = podCard(page, 'Live-Proof')
    await expect(card).toBeVisible()
    // a real pod takes a while to pull the image and come up; refresh until it is running with a URL
    await expect(async () => {
      await page.getByRole('button', { name: 'Refresh' }).click()
      await expect(card).toContainText('running')
      await expect(card.getByRole('link', { name: /Open/ })).toBeVisible()
    }).toPass({ timeout: 6 * 60 * 1000, intervals: [10_000] })

    await card.getByRole('button', { name: 'Stop' }).click()
    await expect(toast(page).last()).toContainText('Pod stopped')
    await expect(async () => {
      await page.getByRole('button', { name: 'Refresh' }).click()
      await expect(card).toContainText('stopped')
    }).toPass({ timeout: 2 * 60 * 1000, intervals: [5_000] })

    page.once('dialog', (d) => d.accept())
    await card.getByRole('button', { name: 'Delete' }).click()
    await expect(toast(page).last()).toContainText('Pod deleted')
    await expect(async () => {
      await page.getByRole('button', { name: 'Refresh' }).click()
      await expect(card).toHaveCount(0)
    }).toPass({ timeout: 60_000, intervals: [5_000] })
  })
})
