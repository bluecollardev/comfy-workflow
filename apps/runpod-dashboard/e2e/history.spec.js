import { test, expect, modal } from './fixtures'
import { t } from './i18n'

const openHistory = async (page) => {
  await page.getByTestId('open-history').click()
  const dialog = page.getByTestId('history-modal')
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('history', () => {
  test('Pods tab lists pod events', async ({ page }) => {
    await page.goto('/')
    const d = await openHistory(page)
    await expect(d.getByTestId('history-pod-row')).toHaveCount(2)
    await expect(d.getByTestId('history-action').first()).toBeVisible()
    await expect(d.getByTestId('history-pods')).toContainText('ComfyUI-Dev')
    await expect(d.getByTestId('history-pods')).toContainText('RTX 4090')
    await expect(d.getByTestId('history-pods')).toContainText('EU-RO-1')
  })

  test('Spend tab shows total, sessions, days, note and running badge', async ({ page }) => {
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabSpend') }).click()
    await expect(d.getByTestId('history-total')).toHaveText('$1.73')
    await expect(d.getByTestId('history-session')).toContainText('2.50')
    await expect(d.getByTestId('history-day')).toContainText('2026-11-03')
    await expect(d.getByTestId('history-note')).toContainText('RunPod bills the truth')
    await expect(d.getByTestId('history-running-now')).toHaveText(t('history.runningNow', { n: 1 }))
  })

  test('Jobs tab shows jobs with state, size and error', async ({ page }) => {
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabJobs') }).click()
    await expect(d.getByTestId('history-job-row')).toHaveCount(2)
    await expect(d.getByTestId('history-jobs')).toContainText('round-3')
    await expect(d.getByTestId('history-jobs')).toContainText('3.0 MB')
    await expect(d.getByTestId('history-jobs')).toContainText('rsync: connection reset')
    await expect(d.getByTestId('history-state').nth(1)).toHaveText('failed')
  })

  test('Jobs & changes lists change events newest first, with their origin', async ({ page }) => {
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabJobs') }).click()
    await expect(d.getByTestId('history-change-row')).toHaveCount(1)
    const row = d.getByTestId('history-change-row')
    await expect(row.getByTestId('history-change-area')).toHaveText(t('history.area_volume'))
    await expect(row.getByTestId('history-change-action')).toHaveText('resized')
    await expect(row).toContainText('comfy-workspace')
    await expect(row).toContainText('120 GB to 200 GB')
    await expect(row.getByTestId('history-via-mcp')).toHaveAttribute('title', t('history.viaMcpTitle', { tool: 'resize_volume', who: 'Lucas' }))
    // the change (14:00) is above the two jobs (13:30, 13:00)
    await expect(d.getByTestId('history-jobs').locator('tbody tr').first()).toHaveAttribute('data-testid', 'history-change-row')
    await expect(d.getByTestId('history-job-row').first().getByTestId('history-via-app')).toHaveText(t('history.viaApp'))
  })

  test('Pods rows say whether the app or an MCP client did it', async ({ page }) => {
    await page.goto('/')
    const d = await openHistory(page)
    const pods = d.getByTestId('history-pods')
    await expect(pods.getByTestId('history-via-mcp')).toHaveCount(1)
    await expect(pods.getByTestId('history-via-mcp')).toHaveText(t('history.viaMcp'))
    await expect(pods.getByTestId('history-via-mcp')).toHaveAttribute('title', t('history.viaMcpTitle', { tool: 'create_pod', who: 'Lucas' }))
    await expect(pods.getByTestId('history-via-app')).toHaveCount(1)
  })

  test('a ComfyUI run expands to its messages, error detail and outputs', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabRuns') }).click()
    await expect(d.getByTestId('history-run-detail')).toHaveCount(0)
    await d.getByTestId('history-run').nth(1).click()
    const det = d.getByTestId('history-run-detail')
    await expect(det.getByTestId('history-run-error-message')).toHaveText('CUDA out of memory')
    await expect(det.getByTestId('history-run-node')).toContainText('KSampler')
    await expect(det.getByTestId('history-run-node')).toContainText('12')
    await expect(det.getByTestId('history-run-exception')).toContainText('torch.OutOfMemoryError')
    await expect(det.getByTestId('history-run-traceback')).toContainText('Traceback (most recent call last)')
    await expect(det.getByTestId('history-run-message')).toHaveCount(2)
    await expect(det.getByTestId('history-run-message').nth(1)).toContainText('execution_error')
    await det.getByTestId('history-run-copy').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('torch.OutOfMemoryError: CUDA out of memory')
    await d.getByTestId('history-run').nth(1).click()
    await expect(d.getByTestId('history-run-detail')).toHaveCount(0)
    await d.getByTestId('history-run').first().click()
    await expect(d.getByTestId('history-run-detail')).toContainText('shots/plate_0001.png')
    await expect(d.getByTestId('history-run-error-detail')).toHaveCount(0)
  })

  test('the ComfyUI log: levels, text filter, errors badge, copy', async ({ page, api, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabRuns') }).click()
    const log = d.getByTestId('history-comfy-log')
    await expect(log.getByTestId('history-log-line')).toHaveCount(3)
    await expect(log.getByTestId('history-log-errors')).toHaveText(t('history.logErrorCount', { n: 1 }))
    await expect(log.getByTestId('history-log-line').nth(2).getByTestId('history-log-badge')).toHaveText('error')
    await log.getByTestId('history-log-level').selectOption('warning')
    await expect(log.getByTestId('history-log-line')).toHaveCount(2)
    await expect.poll(() => api.calls.some((c) => c.path === '/history/logs' && c.query?.level === 'warnings')).toBe(true)
    await log.getByTestId('history-log-level').selectOption('error')
    await expect(log.getByTestId('history-log-line')).toHaveCount(1)
    await expect(log).toContainText('CUDA out of memory')
    await log.getByTestId('history-log-level').selectOption('all')
    await expect(log.getByTestId('history-log-line')).toHaveCount(3)
    await log.getByTestId('history-log-text').fill('xformers')
    await expect(log.getByTestId('history-log-line')).toHaveCount(1)
    await expect(log).toContainText('falling back')
    await log.getByTestId('history-log-text').fill('nothing like this')
    await expect(log.getByTestId('history-log-empty')).toBeVisible()
    await log.getByTestId('history-log-text').fill('')
    await log.getByTestId('history-log-copy').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('ERROR Failed to validate prompt')
  })

  test('the ComfyUI log refreshes by itself while Auto-refresh is on', async ({ page, api }) => {
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabRuns') }).click()
    const log = d.getByTestId('history-comfy-log')
    await expect(log.getByTestId('history-log-line')).toHaveCount(3)
    api.state.history.logs['pod-aaaaaaaa'].entries.push({ ts: '2026-11-03T11:11:00Z', level: 'error', text: 'later failure' })
    await expect(log.getByTestId('history-log-line')).toHaveCount(4, { timeout: 12000 })
    await expect(log.getByTestId('history-log-errors')).toHaveText(t('history.logErrorCount', { n: 2 }))
    await log.getByTestId('history-log-auto').uncheck()
    const n = api.calls.filter((c) => c.path === '/history/logs').length
    await page.waitForTimeout(6000)
    expect(api.calls.filter((c) => c.path === '/history/logs').length).toBe(n)
    await log.getByTestId('history-log-refresh').click()
    await expect.poll(() => api.calls.filter((c) => c.path === '/history/logs').length).toBeGreaterThan(n)
  })

  test('a log error is shown, not thrown', async ({ page, api }) => {
    api.state.history.logs = {}
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabRuns') }).click()
    await expect(d.getByTestId('history-log-error')).toContainText('is not running')
    await expect(d.getByTestId('history-log-errors')).toHaveCount(0)
  })

  test('an empty log says so', async ({ page, api }) => {
    api.state.history.logs['pod-aaaaaaaa'].entries = []
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabRuns') }).click()
    await expect(d.getByTestId('history-log-empty')).toHaveText(t('history.logEmpty'))
  })

  test('ComfyUI runs tab reads the running pod, with Refresh', async ({ page, api }) => {
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabRuns') }).click()
    await expect(d.getByTestId('history-run')).toHaveCount(2)
    await expect(d.getByTestId('history-run').first()).toContainText('abcdef12')
    await expect(d.getByTestId('history-run').first()).toContainText('shots/plate_0001.png')
    await expect(d.getByTestId('history-run').first()).toContainText('42.5 s')
    await expect(d.getByTestId('history-run').nth(1)).toContainText('CUDA out of memory')
    await expect(d.getByTestId('history-run-cost').first()).toHaveText('$0.0081')
    await expect(d.getByTestId('history-run-cost').first()).toHaveAttribute('title', t('history.costTitle'))
    await expect(d.getByTestId('history-run-cost').nth(1)).toHaveText('—')
    await expect(d.getByTestId('history-runs-total')).toHaveText(t('history.runsTotal', { n: 2, min: 0.7, cost: '$0.0081' }))
    await d.getByTestId('history-run').first().click()
    await expect(d.getByTestId('history-run-detail-cost')).toContainText('$0.0081')
    const before = api.calls.filter((c) => c.path === '/history/runs').length
    await d.getByTestId('history-runs-refresh').click()
    await expect.poll(() => api.calls.filter((c) => c.path === '/history/runs').length).toBeGreaterThan(before)
  })

  test('empty states', async ({ page, api }) => {
    api.state.history = { events: [], spend: { total: 0, running_now: 0, sessions: [], by_day: [], note: '' }, runs: { 'pod-aaaaaaaa': [] }, logs: { 'pod-aaaaaaaa': { entries: [], truncated: false } } }
    await page.goto('/')
    const d = await openHistory(page)
    await expect(d.getByTestId('history-pods-empty')).toBeVisible()
    await d.getByRole('tab', { name: t('history.tabSpend') }).click()
    await expect(d.getByTestId('history-spend-empty')).toBeVisible()
    await d.getByRole('tab', { name: t('history.tabJobs') }).click()
    await expect(d.getByTestId('history-jobs-empty')).toBeVisible()
    await d.getByRole('tab', { name: t('history.tabRuns') }).click()
    await expect(d.getByTestId('history-runs-empty')).toBeVisible()
  })

  test('a runs error is shown, not thrown', async ({ page, api }) => {
    api.state.history.runs = {}
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabRuns') }).click()
    await expect(d.getByTestId('history-runs-error')).toContainText('is not running')
  })

  test('Export saves JSON and CSV files', async ({ page }) => {
    await page.goto('/')
    const d = await openHistory(page)
    const grab = async (item) => {
      await d.getByTestId('history-export').locator('button').first().click()
      const [dl] = await Promise.all([page.waitForEvent('download'), d.getByTestId(item).click()])
      return dl.suggestedFilename()
    }
    expect(await grab('history-export-json')).toBe('history-all.json')
    expect(await grab('history-export-csv-events')).toBe('history-events.csv')
    expect(await grab('history-export-csv-spend')).toBe('history-spend.csv')
  })

  test('the open window updates by itself (a poll in a browser, a push in the app)', async ({ page, api }) => {
    await page.goto('/')
    const d = await openHistory(page)
    await expect(d.getByTestId('history-pod-row')).toHaveCount(2)
    api.state.history.events.unshift({ ts: '2026-11-04T10:00:00Z', kind: 'pod', action: 'stopped', pod_id: 'pod-x', name: 'Stopped-elsewhere', gpu: 'A40', datacenter: 'EU-SE-1' })
    await expect(d.getByTestId('history-pod-row')).toHaveCount(3, { timeout: 12000 })
    await expect(d.getByTestId('history-pods')).toContainText('Stopped-elsewhere')
  })

  test('Jobs & Changes filters: kind, state, where it came from and a search, with a count and a way back', async ({ page }) => {
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabJobs') }).click()
    const count = d.getByTestId('history-jobs-count')
    await expect(count).toHaveText(t('history.filterCount', { n: 3, of: 3 }))
    await expect(d.getByTestId('history-jobs-clear')).toHaveCount(0)
    await d.getByTestId('history-jobs-kind').selectOption('changes')
    await expect(d.getByTestId('history-change-row')).toHaveCount(1); await expect(d.getByTestId('history-job-row')).toHaveCount(0)
    await d.getByTestId('history-jobs-kind').selectOption('job:sync')
    await expect(d.getByTestId('history-job-row')).toHaveCount(1); await expect(d.getByTestId('history-jobs')).toContainText('ComfyUI-Shared')
    await d.getByTestId('history-jobs-kind').selectOption('')
    await d.getByTestId('history-jobs-state').selectOption('failed')
    await expect(d.getByTestId('history-job-row')).toHaveCount(1); await expect(d.getByTestId('history-change-row')).toHaveCount(0)   // a change has no state
    await d.getByTestId('history-jobs-state').selectOption('')
    await d.getByTestId('history-jobs-via').selectOption('mcp')
    await expect(d.getByTestId('history-change-row')).toHaveCount(1); await expect(d.getByTestId('history-job-row')).toHaveCount(0)
    await d.getByTestId('history-jobs-via').selectOption('')
    await d.getByTestId('history-jobs-text').fill('connection reset')
    await expect(count).toHaveText(t('history.filterCount', { n: 1, of: 3 }))
    await d.getByTestId('history-jobs-text').fill('nothing like this')
    await expect(d.getByTestId('history-jobs-nomatch')).toBeVisible()
    await d.getByTestId('history-jobs-clear').click()
    await expect(count).toHaveText(t('history.filterCount', { n: 3, of: 3 }))
    await expect(d.getByTestId('history-jobs-text')).toHaveValue('')
  })

  test('configuration changes are hidden until asked for (the switch, or the Configuration kind)', async ({ page }) => {
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabJobs') }).click()
    await expect(d.getByTestId('history-change-row')).toHaveCount(1)   // the volume change only
    await expect(d.getByTestId('history-jobs')).not.toContainText('Default Configuration')
    await expect(d.getByTestId('history-jobs-count')).toHaveText(t('history.filterCount', { n: 3, of: 3 }))
    await d.getByTestId('history-jobs-kind').selectOption('area:configuration')   // asking for them by kind shows them
    await expect(d.getByTestId('history-change-row')).toHaveCount(1); await expect(d.getByTestId('history-jobs')).toContainText('Default Configuration')
    await d.getByTestId('history-jobs-kind').selectOption('')
    await d.getByTestId('history-jobs-show-config').check({ force: true })
    await expect(d.getByTestId('history-change-row')).toHaveCount(2)
    await expect(d.getByTestId('history-jobs-count')).toHaveText(t('history.filterCount', { n: 4, of: 4 }))
  })

  test('long names, items and errors wrap inside their cells instead of widening the table', async ({ page, api }) => {
    const long = 'cgi-042-left-eye-plates-v013-final-graded-delivery_ProRes4444XQ_2048x858_24fps_rec709_gamma24_0001-0240.mov'
    api.state.history.events.unshift({ ts: '2026-11-04T09:00:00Z', kind: 'job', job: 'sync', state: 'failed', what: long, pod_name: 'ComfyUI-Dev', error: 'rsync: ' + long + ': connection reset by peer while sending the file list' })
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabJobs') }).click()
    const cell = d.getByTestId('history-job-row').first().locator('td').nth(2)
    await expect(cell).toContainText('cgi-042-left-eye')
    const box = await cell.boundingBox()
    expect(box.width).toBeLessThan(430)   // 26rem at most: the text wrapped
    const tab = d.getByTestId('history-jobs')
    expect(await tab.evaluate((el) => el.scrollWidth <= el.parentElement.clientWidth + 1)).toBe(true)   // and the table fits its window
  })
})
