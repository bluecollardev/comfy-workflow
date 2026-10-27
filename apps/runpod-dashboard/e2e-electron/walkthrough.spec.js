import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { configModal, launchApp, openCreatePod, podCard, toast } from './app.js'
import { t } from '../e2e/i18n.js'

// The setup walkthrough of docs/SETUP-WALKTHROUGH.md, driven through the real app as a new user would:
// no key, then each credential screen in order. It is a test first (every step asserts what the guide
// says is on screen); the screenshots are written into docs/walkthrough/ only with WALKTHROUGH=1:
//   WALKTHROUGH=1 ./start.sh e2e-app walkthrough.spec.js
// The key typed is a made-up one and RUNPOD_API_BASE_URL points nowhere, so nothing reaches RunPod.
const SHOTS = process.env.WALKTHROUGH ? resolve(import.meta.dirname, '../../../docs/walkthrough') : null
const FAKE_KEY = 'rpa_EXAMPLEEXAMPLEEXAMPLEEXAMPLE0000'

test.describe('setup walkthrough: a new user, a new app', () => {
  let ctx
  test.beforeAll(async () => {
    if (SHOTS) mkdirSync(SHOTS, { recursive: true })
    ctx = await launchApp({ dry: false, env: { RUNPOD_API_BASE_URL: 'http://127.0.0.1:9', RUNPOD_REST_BASE_URL: 'http://127.0.0.1:9', COMFY_IMAGE: 'ghcr.io/bluecollardev/comfy-app:contract-v26' } })
    await ctx.page.setViewportSize({ width: 1100, height: 820 }).catch(() => {})
  })
  test.afterAll(async () => { await ctx.app.close() })
  const shot = async (name) => { if (SHOTS) await ctx.page.screenshot({ path: join(SHOTS, `${name}.png`) }) }

  test('1 first launch: Default Configuration opens by itself, because nothing works without a RunPod API key', async () => {
    const { page } = ctx
    await expect(page.getByTestId('key-required')).toContainText(t('dashboard.keyRequired'))
    await expect(configModal(page).getByTestId('cfg-key-gate')).toBeVisible()
    await page.waitForTimeout(600)   // the modal's fade-in
    await shot('01-first-launch')
  })

  test('2 the key is asked for first, and nothing else is shown until it is entered', async () => {
    const { page } = ctx
    const modal = configModal(page)
    await expect(modal.getByTestId('cfg-key-gate')).toContainText(t('config.keyGate'))
    await expect(modal.getByTestId('cfg-key-group')).toContainText(t('config.apiKeyUnset'))
    await expect(modal.getByTestId('cfg-s3-access')).toHaveCount(0)   // gated: S3, Claude, volume wait for the key
    await shot('02-key-gate')
    await modal.getByTestId('cfg-key').fill(FAKE_KEY)
    await expect(modal.getByTestId('cfg-key')).toHaveAttribute('type', 'password')   // never shown in the clear
    await shot('03-key-typed')
  })

  test('3 saving the key unlocks the rest; the key is kept, and only its end is shown', async () => {
    const { page } = ctx
    await configModal(page).getByTestId('config-save').click()
    await expect(page.getByTestId('key-required')).toHaveCount(0)
    await expect(configModal(page).getByTestId('cfg-s3-access')).toBeVisible()
    const modal = configModal(page)   // the panel stays open and fills in
    await expect(modal.getByTestId('cfg-key-group')).toContainText(FAKE_KEY.slice(-4))
    await expect(modal.getByTestId('cfg-key-group')).not.toContainText(FAKE_KEY)
    await expect(modal.getByTestId('cfg-s3-access')).toBeVisible()
    await expect(modal.getByTestId('cfg-claude-key')).toBeVisible()
    await shot('04-key-saved-and-the-other-keys')
  })

  test('4 the volume tab and the private image login', async () => {
    const modal = configModal(ctx.page)
    await modal.getByTestId('cfg-tab-volume').click()
    await expect(modal.getByTestId('cfg-registry-auth')).toBeVisible()
    await expect(modal.getByTestId('cfg-volume')).toBeVisible()
    await shot('05-volume-and-image-login')
  })

  test('5 the folders on this PC', async () => {
    const modal = configModal(ctx.page)
    await modal.getByTestId('cfg-tab-folders').click()
    await expect(modal.getByTestId('cfg-sync-shared-output')).toBeVisible()
    await shot('06-folders')
  })

  test('6 Git accounts (Connect) say what to set to enable a provider', async () => {
    const { page } = ctx
    await configModal(page).getByTestId('config-close').first().click()
    await page.getByTestId('open-connect').click()
    await expect(page.getByTestId('connect-accounts')).toBeVisible()
    await shot('07-git-accounts')
    await page.keyboard.press('Escape')
  })

  // From here the account is simulated (no-spend mode): the screens are the real ones, nothing is created on RunPod.
  test('7 no-spend mode: try everything below without a bill', async () => {
    const { page } = ctx
    await page.getByTestId('open-config').click()
    const modal = configModal(page)
    await modal.getByTestId('cfg-tab-options').click()
    await modal.getByTestId('cfg-dry-run').check()
    await shot('08-no-spend-switch')
    await modal.getByTestId('config-save').click()
    await expect(page.getByTestId('no-spend-badge')).toHaveText(t('app.noSpend'))
  })

  test('8 create a volume: a name, a size, a datacenter', async () => {
    const { page } = ctx
    await page.getByTestId('open-volumes').click()
    const dialog = page.locator('.modal.show', { hasText: t('volumes.title') })
    await dialog.getByTestId('volume-new-name').fill('comfy-volume')
    await dialog.getByTestId('volume-new-size').fill('100')
    await dialog.getByTestId('volume-new-dc').selectOption({ index: 1 })
    await shot('09-new-volume')
    await dialog.getByTestId('volume-create').click()
    await expect(dialog.getByTestId('volume-name').first()).toHaveText('comfy-volume')
    await shot('10-volume-created')
    await page.keyboard.press('Escape')
  })

  test('9 pick the volume and the image login in Default Configuration', async () => {
    const { page } = ctx
    await page.getByTestId('open-config').click()
    const modal = configModal(page)
    await modal.getByTestId('cfg-tab-volume').click()
    await modal.getByTestId('cfg-volume').selectOption({ index: 1 })
    await modal.getByTestId('cfg-registry-auth').fill('your-registry-auth-id')
    await shot('11-volume-chosen')
    await modal.getByTestId('config-save').click()
  })

  test('10 create a pod', async () => {
    const { page } = ctx
    await openCreatePod(page)
    await page.locator('#pod-name').fill('ComfyUI-Dev')
    await shot('12-create-pod')
    await page.getByTestId('pod-submit').click()
    await expect(toast(page).first()).toContainText(t('toast.podCreated', { name: 'ComfyUI-Dev' }))
    await expect(podCard(page, 'ComfyUI-Dev')).toBeVisible()
    await page.waitForTimeout(500)
    await shot('13-pod-created')
  })
})
