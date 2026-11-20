import { test, expect, queueTab } from './fixtures'

// The Queue's Failures list (Generations tab): one row per failed graph run with its stage, node, message, missing models, recovery and retries; Retry only when retryable; Copy as JSON; links from failed jobs; hidden on an older core.
const REC = (o = {}) => ({ id: 'f1', time: `${new Date().toLocaleDateString('sv')}T14:26:15`, job_id: 'job-x', round: 'r1', shot: 'depth-182', graph: 'graphs/depth_main_v015.json', graph_version: '015', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', gpu: 'RTX 4090', stage: 'execute', node_id: '47', node_type: 'KSampler', message: 'CUDA out of memory while sampling\nTried to allocate 2.5 GiB', log_tail: ['line 1', 'line 2', 'OutOfMemoryError'], missing_models: [], recovery: 'Use a pod with 48 GB or lower the batch size', retryable: true, attempt: 2, ...o })   // the core's record (libs/core/src/failures.ts)

test.describe('Queue > Generations > Failures', () => {
  test('a row: time, shot, graph and version, stage chip, node, the first line of the message (the rest and the log tail expand), missing models with where they exist, the recovery, retries', async ({ page, api }) => {
    api.state.failures = [REC(), REC({ id: 'f2', time: '2026-11-18T09:05:07', shot: 'cgi-042', stage: 'validate', node_id: '9', node_type: 'CheckpointLoaderSimple', message: 'Value not in list: ckpt_name', log_tail: [], missing_models: [{ name: 'sd_xl_base.safetensors', where_on_volume: 'models/checkpoints/' }], recovery: 'Fetch the model onto the pod', retryable: false, attempt: 1 })]
    await page.goto('/'); await queueTab(page, 'generations')
    const row = (id) => page.locator(`[data-testid="failure-row"][data-id="${id}"]`)
    await expect(page.getByTestId('queue-failures').locator('h6')).toHaveText('Failures (2)')
    const r = row('f1'); await expect(r.getByTestId('failure-time')).toHaveText('14:26:15'); await expect(row('f2').getByTestId('failure-time')).toHaveText('18 Nov 09:05:07')
    await expect(r.getByTestId('failure-shot')).toHaveText('depth-182'); await expect(r.getByTestId('failure-graph')).toHaveText('graphs/depth_main_v015.json'); await expect(r.getByTestId('failure-version')).toHaveText('v015')
    await expect(r.getByTestId('failure-stage')).toHaveText('execute'); await expect(r.getByTestId('failure-node')).toHaveText('node 47 KSampler')
    await expect(r.getByTestId('failure-message')).toHaveText('CUDA out of memory while sampling'); await expect(r.getByTestId('failure-full')).toBeHidden()
    await r.getByTestId('failure-more').locator('summary').click(); await expect(r.getByTestId('failure-full')).toContainText('Tried to allocate 2.5 GiB'); await expect(r.getByTestId('failure-log')).toContainText('OutOfMemoryError')
    await expect(r.getByTestId('failure-recovery')).toHaveText('Use a pod with 48 GB or lower the batch size'); await expect(r.getByTestId('failure-attempt')).toHaveText('attempt 2'); await expect(row('f2').getByTestId('failure-attempt')).toHaveCount(0)   // shown only above 1
    await expect(row('f2').getByTestId('failure-missing-row')).toHaveText('sd_xl_base.safetensors · exists on models/checkpoints/'); await expect(r.getByTestId('failure-missing')).toHaveCount(0)
    // newest first
    await expect(page.getByTestId('failure-row').first()).toHaveAttribute('data-id', 'f1')
  })
  test('the rows are paged: 10 a page by default (5, 10 or 25), newest first, a new size starts at page 1, a page that empties moves back', async ({ page, api }) => {
    api.state.failures = Array.from({ length: 12 }, (_, i) => REC({ id: `f${i + 1}`, shot: `shot-${i + 1}`, time: `2026-11-19T14:${String(59 - i).padStart(2, '0')}:00` }))
    await page.goto('/'); await queueTab(page, 'generations')
    const rows = page.getByTestId('failure-row'), info = page.getByTestId('failures-page-info'), next = page.getByTestId('failures-page-next'), prev = page.getByTestId('failures-page-prev'), size = page.getByTestId('failures-page-size')
    await expect(page.getByTestId('queue-failures').locator('h6')).toHaveText('Failures (12)')
    await expect(rows).toHaveCount(10); await expect(rows.first()).toHaveAttribute('data-id', 'f1'); await expect(info).toHaveText('1–10 of 12'); await expect(prev).toBeDisabled()
    await next.click(); await expect(rows).toHaveCount(2); await expect(rows.first()).toHaveAttribute('data-id', 'f11'); await expect(info).toHaveText('11–12 of 12'); await expect(next).toBeDisabled()
    api.state.failures = api.state.failures.slice(0, 10)   // page 2 empties: back to page 1
    await expect(rows).toHaveCount(10, { timeout: 12000 }); await expect(info).toHaveText('1–10 of 10')
    await size.selectOption('5'); await expect(rows).toHaveCount(5); await expect(info).toHaveText('1–5 of 10')
    await next.click(); await expect(info).toHaveText('6–10 of 10'); await size.selectOption('25'); await expect(info).toHaveText('1–10 of 10'); await expect(rows).toHaveCount(10)
    api.state.failures = api.state.failures.slice(0, 4); await expect(page.getByTestId('failures-pager')).toHaveCount(0, { timeout: 12000 })   // 5 or fewer: no pager
  })
  test('Retry only when retryable and it sends the id; Copy puts the whole record on the clipboard as JSON', async ({ page, api }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    api.state.failures = [REC(), REC({ id: 'f2', at: '2026-11-18T09:05:07', retryable: false, attempt: 1 })]
    await page.goto('/'); await queueTab(page, 'generations')
    await expect(page.locator('[data-testid="failure-row"][data-id="f2"]').getByTestId('failure-retry')).toHaveCount(0)
    await page.locator('[data-testid="failure-row"][data-id="f1"]').getByTestId('failure-retry').click()
    await expect.poll(() => api.state.failureRetries).toEqual(['f1']); await expect(page.locator('[data-testid="failure-row"][data-id="f1"]').getByTestId('failure-attempt')).toHaveText('attempt 3', { timeout: 8000 })
    await page.locator('[data-testid="failure-row"][data-id="f1"]').getByTestId('failure-copy').click()
    const j = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())); expect(j).toMatchObject({ id: 'f1', shot: 'depth-182', stage: 'execute', node_id: '47', node_type: 'KSampler', graph_version: '015' })
  })
  test('empty state; a failed job links to its failure row; the Overview shows the count; an older core hides all of it', async ({ page, api }) => {
    await page.goto('/'); await queueTab(page, 'generations'); await expect(page.getByTestId('failures-none')).toHaveText('No graph failures')
    api.state.failures = [REC()]
    api.state.renders = { jobs: [{ job_id: 'job-x', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', kind: 'review', state: 'failed', started_at: '2026-11-19T14:26:15', finished_at: '2026-11-19T14:26:37', frames_done: 0, frames_total: 5, rate_fps: 0, current: '', pulled_files: 0, pulled_bytes: 0, error: 'Incomplete: frames 85-118 are missing', summary: '', sequences: [] }] }
    await expect(page.getByTestId('failure-row')).toHaveCount(1, { timeout: 12000 })
    await page.getByTestId('generations-job-failure-link').click(); await expect(page.locator('[data-testid="failure-row"]').first()).toHaveClass(/border-danger/); await expect(page.getByTestId('failure-more')).toHaveAttribute('open', '')
    await page.getByTestId('queue-tab-overview').click(); await expect(page.getByTestId('queue-overview-failures')).toHaveText(/1 graph failures/)
    api.state.noFailures = true; await page.reload(); await queueTab(page, 'generations'); await expect(page.getByTestId('queue-failures')).toHaveCount(0)
  })
})
