import { test, expect, openVolumes } from './fixtures'

// Drag to order in Network Volumes: volumes are kept in the configuration (volumes.getOrder / setOrder, so export and import carry them); every row (volumes, storages, This PC = 'local', BH = 'bh') is draggable among all rows and the one order is saved through the same API.
// The rows are far apart, so the drag events are sent to them directly.
const ADAPTERS = () => JSON.parse(JSON.stringify([
  { id: 'publish-s3', name: 'Panama BH (S3)', builtin: true, kind: 'publish', enabled: true, endpoint: '', region: 'us-west-2', bucket: 'bh-panama', prefix: 'returns/', ready: true, key_hint: '' },
  { id: 'panama-s3', name: 'Panama BH exchange (S3)', builtin: true, kind: 'panama', enabled: true, endpoint: '', region: 'us-west-2', bucket: 'bh-panama', prefix: 'rounds/', ready: true, key_hint: '' },
  { id: 'wasabi', name: 'Wasabi', builtin: true, kind: 'wasabi', enabled: true, endpoint: 'https://s3.wasabisys.com', region: 'eu-central-1', bucket: 'bh-wasabi', prefix: '', ready: true, key_hint: '…1111' },
  { id: 'mine', name: 'My Bucket', builtin: false, kind: 'custom', enabled: true, endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'mine', prefix: '', ready: true, key_hint: '…3333' },
]))
const calls = (api, k) => (api.state.storage?.calls || []).filter((c) => k in c).map((c) => c[k])
const ids = (page, tid) => page.locator(`[data-testid="${tid}"]`).evaluateAll((els) => els.map((e) => e.dataset.id))
async function drag(page, handle, target) {
  const dt = await page.evaluateHandle(() => new DataTransfer())
  await handle.dispatchEvent('dragstart', { dataTransfer: dt })
  await target.dispatchEvent('dragover', { dataTransfer: dt }); await target.dispatchEvent('drop', { dataTransfer: dt })
}
async function open(page, api) { api.state.storage = { adapters: ADAPTERS() }; api.state.panama = { configured: true }; await page.goto('/'); await openVolumes(page); await expect(page.getByTestId('volume-bh')).toBeVisible() }

const rowIds = (page) => page.getByTestId('volumes-list').locator(':scope > .list-group-item').evaluateAll((els) => els.map((e) => e.dataset.id || e.dataset.testid.replace('volume-', '')))

test('every row has a drag handle: volumes, storages, This PC and the BH bucket', async ({ page, api }) => {
  await open(page, api)
  await expect(page.getByTestId('volume-drag-handle')).toHaveCount(2); await expect(page.getByTestId('storage-row-drag-handle')).toHaveCount(2)
  await expect(page.getByTestId('volume-local').getByTestId('local-drag-handle')).toHaveCount(1); await expect(page.getByTestId('volume-bh').getByTestId('bh-drag-handle')).toHaveCount(1)
  const h = page.getByTestId('volume-drag-handle').first(); await expect(h).toHaveAttribute('aria-label', /order/i); await expect(h).toHaveAttribute('title', /.+/)
})

test('the default order: RunPod volumes, storages, This PC, then the BH exchange bucket last', async ({ page, api }) => {
  await open(page, api)
  expect(await rowIds(page)).toEqual(['vol1', 'vol2', 'wasabi', 'mine', 'local', 'bh'])
})

test('any row can be dragged anywhere: This PC above the volumes, the BH row up, a volume below a storage; the one order is saved through the API and survives reopening', async ({ page, api }) => {
  await open(page, api)
  await drag(page, page.getByTestId('local-drag-handle'), page.locator('[data-testid="volume"][data-id="vol1"]'))
  await expect.poll(() => rowIds(page)).toEqual(['local', 'vol1', 'vol2', 'wasabi', 'mine', 'bh'])
  await drag(page, page.getByTestId('bh-drag-handle'), page.locator('[data-testid="volume-storage"][data-id="wasabi"]'))
  await expect.poll(() => rowIds(page)).toEqual(['local', 'vol1', 'vol2', 'bh', 'wasabi', 'mine'])
  await drag(page, page.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-drag-handle'), page.locator('[data-testid="volume-storage"][data-id="wasabi"]'))
  await expect.poll(() => rowIds(page)).toEqual(['local', 'vol2', 'bh', 'wasabi', 'vol1', 'mine'])
  await expect.poll(() => api.state.volumeOrder).toEqual(['local', 'vol2', 'bh', 'wasabi', 'vol1', 'mine']); expect(api.state.volumeOrderCalls).toHaveLength(3)
  expect(await page.evaluate(() => localStorage.getItem('runpod-manager.volume-order'))).toBeNull()
  await page.reload(); await openVolumes(page)
  await expect.poll(() => rowIds(page)).toEqual(['local', 'vol2', 'bh', 'wasabi', 'vol1', 'mine'])
})

test('storage rows no longer call storage.reorder (the Storage tab keeps its own order); ids that are gone are ignored and unlisted rows go after the listed ones', async ({ page, api }) => {
  api.state.volumeOrder = ['gone', 'bh', 'vol2']
  await open(page, api)
  await expect.poll(() => rowIds(page)).toEqual(['bh', 'vol2', 'vol1', 'wasabi', 'mine', 'local'])
  await drag(page, page.locator('[data-testid="volume-storage"][data-id="mine"]').getByTestId('storage-row-drag-handle'), page.locator('[data-testid="volume-storage"][data-id="wasabi"]'))
  await expect.poll(() => rowIds(page)).toEqual(['bh', 'vol2', 'vol1', 'mine', 'wasabi', 'local'])
  expect(calls(api, 'order')).toHaveLength(0)
})

test('a core without volume order: the drag still works for this session and nothing breaks', async ({ page, api }) => {
  api.state.volumeOrderOld = true
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await open(page, api)
  await drag(page, page.locator('[data-testid="volume"][data-id="vol2"]').getByTestId('volume-drag-handle'), page.locator('[data-testid="volume"][data-id="vol1"]'))
  await expect.poll(() => rowIds(page)).toEqual(['vol2', 'vol1', 'wasabi', 'mine', 'local', 'bh'])
  expect(errors).toEqual([])
})
