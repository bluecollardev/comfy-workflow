import { test, expect, modal, cfgTab, answerConfirm } from './fixtures'
import { t } from './i18n'

// Storage adapters (docs/ADR-063): Default Configuration > Adapters has an Import group and a Storage group. A storage adapter is one S3-compatible storage with an on/off switch.
// Built in: the publish destination (its form moved here from Publishing), Panama, and Wasabi. The core is faked (state.storage in e2e/fixtures.js).
const open = async (page, tab = 'storage') => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, tab); return d }
const card = (d, id) => d.locator(`[data-testid="storage-card"][data-id="${id}"]`)
const calls = (api, k) => (api.state.storage?.calls || []).filter((c) => k in c).map((c) => c[k])

test('Storage is a tab of its own with the publish destination, Panama and Wasabi; Adapters keeps the import adapters; Publishing has no cards', async ({ page }) => {
  const d = await open(page, 'adapters')
  await expect(d.getByTestId('section-adapters')).toHaveText('Adapters'); await expect(d.getByTestId('adapter-manager')).toBeVisible(); await expect(d.getByTestId('storage-card').first()).toBeHidden()
  await cfgTab(d, 'publishing'); await expect(d.getByTestId('storage-card').first()).toBeHidden(); await expect(d.getByTestId('settings-publishing').getByTestId('publish-default-message')).toBeVisible()
  await cfgTab(d, 'storage')
  await expect(d.getByTestId('section-storage')).toHaveText('Storage')
  await expect(d.getByTestId('storage-card')).toHaveCount(2)   // the Panama exchange is a role of the publish card
  await expect(d.getByTestId('storage-card').evaluateAll((els) => els.map((e) => e.dataset.id))).resolves.toEqual(['publish-s3', 'wasabi'])
  await expect(card(d, 'publish-s3')).toHaveAttribute('data-enabled', 'true'); await expect(card(d, 'publish-s3').getByTestId('storage-enabled-panama')).toBeChecked(); await expect(card(d, 'wasabi')).toHaveAttribute('data-enabled', 'false')
  await expect(card(d, 'wasabi').getByTestId('storage-ready')).toHaveText('not ready')
  await expect(card(d, 'publish-s3').getByTestId('storage-same-bucket')).toBeChecked(); await expect(card(d, 'publish-s3').getByTestId('publish-s3-prefix')).toHaveValue('returns/BKK/')   // the destination's form is in the card; its bucket is the Panama one
  await expect(card(d, 'publish-s3').getByTestId('cfg-panama-bucket')).toHaveValue('bh-panama-exchange-610140802195')   // so is the Panama bucket's (keys, bucket, region, profile, pull on start)
  await expect(card(d, 'publish-s3').getByTestId('cfg-panama-pull')).toBeVisible()
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
})

test('Add Storage makes your own S3-compatible adapter, and Delete removes it after a confirm', async ({ page, api }) => {
  const d = await open(page)
  await expect(d.getByTestId('storage-none')).toBeVisible()
  await d.getByTestId('storage-add').click(); await d.getByTestId('storage-new-type-s3').check()
  await d.getByTestId('storage-new-name').fill('Backblaze B2'); await d.getByTestId('storage-new-endpoint').fill('https://s3.us-west-004.backblazeb2.com')
  await d.getByTestId('storage-new-region').fill('us-west-004'); await d.getByTestId('storage-new-bucket').fill('bh-b2')
  await d.getByTestId('storage-new-save').click()
  const b = card(d, 'backblaze-b2'); await expect(b).toBeVisible(); await expect(b).toHaveAttribute('data-enabled', 'false'); await expect(d.getByTestId('storage-none')).toHaveCount(0)
  await b.getByTestId('storage-delete').click(); await answerConfirm(page, true)
  await expect(card(d, 'backblaze-b2')).toHaveCount(0); expect(calls(api, 'remove')).toEqual(['backblaze-b2'])
})

test('Panama is switched off and on here, in the same card as its keys and bucket', async ({ page, api }) => {
  const d = await open(page), p = card(d, 'publish-s3')
  await p.getByTestId('storage-enabled-panama').click({ force: true })
  await expect.poll(() => calls(api, 'disable')).toEqual(['panama-s3'])
  await expect(p.getByTestId('cfg-panama-access')).toBeVisible()
})

test('An older core says to restart', async ({ page, api }) => {
  api.state.storage = { old: true }
  const d = await open(page)
  await expect(d.getByTestId('storage-restart')).toHaveText('Restart the app to use Storage adapters')
})

// docs/ADR-064: the events each storage uploads on, and the order of the cards.
test('Wasabi has five event switches that save as they are clicked; the publish destination has the Approved switch', async ({ page, api }) => {
  const d = await open(page), w = card(d, 'wasabi')
  for (const ev of ['generating', 'generated', 'approved', 'publishing', 'published']) await expect(w.getByTestId(`storage-event-${ev}`)).toBeVisible()
  await w.getByTestId('storage-event-generated').click({ force: true })
  await expect.poll(() => calls(api, 'save').at(-1)?.events).toEqual(['generated'])
  await w.getByTestId('storage-event-approved').click({ force: true })
  await expect.poll(() => calls(api, 'save').at(-1)?.events).toEqual(['generated', 'approved'])
  await expect(card(d, 'publish-s3').getByTestId('storage-event-approved')).toBeVisible()   // Approved on the Panama bucket is Auto-publish
  await expect(card(d, 'publish-s3').getByTestId('storage-event-publishing')).toBeDisabled()
  await card(d, 'publish-s3').getByTestId('storage-event-generated').click({ force: true })
  await expect.poll(() => calls(api, 'save').at(-1)).toMatchObject({ id: 'publish-s3', events: ['generated'] })
})

test('the cards are dragged into order with the handle, and the order is saved', async ({ page, api }) => {
  const d = await open(page)
  // the cards are far apart in the window, so the drag events are sent to them directly
  const dt = await page.evaluateHandle(() => new DataTransfer())
  await card(d, 'wasabi').getByTestId('storage-handle').dispatchEvent('dragstart', { dataTransfer: dt })
  await card(d, 'publish-s3').dispatchEvent('dragover', { dataTransfer: dt }); await card(d, 'publish-s3').dispatchEvent('drop', { dataTransfer: dt })
  await expect.poll(() => calls(api, 'order').at(-1)).toEqual(['wasabi', 'publish-s3', 'panama-s3'])
  await expect(d.getByTestId('storage-card').evaluateAll((els) => els.map((e) => e.dataset.id))).resolves.toEqual(['wasabi', 'publish-s3'])
})

test('every storage card can be renamed, the built-ins too', async ({ page, api }) => {
  const d = await open(page), p = card(d, 'publish-s3')
  await p.getByTestId('storage-rename').click()
  await p.getByTestId('storage-rename-input').fill('Panama BH'); await p.getByTestId('storage-rename-input').press('Enter')
  await expect(p.getByTestId('storage-name')).toHaveText('Panama BH')
  expect(calls(api, 'save').at(-1)).toMatchObject({ id: 'publish-s3', name: 'Panama BH' })
  const w = card(d, 'wasabi'); await w.getByTestId('storage-rename').click(); await w.getByTestId('storage-rename-input').fill('Long-term'); await w.getByTestId('storage-rename-save').click()
  await expect(w.getByTestId('storage-name')).toHaveText('Long-term')
})

test('Add Storage opens at the top and scrolled to, offers Wasabi or S3, and the new storage is first in the list', async ({ page, api }) => {
  const d = await open(page)
  await d.getByTestId('storage-add').click()
  await expect(d.getByTestId('storage-add-form')).toBeInViewport()
  const ids = async () => d.getByTestId('storage-card').evaluateAll((els) => els.map((e) => e.dataset.id))
  await expect(d.getByTestId('storage-new-type-wasabi')).toBeChecked()
  await expect(d.getByTestId('storage-new-endpoint')).toHaveCount(0)   // a Wasabi bucket gets its endpoint from the region
  await d.getByTestId('storage-new-type-s3').check(); await expect(d.getByTestId('storage-new-endpoint')).toBeVisible()
  await d.getByTestId('storage-new-type-wasabi').check()
  await d.getByTestId('storage-new-name').fill('Archive'); await d.getByTestId('storage-new-region').fill('eu-central-1'); await d.getByTestId('storage-new-bucket').fill('archive-bkt')
  await d.getByTestId('storage-new-save').click()
  await expect.poll(async () => (await ids())[0]).toBe('archive')
  expect(calls(api, 'save').find((x) => x.name === 'Archive').endpoint).toBe('https://s3.eu-central-1.wasabisys.com')
})

test('the bucket and region are shown once: the destination follows them while "same bucket and region" is ticked', async ({ page }) => {
  const d = await open(page), c = card(d, 'publish-s3')
  await expect(c.getByTestId('storage-same-bucket')).toBeChecked()   // the fake destination is the Panama bucket and region
  await expect(c.getByTestId('cfg-panama-bucket')).toHaveCount(1); await expect(c.getByTestId('publish-s3-bucket')).toHaveCount(0); await expect(c.getByTestId('publish-s3-region')).toHaveCount(0)
  await c.getByTestId('storage-same-bucket').uncheck()
  await expect(c.getByTestId('publish-s3-bucket')).toBeVisible()   // untick: the destination has its own
})
