import { test, expect, modal } from './fixtures'
import { t } from './i18n'

// Network Volumes: the browse icon, storage rows laid out like volume rows, and linking a Wasabi bucket from the create form.
// The core is faked (state.storage in e2e/fixtures.js).
const ADAPTERS = () => JSON.parse(JSON.stringify([
  { id: 'publish-s3', name: 'Panama BH (S3)', builtin: true, kind: 'publish', enabled: true, endpoint: '', region: 'us-west-2', bucket: 'bh-panama-exchange', prefix: 'returns/BKK/', ready: true, key_hint: '', edit: 'publish' },
  { id: 'wasabi', name: 'Wasabi', builtin: true, kind: 'wasabi', enabled: true, endpoint: 'https://s3.eu-central-1.wasabisys.com', region: 'eu-central-1', bucket: 'bh-wasabi', prefix: '', ready: true, key_hint: '…5678', events: ['generated', 'published'] },
  { id: 'mine', name: 'My Bucket', builtin: false, kind: 'custom', enabled: true, endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'my-bucket', prefix: '', ready: true, key_hint: '…1111', events: [] },
  { id: 'b2', name: 'Backblaze B2', builtin: false, kind: 'custom', enabled: false, endpoint: 'https://s3.b2.example', region: 'us-west-004', bucket: '', prefix: '', ready: false, problem: 'Add a bucket', key_hint: '', events: [] },
]))
const openVolumes = async (page) => {
  await page.goto('/')
  await page.getByTestId('open-shared').click()
  await page.getByTestId('shared-volumes').click()
  const dialog = modal(page, t('volumes.title'))
  await expect(dialog).toBeVisible()
  return dialog
}

test('the volume row browse is the same icon-only folder-open button as a storage Explore', async ({ page, api }) => {
  api.state.storage = { adapters: ADAPTERS() }
  const d = await openVolumes(page)
  const row = d.locator('[data-testid="volume"][data-id="vol1"]')
  const b = row.getByTestId('volume-browse')
  await expect(b).toHaveText('')
  await expect(b).toHaveAttribute('aria-label', t('volumes.browse'))
  await expect(b).toHaveAttribute('title', t('volumes.browse'))
  await expect(b.locator('i')).toHaveClass(/fa-folder-open/)
  const ex = d.locator('[data-testid="volume-storage"][data-id="wasabi"]').getByTestId('volume-storage-explore')
  expect(await b.getAttribute('class')).toBe(await ex.getAttribute('class'))
  expect(await b.locator('i').getAttribute('class')).toBe(await ex.locator('i').getAttribute('class'))
  await b.click()
  await expect(page.getByTestId('volume-files-start')).toBeVisible()   // still opens the volume's files explorer
})

test('a storage row is laid out like a volume row: bucket, badges, size and cost, Used by with events', async ({ page, api }) => {
  api.state.storage = { adapters: ADAPTERS(), usage: { wasabi: { bytes: 3.2e12, listingPolls: 1 } } }
  api.state.syncrules = { rules: { '*': { generated: [{ type: 'storage', id: 'wasabi' }], approved: [], published: [{ type: 'storage', id: 'wasabi' }] } }, calls: [] }   // Used by reads the per-event rules (ADR-069)
  const d = await openVolumes(page)
  const w = d.locator('[data-testid="volume-storage"][data-id="wasabi"]')
  await expect(w.getByTestId('volume-storage-name')).toHaveText('Wasabi')
  await expect(w.getByTestId('volume-storage-facts')).toHaveText('bh-wasabi')
  await expect(w.getByTestId('volume-storage-badge')).toHaveText('Storage')
  await expect(w.getByTestId('volume-storage-kind')).toHaveText('Wasabi')
  await expect(w.getByTestId('volume-storage-enabled')).toHaveText('On')
  await expect(w.getByTestId('volume-storage-ready')).toHaveText('Ready')
  await expect(w.getByTestId('volume-storage-size')).toContainText('listing, 5000 objects so far')   // while it is still listing
  await expect(w.getByTestId('volume-storage-size')).toHaveText('3.20 TB in eu-central-1 · about $25.57 a month', { timeout: 8000 })   // 3.2 TB x 7.99
  await expect(w.getByTestId('volume-storage-size')).toHaveAttribute('title', /^As of /)
  await expect(w.getByTestId('volume-storage-usedby')).toContainText('Used by:')
  await expect(w.getByTestId('volume-storage-event')).toHaveText(['Generated', 'Published'])
  const m = d.locator('[data-testid="volume-storage"][data-id="mine"]')
  await expect(m.getByTestId('volume-storage-kind')).toHaveText('S3')
  await expect(m.getByTestId('volume-storage-size')).toHaveText(/^\d+(\.\d)? GB in us-east-1$/)   // no price: no cost
  await expect(m.getByTestId('volume-storage-usedby')).toContainText(t('volumes.usedByNone'))
})

test('a size that cannot be read says so', async ({ page, api }) => {
  api.state.storage = { adapters: ADAPTERS(), usage: { wasabi: { error: 'AccessDenied' } } }
  const d = await openVolumes(page)
  await expect(d.locator('[data-testid="volume-storage"][data-id="wasabi"]').getByTestId('volume-storage-size')).toContainText('Size unknown (AccessDenied)')
})

test('Create: the type defaults to Network Volume; Wasabi Bucket shows the storage fields; Save adds the row first and scrolls to it', async ({ page, api }) => {
  api.state.storage = { adapters: ADAPTERS() }
  const d = await openVolumes(page)
  await expect(d.getByTestId('volume-new-type-volume')).toBeChecked()
  await expect(d.getByTestId('volume-new-name')).toBeVisible()
  await expect(d.getByTestId('storage-add-form')).toHaveCount(0)
  await d.getByTestId('volume-new-type-wasabi').check()
  await expect(d.getByTestId('volume-new-name')).toHaveCount(0)
  const f = d.getByTestId('storage-add-form')
  await expect(f).toBeVisible()
  await expect(f.getByTestId('storage-new-help')).toContainText('already exists')
  for (const id of ['name', 'region', 'bucket', 'prefix', 'access-key', 'secret-key']) await expect(f.getByTestId(`storage-new-${id}`)).toBeVisible()
  await expect(f.getByTestId('storage-new-endpoint')).toHaveCount(0)
  await f.getByTestId('storage-new-name').fill('Wasabi EU 2')
  await f.getByTestId('storage-new-region').fill('eu-west-1')
  await f.getByTestId('storage-new-bucket').fill('bh-two')
  await f.getByTestId('storage-new-access-key').fill('AKIAXXXX1234')
  await f.getByTestId('storage-new-secret-key').fill('secret')
  await f.getByTestId('storage-new-save').click()
  const first = d.getByTestId('volume-storage').first()
  await expect(first).toHaveAttribute('data-id', 'wasabi-eu-2')
  await expect(first.getByTestId('volume-storage-facts')).toHaveText('bh-two')
  await expect(d.getByTestId('storage-add-form')).toHaveCount(0)
  await expect(d.getByTestId('volume-new-type-volume')).toBeChecked()
  expect(api.state.storage.calls.find((c) => c.save).save).toMatchObject({ name: 'Wasabi EU 2', endpoint: 'https://s3.eu-west-1.wasabisys.com', bucket: 'bh-two' })
})

test('Create: S3 shows the endpoint field too', async ({ page, api }) => {
  api.state.storage = { adapters: ADAPTERS() }
  const d = await openVolumes(page)
  await d.getByTestId('volume-new-type-s3').check()
  await expect(d.getByTestId('storage-new-endpoint')).toBeVisible()
  await d.getByTestId('storage-new-cancel').click()
  await expect(d.getByTestId('volume-new-type-volume')).toBeChecked()
})

// docs/ADR-064: an Upload On event upload is a job in the Queue with progress and Cancel.
test('an Upload On upload shows in the Queue with progress and Cancel', async ({ page, api }) => {
  api.state.storage = { uploads: [{ job_id: 'upload-1', kind: 'storage-upload', state: 'uploading', event: 'generated', targets: ['Wasabi'], source: 'pod', source_name: 'pod-1', started_at: new Date().toISOString(), files_total: 4, files_done: 1, files_skipped: 0, files_failed: 0, bytes_total: 4000000, bytes_done: 1000000, rate: 500000, current: 'shot/a.mov', warnings: [] }] }
  await page.goto('/'); await page.getByTestId('open-queue').click()
  const row = page.locator('[data-testid="queue-working-row"][data-kind="storage-upload"]')
  await expect(row).toBeVisible(); await expect(row).toContainText('Upload on generated to Wasabi'); await expect(row).toContainText('1 of 4 files')
  await row.getByTestId('queue-working-cancel').click()
  await expect.poll(() => (api.state.storage.calls || []).filter((c) => 'cancelUpload' in c).map((c) => c.cancelUpload)).toEqual(['upload-1'])
})
