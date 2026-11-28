import { test, expect, openVolumes, openVolumeSync } from './fixtures'
import { t } from './i18n'

// The built-in volume in Network Volumes: this PC's mapped ComfyUI-Shared folder. Always one, after the volumes and storages and before the BH bucket, with only Explore.
// The core's explorer for it is localoutputs.browse (ComfyUI-Shared/output), faked by GET /local-outputs/browse in e2e/fixtures.js.
const SHARED = '/Users/me/ComfyUI-Shared'
const mapped = (api, on = true) => { api.state.mounts.config.folders['comfy-shared'] = on ? SHARED : ''; api.state.fsVolumes = [{ name: 'Macintosh HD', path: '/Users/me', link: false, size_bytes: 5e11, free_bytes: 2.5e11, readable: true }] }
const modalOf = (page) => page.locator('.modal.show', { hasText: t('volumes.title') })

test('the This PC row is built in, present even with no volumes (after the volumes and storages, before the BH bucket), and has Explore only', async ({ page, api }) => {
  mapped(api); api.state.volumes = {}
  await page.goto('/'); await openVolumes(page)
  const d = modalOf(page), row = d.getByTestId('volume-local')
  await expect(row).toBeVisible()
  const order = await d.getByTestId('volumes-list').locator(':scope > .list-group-item').evaluateAll((els) => els.map((e) => e.dataset.testid)); expect(order.indexOf('volume-local')).toBeGreaterThanOrEqual(0); expect(order.at(-1)).toBe('volume-bh'); expect(order.indexOf('volume-local')).toBe(order.length - 2)   // before BH (last), after any volumes and storages
  await expect(row.getByTestId('volume-local-name')).toHaveText('ComfyUI-Shared'); await expect(row.getByTestId('volume-local-id')).toHaveText('This PC')
  await expect(row.getByTestId('volume-local-badge')).toHaveText('Local'); await expect(row.getByTestId('volume-local-builtin')).toHaveText(t('storage.builtin'))
  await expect(row.getByTestId('volume-local-facts')).toContainText(SHARED); await expect(row.getByTestId('volume-local-facts')).toContainText('250 GB free')
  for (const id of ['volume-delete', 'volume-resize', 'volume-clone', 'volume-erase', 'volume-use-default', 'volume-sync-btn', 'volume-browse']) await expect(row.getByTestId(id)).toHaveCount(0)
  const ex = row.getByTestId('volume-local-explore')
  await expect(ex).toHaveText(''); await expect(ex).toHaveAttribute('aria-label', t('volumes.bhExplore')); await expect(ex).toHaveAttribute('title', t('volumes.bhExplore')); await expect(ex.locator('i')).toHaveClass(/fa-folder-open/)
  await expect(row.getByTestId('volume-local-facts')).not.toContainText('$')   // no price, no datacenter
})

test('Explore lists the folders and files of this PC read-only with a note, a breadcrumb and folders to open', async ({ page, api }) => {
  mapped(api)
  await page.goto('/'); await openVolumes(page)
  await modalOf(page).getByTestId('volume-local-explore').click()
  const e = page.getByTestId('bucket-modal')
  await expect(e).toBeVisible()
  await expect(e.getByTestId('local-explorer-note')).toContainText('ComfyUI-Shared/output')
  await expect(e.getByTestId('bucket-row')).toHaveCount(3)
  await expect(e.locator('[data-testid="bucket-row"][data-name="deliver"]')).toHaveAttribute('data-kind', 'folder')
  await e.getByTestId('bucket-folder').filter({ hasText: 'deliver' }).click()
  await expect(e.locator('[data-testid="bucket-row"][data-name="clip.mov"]')).toContainText('5.2 MB')
  await expect(e.getByTestId('bucket-crumb-current')).toHaveText('deliver')
  expect(api.state.localOutputs.calls).toEqual(['', 'deliver/'])
})

test('with no ComfyUI-Shared folder mapped the row still shows, says where to map it and Explore is off', async ({ page, api }) => {
  mapped(api, false)
  await page.goto('/'); await openVolumes(page)
  const row = modalOf(page).getByTestId('volume-local')
  await expect(row.getByTestId('volume-local-badge')).toBeVisible(); await expect(row.getByTestId('volume-local-builtin')).toBeVisible()
  await expect(row.getByTestId('volume-local-facts')).toHaveText('Not mapped: set it in Default Configuration > Folders')
  await expect(row.getByTestId('volume-local-explore')).toBeDisabled()
})

test('nothing in the window adds a second one: the create form offers a volume, Wasabi and S3 only; This PC is not a From of the Sync window', async ({ page, api }) => {
  mapped(api)
  await page.addInitScript(() => { window.__e2eSync = { plan: async () => ({ steps: [], transport: { kind: 'ssh', reason: 'ssh' }, shared: null }), count: async () => ({ all: {} }), start: async () => ({ ok: true }), cancel: async () => ({ ok: true }), state: async () => ({ running: false, events: [] }), onEvent: () => () => {}, folders: async () => ({ steps: [] }) } })
  await page.goto('/'); await openVolumes(page)
  const d = modalOf(page)
  await expect(d.getByTestId('volume-new-type').locator('input[type=radio]')).toHaveCount(3)
  await expect(d.getByTestId('volume-new-type-volume')).toBeVisible(); await expect(d.getByTestId('volume-new-type-wasabi')).toBeVisible(); await expect(d.getByTestId('volume-new-type-s3')).toBeVisible()
  await expect(d.getByTestId('volume-local')).toHaveCount(1)
  await d.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-sync-btn').click()
  const s = page.getByTestId('sync-modal')
  const opts = await s.getByTestId('sync-from').locator('option').allInnerTexts()
  expect(opts.join('|')).not.toMatch(/This PC|ComfyUI-Shared/)
  await expect(s.locator('[data-testid="sync-to-item"][data-kind="pc"]').getByTestId('sync-to-check')).toBeChecked()   // it stays the default target
})
