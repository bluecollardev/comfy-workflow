import { test, expect } from '@playwright/test'
import { launchApp, openCreatePod, podCard, toast } from './app.js'
import { t } from '../e2e/i18n.js'

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
      for (const action of ['pod-stop', 'pod-delete']) {
        const card = podCard(page, 'Live-Proof')
        if (await card.count()) {
          const btn = card.getByTestId(action)
          if (await btn.count()) { page.once('dialog', (d) => d.accept()); await btn.click(); await toast(page).last().waitFor() }
        }
      }
    } finally { await app.close() }
  })

  test('creates a real pod, sees it running with a ComfyUI URL, stops it and deletes it', async () => {
    const { page } = ctx
    await expect(page.getByTestId('no-spend-badge')).toHaveCount(0)
    await openCreatePod(page)
    await page.locator('#pod-name').fill('Live-Proof')
    await page.locator('#pod-gpu').selectOption('auto')   // the cheapest 16-24 GB card RunPod has in stock, the next on a stock refusal, then the other cloud
    await page.locator('#pod-instance-type').selectOption('on-demand')
    await page.locator('#pod-image').selectOption('prebuilt')
    await page.locator('#pod-idle').fill('5')
    await page.getByTestId('pod-submit').click()
    const first = toast(page).first()
    await expect(first).toBeVisible()
    const text = await first.textContent()
    expect(text, `RunPod answered: ${text}`).toContain(t('toast.podCreated', { name: 'Live-Proof' }))

    const card = podCard(page, 'Live-Proof')
    await expect(card).toBeVisible()
    // a real pod takes a while to pull the image and come up; refresh until it is running with a URL
    await expect(async () => {
      await page.getByTestId('refresh').click()
      await expect(card.getByTestId('pod-status')).toHaveText('running')
      await expect(card.getByTestId('pod-open')).toBeVisible()
    }).toPass({ timeout: 6 * 60 * 1000, intervals: [10_000] })

    await card.getByTestId('pod-stop').click()
    await expect(toast(page).last()).toContainText(t('toast.podStopped'))
    await expect(async () => {
      await page.getByTestId('refresh').click()
      await expect(card.getByTestId('pod-status')).toHaveText('stopped')
    }).toPass({ timeout: 2 * 60 * 1000, intervals: [5_000] })

    page.once('dialog', (d) => d.accept())
    await card.getByTestId('pod-delete').click()
    await expect(toast(page).last()).toContainText(t('toast.podDeleted'))
    await expect(async () => {
      await page.getByTestId('refresh').click()
      await expect(card).toHaveCount(0)
    }).toPass({ timeout: 60_000, intervals: [5_000] })
  })
})
