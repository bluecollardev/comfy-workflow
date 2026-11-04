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

  test('ComfyUI runs tab reads the running pod, with Refresh', async ({ page, api }) => {
    await page.goto('/')
    const d = await openHistory(page)
    await d.getByRole('tab', { name: t('history.tabRuns') }).click()
    await expect(d.getByTestId('history-run')).toHaveCount(2)
    await expect(d.getByTestId('history-run').first()).toContainText('abcdef12')
    await expect(d.getByTestId('history-run').first()).toContainText('shots/plate_0001.png')
    await expect(d.getByTestId('history-run').first()).toContainText('42.5 s')
    await expect(d.getByTestId('history-run').nth(1)).toContainText('CUDA out of memory')
    const before = api.calls.filter((c) => c.path === '/history/runs').length
    await d.getByTestId('history-runs-refresh').click()
    await expect.poll(() => api.calls.filter((c) => c.path === '/history/runs').length).toBeGreaterThan(before)
  })

  test('empty states', async ({ page, api }) => {
    api.state.history = { events: [], spend: { total: 0, running_now: 0, sessions: [], by_day: [], note: '' }, runs: { 'pod-aaaaaaaa': [] } }
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
})
