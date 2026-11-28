import { test, expect, podCard, openVolumeSync } from './fixtures'
import { t } from './i18n'

// The Sync window's From and To (docs/ADR-067), the Storage target sections (ADR-066) and the Download section, and the shared Folders table.
// The core is faked: state.volumesync / state.sourcesync and state.storage in e2e/fixtures.js. The page treats a present window.core as the whole app, so the pod sync calls are a stand-in (window.__e2eSync).
const ADAPTERS = () => JSON.parse(JSON.stringify([
  { id: 'publish-s3', name: 'Panama BH (S3)', builtin: true, kind: 'publish', enabled: true, endpoint: '', region: 'us-west-2', bucket: 'bh-panama', prefix: 'returns/', ready: true, key_hint: '' },
  { id: 'wasabi', name: 'Wasabi', builtin: true, kind: 'wasabi', enabled: true, endpoint: 'https://s3.wasabisys.com', region: 'eu-central-1', bucket: 'bh-wasabi', prefix: '', ready: true, key_hint: '…1111' },
  { id: 'other', name: 'Other Bucket', builtin: false, kind: 'custom', enabled: true, endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'other', prefix: '', ready: true, key_hint: '…2222' },
  { id: 'mine', name: 'My Bucket', builtin: false, kind: 'custom', enabled: true, endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'mine', prefix: '', ready: true, key_hint: '…3333', default: true },
  { id: 'b2', name: 'Backblaze B2', builtin: false, kind: 'custom', enabled: false, endpoint: '', region: '', bucket: '', prefix: '', ready: false, problem: 'Add a bucket', key_hint: '' },
]))
async function openSync(page, api, extra = {}, volume = 'vol1') {
  api.state.storage = { adapters: ADAPTERS() }
  Object.assign(api.state, extra)
  await page.addInitScript(() => {
    window.__e2eSync = {
      plan: async () => ({ steps: [{ key: 'project', local: '/Users/me/project', remote: '/workspace/project' }, { key: 'comfy-shared', local: '/Users/me/ComfyUI-Shared', remote: '/workspace/ComfyUI-Shared' }, { key: 'workflows', local: '/Users/me/workflows', remote: '/workspace/workflows' }], transport: { kind: 'ssh', reason: 'ssh' }, shared: null }),
      count: async () => ({ pending: false, all: { total_files: 10, total_bytes: 1e9 } }), start: async (req) => { window.__started = req; return { ok: true } }, cancel: async () => ({ ok: true }), state: async () => ({ running: false, events: [] }),
      onEvent: () => () => {}, folders: async () => ({ steps: [] }),
    }
  })
  await page.goto('/')
  const d = await openVolumeSync(page, volume)
  await expect(d.getByTestId('sync-route')).toBeVisible()
  await expect(d.locator('[data-testid="sync-to-item"][data-kind="storage"]').first()).toBeVisible()
  return d
}
const item = (d, kind, id) => d.locator(`[data-testid="sync-to-item"][data-kind="${kind}"]${id ? `[data-id="${id}"]` : ''}`)
const startBtn = (d) => d.locator('.modal-footer .btn-warning')
const target = (d, key) => d.locator(`[data-testid="sync-target"][data-key="${key}"]`)
const job = (d, label) => d.locator(`[data-testid="sync-job"][data-target="${label}"]`)

test('From offers this pod, the volumes and the storages with the default storage first; To has This PC ticked', async ({ page, api }) => {
  const d = await openSync(page, api)
  const from = d.getByTestId('sync-from')
  await expect(from).toHaveValue('pod')
  const opts = await from.locator('option').allInnerTexts()
  expect(opts[0]).toBe('A pod on this volume'); expect(opts[1]).toBe('This volume over S3 (no pod)')
  expect(opts).toContain('scratch · 50 GB · CA-MTL-1'); expect(opts).not.toContain('comfy-workspace · 120 GB · EU-RO-1')   // this volume is the S3 option
  const st = opts.filter((o) => /Bucket|Wasabi/.test(o)); expect(st).toEqual(['My Bucket (Default)', 'Wasabi', 'Other Bucket'])
  expect(opts.join('|')).not.toMatch(/Backblaze/)   // not ready: not offered
  await expect(item(d, 'pc').getByTestId('sync-to-check')).toBeChecked()
  const ids = await d.locator('[data-testid="sync-to-item"][data-kind="storage"]').evaluateAll((els) => els.map((e) => e.dataset.id))
  expect(ids).toEqual(['mine', 'wasabi', 'other'])   // the default first, never the publish destination
  await expect(item(d, 'storage', 'mine').getByTestId('sync-to-default')).toHaveText('Default')
  await expect(item(d, 'storage', 'wasabi').getByTestId('sync-to-default')).toHaveCount(0)
  await expect(item(d, 'storage', 'mine').getByTestId('sync-to-check')).not.toBeChecked()
  await expect(d.getByTestId('sync-confirm')).toBeVisible()   // the pod to this PC window as it was
  await expect(d.getByTestId('sync-from-pod')).toHaveValue('pod-aaaaaaaa')
  await expect(item(d, 'volume', 'vol1').getByTestId('sync-to-reason')).toHaveText('This is the source')
  await expect(d.getByTestId('sync-target')).toHaveCount(0)
  await expect(startBtn(d)).toHaveText(t('sync.startPush'))
})

test('a volume as the source: This PC and the storages (a pod carries them, docs/ADR-067); the volumes are Not built yet and the source itself cannot be ticked', async ({ page, api }) => {
  const d = await openSync(page, api)
  await item(d, 'storage', 'wasabi').getByTestId('sync-to-check').check()
  await d.getByTestId('sync-from').selectOption('volume:vol1')
  await expect(item(d, 'storage', 'wasabi').getByTestId('sync-to-check')).toBeChecked()   // kept: a running pod carries a volume to a storage (bucket to bucket), so Run On appears
  await expect(d.getByTestId('sync-run-on')).toBeVisible()
  for (const id of ['mine', 'wasabi', 'other']) { await expect(item(d, 'storage', id).getByTestId('sync-to-check')).toBeEnabled(); await expect(item(d, 'storage', id).getByTestId('sync-to-reason')).toHaveCount(0) }   // a running pod carries volume to storage
  await expect(item(d, 'volume', 'vol1').getByTestId('sync-to-reason')).toHaveText('This is the source')
  await expect(item(d, 'volume', 'vol2').getByTestId('sync-to-reason')).toHaveText('Not built yet')
  await expect(item(d, 'volume', 'vol2').getByTestId('sync-to-check')).toBeDisabled()
  await expect(item(d, 'pc').getByTestId('sync-to-check')).toBeEnabled()
  await d.getByTestId('sync-from').selectOption('pod')
  await expect(item(d, 'storage', 'wasabi').getByTestId('sync-to-check')).toBeEnabled()
  await expect(item(d, 'volume', 'vol2').getByTestId('sync-to-reason')).toHaveText('Not built yet')
})

test('the same storage cannot be both From and To; the default storage is first in the From list too', async ({ page, api }) => {
  const d = await openSync(page, api)
  await d.getByTestId('sync-from').selectOption('storage:wasabi')
  await expect(item(d, 'storage', 'wasabi').getByTestId('sync-to-reason')).toHaveText('This is the source')
  await expect(item(d, 'storage', 'wasabi').getByTestId('sync-to-check')).toBeDisabled()
  await expect(item(d, 'storage', 'other').getByTestId('sync-to-check')).toBeEnabled()
  const first = d.getByTestId('sync-from').locator('optgroup').last().locator('option').first()
  await expect(first).toHaveText('My Bucket (Default)')
})

test('a pod to This PC and two storages: two plans, one Start, a confirmation with the price, two jobs, one fails and the other completes', async ({ page, api }) => {
  api.state.volumesync = { scripts: { wasabi: { fail: true } } }
  const d = await openSync(page, api)
  await item(d, 'storage', 'mine').getByTestId('sync-to-check').check()
  await item(d, 'storage', 'wasabi').getByTestId('sync-to-check').check()
  const a = target(d, 'vs:mine'), b = target(d, 'vs:wasabi')
  await expect(a.getByTestId('sync-target-listing')).toContainText('files so far')
  await expect(a.getByTestId('sync-target-counts')).toBeVisible(); await expect(b.getByTestId('sync-target-counts')).toBeVisible()
  // the hidden and test folders start left out (a second plan asks the core with them)
  await expect(a.locator('[data-testid="sync-target-leave-out"][data-name=".previews"]')).toBeChecked()
  await expect(a.locator('[data-testid="sync-target-leave-out"][data-name="_TEST_A"]')).toBeChecked()
  await expect(a.locator('[data-testid="sync-target-leave-out"][data-name="shot-001"]')).not.toBeChecked()
  await expect(a.getByTestId('sync-target-counts')).toContainText('160 files')
  await expect(a.getByTestId('sync-target-already')).toContainText('already there'); await expect(a.getByTestId('sync-target-copy')).toContainText('to copy')
  await expect(a.getByTestId('sync-target-toobig')).toContainText('huge-0001.exr'); await expect(a.getByTestId('sync-target-weights')).toContainText('3 model weights')
  await expect(a.getByTestId('sync-target-pod')).toHaveText('Pod ComfyUI-Dev at $0.69 an hour does the copy.')
  await expect(a.getByTestId('sync-target-estimate')).toContainText('About')
  const plans = api.state.volumesync.calls.filter((c) => c.plan).map((c) => c.plan)
  expect(plans.some((p) => p.storage_id === 'mine' && p.volume_id === 'vol1' && p.pod_id === 'pod-aaaaaaaa' && p.skip_folders.join() === '.previews,_TEST_A')).toBe(true)
  await expect(startBtn(d)).toHaveText(t('syncTargets.start')); await expect(startBtn(d)).toBeEnabled()
  await startBtn(d).click()
  await expect(page.getByTestId('confirm-message')).toContainText('$0.69 an hour')
  await expect(page.getByTestId('confirm-message')).toContainText('about')
  expect(api.state.volumesync.calls.filter((c) => c.start)).toHaveLength(0)   // nothing starts before the yes
  await page.getByTestId('confirm-ok').click()
  await expect.poll(() => page.evaluate(() => !!window.__started)).toBe(true)   // the pod sync started with the same Start
  expect(api.state.volumesync.calls.filter((c) => c.start).map((c) => c.key).sort()).toEqual(['mine', 'wasabi'])
  const jm = job(d, 'To My Bucket'), jw = job(d, 'To Wasabi')
  await expect(jm).toBeVisible(); await expect(jw).toBeVisible()
  await expect(jm.getByTestId('sync-job-progress')).toContainText('files')
  await expect(jm).toHaveAttribute('data-state', 'done', { timeout: 10000 })
  await expect(jw).toHaveAttribute('data-state', 'failed', { timeout: 10000 })
  await expect(jw.getByTestId('sync-job-warning').first()).toContainText('connection reset'); await expect(jw.getByTestId('sync-job-error')).toBeVisible()
  await expect(jw.getByTestId('sync-job-retry')).toBeVisible(); await expect(jm.getByTestId('sync-job-retry')).toHaveCount(0)
  await jw.getByTestId('sync-job-retry').click()
  await expect(job(d, 'To Wasabi')).toHaveAttribute('data-state', 'done', { timeout: 10000 })
  expect(api.state.volumesync.calls.some((c) => c.retry)).toBe(true)
})

test('a pod to two storages without This PC shows only the storage sections', async ({ page, api }) => {
  const d = await openSync(page, api)
  await item(d, 'pc').getByTestId('sync-to-check').uncheck()
  await item(d, 'storage', 'mine').getByTestId('sync-to-check').check()
  await expect(d.getByTestId('sync-confirm')).toHaveCount(0); await expect(d.getByTestId('sync-plan')).toHaveCount(0)
  await expect(target(d, 'vs:mine').getByTestId('sync-target-counts')).toBeVisible()
  await expect(startBtn(d)).toBeEnabled()
})

test('a storage section with no running pod says why and Start stays off', async ({ page, api }) => {
  api.state.volumesync = { pod: null }
  const d = await openSync(page, api)
  await item(d, 'pc').getByTestId('sync-to-check').uncheck()
  await item(d, 'storage', 'mine').getByTestId('sync-to-check').check()
  await expect(target(d, 'vs:mine').getByTestId('sync-target-reason')).toContainText('No pod is running')
  await expect(startBtn(d)).toBeDisabled()
})

test('a plan that fails is an alert in its section', async ({ page, api }) => {
  api.state.volumesync = { planFail: { mine: 'The storage could not be read' } }
  const d = await openSync(page, api)
  await item(d, 'storage', 'mine').getByTestId('sync-to-check').check()
  await expect(target(d, 'vs:mine').getByTestId('sync-target-error')).toContainText('The storage could not be read')
})

test('a volume to This PC: the plan names conflicts and the unmapped folder, Start, progress, Cancel; a failed run offers Retry Failed', async ({ page, api }) => {
  api.state.sourcesync = { scripts: { 'volume:vol1': { hold: true } } }
  const d = await openSync(page, api)
  await d.getByTestId('sync-from').selectOption('volume:vol1')
  await expect(d.getByTestId('sync-confirm')).toHaveCount(0)   // the pod window gives way
  const c = target(d, 'ss:volume:vol1')
  await expect(c.getByTestId('sync-target-counts')).toContainText('80 files')
  await expect(c.getByTestId('sync-target-conflicts')).toContainText('2 file(s)'); await expect(c.getByTestId('sync-target-conflicts')).toContainText('a.exr')
  const plates = c.locator('[data-testid="sync-target-folder"][data-name="plates"]')
  await expect(plates.getByTestId('sync-target-folder-reason')).toHaveText('not mapped on this PC'); await expect(plates.getByTestId('sync-target-leave-out')).toBeDisabled()
  await expect(c.locator('[data-testid="sync-target-folder"][data-name="project"]').getByTestId('sync-target-folder-dir')).toContainText('/Users/me/project')
  await expect(c.getByTestId('sync-target-dir')).toHaveCount(2)
  await expect(c.getByTestId('sync-target-free')).toContainText('free')
  await expect(c.getByTestId('sync-dest-dir')).toHaveCount(0)   // a volume lands in the mapped folders
  // a tick plans again
  await c.locator('[data-testid="sync-target-leave-out"][data-name="project"]').check()
  await expect(c.getByTestId('sync-target-counts')).toContainText('50 files')
  expect(api.state.sourcesync.calls.filter((x) => x.plan).pop().plan.skip_folders).toEqual(['project'])
  await expect(startBtn(d)).toHaveText(t('syncTargets.start')); await startBtn(d).click()
  await expect(page.getByTestId('confirm-modal')).toBeHidden()   // no pod, no price: no confirmation
  const j = job(d, 'To This PC')
  await expect(j).toBeVisible(); await expect(j.getByTestId('sync-job-sub')).toHaveText('from comfy-workspace')
  await expect(j.getByTestId('sync-job-current')).toBeVisible()
  await expect(j.getByTestId('sync-job-progress')).toContainText('of')
  await j.getByTestId('sync-job-cancel').click()
  await expect(j).toHaveAttribute('data-state', 'cancelled')
  await expect(j.getByTestId('sync-job-retry')).toHaveCount(0)
  await expect(d.locator('.modal-footer button').last()).toHaveText(t('sync.again'))
  await d.locator('.modal-footer button').last().click()
  await expect(target(d, 'ss:volume:vol1').getByTestId('sync-target-counts')).toBeVisible()   // planned again
})

test('a volume to This PC that ends with failed files: Retry Failed starts a new job', async ({ page, api }) => {
  api.state.sourcesync = { scripts: { 'volume:vol1': { fail: true } } }
  const d = await openSync(page, api)
  await d.getByTestId('sync-from').selectOption('volume:vol1')
  await expect(target(d, 'ss:volume:vol1').getByTestId('sync-target-counts')).toBeVisible()
  await startBtn(d).click()
  const j = job(d, 'To This PC')
  await expect(j).toHaveAttribute('data-state', 'failed', { timeout: 10000 })
  await expect(j.getByTestId('sync-job-counts')).toContainText('2 failed')
  await j.getByTestId('sync-job-retry').click()
  await expect(job(d, 'To This PC')).toHaveAttribute('data-state', 'done', { timeout: 10000 })
  expect(api.state.sourcesync.calls.some((x) => x.retry)).toBe(true)
})

test('a storage to This PC: the destination folder is editable and a change plans again; a refused plan is an alert and the field stays', async ({ page, api }) => {
  api.state.sourcesync = { planFail: {} }
  const d = await openSync(page, api)
  await d.getByTestId('sync-from').selectOption('storage:wasabi')
  const c = target(d, 'ss:storage:wasabi')
  await expect(c.getByTestId('sync-target-counts')).toContainText('120 files')
  const dest = c.getByTestId('sync-dest-dir')
  await expect(dest).toHaveAttribute('placeholder', '/Users/me/ComfyUI-Shared/output')
  api.state.sourcesync.planFail['storage:wasabi'] = 'The destination must be an absolute folder'
  await dest.fill('relative/dir'); await dest.blur()
  await expect(c.getByTestId('sync-target-error')).toContainText('absolute folder')
  await expect(dest).toBeVisible()
  delete api.state.sourcesync.planFail['storage:wasabi']
  await dest.fill('/Volumes/Big/wasabi'); await dest.blur()
  await expect(c.getByTestId('sync-target-counts')).toBeVisible()
  expect(api.state.sourcesync.calls.filter((x) => x.plan).pop().plan.dest_dir).toBe('/Volumes/Big/wasabi')
  await startBtn(d).click()
  await expect(job(d, 'To This PC')).toBeVisible()
  expect(api.state.sourcesync.calls.some((x) => x.start)).toBe(true)
})

test('a core without the new calls: the From and To still show; planning says to restart the app', async ({ page, api }) => {
  api.state.sourcesync = { old: true }
  const d = await openSync(page, api)
  await d.getByTestId('sync-from').selectOption('storage:wasabi')
  await expect(target(d, 'ss:storage:wasabi').getByTestId('sync-target-error')).toContainText('Restart the app')
  await expect(startBtn(d)).toBeDisabled()
})

test('the Folders table is one collapsible block for push and pull, folded by default, and remembers its state', async ({ page, api }) => {
  const d = await openSync(page, api)
  const sec = d.getByTestId('sync-folders')
  await expect(sec).toHaveAttribute('data-open', 'false')
  await expect(sec.getByTestId('sync-folders-count')).toHaveText('3 folders')
  await expect(d.getByTestId('sync-plan')).toHaveCount(1); await expect(d.getByTestId('sync-plan')).toBeHidden()
  await sec.getByTestId('collapsible-toggle').click()
  await expect(sec).toHaveAttribute('data-open', 'true'); await expect(d.getByTestId('sync-plan')).toBeVisible()
  const heads = () => d.getByTestId('sync-plan').locator('th').allInnerTexts()
  expect(await heads()).toEqual(['Folder', 'From', 'To'])
  const row = d.locator('[data-testid="sync-step"]').first()
  await expect(row.locator('td').nth(1)).toHaveText('/Users/me/project'); await expect(row.locator('td').nth(2)).toHaveText('/workspace/project')
  await d.getByTestId('sync-direction').locator('label').last().click()   // Pull: same block, still open, one table, the columns swap
  await expect(sec).toHaveAttribute('data-open', 'true'); await expect(d.getByTestId('sync-plan')).toHaveCount(1)
  expect(await heads()).toEqual(['Folder', 'From', 'To'])
  await expect(row.locator('td').nth(1)).toHaveText('/workspace/project'); await expect(row.locator('td').nth(2)).toHaveText('/Users/me/project')
  await sec.getByTestId('collapsible-toggle').click()
  await expect(sec).toHaveAttribute('data-open', 'false')
  await d.getByTestId('sync-direction').locator('label').first().click()
  await expect(sec).toHaveAttribute('data-open', 'false')   // switching direction never reopens it
  await sec.getByTestId('collapsible-toggle').click()
  await expect(sec).toHaveAttribute('data-open', 'true')
  await page.reload()   // remembered
  await openVolumeSync(page)
  await expect(page.getByTestId('sync-modal').getByTestId('sync-folders')).toHaveAttribute('data-open', 'true')
})

test('running storage and download jobs show in the Queue', async ({ page, api }) => {
  api.state.sourcesync = { scripts: { 'volume:vol1': { hold: true } } }
  const d = await openSync(page, api)
  await d.getByTestId('sync-from').selectOption('volume:vol1')
  await expect(target(d, 'ss:volume:vol1').getByTestId('sync-target-counts')).toBeVisible()
  await startBtn(d).click()
  await expect(job(d, 'To This PC')).toBeVisible()
  await d.locator('.modal-footer').getByRole('button', { name: t('picker.cancel') }).click()
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')   // the Sync window, then Network Volumes
  await expect(page.locator('.modal.show')).toHaveCount(0)
  await page.getByTestId('open-queue').click()
  const row = page.locator('[data-testid="queue-working-row"][data-kind="source-sync"]')
  await expect(row).toBeVisible(); await expect(row.getByTestId('queue-working-cancel')).toBeVisible()
})

test('the pod card has no Sync button and no Auto Sync badge (even with Auto sync on); it has three big buttons: Config, Details, Logs', async ({ page, api }) => {
  api.state.autosync = { settings: { 'pod-aaaaaaaa': { enabled: true, pull: true, push: false, approved_by: 'Lucas' } }, status: { paused: false, items: [] } }
  await page.goto('/')
  const dev = podCard(page, 'ComfyUI-Dev')
  await expect(dev.getByTestId('pod-sync')).toHaveCount(0); await expect(dev.getByTestId('pod-autosync-status')).toHaveCount(0)
  const row = dev.getByTestId('pod-card-actions')
  await expect(row.locator('button')).toHaveCount(3)
  await expect(row.locator('button')).toHaveText([/Config/, /Details/, /Logs/])
  for (const id of ['pod-config', 'pod-details-toggle', 'pod-logs-toggle']) { const b = row.getByTestId(id); await expect(b).toBeVisible(); await expect(b).not.toHaveClass(/btn-sm/); }
})

test('a volume row has a Sync button that opens the window with that volume as From; with no pod running the pod option is disabled and says why', async ({ page, api }) => {
  const d = await openSync(page, api, {}, 'vol2')
  await expect(d.locator('.modal-title, header').first()).toContainText('Sync scratch')
  await expect(d.getByTestId('sync-from')).toHaveValue('volume:vol2')
  await expect(d.locator('[data-testid="sync-from-option"][data-kind="pod"]')).toBeDisabled()
  await expect(d.getByTestId('sync-from-pod-reason')).toContainText('No pod is running on this volume')
  await expect(d.getByTestId('sync-from-pod-reason')).toContainText('needs a running pod')
  await expect(d.getByTestId('sync-from-pod')).toHaveCount(0); await expect(d.getByTestId('sync-confirm')).toHaveCount(0)
  await expect(target(d, 'ss:volume:vol2').getByTestId('sync-target-counts')).toBeVisible()   // the volume over S3 to This PC
  await expect(item(d, 'volume', 'vol2').getByTestId('sync-to-reason')).toHaveText('This is the source')
})

test('with pods running on the volume the pod option is enabled, lists the running pods with SSH only, and the first is the default', async ({ page, api }) => {
  api.state.pods.push({ id: 'pod-dddddddd', name: 'ComfyUI-Two', status: 'running', datacenter: 'EU-RO-1', gpu: 'RTX 4090', vram: 24, ssh_command: 'ssh root@pod-d.proxy.runpod.io' })
  api.state.pods.push({ id: 'pod-eeeeeeee', name: 'ComfyUI-NoSsh', status: 'running', datacenter: 'EU-RO-1', gpu: 'RTX 4090', vram: 24 })
  api.state.volumes.vol1.pods.push({ id: 'pod-dddddddd', name: 'ComfyUI-Two', status: 'running', via: 'runpod' }, { id: 'pod-eeeeeeee', name: 'ComfyUI-NoSsh', status: 'running', via: 'runpod' })
  const d = await openSync(page, api)
  await expect(d.getByTestId('sync-from')).toHaveValue('pod')
  await expect(d.locator('[data-testid="sync-from-option"][data-kind="pod"]')).toBeEnabled()
  await expect(d.getByTestId('sync-from-pod-reason')).toHaveCount(0)
  expect(await d.getByTestId('sync-from-pod-option').allInnerTexts()).toEqual(['ComfyUI-Dev', 'ComfyUI-Two'])   // not the starting pod, not the one without SSH
  await expect(d.getByTestId('sync-from-pod')).toHaveValue('pod-aaaaaaaa')
  await d.getByTestId('sync-from-pod').selectOption('pod-dddddddd')
  await expect(d.getByTestId('sync-plan-counts')).toContainText('files')
  await d.getByTestId('sync-from').selectOption('volume:vol1')   // the S3 way: a download, no pod
  await expect(d.getByTestId('sync-confirm')).toHaveCount(0)
})

test('the Sync button on a volume row is icon-only: no label, an aria-label and a title', async ({ page, api }) => {
  await page.goto('/'); await page.getByTestId('open-shared').click().catch(() => undefined)
  const d = await openSync(page, api, {}, 'vol2')
  await page.keyboard.press('Escape')
  const btn = page.locator('[data-testid="volume-sync-btn"]').first()
  await expect(btn).toBeVisible(); await expect(btn).toHaveText(''); await expect(btn).toHaveAttribute('aria-label', 'Sync'); await expect(btn).toHaveAttribute('title', /.+/)
})
