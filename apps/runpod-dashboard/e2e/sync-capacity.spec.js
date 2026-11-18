import { test, expect, podCard } from './fixtures'
import { formatBytes } from '../src/sync-progress'

// The Sync window and the volume's size (v1.5.0): a push larger than the volume is refused before it copies (red alert, Start off), a nearly full volume is a note, a full volume ends the run as a banner, a skipped step shows grey.
// The page treats a present window.core as the whole app, so the sync calls are a stand-in (window.__e2eSync, src/api/sync.js) and the test emits the run's events.
const TB = 1e12, GB = 1e9
const POD = 'pod-aaaaaaaa'

async function openSync(page, count) {
  await page.addInitScript((c) => {
    const listeners = []
    window.__e2eEmit = (ev) => listeners.forEach((f) => f(ev))
    window.__e2eSync = {
      plan: async () => ({ steps: [{ key: 'project', local: '/Users/me/project', remote: '/workspace/project' }, { key: 'plates', local: '/Users/me/plates', remote: '/workspace/plates' }], transport: { kind: 'ssh', reason: 'ssh' }, shared: null }),
      count: async () => c, start: async (req) => { window.__started = req; return { ok: true } }, cancel: async () => ({ ok: true }), state: async () => ({ running: false, events: [] }),
      onEvent: (cb) => { listeners.push(cb); return () => {} },
    }
  }, count)
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-sync').click()
  const d = page.getByTestId('sync-modal')
  await expect(d.getByTestId('sync-plan-counts')).toContainText('files')
  return d
}
const startBtn = (d) => d.locator('.modal-footer .btn-warning')
const emit = (page, ev) => page.evaluate((e) => window.__e2eEmit(e), { id: POD, ...ev })

test('over capacity: a red alert with the sizes, Start off; it follows the switches; fitting shows nothing', async ({ page }) => {
  const d = await openSync(page, { pending: false, all: { total_files: 90000, total_bytes: 2.1 * TB, scanned_files: 90000, capacity_bytes: TB, free_bytes: 340 * GB, over_capacity: true }, without_renders: { total_files: 500, total_bytes: 20 * GB, scanned_files: 90000, capacity_bytes: TB, free_bytes: 340 * GB, over_capacity: false } })
  await expect(d.getByTestId('sync-over-capacity')).toHaveCount(0)   // the renders and tests are skipped by default: that push fits
  await expect(d.getByTestId('sync-low-space')).toHaveCount(0)
  await expect(startBtn(d)).toBeEnabled()
  await d.getByTestId('sync-skip-renders').uncheck(); await d.getByTestId('sync-skip-tests').uncheck()
  const alert = d.getByTestId('sync-over-capacity')
  await expect(alert).toHaveText(`This is larger than the volume: ${formatBytes(2.1 * TB)} to send, volume ${formatBytes(TB)} (about ${formatBytes(340 * GB)} free). It will be refused. Untick the project tree, or enlarge the volume.`)
  await expect(startBtn(d)).toBeDisabled()
  await d.getByTestId('sync-skip-renders').check(); await d.getByTestId('sync-skip-tests').check()
  await expect(alert).toHaveCount(0); await expect(startBtn(d)).toBeEnabled()
})

test('over capacity with an unknown free figure leaves the free part out; a pull is never blocked', async ({ page }) => {
  const d = await openSync(page, { pending: false, all: { total_files: 10, total_bytes: 2 * TB, capacity_bytes: TB, free_bytes: null, over_capacity: true } })
  await expect(d.getByTestId('sync-over-capacity')).toHaveText(`This is larger than the volume: ${formatBytes(2 * TB)} to send, volume ${formatBytes(TB)}. It will be refused. Untick the project tree, or enlarge the volume.`)
  await d.getByTestId('sync-direction').getByText('Pull').click().catch(async () => { await d.getByTestId('sync-direction').locator('label').last().click() })
  await expect(d.getByTestId('sync-over-capacity')).toHaveCount(0)
  await expect(startBtn(d)).toBeEnabled()
})

test('a push that fits shows no alert and no note', async ({ page }) => {
  const d = await openSync(page, { pending: false, all: { total_files: 10, total_bytes: 20 * GB, capacity_bytes: TB, free_bytes: 700 * GB, over_capacity: false } })
  await expect(d.getByTestId('sync-over-capacity')).toHaveCount(0); await expect(d.getByTestId('sync-low-space')).toHaveCount(0); await expect(startBtn(d)).toBeEnabled()
})

test('under 5% free after the push: an amber note, Start stays on', async ({ page }) => {
  const d = await openSync(page, { pending: false, all: { total_files: 10, total_bytes: 30 * GB, capacity_bytes: TB, free_bytes: 60 * GB, over_capacity: false } })
  await expect(d.getByTestId('sync-low-space')).toHaveText(`After this push only about ${formatBytes(30 * GB)} of the volume will be free (under 5%).`)
  await expect(d.getByTestId('sync-over-capacity')).toHaveCount(0); await expect(startBtn(d)).toBeEnabled()
})

test('a count with no capacity (an older core) changes nothing', async ({ page }) => {
  const d = await openSync(page, { pending: false, all: { total_files: 10, total_bytes: 50 * TB } })
  await expect(d.getByTestId('sync-over-capacity')).toHaveCount(0); await expect(d.getByTestId('sync-low-space')).toHaveCount(0); await expect(startBtn(d)).toBeEnabled()
})

test('a full volume ends the run as a red banner with the message as is and the steps not done, not a generic failure', async ({ page }) => {
  const d = await openSync(page, { pending: false, all: { total_files: 10, total_bytes: 20 * GB, capacity_bytes: TB, free_bytes: 700 * GB, over_capacity: false } })
  await startBtn(d).click()
  await expect(d.getByTestId('sync-status')).toBeVisible()
  const msg = 'The volume is full (Disk quota exceeded). 120 files were written. Not done: project, plates. Free space or enlarge the volume, then run again.'
  await emit(page, { kind: 'error', code: 'volume_full', text: msg, not_done: ['project', 'plates'] })
  const b = d.getByTestId('sync-volume-full')
  await expect(b).toHaveAttribute('data-code', 'volume_full')
  await expect(b.getByTestId('sync-volume-full-text')).toHaveText(msg)
  await expect(b).toContainText('The volume is full'); await expect(b.getByTestId('sync-not-done-step')).toHaveText(['project', 'plates'])
  await expect(d.getByTestId('sync-status')).toHaveText('The volume is full')   // not "failed: ..."
  await expect(d.getByTestId('sync-status')).not.toContainText('failed')
})

test('a full disk on this PC says so', async ({ page }) => {
  const d = await openSync(page, { pending: false, all: { total_files: 10, total_bytes: 20 * GB } })
  await startBtn(d).click()
  await emit(page, { kind: 'error', code: 'disk_full', text: 'This PC is out of disk space. 3 files were written. Free space, then run again.' })
  await expect(d.getByTestId('sync-volume-full')).toContainText("This PC's disk is full"); await expect(d.getByTestId('sync-volume-full-text')).toContainText('This PC is out of disk space')
})

test('another error stays a plain failure, not the full-volume banner', async ({ page }) => {
  const d = await openSync(page, { pending: false, all: { total_files: 10, total_bytes: 20 * GB } })
  await startBtn(d).click()
  await emit(page, { kind: 'error', code: 'ssh', text: 'connection reset' })
  await expect(d.getByTestId('sync-volume-full')).toHaveCount(0); await expect(d.getByTestId('sync-status')).toContainText('connection reset')
})

test('a skipped step (its local folder is missing) shows grey with the reason and is not counted as an error', async ({ page }) => {
  const d = await openSync(page, { pending: false, all: { total_files: 10, total_bytes: 20 * GB } })
  await startBtn(d).click()
  await expect(d.getByTestId('sync-status')).toBeVisible()
  await emit(page, { kind: 'warning', code: 'skipped', key: 'plates', reason: '/Users/me/plates is missing on this PC', text: 'plates: skipped, /Users/me/plates is missing on this PC' })
  const s = d.getByTestId('sync-step-skipped')
  await expect(s).toHaveText('plates: skipped (/Users/me/plates is missing on this PC)'); await expect(s).toHaveClass(/text-body-secondary/)
  await expect(d.getByTestId('sync-counts')).toContainText('0 errors')
  await expect(d.getByTestId('sync-output')).toContainText('plates: skipped')
})
