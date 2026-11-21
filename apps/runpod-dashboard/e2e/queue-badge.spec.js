import { test, expect } from './fixtures'

// The nav Queue badge counts everything active, polls with the Queue closed, and lists the breakdown in its tooltip.
const GB = 1e9
const on = (api) => { api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' } } }
const rjob = (o = {}) => ({ job_id: 'job-1', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', kind: 'review', state: 'rendering', started_at: '2026-11-19T10:00:00Z', finished_at: null, frames_done: 2, frames_total: 10, rate_fps: 1, current: '', pulled_files: 0, pulled_bytes: 0, error: '', summary: '', sequences: [], ...o })
const pjob = (o = {}) => ({ job_id: 'pub-1', state: 'uploading', targets: ['s3'], approved_by: 'B', started_at: '2026-11-19T10:00:00Z', files_total: 3, files_done: 1, bytes_total: 3 * GB, bytes_done: GB, rate_bps: 1e6, current: '', skipped: 0, links: [], slack: { state: 'skipped' }, summary: '', ...o })
const badge = (page) => page.getByTestId('queue-badge')

test.describe('the nav Queue button', () => {
  test('four dry-run entries show the number 4 as a corner overlay and turn the button yellow; the tooltip says what', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [1, 2, 3, 4].map((i) => ({ id: `d${i}`, shot: `s-${i}`, version: 1, state: 'would_upload', due_at: new Date(Date.now() + 600000).toISOString() })) }
    await page.goto('/')
    const btn = page.getByTestId('open-queue'), b = badge(page)
    await expect(b).toHaveText('4', { timeout: 8000 }); await expect(btn).toHaveAttribute('data-tone', 'warning'); await expect(btn).toHaveClass(/btn-warning/)
    await expect(btn).toHaveAttribute('title', '4 would upload (dry run)')
    // an overlay on the button's top right corner, not an inline pill beside the label
    const bb = await btn.boundingBox(), cc = await b.boundingBox()
    expect(cc.x + cc.width / 2).toBeGreaterThan(bb.x + bb.width - 6); expect(cc.y + cc.height / 2).toBeLessThan(bb.y + 6)
    await expect(b).toHaveClass(/position-absolute/)
  })
  test('Auto-publish LIVE and something working turns the button green and pulsing; live with nothing working yet is not', async ({ page, api }) => {
    on(api); api.state.mounts.config.auto_publish.dry_run = false
    api.state.renders = { jobs: [rjob({ trigger: 'auto-publish' })] }
    await page.goto('/')
    const btn = page.getByTestId('open-queue')
    await expect(btn).toHaveAttribute('data-tone', 'success', { timeout: 8000 }); await expect(btn).toHaveClass(/btn-success/); await expect(btn).toHaveClass(/queue-pulse/); await expect(badge(page)).toHaveText('1')
  })
  test('idle: the neutral outline button and no number; 99+ above ninety-nine', async ({ page, api }) => {
    await page.goto('/'); const btn = page.getByTestId('open-queue')
    await expect(btn).toHaveAttribute('data-tone', 'none'); await expect(btn).toHaveClass(/btn-outline-light/); await expect(badge(page)).toHaveCount(0)
    api.state.renders = { jobs: Array.from({ length: 120 }, (_, i) => rjob({ job_id: `j${i}` })) }
    await expect(badge(page)).toHaveText('99+', { timeout: 12000 })
  })
  test('a Review render job (an auto-publish one, or one from another process) shows at once with the Queue closed; the tooltip says what', async ({ page, api }) => {
    api.state.renders = { jobs: [rjob({ trigger: 'auto-publish' }), rjob({ job_id: 'job-2', state: 'running' }), rjob({ job_id: 'job-3', state: 'done' })] }
    await page.goto('/')
    await expect(badge(page)).toHaveText('2'); await expect(badge(page)).toHaveAttribute('title', '2 generations'); await expect(page.getByTestId('open-queue')).toHaveClass(/queue-pulse/)
  })
  test('every kind counts once: generations, a parent publish (not its children), an auto-publish upload that is also its publish job, auto-generate that is also a render job; waiting is only in the tooltip', async ({ page, api }) => {
    on(api)
    api.state.renders = { jobs: [rjob({ trigger: 'auto-publish' })] }
    api.state.publish = { settings: { s3: { bucket: 'b', prefix: 'p/', region: 'r', credentials: 'app', access_key_hint: '1' }, slack: {}, defaults: { targets: [], message: '' } }, tree: {}, there: [], heavy: [], jobs: [pjob({ children: [{ id: 'c1', state: 'uploading' }, { id: 'c2', state: 'uploading' }] }), pjob({ job_id: 'pub-2', trigger: 'auto-publish', state: 'posting' }), pjob({ job_id: 'pub-3', state: 'done' })] }
    const due = new Date(Date.now() + 600000).toISOString()
    api.state.autopublish = { pending: [{ id: 'u', shot: 'a', version: 1, state: 'uploading', due_at: due }, { id: 'w1', shot: 'b', version: 1, state: 'waiting', due_at: due }, { id: 'w2', shot: 'c', version: 1, state: 'waiting', due_at: due }], generate: { enabled: true, where: 'local', generating: 1, generated_today: 0, max_per_day: 20, waiting_to_settle: [{ stem: 'A' }], failed: [] } }
    await page.goto('/')
    await expect(badge(page)).toHaveText('6', { timeout: 8000 })   // 1 generation + 2 uploads (the parent once and the auto-publish one; the entry and the generating are those same jobs) + 3 waiting
    await expect(badge(page)).toHaveAttribute('title', '1 generation, 2 uploads, 3 waiting')
  })
  test('waiting entries count (a yellow button); a volume scan alone is a pulsing dot; idle: no badge; a core with fields missing does not break it', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [{ id: 'w', shot: 'b', version: 1, state: 'waiting', due_at: new Date(Date.now() + 600000).toISOString() }] }
    await page.goto('/'); await expect(badge(page)).toHaveText('1'); await expect(badge(page)).toHaveAttribute('data-kind', 'count'); await expect(page.getByTestId('open-queue')).toHaveAttribute('data-tone', 'warning')
    api.state.autopublish = { watching: { root: '/x', root_exists: true, reviews: 0, approved: 0, eligible: 0, queued: 0, uploaded_today: 0, skipped: [], summary: '', local: { enabled: true, reviews: 0 }, volume: { enabled: true, reviews: 0, scanning: true, scan_started_at: new Date().toISOString() } } }   // a scan that has just started (one running for over 90 s is a background job and no longer a dot: fix/autopublish-scan-banner)
    await expect(badge(page)).toHaveAttribute('data-kind', 'dot', { timeout: 12000 }); await expect(page.getByTestId('open-queue')).toHaveClass(/queue-pulse/); await expect(page.getByTestId('open-queue')).toHaveAttribute('title', 'scanning the RunPod volume')
    api.state.autopublish = {}; api.state.noAutoPublish = true; await page.reload(); await page.waitForTimeout(800); await expect(badge(page)).toHaveCount(0)
  })
  test('it keeps polling with the Queue closed: a job that starts later appears, and ends later disappears', async ({ page, api }) => {
    await page.goto('/'); await expect(badge(page)).toHaveCount(0)
    api.state.renders = { jobs: [rjob()] }; await expect(badge(page)).toHaveText('1', { timeout: 12000 })
    api.state.renders.jobs[0].state = 'done'; await expect(badge(page)).toHaveCount(0, { timeout: 12000 })
  })
})
