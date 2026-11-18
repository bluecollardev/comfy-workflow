import { test, expect, modal, cfgTab, podCard } from './fixtures'
import { formatBytes } from '../src/sync-progress'
import { t } from './i18n'

// Symlinks and mounted volumes (v1.5.1): the folder picker's Volumes section, link entries, the logical path with its real target, the macOS permission hint; the Sync window's Leave out links and symlink warnings.
const GB = 1e9, TB = 1e12
const VOLS = [
  { name: 'Macintosh HD', path: '/Volumes/Macintosh HD', link: true, target: '/', size_bytes: 1 * TB, free_bytes: 300 * GB, readable: true },
  { name: 'Work', path: '/Volumes/Work', link: false, size_bytes: 2 * TB, free_bytes: 412 * GB, readable: true },
  { name: 'Archive', path: '/Volumes/Archive', link: false, size_bytes: 4 * TB, free_bytes: 0, readable: false, reason: 'Not mounted for this user' },
]

/** The folder picker, opened from the project row's Browse in the Default Configuration (the same picker ConfigModal and the Import pane embed). */
async function openPicker(page, api, setup) {
  api.state.fs['/Users/lucas'] = ['ComfyUI-Shared', 'Projects', 'Linked']; api.state.fs['/Volumes/Work'] = ['CANALV2', 'scripts']; api.state.fs['/Volumes'] = ['Work', 'Archive']; api.state.fs['/Users/lucas/Linked'] = ['inside']
  setup?.(api.state)
  await page.goto('/')
  await page.getByTestId('open-config').click()
  const d = modal(page, t('config.title')); await cfgTab(d, 'folders')
  await d.locator('[data-testid="folder-row-project"] [data-testid="folder-browse"]').click()
  return picker(page)
}
const picker = (page) => page.locator('.modal.show', { hasText: 'Use this folder' })

test.describe('the folder picker', () => {
  test('a Volumes section lists the mounted volumes with free space, an unreadable tag with its reason, and the boot link last, greyed', async ({ page, api }) => {
    await openPicker(page, api, (s) => { s.volumes = VOLS })
    const v = picker(page).getByTestId('folder-volumes')
    await expect(v.getByTestId('folder-volume')).toHaveCount(3)
    expect(await v.getByTestId('folder-volume').evaluateAll((els) => els.map((e) => e.dataset.path))).toEqual(['/Volumes/Work', '/Volumes/Archive', '/Volumes/Macintosh HD'])   // the link last
    const work = v.locator('[data-testid="folder-volume"][data-path="/Volumes/Work"]')
    await expect(work.getByTestId('folder-volume-free')).toHaveText(`${formatBytes(412 * GB)} free of ${formatBytes(2 * TB)}`)
    const arch = v.locator('[data-testid="folder-volume"][data-path="/Volumes/Archive"]')
    await expect(arch.getByTestId('folder-volume-unreadable')).toHaveText('unreadable: Not mounted for this user'); await expect(arch).toBeDisabled(); await expect(arch.getByTestId('folder-volume-free')).toHaveCount(0)
    const boot = v.locator('[data-testid="folder-volume"][data-path="/Volumes/Macintosh HD"]')
    await expect(boot.getByTestId('folder-volume-link')).toHaveText('link'); await expect(boot).toHaveClass(/text-body-secondary/); await expect(boot).toHaveAttribute('title', 'link to /')
  })
  test('clicking a volume goes there, and the breadcrumb behaviours (Up, typed path) still work', async ({ page, api }) => {
    await openPicker(page, api, (s) => { s.volumes = VOLS })
    const p = picker(page)
    await p.locator('[data-testid="folder-volume"][data-path="/Volumes/Work"]').click()
    await expect(p.getByTestId('picker-path')).toHaveValue('/Volumes/Work')
    await expect(p.getByTestId('picker-item')).toHaveText([/CANALV2/, /scripts/])
    await p.getByTestId('picker-up').click()
    await expect(p.getByTestId('picker-path')).toHaveValue('/Volumes')
    await p.getByTestId('picker-path').fill('/Users/lucas'); await p.getByTestId('picker-path').press('Enter')
    await expect(p.getByTestId('picker-item')).toHaveText([/ComfyUI-Shared/, /Projects/, /Linked/])
  })
  test('an older core (no volumes call) hides the section quietly; an empty list too', async ({ page, api }) => {
    await openPicker(page, api, (s) => { s.volumesOld = true })
    await expect(picker(page).getByTestId('folder-volumes')).toHaveCount(0)
    await expect(picker(page).getByTestId('picker-item').first()).toBeVisible()   // the picker itself works
  })
  test('an entry that is a link shows the link tag with its target as the tooltip', async ({ page, api }) => {
    await openPicker(page, api, (s) => { s.fsLinks = { '/Users/lucas': { Projects: '/Volumes/Work/Projects' } } })
    const link = picker(page).locator('[data-testid="picker-item"][data-name="Projects"] [data-testid="folder-link"]')
    await expect(link).toContainText('link'); await expect(link).toHaveAttribute('title', '/Volumes/Work/Projects')
    await expect(picker(page).locator('[data-testid="picker-item"][data-name="ComfyUI-Shared"] [data-testid="folder-link"]')).toHaveCount(0)
  })
  test('a logical path that is a link says "link to <real>" and Up returns to where you came from (the logical parent)', async ({ page, api }) => {
    await openPicker(page, api, (s) => { s.fsReal = { '/Users/lucas/Linked': '/Volumes/Work/real-place' } })
    const p = picker(page)
    await p.locator('[data-testid="picker-item"][data-name="Linked"]').dblclick()
    await expect(p.getByTestId('picker-path')).toHaveValue('/Users/lucas/Linked')   // the logical path stays
    await expect(p.getByTestId('folder-real')).toHaveText('link to /Volumes/Work/real-place')
    await p.getByTestId('picker-up').click()
    await expect(p.getByTestId('picker-path')).toHaveValue('/Users/lucas')
    await expect(p.getByTestId('folder-real')).toHaveCount(0)
  })
  test('an unreadable folder shows the macOS hint prominently, not a bare error', async ({ page, api }) => {
    await openPicker(page, api, (s) => { s.fsPermission = ['/Users/lucas/Projects'] })
    const p = picker(page)
    await p.locator('[data-testid="picker-item"][data-name="Projects"]').dblclick()
    const a = p.getByTestId('folder-permission-hint')
    await expect(a).toContainText('This folder cannot be read'); await expect(a).toContainText('The app is not allowed to read /Users/lucas/Projects.')
    await expect(p.getByTestId('folder-permission-hint-text')).toHaveText('macOS blocked access: allow RunPod Manager under System Settings > Privacy & Security > Files and Folders.')
    await expect(p.locator('.alert-danger')).toHaveCount(0)
  })
  test('the permission alert falls back to where to allow it when the core sends no hint; another failure is still a plain error', async ({ page, api }) => {
    await openPicker(page, api, (s) => { s.fsPermission = ['/Users/lucas/Projects']; s.fsHint = null })
    const p = picker(page)
    await p.locator('[data-testid="picker-item"][data-name="Projects"]').dblclick()
    await expect(p.getByTestId('folder-permission-hint-text')).toContainText('System Settings > Privacy & Security')
    await p.getByTestId('picker-path').fill('/nowhere'); await p.getByTestId('picker-path').press('Enter')
    await expect(p.locator('.alert-danger')).toContainText('not a folder'); await expect(p.getByTestId('folder-permission-hint')).toHaveCount(0)
  })
})

test.describe('the Sync window: links', () => {
  async function openSync(page, { many = false } = {}) {
    await page.addInitScript((o) => {
      const listeners = []
      window.__e2eEmit = (ev) => listeners.forEach((f) => f(ev))
      window.__e2eSync = {
        plan: async () => ({ steps: [{ key: 'project', local: '/p', remote: '/workspace/project' }], transport: { kind: 'ssh', reason: 'ssh' }, shared: null }),
        count: async () => ({ pending: false, all: { total_files: 10, total_bytes: 1e9 } }),
        folders: async () => ({ steps: [{ key: 'project', local: '/p', folders: [{ name: 'CANALV2', link: true, target: '/Volumes/Work/CANALV2', note: 'a link to /Volumes/Work/CANALV2' }, { name: 'scripts' }] }] }),
        measure: async (req) => (req.name === 'CANALV2' ? { bytes: 0, link: true, target: '/Volumes/Work/CANALV2' } : { bytes: 5e9 }), measureCancel: async () => {},
        start: async (req) => { window.__started = req; return { ok: true } }, cancel: async () => ({ ok: true }), state: async () => ({ running: false, events: [] }), onEvent: (cb) => { listeners.push(cb); return () => {} },
      }
    }, { many })
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-sync').click()
    const d = page.getByTestId('sync-modal')
    await expect(d.getByTestId('sync-exclude')).toBeVisible()
    return d
  }
  const startBtn = (d) => d.locator('.modal-footer .btn-warning')
  const emit = (page, ev) => page.evaluate((e) => window.__e2eEmit(e), { id: 'pod-aaaaaaaa', ...ev })
  test('a link folder shows the link badge and note; Measure says it is copied as a link; ticking it is allowed', async ({ page }) => {
    const d = await openSync(page)
    const badge = d.locator('[data-testid="sync-exclude-link"][data-name="CANALV2"]')
    await expect(badge).toContainText('link'); await expect(badge).toHaveAttribute('title', '/Volumes/Work/CANALV2'); await expect(badge.getByTestId('sync-exclude-link-note')).toHaveText('a link to /Volumes/Work/CANALV2')
    await expect(d.locator('[data-testid="sync-exclude-link"][data-name="scripts"]')).toHaveCount(0)
    await d.locator('[data-testid="sync-measure"][data-name="CANALV2"]').click()
    await expect(d.locator('[data-testid="sync-measure-link"][data-name="CANALV2"]')).toHaveText('link to /Volumes/Work/CANALV2: copied as a link, contents not sent')
    await d.locator('[data-testid="sync-measure"][data-name="scripts"]').click()
    await expect(d.locator('[data-testid="sync-measure-size"][data-name="scripts"]')).toHaveText(formatBytes(5 * GB))
    const box = d.locator('[data-testid="sync-exclude-folder"][data-name="CANALV2"]')
    await expect(box).toBeEnabled(); await box.check(); await expect(box).toBeChecked()
    await startBtn(d).click()
    await expect.poll(() => page.evaluate(() => window.__started)).toBeTruthy()
    expect(await page.evaluate(() => window.__started.exclude)).toEqual(['/CANALV2/'])
  })
  test('symlink warnings are amber rows, not errors, and the summary counts them', async ({ page }) => {
    const d = await openSync(page)
    await startBtn(d).click()
    await expect(d.getByTestId('sync-status')).toBeVisible()
    await emit(page, { kind: 'warning', code: 'symlink', key: 'project', path: 'CANALV2', target: '/Volumes/Work/CANALV2', text: 'CANALV2 is a link to /Volumes/Work/CANALV2: copied as a link, not its contents' })
    await expect(d.getByTestId('sync-symlink')).toHaveText('CANALV2 is a link to /Volumes/Work/CANALV2: copied as a link, not its contents')
    await expect(d.getByTestId('sync-symlink')).toHaveClass(/text-warning/)
    await expect(d.getByTestId('sync-symlink-count')).toHaveText('1 link copied as a link')
    await emit(page, { kind: 'warning', code: 'symlink', key: 'project', path: 'b', target: '/x' })   // no text: the app words it
    await expect(d.getByTestId('sync-symlink').nth(1)).toHaveText('b is a link to /x: copied as a link, not its contents')
    await expect(d.getByTestId('sync-symlink-count')).toHaveText('2 links copied as links')
    await expect(d.getByTestId('sync-counts')).toContainText('0 errors')
  })
  test('many links are grouped', async ({ page }) => {
    const d = await openSync(page)
    await startBtn(d).click()
    await expect(d.getByTestId('sync-status')).toBeVisible()
    for (let i = 0; i < 5; i++) await emit(page, { kind: 'warning', code: 'symlink', key: 'project', path: `l${i}`, target: `/t${i}`, text: `l${i} -> /t${i}` })
    await expect(d.getByTestId('sync-symlink-count')).toHaveText('5 links copied as links')
    await expect(d.getByTestId('sync-symlink-group')).toBeVisible()
    await d.getByTestId('sync-symlink-group').locator('summary').click()
    await expect(d.getByTestId('sync-symlink')).toHaveCount(5)
  })
})
