import { test, expect } from './fixtures'

// The Queue's tabs: one source of truth for the active tab (no 'Maximum recursive updates'), every tab opens, the deep links land on their tab, the last tab is remembered, an old 'autopublish' value maps to Publishing.
const TABS = ['overview', 'imports', 'syncs', 'generations', 'publishing']
const watchConsole = (page) => { const bad = []; page.on('console', (m) => { if (/Maximum recursive|Unhandled|errorHandler/i.test(m.text()) || (m.type() === 'error' && !/Failed to load resource|favicon|net::/.test(m.text()))) bad.push(m.text()) }); page.on('pageerror', (e) => bad.push(String(e))); return bad }

test.describe('Queue tabs', () => {
  test('opening the Queue and switching through every tab raises no console error (no recursive updates), and each tab shows its pane', async ({ page, api }) => {
    const bad = watchConsole(page)
    api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' } }
    api.state.autopublish = { pending: [{ id: 'w', shot: 'x', version: 1, state: 'waiting', due_at: new Date(Date.now() + 600000).toISOString() }] }
    await page.goto('/'); await page.waitForTimeout(500)
    await page.getByTestId('open-queue').click(); await expect(page.getByTestId('queue-tab-overview')).toHaveAttribute('aria-selected', 'true')
    for (const t of [...TABS, 'overview', 'publishing', 'generations']) { await page.getByTestId(`queue-tab-${t}`).click(); await expect(page.getByTestId(`queue-tab-${t}`)).toHaveAttribute('aria-selected', 'true'); await page.waitForTimeout(120) }
    await expect(page.getByTestId('queue-tab-autopublish')).toHaveCount(0)   // Auto-publish is a section of Publishing
    expect(bad).toEqual([])
  })
  test('the banner\'s Open the Queue lands on Publishing at the Auto-publish section; the last tab is remembered; an old autopublish value maps to Publishing', async ({ page, api }) => {
    const bad = watchConsole(page)
    api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' } }
    api.state.autopublish = { pending: [{ id: 'w', shot: 'x', version: 1, state: 'waiting', due_at: new Date(Date.now() + 600000).toISOString() }] }
    await page.goto('/'); await page.getByTestId('autopublish-working-open').click()
    await expect(page.getByTestId('queue-tab-publishing')).toHaveAttribute('aria-selected', 'true'); await expect(page.getByTestId('queue-autopublish')).toBeVisible()
    await page.getByTestId('queue-modal').locator('.btn-close').click(); await page.getByTestId('open-queue').click(); await expect(page.getByTestId('queue-tab-overview')).toHaveAttribute('aria-selected', 'true')   // the nav button opens the Overview
    await page.getByTestId('queue-tab-syncs').click(); await page.reload()
    await page.evaluate(() => localStorage.setItem('runpod-manager.queue-tab', 'autopublish')); await page.reload()
    await page.getByTestId('autopublish-working-open').click(); await expect(page.getByTestId('queue-tab-publishing')).toHaveAttribute('aria-selected', 'true')
    expect(bad).toEqual([])
  })
})

test('every tab heading shows its working count, always: muted at 0, highlighted above 0', async ({ page, api }) => {
  api.state.renders = { jobs: [{ job_id: 'job-1', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', kind: 'review', state: 'rendering', started_at: '2026-11-19T10:00:00Z', finished_at: null, frames_done: 1, frames_total: 5, rate_fps: 1, current: '', pulled_files: 0, pulled_bytes: 0, error: '', summary: '', sequences: [] }] }
  api.state.publish = { settings: { s3: { bucket: 'b', prefix: 'p/', region: 'r', credentials: 'app', access_key_hint: '1' }, slack: {}, defaults: { targets: [], message: '' } }, tree: {}, there: [], heavy: [], jobs: [{ job_id: 'p1', state: 'uploading', targets: ['s3'], approved_by: 'B', started_at: '2026-11-19T10:00:00Z', files_total: 3, files_done: 1, bytes_total: 3e9, bytes_done: 1e9, rate_bps: 1, current: '', skipped: 0, links: [], slack: { state: 'skipped' }, summary: '' }, { job_id: 'p2', state: 'queued', targets: ['s3'], approved_by: 'B', started_at: '2026-11-19T10:01:00Z', files_total: 1, files_done: 0, bytes_total: 1e9, bytes_done: 0, rate_bps: 0, current: '', skipped: 0, links: [], slack: { state: 'skipped' }, summary: '' }, { job_id: 'p3', state: 'done', targets: ['s3'], approved_by: 'B', started_at: '2026-11-19T09:00:00Z', files_total: 1, files_done: 1, bytes_total: 1, bytes_done: 1, rate_bps: 0, current: '', skipped: 0, links: [], slack: { state: 'skipped' }, summary: '' }], runs: [], puts: [], tests: [], planned: [], reposts: [], cancelled: [] }
  await page.goto('/'); await page.getByTestId('open-queue').click()
  const c = (t) => page.getByTestId(`queue-tab-${t}-count`)
  await expect(c('generations')).toHaveText('1', { timeout: 8000 }); await expect(c('generations')).toHaveAttribute('data-active', 'true'); await expect(c('publishing')).toHaveText('2'); await expect(c('overview')).toHaveText('3')   // finished ones are not in the heading
  await expect(c('imports')).toHaveText('0'); await expect(c('imports')).toHaveAttribute('data-active', 'false'); await expect(c('imports')).toHaveClass(/text-bg-secondary/); await expect(c('syncs')).toHaveText('0')
})

test('Auto-publish entries in any non-final state count on the Publishing tab and the Overview, a dry run in a muted pill with its tooltip', async ({ page, api }) => {
  api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: true, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' } }
  api.state.autopublish = { pending: [{ id: 'd1', shot: 'archival-084', version: 3, files: 5, bytes: 58.4e6, state: 'would_upload', targets: ['s3', 'slack'], due_at: new Date(Date.now() + 600000).toISOString() }] }
  await page.goto('/'); await page.getByTestId('open-queue').click()
  const pub = page.getByTestId('queue-tab-publishing-count')
  await expect(pub).toHaveText('1', { timeout: 8000 }); await expect(pub).toHaveClass(/text-bg-secondary/); await expect(pub).toHaveAttribute('title', '1 would upload (dry run)'); await expect(page.getByTestId('queue-tab-overview-count')).toHaveText('1')
  await expect(page.getByTestId('queue-working-row')).toHaveCount(1); await expect(page.getByTestId('queue-working-state')).toHaveText('would upload (dry run)')
  api.state.autopublish.pending.push({ id: 'c1', shot: 'x', version: 1, state: 'capped', due_at: new Date(Date.now() + 600000).toISOString() }, { id: 'u1', shot: 'y', version: 1, state: 'uploading', due_at: new Date(Date.now() + 600000).toISOString() })
  await expect(pub).toHaveText('3', { timeout: 8000 }); await expect(pub).toHaveClass(/text-bg-danger/)
})

test('the tab count pills are the nav badge: the same colours above 0, and a legible pill at 0 (contrast of at least 4.5)', async ({ page, api }) => {
  api.state.renders = { jobs: [{ job_id: 'job-1', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', kind: 'review', state: 'rendering', started_at: '2026-11-19T10:00:00Z', finished_at: null, frames_done: 1, frames_total: 5, rate_fps: 1, current: '', pulled_files: 0, pulled_bytes: 0, error: '', summary: '', sequences: [] }] }
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme }); await page.goto('/'); await page.getByTestId('open-queue').click()
    const nav = page.getByTestId('queue-badge'), tab = page.getByTestId('queue-tab-generations-count'), zero = page.getByTestId('queue-tab-imports-count')
    await expect(tab).toHaveText('1', { timeout: 8000 })
    const css = (l) => l.evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, fg: c.color } })
    expect(await css(tab)).toEqual(await css(nav))   // the nav badge's own colours
    const z = await zero.evaluate((e) => { const c = getComputedStyle(e); const p = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number); const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }; const a = lum(p(c.color)), b = lum(p(c.backgroundColor)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) })
    expect(z).toBeGreaterThanOrEqual(4.5)
    await page.getByTestId('queue-modal').locator('.btn-close').click()
  }
})
