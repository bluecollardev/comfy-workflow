import { test, expect, modal, cfgTab, answerConfirm } from './fixtures'
import { t } from './i18n'

// Storage adapters (docs/ADR-063): Default Configuration > Adapters has an Import group and a Storage group. A storage adapter is one S3-compatible storage with an on/off switch.
// Built in: the publish destination (its form moved here from Publishing), Panama, and Wasabi. The core is faked (state.storage in e2e/fixtures.js).
const open = async (page, tab = 'adapters') => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, tab); return d }
const card = (d, id) => d.locator(`[data-testid="storage-card"][data-id="${id}"]`)
const calls = (api, k) => (api.state.storage?.calls || []).filter((c) => k in c).map((c) => c[k])

test('The tab is called Adapters and has an Import group and a Storage group; the storage list is the publish destination, Panama and Wasabi', async ({ page }) => {
  const d = await open(page)
  await expect(d.getByTestId('section-adapters')).toHaveText('Adapters')
  await expect(d.getByTestId('adapters-group-import')).toHaveText('Import'); await expect(d.getByTestId('adapters-group-storage')).toHaveText('Storage')
  await expect(d.getByTestId('storage-card')).toHaveCount(3)
  await expect(d.getByTestId('storage-card').evaluateAll((els) => els.map((e) => e.dataset.id))).resolves.toEqual(['publish-s3', 'panama-s3', 'wasabi'])
  await expect(card(d, 'publish-s3')).toHaveAttribute('data-enabled', 'true'); await expect(card(d, 'panama-s3')).toHaveAttribute('data-enabled', 'true'); await expect(card(d, 'wasabi')).toHaveAttribute('data-enabled', 'false')
  await expect(card(d, 'wasabi').getByTestId('storage-ready')).toHaveText('not ready')
})

test('The publish destination form lives in the Storage group, and Publishing keeps a summary with Edit In Adapters', async ({ page }) => {
  const d = await open(page)
  await expect(card(d, 'publish-s3').getByTestId('publish-s3-bucket')).toHaveValue('bh-panama-exchange-610140802195')
  await cfgTab(d, 'publishing')
  await expect(d.getByTestId('publish-s3-summary')).toContainText('s3://bh-panama-exchange-610140802195/returns/BKK/')
  await expect(d.getByTestId('publish-mirror-note')).toHaveText(t('storage.mirrorNone'))
  await d.getByTestId('publish-edit-in-adapters').click()
  await expect(d.getByTestId('storage-publish-body')).toBeVisible()
})

test('Wasabi: add the bucket and keys, test, then switch it on; it cannot be switched on before', async ({ page, api }) => {
  const d = await open(page), w = card(d, 'wasabi')
  await w.getByTestId('storage-enabled').click({ force: true })
  await expect(d.getByTestId('storage-error')).toContainText('cannot be switched on')
  await expect(w).toHaveAttribute('data-enabled', 'false')
  await w.getByTestId('storage-bucket').fill('bh-wasabi'); await w.getByTestId('storage-region').fill('eu-central-1')
  await w.getByTestId('storage-access-key').fill('WASABIKEY12345678'); await w.getByTestId('storage-secret-key').fill('wasabisecretwasabisecret1234')
  await w.getByTestId('storage-save').click()
  await expect(w.getByTestId('storage-ready')).toHaveText('ready')
  expect(calls(api, 'save')[0]).toMatchObject({ id: 'wasabi', bucket: 'bh-wasabi', region: 'eu-central-1' })
  await expect(w.getByTestId('storage-access-key')).toHaveValue(''); await expect(w.getByTestId('storage-access-key')).toHaveAttribute('placeholder', /Saved: …5678/)   // a key is never shown again
  await w.getByTestId('storage-test').click(); await expect(w.getByTestId('storage-test-result')).toHaveText('OK: bh-wasabi answered')
  await w.getByTestId('storage-enabled').click({ force: true })
  await expect(w).toHaveAttribute('data-enabled', 'true'); expect(calls(api, 'enable')).toEqual(['wasabi', 'wasabi'])   // the first click was refused: no bucket, no keys
  await cfgTab(d, 'publishing')
  await expect(d.getByTestId('publish-mirror-note')).toHaveText('Also copied to: Wasabi')   // publishing copies to every storage that is on
})

test('Add Storage makes your own S3-compatible adapter, and Delete removes it after a confirm', async ({ page, api }) => {
  const d = await open(page)
  await expect(d.getByTestId('storage-none')).toBeVisible()
  await d.getByTestId('storage-add').click()
  await d.getByTestId('storage-new-name').fill('Backblaze B2'); await d.getByTestId('storage-new-endpoint').fill('https://s3.us-west-004.backblazeb2.com')
  await d.getByTestId('storage-new-region').fill('us-west-004'); await d.getByTestId('storage-new-bucket').fill('bh-b2')
  await d.getByTestId('storage-new-save').click()
  const b = card(d, 'backblaze-b2'); await expect(b).toBeVisible(); await expect(b).toHaveAttribute('data-enabled', 'false'); await expect(d.getByTestId('storage-none')).toHaveCount(0)
  await b.getByTestId('storage-delete').click(); await answerConfirm(page, true)
  await expect(card(d, 'backblaze-b2')).toHaveCount(0); expect(calls(api, 'remove')).toEqual(['backblaze-b2'])
})

test('Panama is switched off and on here and its settings are one click away', async ({ page, api }) => {
  const d = await open(page), p = card(d, 'panama-s3')
  await p.getByTestId('storage-enabled').click({ force: true })
  await expect(p).toHaveAttribute('data-enabled', 'false'); expect(calls(api, 'disable')).toEqual(['panama-s3'])
  await p.getByTestId('storage-edit-panama').click()
  await expect(d.getByTestId('cfg-panama-title')).toBeVisible()
})

test('An older core says to restart', async ({ page, api }) => {
  api.state.storage = { old: true }
  const d = await open(page)
  await expect(d.getByTestId('storage-restart')).toHaveText('Restart the app to use Storage adapters')
})
