import { test, expect, openVolumes } from './fixtures'
import { t } from './i18n'

// Sync from a bucket row and bucket to bucket through a pod (docs/ADR-067, "Amendment 2026-11-28"). The core is faked: state.bucketsync / state.sourcesync, state.storage and state.panama in e2e/fixtures.js.
const ADAPTERS = () => JSON.parse(JSON.stringify([
  { id: 'publish-s3', name: 'Panama BH (S3)', builtin: true, kind: 'publish', enabled: true, endpoint: '', region: 'us-west-2', bucket: 'bh-panama', prefix: 'returns/', ready: true, key_hint: '' },
  { id: 'panama-s3', name: 'Panama BH exchange (S3)', builtin: true, kind: 'panama', enabled: true, endpoint: '', region: 'us-west-2', bucket: 'bh-panama-exchange', prefix: 'rounds/', ready: true, key_hint: '' },
  { id: 'wasabi', name: 'Wasabi', builtin: true, kind: 'wasabi', enabled: true, endpoint: 'https://s3.wasabisys.com', region: 'eu-central-1', bucket: 'bh-wasabi', prefix: '', ready: true, key_hint: '…1111' },
  { id: 'other', name: 'Other Bucket', builtin: false, kind: 'custom', enabled: true, endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'other', prefix: '', ready: true, key_hint: '…2222' },
  { id: 'mine', name: 'My Bucket', builtin: false, kind: 'custom', enabled: true, endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'mine', prefix: '', ready: true, key_hint: '…3333', default: true },
  { id: 'b2', name: 'Backblaze B2', builtin: false, kind: 'custom', enabled: false, endpoint: '', region: '', bucket: '', prefix: '', ready: false, problem: 'Add a bucket', key_hint: '' },
]))
/** Shared, Volumes, then a bucket row's Sync button (which: 'storage' with an id, or 'bh'). */
async function openBucketSync(page, api, which, id, extra = {}) {
  api.state.storage = { adapters: ADAPTERS() }
  api.state.panama = { configured: true }
  Object.assign(api.state, extra)
  await page.addInitScript(() => {
    window.__e2eSync = { plan: async () => ({ steps: [], transport: { kind: 'none', reason: '' }, shared: null }), count: async () => ({ all: {} }), start: async () => ({ ok: true }), cancel: async () => ({ ok: true }), state: async () => ({ running: false, events: [] }), onEvent: () => () => {}, folders: async () => ({ steps: [] }) }
  })
  await page.goto('/')
  await openVolumes(page)
  const btn = which === 'bh' ? page.getByTestId('bh-sync-btn') : page.locator(`[data-testid="volume-storage"][data-id="${id}"]`).getByTestId('storage-sync-btn')
  await expect(btn).toBeEnabled()
  await btn.click()
  const d = page.getByTestId('sync-modal')
  await expect(d.getByTestId('sync-route')).toBeVisible()
  await expect(d.locator('[data-testid="sync-to-item"][data-kind="pc"]')).toBeVisible()
  return d
}
const item = (d, kind, id) => d.locator(`[data-testid="sync-to-item"][data-kind="${kind}"]${id ? `[data-id="${id}"]` : ''}`)
const startBtn = (d) => d.locator('.modal-footer .btn-warning')
const target = (d, key) => d.locator(`[data-testid="sync-target"][data-key="${key}"]`)
const job = (d, label) => d.locator(`[data-testid="sync-job"][data-target="${label}"]`)

test('the Wasabi and BH exchange rows have an icon-only Sync button (aria-label, title); a storage that is not ready has it disabled with the reason', async ({ page, api }) => {
  api.state.storage = { adapters: ADAPTERS() }; api.state.panama = { configured: true }
  await page.goto('/'); await openVolumes(page)
  for (const btn of [page.locator('[data-testid="volume-storage"][data-id="wasabi"]').getByTestId('storage-sync-btn'), page.getByTestId('bh-sync-btn')]) {
    await expect(btn).toBeVisible(); await expect(btn).toHaveText(''); await expect(btn).toHaveAttribute('aria-label', 'Sync'); await expect(btn).toHaveAttribute('title', /.+/); await expect(btn).toBeEnabled()
  }
  const off = page.locator('[data-testid="volume-storage"][data-id="b2"]').getByTestId('storage-sync-btn')
  await expect(off).toBeDisabled(); await expect(off).toHaveAttribute('title', /Not ready yet/)
})

test('the BH Sync button is disabled with the reason when the Panama keys are not set or the Panama bucket is switched off', async ({ page, api }) => {
  api.state.storage = { adapters: ADAPTERS() }; api.state.panama = { configured: false }
  await page.goto('/'); await openVolumes(page)
  await expect(page.getByTestId('bh-sync-btn')).toBeDisabled(); await expect(page.getByTestId('bh-sync-btn')).toHaveAttribute('title', 'The Panama keys are not set')
  api.state.panama = { configured: true }; api.state.storage.adapters.find((a) => a.id === 'panama-s3').enabled = false
  await page.reload(); await openVolumes(page)
  await expect(page.getByTestId('bh-sync-btn')).toBeDisabled(); await expect(page.getByTestId('bh-sync-btn')).toHaveAttribute('title', 'The Panama bucket is switched off')
})

test('the Wasabi Sync button opens the window with Wasabi as From and This PC ticked; Wasabi is not a target; the default storage is first in To; BH is never in To', async ({ page, api }) => {
  const d = await openBucketSync(page, api, 'storage', 'wasabi')
  await expect(d.getByTestId('sync-from')).toHaveValue('storage:wasabi')
  await expect(item(d, 'pc').getByTestId('sync-to-check')).toBeChecked()
  await expect(target(d, 'ss:storage:wasabi').getByTestId('sync-target-counts')).toBeVisible()   // This PC download is planned
  const ids = await d.locator('[data-testid="sync-to-item"][data-kind="storage"]').evaluateAll((els) => els.map((e) => e.dataset.id))
  expect(ids).toEqual(['mine', 'wasabi', 'other'])   // the default first; not the publish destination and not the BH exchange bucket
  await expect(item(d, 'storage', 'mine').getByTestId('sync-to-default')).toHaveText('Default')
  await expect(item(d, 'storage', 'wasabi').getByTestId('sync-to-reason')).toHaveText('This is the source')   // the same storage cannot be both From and To
  await expect(item(d, 'storage', 'wasabi').getByTestId('sync-to-check')).toBeDisabled()
  await expect(d.locator('[data-testid="sync-to-item"][data-id="panama-s3"]')).toHaveCount(0)
  await expect(d.getByTestId('sync-to-bh-note')).toHaveCount(0)
  await expect(d.locator('[data-testid="sync-from-option"][data-kind="pod"]')).toHaveCount(0)   // a bucket's window has no "pod on this volume"
  await expect(d.locator('.modal-title, header').first()).toContainText('Sync Wasabi')
})

test('a BH source with This PC: BH is listed in From as BH Exchange Bucket, never in To (a one-line note says why), and Start downloads', async ({ page, api }) => {
  const d = await openBucketSync(page, api, 'bh')
  await expect(d.getByTestId('sync-from')).toHaveValue('storage:panama-s3')
  expect(await d.getByTestId('sync-from').locator('option:checked').innerText()).toBe('BH Exchange Bucket')
  await expect(item(d, 'pc').getByTestId('sync-to-check')).toBeChecked()
  await expect(d.getByTestId('sync-to-bh-note')).toContainText('never a target')
  await expect(item(d, 'bh').getByTestId('sync-to-check')).toBeDisabled(); await expect(item(d, 'bh')).toContainText('BH exchange: publishing only')
  await expect(d.locator('[data-testid="sync-to-item"][data-id="panama-s3"]')).toHaveCount(0)
  await expect(item(d, 'storage', 'wasabi').getByTestId('sync-to-check')).toBeEnabled()
  const c = target(d, 'ss:storage:panama-s3')
  await expect(c.getByTestId('sync-target-counts')).toBeVisible()
  expect(api.state.sourcesync.calls.filter((x) => x.plan).pop().plan.source).toEqual({ type: 'storage', storage_id: 'panama-s3' })
  await startBtn(d).click()
  const j = job(d, 'To This PC')
  await expect(j).toBeVisible(); await expect(j.getByTestId('sync-job-sub')).toHaveText('from BH Exchange Bucket')
  await expect(j).toHaveAttribute('data-state', 'done', { timeout: 10000 })
})

test('with BH as the source the other storages can be ticked (Run On appears); switching From to another storage drops the same one from To', async ({ page, api }) => {
  const d = await openBucketSync(page, api, 'bh')
  await item(d, 'storage', 'wasabi').getByTestId('sync-to-check').check()
  await expect(d.getByTestId('sync-run-on')).toBeVisible()
  await d.getByTestId('sync-from').selectOption('storage:wasabi')
  await expect(item(d, 'storage', 'wasabi').getByTestId('sync-to-check')).not.toBeChecked()
  await expect(d.getByTestId('sync-run-on')).toHaveCount(0)   // nothing bucket-to-bucket is ticked any more
})

test('a storage source with a second storage ticked: Run On (running pods with SSH), a Bucket target plan, one confirmation with the price, a job with progress, Cancel', async ({ page, api }) => {
  api.state.pods.push({ id: 'pod-eeeeeeee', name: 'ComfyUI-NoSsh', status: 'running', datacenter: 'EU-RO-1', gpu: 'RTX 4090', vram: 24 })
  api.state.bucketsync = { scripts: { 'storage:wasabi>mine': { hold: true } } }
  const d = await openBucketSync(page, api, 'storage', 'wasabi')
  await expect(d.getByTestId('sync-run-on')).toHaveCount(0)   // only when a bucket-to-bucket target is ticked
  await item(d, 'storage', 'mine').getByTestId('sync-to-check').check()
  const run = d.getByTestId('sync-run-on')
  await expect(run).toBeVisible(); await expect(d.getByTestId('sync-run-on-block')).toContainText('Run On (a running pod carries the files)')
  expect(await d.getByTestId('sync-run-on-option').allInnerTexts()).toEqual(['ComfyUI-Dev'])   // running with SSH only
  await expect(run).toHaveValue('pod-aaaaaaaa')
  const c = target(d, 'bs:storage:wasabi:mine')
  await expect(c.getByTestId('sync-target-title')).toContainText('Bucket target: My Bucket')
  await expect(c.getByTestId('sync-target-listing')).toContainText('files so far')
  await expect(c.getByTestId('sync-target-counts')).toBeVisible()
  await expect(c.locator('[data-testid="sync-target-leave-out"][data-name=".previews"]')).toBeChecked()
  await expect(c.locator('[data-testid="sync-target-leave-out"][data-name="_TEST_A"]')).toBeChecked()
  await expect(c.locator('[data-testid="sync-target-leave-out"][data-name="shot-001"]')).not.toBeChecked()
  await expect(c.getByTestId('sync-target-already')).toContainText('already there'); await expect(c.getByTestId('sync-target-copy')).toContainText('to copy')
  await expect(c.getByTestId('sync-target-toobig')).toContainText('huge-0001.exr'); await expect(c.getByTestId('sync-target-weights')).toContainText('3 model weights')
  await expect(c.getByTestId('sync-target-pod')).toHaveText('Pod ComfyUI-Dev at $0.69 an hour does the copy.')
  await expect(c.getByTestId('sync-target-estimate')).toContainText('About')
  const plan = api.state.bucketsync.calls.filter((x) => x.plan).pop().plan
  expect(plan).toMatchObject({ source: { type: 'storage', storage_id: 'wasabi' }, target: { storage_id: 'mine' }, run_on: { pod_id: 'pod-aaaaaaaa' } })
  expect(plan.skip_folders.join()).toBe('.previews,_TEST_A')
  await startBtn(d).click()
  await expect(page.getByTestId('confirm-message')).toContainText('$0.69 an hour'); await expect(page.getByTestId('confirm-message')).toContainText('My Bucket')
  expect(api.state.bucketsync.calls.filter((x) => x.start)).toHaveLength(0)   // nothing starts before the yes
  await page.getByTestId('confirm-ok').click()
  const j = job(d, 'To My Bucket')
  await expect(j).toBeVisible(); await expect(j.getByTestId('sync-job-sub')).toHaveText('from Wasabi')
  await expect(j.getByTestId('sync-job-progress')).toContainText('files')
  expect(api.state.bucketsync.calls.filter((x) => x.start)).toHaveLength(1)
  await expect(d.getByTestId('sync-run-on')).toBeDisabled()
  await j.getByTestId('sync-job-cancel').click()
  await expect(j).toHaveAttribute('data-state', 'cancelled')
  expect(api.state.bucketsync.calls.some((x) => x.cancel)).toBe(true)
})

test('This PC and a storage ticked together: the download and the bucket copy start with one Start; a failed bucket job offers Retry Failed; a running one shows in the Queue', async ({ page, api }) => {
  api.state.bucketsync = { scripts: { 'storage:wasabi>other': { fail: true }, 'storage:wasabi>mine': { hold: true } } }
  const d = await openBucketSync(page, api, 'storage', 'wasabi')
  await item(d, 'storage', 'other').getByTestId('sync-to-check').check()
  await expect(target(d, 'bs:storage:wasabi:other').getByTestId('sync-target-counts')).toBeVisible()
  await expect(target(d, 'ss:storage:wasabi').getByTestId('sync-target-counts')).toBeVisible()
  await startBtn(d).click(); await page.getByTestId('confirm-ok').click()
  await expect(job(d, 'To This PC')).toBeVisible(); await expect(job(d, 'To Other Bucket')).toBeVisible()
  const bad = job(d, 'To Other Bucket')
  await expect(bad).toHaveAttribute('data-state', 'failed', { timeout: 10000 })
  await expect(bad.getByTestId('sync-job-retry')).toBeVisible()
  await bad.getByTestId('sync-job-retry').click()
  await expect(job(d, 'To Other Bucket')).toHaveAttribute('data-state', 'done', { timeout: 10000 })
  expect(api.state.bucketsync.calls.some((x) => x.retry)).toBe(true)
})

test('a bucket job running shows in the Queue as Copy From, To, with Cancel', async ({ page, api }) => {
  api.state.bucketsync = { scripts: { 'storage:wasabi>mine': { hold: true } } }
  const d = await openBucketSync(page, api, 'storage', 'wasabi')
  await item(d, 'pc').getByTestId('sync-to-check').uncheck()
  await item(d, 'storage', 'mine').getByTestId('sync-to-check').check()
  await expect(target(d, 'bs:storage:wasabi:mine').getByTestId('sync-target-counts')).toBeVisible()
  await startBtn(d).click(); await page.getByTestId('confirm-ok').click()
  await expect(job(d, 'To My Bucket')).toBeVisible()
  await d.locator('.modal-footer').getByRole('button', { name: t('picker.cancel') }).click()
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect(page.locator('.modal.show')).toHaveCount(0)
  await page.getByTestId('open-queue').click()
  const row = page.locator('[data-testid="queue-working-row"][data-kind="bucket-sync"]')
  await expect(row).toBeVisible(); await expect(row).toContainText('Copy From Wasabi To My Bucket'); await expect(row.getByTestId('queue-working-cancel')).toBeVisible()
  await row.getByTestId('queue-working-cancel').click()
  await expect.poll(() => api.state.bucketsync.calls.some((x) => x.cancel)).toBe(true)
})

test('no running pod: the storage targets are disabled with Needs a running pod to carry it and there is no Run On; This PC still works', async ({ page, api }) => {
  api.state.pods.forEach((p) => { p.status = 'stopped'; delete p.ssh_command })
  const d = await openBucketSync(page, api, 'storage', 'wasabi')
  for (const id of ['mine', 'other']) { await expect(item(d, 'storage', id).getByTestId('sync-to-check')).toBeDisabled(); await expect(item(d, 'storage', id).getByTestId('sync-to-reason')).toHaveText('Needs a running pod to carry it') }
  await expect(d.getByTestId('sync-run-on')).toHaveCount(0)
  await expect(item(d, 'pc').getByTestId('sync-to-check')).toBeEnabled()
  await expect(target(d, 'ss:storage:wasabi').getByTestId('sync-target-counts')).toBeVisible()
  await expect(startBtn(d)).toBeEnabled()
})

test('a bucket plan that cannot start says why and Start stays off', async ({ page, api }) => {
  api.state.bucketsync = { pod: null }
  const d = await openBucketSync(page, api, 'storage', 'wasabi')
  await item(d, 'pc').getByTestId('sync-to-check').uncheck()
  await item(d, 'storage', 'mine').getByTestId('sync-to-check').check()
  await expect(target(d, 'bs:storage:wasabi:mine').getByTestId('sync-target-reason')).toContainText('not running')
  await expect(startBtn(d)).toBeDisabled()
})

test('a core without bucketsync: planning says to restart the app', async ({ page, api }) => {
  api.state.bucketsync = { old: true }
  const d = await openBucketSync(page, api, 'storage', 'wasabi')
  await item(d, 'pc').getByTestId('sync-to-check').uncheck()
  await item(d, 'storage', 'mine').getByTestId('sync-to-check').check()
  await expect(target(d, 'bs:storage:wasabi:mine').getByTestId('sync-target-error')).toContainText('Restart the app')
  await expect(startBtn(d)).toBeDisabled()
})
