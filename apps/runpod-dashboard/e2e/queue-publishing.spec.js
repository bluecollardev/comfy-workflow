import { test, expect, podCard, queueTab } from './fixtures'

// The Queue's Publishing section (docs/ADR-051 section 9, v1.6.2): manual publishes and backfill uploads as jobs of the app. The core is faked (state.publish.jobs).
const GB = 1e9
const CONFIGURED = { s3: { bucket: 'beinghuman-deliveries', prefix: 'returns/BKK/', region: 'eu-west-1', endpoint: '', credentials: 'app', access_key_hint: '••••1234', presign_hours: 72 }, slack: { workspace_name: 'Beinghuman', workspace_url: 'https://beinghuman-hq.slack.com', channel: '#deliveries', username: 'RunPod Manager', webhook_hint: '••••9f2k' }, defaults: { targets: ['s3', 'slack'], message: '{shot}' } }
const TREE = { '': [{ name: 'deliver', path: 'deliver', dir: true }], deliver: [{ name: 'a.mov', path: 'deliver/a.mov', dir: false, bytes: GB }] }
const job = (o = {}) => ({ job_id: 'pub-1', state: 'uploading', targets: ['s3', 'slack'], approved_by: 'Brynley', started_at: '2026-11-19T10:00:00Z', files_total: 4, files_done: 1, bytes_total: 4 * GB, bytes_done: GB, rate_bps: 50e6, current: 'deliver/b.mov', skipped: 0, links: [], slack: { state: 'skipped' }, summary: '', ...o })
const setup = (api, jobs = [], o = {}) => { api.state.publish = { settings: JSON.parse(JSON.stringify(CONFIGURED)), tree: JSON.parse(JSON.stringify(TREE)), there: [], heavy: [], jobs, ...o } }
const openQueue = async (page) => { await queueTab(page, 'publishing'); const q = page.getByTestId('queue-modal'); await expect(q).toBeVisible(); return q }
const card = (q, id) => q.locator(`[data-testid="publishing-job"][data-job="${id}"]`)

test.describe('Queue > Publishing', () => {
  test('empty: the section says nothing was published yet; no badge', async ({ page, api }) => {
    setup(api)
    await page.goto('/')
    await expect(page.getByTestId('queue-badge')).toHaveCount(0)
    const q = await openQueue(page)
    await expect(q.getByTestId('queue-publishing')).toBeVisible(); await expect(q.getByTestId('publishing-none')).toHaveText('No publishes yet.')
  })
  test('a running manual publish: title, targets, approver, phases, progress with percent and numbers, current file, skipped; Cancel sends the job id; the badge counts it', async ({ page, api }) => {
    setup(api, [job({ skipped: 2 })])
    await page.goto('/')
    await expect(page.getByTestId('queue-badge')).toHaveText('1')
    const q = await openQueue(page)
    const c = card(q, 'pub-1')
    await expect(c.getByTestId('publishing-job-title')).toHaveText('Publish: 4 files · returns/BKK/')
    await expect(c.getByTestId('publishing-job-target')).toHaveText(['S3', 'Slack']); await expect(c.getByTestId('publishing-job-approver')).toHaveText('approved by Brynley')
    await expect(c.locator('[data-testid="publishing-phase"][data-phase="uploading"]')).toHaveAttribute('data-active', 'true')
    await expect(c.locator('[data-testid="publishing-phase"][data-phase="posting"]')).toHaveAttribute('data-active', 'false')
    await expect(c.getByTestId('publish-progress')).toHaveAttribute('data-percent', '25')
    await expect(c.getByTestId('publish-job-numbers')).toContainText('1 of 4'); await expect(c.getByTestId('publish-job-current')).toHaveText('deliver/b.mov')
    await expect(c.getByTestId('publishing-job-skipped')).toHaveText('2 already there, skipped')
    await expect(c.getByTestId('publishing-job-dismiss')).toHaveCount(0)   // only finished ones are dismissed
    api.state.publish.jobs[0].state = 'posting'; api.state.publish.jobs[0].bytes_done = 4 * GB
    await expect(c.locator('[data-testid="publishing-phase"][data-phase="posting"]')).toHaveAttribute('data-active', 'true', { timeout: 5000 })
    await expect(c.getByTestId('publish-progress')).toHaveAttribute('data-percent', '100')
    await c.getByTestId('publish-cancel').click()
    await expect.poll(() => api.state.publish.cancelled).toEqual(['pub-1'])
    await expect(c).toHaveAttribute('data-state', 'cancelled', { timeout: 5000 })
    await expect(page.getByTestId('queue-badge')).toHaveCount(0)
  })
  test('a publish started in the Publish window shows in a Queue opened later and survives closing the Publish window (nothing is cancelled)', async ({ page, api }) => {
    setup(api)
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); await page.getByTestId('pod-outputs-publish').click()
    const m = page.getByTestId('publish-modal')
    await m.getByTestId('publish-source-local').click(); await m.getByTestId('publish-quick-deliver').click()
    await m.locator('[data-testid="publish-entry-check"][data-path="deliver/a.mov"]').check(); await m.getByTestId('publish-approved-by').fill('Kyle'); await m.getByTestId('publish-run').click()
    await expect(m.getByTestId('publish-job')).toBeVisible()
    await m.locator('.btn-close').click(); await expect(page.getByTestId('publish-modal')).toBeHidden()
    await page.getByTestId('pod-outputs-modal').locator('.btn-close').click()
    const q = await openQueue(page)
    await expect(card(q, 'pub-1')).toBeVisible(); await expect(card(q, 'pub-1').getByTestId('publishing-job-approver')).toHaveText('approved by Kyle')
    await expect(card(q, 'pub-1')).toHaveAttribute('data-state', 'uploading')
    expect(api.state.publish.cancelled).toEqual([])
    expect(api.state.publish.runs[0]).toMatchObject({ approved_by: 'Kyle' })
  })
  test('a backfill job appears with its own title and phase', async ({ page, api }) => {
    setup(api, [job({ job_id: 'bf-1', phase: 'streaming', files_total: 31, targets: ['s3'], approved_by: 'Kyle' })])
    await page.goto('/'); const q = await openQueue(page)
    const c = card(q, 'bf-1')
    await expect(c).toHaveAttribute('data-kind', 'backfill'); await expect(c.getByTestId('publishing-job-title')).toHaveText('Backfill: 31 files')
    await expect(c.getByTestId('publish-job-phase')).toBeVisible(); await expect(c.locator('[data-testid="publishing-phase"][data-phase="posting"]')).toHaveCount(0)   // no Slack target, no Slack phase
  })
  test('after a restart the stored job keeps no addresses: a folder still links to its console page (never a blank href), a file shows plain text with its copy icon off and says why', async ({ page, api }) => {
    setup(api, [job({ dest: 's3://bh-bucket/returns/BKK/', state: 'done', files_done: 2, bytes_done: 2 * GB, rate_bps: 0, current: '', summary: '2 files uploaded', finished_at: '2026-11-19T10:05:00Z',
      links: [{ path: 'returns/BKK/_TEST_2026-11-19/archival-084/', url: '', kind: 'folder' }, { path: 'deliver/a.mov', url: '', expires_at: '2026-11-26T10:00:00Z', kind: 'file' }] })], { linksSupport: true })
    await page.goto('/'); const q = await openQueue(page); const c = card(q, 'pub-1')
    const f = c.getByTestId('publish-link-folder'); await expect(f).toHaveText('s3://bh-bucket/returns/BKK/_TEST_2026-11-19/archival-084/')
    expect(await f.getAttribute('href')).toMatch(/^https:\/\/s3\.console\.aws\.amazon\.com\/s3\/buckets\/bh-bucket\?prefix=returns\/BKK\/_TEST_2026-11-19\/archival-084\/&region=/)
    const file = c.getByTestId('publish-link-file'); expect(await file.evaluate((e) => e.tagName)).toBe('SPAN'); await expect(c.getByTestId('publish-link-notkept')).toContainText('not kept after a restart')
    await expect(c.locator('[data-kind="file"]').getByTestId('publish-link-copy')).toBeDisabled(); await expect(c.locator('[data-kind="folder"]').getByTestId('publish-link-copy')).toBeEnabled()
  })
  test('a finished job: summary, warnings in amber, the links grouped (a folder shows its full s3 path), the approver; Dismiss removes it and stays removed', async ({ page, api }) => {
    setup(api, [job({ dest: 's3://bh-bucket/returns/BKK/', state: 'done_with_warning', files_done: 4, bytes_done: 4 * GB, rate_bps: 0, current: '', summary: '4 files uploaded, Slack posted', warnings: ['No preview frame: ffmpeg is not installed'], slack: { state: 'sent' }, finished_at: '2026-11-19T10:05:00Z',
      links: [{ path: 'returns/BKK/', url: 'https://console.aws.amazon.com/s3/x', kind: 'folder' }, { path: 'deliver/a.mov', url: 'https://s3.example/a?sig=1', expires_at: '2026-11-26T10:00:00Z', kind: 'file' }, { path: 'deliver/a_preview.jpg', url: 'https://s3.example/p?sig=1', expires_at: '2026-11-26T10:00:00Z', kind: 'preview' }] })],
      { linksSupport: true })
    await page.goto('/'); const q = await openQueue(page)
    const c = card(q, 'pub-1')
    await expect(c.getByTestId('publish-job-summary')).toHaveText('4 files uploaded, Slack posted')
    await expect(c.getByTestId('publish-job-warning')).toHaveText('No preview frame: ffmpeg is not installed'); await expect(c.getByTestId('publish-job-warning')).toHaveClass(/text-warning/)
    await expect(c.getByTestId('publish-links-folder')).toBeVisible(); await expect(c.getByTestId('publish-links-file')).toBeVisible(); await expect(c.getByTestId('publish-links-preview')).toBeVisible()
    await expect(c.locator('[data-testid="publish-link"][data-kind="file"]').getByTestId('publish-link-copy')).toBeVisible()
    const folder = c.getByTestId('publish-link-folder'); await expect(folder).toHaveText(/^s3:\/\/[^/]+\/returns\/BKK\/$/); await expect(folder).toHaveAttribute('href', 'https://console.aws.amazon.com/s3/x')   // the full s3 path, a link to the folder
    const file = c.locator('[data-testid="publish-link"][data-kind="file"]').first().getByTestId('publish-link-file'); await expect(file).toHaveText('deliver/a.mov'); await expect(file).toHaveAttribute('href', 'https://s3.example/a?sig=1'); await expect(file).toHaveAttribute('download', '')   // a real link: clicking it downloads the file
    await expect(c.getByTestId('publishing-job-approver')).toHaveText('approved by Brynley')
    await expect(page.getByTestId('queue-badge')).toHaveCount(0)   // finished: not counted
    await c.getByTestId('publishing-job-dismiss').click()
    await expect(c).toHaveCount(0); await expect(q.getByTestId('publishing-none')).toBeVisible()
    expect(api.state.publish.cancelled).toEqual([])   // local only
    await page.reload(); const q2 = await openQueue(page)
    await expect(card(q2, 'pub-1')).toHaveCount(0)
  })
  test('Slack failed: the error and Re-post, which sends the job id', async ({ page, api }) => {
    setup(api, [job({ state: 'done', files_done: 4, bytes_done: 4 * GB, slack: { state: 'failed', error: 'channel_not_found' } })])
    await page.goto('/'); const q = await openQueue(page)
    const c = card(q, 'pub-1')
    await expect(c.getByTestId('publish-slack-state')).toHaveAttribute('data-state', 'failed')
    await c.getByTestId('publish-slack-repost').click()
    await expect.poll(() => api.state.publish.reposts).toEqual(['pub-1'])
    await expect(c.getByTestId('publish-slack-state')).toHaveAttribute('data-state', 'sent')
  })
  test('running first, then the last 20 finished; the badge counts queued, uploading and posting ones on top of the rest', async ({ page, api }) => {
    const fin = Array.from({ length: 22 }, (_, i) => job({ job_id: `old-${String(i).padStart(2, '0')}`, state: 'done', started_at: `2026-11-18T10:${String(i).padStart(2, '0')}:00Z`, files_done: 4 }))
    setup(api, [...fin, job({ job_id: 'run-a', state: 'queued', started_at: '2026-11-19T09:00:00Z' }), job({ job_id: 'run-b', state: 'posting', started_at: '2026-11-19T09:30:00Z' })])
    await page.goto('/')
    await expect(page.getByTestId('queue-badge')).toHaveText('2')
    const q = await openQueue(page)
    await expect(q.getByTestId('publishing-job')).toHaveCount(22)   // 2 running + the last 20
    await expect(q.getByTestId('publishing-job').first()).toHaveAttribute('data-job', 'run-b'); await expect(q.getByTestId('publishing-job').nth(1)).toHaveAttribute('data-job', 'run-a')
    await expect(card(q, 'old-21')).toBeVisible(); await expect(card(q, 'old-01')).toHaveCount(0)
  })
  test('Auto-publish jobs (trigger auto-publish) are counted on the badge but not listed here; scans are neither', async ({ page, api }) => {
    setup(api, [job({ job_id: 'auto-1', trigger: 'auto-publish' }), job({ job_id: 'scan-9', kind: 'scan' }), job({ job_id: 'pub-2' })])
    await page.goto('/')
    await expect(page.getByTestId('queue-badge')).toHaveText('2')
    const q = await openQueue(page)
    await expect(q.getByTestId('publishing-job')).toHaveCount(1); await expect(card(q, 'pub-2')).toBeVisible(); await expect(card(q, 'auto-1')).toHaveCount(0)
  })
  test('Open Publish window opens the Publish window', async ({ page, api }) => {
    setup(api, [job({ state: 'done', files_done: 4 })])
    await page.goto('/'); const q = await openQueue(page)
    await card(q, 'pub-1').getByTestId('publishing-job-open').click()
    await expect(page.getByTestId('publish-modal')).toBeVisible()
  })
  test('polls fast while the Queue is open: a job that finishes in the core updates the card within a few seconds', async ({ page, api }) => {
    setup(api, [job()])
    await page.goto('/'); const q = await openQueue(page)
    api.state.publish.jobs[0].state = 'done'; api.state.publish.jobs[0].files_done = 4; api.state.publish.jobs[0].bytes_done = 4 * GB
    await expect(card(q, 'pub-1')).toHaveAttribute('data-state', 'done', { timeout: 4000 })
  })
  test('an older core without Publishing hides the section', async ({ page, api }) => {
    api.state.publishOld = true
    await page.goto('/'); const q = await openQueue(page)
    await expect(q.getByTestId('queue-publishing')).toHaveCount(0); await expect(page.getByTestId('queue-badge')).toHaveCount(0)
  })
})
