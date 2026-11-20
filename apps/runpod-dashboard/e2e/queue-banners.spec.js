import { test, expect } from './fixtures'

// The two banners under the nav bar for the Queue: 'Loading the queue…' while its data loads (slow text after 5 s, an error with Retry) and 'Auto-publish: …' on every screen while Auto-publish is busy.
const on = (api, o = {}) => { api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' }, ...o } }
const due = (m) => new Date(Date.now() + m * 60000 + 41000).toISOString()
const W = (o = {}) => ({ root: '/x', root_exists: true, reviews: 0, approved: 0, eligible: 0, queued: 0, uploaded_today: 0, skipped: [], summary: '', ...o })
const GEN = (o = {}) => ({ enabled: true, where: 'local', generating: 0, generated_today: 0, max_per_day: 20, waiting_to_settle: [], failed: [], ...o })

test.describe('Loading the queue', () => {
  test('a slow Queue shows the banner with a spinner, the slow text after 5 seconds, and goes away when it has loaded', async ({ page, api }) => {
    await page.clock.install(); api.state.queueDelayMs = 8000
    await page.goto('/'); await page.getByTestId('open-queue').click()
    const b = page.getByTestId('queue-loading-banner'); await expect(b).toBeVisible(); await expect(b.getByTestId('queue-loading-text')).toHaveText('Loading the queue…')
    await page.clock.fastForward(6000); await expect(b.getByTestId('queue-loading-text')).toHaveText('Still loading the queue (the RunPod volume is slow to answer)…')
    api.state.queueDelayMs = 0; await page.clock.fastForward(20000)
    await expect(b).toHaveCount(0, { timeout: 10000 })
  })
  test('a failed fetch says why with Retry, which asks again; nothing shows while the Queue is closed', async ({ page, api }) => {
    api.state.queueFail = 'The queue service is down'
    await page.goto('/'); await expect(page.getByTestId('queue-loading-banner')).toHaveCount(0)
    await page.getByTestId('open-queue').click()
    const b = page.getByTestId('queue-loading-banner'); await expect(b.getByTestId('queue-loading-text')).toContainText('The queue could not load: '); await expect(b).toHaveAttribute('data-state', 'error')
    api.state.queueFail = ''; await b.getByTestId('queue-loading-retry').click(); await expect(b).toHaveCount(0, { timeout: 8000 })
  })
  test('a fast Queue never shows it for long; the volume scan keeps it up', async ({ page, api }) => {
    on(api); api.state.autopublish = { watching: { ...W(), local: { enabled: true, root: '/x', root_exists: true, reviews: 0 }, volume: { enabled: true, id: 'v', reviews: 0, scanning: true } } }
    await page.goto('/'); await page.getByTestId('open-queue').click(); await expect(page.getByTestId('queue-loading-banner')).toBeVisible()
    api.state.autopublish.watching.volume.scanning = false; await expect(page.getByTestId('queue-loading-banner')).toHaveCount(0, { timeout: 8000 })
  })
})

test.describe('Auto-publish is working', () => {
  const states = [
    ['uploading', { pending: [{ id: 'u', shot: 'archival-085', version: 2, state: 'uploading', due_at: due(0) }] }, /Auto-publish: uploading archival-085 to S3/],
    ['generating', { generate: GEN({ generating: 2, pod: { name: 'ComfyUI-Dev', state: 'running', case: 'running' }, current: 'CGI-042_A' }) }, /Auto-publish: generating 2 review\(s\) on ComfyUI-Dev… · CGI-042_A/],
    ['window', { pending: [{ id: 'w', shot: 'cgi-042', version: 1, state: 'waiting', due_at: due(9) }] }, /Auto-publish: 1 review\(s\) will upload in 9:/],
    ['settling', { generate: GEN({ waiting_to_settle: [{ stem: 'A' }, { stem: 'B' }, { stem: 'C' }] }) }, /Auto-publish: 3 sequences waiting for frames to settle/],
    ['scanning', { watching: { ...W(), local: { enabled: true, reviews: 0 }, volume: { enabled: true, reviews: 0, scanning: true } } }, /Auto-publish: scanning the RunPod volume for reviews…/],
  ]
  for (const [name, st, re] of states) {
    test(`${name}: one line on any screen, and it opens the Queue's Auto-publish section`, async ({ page, api }) => {
      on(api); api.state.autopublish = st
      await page.goto('/'); const b = page.getByTestId('autopublish-working-banner')
      await expect(b).toBeVisible(); await expect(b.getByTestId('autopublish-working-text')).toHaveText(re); await expect(b).toHaveAttribute('data-state', name)
      await b.getByTestId('autopublish-working-open').click(); await expect(page.getByTestId('queue-modal')).toBeVisible(); await expect(page.getByTestId('queue-autopublish')).toBeVisible()
    })
  }
  test('several states: the most important first, the others as a count; an upload shows its percent and a posting says so', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [{ id: 'u', shot: 'archival-085', version: 2, state: 'uploading', due_at: due(0) }, { id: 'w', shot: 'x', version: 1, state: 'waiting', due_at: due(9) }], generate: GEN({ generating: 1, waiting_to_settle: [{ stem: 'A' }] }) }
    api.state.publish = { settings: { s3: { bucket: 'b', prefix: 'p/', region: 'r', credentials: 'app', access_key_hint: '1' }, slack: {}, defaults: { targets: [], message: '' } }, tree: {}, there: [], heavy: [], jobs: [{ job_id: 'a1', trigger: 'auto-publish', state: 'uploading', shot: 'archival-085', bytes_total: 100, bytes_done: 41, files_total: 1, files_done: 0, targets: ['s3'], links: [] }] }
    await page.goto('/'); const b = page.getByTestId('autopublish-working-banner')
    await expect(b.getByTestId('autopublish-working-text')).toHaveText('Auto-publish: uploading archival-085 to S3 · 41%', { timeout: 8000 }); await expect(b.getByTestId('autopublish-working-more')).toHaveText('+3 more')
    api.state.publish.jobs[0].state = 'posting'; await expect(b.getByTestId('autopublish-working-text')).toHaveText('Auto-publish: posting to Slack', { timeout: 8000 })
  })
  test('hidden when Auto-publish is idle, off, or an older core', async ({ page, api }) => {
    on(api); api.state.autopublish = { watching: W(), generate: GEN() }
    await page.goto('/'); await page.waitForTimeout(1200); await expect(page.getByTestId('autopublish-working-banner')).toHaveCount(0)
    on(api, { enabled: false }); api.state.autopublish = { pending: [{ id: 'w', shot: 'x', version: 1, state: 'waiting', due_at: due(9) }] }; await page.reload(); await page.waitForTimeout(1200); await expect(page.getByTestId('autopublish-working-banner')).toHaveCount(0)
    api.state.noAutoPublish = true; await page.reload(); await page.waitForTimeout(800); await expect(page.getByTestId('autopublish-working-banner')).toHaveCount(0)
  })
})

test('a spinner never touches its text: the loading banner and the working banner keep a gap', async ({ page, api }) => {
  api.state.queueDelayMs = 4000
  await page.goto('/'); await page.getByTestId('open-queue').click()
  const sp = page.getByTestId('queue-loading-spinner'), tx = page.getByTestId('queue-loading-text')
  await expect(sp).toBeVisible(); const a = await sp.boundingBox(), b = await tx.boundingBox()
  expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(4.5)   // about 0.5rem; the spinner is animated and its box is sub-pixel, so allow half a pixel (it measured 4.977 under load)
  const box = await page.getByTestId('queue-loading-banner').boundingBox(); expect(a.x - box.x).toBeGreaterThanOrEqual(11)   // the banner's own padding: the spinner does not touch its edge
})
