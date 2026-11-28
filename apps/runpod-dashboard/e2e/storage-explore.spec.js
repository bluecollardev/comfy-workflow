import { test, expect, modal } from './fixtures'
import { t } from './i18n'

// Network Volumes lists the S3 storages (Wasabi, your own) beside the RunPod volumes, each with Explore: a read-only browser of its bucket.
// The BH exchange bucket's Explore is an icon only. The core is faked (state.storage in e2e/fixtures.js).
const ADAPTERS = [
  { id: 'publish-s3', name: 'Panama BH (S3)', builtin: true, kind: 'publish', enabled: true, endpoint: '', region: 'us-west-2', bucket: 'bh-panama-exchange-610140802195', prefix: 'returns/BKK/', ready: true, key_hint: '', edit: 'publish' },
  { id: 'panama-s3', name: 'Panama BH exchange (S3)', builtin: true, kind: 'panama', enabled: true, endpoint: '', region: 'us-west-2', bucket: 'bh-panama-exchange-610140802195', prefix: 'rounds/', ready: true, key_hint: '', edit: 'panama' },
  { id: 'wasabi', name: 'Wasabi', builtin: true, kind: 'wasabi', enabled: true, endpoint: 'https://s3.eu-central-1.wasabisys.com', region: 'eu-central-1', bucket: 'bh-wasabi', prefix: '', ready: true, key_hint: '…5678' },
  { id: 'b2', name: 'Backblaze B2', builtin: false, kind: 'custom', enabled: false, endpoint: 'https://s3.us-west-004.backblazeb2.com', region: 'us-west-004', bucket: '', prefix: '', ready: false, problem: 'Add a bucket', key_hint: '' },
]
const openVolumes = async (page) => {
  await page.goto('/')
  await page.getByTestId('open-shared').click()
  await page.getByTestId('shared-volumes').click()
  const dialog = modal(page, t('volumes.title'))
  await expect(dialog).toBeVisible()
  return dialog
}

test('Network Volumes lists the storages with a Storage badge, bucket, region and state; the Panama bucket is not listed twice', async ({ page, api }) => {
  api.state.storage = { adapters: JSON.parse(JSON.stringify(ADAPTERS)) }
  const d = await openVolumes(page)
  await expect(d.getByTestId('volume').first()).toBeVisible()   // the RunPod volumes are still there
  await expect(d.getByTestId('volume-storage')).toHaveCount(2)
  const w = d.locator('[data-testid="volume-storage"][data-id="wasabi"]')
  await expect(w.getByTestId('volume-storage-name')).toHaveText('Wasabi')
  await expect(w.getByTestId('volume-storage-badge')).toHaveText('Storage')
  await expect(w.getByTestId('volume-storage-facts')).toContainText('bh-wasabi')
  await expect(w.getByTestId('volume-storage-size')).toContainText('eu-central-1')   // the region moved to the size line (like a volume's "2500 GB in EU-RO-1")
  await expect(w.getByTestId('volume-storage-enabled')).toHaveText('On')
  await expect(w.getByTestId('volume-storage-ready')).toHaveText('Ready')
  const b = d.locator('[data-testid="volume-storage"][data-id="b2"]')
  await expect(b.getByTestId('volume-storage-enabled')).toHaveText('Off')
  await expect(b.getByTestId('volume-storage-ready')).toContainText('Not ready')
  await expect(b.getByTestId('volume-storage-explore')).toBeDisabled()
})

test('Explore opens a storage bucket read-only: into a folder, files with sizes, back by the breadcrumb', async ({ page, api }) => {
  api.state.storage = { adapters: JSON.parse(JSON.stringify(ADAPTERS)) }
  const d = await openVolumes(page)
  await d.locator('[data-testid="volume-storage"][data-id="wasabi"]').getByTestId('volume-storage-explore').click()
  const m = page.getByTestId('bucket-modal')
  await expect(m).toBeVisible()
  await expect(m).toContainText('bh-wasabi')
  await expect(m.locator('[data-testid="bucket-row"][data-name="renders"]')).toBeVisible()
  await expect(m.locator('[data-testid="bucket-row"][data-name="readme.txt"]')).toContainText('2 KB')
  await m.locator('[data-testid="bucket-row"][data-name="renders"]').getByTestId('bucket-folder').click()
  await m.locator('[data-testid="bucket-row"][data-name="shot-001"]').getByTestId('bucket-folder').click()
  await expect(m.getByTestId('bucket-crumb-current')).toHaveAttribute('data-prefix', 'renders/shot-001/')
  await expect(m.locator('[data-testid="bucket-row"][data-name="frame-0001.exr"]')).toContainText('1.0 MB')
  await m.locator('[data-testid="bucket-crumb"][data-prefix="renders/"]').click()
  await expect(m.locator('[data-testid="bucket-row"][data-name="a.mov"]')).toBeVisible()
  expect((api.state.storage.calls || []).filter((c) => c.browse).map((c) => `${c.browse}:${c.prefix}`)).toEqual(['wasabi:', 'wasabi:renders/', 'wasabi:renders/shot-001/', 'wasabi:renders/'])
})

test('A listing that fails shows the error with Retry', async ({ page, api }) => {
  api.state.storage = { adapters: JSON.parse(JSON.stringify(ADAPTERS)), trees: { wasabi: {} } }
  const d = await openVolumes(page)
  await d.locator('[data-testid="volume-storage"][data-id="wasabi"]').getByTestId('volume-storage-explore').click()
  await expect(page.getByTestId('bucket-error')).toContainText('Not a folder in the bucket')
  await expect(page.getByTestId('bucket-retry')).toBeVisible()
})

test('The BH exchange bucket Explore is an icon only: no text, an Explore label and title', async ({ page, api }) => {
  api.state.panama = { configured: true }
  const d = await openVolumes(page)
  const b = d.getByTestId('volume-bh-explore')
  await expect(b).toBeEnabled()
  await expect(b).toHaveText('')
  await expect(b).toHaveAttribute('aria-label', 'Explore')
  await expect(b).toHaveAttribute('title', 'Explore')
  await expect(b.locator('i.fa-folder-open')).toHaveCount(1)
  await b.click()
  await expect(page.getByTestId('bucket-modal')).toBeVisible()
})
