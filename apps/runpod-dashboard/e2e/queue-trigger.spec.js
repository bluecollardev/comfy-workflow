import { test, expect } from './fixtures'

// Who started a job: manual / MCP (the client in the tooltip) / auto / backfill, an 'external' tag for a job another process owns, counted like any job, cancellable; older cores show 'manual'.
const rjob = (o = {}) => ({ job_id: 'job-1', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', kind: 'proxy', state: 'rendering', started_at: '2026-11-19T10:00:00Z', finished_at: null, frames_done: 2, frames_total: 10, rate_fps: 1, current: '', pulled_files: 0, pulled_bytes: 0, error: '', summary: '', sequences: [], ...o })
const pjob = (o = {}) => ({ job_id: 'pub-1', state: 'uploading', targets: ['s3'], approved_by: 'B', started_at: '2026-11-19T10:00:00Z', files_total: 3, files_done: 1, bytes_total: 3e9, bytes_done: 1e9, rate_bps: 1e6, current: '', skipped: 0, links: [], slack: { state: 'skipped' }, summary: '', ...o })
const pubSettings = () => ({ s3: { bucket: 'b', prefix: 'p/', region: 'r', credentials: 'app', access_key_hint: '1' }, slack: {}, defaults: { targets: [], message: '' } })

test.describe('Queue: who started it', () => {
  test('Generations: manual, MCP (with its client) and an external job; the external one counts and can be cancelled; the badge counts all three', async ({ page, api }) => {
    api.state.renders = { jobs: [rjob({ job_id: 'j-m', trigger: 'window' }), rjob({ job_id: 'j-mcp', trigger: 'mcp', mcp_client: 'claude-code' }), rjob({ job_id: 'j-ext', trigger: 'mcp', mcp_client: 'script', external: true })] }
    await page.goto('/'); await expect(page.getByTestId('queue-badge')).toHaveText('3', { timeout: 8000 })
    await page.getByTestId('open-queue').click(); await page.getByTestId('queue-tab-generations').click()
    const card = (id) => page.locator(`[data-testid="generations-job"][data-job="${id}"]`)
    await expect(card('j-m').getByTestId('generations-job-trigger')).toHaveText('manual'); await expect(card('j-m').getByTestId('generations-job-external')).toHaveCount(0)
    await expect(card('j-mcp').getByTestId('generations-job-trigger')).toHaveText('MCP'); await expect(card('j-mcp').getByTestId('generations-job-trigger')).toHaveAttribute('title', 'MCP: claude-code')
    await expect(card('j-ext').getByTestId('generations-job-external')).toHaveAttribute('title', 'Started by another process (MCP or a script); you can still cancel it')
    await card('j-ext').getByTestId('generations-job-stop').click(); await expect.poll(() => api.state.renders.cancelled).toContain('j-ext')
  })
  test('Publishing: MCP and external; the Overview table has the same badges and the external tag, and a core without the fields says manual', async ({ page, api }) => {
    api.state.publish = { settings: pubSettings(), tree: {}, there: [], heavy: [], jobs: [pjob({ job_id: 'p-mcp', trigger: 'mcp', mcp_client: 'claude-code' }), pjob({ job_id: 'p-ext', trigger: 'mcp', external: true }), pjob({ job_id: 'p-old' }), pjob({ job_id: 'p-bf', kind: 'backfill', trigger: 'backfill' })], runs: [], puts: [], tests: [], planned: [], reposts: [], cancelled: [] }
    await page.goto('/'); await page.getByTestId('open-queue').click()
    const row = (id) => page.locator(`[data-testid="queue-working-row"]`).filter({ hasText: id })
    await expect(row('p-mcp').getByTestId('queue-working-trigger')).toHaveText('MCP', { timeout: 8000 }); await expect(row('p-mcp').getByTestId('queue-working-trigger')).toHaveAttribute('title', 'MCP: claude-code')
    await expect(row('p-ext').getByTestId('queue-working-external')).toBeVisible(); await expect(row('p-old').getByTestId('queue-working-trigger')).toHaveText('manual'); await expect(row('p-bf').getByTestId('queue-working-trigger')).toHaveText('backfill')
    await page.getByTestId('queue-tab-publishing').click()
    const card = (id) => page.locator(`[data-testid="publishing-job"][data-job="${id}"]`)
    await expect(card('p-mcp').getByTestId('publishing-job-trigger')).toHaveText('MCP'); await expect(card('p-ext').getByTestId('publishing-job-external')).toBeVisible(); await expect(card('p-old').getByTestId('publishing-job-trigger')).toHaveText('manual')
    await card('p-ext').getByTestId('publish-cancel').click(); await expect.poll(() => api.state.publish.cancelled).toContain('p-ext')
  })
  test('an Auto-publish entry says auto; the Overview counts an MCP job started while the Queue is closed (fast poll while it runs)', async ({ page, api }) => {
    api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' } }
    api.state.autopublish = { pending: [{ id: 'w', shot: 'x', version: 1, state: 'waiting', due_at: new Date(Date.now() + 600000).toISOString() }] }
    await page.goto('/'); await expect(page.getByTestId('queue-badge')).toHaveText('1')
    api.state.renders = { jobs: [rjob({ job_id: 'later', trigger: 'mcp', external: true })] }
    await expect(page.getByTestId('queue-badge')).toHaveText('2', { timeout: 12000 })
    await page.getByTestId('open-queue').click(); await page.getByTestId('queue-tab-publishing').click()
    await expect(page.getByTestId('autopublish-row-trigger').first()).toHaveText('auto')
  })
})
